/**
 * Date del debito ereditato e nomi dei paesi nelle relazioni.
 * =========================================================
 * Due difetti di identità e di scala, misurati il 2026-09-24.
 *
 * 1. **Il debito nasceva nel 1951.** `SessionBootstrapService.initialize()`
 *    seminava il magazzino (`seedInitialResources`) *prima* di assegnare la data
 *    del mondo, quindi `seedStock` leggeva il default dello stato
 *    (`1951-01-01`). In un mondo del 2000 i titoli erediti nascevano con
 *    `issued=1951-01-01` e **scaduti da decenni** (1954/1959/1966): la scadenza
 *    media del dossier valeva zero, perché ogni titolo era oltre la maturità.
 *
 * 2. **Il nome del paese era quello di una provincia.** Il read model
 *    diplomatico ricavava il nome della polity dalla provincia capitale,
 *    quindi `ITA` si leggeva «Aosta». Il nome viene ora dal motore
 *    (`getRelationshipNames`, la stessa fonte di tutto il resto).
 */
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import os from 'os';
import path from 'path';
import fs from 'fs';
import {
  addYears, normalizeInheritedDebtDates, type SovereignDebt,
} from '../src/core/simulation/SovereignDebt';

const TEST_DB = path.join(os.tmpdir(), `world-story-debt-dates-${process.pid}-${Date.now()}.db`);
process.env.OPEN_PAX_DB_PATH = TEST_DB;

/** Un mondo per ogni epoca da verificare: il difetto dipende dalla data. */
const WORLDS = [
  { id: 'dd_1815', start: '1815-06-09', code: 'ITA' },
  { id: 'dd_1989', start: '1989-06-04', code: 'ITA' },
  { id: 'dd_2000', start: '2000-01-01', code: 'ITA' },
  { id: 'dd_2024', start: '2024-01-01', code: 'ITA' },
  { id: 'dd_2026', start: '2026-01-01', code: 'ITA' },
  { id: 'dd_usa_2000', start: '2000-01-01', code: 'USA' },
  { id: 'dd_usa_2024', start: '2024-01-01', code: 'USA' },
];

let db: any;
let repos: any;
let createGame: (worldId: string, start: string) => { gameId: string; session: any };

const stubProvider: any = {
  consolidation: { startRound: 25, chunkSize: 5, keepRawTail: 10 },
  async generate() { return { content: '{}' }; },
  async stream() { return { content: '{}' }; },
  clearCache() {},
};

beforeAll(async () => {
  vi.spyOn(Math, 'random').mockReturnValue(0.42);
  const dbModule = await import('../src/database');
  db = dbModule.default;
  dbModule.initDatabase();
  repos = await import('../src/repositories');
  const registryModule = await import('../src/session-registry');
  registryModule.initSessionRegistry(stubProvider);
  const registry = registryModule.getSessionRegistry();
  for (const world of WORLDS) {
    repos.worldRepository.createWithRegions(
      { id: world.id, name: world.id, description: '', startDate: world.start, basePrompt: 'Test', historicalAccuracy: 0.8 },
      [{
        id: `${world.id}_${world.code}`, name: world.code === 'ITA' ? 'Italia' : 'Stati Uniti', color: '#FF0000', owner: world.code,
        population: 59_000_000, gdp: 2300, militaryPower: 110, flag: world.code,
        coastal: true, borders: [], objects: [],
      }],
    );
  }
  createGame = (worldId: string, start: string) => {
    const world = WORLDS.find(w => w.id === worldId)!;
    return registry.createSession(worldId, 'Player', `${worldId}_${world.code}`, '#FF0000');
  };
});

afterAll(() => {
  vi.restoreAllMocks();
  try {
    db?.close();
    for (const suffix of ['', '-wal', '-shm']) {
      const file = TEST_DB + suffix;
      if (fs.existsSync(file)) fs.unlinkSync(file);
    }
  } catch { /* tmp */ }
});

describe('date del debito ereditato — la scala è quella del mondo', () => {
  // Il criterio di accettazione: in nessun mondo i titoli con cui una nazione
  // entra in scena possono essere emessi in un'altra epoca, né già scaduti.
  it('ogni mondo nasce con titoli datati alla propria data di partenza', async () => {
    // La presenza è obbligatoria quando esiste un riferimento dell'anno:
    // USA nel 2000 e nel 2024, ITA solo nel 2024. Nessun debito inventato
    // per le epoche senza dati; tutti i titoli validi devono restare nella loro epoca.
    for (const world of WORLDS) {
      const { gameId } = createGame(world.id, world.start);
      const row: any = repos.resourceRepository.get(gameId, world.code);
      const debts: SovereignDebt[] = row?.stock?.debts ?? [];
      if (world.start.startsWith('2024') || world.code === 'USA') {
        expect(debts.length, `${world.id}: nessun titolo seminato`).toBeGreaterThan(0);
      }
      for (const debt of debts) {
        expect(debt.issuedDate, `${world.id} ${debt.id}: emissione fuori epoca`)
          .toBe(world.start);
      }
    }
  }, 180_000);

  it('nessun titolo è già scaduto alla data di partenza', async () => {
    for (const world of WORLDS) {
      const { gameId } = createGame(world.id, world.start);
      const row: any = repos.resourceRepository.get(gameId, world.code);
      const debts: SovereignDebt[] = row?.stock?.debts ?? [];
      for (const debt of debts) {
        expect(debt.maturityDate > world.start,
          `${world.id} ${debt.id}: scadenza ${debt.maturityDate} già passata (${world.start})`).toBe(true);
      }
    }
  }, 180_000);

  it('il magazzino salvato porta la data del mondo, non un default', async () => {
    const world = WORLDS.find(w => w.id === 'dd_2000')!;
    const { gameId } = createGame(world.id, world.start);
    const row: any = repos.resourceRepository.get(gameId, 'ITA');
    const recorded = row?.updatedDate ?? row?.updated_date;
    expect(recorded).toBe(world.start);
  }, 120_000);

  it('la scadenza media del debito disponibile è quella reale, non zero', async () => {
    for (const world of WORLDS.filter(w => w.start.startsWith('2024') || w.code === 'USA')) {
      const { session } = createGame(world.id, world.start);
      const resources: any = session.getResources();
      const years: number = resources.debt?.averageMaturityYears ?? resources.averageMaturityYears;
      // La scaletta è 3/8/15 anni: la media ponderata sta nell'ordine degli anni,
      // mai a zero (che era il sintomo dei titoli già scaduti).
      expect(years, world.id).toBeGreaterThan(1);
      expect(years, world.id).toBeLessThan(20);
    }
  }, 120_000);

  it.each(['dd_2000', 'dd_2026'])('%s: senza un dato di debito dell’anno non eredita i titoli 2024', async (worldId) => {
    const world = WORLDS.find(w => w.id === worldId)!;
    const { gameId } = createGame(world.id, world.start);
    const row: any = repos.resourceRepository.get(gameId, world.code);
    expect(row).toBeDefined();
    expect(row.stock.debts).toHaveLength(0);
  }, 120_000);
});

describe('normalizeInheritedDebtDates — bonifica dei salvataggi sbagliati', () => {
  const legacy: SovereignDebt[] = [
    { id: 'debt-inherited-1', label: 'Debito ereditato 3 anni', principal: 30, annualRatePct: 2.6,
      issuedDate: '1951-01-01', maturityDate: '1954-01-01', termYears: 3 },
    { id: 'debt-inherited-2', label: 'Debito ereditato 8 anni', principal: 40, annualRatePct: 3,
      issuedDate: '1951-01-01', maturityDate: '1959-01-01', termYears: 8 },
    { id: 'debt-player', label: 'Titolo 10 anni', principal: 5, annualRatePct: 4.2,
      issuedDate: '2026-02-01', maturityDate: '2036-02-01', termYears: 10 },
  ];

  it('riporta le tranche ereditate alla data del mondo, scadenza ricalcolata', () => {
    const { debts, changed } = normalizeInheritedDebtDates(legacy, '2000-01-01');
    expect(changed).toBe(true);
    const inherited = debts.filter(d => d.id.startsWith('debt-inherited-'));
    expect(inherited).toHaveLength(2);
    for (const debt of inherited) {
      expect(debt.issuedDate).toBe('2000-01-01');
      expect(debt.maturityDate).toBe(addYears('2000-01-01', debt.termYears));
    }
    // Il debito del giocatore non si tocca, in nessun campo.
    expect(debts.find(d => d.id === 'debt-player')).toEqual(legacy[2]);
  });

  it('è idempotente', () => {
    const once = normalizeInheritedDebtDates(legacy, '2000-01-01');
    const twice = normalizeInheritedDebtDates(once.debts, '2000-01-01');
    expect(twice.changed).toBe(false);
    expect(twice.debts).toEqual(once.debts);
  });

  it('non tocca un portafoglio già sulla scala del mondo', () => {
    const good: SovereignDebt[] = legacy.map(d => ({ ...d, issuedDate: '2000-01-01' }));
    expect(normalizeInheritedDebtDates(good, '2000-01-01').changed).toBe(false);
  });

  it('lascia intatto un portafoglio senza debito ereditato', () => {
    const clean: SovereignDebt[] = [legacy[2]];
    const { changed, debts } = normalizeInheritedDebtDates(clean, '2000-01-01');
    expect(changed).toBe(false);
    expect(debts).toEqual(clean);
  });

  it('una data di mondo non valida non produce danni', () => {
    const { changed, debts } = normalizeInheritedDebtDates(legacy, 'non-una-data');
    expect(changed).toBe(false);
    expect(debts).toEqual(legacy);
  });
});

describe('nomi dei paesi nelle relazioni', () => {
  /**
   * La matrice vive nella sessione (è caricata al bootstrap): per il test si
   * scrive su quella, che è la stessa istanza che `getRelationshipNames` legge.
   */
  function seedRelations(session: any, rows: Array<[string, string, string]>): void {
    const matrix = session.diplomacy.matrix();
    for (const [from, to, rel] of rows) matrix.set(from, to, rel as never);
  }

  it('il motore espone un nome pubblico per ogni polity citata', async () => {
    const world = WORLDS.find(w => w.id === 'dd_2026')!;
    const { session } = createGame(world.id, world.start);
    seedRelations(session, [['ITA', 'FRA', 'ally'], ['ITA', 'DEU', 'neutral'], ['ITA', 'GBR', 'hostile']]);

    const names: Record<string, string> = session.getRelationshipNames();
    for (const code of ['ITA', 'FRA', 'DEU', 'GBR']) {
      expect(names[code], `${code} senza nome pubblico`).toBeTruthy();
      // Il difetto era il nome di una **provincia**: un nome di paese non è il
      // proprio codice in maiuscolo.
      expect(names[code], `${code} risolto al proprio codice`).not.toBe(code);
    }
    // Il nome dell'Italia è quello del registro dei paesi, non quello di una città.
    expect(names.ITA).toBe('Italia');
  }, 120_000);

  it('`neutral` non è una polity e resta fuori dalla mappa dei nomi', async () => {
    const world = WORLDS.find(w => w.id === 'dd_2026')!;
    const { session } = createGame(world.id, world.start);
    seedRelations(session, [['ITA', 'FRA', 'ally']]);
    const names: Record<string, string> = session.getRelationshipNames();
    expect(names.FRA).toBeTruthy();
    expect(names.neutral).toBeUndefined();
  }, 120_000);
});
