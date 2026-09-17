/**
 * MAP-COMPLETE — il mondo nasce da TUTTE le politie della mappa
 * ===========================================================
 * `country_codes` non decide più chi esiste: decide solo chi il preset cura
 * (nome/colore storico) e chi riceve i dati dal modello. Le altre politie della
 * mappa ricevono un baseline deterministico, così la mappa è completa senza
 * moltiplicare le chiamate LLM (uno dei vincoli del task).
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';

const TEST_DB = path.join(os.tmpdir(), `world-story-map-complete-${process.pid}-${Date.now()}.db`);
process.env.OPEN_PAX_DB_PATH = TEST_DB;

import {
  BalanceAgent,
  BASELINE_GDP_INDEX,
  BASELINE_MILITARY_INDEX,
  BASELINE_POPULATION,
  type CountryState,
} from '../src/agents/balance-agent';
import { referencePopulation } from '../src/utils/country-facts';
import type { LLMRouter } from '../src/llm';

const CURATED = ['USA', 'GBR', 'FRA'];

/** Id unici per esecuzione: nessuna collisione con la cache su disco. */
const RUN = `${process.pid}-${Date.now()}`;

/** 20 politie: 3 curate + 17 presenti solo perché stanno sulla mappa. */
function mapPolities(): Array<{ code: string; name: string; color: string }> {
  const extra = ['NPL', 'MNG', 'AND', 'MCO', 'SMR', 'LUX', 'MLT', 'CYP', 'ISL', 'FJI',
    'BRB', 'NRU', 'TUV', 'PLW', 'KIR', 'MHL', 'VUT'];
  return [...CURATED, ...extra].map(code => ({ code, name: `Nazione ${code}`, color: '#112233' }));
}

function template(id: string, startDate: string) {
  return {
    id,
    name: 'Mondo completo',
    country_codes: CURATED,
    base_prompt: 'Scenario di prova per la mappa completa.',
    start_date: startDate,
  };
}

/** Provider stub: risponde con stati fissi e conta le chiamate. */
function makeStub(): { provider: LLMRouter; calls: () => number } {
  let count = 0;
  const provider = {
    generate: (_role: string, _system: string, user: string) => {
      count += 1;
      const codes = [...user.matchAll(/^([A-Z]{3}):/gm)].map(m => m[1]);
      const out: Record<string, unknown> = {};
      for (const code of codes) out[code] = { status: 'major', military: 42, gdp: 40, population: 30_000_000 };
      return Promise.resolve({ content: JSON.stringify({ countries: out }) });
    },
  };
  return { provider: provider as unknown as LLMRouter, calls: () => count };
}

let database: any;

beforeAll(async () => {
  database = await import('../src/database');
  database.initDatabase();
});

afterAll(() => {
  try { fs.rmSync(TEST_DB, { force: true }); } catch { /* best effort */ }
});

describe('MAP-COMPLETE — modello solo per le politie curate', () => {
  it('tutte le politie della mappa esistono; il modello è chiamato solo per le curate', async () => {
    const stub = makeStub();
    const agent = new BalanceAgent(stub.provider);
    const world = await agent.generateInitialWorldState(
      template(`tpl-map-complete-a-${RUN}`, '1951-03-01'),
      mapPolities(),
      undefined,
      { mode: 'strict' },
      CURATED,
    );

    // Nessun «buco»: ogni polity della mappa è nel mondo.
    expect(world.countries.size).toBe(20);
    for (const polity of mapPolities()) expect(world.countries.has(polity.code), polity.code).toBe(true);

    // Una sola chiamata per 3 nazioni curate (batch da 16): le 17 non curate
    // NON passano dal modello.
    expect(stub.calls()).toBe(1);

    // Le curate hanno i dati del modello...
    expect(world.countries.get('USA')!.military).toBe(42);
    expect(world.countries.get('USA')!.population).toBe(30_000_000);
    // ...le altre il baseline deterministico, dichiarato e prudente.
    for (const code of ['AND', 'NRU', 'VUT']) {
      const state = world.countries.get(code)! as CountryState;
      expect(state.status, code).toBe('minor');
      expect(state.population, code).toBe(BASELINE_POPULATION);
      expect(state.gdp, code).toBe(BASELINE_GDP_INDEX);
      expect(state.military, code).toBe(BASELINE_MILITARY_INDEX);
    }
  });

  it('senza `curatedCodes` il comportamento storico resta: tutte via modello', async () => {
    const stub = makeStub();
    const agent = new BalanceAgent(stub.provider);
    const world = await agent.generateInitialWorldState(
      template(`tpl-map-complete-b-${RUN}`, '1951-05-01'),
      mapPolities(),
      undefined,
      { mode: 'strict' },
    );
    expect(world.countries.size).toBe(20);
    // 20 politie / 16 per richiesta = 2 blocchi (prima erano 2 per 15 nazioni).
    expect(stub.calls()).toBe(2);
    expect(world.countries.get('AND')!.military).toBe(42);
  });

  it('mondo moderno: la popolazione di riferimento reale resta applicata al baseline', async () => {
    const stub = makeStub();
    const agent = new BalanceAgent(stub.provider);
    const reference = referencePopulation('NPL');
    expect(reference, 'NPL deve avere una popolazione di riferimento').toBeGreaterThan(0);
    const world = await agent.generateInitialWorldState(
      template(`tpl-map-complete-c-${RUN}`, '2020-02-01'),
      mapPolities(),
      undefined,
      { mode: 'strict' },
      CURATED,
    );
    expect(world.countries.get('NPL')!.population).toBe(reference);
    // Le curate restano quelle del modello per gli indici; la popolazione di
    // riferimento reale (comportamento storico) si applica a tutti i mondi moderni.
    expect(world.countries.get('USA')!.military).toBe(42);
    expect(world.countries.get('USA')!.population).toBe(referencePopulation('USA'));
  });
});
