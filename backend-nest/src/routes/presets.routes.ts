/**
 * Open-Pax — Presets Routes (Этап 5)
 * ==================================
 * Импорт/экспорт пресет-пакетов zip + отдача флагов пресетов.
 * Монтируется на /api/templates ПОСЛЕ templatesRouter
 * (пути не пересекаются: у templatesRouter только '/' и '/:id').
 */

import express, { Router } from 'express';
import fs from 'fs';
import path from 'path';
import { buildPresetZip, importPresetZip, PresetZipError } from '../utils/preset-zip';
import {
  getPresetFlagPath, loadPreset, PRESETS_DIR, PRESET_ID_RE, validatePresetJson,
} from '../utils/preset-loader';

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
