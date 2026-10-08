/**
 * Cache dei conti base della sessione.
 * ===================================
 * `sessionAccounts()` aggrega **tutte** le regioni del mondo (su un mondo
 * storico ~35 ms) ed è richiesta molte volte per la stessa fotografia
 * (Dossier, crisi, risorse, oggetti). La base del motore è quindi memoizzata,
 * ma deve restare **viva**: una mutazione persistita delle regioni
 * (`syncRegionsToDB`, il choke point di ogni cambio mappa — conquiste, armate,
 * avanzamento del mondo) deve farsi vedere alla lettura successiva. Questo test
 * difende quell'invariante: se la cache non venisse invalidata, il giocatore
 * vedrebbe numeri vecchi di una mappa che è già cambiata.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const DB = path.join(os.tmpdir(), `session-accounts-cache-${process.pid}-${Date.now()}.db`);
process.env.OPEN_PAX_DB_PATH = DB;
let db: typeof import('../src/database').default;
let registry: import('../src/session-registry').SessionRegistry;
let repositories: typeof import('../src/repositories');
const generate = vi.fn(async () => { throw new Error('No provider in a cache test'); });
const provider: any = { generate, stream: generate, clearCache() {}, consolidation: { startRound: 25, chunkSize: 5, keepRawTail: 10 } };

beforeAll(async () => {
  const database = await import('../src/database');
  db = database.default; database.initDatabase();
  repositories = await import('../src/repositories');
  const sessions = await import('../src/session-registry');
  sessions.initSessionRegistry(provider); registry = sessions.getSessionRegistry();
  repositories.worldRepository.createWithRegions(
    { id: 'cache-2000', name: 'Cache 2000', startDate: '2000-01-01', basePrompt: 'Mock only' },
    [
      { id: 'region-AAA', name: 'AAA', owner: 'AAA', flag: 'AAA', population: 50_000_000, gdp: 500, militaryPower: 50, coastal: true, borders: [], objects: [], color: '#000' },
      { id: 'region-BBB', name: 'BBB', owner: 'BBB', flag: 'BBB', population: 10_000_000, gdp: 100, militaryPower: 10, coastal: false, borders: [], objects: [], color: '#111' },
    ],
  );
});
afterAll(() => { db?.close(); for (const suffix of ['', '-wal', '-shm']) fs.rmSync(DB + suffix, { force: true }); });

describe('cache dei conti base della sessione', () => {
  it('non serve una fotografia stantia dopo una mutazione persistita delle regioni', () => {
    const session = registry.createSession('cache-2000', 'Presidente', 'region-AAA').session;
    const first = session.getNationalAccounts().AAA.nominalGdpUsdBillions;
    expect(first).toBeGreaterThan(0);
    // Letture ripetute: stessa fotografia, nessun ricalcolo incoerente.
    expect(session.getNationalAccounts().AAA.nominalGdpUsdBillions).toBe(first);

    // Mutazione della mappa — una provincia cresce e viene persistita, come
    // dopo una conquista o l'avanzamento di un turno.
    const region = session.getRegion('region-AAA');
    expect(region).toBeTruthy();
    region!.gdp = region!.gdp * 4;
    session.syncRegionsToDB();

    const after = session.getNationalAccounts().AAA.nominalGdpUsdBillions;
    expect(after).toBeGreaterThan(first);
  });

  it('espone tutte le polity del teatro, non solo quella giocata', () => {
    const session = registry.createSession('cache-2000', 'Presidente', 'region-BBB').session;
    const accounts = session.getNationalAccounts();
    expect(accounts.BBB.nominalGdpUsdBillions).toBeGreaterThan(0);
    expect(accounts.AAA.nominalGdpUsdBillions).toBeGreaterThan(0);
  });
});
