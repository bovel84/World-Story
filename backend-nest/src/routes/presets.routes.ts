/**
 * World Story — Presets Routes (Этап 5)
 * ==================================
 * Импорт/экспорт пресет-пакетов zip + отдача флагов пресетов.
 * Монтируется на /api/templates ПОСЛЕ templatesRouter
 * (пути не пересекаются: у templatesRouter только '/' и '/:id').
 */

import express, { Router } from 'express';
import fs from 'fs';
import path from 'path';
import { buildPresetZip, importPresetZip, PresetZipError } from '../utils/preset-zip';
import { loadSimulationCatalog } from '../scenario/loader';
import {
  getPresetFlagPath, loadPreset, PRESETS_DIR, PRESET_ID_RE, validatePresetJson,
} from '../utils/preset-loader';
import { getLLMRouter } from '../llm';
import { parseJsonLoose } from '../utils/json-repair';
import { LLMError } from '../llm/types';

export const presetsRouter = Router();

function presetPayload(preset: any) {
  return {
    id: preset.id,
    name: preset.name,
    description: preset.description,
    start_date: preset.start_date,
    country_codes: preset.country_codes,
    base_prompt: preset.base_prompt,
    historical_accuracy: preset.historical_accuracy ?? 0.8,
    countries: preset.countries,
    country_colors: preset.country_colors,
    prompts: preset.prompts,
    lore: preset.lore || '',
    simulation_rules: preset.simulation_rules || '',
    source: preset.source,
    has_custom_map: preset.has_custom_map,
    author: preset.author || '',
    version: preset.version || '',
  };
}

export type AiPresetDraft = {
  id?: string;
  name?: string;
  description?: string;
  start_date?: string;
  country_codes?: string[];
  base_prompt?: string;
  historical_accuracy?: number;
  lore?: string;
  simulation_rules?: string;
};

function clipped(value: unknown, max: number): string {
  return String(value || '').trim().slice(0, max);
}

export function normalizeAiPreset(raw: any, previous: AiPresetDraft): AiPresetDraft {
  const source = raw?.preset && typeof raw.preset === 'object' ? raw.preset : raw;
  if (!source || typeof source !== 'object' || Array.isArray(source)) {
    throw new Error('La risposta IA non contiene una bozza di scenario');
  }
  const name = clipped(source.name ?? source.nome ?? previous.name, 120);
  const suggestedId = clipped(source.id, 64).toLowerCase().replace(/[^a-z0-9_-]+/g, '_').replace(/^[_-]+|[_-]+$/g, '');
  const fallbackId = name.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 64);
  const rawCodes = source.country_codes ?? source.countryCodes ?? source.paesi_giocabili ?? previous.country_codes;
  const countryCodes = (Array.isArray(rawCodes) ? rawCodes : String(rawCodes || '').split(/[\s,;]+/))
    .map((code: unknown) => String(code || '').trim().toUpperCase())
    .filter((code: string, index: number, all: string[]) => /^[A-Z]{3}$/.test(code) && all.indexOf(code) === index)
    .slice(0, 80);
  const date = clipped(source.start_date ?? source.startDate ?? source.data_iniziale ?? previous.start_date, 10);
  const accuracyRaw = Number(source.historical_accuracy ?? source.historicalAccuracy ?? previous.historical_accuracy ?? 0.8);
  const result: AiPresetDraft = {
    id: PRESET_ID_RE.test(suggestedId) ? suggestedId : (PRESET_ID_RE.test(fallbackId) ? fallbackId : previous.id),
    name,
    description: clipped(source.description ?? source.presentazione ?? previous.description, 800),
    start_date: /^\d{4}-\d{2}-\d{2}$/.test(date) ? date : (previous.start_date || '1951-01-01'),
    country_codes: countryCodes,
    base_prompt: clipped(source.base_prompt ?? source.basePrompt ?? source.premessa ?? previous.base_prompt, 6_000),
    historical_accuracy: Number.isFinite(accuracyRaw) ? Math.max(0, Math.min(1, accuracyRaw)) : 0.8,
    lore: clipped(source.lore ?? source.dossier_storico ?? previous.lore, 12_000),
    simulation_rules: clipped(source.simulation_rules ?? source.simulationRules ?? source.regole ?? previous.simulation_rules, 8_000),
  };
  if (!result.name || !result.base_prompt || !result.country_codes?.length) {
    throw new Error('La bozza IA è incompleta: servono nome, premessa e paesi giocabili');
  }
  return result;
}

function writeAtomic(file: string, content: string): void {
  const tmp = `${file}.tmp-${process.pid}`;
  fs.writeFileSync(tmp, content);
  fs.renameSync(tmp, file);
}

function savePreset(id: string, body: any, create: boolean): any {
  if (!PRESET_ID_RE.test(id)) throw new Error('ID preset non valido');
  const dir = path.join(PRESETS_DIR, id);
  if (create && fs.existsSync(path.join(dir, 'preset.json'))) {
    const e: any = new Error('Esiste già un preset con questo ID');
    e.code = 'EXISTS';
    throw e;
  }

  const previous = loadPreset(id);
  const raw = {
    id,
    name: body.name ?? previous?.name,
    description: body.description ?? previous?.description ?? '',
    start_date: body.start_date ?? previous?.start_date ?? '1951-01-01',
    country_codes: body.country_codes ?? previous?.country_codes,
    base_prompt: body.base_prompt ?? previous?.base_prompt,
    historical_accuracy: body.historical_accuracy ?? previous?.historical_accuracy ?? 0.8,
    countries: body.countries ?? previous?.countries,
    country_colors: body.country_colors ?? previous?.country_colors,
    prompts: body.prompts ?? previous?.prompts,
    author: body.author ?? previous?.author,
    version: body.version ?? previous?.version,
  };
  const valid = validatePresetJson(raw, `preset ${id}`);
  fs.mkdirSync(dir, { recursive: true });

  const json: any = { ...valid };
  for (const key of Object.keys(json)) if (json[key] === undefined) delete json[key];
  writeAtomic(path.join(dir, 'preset.json'), JSON.stringify(json, null, 2) + '\n');

  const textFiles: [string, string][] = [['lore', 'lore.md'], ['simulation_rules', 'rules.md']];
  for (const [field, filename] of textFiles) {
    if (!Object.prototype.hasOwnProperty.call(body, field)) continue;
    const value = typeof body[field] === 'string' ? body[field].trim() : '';
    const file = path.join(dir, filename);
    if (value) writeAtomic(file, value + '\n');
    else fs.rmSync(file, { force: true });
  }

  if (Object.prototype.hasOwnProperty.call(body, 'map_geojson')) {
    const value = body.map_geojson;
    const file = path.join(dir, 'map.geojson');
    if (value === null || value === '') {
      fs.rmSync(file, { force: true });
    } else {
      const map = typeof value === 'string' ? JSON.parse(value) : value;
      if (!map || map.type !== 'FeatureCollection' || !Array.isArray(map.features)) {
        throw new Error('map_geojson deve essere una FeatureCollection GeoJSON');
      }
      for (const feature of map.features) {
        if (!feature?.properties?.code || !feature?.geometry) {
          throw new Error('Ogni feature della mappa richiede properties.code e geometry');
        }
      }
      writeAtomic(file, JSON.stringify(map));
    }
  }
  return loadPreset(id);
}

// POST /api/templates/assist — prepara una bozza rivedibile, senza salvarla.
presetsRouter.post('/assist', async (req, res) => {
  const brief = clipped(req.body?.brief, 4_000);
  const current = (req.body?.draft && typeof req.body.draft === 'object' ? req.body.draft : {}) as AiPresetDraft;
  const currentExcerpt: AiPresetDraft = {
    id: clipped(current.id, 64), name: clipped(current.name, 120),
    description: clipped(current.description, 800), start_date: clipped(current.start_date, 10),
    country_codes: Array.isArray(current.country_codes) ? current.country_codes.slice(0, 80) : [],
    base_prompt: clipped(current.base_prompt, 6_000), historical_accuracy: current.historical_accuracy,
    lore: clipped(current.lore, 12_000), simulation_rules: clipped(current.simulation_rules, 8_000),
  };
  if (!brief && !currentExcerpt.name && !currentExcerpt.base_prompt) {
    res.status(400).json({ error: 'Descrivi lo scenario o compila almeno nome e premessa.' });
    return;
  }

  const system = `Sei un curatore di scenari storico-strategici. Trasforma l'idea dell'autore in una bozza coerente e modificabile. Scrivi in italiano. Non produrre spiegazioni, markdown o dati tecnici del motore: restituisci soltanto JSON.`;
  const basePrompt = `Crea o migliora un preset di World Story. Non salvare nulla: l'autore revisionerà la bozza.
- Conserva le idee già presenti; completa le lacune senza cambiare arbitrariamente epoca o conflitto.
- Usa una data YYYY-MM-DD e codici paese ISO-A3 reali.
- "base_prompt" descrive la situazione canonica al giorno iniziale.
- "lore" espone alleanze, conflitti, attori, risorse e questioni aperte.
- "simulation_rules" contiene 5-10 regole concrete di plausibilità, tempi e comportamento degli attori, non istruzioni sul JSON.
- Non inventare precisione documentaria: quando il brief è alternativo, distingui chiaramente la premessa immaginaria dai fatti storici precedenti.
- historical_accuracy è tra 0 e 1.

IDEA DELL'AUTORE:
${brief || '(migliora i campi esistenti)'}

BOZZA CORRENTE:
${JSON.stringify(currentExcerpt)}

Rispondi SOLO con:
{"id":"slug","name":"...","description":"...","start_date":"YYYY-MM-DD","country_codes":["ITA"],"base_prompt":"...","historical_accuracy":0.8,"lore":"...","simulation_rules":"..."}`;

  let lastError: unknown;
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const user = attempt === 0
        ? basePrompt
        : `${basePrompt}\n\n[CORREZIONE FORMATO] La risposta precedente non era una bozza JSON completa. Restituisci un singolo oggetto con tutti i campi richiesti.`;
      const response = await getLLMRouter().generate('advisor', system, user, {
        temperature: attempt === 0 ? 0.35 : 0.1,
        maxTokens: 2_600,
        jsonMode: true,
      });
      const preset = normalizeAiPreset(parseJsonLoose(response.content, { mechanic: 'presets' }), currentExcerpt);
      res.json({ preset });
      return;
    } catch (error) {
      lastError = error;
    }
  }
  const message = lastError instanceof LLMError
    ? lastError.message
    : lastError instanceof Error ? lastError.message : 'risposta non valida';
  res.status(424).json({ error: `L’assistente IA non ha prodotto una bozza utilizzabile: ${message}` });
});

// POST /api/templates — crea un preset modificabile
presetsRouter.post('/', (req, res) => {
  try {
    const id = String(req.body?.id || '').trim().toLowerCase();
    const preset = savePreset(id, req.body || {}, true);
    res.status(201).json({ template: presetPayload(preset) });
  } catch (e: any) {
    res.status(e?.code === 'EXISTS' ? 409 : 400).json({ error: e?.message || 'Preset non valido' });
  }
});

// GET /api/templates/:id/edit — contenuto completo per l'editor
presetsRouter.get('/:id/edit', (req, res) => {
  const preset = loadPreset(req.params.id);
  if (!preset) return void res.status(404).json({ error: 'Preset non trovato' });
  let mapGeojson: any = null;
  const mapFile = path.join(PRESETS_DIR, req.params.id, 'map.geojson');
  try { if (fs.existsSync(mapFile)) mapGeojson = JSON.parse(fs.readFileSync(mapFile, 'utf8')); } catch { /* già segnalato dal loader */ }
  res.json({ ...presetPayload(preset), map_geojson: mapGeojson });
});

// PUT /api/templates/:id — modifica (un legacy diventa un pacchetto sovrascrivente)
presetsRouter.put('/:id', (req, res) => {
  try {
    if (!loadPreset(req.params.id)) return void res.status(404).json({ error: 'Preset non trovato' });
    const preset = savePreset(req.params.id, req.body || {}, false);
    res.json({ template: presetPayload(preset) });
  } catch (e: any) {
    res.status(400).json({ error: e?.message || 'Preset non valido' });
  }
});

// GET /api/templates/:id/scenario — rapporto del catalogo simulation/ per
// l'editor (M01 µ4): checklist, errori per campo, copertura, impronta.
presetsRouter.get('/:id/scenario', (req, res) => {
  const preset = loadPreset(req.params.id);
  if (!preset) return void res.status(404).json({ error: 'Preset non trovato' });
  const { catalog, report } = loadSimulationCatalog(path.join(PRESETS_DIR, req.params.id));
  const hasCatalog = catalog !== null || report.warnings.every(w => w.code !== 'no_catalog');
  res.json({
    presetId: req.params.id,
    hasCatalog,
    report: hasCatalog ? report : null,
  });
});

// GET /api/templates/:id/export — скачать пресет-пакет как zip
presetsRouter.get('/:id/export', (req, res) => {
  const buf = buildPresetZip(req.params.id);
  if (!buf) {
    res.status(404).json({ error: 'Preset non trovato' });
    return;
  }
  res.setHeader('Content-Type', 'application/zip');
  res.setHeader('Content-Disposition', `attachment; filename="${req.params.id}.openpax.zip"`);
  res.send(buf);
});

// POST /api/templates/import?overwrite=1 — импорт пресет-пакета из zip.
// express.raw только на этом роуте (общий лимит 50MB проверяется здесь).
presetsRouter.post(
  '/import',
  express.raw({ type: ['application/zip', 'application/octet-stream'], limit: '50mb' }),
  (req, res) => {
    if (!Buffer.isBuffer(req.body) || req.body.length === 0) {
      res.status(400).json({ error: 'Il corpo della richiesta deve essere un archivio zip (Content-Type: application/zip)' });
      return;
    }
    try {
      const { preset } = importPresetZip(req.body, { overwrite: req.query.overwrite === '1' });
      res.status(201).json({
        template: {
          id: preset.id,
          name: preset.name,
          description: preset.description,
          start_date: preset.start_date,
          country_count: preset.country_codes.length,
        },
      });
    } catch (e: any) {
      if (e instanceof PresetZipError) {
        // INVALID_ZIP / INVALID_PRESET → 400, EXISTS → 409
        res.status(e.code === 'EXISTS' ? 409 : 400).json({ error: e.message });
        return;
      }
      console.error('[Presets] Ошибка импорта:', e);
      res.status(500).json({ error: 'Errore interno durante l\'importazione del preset' });
    }
  },
);

// GET /api/templates/:id/flags/:file — файл флага пресета
presetsRouter.get('/:id/flags/:file', (req, res) => {
  const p = getPresetFlagPath(req.params.id, req.params.file);
  if (!p) {
    res.status(404).json({ error: 'Bandiera non trovata' });
    return;
  }
  res.sendFile(p);
});
