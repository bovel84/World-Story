/**
 * CRISIS-RESIDUAL — I due bug P0 residui della crisi nazionale.
 *
 *  P0.1 Il **primo** avanzamento di una partita non accumulava i giorni di
 *       criticità: senza uno stato di crisi precedente non c'era una data da
 *       cui misurare e il tempo realmente simulato (7/30/90/180/365 giorni)
 *       valeva zero. Ora i giorni del periodo viaggiano esplicitamente dal
 *       sistema che li conosce (salto, pipeline del turno, battito del mondo).
 *  P0.2 Il **rewind** azzerava la crisi invece di ripristinare lo stato del
 *       checkpoint precedente. Ora la crisi è dentro lo snapshot del ramo e
 *       torna esattamente al punto salvato: giorni, avvertimenti, livello,
 *       epilogo, turno e data.
 *
 * Il mondo di prova usa un polity con «fatti di riferimento» moderni: la sua
 * crisi di insolvenza è **critica fin dal primo turno**, così i test misurano
 * il tempo senza dipendere da eventi o dal modello.
 */
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import os from 'os';
import path from 'path';
import fs from 'fs';
import {
  CRISIS_ABRUPT_DAYS, CRISIS_COLLAPSE_DAYS, CRISIS_MIN_EPISODES, CRISIS_WATCH_RATE,
} from '../src/core/simulation/NationCrisis';

const TEST_DB = path.join(os.tmpdir(), `world-story-crisis-residual-${process.pid}-${Date.now()}.db`);
process.env.OPEN_PAX_DB_PATH = TEST_DB;

const WORLD_ID = 'crisis_residual_world';
const CALM_WORLD_ID = 'crisis_calm_world';
let db: any;
let createGame: () => { gameId: string; session: any };
let createCalmGame: () => { gameId: string; session: any };

const stubProvider: any = {
  consolidation: { startRound: 25, chunkSize: 5, keepRawTail: 10 },
  async generate() { return { content: '{}' }; },
  async stream(mechanic: string, _s: string, _u: string, onToken: (chars: number) => void) {
    if (mechanic !== 'jump') throw new Error(`unexpected mechanic ${mechanic}`);
    const content = JSON.stringify({
      events: [{ headline: 'Giorni di tensione', description: 'Il paese tira avanti.', date: '2026-02-01', mapChanges: [] }],
      narration: 'Il tempo passa.',
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

/** Un solo paese, con fatti di riferimento moderni: insolvenza critica dal T1. */
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
    { id: WORLD_ID, name: 'Crisis Residual', description: '', startDate: '2026-01-01', basePrompt: 'Test', historicalAccuracy: 0.8 },
    [
      {
        id: `${WORLD_ID}_ITA`, name: 'Italia', color: '#FF0000', owner: 'ITA',
        population: 59_000_000, gdp: 2300, militaryPower: 110, flag: 'ITA', coastal: true,
        borders: [], objects: [],
      },
    ],
  );
  createGame = () => registry.createSession(WORLD_ID, 'Player', `${WORLD_ID}_ITA`, '#FF0000');
  // Secondo mondo con un polity **senza** dati di riferimento moderni: la sua
  // crisi è calma, così il test del primo salto lungo misura il tempo e non la
  // struttura del debito ereditato.
  repos.worldRepository.createWithRegions(
    { id: CALM_WORLD_ID, name: 'Crisis Calm', description: '', startDate: '2026-01-01', basePrompt: 'Test', historicalAccuracy: 0.8 },
    [
      {
        id: `${CALM_WORLD_ID}_ROM`, name: 'Italia', color: '#FF0000', owner: 'ROM',
        population: 59_000_000, gdp: 2300, militaryPower: 110, flag: 'ROM', coastal: true,
        borders: [], objects: [],
      },
    ],
  );
  createCalmGame = () => registry.createSession(CALM_WORLD_ID, 'Player', `${CALM_WORLD_ID}_ROM`, '#FF0000');
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

/** Stato di crisi scritto a mano: il punto di partenza controllato dei test. */
const crisisRecord = (gameId: string, over: Record<string, unknown> = {}) => ({
  gameId,
  criticalDays: { revolt: 0, insolvency: 55, invasion: 0 },
  episodes: { revolt: 0, insolvency: 1, invasion: 0 },
  overall: 'critical' as const,
  ending: null,
  updatedTurn: 1,
  updatedDate: '2026-01-01',
  ...over,
});

const saveRow = (saveId: string) => db.prepare('SELECT data, content_hash FROM saves WHERE id = ?').get(saveId) as any;
const snapshotOf = (saveId: string) => JSON.parse(saveRow(saveId).data);
const hashOf = (saveId: string) => saveRow(saveId).content_hash as string;

describe('CRISIS-RESIDUAL P0.1 — il primo salto accumula i giorni realmente simulati', () => {
  it('una partita nuova in crisi accumula il salto lungo: 180 giorni ≠ 0', async () => {
    const { gameId, session } = createGame();
    const precondition = session.getCrisis();
    // Precondizione esplicita: senza una crisi critica il test non misurerebbe nulla.
    const insolvency = precondition.state.risks.find((risk: any) => risk.dimension === 'insolvency');
    expect(insolvency.level).toBe('critical');

    await session.advanceDate(180);
    const after = session.getCrisis().state;
    // P0.1: prima valevano zero giorni, perché non esisteva uno stato precedente.
    expect(after.criticalDays.insolvency).toBe(180);
    expect(after.episodes.insolvency).toBe(1);
    expect(after.criticalDays.insolvency).toBe(0 + 180);
    expect(gameId).toBeTruthy();
  });

  it('il primo salto corto accumula esattamente 7 giorni', async () => {
    const { session } = createGame();
    await session.advanceDate(7);
    const after = session.getCrisis().state;
    expect(after.criticalDays.insolvency).toBe(7);
    expect(after.criticalDays.insolvency).toBeGreaterThan(0);
    expect(session.getCurrentDate()).toBe('2026-01-08');
    expect(session.isFinished()).toBe(false);
  });

  it('la stessa semantica vale per il salto con ordini e per il battito del mondo', async () => {
    // Salto con ordini: `processActionBatch` passa i giorni del periodo.
    const withOrders = createGame().session;
    const action = withOrders.queueAction('Nazionalizza le banche');
    withOrders.gameController.processTurnWithPrompts = vi.fn().mockResolvedValue({
      events: [{ headline: 'Decreto', description: 'Le banche passano allo Stato.', date: '2026-01-31', mapChanges: [] }],
      narration: 'Il decreto è firmato.',
      convertedActions: [],
      actionOutcomes: [{ actionId: action.id, status: 'accepted', summary: 'Decreto firmato' }],
      voided: [], startChat: [], worldChanges: { regionOwners: {}, regionColors: {} },
    } as any);
    await withOrders.processNextAction(30);
    expect(withOrders.getCrisis().state.criticalDays.insolvency).toBe(30);

    // Battito del mondo (nessun ordine): stessi giorni, stessa regola.
    const ticking = createGame().session;
    await ticking.worldTick();
    expect(ticking.getCrisis().state.criticalDays.insolvency).toBe(7);
    expect(ticking.getCurrentDate()).toBe('2026-01-08');
  });

  it('un primo salto lungo non critico non accelera la crisi e non chiude la partita', async () => {
    const { gameId, session } = createCalmGame();
    const repos = await import('../src/repositories');
    const before = session.getCrisis().state;
    for (const risk of before.risks) expect(risk.level).not.toBe('critical');
    expect(before.criticalDays).toEqual({ revolt: 0, insolvency: 0, invasion: 0 });

    await session.advanceDate(180);
    const after = session.getCrisis();

    // Nessun accumulo a pieno regime: una dimensione non critica può al
    // massimo logorarsi al ritmo dell'allarme (CRISIS_WATCH_RATE), non al 100%.
    const watchCeiling = Math.round(180 * CRISIS_WATCH_RATE);
    for (const days of Object.values(after.state.criticalDays)) {
      expect(Number(days)).toBeLessThanOrEqual(watchCeiling);
    }
    // Gli avvertimenti si contano solo quando la dimensione è critica.
    expect(after.state.episodes).toEqual({ revolt: 0, insolvency: 0, invasion: 0 });
    expect(after.finished).toBe(false);
    expect(after.ending).toBeNull();
    expect(session.getStatus()).toBe('playing');
    expect(session.getCurrentDate()).toBe('2026-06-30');

    // La data dell'ultima valutazione è quella raggiunta, non quella di partenza.
    const row = repos.gameRepository.getCrisisState(gameId)!;
    expect(row.updatedDate).toBe('2026-06-30');
    expect(row.updatedTurn).toBe(session.getCurrentTurn());
    expect(row.ending).toBeNull();
  }, 60000);
});

describe('CRISIS-RESIDUAL P0.2 — il rewind ripristina lo stato esatto', () => {
  it('T10 = 55 giorni → T11 = 85 → rewind torna esattamente a 55', async () => {
    const { gameId, session } = createGame();
    const repos = await import('../src/repositories');
    repos.gameRepository.saveCrisisState(crisisRecord(gameId, {
      criticalDays: { revolt: 0, insolvency: 55, invasion: 0 },
      episodes: { revolt: 0, insolvency: 1, invasion: 0 },
      updatedTurn: 1,
      updatedDate: '2026-01-01',
    }));

    await session.advanceDate(30);
    const advanced = session.getCrisis().state;
    expect(advanced.criticalDays.insolvency).toBe(85);
    expect(advanced.episodes.insolvency).toBe(2);
    expect(session.isFinished()).toBe(false);

    expect(session.rewind()).toBeTruthy();
    const rewound = session.getCrisis().state;
    // P0.2: prima il rewind azzerava la crisi: 85 → 0 invece di 85 → 55.
    expect(rewound.criticalDays.insolvency).toBe(55);
    expect(rewound.episodes.insolvency).toBe(1);
    expect(rewound.level).toBe('critical');
    const row = repos.gameRepository.getCrisisState(gameId)!;
    expect(row.criticalDays.insolvency).toBe(55);
    expect(row.episodes.insolvency).toBe(1);
    expect(row.updatedDate).toBe('2026-01-01');
    expect(row.updatedTurn).toBe(1);
  });

  it('il rewind da game over restituisce la partita con lo stato precedente, non azzerato', async () => {
    const { gameId, session } = createGame();
    const repos = await import('../src/repositories');
    repos.gameRepository.saveCrisisState(crisisRecord(gameId, {
      criticalDays: { revolt: 0, insolvency: 85, invasion: 0 },
      episodes: { revolt: 0, insolvency: 2, invasion: 0 },
      updatedDate: '2026-01-01',
    }));

    await session.advanceDate(30);
    expect(session.isFinished()).toBe(true);
    expect(session.getEnding()?.kind).toBe('default');
    expect(session.getStatus()).toBe('finished');
    // Nessun game over improvviso: l'arretrato è osservabile.
    expect(session.getCrisis().state.criticalDays.insolvency).toBeGreaterThanOrEqual(CRISIS_COLLAPSE_DAYS);

    expect(session.rewind()).toBeTruthy();
    expect(session.isFinished()).toBe(false);
    expect(session.getEnding()).toBeNull();
    expect(session.getStatus()).toBe('playing');
    expect(() => session.queueAction('Torna a governare')).not.toThrow();
    const rewound = session.getCrisis().state;
    expect(rewound.criticalDays.insolvency).toBe(85);
    expect(rewound.episodes.insolvency).toBe(2);
    expect(session.getCrisis().finished).toBe(false);
  });

  it('save/load conservano giorni, avvertimenti e data', async () => {
    const { gameId, session } = createGame();
    const repos = await import('../src/repositories');
    repos.gameRepository.saveCrisisState(crisisRecord(gameId, {
      criticalDays: { revolt: 4, insolvency: 61, invasion: 0 },
      episodes: { revolt: 1, insolvency: 2, invasion: 0 },
      updatedDate: '2026-01-01',
      updatedTurn: 1,
    }));

    const { GameSession } = await import('../src/game-session');
    const reloaded = new GameSession(gameId, WORLD_ID, stubProvider);
    await reloaded.reconstructFromDB({
      currentTurn: session.getCurrentTurn(),
      currentDate: session.getCurrentDate(),
      players: [session.getPlayer()],
    });

    const row = repos.gameRepository.getCrisisState(gameId)!;
    expect(row.criticalDays).toEqual({ revolt: 4, insolvency: 61, invasion: 0 });
    expect(row.episodes).toEqual({ revolt: 1, insolvency: 2, invasion: 0 });
    expect(row.updatedDate).toBe('2026-01-01');
    expect(row.updatedTurn).toBe(1);
    expect(reloaded.getCrisis().state.criticalDays.insolvency).toBe(61);

    // E ricaricare un salvataggio riporta la crisi al punto salvato.
    const save = session.save('punto-di-crisi');
    await session.advanceDate(30);
    expect(session.getCrisis().state.criticalDays.insolvency).toBe(91);
    session.loadFromSave(snapshotOf(save.saveId), hashOf(save.saveId));
    expect(session.getCrisis().state.criticalDays.insolvency).toBe(61);
    expect(session.getCrisis().state.episodes.insolvency).toBe(2);
  });
});

describe('CRISIS-RESIDUAL — isolamento fra rami', () => {
  it('due rami dallo stesso checkpoint hanno crisi indipendenti', async () => {
    const { gameId, session } = createGame();
    const repos = await import('../src/repositories');
    repos.gameRepository.saveCrisisState(crisisRecord(gameId, {
      criticalDays: { revolt: 0, insolvency: 55, invasion: 0 },
      episodes: { revolt: 0, insolvency: 1, invasion: 0 },
    }));
    // Il punto di diramazione: snapshot con la crisi a 55 giorni.
    const save = session.save('checkpoint-crisi');
    const data = snapshotOf(save.saveId);
    const hash = hashOf(save.saveId);
    expect(data.crisis.criticalDays.insolvency).toBe(55);

    // Ramo A: dal checkpoint, la crisi peggiora.
    const branchA = session.loadFromSave(data, hash, { newBranch: { name: 'ramo-A' } }).branchId!;
    await session.advanceDate(30);
    expect(session.getCrisis().state.criticalDays.insolvency).toBe(85);

    // Ramo B: stesso checkpoint (riletto dal DB: il restore condivide gli
    // oggetti delle regioni con lo snapshot, quindi va riesumato), crisi
    // riportata a 55 e poi solo 7 giorni.
    const branchB = session.loadFromSave(snapshotOf(save.saveId), hash, { newBranch: { name: 'ramo-B' } }).branchId!;
    expect(branchA).not.toBe(branchB);
    expect(session.getCrisis().state.criticalDays.insolvency).toBe(55);
    await session.advanceDate(7);
    expect(session.getCrisis().state.criticalDays.insolvency).toBe(62);

    // Ogni ramo ha la propria riga: leggere B non altera A e viceversa.
    expect(repos.gameRepository.getCrisisState(gameId, branchA)!.criticalDays.insolvency).toBe(85);
    expect(repos.gameRepository.getCrisisState(gameId, branchB)!.criticalDays.insolvency).toBe(62);
    // Il ramo di partenza resta al punto di prima della diramazione.
    const main = repos.gameRepository.getCrisisState(gameId, 'main');
    expect(main === null || main.criticalDays.insolvency === 55).toBe(true);
    // La sessione legge il ramo corrente (B).
    expect(session.getCrisis().state.criticalDays.insolvency).toBe(62);
  });
});

describe('CRISIS-RESIDUAL — scenario di accettazione', () => {
  it('partita nuova → salto → save → turno → rewind → rami → load: la crisi non si perde mai', async () => {
    const { gameId, session } = createGame();
    const repos = await import('../src/repositories');

    // 1. Partita nuova: crisi critica, nessun giorno ancora contato.
    expect(session.getCrisis().state.criticalDays.insolvency).toBe(0);

    // 2. Salto lungo: i giorni sono quelli realmente simulati.
    await session.advanceDate(30);
    expect(session.getCrisis().state.criticalDays.insolvency).toBe(30);
    expect(session.getCurrentDate()).toBe('2026-01-31');

    // 3. Save, poi un altro turno.
    const save = session.save('accettazione');
    const hash = hashOf(save.saveId);
    await session.advanceDate(30);
    expect(session.getCrisis().state.criticalDays.insolvency).toBe(60);

    // 4. Rewind: stato precedente **esatto**, non azzerato.
    expect(session.rewind()).toBeTruthy();
    expect(session.getCurrentDate()).toBe('2026-01-31');
    expect(session.getCrisis().state.criticalDays.insolvency).toBe(30);
    expect(session.getCrisis().state.episodes.insolvency).toBe(1);
    expect(repos.gameRepository.getCrisisState(gameId)!.updatedDate).toBe('2026-01-31');

    // 5. Ramo A dal salvataggio: peggiora.
    const branchA = session.loadFromSave(snapshotOf(save.saveId), hash, { newBranch: { name: 'acc-A' } }).branchId!;
    expect(session.getCrisis().state.criticalDays.insolvency).toBe(30);
    await session.advanceDate(30);
    expect(session.getCrisis().state.criticalDays.insolvency).toBe(60);

    // 6. Ramo B dallo stesso punto: peggiora meno.
    const branchB = session.loadFromSave(snapshotOf(save.saveId), hash, { newBranch: { name: 'acc-B' } }).branchId!;
    expect(session.getCrisis().state.criticalDays.insolvency).toBe(30);
    await session.advanceDate(7);
    expect(session.getCrisis().state.criticalDays.insolvency).toBe(37);

    // 7. I due rami non si toccano.
    expect(branchA).not.toBe(branchB);
    expect(repos.gameRepository.getCrisisState(gameId, branchA)!.criticalDays.insolvency).toBe(60);
    expect(repos.gameRepository.getCrisisState(gameId, branchB)!.criticalDays.insolvency).toBe(37);

    // 8. Load del salvataggio: stato identico a quello salvato, e il ramo A resta com'era.
    session.loadFromSave(snapshotOf(save.saveId), hash);
    expect(session.getCrisis().state.criticalDays.insolvency).toBe(30);
    expect(session.getCurrentDate()).toBe('2026-01-31');
    expect(repos.gameRepository.getCrisisState(gameId, branchB)!.criticalDays.insolvency).toBe(30);
    expect(repos.gameRepository.getCrisisState(gameId, branchA)!.criticalDays.insolvency).toBe(60);
  });
});

describe('CRISIS-RESIDUAL — regola del collasso brusco (180 giorni)', () => {
  it('al primo salto: 179 giorni critici non bastano, 180 sì (scelta intenzionale)', async () => {
    // 179 giorni: arretrato sotto la soglia brusca e un solo avvertimento osservato.
    const almost = createGame().session;
    await almost.advanceDate(179);
    expect(almost.getCrisis().state.criticalDays.insolvency).toBe(179);
    expect(almost.getCrisis().state.episodes.insolvency).toBe(1);
    expect(almost.isFinished()).toBe(false);

    // 180 giorni: arretrato ≥ CRISIS_ABRUPT_DAYS con la dimensione critica ora
    // → collasso immediato. È la regola documentata: un anno di criticità
    // ininterrotta equivale al punto di non ritorno.
    const abrupt = createGame().session;
    await abrupt.advanceDate(CRISIS_ABRUPT_DAYS);
    expect(abrupt.getCrisis().state.criticalDays.insolvency).toBe(CRISIS_ABRUPT_DAYS);
    expect(abrupt.isFinished()).toBe(true);
    expect(abrupt.getEnding()?.kind).toBe('default');
    expect(abrupt.getEnding()?.summary).toMatch(new RegExp(`${CRISIS_ABRUPT_DAYS} giorni`));
    // La soglia ordinaria resta quella dei giorni critici accumulati.
    expect(abrupt.getCrisis().state.collapseDays).toBe(CRISIS_COLLAPSE_DAYS);
    expect(CRISIS_MIN_EPISODES).toBe(2);
  });
});
