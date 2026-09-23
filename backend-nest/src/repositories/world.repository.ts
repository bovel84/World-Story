/**
 * World Story — World Repository
 * ===========================
 */

import db from '../database';
import { enrichGeographicObjects, getCapitalsRegistry } from '../utils/cities';
import { coastalFromGeojson } from '../core/simulation/NationCapacity';
import { largestRingCentroid } from '../utils/geo';
import { loadNativeMap, resolveMapSource, NATIVE_MAPS } from '../utils/native-maps';
import { loadPreset, loadPresetMap } from '../utils/preset-loader';

// Migrazione lazy: ogni mondo viene arricchito una volta per processo e salvato.
const geoObjectsHydratedWorlds = new Set<string>();

/**
 * BUG 3 — template (preset) a cui un mondo è legato, o null per i mondi
 * legacy. Chiave di cache per la risoluzione della mappa nativa della capitale.
 */
function worldTemplateId(worldId: string): string | null {
  const row = db.prepare('SELECT template_id AS t FROM worlds WHERE id = ?').get(worldId) as { t?: string | null } | undefined;
  return row && typeof row.t === 'string' && row.t ? row.t : null;
}

/**
 * BUG 3 — codici delle province-capitale della **mappa reale** del mondo.
 * Identifica la mappa confrontando i codici delle province del mondo con le
 * mappe native: la sorgente geometrica del template è il candidato preferito
 * (via `resolveMapSource`), ma un mondo può essere stato generato su un'altra
 * mappa, quindi si sceglie quella con più codici combacianti (map-agnostico).
 * `properties.is_capital === true` segna le province-capitale. In cache per
 * template: la mappa non cambia a runtime e il GeoJSON Pax pesa 7 MB.
 */
const nativeCapitalCodesCache = new Map<string, ReadonlySet<string>>();

function nativeCapitalCodes(templateId: string | null, provinceCodes: string[]): ReadonlySet<string> {
  const key = templateId || '__no_template__';
  const cached = nativeCapitalCodesCache.get(key);
  if (cached) return cached;

  const needed = new Set(provinceCodes.filter(Boolean));
  const candidates: Array<{ features?: any[] }> = [];
  const seen = new Set<string>();

  const preset = templateId ? loadPreset(templateId) : null;
  if (preset) {
    const source = resolveMapSource({ hasCustomMap: preset.has_custom_map, mapBase: preset.map_base });
    const map = source.kind === 'preset' ? loadPresetMap(templateId!) : loadNativeMap(source.id);
    if (map?.features) {
      candidates.push(map);
      if (source.kind === 'native') seen.add(source.id);
    }
  }
  for (const def of NATIVE_MAPS) {
    if (seen.has(def.id)) continue;
    seen.add(def.id);
    const map = loadNativeMap(def.id);
    if (map?.features) candidates.push(map);
  }

  // Mappa con più codici di provincia del mondo → è quella reale del mondo.
  let best: { features?: any[] } | null = null;
  let bestScore = 0;
  for (const cand of candidates) {
    let score = 0;
    for (const feature of featuresList(cand)) if (needed.has(featureCode(feature))) score++;
    if (score > bestScore) { bestScore = score; best = cand; }
  }

  const capitals = new Set<string>();
  if (best && bestScore > 0) {
    for (const feature of featuresList(best)) {
      const props = (feature?.properties || {}) as Record<string, unknown>;
      if (props.is_capital === true) { const code = String(props.code || ''); if (code) capitals.add(code); }
    }
  }
  nativeCapitalCodesCache.set(key, capitals);
  return capitals;
}

function featuresList(map: { features?: any[] }): any[] {
  return map?.features || [];
}

function featureCode(feature: any): string {
  const code = (feature?.properties || {})?.code;
  return typeof code === 'string' ? code : '';
}


export interface WorldRecord {
  id: string;
  name: string;
  description: string;
  start_date: string;
  base_prompt: string;
  historical_accuracy: number;
  /** Этап 5: кастомные правила симуляции пресета (rules.md) */
  simulation_rules: string | null;
  /** Переопределённые промпты ИИ мира (секция "prompts" пресета, JSON) */
  prompts: string | null;
  /** M01 passo 4 (MAT18): impronta di contenuto del catalogo simulation/; NULL per i mondi legacy. */
  catalog_fingerprint: string | null;
  created_at: string;
  updated_at: string;
}

export interface RegionRecord {
  id: string;
  name: string;
  svgPath: string;
  geojson?: string;
  color: string;
  owner: string;
  population: number;
  gdp: number;
  militaryPower: number;
  borders: string[];
  objects: any[];
  status: string;
  metadata?: Record<string, any>;
  flag?: string;
  /** Provincia con sbocco al mare: dedotta una volta dal GeoJSON. */
  coastal: boolean;
}

export const worldRepository = {
  create: (world: { id: string; name: string; description?: string; startDate?: string; basePrompt?: string; historicalAccuracy?: number; simulationRules?: string | null; prompts?: string | null; catalogFingerprint?: string | null; templateId?: string | null }) => {
    const stmt = db.prepare(`
      INSERT INTO worlds (id, name, description, start_date, base_prompt, historical_accuracy, simulation_rules, prompts, catalog_fingerprint, template_id)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    stmt.run(
      world.id,
      world.name,
      world.description || '',
      world.startDate || '1951-01-01',
      world.basePrompt || 'Storia alternativa',
      world.historicalAccuracy ?? 0.8,
      // Этап 5: правила симуляции пресета (NULL для обычных миров)
      world.simulationRules ?? null,
      // Переопределённые промпты пресета (JSON-строка; NULL — дефолтные промпты)
      world.prompts ?? null,
      // M01 passo 4 (MAT18): impronta del catalogo di scenario; NULL per i mondi legacy
      world.catalogFingerprint ?? null,
      // M03 µ4-bis: il server carica solo questo preset, mai un catalogo body.
      world.templateId ?? null
    );
    return world;
  },

  findById: (id: string): (WorldRecord & { regions: RegionRecord[] }) | null => {
    const stmt = db.prepare('SELECT * FROM worlds WHERE id = ?');
    const row = stmt.get(id) as any;
    if (!row) return null;

    const regions = worldRepository.getRegions(id);
    return {
      ...row,
      regions,
    };
  },

  /** MAP P6 — solo gli id delle regioni: lettura pura, senza idratazione degli oggetti. */
  regionIds: (worldId: string): string[] => (db.prepare('SELECT id FROM world_regions WHERE world_id = ? ORDER BY id').all(worldId) as Array<{ id: string }>)
    .map(row => row.id),

  /**
   * BUG 3 — fatti di ancoraggio di ogni regione del mondo: id, paese (ISO3) e
   * capitale. Lettura **pura** (nessuna idratazione di oggetti, nessuna
   * scrittura), ordinata per id: la stessa che usa il layer Risorse per
   * collocare i beni del catalogo quando i codici non combaciano con la mappa.
   *
   * Il paese è quello **geografico originario** (`flag`, verificato ISO3): una
   * provincia conquistata cambia `owner`, non il paese. Non si legge mai
   * `metadata` — nessun writer popola la colonna.
   *
   * La capitale viene dalla **mappa nativa reale** del mondo
   * (`properties.is_capital` via `resolveMapSource` + `loadNativeMap`): la
   * mappa è identificata confrontando i codici delle province del mondo con le
   * mappe native (map-agnostico), con la sorgente del template come candidato
   * preferito. Il risultato è in cache per template.
   */
  regionFacts: (worldId: string): Array<{ id: string; country: string; isCapital: boolean }> => {
    const rows = db.prepare('SELECT id, flag FROM world_regions WHERE world_id = ? ORDER BY id').all(worldId) as any[];
    const templateId = worldTemplateId(worldId);
    const prefix = worldId.length + 1;
    const codes = rows.map(row => String(row.id).slice(prefix));
    const capitalCodes = nativeCapitalCodes(templateId, codes);
    return rows.map(row => {
      const flag = String(row.flag || '').trim().toUpperCase();
      return {
        id: row.id,
        country: /^[A-Z]{3}$/.test(flag) ? flag : '',
        isCapital: capitalCodes.has(String(row.id).slice(prefix)),
      };
    });
  },

  getRegions: (worldId: string): RegionRecord[] => {
    const stmt = db.prepare('SELECT * FROM world_regions WHERE world_id = ?');
    const rows = stmt.all(worldId) as any[];

    // Vecchi salvataggi: aggiunge capitale e tutte le città principali con
    // coordinate reali. Usiamo flag (paese geografico originario), non owner:
    // una provincia conquistata resta geograficamente nello stesso paese.
    if (!geoObjectsHydratedWorlds.has(worldId)) {
      const updateObjects = db.prepare('UPDATE world_regions SET objects = ? WHERE id = ?');
      const hydrate = db.transaction(() => {
        for (const row of rows) {
          if (!row.geojson) continue;
          try {
            const feature = JSON.parse(row.geojson);
            const geometry = feature?.geometry ?? feature;
            const countryCode = String(row.flag || row.owner || '').toUpperCase();
            const oldObjects = JSON.parse(row.objects || '[]');
            const metadata = JSON.parse(row.metadata || '{}');
            const objects = enrichGeographicObjects(oldObjects, geometry, countryCode, Boolean(metadata.pax_region_id));
            const serialized = JSON.stringify(objects);
            if (serialized !== JSON.stringify(oldObjects)) {
              row.objects = serialized;
              updateObjects.run(serialized, row.id);
            }
          } catch { /* geometria/oggetti corrotti: conserva lo stato esistente */ }
        }

        // Garanzia finale: ogni nazione ISO ha almeno la sua capitale. Alcune
        // mappe storiche hanno bordi approssimati e il punto reale può cadere
        // appena fuori da tutti i poligoni; in quel caso associamo il marker
        // alla provincia col centroide più vicino, mantenendo lat/lng reali.
        const byCountry = new Map<string, any[]>();
        for (const row of rows) {
          const code = String(row.flag || row.owner || '').toUpperCase();
          if (/^[A-Z]{3}$/.test(code)) (byCountry.get(code) || (byCountry.set(code, []), byCountry.get(code)!)).push(row);
        }
        for (const [code, countryRows] of byCountry) {
          const hasGeoObject = countryRows.some(row => {
            try { return JSON.parse(row.objects || '[]').some((o: any) => o.type === 'city' || o.type === 'capital'); }
            catch { return false; }
          });
          const cap = getCapitalsRegistry()[code];
          if (hasGeoObject || !cap) continue;
          let nearest: any = null;
          let bestDistance = Infinity;
          for (const row of countryRows) {
            try {
              const feature = JSON.parse(row.geojson);
              const center = largestRingCentroid(feature?.geometry ?? feature);
              if (!center) continue;
              const distance = Math.hypot(center.lat - cap.lat, center.lng - cap.lng);
              if (distance < bestDistance) { bestDistance = distance; nearest = row; }
            } catch { /* passa alla regione successiva */ }
          }
          if (!nearest) continue;
          const objects = JSON.parse(nearest.objects || '[]');
          objects.push({ id: `cap-${code}-${worldId}`, type: 'capital', name: cap.capital, lat: cap.lat, lng: cap.lng });
          nearest.objects = JSON.stringify(objects);
          updateObjects.run(nearest.objects, nearest.id);
        }
      });
      hydrate();
      geoObjectsHydratedWorlds.add(worldId);
    }

    return rows.map(row => ({
      id: row.id,
      name: row.name,
      svgPath: row.svg_path,
      geojson: row.geojson,
      color: row.color,
      owner: row.owner,
      population: row.population,
      gdp: row.gdp,
      militaryPower: row.military_power,
      borders: JSON.parse(row.borders),
      objects: JSON.parse(row.objects || '[]'),
      status: row.status,
      metadata: JSON.parse(row.metadata || '{}'),
      flag: row.flag,
      // La costa serve alla capacità navale del paese: si legge dal GeoJSON e
      // resta in cache per id, così un tick non ri-scandisce 7 MB di mappe.
      coastal: coastalFromGeojson(row.id, row.geojson),
    }));
  },

  addRegion: (region: { id: string; worldId: string; name: string; svgPath?: string; geojson?: string; color?: string; owner?: string; population?: number; gdp?: number; militaryPower?: number; flag?: string; borders?: string[]; objects?: any[] }) => {
    const stmt = db.prepare(`
      INSERT INTO world_regions (id, world_id, name, svg_path, geojson, color, owner, population, gdp, military_power, flag, borders, objects)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    stmt.run(
      region.id,
      region.worldId,
      region.name,
      region.svgPath || '',
      region.geojson || null,
      region.color || '#888888',
      region.owner || 'neutral',
      region.population || 1000000,
      region.gdp || 100,
      region.militaryPower || 100,
      region.flag || null,
      JSON.stringify(region.borders ?? []),
      // Этап 4: маркеры на карте (столицы/города/батальоны) — иначе терялись при создании
      JSON.stringify(region.objects ?? [])
    );
    return region;
  },

  updateRegion: (regionId: string, updates: Partial<{
    name: string; color: string; owner: string; population: number; gdp: number; militaryPower: number; objects: any[]; geojson: string
  }>) => {
    const fields: string[] = [];
    const values: any[] = [];

    if (updates.name !== undefined) { fields.push('name = ?'); values.push(updates.name); }
    if (updates.color !== undefined) { fields.push('color = ?'); values.push(updates.color); }
    if (updates.owner !== undefined) { fields.push('owner = ?'); values.push(updates.owner); }
    if (updates.population !== undefined) { fields.push('population = ?'); values.push(updates.population); }
    if (updates.gdp !== undefined) { fields.push('gdp = ?'); values.push(updates.gdp); }
    if (updates.militaryPower !== undefined) { fields.push('military_power = ?'); values.push(updates.militaryPower); }
    if (updates.objects !== undefined) { fields.push('objects = ?'); values.push(JSON.stringify(updates.objects)); }
    if (updates.geojson !== undefined) { fields.push('geojson = ?'); values.push(updates.geojson); }

    if (fields.length === 0) return;

    values.push(regionId);
    const stmt = db.prepare(`UPDATE world_regions SET ${fields.join(', ')} WHERE id = ?`);
    stmt.run(...values);
  },

  update: (worldId: string, updates: Partial<{
    name: string;
    description: string;
    startDate: string;
    basePrompt: string;
    historicalAccuracy: number;
    simulationRules: string | null;
    prompts: string | null;
  }>) => {
    const fields: string[] = [];
    const values: any[] = [];

    if (updates.name !== undefined) { fields.push('name = ?'); values.push(updates.name); }
    if (updates.description !== undefined) { fields.push('description = ?'); values.push(updates.description); }
    if (updates.startDate !== undefined) { fields.push('start_date = ?'); values.push(updates.startDate); }
    if (updates.basePrompt !== undefined) { fields.push('base_prompt = ?'); values.push(updates.basePrompt); }
    if (updates.historicalAccuracy !== undefined) { fields.push('historical_accuracy = ?'); values.push(updates.historicalAccuracy); }
    if (updates.simulationRules !== undefined) { fields.push('simulation_rules = ?'); values.push(updates.simulationRules); }
    if (updates.prompts !== undefined) { fields.push('prompts = ?'); values.push(updates.prompts); }

    if (fields.length === 0) return;

    values.push(worldId);
    const stmt = db.prepare(`UPDATE worlds SET ${fields.join(', ')} WHERE id = ?`);
    stmt.run(...values);
  },

  createWithRegions: (world: { id: string; name: string; description?: string; startDate?: string; basePrompt?: string; historicalAccuracy?: number; simulationRules?: string | null; prompts?: string | null; catalogFingerprint?: string | null; templateId?: string | null }, regions: any[]) => {
    const createWorld = db.transaction(() => {
      worldRepository.create(world);
      for (const region of regions) {
        worldRepository.addRegion({
          id: region.id,
          worldId: world.id,
          name: region.name,
          svgPath: region.svgPath,
          geojson: region.geojson,
          color: region.color,
          owner: region.owner,
          population: region.population,
          gdp: region.gdp,
          militaryPower: region.militaryPower,
          flag: region.flag,
          borders: region.borders,
          // Этап 4: маркеры на карте (столицы/города/батальоны)
          objects: region.objects,
        });
      }
    });
    createWorld();
    return worldRepository.findById(world.id);
  },

  /**
   * Batch update multiple regions in a single transaction.
   * Much faster than calling updateRegion() N times.
   *
   * `owner`, `color` and `objects` are optional; if omitted, the existing
   * value is preserved (the prepared statement writes NULL, which we guard
   * with a COALESCE in the SET clause). This lets callers persist only the
   * fields that actually changed.
   */
  updateRegionsBatch: (updates: {
    id: string;
    population?: number;
    gdp?: number;
    militaryPower?: number;
    owner?: string;
    color?: string;
    objects?: any[];
  }[]) => {
    if (updates.length === 0) return;

    const stmt = db.prepare(`
      UPDATE world_regions SET
        population   = COALESCE(?, population),
        gdp          = COALESCE(?, gdp),
        military_power = COALESCE(?, military_power),
        owner        = COALESCE(?, owner),
        color        = COALESCE(?, color),
        objects      = COALESCE(?, objects)
      WHERE id = ?
    `);

    const updateAll = db.transaction((items) => {
      for (const item of items) {
        stmt.run(
          item.population ?? null,
          item.gdp ?? null,
          item.militaryPower ?? null,
          item.owner ?? null,
          item.color ?? null,
          // Этап 4: без этой строки батальоны/столицы терялись при перезагрузке
          item.objects !== undefined ? JSON.stringify(item.objects) : null,
          item.id,
        );
      }
    });

    updateAll(updates);
  },
};
