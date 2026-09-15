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
        objects: [{ id: 'f1', type: 'factory', name: 'Acciaierie', level: 4 }],
      },
      {
        id: `${WORLD_ID}_FRA`, name: 'Francia', color: '#0000FF', owner: 'FRA',
        population: 42_000_000, gdp: 2200, militaryPower: 160, flag: 'FRA', coastal: true,
        objects: [{ id: 'f2', type: 'factory', name: 'Officine', level: 5 }],
      },
      {
        id: `${WORLD_ID}_AUT`, name: 'Austria', color: '#FFFF00', owner: 'AUT',
        population: 7_000_000, gdp: 400, militaryPower: 40, flag: 'AUT',
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

describe('le sfide di pace danno vita al turno', () => {  it('ogni nazione ha sempre almeno una sfida interna e una esterna', () => {
    const { session } = createGame();
    const { pressures } = session.getPeacetimePressures();
    expect(pressures.length).toBeGreaterThanOrEqual(2);
    expect(pressures.some((item: any) => item.kind === 'internal')).toBe(true);
    expect(pressures.some((item: any) => item.kind === 'external')).toBe(true);
    for (const pressure of pressures) {
      expect(pressure.id).toBeTruthy();
      expect(pressure.title).toBeTruthy();
      expect(pressure.options.length).toBeGreaterThanOrEqual(2);
      expect(pressure.severity).toBeGreaterThanOrEqual(1);
    }
  });

  it('è deterministica: stesso turno, stesse sfide', () => {
    const first = createGame().session.getPeacetimePressures().pressures.map((item: any) => item.id);
    const second = createGame().session.getPeacetimePressures().pressures.map((item: any) => item.id);
    expect(second).toEqual(first);
  });

  it('la risposta applica gli effetti e non può essere ripetuta', () => {
    const { session } = createGame();
    const { pressures } = session.getPeacetimePressures();
    // Una scelta senza costo immediato: la cassa di una nazione del 1951 è
    // sottile e il test non deve dipendere dall'opzione più cara.
    const pressure = pressures.find((item: any) => item.options.some((option: any) => !option.effect?.moneyDeltaMld)) || pressures[0];
    const option = pressure.options.find((item: any) => !item.effect?.moneyDeltaMld) || pressure.options[0];
    const before = session.getResources().modifiers;

    const result = session.resolvePeacetimePressure(pressure.id, option.id);
    expect(result.effect.note).toBeTruthy();
    expect(result.pressure.status).toBe('resolved');

    const after = session.getResources().modifiers;
    const stabilityMoved = (after.stability ?? 0) !== (before.stability ?? 0);
    const tensionMoved = (after.socialTension ?? 0) !== (before.socialTension ?? 0);
    const growthMoved = (after.growthModifier ?? 0) !== (before.growthModifier ?? 0);
    const revenueMoved = (after.revenueMultiplier ?? 1) !== (before.revenueMultiplier ?? 1);
    expect(stabilityMoved || tensionMoved || growthMoved || revenueMoved).toBe(true);

    // Idempotenza: una sfida chiusa non produce un secondo effetto.
    const modifiersAfter = session.getResources().modifiers;
    expect(() => session.resolvePeacetimePressure(pressure.id, option.id)).toThrow(/pressure_not_active/);
    expect(session.getResources().modifiers).toEqual(modifiersAfter);

    const { pressures: open } = session.getPeacetimePressures();
    expect(open.some((item: any) => item.id === pressure.id)).toBe(false);
  });

  it('ignorare le sfide ha un costo e ne fa nascere di nuove al turno dopo', async () => {
    const { session } = createGame();
    const before = session.getPeacetimePressures().pressures;
    const beforeModifiers = session.getResources().modifiers;

    session.queueAction(ORDER);
    await session.processNextAction(30);

    const after = session.getPeacetimePressures();
    // Le sfide del turno precedente non sono più aperte.
    for (const pressure of before) {
      expect(after.pressures.some((item: any) => item.id === pressure.id)).toBe(false);
    }
    // E la nazione ha di nuovo qualcosa da decidere.
    expect(after.pressures.length).toBeGreaterThanOrEqual(2);
    // L'inerzia non è gratuita: almeno un modificatore si è mosso.
    const afterModifiers = session.getResources().modifiers;
    expect(
      (afterModifiers.stability ?? 0) !== (beforeModifiers.stability ?? 0)
      || (afterModifiers.socialTension ?? 0) !== (beforeModifiers.socialTension ?? 0),
    ).toBe(true);
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
      streaks: { revolt: 3, insolvency: 0, invasion: 0 },
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
      streaks: { revolt: 3, insolvency: 0, invasion: 0 },
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
    expect(restored.getCrisis().state.streaks.revolt).toBe(0);
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
