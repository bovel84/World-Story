/**
 * World Story — Registro dei provider LLM
 * ====================================
 * Preset dei provider compatibili (Ollama Cloud/locale, OpenRouter, NVIDIA,
 * MiniMax, Anthropic, endpoint OpenAI-compatibili personalizzati) e ricerca
 * dei modelli disponibili via endpoint /models.
 */

import type { MechanicConfig } from './config';
import { LLMError } from './types';

export interface LLMProviderPreset {
  id: string;
  label: string;
  /** Tipo di adattatore usato dal router */
  provider: MechanicConfig['provider'];
  baseUrl: string;
  needsKey: boolean;
  docsUrl?: string;
  description?: string;
  /** Modello suggerito per iniziare (modificabile dall'utente) */
  defaultModel?: string;
}

export const LLM_PROVIDER_PRESETS: LLMProviderPreset[] = [
  {
    id: 'ollama-cloud',
    label: 'Ollama Cloud',
    provider: 'openai-compatible',
    baseUrl: 'https://ollama.com/v1',
    needsKey: true,
    docsUrl: 'https://ollama.com/keys',
    description: 'Modelli Ollama nel cloud (gpt-oss, qwen3, llama4, deepseek…), API OpenAI-compatible.',
    defaultModel: 'gpt-oss:20b',
  },
  {
    id: 'ollama-local',
    label: 'Ollama locale',
    provider: 'openai-compatible',
    baseUrl: 'http://localhost:11434/v1',
    needsKey: false,
    docsUrl: 'https://ollama.com',
    description: 'Modelli sul tuo computer, nessuna chiave richiesta.',
    defaultModel: 'qwen2.5:14b',
  },
  {
    id: 'openrouter',
    label: 'OpenRouter',
    provider: 'openai-compatible',
    baseUrl: 'https://openrouter.ai/api/v1',
    needsKey: true,
    docsUrl: 'https://openrouter.ai/keys',
    description: 'Centinaia di modelli (Claude, GPT, Gemini, Llama…) con un solo account.',
    defaultModel: 'anthropic/claude-sonnet-4',
  },
  {
    id: 'nvidia',
    label: 'NVIDIA NIM',
    provider: 'openai-compatible',
    baseUrl: 'https://integrate.api.nvidia.com/v1',
    needsKey: true,
    docsUrl: 'https://build.nvidia.com',
    description: 'Catalogo NVIDIA NIM (Llama, Nemotron, DeepSeek…), API OpenAI-compatible.',
    defaultModel: 'meta/llama-3.3-70b-instruct',
  },
  {
    id: 'minimax',
    label: 'MiniMax',
    provider: 'minimax',
    baseUrl: 'https://api.minimax.io/v1',
    needsKey: true,
    docsUrl: 'https://platform.minimaxi.com',
    description: 'Provider predefinito di World Story (MiniMax-M2.5).',
    defaultModel: 'MiniMax-M2.5',
  },
  {
    id: 'anthropic',
    label: 'Anthropic',
    provider: 'anthropic',
    baseUrl: 'https://api.anthropic.com',
    needsKey: true,
    docsUrl: 'https://console.anthropic.com/settings/keys',
    description: 'API nativa Claude (Messages API).',
    defaultModel: 'claude-sonnet-4-20250514',
  },
  {
    id: 'custom',
    label: 'Altro (OpenAI-compatible)',
    provider: 'openai-compatible',
    baseUrl: '',
    needsKey: false,
    docsUrl: 'https://platform.openai.com/docs/api-reference/chat',
    description: 'OpenAI, LM Studio, vLLM, Together, DeepSeek, GLM… con base URL personalizzata.',
    defaultModel: '',
  },
];

export interface ModelListItem {
  id: string;
  name?: string;
}

export interface ModelListResult {
  models: ModelListItem[];
  warning?: string;
}

const LIST_TIMEOUT_MS = 20_000;

function normalizeBaseUrl(baseUrl: string | undefined): string {
  return (baseUrl || '').trim().replace(/\/+$/, '');
}

/** GET JSON con timeout e messaggi d'errore chiari (senza retry). */
async function getJson(url: string, headers: Record<string, string>, providerName: string): Promise<any> {
  try {
    const res = await fetch(url, { headers, signal: AbortSignal.timeout(LIST_TIMEOUT_MS) });
    if (!res.ok) {
      let detail = '';
      try { detail = (await res.text()).slice(0, 200); } catch { /* ignora */ }
      throw new LLMError(
        `${providerName}: HTTP ${res.status}${detail ? ` — ${detail}` : ''}`,
        { provider: providerName, status: res.status, retriable: res.status === 429 || res.status >= 500 },
      );
    }
    try {
      return await res.json();
    } catch {
      throw new LLMError(`${providerName}: risposta non valida (JSON atteso)`, { provider: providerName, retriable: true });
    }
  } catch (e: any) {
    if (e instanceof LLMError) throw e;
    if (e?.name === 'TimeoutError' || e?.name === 'AbortError') {
      throw new LLMError(`${providerName}: timeout dell'elenco modelli (${LIST_TIMEOUT_MS} ms)`, { provider: providerName, retriable: true });
    }
    throw new LLMError(`${providerName}: errore di rete — ${e?.message || e}`, { provider: providerName, retriable: true });
  }
}

/** Estrae {id,name} da una risposta /models in stile OpenAI, Ollama o OpenRouter. */
function parseOpenAIModelList(data: any): ModelListItem[] {
  const rows: any[] = Array.isArray(data?.data) ? data.data : Array.isArray(data?.models) ? data.models : [];
  const out: ModelListItem[] = [];
  const seen = new Set<string>();
  for (const row of rows) {
    const id = typeof row?.id === 'string' && row.id.trim()
      ? row.id.trim()
      : (typeof row?.name === 'string' ? row.name.trim() : '');
    if (!id || seen.has(id)) continue;
    seen.add(id);
    const name = typeof row?.name === 'string' && row.name && row.name !== id ? row.name : undefined;
    out.push({ id, name });
  }
  return out.sort((a, b) => a.id.localeCompare(b.id));
}

/**
 * Elenca i modelli disponibili per il provider indicato.
 * MiniMax non espone un elenco: restituisce un warning invece di fallire.
 */
export async function listAvailableModels(params: {
  provider: string;
  baseUrl?: string;
  apiKey?: string;
}): Promise<ModelListResult> {
  const provider = (params.provider || '').trim();

  if (provider === 'minimax') {
    return { models: [], warning: 'MiniMax non espone un elenco pubblico: inserisci il modello manualmente (es. MiniMax-M2.5).' };
  }

  const base = normalizeBaseUrl(params.baseUrl);
  if (!base) {
    throw new LLMError('Base URL mancante per l\u2019elenco dei modelli', { provider: provider || 'custom' });
  }

  if (provider === 'anthropic') {
    if (!params.apiKey) {
      throw new LLMError('anthropic: serve una API key per l\u2019elenco dei modelli', { provider: 'anthropic', status: 401 });
    }
    const data = await getJson(`${base}/v1/models`, {
      'x-api-key': params.apiKey,
      'anthropic-version': '2023-06-01',
    }, 'anthropic');
    const rows: any[] = Array.isArray(data?.data) ? data.data : [];
    return {
      models: rows
        .map(r => ({ id: String(r?.id || ''), name: typeof r?.display_name === 'string' ? r.display_name : undefined }))
        .filter(m => m.id)
        .sort((a, b) => a.id.localeCompare(b.id)),
    };
  }

  // Tutti gli altri sono OpenAI-compatible: Ollama, OpenRouter, NVIDIA, vLLM…
  const headers: Record<string, string> = {};
  if (params.apiKey) headers.Authorization = `Bearer ${params.apiKey}`;
  const data = await getJson(`${base}/models`, headers, 'openai-compatible');
  const models = parseOpenAIModelList(data);
  if (models.length === 0) {
    return { models: [], warning: 'Il provider non ha restituito modelli: verifica base URL e API key, o inserisci il modello manualmente.' };
  }
  return { models };
}