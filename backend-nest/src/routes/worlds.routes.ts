/**
 * Open-Pax — Worlds Routes
 * ========================
 */

import { Router } from 'express';
import { shortId } from '../utils/short-id';
import fs from 'fs';
import path from 'path';
import { worldRepository, relationshipRepository } from '../repositories';
import { svgPathToGeoJSON } from '../utils/svg-to-geojson';
import { BalanceAgent } from '../agents/balance-agent';
import { getLLMRouter } from '../llm';
import { loadPreset, loadPresetMap, type PresetPackage } from '../utils/preset-loader';
import { createWorldGenJob, getWorldGenJob, setWorldGenProgress, updateWorldGenJob } from '../utils/world-gen-jobs';
import { computeBorders } from '../utils/borders';
import { resolveRegionColor } from '../utils/color';
import { geometryAreaDeg2, largestRingCentroid, pointInGeometry } from '../utils/geo';
import { paxSettlementObjectsForGeometry } from '../utils/pax-geography';

export const worldsRouter = Router();

// Этап 4: столицы стран для маркеров на карте.
// Контракт файла (отдаёт параллельный пайплайн Natural Earth):
//   { "USA": { capital: "Washington", lat: 38.9, lng: -77.0 }, ... }
// Читаем лениво и кэшируем; если файла нет или он битый — регионы просто
// остаются без столиц, генерация мира не падает.
interface CapitalEntry { capital: string; lat: number; lng: number }
let capitalsCache: Record<string, CapitalEntry> | null = null;
function getCapitals(): Record<string, CapitalEntry> {
  if (capitalsCache) return capitalsCache;
  try {
    const capitalsPath = path.join(process.cwd(), 'data', 'geojson', 'capitals.json');
    capitalsCache = fs.existsSync(capitalsPath)
      ? JSON.parse(fs.readFileSync(capitalsPath, 'utf-8'))
      : {};
  } catch (e) {
    console.warn('[Generate World] capitals.json non letto — regioni senza capitali:', e);
    capitalsCache = {};
  }
  return capitalsCache!;
}

// Città maggiori del mondo (cities.json): oggetti mappa con coordinate reali.
// Formato: { cities: [{ name, country, lat, lng, pop }] }
interface CityEntry { name: string; country: string; lat: number; lng: number; pop: number }
let citiesCache: CityEntry[] | null = null;
function getCities(): CityEntry[] {
  if (citiesCache) return citiesCache;
  try {
    const citiesPath = path.join(process.cwd(), 'data', 'geojson', 'cities.json');
    const raw = fs.existsSync(citiesPath) ? JSON.parse(fs.readFileSync(citiesPath, 'utf-8')) : { cities: [] };
    citiesCache = (raw.cities || []).filter((c: any) =>
      c && c.name && typeof c.lat === 'number' && typeof c.lng === 'number' && c.country
    );
  } catch (e) {
    console.warn('[Generate World] cities.json non letto — mappa senza città:', e);
    citiesCache = [];
  }
  return citiesCache!;
}

// ---------------------------------------------------------------------------
// Helper geometrici: utils/geo.ts (condivisi con game-session)
// ---------------------------------------------------------------------------

/**
 * Città (dalla registry) dentro la geometria della regione, come oggetti mappa.
 * Max `limit` città per regione, dalla più popolosa. Niente geometria → [].
 */
function citiesForRegion(geometry: any, countryCode: string, limit = 6): any[] {
  if (!geometry) return [];
  // Per la mappa Pax la posizione è la fonte primaria; escludiamo le capitali
  // qui perché il generatore le inserisce separatamente sulla provincia-capitale.
  const paxCities = paxSettlementObjectsForGeometry(geometry, limit)
    .filter(point => point.type === 'city');
  if (paxCities.length > 0) return paxCities;

  const inRegion = getCities().filter(c => c.country === countryCode && pointInGeometry([c.lng, c.lat], geometry));
  inRegion.sort((a, b) => b.pop - a.pop);
  return inRegion.slice(0, limit).map(c => ({
    id: shortId(),
    type: 'city',
    name: c.name,
    lat: c.lat,
    lng: c.lng,
    pop: c.pop,
  }));
}

// Generazione asincrona del mondo. La generazione completa (BalanceAgent su
// preset da 200+ paesi) dura diversi minuti e NON può restare dentro una
// richiesta HTTP: Cloudflare Tunnel (trycloudflare.com) interrompe le
// risposte oltre ~100s con un errore 524. Il POST crea un job e risponde
// subito con { jobId }; il lavoro prosegue in background e il client
// interroga GET /worlds/jobs/:jobId finché lo stato diventa "completed".
async function runWorldGeneration(
  jobId: string,
  templateId: string,
  preset: PresetPackage,
  playerCountryCode: string
): Promise<unknown> {
  const onProgress = (done: number, total: number) =>
    setWorldGenProgress(
      jobId,
      done,
      total,
      done < total ? 'Generazione dei paesi del mondo…' : 'Bilanciamento delle potenze…'
    );

  try {
    // Геометрия регионов: кастомная карта пакета (map.geojson) или
    // стандартная Natural Earth (data/geojson/countries.geojson)
    let geojsonFeatures: Record<string, any> = {};
    // Мировые пакеты уровня ПРОВИНЦИЙ: feature.properties.country = код страны-владельца.
    // Каждая province — отдельный регион игры, но полития (owner) — страна-мать.
    const provinceFeaturesByCountry: Record<string, any[]> = {};
    const ingestFeature = (feature: any): void => {
      const code = feature.properties?.code;
      if (!code) return;
      const parent = feature.properties?.country;
      if (parent && parent !== code) {
        (provinceFeaturesByCountry[parent] ??= []).push(feature);
      } else {
        geojsonFeatures[code] = feature;
      }
    };
    if (preset.has_custom_map) {
      const customMap = loadPresetMap(templateId);
      for (const feature of customMap?.features || []) {
        ingestFeature(feature);
      }
    } else {
      const geojsonPath = path.join(process.cwd(), 'data', 'geojson', 'countries.geojson');
      if (fs.existsSync(geojsonPath)) {
        const geojsonData = JSON.parse(fs.readFileSync(geojsonPath, 'utf-8'));
        for (const feature of geojsonData.features || []) {
          ingestFeature(feature);
        }
      }
    }

    const balanceAgent = new BalanceAgent(getLLMRouter());
    // Кастомные страны пакета (имена/цвета) перекрывают реестр data/countries.json
    const worldState = await balanceAgent.generateInitialWorldState(
      preset,
      preset.countries,
      onProgress
    );

    // Цвета карты: приоритет у кураторской палитры пресета (country_colors);
    // для кодов вне палитры — прежний цвет (реестр/countries[]) + анти-тёмный
    // post-process (карта фронта тёмная, #0a0a0f: чёрные регионы невидимы).
    for (const [code, state] of worldState.countries) {
      state.color = resolveRegionColor(code, state.color, preset.country_colors);
    }

    const countriesObj: Record<string, any> = {};
    const regionsObj: Record<string, any> = {};
    // Per mondi provinciali: codice paese → id della provincia-capitale
    // (il giocatore inizia dalla capitale della politia scelta)
    const homeRegionByCountry: Record<string, string> = {};

    for (const [code, state] of worldState.countries) {
      countriesObj[code] = state;

      const provinceFeatures = provinceFeaturesByCountry[code];

      // ---------------------------------------------------------------------
      // MODALITÀ PROVINCE: il paese è suddiviso in più regioni-provincia.
      // Statistiche della politia (da BalanceAgent) distribuite per area;
      // la provincia-capitale riceve un bonus. Owner = codice paese.
      // ---------------------------------------------------------------------
      if (provinceFeatures && provinceFeatures.length > 0) {
        const withArea = provinceFeatures.map(f => ({
          f,
          area: geometryAreaDeg2(f.geometry) || 0.0001,
        }));
        // Peso: area; la capitale vale 1.6× — è il cuore demografico-economico
        const weights = withArea.map(w => ({
          ...w,
          weight: w.area * (w.f.properties?.is_capital ? 1.6 : 1),
        }));
        const totalWeight = weights.reduce((s, w) => s + w.weight, 0) || 1;
        const cap = getCapitals()[code];

        for (const w of weights) {
          const props = w.f.properties || {};
          const provCode = props.code;
          const isCapital = !!props.is_capital;
          const share = w.weight / totalWeight;

          // Oggetti: capitale reale sulla provincia-capitale + città della registry
          const capitalObjects = (isCapital && cap && typeof cap.lat === 'number')
            ? [{ id: shortId(), type: 'capital', name: cap.capital, lat: cap.lat, lng: cap.lng }]
            : [];
          // Tutte le città principali geolocalizzate che ricadono nella provincia.
          // Il frontend decide quali etichette mostrare in base allo zoom.
          const cityObjects = citiesForRegion(w.f.geometry, code, Infinity);

          regionsObj[provCode] = {
            id: provCode,
            name: props.name || provCode,
            color: state.color || '#888888',
            geojson: JSON.stringify(w.f),
            owner: code, // la politia è il paese — la conquista cambia il proprietario della provincia
            population: Math.max(100000, Math.round((state.population || 0) * share)),
            gdp: Math.max(1, Math.round((state.gdp || 0) * share)),
            militaryPower: Math.max(1, Math.round((state.military || 0) * share * (isCapital ? 1.25 : 1))),
            objects: [...capitalObjects, ...cityObjects],
            borders: [],
            status: 'active',
            flag: code,
            metadata: {
              ideology: state.ideology,
              country: code,
              isCapitalProvince: isCapital,
            },
          };
          if (isCapital) homeRegionByCountry[code] = provCode;
        }
        // Fallback se nessuna provincia segnata come capitale
        if (!homeRegionByCountry[code] && provinceFeatures[0]?.properties?.code) {
          homeRegionByCountry[code] = provinceFeatures[0].properties.code;
        }
        continue;
      }

      const geojson = geojsonFeatures[code];
      if (geojson) {
        // Этап 4: столица страны как map feature (формат согласован с фронтом:
        // { id, type, name, lat, lng }). Нет записи в capitals.json — без столицы.
        const cap = getCapitals()[code];
        const capitalObjects = (cap && typeof cap.lat === 'number' && typeof cap.lng === 'number')
          ? [{ id: shortId(), type: 'capital', name: cap.capital, lat: cap.lat, lng: cap.lng }]
          : [];
        // Città maggiori del paese dentro i confini nazionali
        const geometry = geojson.geometry ?? geojson;
        // Tutte le città principali del registro (coordinate reali).
        const cityObjects = citiesForRegion(geometry, code, Infinity);
        homeRegionByCountry[code] = code;
        regionsObj[code] = {
          id: code,
          name: state.name,
          color: state.color || '#888888',
          geojson: JSON.stringify(geojson),
          // Unified polity-id convention: owner IS the polity id (country code).
          // Player's polity is identified via players.polity_id, not by a 'player' marker.
          owner: code,
          population: state.population || 0,
          gdp: state.gdp || 0,
          militaryPower: state.military || 0,
          objects: [...capitalObjects, ...cityObjects],
          borders: [],
          status: 'active',
          flag: code,
          metadata: {
            ideology: state.ideology,
            allies: state.allies,
            enemies: state.enemies,
            status: state.status,
          },
        };
      }
    }

    const worldId = shortId();
    const worldData = {
      id: worldId,
      name: `${preset.name} - ${new Date().toLocaleDateString()}`,
      description: preset.description || preset.base_prompt?.substring(0, 200) || '',
      startDate: worldState.date,
      // Лор пакета (lore.md) дополняет базовый промпт мира
      basePrompt: preset.base_prompt + (preset.lore ? '\n\n' + preset.lore : ''),
      historicalAccuracy: preset.historical_accuracy ?? 0.8,
      // Этап 5: кастомные правила симуляции пресета (rules.md) едут с миром
      simulationRules: preset.simulation_rules ?? null,
      // Переопределённые промпты ИИ пресета (секция "prompts") едут с миром
      prompts: preset.prompts ? JSON.stringify(preset.prompts) : null,
    };

    // Convert regionsObj to array and use createWithRegions (which wraps in transaction)
    // Prefix region IDs with worldId to ensure global uniqueness (since id is PRIMARY KEY)
    // Borders are computed from actual geometry (turf) once, here — the NPC
    // expansion logic depends on them to only spread into adjacent regions.
    const templateCodes = Object.keys(regionsObj);
    const bordersMap = computeBorders(
      Object.fromEntries(
        templateCodes
          .filter(code => geojsonFeatures[code])
          .map(code => [code, geojsonFeatures[code].geometry ?? geojsonFeatures[code]])
      )
    );

    const regionsArray = Object.entries(regionsObj).map(([code, region]) => ({
      id: `${worldId}_${code}`,
      worldId,
      name: region.name,
      geojson: region.geojson,
      color: region.color,
      owner: region.owner,
      population: region.population,
      gdp: region.gdp,
      militaryPower: region.militaryPower,
      flag: region.flag,
      // Этап 4: маркеры на карте (столица), иначе addRegion их не увидит
      objects: region.objects ?? [],
      // GameSession keys regions by full id — store borders in the same id space
      borders: (bordersMap[code] ?? []).map(c => `${worldId}_${c}`),
    }));

    worldRepository.createWithRegions(worldData, regionsArray);

    // Persist diplomatic relationships from Balance Agent allies/enemies
    const relEntries: { from: string; to: string; type: 'ally' | 'hostile' }[] = [];
    for (const [code, state] of worldState.countries) {
      for (const allyCode of state.allies || []) {
        relEntries.push({ from: code, to: allyCode, type: 'ally' });
      }
      for (const enemyCode of state.enemies || []) {
        relEntries.push({ from: code, to: enemyCode, type: 'hostile' });
      }
    }
    if (relEntries.length > 0) {
      relationshipRepository.initForWorld(worldId, relEntries);
    }

    // Fase finale per la UI: bordi + persistenza (rapida ma non istantanea)
    setWorldGenProgress(
      jobId,
      worldState.countries.size,
      worldState.countries.size,
      'Definizione della geografia…'
    );

    return {
      templateId,
      worldId,
      date: worldState.date,
      // Il client caricherà la mappa una sola volta da GET /games/:id.
      // Prima duplicavamo qui l'intero GeoJSON (fino a 942 province), causando
      // un download e un JSON.parse superflui durante la schermata di attesa.
      countries: {},
      regions: {},
      // Serve al client soltanto la regione iniziale del paese selezionato,
      // non la tabella di oltre mille ID dell'intero mondo.
      regionIds: {
        [playerCountryCode]: `${worldId}_${homeRegionByCountry[playerCountryCode] || playerCountryCode}`,
      },
      playerCountryCode,
    };
  } catch (e: any) {
    console.error('[Generate World] Error:', e);
    throw e;
  }
}

worldsRouter.post('/generate', async (req, res) => {
  const { templateId, playerCountryCode } = req.body;

  if (!templateId || !playerCountryCode) {
    res.status(400).json({ error: 'templateId and playerCountryCode are required' });
    return;
  }

  // Этап 5: пресет-пакет (data/presets/<id>/) или легаси-шаблон
  // (data/templates/<id>.json). loadPreset валидирует id через PRESET_ID_RE,
  // поэтому path traversal исключён без resolveInside.
  const preset = loadPreset(templateId);
  if (!preset) {
    res.status(404).json({ error: `Preset not found: ${templateId}` });
    return;
  }

  // Retrocompatibilità: { sync: true } ripristina la vecchia esecuzione
  // dentro la richiesta (utile per script/curl; NON usarla dietro tunnel).
  if (req.body.sync === true) {
    const job = createWorldGenJob();
    try {
      const result = await runWorldGeneration(job.id, templateId, preset, playerCountryCode);
      updateWorldGenJob(job.id, { status: 'completed', result });
      res.json(result);
    } catch (e: any) {
      updateWorldGenJob(job.id, { status: 'failed', error: e?.message });
      res.status(500).json({ error: 'Failed to generate world: ' + e.message });
    }
    return;
  }

  const job = createWorldGenJob();
  // Risposta immediata: la richiesta HTTP dura pochi millisecondi, il
  // timeout del tunnel non è più raggiungibile.
  res.status(202).json({ jobId: job.id, status: job.status });

  // Fire and forget: gli errori finiscono sul job e vengono letti via polling.
  void runWorldGeneration(job.id, templateId, preset, playerCountryCode)
    .then(result => updateWorldGenJob(job.id, { status: 'completed', result }))
    .catch(e => {
      console.error('[Generate World] Job error:', e);
      updateWorldGenJob(job.id, { status: 'failed', error: e?.message ?? String(e) });
    });
});

// Stato/progresso del job di generazione. Quando status="completed" il
// campo `result` contiene lo stesso payload della vecchia risposta sincrona.
worldsRouter.get('/jobs/:jobId', (req, res) => {
  const job = getWorldGenJob(req.params.jobId);
  if (!job) {
    res.status(404).json({ error: 'Job not found' });
    return;
  }
  res.json(job);
});

worldsRouter.post('/', (req, res) => {
  const { name, description, startDate, basePrompt, historicalAccuracy = 0.8 } = req.body;

  const world = {
    id: shortId(),
    name,
    description,
    startDate: startDate || '1951-01-01',
    basePrompt: basePrompt || 'Storia alternativa',
    historicalAccuracy,
  };

  worldRepository.create(world);
  res.json({ id: world.id, name: world.name });
});

worldsRouter.get('/:id', (req, res) => {
  const world = worldRepository.findById(req.params.id);
  if (!world) {
    res.status(404).json({ error: 'World not found' });
    return;
  }
  res.json({
    id: world.id,
    name: world.name,
    description: world.description,
    startDate: world.start_date,
    basePrompt: world.base_prompt,
    historicalAccuracy: world.historical_accuracy,
    createdAt: world.created_at,
    updatedAt: world.updated_at,
    regions: world.regions.reduce((acc: any, r: any) => { acc[r.id] = r; return acc; }, {}),
  });
});

worldsRouter.patch('/:id/prompt', (req, res) => {
  const world = worldRepository.findById(req.params.id);
  if (!world) {
    res.status(404).json({ error: 'World not found' });
    return;
  }

  const { basePrompt } = req.body;
  if (typeof basePrompt !== 'string') {
    res.status(400).json({ error: 'basePrompt must be a string' });
    return;
  }

  worldRepository.update(req.params.id, { basePrompt });
  getLLMRouter().clearCache(); // Invalidate cached narrations when world prompt changes
  res.json({ success: true, basePrompt });
});

worldsRouter.post('/:id/regions', (req, res) => {
  const world = worldRepository.findById(req.params.id);
  if (!world) {
    res.status(404).json({ error: 'World not found' });
    return;
  }

  const { id, name, svgPath, color = '#888888' } = req.body;

  worldRepository.addRegion({
    id,
    worldId: req.params.id,
    name,
    svgPath,
    color,
  });
  res.json({ id, name });
});

worldsRouter.post('/from-map', (req, res) => {
  const { mapId, name, description, startDate, basePrompt, historicalAccuracy, initialOwners } = req.body;
  console.log('[DEBUG] from-map request, mapId:', mapId, 'name:', name);

  const mapRepository = require('../repositories').mapRepository;
  const map = mapRepository.findById(mapId);
  if (!map) {
    console.log('[DEBUG] Map not found in DB, checking all maps...');
    const allMaps = mapRepository.findAll?.() || [];
    console.log('[DEBUG] Available maps:', allMaps);
    res.status(404).json({ error: 'Map not found', mapId });
    return;
  }
  console.log('[DEBUG] Map found:', map.name);

  const worldId = shortId();

  const ownerMap = new Map<string, string>();
  if (initialOwners && Array.isArray(initialOwners)) {
    for (const owner of initialOwners) {
      ownerMap.set(owner.id, owner.owner);
    }
  }

  const regions = map.regions.map((r: any, index: number) => {
    const owner = ownerMap.get(r.id) || 'neutral';
    const regionId = `${worldId}_r${index}_${shortId()}`;

    let militaryPower = 100;
    let population = 1000000;
    let gdp = 100;

    if (owner === 'player') {
      militaryPower = 150;
      population = 1500000;
      gdp = 150;
    } else if (owner.startsWith('ai-')) {
      militaryPower = 80 + Math.floor(Math.random() * 80);
      population = 800000 + Math.floor(Math.random() * 400000);
      gdp = 80 + Math.floor(Math.random() * 80);
    }

    const geojson = svgPathToGeoJSON(r.path, { width: map.width || 2000, height: map.height || 1500 });

    return {
      id: regionId,
      name: r.name,
      svgPath: r.path,
      geojson: geojson ? JSON.stringify(geojson) : undefined,
      color: r.color,
      owner,
      population,
      gdp,
      militaryPower,
      // Кодов стран на кастомной карте нет — столицы не сидируем, объекты пустые
      objects: [],
    };
  });

  // Borders from converted SVG geometry — same NPC-expansion dependency as in /generate
  const bordersById = computeBorders(
    Object.fromEntries(
      regions
        .filter((r: any) => r.geojson)
        .map((r: any) => {
          try {
            const gj = JSON.parse(r.geojson);
            return [r.id, gj.geometry ?? gj];
          } catch {
            return null;
          }
        })
        .filter((entry: [string, any] | null): entry is [string, any] => entry !== null)
    )
  );
  for (const r of regions) {
    (r as any).borders = bordersById[r.id] ?? [];
  }

  worldRepository.createWithRegions({
    id: worldId,
    name: name || map.name,
    description: description || '',
    startDate: startDate || '1951-01-01',
    basePrompt: basePrompt || 'Storia alternativa',
    historicalAccuracy: historicalAccuracy ?? 0.8,
  }, regions);

  res.json({
    world_id: worldId,
    name: name || map.name,
    regions_count: regions.length,
    regions: regions.map((r: any) => ({
      id: r.id,
      name: r.name,
      color: r.color,
      owner: r.owner,
    })),
  });
});
