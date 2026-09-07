import { LLMRouter } from './router';
import { loadLLMConfig, type LLMFullConfig } from './config';
import path from 'node:path';

export * from './types';
export { LLMRouter } from './router';
export { loadLLMConfig } from './config';
export type { LLMConfig, LLMFullConfig, MechanicConfig, ConsolidationConfig } from './config';

let router: LLMRouter | null = null;

/** Инициализирует глобальный LLM-роутер (вызывается один раз при старте сервера). */
export function initLLMRouter(configPath?: string, config?: LLMFullConfig): LLMRouter {
  router = new LLMRouter(config ?? loadLLMConfig(configPath));
  return router;
}

export function getLLMRouter(): LLMRouter {
  if (!router) router = new LLMRouter(loadLLMConfig());
  return router;
}

/** Percorso del file di configurazione (stessa logica di loadLLMConfig). */
export function llmConfigFilePath(): string {
  return process.env.LLM_CONFIG_PATH || path.join(process.cwd(), 'llm.config.json');
}
