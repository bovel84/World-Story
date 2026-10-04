/**
 * Integrazione: le leve del giocatore.
 *   - la pressione fiscale è una scelta del giocatore, persistita e visibile
 *     nei conti nazionali (entrate, saldo, stabilità, tensione, crescita);
 *   - ogni turno porta sfide interne ed esterne generate dal motore, a cui il
 *     giocatore risponde; l'inerzia ha un costo e la risposta è idempotente.
 */
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import os from 'os';
import path from 'path';
import fs from 'fs';

const TEST_DB = path.join(os.tmpdir(), `world-story-levers-${process.pid}-${Date.now()}.db`);
process.env.OPEN_PAX_DB_PATH = TEST_DB;

const WORLD_ID = 'levers_world';
const ORDER = 'Riformare l’amministrazione delle province';
let db: any;
let createGame: () => { gameId: string; session: any };

const stubProvider: any = {
  consolidation: { startRound: 25, chunkSize: 5, keepRawTail: 10 },
  async generate() { return { content: '{}' }; },
  async stream(mechanic: string, _s: string, _u: string, onToken: (chars: number) => void) {
    if (mechanic !== 'jump') throw new Error(`unexpected mechanic ${mechanic}`);
    const base: any = {
      events: [{ headline: 'Riforma approvata', description: 'Il parlamento vara la riforma.', date: '1951-02-01', mapChanges: [] }],
      narration: 'La riforma è passata.',
      voided: [],
      startChat: [],
      worldChanges: { regionOwners: {}, regionColors: {} },
      actionOutcomes: [{ action: ORDER, status: 'accepted', summary: 'Riforma approvata e firmata.', eventHeadlines: ['Riforma approvata'] }],
    };
    const content = JSON.stringify(base);
    onToken(content.length);
    return { content };
  },
  clearCache() {},
};

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
    { id: WORLD_ID, name: 'Levers World', description: '', startDate: '1951-01-01', basePrompt: 'Test', historicalAccuracy: 0.8 },
    [
      {
        id: `${WORLD_ID}_ITA`, name: 'Italia', color: '#FF0000', owner: 'ITA',
        population: 47_000_000, gdp: 2400, militaryPower: 110, flag: 'ITA', coastal: true,
        borders: [`${WORLD_ID}_FRA`, `${WORLD_ID}_AUT`],
        objects: [{ id: 'f1', type: 'factory', name: 'Acciaierie', level: 4 }],
      },
      {
        id: `${WORLD_ID}_FRA`, name: 'Francia', color: '#0000FF', owner: 'FRA',
        population: 42_000_000, gdp: 2200, militaryPower: 160, flag: 'FRA', coastal: true,
        borders: [`${WORLD_ID}_ITA`, `${WORLD_ID}_AUT`],
        objects: [{ id: 'f2', type: 'factory', name: 'Officine', level: 5 }],
      },
      {
        id: `${WORLD_ID}_AUT`, name: 'Austria', color: '#FFFF00', owner: 'AUT',
        population: 7_000_000, gdp: 400, militaryPower: 40, flag: 'AUT',
        borders: [`${WORLD_ID}_ITA`, `${WORLD_ID}_FRA`],
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

describe('la pressione fiscale è una scelta del giocatore', () => {
  it('parte dall’aliquota del profilo e diventa configurabile', () => {
    const { session } = createGame();
    const policy = session.getFiscalPolicy();
    expect(policy.configured).toBe(false);
    expect(policy.taxRatePct).toBeGreaterThan(0);
    expect(policy.minPct).toBeLessThan(policy.maxPct);

    session.setFiscalPolicy(24);
    const configured = session.getFiscalPolicy();
    expect(configured.configured).toBe(true);
    expect(configured.taxRatePct).toBe(24);

    const account = session.getNationalAccounts().ITA;
    expect(account.taxRatePct).toBe(24);
    // Più prelievo → più entrate, saldo migliore, meno consenso e crescita.
    const low = (() => {
      const fresh = createGame().session;
      fresh.setFiscalPolicy(5);
      return fresh.getNationalAccounts().ITA;
    })();
    expect(account.monthlyRevenue).toBeGreaterThan(low.monthlyRevenue);
    expect(account.monthlyBalance).toBeGreaterThan(low.monthlyBalance);
    expect(account.stability).toBeLessThan(low.stability);
    expect(account.socialTension).toBeGreaterThan(low.socialTension);
    expect(account.annualGrowthRate).toBeLessThan(low.annualGrowthRate);
  });

  it('blocca i valori fuori scala e persiste l’aliquota tra sessioni', async () => {
    const { gameId, session } = createGame();
    session.setFiscalPolicy(999);
    expect(session.getFiscalPolicy().taxRatePct).toBe(session.getFiscalPolicy().maxPct);
    session.setFiscalPolicy(12.5);

    const { GameSession } = await import('../src/game-session');
    const restored = new GameSession(gameId, WORLD_ID, stubProvider);
    await restored.reconstructFromDB({
      currentTurn: session.getCurrentTurn(),
      currentDate: session.getCurrentDate(),
      players: [session.getPlayer()],
    });
    expect(restored.getFiscalPolicy().taxRatePct).toBe(12.5);
  });
});

describe('PeacetimePressures — LEGACY / DETECTOR ONLY', () => {
  const legacyPressure = (overrides: Record<string, unknown> = {}) => ({
    id: 'legacy:armatori', kind: 'internal' as const, template: 'legacy-armatori',
    title: 'Vertenza degli armatori', detail: 'Gli armatori chiedono un accordo sul carburante.',
    severity: 1 as const, source: 'Armatori', durationDays: 60,
    options: [{
      id: 'meet', label: 'Ricevere gli armatori', detail: 'Un incontro e una promessa.',
      effect: { socialTension: -4, note: 'Armatori ricevuti: tensione in calo.' },
    }],
    inaction: { socialTension: 9, stability: -4, note: 'Vertenza ignorata.' },
    ...overrides,
  });

  it('il nuovo workflow non genera più quest automatiche', () => {
    const { session } = createGame();
    expect(session.getPeacetimePressures().pressures).toEqual([]);
  });

  it('una Pressure legacy resta risolvibile esplicitamente e in modo idempotente', () => {
    const { gameId, session } = createGame();
    // Il percorso legacy (stanze `sourceSituation` salvate) resta l'unico a
    // poter applicare un effetto, e solo su scelta esplicita del Presidente.
    return (async () => {
      const repos = await import('../src/repositories');
      const player = session.getPlayer();
      repos.gameRepository.insertPressures(gameId, player.polityId, [legacyPressure() as any], session.getCurrentDate(), session.getCurrentTurn());
      const before = session.getResources().modifiers;
      const result = session.resolvePeacetimePressure('legacy:armatori', 'meet');
      expect(result.effect.note).toBeTruthy();
      expect(result.pressure.status).toBe('resolved');
      const after = session.getResources().modifiers;
      expect(after.socialTension).not.toBe(before.socialTension);
      // Idempotenza: una Pressure chiusa non produce un secondo effetto.
      const frozen = session.getResources().modifiers;
      expect(() => session.resolvePeacetimePressure('legacy:armatori', 'meet')).toThrow(/pressure_not_active/);
      expect(session.getResources().modifiers).toEqual(frozen);
    })();
  });

  it('a 30 giorni la Pressure legacy resta aperta e nei termini, senza effetti', async () => {
    const { gameId, session } = createGame();
    const repos = await import('../src/repositories');
    const player = session.getPlayer();
    repos.gameRepository.insertPressures(gameId, player.polityId, [legacyPressure() as any], session.getCurrentDate(), session.getCurrentTurn());
    const before = session.getResources().modifiers;

    await session.advanceDate(30);
    const open = session.getPeacetimePressures().pressures.find((item: any) => item.id === 'legacy:armatori');
    expect(open).toBeTruthy();
    expect(open!.window.daysElapsed).toBe(30);
    expect(open!.window.expired).toBe(false);
    expect(['critica', 'rilevante', 'ordinaria']).toContain(open!.priority);
    expect(typeof open!.highlighted).toBe('boolean');
    expect(session.getResources().modifiers).toEqual(before);
  });

  it('oltre la scadenza la riga si chiude come scaduta SENZA applicare l’inerzia', async () => {
    const { gameId, session } = createGame();
    const repos = await import('../src/repositories');
    const player = session.getPlayer();
    repos.gameRepository.insertPressures(gameId, player.polityId, [legacyPressure() as any], session.getCurrentDate(), session.getCurrentTurn());
    await session.advanceDate(30);
    const before = session.getResources().modifiers;

    await session.advanceDate(35);
    const view = session.getPeacetimePressures();
    expect(view.pressures.some((item: any) => item.id === 'legacy:armatori')).toBe(false);
    const closed = view.recent.find((item: any) => item.id === 'legacy:armatori');
    expect(closed?.status).toBe('expired');
    expect(closed?.resolution || '').toMatch(/nessun effetto applicato|detector/i);
    // P0 — Nessuna penalità nascosta: i modificatori non si muovono.
    expect(session.getResources().modifiers).toEqual(before);
  });
});

describe('crisi e fine partita', () => {
  it('una nazione sana vede le tre strade del collasso senza rischi', () => {
    const { session } = createGame();
    const crisis = session.getCrisis();
    expect(crisis.finished).toBe(false);
    expect(crisis.ending).toBeNull();
    expect(crisis.state.risks.map((risk: any) => risk.dimension).sort()).toEqual(['insolvency', 'invasion', 'revolt']);
    for (const risk of crisis.state.risks) {
      expect(risk.score).toBeGreaterThanOrEqual(0);
      expect(risk.drivers.length).toBeGreaterThan(0);
    }
  });

  it('un epilogo salvato chiude la partita e blocca ogni leva', async () => {
    const { gameId, session } = createGame();
    const repos = await import('../src/repositories');
    repos.gameRepository.saveCrisisState({
      gameId,
      criticalDays: { revolt: 95, insolvency: 0, invasion: 0 },
      episodes: { revolt: 3, insolvency: 0, invasion: 0 },
      overall: 'critical',
      ending: {
        kind: 'revolution',
        dimension: 'revolt',
        title: 'Il governo è caduto',
        summary: 'La piazza ha travolto il governo.',
        date: '1951-06-01',
        turn: 3,
      },
      updatedTurn: 3,
      updatedDate: '1951-06-01',
    });
    repos.gameRepository.setStatus(gameId, 'finished');

    const { GameSession } = await import('../src/game-session');
    const restored = new GameSession(gameId, WORLD_ID, stubProvider);
    await restored.reconstructFromDB({
      currentTurn: session.getCurrentTurn(),
      currentDate: session.getCurrentDate(),
      players: [session.getPlayer()],
    });

    expect(restored.isFinished()).toBe(true);
    expect(restored.getEnding()?.kind).toBe('revolution');
    expect(restored.getStatus()).toBe('finished');
    expect(() => restored.queueAction(ORDER)).toThrow(/game_over/);
    expect(() => restored.setFiscalPolicy(20)).toThrow(/game_over/);
    await expect(restored.advanceDate(30)).rejects.toThrow(/game_over/);

    // La crisi mostrata porta l'epilogo, non solo i punteggi.
    expect(restored.getCrisis().finished).toBe(true);
    expect(restored.getCrisis().ending?.title).toBe('Il governo è caduto');
  });

  it('il rewind annulla il collasso e restituisce la partita', async () => {
    const { gameId, session } = createGame();
    // Un turno vero per generare lo snapshot di rewind.
    session.queueAction(ORDER);
    await session.processNextAction(30);

    const repos = await import('../src/repositories');
    repos.gameRepository.saveCrisisState({
      gameId,
      criticalDays: { revolt: 95, insolvency: 0, invasion: 0 },
      episodes: { revolt: 3, insolvency: 0, invasion: 0 },
      overall: 'critical',
      ending: {
        kind: 'revolution',
        dimension: 'revolt',
        title: 'Il governo è caduto',
        summary: 'La piazza ha travolto il governo.',
        date: '1951-06-01',
        turn: 3,
      },
      updatedTurn: 3,
      updatedDate: '1951-06-01',
    });
    repos.gameRepository.setStatus(gameId, 'finished');

    const { GameSession } = await import('../src/game-session');
    const restored = new GameSession(gameId, WORLD_ID, stubProvider);
    await restored.reconstructFromDB({
      currentTurn: session.getCurrentTurn(),
      currentDate: session.getCurrentDate(),
      players: [session.getPlayer()],
    });
    expect(restored.isFinished()).toBe(true);

    const rewound = restored.rewind();
    expect(rewound).not.toBeNull();
    expect(restored.isFinished()).toBe(false);
    expect(restored.getEnding()).toBeNull();
    expect(restored.getStatus()).toBe('playing');
    // Tornata giocabile.
    expect(() => restored.queueAction(ORDER)).not.toThrow();
    expect(restored.getCrisis().state.criticalDays.revolt).toBe(0);
  });

  it('una nazione indebitata oltre misura finisce in default', async () => {
    const { session } = createGame();
    // Un debito fuori da ogni ragione: nessuna trattativa, nessuna utopia.
    const stock = session.getResources().stock;
    stock.debts = [{
      id: 'test-debt', label: 'Titoli di prova', principal: 400,
      annualRatePct: 12, issuedDate: '1951-01-01', maturityDate: '1990-01-01', termYears: 39,
    }];
    const insolvency = session.getCrisis().state.risks.find((risk: any) => risk.dimension === 'insolvency');
    expect(insolvency.level).toBe('critical');

    for (let turn = 0; turn < 4 && !session.isFinished(); turn++) {
      session.queueAction(ORDER);
      await session.processNextAction(30);
    }

    expect(session.isFinished()).toBe(true);
    expect(session.getEnding()?.kind).toBe('default');
    expect(session.getStatus()).toBe('finished');
    // Da qui non si governa più.
    expect(() => session.queueAction(ORDER)).toThrow(/game_over/);
  });
});
