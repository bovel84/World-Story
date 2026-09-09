/**
 * Test endpoint /api/llm: preset provider, config runtime (persistita e
 * ricaricata a caldo), elenco modelli e verifica di connessione.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import os from 'os';
import path from 'path';
import fs from 'fs';
import express from 'express';
import type { Server } from 'node:http';

const CONFIG_FILE = path.join(os.tmpdir(), `world-story-llm-config-${process.pid}-${Date.now()}.json`);
const DB_FILE = path.join(os.tmpdir(), `world-story-llm-db-${process.pid}.db`);

const ENV_KEYS = [
  'LLM_CONFIG_PATH', 'LLM_PROVIDER', 'LLM_BASE_URL', 'LLM_API_KEY', 'LLM_MODEL',
  'MINIMAX_API_KEY', 'MINIMAX_BASE_URL',
];
const savedEnv: Record<string, string | undefined> = {};
for (const key of ENV_KEYS) {
  savedEnv[key] = process.env[key];
  delete process.env[key];
}
process.env.LLM_CONFIG_PATH = CONFIG_FILE;
process.env.OPEN_PAX_DB_PATH = DB_FILE;

let base = '';
let server: Server | null = null;

beforeAll(async () => {
  const { llmRouter } = await import('../src/routes/llm.routes');
  const app = express();
  app.use(express.json());
  app.use('/api/llm', llmRouter);
  server = app.listen(0);
  const address = server.address();
  const port = typeof address === 'object' && address ? address.port : 0;
  base = `http://127.0.0.1:${port}/api/llm`;
});

afterAll(async () => {
  await new Promise<void>(resolve => {
    if (server) server.close(() => resolve());
    else resolve();
  });
  for (const file of [CONFIG_FILE, DB_FILE]) {
    for (const suffix of ['', '-wal', '-shm']) {
      try { fs.rmSync(file + suffix, { force: true }); } catch { /* file temporaneo */ }
    }
  }
  for (const key of ENV_KEYS) {
    if (savedEnv[key] === undefined) delete process.env[key];
    else process.env[key] = savedEnv[key];
  }
});

async function call(method: 'GET' | 'POST', endpoint: string, body?: unknown) {
  const res = await fetch(`${base}${endpoint}`, {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({}));
  return { status: res.status, data, text: JSON.stringify(data) };
}

describe('GET /api/llm/providers', () => {
  it('espone i preset cloud e locali richiesti', async () => {
    const { status, data } = await call('GET', '/providers');
    expect(status).toBe(200);
    const byId = new Map<string, any>(data.providers.map((p: any) => [p.id, p]));
    expect(byId.get('ollama-cloud')?.baseUrl).toBe('https://ollama.com/v1');
    expect(byId.get('ollama-cloud')?.needsKey).toBe(true);
    expect(byId.get('ollama-local')?.needsKey).toBe(false);
    expect(byId.get('openrouter')?.baseUrl).toBe('https://openrouter.ai/api/v1');
    expect(byId.get('nvidia')?.baseUrl).toBe('https://integrate.api.nvidia.com/v1');
    expect(byId.get('anthropic')?.provider).toBe('anthropic');
    expect(byId.get('custom')?.provider).toBe('openai-compatible');
  });
});

describe('GET /api/llm/config', () => {
  it('non espone mai la API key', async () => {
    const { status, text } = await call('GET', '/config');
    expect(status).toBe(200);
    expect(JSON.parse(text).default).toHaveProperty('apiKeySet');
    expect(text).not.toContain('secret-value');
  });
});

describe('POST /api/llm/config', () => {
  it('rifiuta un provider non valido', async () => {
    const { status } = await call('POST', '/config', {
      default: { provider: 'quantum-ai', model: 'x' },
    });
    expect(status).toBe(400);
  });

  it('salva default + override di meccanica e ricarica il router a caldo', async () => {
    const save = await call('POST', '/config', {
      default: {
        provider: 'openai-compatible',
        baseUrl: 'https://ollama.com/v1',
        apiKey: 'test-key-123',
        model: 'gpt-oss:20b',
      },
      mechanics: { chat: { model: 'chat-special' } },
    });
    expect(save.status).toBe(200);
    expect(save.data.ok).toBe(true);

    // Persistita su disco
    const onDisk = JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf8'));
    expect(onDisk.default.model).toBe('gpt-oss:20b');
    expect(onDisk.mechanics.chat.model).toBe('chat-special');

    // Vista sanitizzata: chiave presente ma mai in chiaro
    const view = await call('GET', '/config');
    expect(view.data.default.model).toBe('gpt-oss:20b');
    expect(view.data.default.apiKeySet).toBe(true);
    expect(view.data.mechanics.chat.overridden).toBe(true);
    expect(view.text).not.toContain('test-key-123');

    // Status riflette il ricaricamento a caldo per tutte le meccaniche
    const status = await call('GET', '/status');
    expect(status.data.mechanics.jump.model).toBe('gpt-oss:20b');
    expect(status.data.mechanics.jump.baseUrl).toBe('https://ollama.com/v1');
    expect(status.data.mechanics.chat.model).toBe('chat-special');
  });

  it('ripristina la config precedente se la nuova è rotta', async () => {
    const broken = await call('POST', '/config', {
      default: { model: '' },
    });
    expect(broken.status).toBe(400);

    const view = await call('GET', '/config');
    expect(view.data.default.model).toBe('gpt-oss:20b');
    const status = await call('GET', '/status');
    expect(status.data.mechanics.jump.model).toBe('gpt-oss:20b');
  });

  it('rifiuta meccaniche sconosciute', async () => {
    const { status } = await call('POST', '/config', {
      mechanics: { warp_drive: { model: 'x' } },
    });
    expect(status).toBe(400);
  });
});

describe('POST /api/llm/models', () => {
  it('rifiuta openai-compatible senza baseUrl', async () => {
    const { status } = await call('POST', '/models', { provider: 'openai-compatible' });
    expect(status).toBe(502);
  });

  it('riporta un errore chiaro per un endpoint irraggiungibile', async () => {
    const { status, data } = await call('POST', '/models', {
      provider: 'openai-compatible',
      baseUrl: 'http://127.0.0.1:9/v1',
    });
    expect(status).toBe(502);
    expect(String(data.error)).toMatch(/openai-compatible/);
  });

  it('avvisa invece di fallire per MiniMax', async () => {
    const { status, data } = await call('POST', '/models', {
      provider: 'minimax',
      baseUrl: 'https://api.minimax.io/v1',
    });
    expect(status).toBe(200);
    expect(data.models).toEqual([]);
    expect(String(data.warning)).toMatch(/manualmente/i);
  });
});

describe('POST /api/llm/test', () => {
  it('rifiuta provider non validi e campi mancanti', async () => {
    expect((await call('POST', '/test', { provider: 'nope' })).status).toBe(400);
    expect((await call('POST', '/test', { provider: 'openai-compatible', model: 'm' })).status).toBe(400);
  });

  it('riporta un errore di rete comprensibile (retries disattivati)', async () => {
    const { status, data } = await call('POST', '/test', {
      provider: 'openai-compatible',
      baseUrl: 'http://127.0.0.1:9/v1',
      model: 'test-model',
    });
    expect(status).toBe(502);
    expect(String(data.error)).toMatch(/openai-compatible/);
  });
});

describe('LLMRouter.updateConfig', () => {
  it('sostituisce provider e cache a caldo', async () => {
    const { LLMRouter } = await import('../src/llm/router');
    const { loadLLMConfig } = await import('../src/llm/config');
    let built = 0;
    const factory = () => { built += 1; return { name: 'stub', model: 'm', generate: async () => ({ content: '' }) }; };
    const router = new LLMRouter(loadLLMConfig(CONFIG_FILE), factory as any);
    router.generate('jump', 's', 'u');
    const builtBefore = built;

    const updated = loadLLMConfig(CONFIG_FILE);
    updated.mechanics.jump.model = 'nuovo-modello';
    router.updateConfig(updated);

    expect(router.describe().jump.model).toBe('nuovo-modello');
    // I provider sono stati ricostruiti, non riutilizzati dalla cache
    router.generate('jump', 's', 'u');
    expect(built).toBeGreaterThan(builtBefore);
  });
});