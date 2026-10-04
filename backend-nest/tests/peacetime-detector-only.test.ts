/**
 * WS-GOV-REALITY-ADVISOR-HARDENING — P0/P13: le Pressure NON sono più quest.
 *
 * Il ciclo legacy resta DETECTOR / READ-ONLY: può aggiornare SOLO lo stato di
 * lettura (scaduta / inasprita) e non applica effetti, non genera conseguenze,
 * non apre nuove quest. Il mondo cambia solo con ordini e atti eseguiti.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const DB = path.join(os.tmpdir(), `world-story-pressure-detector-${process.pid}-${Date.now()}.db`);
process.env.OPEN_PAX_DB_PATH = DB;

let db: typeof import('../src/database').default;
let session: import('../src/game-session').GameSession;
let registry: import('../src/session-registry').SessionRegistry;
let games: typeof import('../src/repositories/game.repository').gameRepository;
const worldId = 'detector_world';
const stubProvider: any = {
  consolidation: { startRound: 25, chunkSize: 5, keepRawTail: 10 },
  async generate() { return { content: '{}' }; },
  async stream() { return { content: '{}' }; },
  clearCache() {},
};

const pressure = (overrides: Record<string, unknown> = {}) => ({
  id: 'legacy:harvest-failure', kind: 'internal' as const, template: 'harvest-failure',
  title: 'Scorte alimentari in esaurimento', detail: 'Il grano copre meno di un mese.',
  severity: 3 as const, source: 'Contadini e mercati',
  options: [{ id: 'import', label: 'Importare grano', detail: 'Cassa subito.' }],
  // L'effetto di inazione è DEVASTANTE di proposito: se il vecchio ciclo lo
  // applicasse ancora, i numeri del mondo lo mostrerebbero subito.
  inaction: { stability: -40, socialTension: +40, moneyDeltaMld: -50, note: 'penalità di inerzia' },
  durationDays: 10,
  ...overrides,
});

const insert = (record: Record<string, unknown>, date = '1950-12-01', turn = 1) =>
  games.insertPressures(session.id, 'UGA', [record as never], date, turn);

beforeAll(async () => {
  const database = await import('../src/database');
  db = database.default;
  database.initDatabase();
  const repos = await import('../src/repositories');
  games = repos.gameRepository;
  const registryModule = await import('../src/session-registry');
  registryModule.initSessionRegistry(stubProvider);
  registry = registryModule.getSessionRegistry();
  repos.worldRepository.createWithRegions(
    { id: worldId, name: 'Detector world', description: '', startDate: '1951-01-01', basePrompt: 'Test', historicalAccuracy: 0.8 },
    [{ id: `${worldId}_UGA`, name: 'Uganda', color: '#FF0000', owner: 'UGA',
      population: 5_000_000, gdp: 200, militaryPower: 40, flag: 'UGA', coastal: false, borders: [], objects: [] }],
  );
});
beforeEach(() => {
  const created = registry.createSession(worldId, 'Presidente', `${worldId}_UGA`, '#FF0000');
  session = registry.getSession(created.gameId)!;
});
afterAll(() => {
  db?.close();
  for (const suffix of ['', '-wal', '-shm']) fs.rmSync(DB + suffix, { force: true });
});

const refresh = () => (session as any).nationState.refreshPeacetimePressures();
const ensure = () => (session as any).nationState.ensurePeacetimePressures();
const rows = () => games.listPressures(session.id);
const facts = () => session.getVerifiedWorldSnapshot().facts;

describe('PeacetimePressures — detector / read-only', () => {
  it('una Pressure oltre la scadenza non applica piu l\u2019effetto di inazione', () => {
    // Aperta 40 giorni fa con finestra di 10: scaduta rispetto alla data corrente.
    insert(pressure(), '1950-11-22', 1);
    const before = session.getVerifiedWorldSnapshot();
    const stabilityBefore = before.facts.stability?.rawValue ?? null;
    const tensionBefore = before.facts.socialTension?.rawValue ?? null;
    const moneyBefore = session.getNationalAccounts()['UGA']?.money ?? null;

    refresh();

    const record = rows().find(item => item.id === 'legacy:harvest-failure')!;
    // Lo stato di LETTURA può cambiare (scaduta)…
    expect(record.status).toBe('expired');
    // …ma nessun effetto canonico è stato applicato.
    const after = session.getVerifiedWorldSnapshot();
    expect(after.facts.stability?.rawValue ?? null).toBe(stabilityBefore);
    expect(after.facts.socialTension?.rawValue ?? null).toBe(tensionBefore);
    expect(session.getNationalAccounts()['UGA']?.money ?? null).toBe(moneyBefore);
  });

  it('una Pressure grave non produce l\u2019inasprimento canonico', () => {
    // Finestra 100 giorni, trascorsi ~70 (> 60%): escalationDue ma non scaduta.
    insert(pressure({ id: 'legacy:escalating', durationDays: 100, inaction: { stability: -30, note: 'inasprimento' } }), '1950-10-23', 1);
    const stabilityBefore = session.getVerifiedWorldSnapshot().facts.stability?.rawValue ?? null;
    refresh();
    const record = rows().find(item => item.id === 'legacy:escalating')!;
    expect(record.status).toBe('active');
    expect(Boolean(record.escalated)).toBe(true); // stato di lettura, non effetto
    expect(session.getVerifiedWorldSnapshot().facts.stability?.rawValue ?? null).toBe(stabilityBefore);
  });

  it('non nascono conseguenze automatiche né nuove Pressure quest', () => {
    insert(pressure(), '1950-11-22', 1);
    ensure();
    refresh();
    const all = rows();
    // Solo la riga legacy inserita: nessuna nuova quest, nessuna conseguenza.
    expect(all).toHaveLength(1);
    expect(all.some(record => record.originSourcePressureId)).toBe(false);
  });

  it('ensurePeacetimePressures non apre quest a meta turno', () => {
    ensure();
    expect(rows()).toHaveLength(0);
  });

  it('WS-GOV-REALITY-CLEANUP: una Pressure expirata NON produce follow-up, una risolta sì', async () => {
    // 1) Scaduta in detector/read-only: mai un rapporto.
    insert(pressure({ id: 'legacy:expired-fu' }), '1950-11-22', 1);
    refresh();
    expect(rows().find(row => row.id === 'legacy:expired-fu')!.status).toBe('expired');
    expect(session.getPeacetimePressures().followUps.some(item => item.pressureId === 'legacy:expired-fu')).toBe(false);

    // 2) Decisione realmente presa (percorso legacy esplicito): il rapporto arriva.
    insert(pressure({
      id: 'legacy:resolved-fu',
      options: [{ id: 'import', label: 'Importare grano', detail: 'Cassa subito.', effect: { socialTension: -4, note: 'Armatori ricevuti.' } }],
    }), '1950-12-01', 1);
    session.resolvePeacetimePressure('legacy:resolved-fu', 'import');
    await session.advanceDate(31);
    expect(session.getPeacetimePressures().followUps.some(item => item.pressureId === 'legacy:resolved-fu')).toBe(true);
  });

  it('un save legacy con Pressure attive resta caricabile e leggibile', () => {
    insert(pressure({ id: 'legacy:open', durationDays: 3650 }), '1950-12-01', 1);
    const snapshot = session.getVerifiedWorldSnapshot();
    expect(snapshot.recent.decisions ?? []).toBeDefined();
    expect(rows().some(record => record.id === 'legacy:open')).toBe(true);
    // Il flusso Consulente non tocca le opzioni Pressure legacy.
    expect(facts().ports?.value).toBe('Porti posseduti: nessuno');
  });
});
