import fs from 'node:fs';
import path from 'node:path';
import type { Mechanic } from './types';
import { ALL_MECHANICS } from './types';

export interface MechanicConfig {
  provider: 'openai-compatible' | 'anthropic';
  baseUrl: string;
  apiKey: string;
  model: string;
  timeoutMs: number;
  retries: number;
  /** Разрешить стриминг токенов (используется для прыжка). */
  stream: boolean;
  /** Разрешить кэширование ответов (по умолчанию только advisor/suggestions/converter). */
  cache?: boolean;
  /**
   * Просить у провайдера строгий JSON (OpenAI response_format / Ollama format).
   * Включай только если провайдер это поддерживает — часть API отвечает 400.
   */
  jsonMode?: boolean;
  /** Campi extra passati al body della richiesta (provider-specific, es. reasoning_effort) */
  extraBody?: Record<string, unknown>;
}

export type LLMConfig = Record<Mechanic, MechanicConfig>;

/**
 * Настройки консолидации истории (Этап 2).
 * Целевые модели — облачные с контекстом 256K+, поэтому дефолты выше
 * оригинальных (15 раундов): startRound=25. Для локальных моделей 8–32B
 * стоит понизить до 10–15 через llm.config.json или env.
 */
export interface ConsolidationConfig {
  /** С какого раунда начинать консолидировать */
  startRound: number;
  /** Размер чанка консолидации (раундов за одно саммари) */
  chunkSize: number;
  /** Сколько последних раундов всегда держать сырыми */
  keepRawTail: number;
}

export interface LLMFullConfig {
  mechanics: LLMConfig;
  consolidation: ConsolidationConfig;
}

const DEFAULT_CACHE_MECHANICS = new Set<Mechanic>(['advisor', 'suggestions', 'converter']);

function resolveApiKey(raw: string | undefined): string {
  if (raw && raw.startsWith('env:')) {
    return process.env[raw.slice(4)] ?? '';
  }
  return raw ?? '';
}

/** Chiave API generica del provider attivo (LLM_API_KEY). */
function envApiKeyFor(): string {
  return process.env.LLM_API_KEY || '';
}

function defaultConfig(): LLMConfig {
  const envBase = process.env.LLM_BASE_URL || 'http://localhost:11434/v1';
  const envModel = process.env.LLM_MODEL || 'qwen2.5:14b';
  const envProvider = (process.env.LLM_PROVIDER as MechanicConfig['provider']) || 'openai-compatible';
  const cfg = {} as LLMConfig;
  for (const m of ALL_MECHANICS) {
    cfg[m] = {
      provider: envProvider, baseUrl: envBase, apiKey: envApiKeyFor(), model: envModel,
      timeoutMs: 120_000, retries: 4, stream: true, cache: DEFAULT_CACHE_MECHANICS.has(m),
    };
  }
  return cfg;
}

/**
 * Загружает конфигурацию LLM. Приоритет:
 * 1. llm.config.json (путь из LLM_CONFIG_PATH или рядом с cwd) — секции default + mechanics (+ consolidation).
 * 2. Env-переменные LLM_PROVIDER/LLM_BASE_URL/LLM_API_KEY/LLM_MODEL.
 */
export function loadLLMConfig(configPath?: string): LLMFullConfig {
  const file = configPath
    ?? process.env.LLM_CONFIG_PATH
    ?? path.join(process.cwd(), 'llm.config.json');
  const cfg = defaultConfig();
  const consolidation: ConsolidationConfig = {
    startRound: Number(process.env.LLM_CONSOLIDATION_START_ROUND) || 25,
    chunkSize: Number(process.env.LLM_CONSOLIDATION_CHUNK_SIZE) || 5,
    keepRawTail: Number(process.env.LLM_CONSOLIDATION_KEEP_RAW_TAIL) || 10,
  };

  if (fs.existsSync(file)) {
    const raw = JSON.parse(fs.readFileSync(file, 'utf8')) as {
      default?: Partial<MechanicConfig>;
      mechanics?: Partial<Record<Mechanic, Partial<MechanicConfig>>>;
      consolidation?: Partial<ConsolidationConfig>;
    };
    const base: Partial<MechanicConfig> = raw.default ?? {};
    for (const m of ALL_MECHANICS) {
      const mechanicOverride = raw.mechanics?.[m] ?? {};
      const merged = { ...cfg[m], ...base, ...mechanicOverride };
      const explicitApiKey = mechanicOverride.apiKey ?? base.apiKey;
      merged.apiKey = explicitApiKey !== undefined
        ? resolveApiKey(explicitApiKey)
        : envApiKeyFor();
      if (merged.cache === undefined) merged.cache = DEFAULT_CACHE_MECHANICS.has(m);
      if (!merged.baseUrl || !merged.model) {
        throw new Error(`llm.config.json: meccanica "${m}": servono baseUrl e model`);
      }
      cfg[m] = merged;
    }
    Object.assign(consolidation, raw.consolidation ?? {});
  }

  return { mechanics: cfg, consolidation };
}
