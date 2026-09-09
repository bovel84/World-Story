/**
 * M01 µ3 — modalità strict/authored e cache per impronta di contenuto.
 * ====================================================================
 * Piano M01 passo 4: nella modalità rigorosa il bilanciamento di alleanze
 * e potenze NON è autorizzato (storico con stime dichiarate, mai
 * riequilibrato a posteriori); cache e riuso basato su impronta di
 * CONTENUTO del catalogo, non su data/paesi (MAT18: clone stesso anno ma
 * regole diverse → nessun riuso baseline).
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';

const TEST_DB = path.join(os.tmpdir(), `world-story-balance-mode-${process.pid}-${Date.now()}.db`);
process.env.OPEN_PAX_DB_PATH = TEST_DB;

import { BalanceAgent, type CountryState, type SimulationGenerationOptions } from '../src/agents/balance-agent';
import { catalogFingerprint, loadSimulationCatalog } from '../src/scenario/loader';
import type { LLMRouter } from '../src/llm';

const FIXTURE_DIR = path.join(process.cwd(), 'data', 'presets', 'realism_test_world');

interface Template {
  id: string;
  name: string;
  country_codes: string[];
  base_prompt: string;
  start_date: string;
}

function countryTemplate(id = 'tpl-balance-test'): Template {
  return {
    id,
    name: 'Template bilanciamento',
    country_codes: ['USA', 'GBR', 'FRA'],
    base_prompt: 'Scenario di prova per il bilanciamento.',
    start_date: '1951-01-01',
  };
}

/** Provider stub: risponde con stati fissi e conta le chiamate. */
function makeStubProvider(states: Record<string, Partial<CountryState>>): { provider: LLMRouter; calls: () => number } {
  let count = 0;
  const provider = {
    generate: (_role: string, _system: string, user: string, _opts?: unknown) => {
      count += 1;
      const codes = [...user.matchAll(/^([A-Z]{3}):/gm)].map(m => m[1]);
      const out: Record<string, unknown> = {};
      for (const code of codes) out[code] = states[code] ?? { status: 'minor', military: 10, gdp: 10 };
      return Promise.resolve({ content: JSON.stringify({ countries: out }) });
    },
  };
  return { provider: provider as unknown as LLMRouter, calls: () => count };
}

function statesFrom(map: Map<string, CountryState>): Record<string, CountryState> {
  const out: Record<string, CountryState> = {};
  for (const [code, state] of map) out[code] = state;
  return out;
}

let database: any;
let worldRepository: any;

beforeAll(async () => {
  database = await import('../src/database');
  ({ worldRepository } = await import('../src/repositories/world.repository'));
  database.initDatabase();
});

afterAll(() => {
  try { fs.rmSync(TEST_DB, { force: true }); } catch { /* best effort */ }
  try { fs.rmSync(path.join(process.cwd(), '.cache', 'balance'), { force: true, recursive: true }); } catch { /* best effort */ }
});

describe('M01 µ3 — balanceWorld strict vs authored (piano passo 4)', () => {
  it('strict NON riequilibra: nessuna declassazione, promozione o alleanza forzata', async () => {
    const agent = new BalanceAgent(null as unknown as LLMRouter);
    const countries = new Map<string, CountryState>([
      ['USA', { code: 'USA', name: 'USA', color: '#fff', status: 'superpower', military: 100, allies: [] }],
      ['RUS', { code: 'RUS', name: 'URSS', color: '#f00', status: 'superpower', military: 100, allies: [] }],
      ['CHN', { code: 'CHN', name: 'Cina', color: '#0f0', status: 'superpower', military: 150, allies: [] }],
      ['GBR', { code: 'GBR', name: 'Regno Unito', color: '#00f', status: 'major', military: 60, allies: [] }],
    ]);
    const before = [...countries.values()].map(c => ({ ...c }));
    await agent.balanceWorld(countries, 'strict');
    expect([...countries.values()].map(c => ({ ...c }))).toEqual(before);
  });

  it('authored riequilibra: declassa il terzo superpotere, forza un alleato ai major', async () => {
    const agent = new BalanceAgent(null as unknown as LLMRouter);
    const countries = new Map<string, CountryState>([
      ['USA', { code: 'USA', name: 'USA', color: '#fff', status: 'superpower', military: 100, allies: [] }],
      ['RUS', { code: 'RUS', name: 'URSS', color: '#f00', status: 'superpower', military: 100, allies: [] }],
      ['CHN', { code: 'CHN', name: 'Cina', color: '#0f0', status: 'superpower', military: 150, allies: [] }],
      ['GBR', { code: 'GBR', name: 'Regno Unito', color: '#00f', status: 'major', military: 60, allies: [] }],
    ]);
    await agent.balanceWorld(countries, 'authored');
    expect(countries.get('CHN')!.status).toBe('major');
    expect(countries.get('CHN')!.military).toBeLessThan(150);
    expect(countries.get('GBR')!.allies!.length).toBe(1);
  });
});

describe('M01 µ3 — cache per impronta di contenuto (MAT18)', () => {
  it('stesso template, impronte diverse: la cache NON è condivisa', async () => {
    const template = countryTemplate('tpl-mat18-cache');
    const stub1 = makeStubProvider({
      USA: { status: 'superpower', military: 100, population: 150_000_000, gdp: 100 },
      GBR: { status: 'major', military: 60, population: 50_000_000, gdp: 50 },
      FRA: { status: 'major', military: 55, population: 42_000_000, gdp: 45 },
    });
    const agent1 = new BalanceAgent(stub1.provider);
    const opts1: SimulationGenerationOptions = { mode: 'strict', catalogFingerprint: 'aaaa1111' };
    await agent1.generateInitialWorldState(template, undefined, undefined, opts1);
    expect(stub1.calls()).toBe(1); // primo avvio: LLM chiamato
    await agent1.generateInitialWorldState(template, undefined, undefined, opts1);
    expect(stub1.calls()).toBe(1); // stessa impronta: cache hit

    // Stesso anno, stesse nazioni, regole (impronta) diverse → niente cache.
    const stub2 = makeStubProvider({});
    const agent2 = new BalanceAgent(stub2.provider);
    const opts2: SimulationGenerationOptions = { mode: 'strict', catalogFingerprint: 'bbbb2222' };
    await agent2.generateInitialWorldState(template, undefined, undefined, opts2);
    expect(stub2.calls()).toBe(1); // il baseline di F1 non è riusato
  });

  it('template legacy (senza impronta) non eredita cache di un catalogo', async () => {
    const template = countryTemplate('tpl-mat18-legacy');
    const stub = makeStubProvider({});
    const agent = new BalanceAgent(stub.provider);
    await agent.generateInitialWorldState(template, undefined, undefined, { mode: 'strict', catalogFingerprint: 'cccc3333' });
    await agent.generateInitialWorldState(template, undefined, undefined, undefined); // legacy
    expect(stub.calls()).toBe(2);
  });
});

describe('M01 µ3 — riuso baseline guardato dall’impronta (MAT18)', () => {
  it('un mondo con impronta diversa non è riusato; stesso mondo con la stessa impronta sì', async () => {
    // Mondo baseline: stesso anno, nazioni coperte, impronta F1 registrata.
    const baselineId = 'baseline-m01';
    worldRepository.createWithRegions({
      id: 'baseline-mat18',
      name: 'Baseline MAT18 - x',
      startDate: '1951-01-01',
      basePrompt: 'baseline',
      catalogFingerprint: 'aaaa1111',
    }, [
      { id: 'baseline-mat18_USA', worldId: 'baseline-mat18', name: 'USA', population: 150, gdp: 100, militaryPower: 100, flag: 'USA', owner: 'USA' },
      { id: 'baseline-mat18_GBR', worldId: 'baseline-mat18', name: 'GBR', population: 50, gdp: 50, militaryPower: 60, flag: 'GBR', owner: 'GBR' },
      { id: 'baseline-mat18_FRA', worldId: 'baseline-mat18', name: 'FRA', population: 42, gdp: 45, militaryPower: 55, flag: 'FRA', owner: 'FRA' },
    ]);

    const template = countryTemplate('tpl-mat18-reuse');
    // Impronta DIVERSA: nessun riuso → LLM chiamato.
    const stubDiff = makeStubProvider({});
    const agentDiff = new BalanceAgent(stubDiff.provider);
    await agentDiff.generateInitialWorldState(template, undefined, undefined, { mode: 'strict', catalogFingerprint: 'dddd4444' });
    expect(stubDiff.calls()).toBe(1);

    // Stessa impronta: riuso baseline → LLM non chiamato.
    const stubSame = makeStubProvider({});
    const agentSame = new BalanceAgent(stubSame.provider);
    const reused = await agentSame.generateInitialWorldState(template, undefined, undefined, { mode: 'strict', catalogFingerprint: 'aaaa1111' });
    expect(stubSame.calls()).toBe(0);
    expect(reused.countries.get('USA')!.military).toBe(100);

    // Template legacy: i mondi con catalogo non sono candidati (COALESCE guard).
    const stubLegacy = makeStubProvider({});
    const agentLegacy = new BalanceAgent(stubLegacy.provider);
    await agentLegacy.generateInitialWorldState(template, undefined, undefined, undefined);
    expect(stubLegacy.calls()).toBe(1);
  });
});

describe('M01 µ3 — impronta di catalogo', () => {
  it('catalogFingerprint cambia al variare delle regole e identifica il pilota', () => {
    const h1 = { manifest: 'm1', resources: 'r1' };
    const h2 = { manifest: 'm2', resources: 'r1' };
    expect(catalogFingerprint(h1)).not.toBe(catalogFingerprint(h2));
    expect(catalogFingerprint(h1)).toBe(catalogFingerprint({ resources: 'r1', manifest: 'm1' }));
    // il pilota ha una propria impronta (≠ null): cache e riuso separati dai legacy
    const pilot = loadSimulationCatalog(path.join(process.cwd(), 'data', 'presets', 'cold_war_1951_v2'));
    expect(pilot.catalog && catalogFingerprint(pilot.report.catalogHashes)).toMatch(/^[0-9a-f]{24}$/);
  });
});