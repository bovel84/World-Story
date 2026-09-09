/**
 * World Story — Preset ZIP (Этап 5)
 * ==============================
 * Импорт/экспорт пресет-пакетов в формате zip ("<id>.openpax.zip").
 *
 * Структура архива (все записи опциональны, кроме preset.json):
 *   preset.json   — обязательный, валидируется validatePresetJson
 *   rules.md      — правила симуляции
 *   lore.md       — лор мира
 *   map.geojson   — кастомная карта (валидный JSON)
 *   flags/<name>.svg|png — флаги стран
 *   simulation/*.json + simulation/sources.md — catalogo di scenario (M01):
 *     validato in memoria PRIMA di ogni scrittura; con errori bloccanti
 *     l'import strict è rifiutato con percorso e motivo (MAT01).
 *
 * Прочие записи в архиве игнорируются. Zip-slip записи (../, абсолютные
 * пути) отбрасываются. Чистые функции — роуты лишь тонкие обёртки.
 */

import fs from 'fs';
import path from 'path';
import AdmZip from 'adm-zip';
import { validateCatalog, type CatalogFiles } from '../scenario/loader';
import {
  PRESETS_DIR,
  PresetPackage,
  loadPreset,
  validatePresetJson,
} from './preset-loader';

/** Коды ошибок импорта — маппятся роутом в HTTP-статусы */
export type PresetZipErrorCode = 'INVALID_ZIP' | 'INVALID_PRESET' | 'EXISTS';

export class PresetZipError extends Error {
  readonly code: PresetZipErrorCode;
  constructor(code: PresetZipErrorCode, message: string) {
    super(message);
    this.name = 'PresetZipError';
    this.code = code;
  }
}

/** Корневые файлы пакета, разрешённые в архиве */
const ALLOWED_ROOT_FILES = new Set(['preset.json', 'rules.md', 'lore.md', 'map.geojson']);

/** Нормализация имени zip-записи: прямые слеши, без ведущего "./" */
function normalizeEntryName(name: string): string {
  return name.replace(/\\/g, '/').replace(/^(\.\/)+/, '');
}

/** Имя записи безопасно для извлечения внутрь каталога пресета? */
function isSafeEntryName(name: string): boolean {
  if (name.includes('..')) return false;
  if (name.startsWith('/') || path.isAbsolute(name)) return false;
  return true;
}

/**
 * Собрать zip-пакет пресета по id.
 * Для пакета — файлы с диска; для легаси-шаблона — синтезируем архив
 * только с preset.json (поля из loadPreset). null, если пресет не найден.
 */
export function buildPresetZip(id: string): Buffer | null {
  const preset = loadPreset(id);
  if (!preset) return null;

  const zip = new AdmZip();

  if (preset.source === 'legacy') {
    // Легаси-шаблон: синтезируем preset.json из загруженных полей
    const json: Record<string, unknown> = {
      id: preset.id,
      name: preset.name,
      description: preset.description,
      start_date: preset.start_date,
      country_codes: preset.country_codes,
      base_prompt: preset.base_prompt,
    };
    if (preset.historical_accuracy !== undefined) json.historical_accuracy = preset.historical_accuracy;
    if (preset.countries !== undefined) json.countries = preset.countries;
    if (preset.author !== undefined) json.author = preset.author;
    if (preset.version !== undefined) json.version = preset.version;
    zip.addFile('preset.json', Buffer.from(JSON.stringify(json, null, 2), 'utf-8'));
    return zip.toBuffer();
  }

  // Пакет: читаем файлы из data/presets/<id>
  const dir = path.join(PRESETS_DIR, preset.id);
  const addIfExists = (file: string, entryName = file) => {
    const p = path.join(dir, file);
    try {
      if (fs.existsSync(p)) zip.addFile(entryName, fs.readFileSync(p));
    } catch { /* не читается — пропускаем */ }
  };

  addIfExists('preset.json');
  addIfExists('rules.md');
  addIfExists('lore.md');
  addIfExists('map.geojson');
  // M01 µ4: il catalogo simulation/ viaggia con il pacchetto (esportato e
  // reimportabile senza perdita).
  try {
    const simDir = path.join(dir, 'simulation');
    if (fs.existsSync(simDir)) {
      for (const file of fs.readdirSync(simDir)) {
        if (/\.(json|md)$/i.test(file)) addIfExists(path.join('simulation', file));
      }
    }
  } catch { /* nessun catalogo */ }
  for (const flag of preset.flags) {
    addIfExists(path.join('flags', flag), `flags/${flag}`);
  }
  return zip.toBuffer();
}

/**
 * Импортировать пресет из zip-буфера.
 * id пресета берётся из preset.json (НЕ из имени архива).
 * Бросает PresetZipError с кодом INVALID_ZIP / INVALID_PRESET / EXISTS.
 */
export function importPresetZip(
  buffer: Buffer,
  opts: { overwrite?: boolean } = {},
): { preset: PresetPackage } {
  let zip: AdmZip;
  try {
    zip = new AdmZip(buffer);
  } catch {
    throw new PresetZipError('INVALID_ZIP', 'Il file non è un archivio zip valido');
  }

  const entries = zip
    .getEntries()
    .filter(e => !e.isDirectory)
    .map(e => ({ entry: e, name: normalizeEntryName(e.entryName) }));

  // preset.json обязателен
  const presetEntry = entries.find(e => e.name === 'preset.json');
  if (!presetEntry) {
    throw new PresetZipError('INVALID_ZIP', "Nell'archivio manca preset.json");
  }

  let raw: unknown;
  try {
    raw = JSON.parse(presetEntry.entry.getData().toString('utf-8'));
  } catch {
    throw new PresetZipError('INVALID_PRESET', 'preset.json: il contenuto non è JSON valido');
  }

  let validated: ReturnType<typeof validatePresetJson>;
  try {
    validated = validatePresetJson(raw, 'preset.json');
  } catch (e: any) {
    throw new PresetZipError('INVALID_PRESET', e.message);
  }

  const id = validated.id;
  const dir = path.join(PRESETS_DIR, id);
  if (fs.existsSync(dir) && !opts.overwrite) {
    throw new PresetZipError('EXISTS', `Il preset "${id}" esiste già (passa overwrite=1 per sovrascriverlo)`);
  }

  // Валидация + сбор разрешённых файлов ДО любых записей на диск
  const files: Array<{ rel: string; data: Buffer }> = [];
  for (const { entry, name } of entries) {
    if (!isSafeEntryName(name)) continue; // zip-slip — игнорируем

    if (ALLOWED_ROOT_FILES.has(name)) {
      if (name === 'map.geojson') {
        try {
          JSON.parse(entry.getData().toString('utf-8'));
        } catch {
          throw new PresetZipError('INVALID_PRESET', 'map.geojson: il contenuto non è JSON valido');
        }
      }
      files.push({ rel: name, data: entry.getData() });
      continue;
    }

    // Флаги: только flags/<имя>.(svg|png), без вложенных каталогов
    if (name.startsWith('flags/')) {
      const file = name.slice('flags/'.length);
      if (file && !file.includes('/') && path.basename(file) === file && /\.(svg|png)$/i.test(file)) {
        files.push({ rel: `flags/${file}`, data: entry.getData() });
      }
      continue;
    }
    // M01 µ4: catalogo di scenario ammesso in archivio (validato più sotto,
    // PRIMA di ogni scrittura su disco — MAT01).
    if (name.startsWith('simulation/') && /\.(json|md)$/i.test(name)) {
      files.push({ rel: name, data: entry.getData() });
      continue;
    }
  }
  // M01 µ4 (piano passo 5, MAT01): il catalogo simulation/ dell'archivio è
  // validato in memoria PRIMA di ogni scrittura su disco. Con errori
  // bloccanti l'import strict è rifiutato con percorso e motivo.
  const simEntries = files.filter(f => f.rel.startsWith('simulation/'));
  if (simEntries.length > 0) {
    const catalogFiles: CatalogFiles = {};
    const parseIssues: string[] = [];
    const keys: Record<string, string> = {
      'manifest.json': 'manifest', 'polities.json': 'polities', 'resources.json': 'resources',
      'technologies.json': 'technologies', 'recipes.json': 'recipes', 'facilities.json': 'facilities',
      'actors.json': 'actors', 'authorities.json': 'authorities', 'initial-state.json': 'initial-state',
    };
    for (const entry of simEntries) {
      const fileName = entry.rel.slice('simulation/'.length);
      if (fileName === 'sources.md') continue; // testo, non validato dal loader
      const key = keys[fileName];
      if (!key) {
        parseIssues.push(`simulation/${fileName}: file non ammesso nel catalogo`);
        continue;
      }
      try {
        (catalogFiles as any)[key] = JSON.parse(entry.data.toString('utf-8'));
      } catch {
        parseIssues.push(`${entry.rel}: JSON non valido`);
      }
    }
    for (const key of Object.keys(keys)) {
      if ((catalogFiles as any)[keys[key]] === undefined) parseIssues.push(`simulation/${keys[key]}.json: file di catalogo mancante`);
    }
    const report = validateCatalog(catalogFiles);
    if (report.errors.length > 0 || parseIssues.length > 0) {
      const details = [...parseIssues, ...report.errors.map(e => `${e.path} [${e.code}] ${e.message}`)];
      throw new PresetZipError('INVALID_PRESET',
        `Import strict rifiutato: ${details.length} problemi di catalogo. ${details.slice(0, 10).join(' | ')}`);
    }
  }
  // I file simulation/ validati restano in `files` e vengono estratti insieme
  // al resto; l'archivio senza catalogo mantiene il comportamento legacy.

  // Извлечение: каталог data/presets/<id> (при overwrite — пересоздаём)
  if (fs.existsSync(dir)) fs.rmSync(dir, { recursive: true, force: true });
  fs.mkdirSync(dir, { recursive: true });
  for (const f of files) {
    const target = path.join(dir, f.rel);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, f.data);
  }

  const preset = loadPreset(id);
  if (!preset) {
    throw new PresetZipError('INVALID_PRESET', `Preset "${id}" salvato, ma non è leggibile`);
  }
  return { preset };
}
