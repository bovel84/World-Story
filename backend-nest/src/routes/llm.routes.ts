/**
 * World Story — LLM Routes
 * =====================
 * Configurazione del modello IA a runtime:
 *  - GET  /status     — configurazione attiva per meccanica (senza segreti)
 *  - GET  /providers  — preset dei provider supportati
 *  - GET  /config     — vista sanitizzata di llm.config.json + env
 *  - POST /config     — aggiorna e persiste la configurazione (hot reload)
 *  - POST /models     — elenco modelli del provider (proxy /models)
 *  - POST /test       — chiamata di verifica con la configurazione indicata
 */

import { Router } from 'express';
import fs from 'node:fs';
import {
  getLLMRouter,
  llmConfigFilePath,
  loadLLMConfig,
} from '../llm';
import { buildProvider } from '../llm/router';
import { LLM_PROVIDER_PRESETS, listAvailableModels } from '../llm/models';
import { LLMError, ALL_MECHANICS } from '../llm/types';
import type { Mechanic } from '../llm/types';
import type { MechanicConfig } from '../llm/config';

export const llmRouter = Router();

const VALID_PROVIDERS: MechanicConfig['provider'][] = ['openai-compatible', 'anthropic', 'minimax'];

interface RawLLMFile {
  default?: Record<string, unknown>;
  mechanics?: Record<string, Record<string, unknown>>;
  consolidation?: Record<string, unknown>;
  [key: string]: unknown;
}

function readRawConfig(): RawLLMFile {
  const file = llmConfigFilePath();
  if (!fs.existsSync(file)) return {};
  try {
    const parsed = JSON.parse(fs.readFileSync(file, 'utf8'));
    return parsed && typeof parsed === 'object' ? parsed as RawLLMFile : {};
  } catch {
    return {};
  }
}

function envKeyInfo(): { set: boolean; source: 'env' | null } {
  const set = Boolean(process.env.LLM_API_KEY || process.env.MINIMAX_API_KEY);
  return { set, source: set ? 'env' : null };
}

function fileKeyInfo(value: unknown): { set: boolean; source: 'file' | null } {
  const set = typeof value === 'string' && value.trim().length > 0;
  return { set, source: set ? 'file' : null };
}

function resolvedDefaults(): { provider: string; baseUrl: string; model: string } {
  try {
    const jump = loadLLMConfig().mechanics.jump;
    return { provider: jump.provider, baseUrl: jump.baseUrl, model: jump.model };
  } catch {
    return { provider: '', baseUrl: '', model: '' };
  }
}

/** Vista senza segreti della configurazione corrente. */
function configView() {
  const file = llmConfigFilePath();
  const raw = readRawConfig();
  const resolved = resolvedDefaults();
  const envKey = envKeyInfo();
  const fileKey = fileKeyInfo(raw.default?.apiKey);
  // Chiave solo-memoria inviata dal browser (localStorage) — mai su disco
  const memoryKeySet = getLLMRouter().hasMemoryApiKey;

  const d = raw.default || {};
  const key = fileKey.set ? { set: true, source: 'file' as const }
    : memoryKeySet ? { set: true, source: 'browser' as const }
    : envKey.set ? envKey
    : { set: false, source: null };

  const mechanics: Record<string, {
    provider: string; baseUrl: string; model: string;
    overridden: boolean; hasKeyOverride: boolean;
  }> = {};
  for (const m of ALL_MECHANICS) {
    const ov = raw.mechanics?.[m] || {};
    mechanics[m] = {
      provider: String(ov.provider ?? d.provider ?? resolved.provider ?? ''),
      baseUrl: String(ov.baseUrl ?? d.baseUrl ?? resolved.baseUrl ?? ''),
      model: String(ov.model ?? d.model ?? resolved.model ?? ''),
      overridden: typeof ov.model === 'string' && ov.model.length > 0,
      hasKeyOverride: typeof ov.apiKey === 'string' && ov.apiKey.length > 0,
    };
  }

  return {
    configPath: file,
    configFileExists: fs.existsSync(file),
    default: {
      provider: String(d.provider ?? resolved.provider ?? ''),
      baseUrl: String(d.baseUrl ?? resolved.baseUrl ?? ''),
      model: String(d.model ?? resolved.model ?? ''),
      apiKeySet: key.set,
      apiKeySource: key.source,
    },
    mechanics,
  };
}

llmRouter.get('/status', (_req, res) => {
  const router = getLLMRouter();
  res.json({ mechanics: router.describe() });
});

// Preset dei provider (Ollama Cloud/locale, OpenRouter, NVIDIA, MiniMax, Anthropic, custom)
llmRouter.get('/providers', (_req, res) => {
  res.json({ providers: LLM_PROVIDER_PRESETS });
});

// Configurazione corrente (sanitizzata)
llmRouter.get('/config', (_req, res) => {
  res.json(configView());
});

// Aggiorna la configurazione e ricarica il router a caldo.
// Il body può portare persistApiKey: false → la chiave viene applicata SOLO
// in memoria (mai scritta su disco): la chiave vive nel browser e il frontend
// la reinvia a ogni caricamento.
llmRouter.post('/config', (req, res) => {
  const body = req.body || {};
  const persistApiKey = body.persistApiKey !== false; // default true (retrocompat.)
  const d = body.default && typeof body.default === 'object' ? body.default : {};

  if (d.provider !== undefined && !VALID_PROVIDERS.includes(d.provider)) {
    res.status(400).json({ error: `Provider non valido: ${String(d.provider)}` });
    return;
  }
  if (d.model !== undefined && (typeof d.model !== 'string' || !d.model.trim())) {
    res.status(400).json({ error: 'Il nome del modello è obbligatorio' });
    return;
  }
  if (d.baseUrl !== undefined && (typeof d.baseUrl !== 'string' || !d.baseUrl.trim())) {
    res.status(400).json({ error: 'Base URL non valida' });
    return;
  }
  if (d.apiKey !== undefined && typeof d.apiKey !== 'string') {
    res.status(400).json({ error: 'apiKey deve essere una stringa' });
    return;
  }

  const file = llmConfigFilePath();
  const raw = readRawConfig();
  const backup = fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : null;

  raw.default = { ...(raw.default || {}) };
  if (d.provider !== undefined) raw.default.provider = d.provider;
  if (d.baseUrl !== undefined) raw.default.baseUrl = d.baseUrl.trim();
  if (d.model !== undefined) raw.default.model = d.model.trim();
  if (d.apiKey !== undefined && persistApiKey) raw.default.apiKey = d.apiKey;
  // La chiave non deve stare su disco: con persistApiKey=false, se il browser
  // invia una nuova chiave, rimuoviamo qualunque chiave in chiaro dal file
  // (i riferimenti env:XXX restano — non sono segreti).
  if (!persistApiKey && typeof d.apiKey === 'string' && d.apiKey.trim()) {
    if (raw.default.apiKey && !String(raw.default.apiKey).startsWith('env:')) {
      delete raw.default.apiKey;
    }
  }

  // Override per singola meccanica (opzionale)
  const overrides = body.mechanics && typeof body.mechanics === 'object' ? body.mechanics : {};
  for (const key of Object.keys(overrides)) {
    if (!ALL_MECHANICS.includes(key as Mechanic)) {
      res.status(400).json({ error: `Meccanica sconosciuta: ${key}` });
      return;
    }
    const patch = overrides[key] || {};
    if (typeof patch === 'string') {
      if (!patch.trim()) continue;
      raw.mechanics = raw.mechanics || {};
      raw.mechanics[key] = { ...(raw.mechanics[key] || {}), model: patch.trim() };
      continue;
    }
    if (typeof patch !== 'object') continue;
    const clean: Record<string, unknown> = {};
    for (const field of ['provider', 'baseUrl', 'model', 'apiKey', 'timeoutMs', 'retries', 'stream', 'jsonMode', 'cache']) {
      if (patch[field] !== undefined && patch[field] !== null && patch[field] !== '') clean[field] = patch[field];
    }
    raw.mechanics = raw.mechanics || {};
    if (Object.keys(clean).length === 0) delete raw.mechanics[key];
    else raw.mechanics[key] = { ...(raw.mechanics[key] || {}), ...clean };
  }
  if (raw.mechanics && Object.keys(raw.mechanics).length === 0) delete raw.mechanics;

  try {
    fs.writeFileSync(file, JSON.stringify(raw, null, 2) + '\n');
    const loaded = loadLLMConfig(file);
    getLLMRouter().updateConfig(loaded);
    // Chiave solo-memoria: applicata DOPO il ricaricamento (il file non la contiene)
    if (!persistApiKey && typeof d.apiKey === 'string' && d.apiKey.trim()) {
      getLLMRouter().setApiKey(d.apiKey.trim());
    }
  } catch (e: any) {
    // Ripristina il file precedente: una config rotta non deve restare su disco
    try {
      if (backup === null) fs.rmSync(file, { force: true });
      else fs.writeFileSync(file, backup);
      loadLLMConfig(file);
      getLLMRouter().updateConfig(loadLLMConfig(file));
    } catch { /* lo stato precedente era già rotto: il router resta com'era */ }
    res.status(400).json({ error: `Configurazione non valida: ${e?.message || e}` });
    return;
  }

  res.json({ ok: true, ...configView(), status: { mechanics: getLLMRouter().describe() } });
});

/**
 * Chiave salvata da riusare quando il frontend non la reinvia
 * (cerchiamo una meccanica con lo stesso provider/baseUrl).
 */
function findSavedApiKey(provider?: string, baseUrl?: string): string {
  try {
    const { mechanics } = loadLLMConfig();
    const wantedBase = (baseUrl || '').trim().replace(/\/+$/, '');
    let fallback = '';
    for (const m of ALL_MECHANICS) {
      const cfg = mechanics[m];
      if (!cfg.apiKey) continue;
      if (provider && cfg.provider !== provider) continue;
      if (wantedBase) {
        if (cfg.baseUrl.replace(/\/+$/, '') === wantedBase) return cfg.apiKey;
        continue;
      }
      fallback = fallback || cfg.apiKey;
    }
    return fallback;
  } catch {
    return '';
  }
}

// Elenco modelli del provider (proxy verso /models del provider)
llmRouter.post('/models', async (req, res) => {
  const { provider, baseUrl, apiKey } = req.body || {};
  try {
    const key = (typeof apiKey === 'string' && apiKey.trim()) ? apiKey.trim() : findSavedApiKey(provider, baseUrl);
    const result = await listAvailableModels({ provider, baseUrl, apiKey: key });
    res.json(result);
  } catch (e: any) {
    if (e instanceof LLMError) {
      res.status(502).json({ error: e.message });
    } else {
      console.error('[LLM] models error:', e);
      res.status(500).json({ error: 'Impossibile scaricare l\u2019elenco dei modelli' });
    }
  }
});

// Verifica rapida della configurazione con una generazione minima
llmRouter.post('/test', async (req, res) => {
  const body = req.body || {};
  const provider = body.provider;
  const baseUrl = typeof body.baseUrl === 'string' ? body.baseUrl.trim() : '';
  const model = typeof body.model === 'string' ? body.model.trim() : '';

  if (!VALID_PROVIDERS.includes(provider)) {
    res.status(400).json({ error: `Provider non valido: ${String(provider)}` });
    return;
  }
  if (!baseUrl || !model) {
    res.status(400).json({ error: 'baseUrl e model sono obbligatori per la verifica' });
    return;
  }

  const apiKey = (typeof body.apiKey === 'string' && body.apiKey.trim())
    ? body.apiKey.trim()
    : findSavedApiKey(provider, baseUrl);

  const timeoutMs = Math.min(Math.max(Number(body.timeoutMs) || 30_000, 5_000), 60_000);
  const cfg: MechanicConfig = {
    provider, baseUrl, apiKey, model,
    timeoutMs, retries: 0, stream: false, cache: false,
  };

  const started = Date.now();
  try {
    const providerImpl = buildProvider(cfg);
    const result = await providerImpl.generate(
      'Sei una verifica di connessione. Rispondi con esattamente: OK',
      'test',
      { maxTokens: 2000 },
    );
    res.json({ ok: true, reply: result.content.slice(0, 200), latencyMs: Date.now() - started });
  } catch (e: any) {
    if (e instanceof LLMError) {
      res.status(502).json({ error: e.message });
    } else {
      console.error('[LLM] test error:', e);
      res.status(502).json({ error: e?.message || 'Verifica fallita' });
    }
  }
});