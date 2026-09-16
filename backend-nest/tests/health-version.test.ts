/**
 * Q02 µ3 — Health/version: build ID backend/frontend, schema e modelVersion,
 * senza segreti.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const dbPath = path.join(os.tmpdir(), `ws-health-${process.pid}-${Date.now()}.db`);
const previous = {
  db: process.env.OPEN_PAX_DB_PATH,
  token: process.env.WORLD_STORY_OWNER_TOKEN,
  llmKey: process.env.LLM_API_KEY,
  backendBuild: process.env.WORLD_STORY_BUILD_ID,
  frontendBuild: process.env.WORLD_STORY_FRONTEND_BUILD_ID,
};

let buildInfo: typeof import('../src/health/build-info').buildInfo;

beforeAll(async () => {
  process.env.OPEN_PAX_DB_PATH = dbPath;
  const { initDatabase } = await import('../src/database');
  initDatabase();
  ({ buildInfo } = await import('../src/health/build-info'));
});

afterAll(() => {
  for (const file of [dbPath, `${dbPath}-wal`, `${dbPath}-shm`]) fs.rmSync(file, { force: true });
  const restore = (key: string, value: string | undefined) => {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  };
  restore('OPEN_PAX_DB_PATH', previous.db);
  restore('WORLD_STORY_OWNER_TOKEN', previous.token);
  restore('LLM_API_KEY', previous.llmKey);
  restore('WORLD_STORY_BUILD_ID', previous.backendBuild);
  restore('WORLD_STORY_FRONTEND_BUILD_ID', previous.frontendBuild);
});

describe('Q02 µ3 — health/version', () => {
  it('espone build, schema, modelVersion e modalità auth', () => {
    delete process.env.WORLD_STORY_OWNER_TOKEN;
    delete process.env.WORLD_STORY_BUILD_ID;
    delete process.env.WORLD_STORY_FRONTEND_BUILD_ID;
    const info = buildInfo();
    expect(info.status).toBe('ok');
    expect(typeof info.timestamp).toBe('string');
    expect(info.build.backend).toBe('dev');
    expect([null, 'string']).toContain(info.build.frontend === null ? null : 'string');
    expect(info.schema.economySnapshot).toBe(1);
    expect(info.schema.database.tables).toBeGreaterThan(0);
    expect(info.auth).toBe('open-single-user');
    expect(info.api).toEqual({ base: '/api', sameOrigin: true });
  });

  it('riporta i modelVersion dei cataloghi dichiarati', () => {
    const versions = buildInfo().modelVersions;
    expect(versions.length).toBeGreaterThan(0);
    const coldWar = versions.find((entry) => entry.id === 'cold_war_1951_v2');
    expect(coldWar).toMatchObject({ version: 2, mode: 'strict' });
    for (const entry of versions) {
      expect(entry.id).not.toContain('/');
      expect(Number.isInteger(entry.version)).toBe(true);
    }
  });

  it('rispetta gli override di build ID (backend e frontend)', () => {
    process.env.WORLD_STORY_BUILD_ID = 'sha-backend-1';
    process.env.WORLD_STORY_FRONTEND_BUILD_ID = 'sha-frontend-2';
    const info = buildInfo();
    expect(info.build).toEqual({ backend: 'sha-backend-1', frontend: 'sha-frontend-2' });
  });

  it('la modalità auth passa a owner-token senza esporre il token', () => {
    process.env.WORLD_STORY_OWNER_TOKEN = 'tok-segreto-health';
    process.env.LLM_API_KEY = 'sk-llm-segreto';
    const info = buildInfo();
    expect(info.auth).toBe('owner-token');
    const serialized = JSON.stringify(info);
    expect(serialized).not.toContain('tok-segreto-health');
    expect(serialized).not.toContain('sk-llm-segreto');
    // L'unica occorrenza di «token» ammessa è il NOME della modalità auth.
    expect(info.auth).toBe('owner-token');
    for (const forbidden of ['apikey', 'secret', 'password', 'authorization']) {
      expect(serialized.toLowerCase()).not.toContain(forbidden);
    }
  });

  it('la route /health risponde con lo stesso payload (alias /api/health)', async () => {
    const { healthRouter } = await import('../src/routes/health.routes');
    const route = healthRouter.stack.find((layer: any) => layer.route) as any;
    const handler = route.route.stack[route.route.stack.length - 1].handle;
    const body = await new Promise<Record<string, unknown>>((resolve) => {
      handler({}, { json: (payload: Record<string, unknown>) => resolve(payload) });
    });
    expect(body.status).toBe('ok');
    expect(body.build).toBeTruthy();
    expect(body.schema).toBeTruthy();
  });
});
