/**
 * GAMEPLAY-LONG P1 — Memoria politica delle fazioni.
 *
 * Tre livelli:
 *  1. funzioni pure: decadimento, fiducia, risentimento, tendenza;
 *  2. lettura politica di una decisione (chi ne esce favorito e chi no);
 *  3. integrazione: la memoria entra nella fotografia del governo, **senza
 *     sostituire** la soddisfazione derivata dai dati, e sopravvive a
 *     save/load/rewind.
 */
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import os from 'os';
import path from 'path';
import fs from 'fs';
import {
  FACTION_MEMORY_HALF_LIFE_DAYS, factionMemoryByFaction, factionMemoryFromPressure,
  factionMemoryState, memoryDecay, pressureInterestFaction, type FactionMemoryEvent,
} from '../src/core/simulation/FactionMemory';
import { governmentSnapshot } from '../src/core/simulation/GovernmentFactions';
import type { NationalAccount } from '../src/core/simulation/WorldStateEngine';

const TEST_DB = path.join(os.tmpdir(), `world-story-faction-memory-${process.pid}-${Date.now()}.db`);
process.env.OPEN_PAX_DB_PATH = TEST_DB;

const WORLD_ID = 'memory_world';
let db: any;
let createGame: () => { gameId: string; session: any };

const stubProvider: any = {
  consolidation: { startRound: 25, chunkSize: 5, keepRawTail: 10 },
  async generate() { return { content: '{}' }; },
  async stream(mechanic: string, _s: string, _u: string, onToken: (chars: number) => void) {
    if (mechanic !== 'jump') throw new Error(`unexpected mechanic ${mechanic}`);
    const content = JSON.stringify({
      events: [{ headline: 'Nessun evento', description: 'Giorni di ordinaria amministrazione.', date: '1951-02-01', mapChanges: [] }],
      narration: 'Il paese tira avanti.',
      voided: [],
      startChat: [],
      worldChanges: { regionOwners: {}, regionColors: {} },
      actionOutcomes: [],
    });
    onToken(content.length);
    return { content };
  },
  clearCache() {},
};

const event = (over: Partial<FactionMemoryEvent> = {}): FactionMemoryEvent => ({
  factionId: 'lavoratori', kind: 'favor', weight: 20, turn: 1, gameDate: '1951-01-01', text: 'Concessioni.', ...over,
});

/** Conto nazionale minimo e stabile: la parte «dati» non deve cambiare nei test. */
function account(over: Partial<NationalAccount> = {}): NationalAccount {
  return {
    polityId: 'ITA', provinces: 20, population: 47_000_000, nominalGdpUsdBillions: 2400,
    stability: 60, socialTension: 30, defenceBurdenPct: 3.5, debtRatioPct: 55,
    forces: 30, mobilized: 1, factories: 12, ports: 6, universities: 4,
    monthlyBalance: 1, monthlyRevenue: 40, monthlyExpense: 39,
    annualGrowthRate: 0.02, taxRatePct: 14, creditResiduePct: 0,
    ...over,
  } as NationalAccount;
}

beforeAll(async () => {
  vi.spyOn(Math, 'random').mockReturnValue(0.42);
  const dbModule = await import('../src/database');
  db = dbModule.default;
  dbModule.initDatabase();
  const repos = await import('../src/repositories');
  const registryModule = await import('../src/session-registry');
  registryModule.initSessionRegistry(stubProvider);
  const registry = registryModule.getSessionRegistry();
  repos.worldRepository.createWithRegions(
    { id: WORLD_ID, name: 'Memory World', description: '', startDate: '1951-01-01', basePrompt: 'Test', historicalAccuracy: 0.8 },
    [
      {
        id: `${WORLD_ID}_ITA`, name: 'Italia', color: '#FF0000', owner: 'ITA',
        population: 47_000_000, gdp: 2400, militaryPower: 110, flag: 'ITA', coastal: true,
        borders: [`${WORLD_ID}_FRA`],
        objects: [{ id: 'f1', type: 'factory', name: 'Acciaierie', level: 4 }],
      },
      {
        id: `${WORLD_ID}_FRA`, name: 'Francia', color: '#0000FF', owner: 'FRA',
        population: 42_000_000, gdp: 2200, militaryPower: 160, flag: 'FRA', coastal: true,
        borders: [`${WORLD_ID}_ITA`],
        objects: [],
      },
    ],
  );
  createGame = () => registry.createSession(WORLD_ID, 'Player', `${WORLD_ID}_ITA`, '#FF0000');
});

afterAll(() => {
  vi.restoreAllMocks();
  try {
    db?.close();
    for (const suffix of ['', '-wal', '-shm']) {
      const file = TEST_DB + suffix;
      if (fs.existsSync(file)) fs.rmSync(file);
    }
  } catch { /* tmp */ }
});

describe('memoria politica: funzioni pure', () => {
  it('senza eventi la fazione è neutrale, non «dimenticata male»', () => {
    const state = factionMemoryState([], { today: '1951-06-01' });
    expect(state.trust).toBe(50);
    expect(state.resentment).toBe(0);
    expect(state.trend).toBe('stabile');
    expect(state.lastEvent).toBeNull();
    expect(state.pressure).toBe(0);
  });

  it('un favore alza la fiducia, un torto la abbassa e lascia risentimento', () => {
    const favor = factionMemoryState([event({ weight: 20 })], { today: '1951-01-01' });
    const grievance = factionMemoryState([event({ kind: 'grievance', weight: -20 })], { today: '1951-01-01' });
    expect(favor.trust).toBeGreaterThan(50);
    expect(grievance.trust).toBeLessThan(50);
    expect(grievance.resentment).toBeGreaterThan(0);
    expect(favor.resentment).toBe(0);
    expect(favor.favors).toBe(1);
    expect(grievance.grievances).toBe(1);
    // La memoria pesa sulla pressione: chi è stato tradito preme di più.
    expect(grievance.pressure).toBeGreaterThan(0);
    expect(favor.pressure).toBeLessThan(0);
  });

  it('la stessa fazione favorita e poi danneggiata ha memoria di entrambe le cose', () => {
    const state = factionMemoryState([
      event({ turn: 1, gameDate: '1951-01-01', kind: 'favor', weight: 25, text: 'Concessioni ai sindacati.' }),
      event({ turn: 4, gameDate: '1951-04-01', kind: 'grievance', weight: -22, text: 'Promessa tradita sulle tasse.' }),
    ], { today: '1951-04-02' });
    expect(state.favors).toBe(1);
    expect(state.grievances).toBe(1);
    expect(state.trust).toBeLessThan(55);
    expect(state.resentment).toBeGreaterThan(15);
    // L'ultima decisione significativa è quella recente, non la prima.
    expect(state.lastEvent?.text).toContain('Promessa tradita');
    // Tendenza: con un favore e un torto la rotta resta stabile, non invertita.
    expect(state.trend).toBe('stabile');
    // Un secondo torto consecutivo inverte davvero la tendenza.
    expect(factionMemoryState([
      event({ turn: 1, gameDate: '1951-01-01', kind: 'favor', weight: 25 }),
      event({ turn: 4, gameDate: '1951-04-01', kind: 'grievance', weight: -22 }),
      event({ turn: 5, gameDate: '1951-04-15', kind: 'grievance', weight: -20 }),
    ], { today: '1951-04-16' }).trend).toBe('in calo');
  });

  it('la memoria decade col tempo di gioco (un torto vecchio pesa meno)', () => {
    const recent = memoryDecay('1951-01-01', '1951-01-11');
    const half = memoryDecay('1951-01-01', '1951-06-30');
    const old = memoryDecay('1951-01-01', '1961-01-01');
    expect(recent).toBeGreaterThan(0.9);
    expect(half).toBeCloseTo(0.5, 1);
    expect(old).toBeLessThan(0.1);
    expect(old).toBeGreaterThan(0);
    // Una semivita esatta dimezza il peso.
    expect(memoryDecay('1951-01-01', '1951-06-30', FACTION_MEMORY_HALF_LIFE_DAYS)).toBeCloseTo(0.5005, 2);
    // Stessa data, stesso stato: nessuna casualità.
    expect(factionMemoryState([event({ weight: -30 })], { today: '1952-01-01' }).resentment)
      .toBeLessThan(factionMemoryState([event({ weight: -30 })], { today: '1951-01-02' }).resentment);
  });

  it('raggruppa la memoria per fazione', () => {
    const grouped = factionMemoryByFaction([
      event({ factionId: 'lavoratori', weight: 10 }),
      event({ factionId: 'finanza', kind: 'grievance', weight: -8 }),
      event({ factionId: 'lavoratori', kind: 'grievance', weight: -4, gameDate: '1951-02-01', turn: 2 }),
    ], { today: '1951-02-02' });
    expect(Object.keys(grouped).sort()).toEqual(['finanza', 'lavoratori']);
    expect(grouped.lavoratori.favors).toBe(1);
    expect(grouped.lavoratori.grievances).toBe(1);
    expect(grouped.finanza.resentment).toBeGreaterThan(0);
  });
});

describe('memoria politica: lettura di una decisione', () => {
  const strike = {
    pressureId: 'internal:strike-wave#t1', template: 'strike-wave', kind: 'internal',
    title: 'Scioperi dei portuali', severity: 2, gameDate: '1951-03-01', turn: 3,
  };

  it('chi porta la richiesta è la fazione del tema', () => {
    expect(pressureInterestFaction('strike-wave', 'internal')).toBe('lavoratori');
    expect(pressureInterestFaction('inflation-spiral', 'internal')).toBe('finanza');
    expect(pressureInterestFaction('veterans-unrest', 'internal')).toBe('militari');
    expect(pressureInterestFaction('tematica-ignota', 'external')).toBe('industriali');
    expect(pressureInterestFaction('tematica-ignota', 'internal')).toBe('opinione');
  });

  it('una concessione è un favore per i lavoratori, la rottura un torto', () => {
    const concede = factionMemoryFromPressure({
      ...strike, optionId: 'concede', optionLabel: 'Concedere aumenti',
      effect: { socialTension: -14, revenueMultiplierDelta: -0.06, growthModifier: -0.002 },
    });
    const primary = concede.find(item => item.factionId === 'lavoratori')!;
    expect(primary.kind).toBe('favor');
    expect(primary.weight).toBeGreaterThan(0);
    // La spesa pubblica non passa inosservata ai creditori.
    expect(concede.some(item => item.factionId === 'finanza' && item.kind === 'grievance')).toBe(true);

    const broke = factionMemoryFromPressure({
      ...strike, optionId: 'break', optionLabel: 'Rompere lo sciopero',
      effect: { stability: -6, socialTension: 9 },
    });
    const workers = broke.find(item => item.factionId === 'lavoratori')!;
    expect(workers.kind).toBe('grievance');
    expect(workers.weight).toBeLessThan(0);
    // Una decisione che invece ristabilisce l'ordine piace ai comandi.
    const negotiated = factionMemoryFromPressure({
      ...strike, optionId: 'negotiate', optionLabel: 'Aprire il tavolo',
      effect: { stability: 2, socialTension: -8 },
    });
    expect(negotiated.some(item => item.factionId === 'militari' && item.kind === 'favor')).toBe(true);
  });

  it('una sfida scaduta senza risposta è un torto che non si dimentica', () => {
    const ignored = factionMemoryFromPressure({ ...strike, optionId: null, severity: 3 });
    const workers = ignored.find(item => item.factionId === 'lavoratori')!;
    expect(workers.kind).toBe('ignored');
    expect(workers.weight).toBeLessThanOrEqual(-15);
    expect(workers.text).toContain('senza risposta');
  });

  it('nessun evento senza peso politico: la memoria non si riempie di rumore', () => {
    const neutral = factionMemoryFromPressure({
      ...strike, optionId: 'defer', effect: {},
    });
    // Una decisione che non cambia nulla non è «significativa»: non entra.
    expect(neutral).toEqual([]);
  });
});

describe('memoria politica: fotografia del governo', () => {
  const today = '1951-04-01';

  it('la memoria NON sostituisce la soddisfazione derivata dai dati', () => {
    const base = governmentSnapshot(account(), null);
    const withMemory = governmentSnapshot(account(), {
      today,
      events: [
        { factionId: 'lavoratori', kind: 'grievance', weight: -30, turn: 1, gameDate: '1951-03-01', text: 'Welfare tagliato.' },
      ],
    });
    const labour = (snapshot: any) => snapshot.factions.find((item: any) => item.id === 'lavoratori');
    // I numeri del bilancio restano l'unica fonte della soddisfazione.
    expect(labour(withMemory).satisfaction).toBe(labour(base).satisfaction);
    expect(labour(withMemory).stance).toBe(labour(base).stance);
    // La memoria entra come pressione politica e come racconto.
    expect(labour(withMemory).pressure).toBeGreaterThan(labour(base).pressure);
    expect(labour(withMemory).politicalMemory.trust).toBeLessThan(50);
    expect(labour(withMemory).politicalMemory.lastEvent.text).toContain('Welfare');
    expect(withMemory.resentful.map((item: any) => item.factionId)).toContain('lavoratori');
    expect(withMemory.trustIndex).not.toBeNull();
  });

  it('senza memoria la fotografia è identica a prima', () => {
    const base = governmentSnapshot(account(), null);
    const empty = governmentSnapshot(account(), { today, events: [] });
    expect(empty.factions.map((item: any) => item.pressure)).toEqual(base.factions.map((item: any) => item.pressure));
    expect(base.trustIndex).toBeNull();
    expect(base.resentful).toEqual([]);
    expect(base.factions.every((item: any) => item.politicalMemory === undefined)).toBe(true);
  });

  it('un favore recente riduce la pressione ma non cancella la storia', () => {
    const base = governmentSnapshot(account(), null);
    const pleased = governmentSnapshot(account(), {
      today,
      events: [{ factionId: 'militari', kind: 'favor', weight: 25, turn: 5, gameDate: '1951-03-28', text: 'Riarmo finanziato.' }],
    });
    const military = (snapshot: any) => snapshot.factions.find((item: any) => item.id === 'militari');
    expect(military(pleased).pressure).toBeLessThanOrEqual(military(base).pressure);
    expect(military(pleased).politicalMemory.trust).toBeGreaterThan(50);
    expect(pleased.resentful).toEqual([]);
  });
});

describe('memoria politica: persistenza e ciclo di vita', () => {
  const pressure = (id: string, option: any) => ({
    id, kind: 'internal' as const, template: 'strike-wave',
    title: `Scioperi ${id}`, detail: 'I portuali incrociano le braccia.',
    severity: 2 as const, source: 'Sindacati dei portuali', durationDays: 90,
    options: [option],
    inaction: { socialTension: 8, stability: -3, note: 'Scioperi ignorati: la protesta si allarga.' },
  });

  it('la decisione del giocatore entra nella memoria e nella fotografia', async () => {
    const { session } = createGame();
    const repos = await import('../src/repositories');
    const player = session.getPlayer();
    repos.gameRepository.insertPressures(session.id, player.polityId, [
      pressure('test:memory#a', {
        id: 'concede', label: 'Concedere aumenti', detail: 'Salari più alti.',
        effect: { socialTension: -14, revenueMultiplierDelta: -0.06, note: 'Aumenti concessi.' },
      }),
    ], session.getCurrentDate(), session.getCurrentTurn());

    const before = session.getGovernment();
    const result = session.resolvePeacetimePressure('test:memory#a', 'concede');
    expect(result.memory.length).toBeGreaterThan(0);
    expect(result.memory.some((item: any) => item.factionId === 'lavoratori' && item.weight > 0)).toBe(true);

    const after = session.getGovernment();
    const labourAfter = after.factions.find((item: any) => item.id === 'lavoratori');
    expect(labourAfter.politicalMemory.trust).toBeGreaterThan(50);
    expect(after.trustIndex).not.toBeNull();

    // La memoria NON sostituisce i dati: a parità di conto nazionale, cambia
    // solo la pressione politica (e il racconto), non la soddisfazione.
    const control = governmentSnapshot(session.getNationalAccounts()[player.polityId], null);
    const labourControl = control.factions.find((item: any) => item.id === 'lavoratori');
    expect(labourAfter.satisfaction).toBe(labourControl.satisfaction);
    expect(labourAfter.stance).toBe(labourControl.stance);
    expect(labourAfter.pressure).toBeLessThan(labourControl.pressure);
    expect(before.trustIndex).toBeNull();

    // Gli eventi sono in banca dati, non in memoria di processo.
    const rows = repos.factionMemoryRepository.list(session.id, { polityId: player.polityId });
    expect(rows.length).toBe(result.memory.length);
  });

  it('favorita e poi danneggiata: la fiducia scende e il risentimento resta', async () => {
    const { session } = createGame();
    const repos = await import('../src/repositories');
    const player = session.getPlayer();
    repos.gameRepository.insertPressures(session.id, player.polityId, [
      pressure('test:memory#favor', {
        id: 'concede', label: 'Concedere aumenti', detail: 'Salari più alti.',
        effect: { socialTension: -14, revenueMultiplierDelta: -0.06, note: 'Aumenti concessi.' },
      }),
    ], session.getCurrentDate(), session.getCurrentTurn());
    session.resolvePeacetimePressure('test:memory#favor', 'concede');
    const afterFavor = session.getGovernment().factions.find((item: any) => item.id === 'lavoratori').politicalMemory;

    repos.gameRepository.insertPressures(session.id, player.polityId, [
      pressure('test:memory#hurt', {
        id: 'break', label: 'Rompere lo sciopero', detail: 'Precettazione.',
        effect: { stability: -6, socialTension: 9, note: 'Sciopero rotto.' },
      }),
    ], session.getCurrentDate(), session.getCurrentTurn());
    session.resolvePeacetimePressure('test:memory#hurt', 'break');
    const afterHurt = session.getGovernment().factions.find((item: any) => item.id === 'lavoratori').politicalMemory;

    expect(afterHurt.trust).toBeLessThan(afterFavor.trust);
    expect(afterHurt.resentment).toBeGreaterThan(0);
    expect(afterHurt.grievances).toBeGreaterThanOrEqual(1);
    expect(afterHurt.lastEvent.kind).toBe('grievance');
  });

  it('sopravvive a save e load: il mondo ricorda anche dopo il ripristino', async () => {
    const { gameId, session } = createGame();
    const repos = await import('../src/repositories');
    const player = session.getPlayer();
    repos.gameRepository.insertPressures(gameId, player.polityId, [
      pressure('test:memory#save', {
        id: 'concede', label: 'Concedere aumenti', detail: 'Salari più alti.',
        effect: { socialTension: -14, note: 'Aumenti concessi.' },
      }),
    ], session.getCurrentDate(), session.getCurrentTurn());
    session.resolvePeacetimePressure('test:memory#save', 'concede');
    const expected = session.getGovernment().factions.find((item: any) => item.id === 'lavoratori').politicalMemory.trust;

    const { GameSession } = await import('../src/game-session');
    const restored = new GameSession(gameId, WORLD_ID, stubProvider);
    await restored.reconstructFromDB({
      currentTurn: session.getCurrentTurn(),
      currentDate: session.getCurrentDate(),
      players: [session.getPlayer()],
    });
    const memory = restored.getGovernment().factions.find((item: any) => item.id === 'lavoratori').politicalMemory;
    expect(memory.trust).toBe(expected);
    expect(memory.lastEvent).toBeTruthy();
  });

  it('il rewind cancella la memoria delle decisioni annullate', async () => {
    const { gameId, session } = createGame();
    const repos = await import('../src/repositories');
    const player = session.getPlayer();
    const before = repos.factionMemoryRepository.list(gameId, { polityId: player.polityId }).length;

    // Turno 1 → 2: il rewind conserva la memoria del turno a cui si torna.
    await session.advanceDate(30);
    repos.gameRepository.insertPressures(gameId, player.polityId, [
      pressure('test:memory#rewind', {
        id: 'concede', label: 'Concedere aumenti', detail: 'Salari più alti.',
        effect: { socialTension: -14, note: 'Aumenti concessi.' },
      }),
    ], session.getCurrentDate(), session.getCurrentTurn());
    session.resolvePeacetimePressure('test:memory#rewind', 'concede');
    expect(repos.factionMemoryRepository.list(gameId, { polityId: player.polityId }).length).toBeGreaterThan(before);

    const rewound = session.rewind();
    expect(rewound).toBeTruthy();
    const after = repos.factionMemoryRepository.list(gameId, { polityId: player.polityId });
    expect(after.some((row: any) => row.sourceEventId === 'pressure:test:memory#rewind')).toBe(false);
    expect(session.getGovernment().factions.find((item: any) => item.id === 'lavoratori').politicalMemory?.trust ?? 50)
      .toBe(50);
  });
});
