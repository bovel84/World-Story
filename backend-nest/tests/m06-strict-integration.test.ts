/**
 * M06 µ3 — Integrazione EffectValidator nel percorso run strict
 * ==============================================================
 * Verifica che, per una partita strict, il validatore sia collegato al
 * percorso di simulazione PRIMA di ogni mutatore materiale/commit narrativo:
 *  - worldChanges assoluti (PIL/fondi/militare/territorio) → rifiuto;
 *  - mapChanges LLM diretti (build_facility/spawn/transfer) → rifiuto;
 *  - comando materiale diretto nel testo dell'ordine → rifiuto pre-provider;
 *  - outcome senza actionId canonico → rifiuto;
 *  - effects non consentiti → rifiuto.
 * In ogni caso: errore protocollo → rollback all'ultimo checkpoint, run
 * 'failed', MAI commit narrativo (MAT25/26/27/37/38, C03/C04/C10).
 */
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import os from 'os';
import path from 'path';
import fs from 'fs';

const TEST_DB = path.join(os.tmpdir(), `world-story-m06-${process.pid}-${Date.now()}.db`);
process.env.OPEN_PAX_DB_PATH = TEST_DB;

let db: any;
let worldRepository: any;
let gameRepository: typeof import('../src/repositories/game.repository').gameRepository;
let initSessionRegistry: any;
let getSessionRegistry: any;

const STRICT_WORLD = 'm06_strict_world';
/** Modalità di risposta della stub LLM per il meccanismo jump. */
let jumpMode:
  | 'clean'
  | 'world_changes'
  | 'map_changes'
  | 'direct_command'
  | 'bad_outcome'
  | 'bad_effects'
  | 'staged_ledger'
  | 'two_events'
  | 'two_events_staged'
  | 'two_events_missing_staged'
  | 'two_events_chained_fault'
  | 'no_event' = 'clean';
/** actionId reale dell'ordine accodato, usato dall'esito canonico del mock. */
let currentActionId = '';

function jumpResponse(): any {
  switch (jumpMode) {
    case 'world_changes':
      // MAT26: worldChanges assoluti che creano ricchezza per testo.
      return {
        events: [{ headline: 'Evento', description: 'Descrizione.', date: '1951-01-10', mapChanges: [] }],
        narration: 'Narrazione.',
        voided: [],
        startChat: [],
        worldChanges: { regionGDP: { r: 999999 } },
      };
    case 'map_changes':
      // MAT25: mapChanges LLM diretto senza resolver/autorizzazione.
      return {
        events: [{ headline: 'Evento', description: 'Descrizione.', date: '1951-01-10', mapChanges: [{ type: 'build_facility', regionName: 'r' }] }],
        narration: 'Narrazione.',
        voided: [],
        startChat: [],
        worldChanges: {},
      };
    case 'direct_command':
      // MAT25: comando materiale diretto nel testo dell'ordine.
      return {
        events: [{ headline: 'Evento', description: 'Descrizione.', date: '1951-01-10', mapChanges: [] }],
        narration: 'Narrazione.',
        voided: [],
        startChat: [],
        worldChanges: {},
      };
    case 'bad_outcome':
      // F01/C01: outcome senza actionId canonico → nessun fallback posizionale.
      return {
        events: [{ headline: 'Evento', description: 'Descrizione.', date: '1951-01-10', mapChanges: [] }],
        narration: 'Narrazione.',
        actionOutcomes: [{ action: 'testo', status: 'accepted', summary: 's' }],
        voided: [],
        startChat: [],
        worldChanges: {},
      };
    case 'bad_effects':
      // MAT37/MAT38: effects non consentiti (ledger senza causale).
      return {
        events: [{ headline: 'Evento', description: 'Descrizione.', date: '1951-01-10', mapChanges: [] }],
        narration: 'Narrazione.',
        voided: [],
        startChat: [],
        worldChanges: {},
        effects: [{ kind: 'ledger', effectId: 'e' }],
      };
    case 'staged_ledger':
      return {
        events: [{ headline: 'Pagamento', description: 'Pagamento già autorizzato.', date: '1951-01-10', mapChanges: [] }],
        narration: 'Narrazione.',
        actionOutcomes: [{ actionId: currentActionId, status: 'accepted', summary: 'ok' }],
        voided: [], startChat: [], worldChanges: {},
        effects: [{ kind: 'ledger', effectId: 'm06-staged-payment', cause: 'pagamento', account: 'testo-ignorato' }],
      };
    case 'two_events':
    case 'two_events_staged':
    case 'two_events_missing_staged':
      return {
        events: [
          { headline: 'Prima', description: 'Prima.', date: '1951-01-10', mapChanges: [] },
          { headline: 'Seconda', description: 'Seconda.', date: '1951-01-20', mapChanges: [] },
        ],
        narration: 'Periodo.',
        actionOutcomes: [{ actionId: currentActionId, status: 'accepted', summary: 'ok' }],
        voided: [], startChat: [], worldChanges: {},
        effects: jumpMode === 'two_events_missing_staged'
          ? [{ kind: 'ledger', effectId: 'missing-stage', cause: 'pagamento', account: 'x' }]
          : jumpMode === 'two_events_staged'
            ? [{ kind: 'ledger', effectId: 'playback-payment', cause: 'pagamento', account: 'x' }]
            : [], 
      };
    case 'two_events_chained_fault':
      // L'ultimo evento raggiunge la destinazione: la completion è invocata
      // dallo step stesso (percorso concatenato della quarta revisione B2).
      return {
        events: [
          { headline: 'Prima', description: 'Prima.', date: '1951-01-10', mapChanges: [] },
          { headline: 'Arrivo', description: 'Arrivo a destinazione.', date: '1951-01-31', mapChanges: [] },
        ],
        narration: 'Periodo.',
        actionOutcomes: [{ actionId: currentActionId, status: 'accepted', summary: 'ok' }],
        voided: [], startChat: [], worldChanges: {},
        effects: [{ kind: 'ledger', effectId: 'missing-chained', cause: 'pagamento', account: 'x' }],
      };
    case 'no_event':
      // C10: risposta valida completa senza eventi → nessuna mutazione.
      return {
        events: [],
        narration: 'Nessuna svolta.',
        voided: [],
        startChat: [],
        worldChanges: {},
      };
    default:
      // clean: risultato valido, nessuna mutazione materiale.
      return {
        events: [{ headline: 'Evento', description: 'Descrizione.', date: '1951-01-10', mapChanges: [] }],
        narration: 'Narrazione.',
        actionOutcomes: [{ actionId: currentActionId, status: 'accepted', summary: 'ok' }],
        voided: [],
        startChat: [],
        worldChanges: {},
      };
  }
}

const stubProvider: any = {
  consolidation: { startRound: 25, chunkSize: 5, keepRawTail: 10 },
  async generate(mechanic: string, system: string, user: string) {
    if (mechanic === 'converter') {
      return { content: JSON.stringify({ type: 'action', text: 'Azione del giocatore' }) };
    }
    if (mechanic === 'jump') {
      return { content: JSON.stringify(jumpResponse()) };
    }
    return { content: JSON.stringify({ type: 'develop', description: 'Sviluppo', priority: 5 }) };
  },
  async stream(mechanic: string, system: string, user: string, onToken: (chars: number) => void, options?: any) {
    const r = await this.generate(mechanic, system, user, options);
    onToken(r.content.length);
    return r;
  },
  clearCache() {},
};

function createStrictGame(): { gameId: string; session: any } {
  return getSessionRegistry().createSession(STRICT_WORLD, 'Player', `${STRICT_WORLD}_DEU`, '#FF0000');
}

beforeAll(async () => {
  vi.spyOn(Math, 'random').mockReturnValue(0.99);

  const dbModule = await import('../src/database');
  db = dbModule.default;
  dbModule.initDatabase();

  const repos = await import('../src/repositories');
  worldRepository = repos.worldRepository;
  gameRepository = repos.gameRepository;

  const registryModule = await import('../src/session-registry');
  initSessionRegistry = registryModule.initSessionRegistry;
  getSessionRegistry = registryModule.getSessionRegistry;

  worldRepository.createWithRegions(
    { id: STRICT_WORLD, name: 'M06 Strict World', description: '', startDate: '1951-01-01', basePrompt: 'Lore', historicalAccuracy: 0.8, templateId: 'realism_test_world' },
    [
      { id: `${STRICT_WORLD}_DEU`, name: 'DEU', color: '#FF0000', owner: 'DEU', population: 5000000, gdp: 200, militaryPower: 300, flag: 'DEU' },
      { id: `${STRICT_WORLD}_POL`, name: 'POL', color: '#00FF00', owner: 'POL', population: 3000000, gdp: 100, militaryPower: 100, flag: 'POL' },
    ]
  );

  initSessionRegistry(stubProvider);
});

afterAll(() => {
  vi.restoreAllMocks();
  try {
    db?.close();
    for (const suffix of ['', '-wal', '-shm']) {
      const f = TEST_DB + suffix;
      if (fs.existsSync(f)) fs.rmSync(f);
    }
  } catch { /* tmp */ }
});

describe('M06 µ3 — EffectValidator integrato nel percorso run strict', () => {
  it('loadFromSave strict rifiuta uno snapshot economico assente (M4)', () => {
    const { session } = createStrictGame();
    const minimal = { currentTurn: session.getCurrentTurn(), currentDate: session.getCurrentDate() };
    expect(() => session.loadFromSave(minimal)).toThrow(/strict_economic_snapshot_missing/);
    const emptyTables = { ...minimal, economicState: { schema: 'open_pax_economy', version: 1, sourceBranchId: 'x', tables: [] } };
    expect(() => session.loadFromSave(emptyTables)).toThrow(/strict_economic_snapshot_missing/);
    expect(session.getCurrentDate()).toBe('1951-01-01');
  });

  it('loadFromSave strict preflight semantico: RAM invariata e staging invalidato', async () => {
    const { gameId, session } = createStrictGame();
    const snapshot = await import('../src/repositories/economy-snapshot.repository');
    const branch = db.prepare('SELECT head_branch_id AS b FROM games WHERE id=?').get(gameId) as { b: string };
    const economicState = JSON.parse(JSON.stringify(snapshot.captureEconomicSnapshot(gameId, branch.b))) as { tables: Record<string, unknown[]> };
    economicState.tables.ledger = [{ game_id: gameId, branch_id: branch.b, effect_id: 'bad-owner', entry_index: 0, cause: 'incasso', kind: 'money', unit_id: 'test', from_ref: null, to_ref: 'treasury', owner_ref: 'forbidden', delta: '1', at_date: '1951-01-01' }];
    db.prepare("INSERT INTO strict_effect_staging (game_id,branch_id,anchor_revision,effect_id,kind,payload_json) VALUES (?,?,?,?,?,?)").run(gameId, branch.b, 0, 'stale-save', 'ledger', '{}');
    const before = { turn: session.getCurrentTurn(), date: session.getCurrentDate() };
    expect(() => session.loadFromSave({ currentTurn: 99, currentDate: '1951-02-01', players: [], economicState })).toThrow(/strict_economic_snapshot_invalid/);
    expect({ turn: session.getCurrentTurn(), date: session.getCurrentDate() }).toEqual(before);
    expect(db.prepare('SELECT COUNT(*) AS n FROM strict_effect_staging WHERE branch_id=?').get(branch.b).n).toBe(0);
  });

  it('blocca i bypass legacy worldTick/advanceDate in strict prima della mutazione', async () => {
    const { gameId, session } = createStrictGame();
    const before = db.prepare('SELECT current_turn, "current_date" AS world_date FROM games WHERE id = ?').get(gameId);
    await expect(session.worldTick()).rejects.toThrow(/strict.*legacy/i);
    await expect(session.advanceDate(30)).rejects.toThrow(/strict.*legacy/i);
    expect(db.prepare('SELECT current_turn, "current_date" AS world_date FROM games WHERE id = ?').get(gameId)).toEqual(before);
  });

  it('deriva strict dal catalogo server-side (M06 µ1)', () => {
    const { gameId } = createStrictGame();
    const row = db.prepare('SELECT economy_mode, economy_model_version FROM games WHERE id = ?').get(gameId);
    expect(row).toEqual({ economy_mode: 'strict', economy_model_version: 'realism_test_world@1' });
  });

  it('rifiuta worldChanges assoluti e riporta il mondo al checkpoint (MAT26)', async () => {
    jumpMode = 'world_changes';
    const { gameId, session } = createStrictGame();
    const dateBefore = session.getCurrentDate();
    const turnBefore = session.getCurrentTurn();
    session.queueAction('Azione');

    await expect(session.processAllPendingActions(30)).rejects.toMatchObject({
      name: 'EffectValidationError',
      code: 'UNAUTHORIZED_WORLD_CHANGE',
    });

    // Rollback: nessun avanzamento, nessun checkpoint, run failed, ordine in coda.
    expect(session.getCurrentDate()).toBe(dateBefore);
    expect(session.getCurrentTurn()).toBe(turnBefore);
    expect(db.prepare('SELECT COUNT(*) AS n FROM simulation_checkpoints WHERE game_id = ?').get(gameId).n).toBe(0);
    expect(db.prepare('SELECT COUNT(*) AS n FROM simulation_outbox WHERE game_id = ?').get(gameId).n).toBe(0);
    expect(db.prepare('SELECT status FROM simulation_runs WHERE game_id = ?').get(gameId).status).toBe('failed');
    expect(session.getPendingActions()).toEqual([expect.objectContaining({ status: 'pending' })]);
    jumpMode = 'clean';
  });

  it('rifiuta mapChanges LLM diretti senza resolver (MAT25)', async () => {
    jumpMode = 'map_changes';
    const { gameId, session } = createStrictGame();
    const dateBefore = session.getCurrentDate();
    session.queueAction('Azione');

    await expect(session.processAllPendingActions(30)).rejects.toMatchObject({
      name: 'EffectValidationError',
      code: 'UNAUTHORIZED_MAP_CHANGE',
    });

    expect(session.getCurrentDate()).toBe(dateBefore);
    expect(db.prepare('SELECT COUNT(*) AS n FROM simulation_checkpoints WHERE game_id = ?').get(gameId).n).toBe(0);
    expect(db.prepare('SELECT COUNT(*) AS n FROM simulation_outbox WHERE game_id = ?').get(gameId).n).toBe(0);
    expect(db.prepare('SELECT status FROM simulation_runs WHERE game_id = ?').get(gameId).status).toBe('failed');
    jumpMode = 'clean';
  });

  it('rifiuta un comando materiale diretto nel testo dell\'ordine PRIMA del provider (MAT25)', async () => {
    jumpMode = 'direct_command';
    const { gameId, session } = createStrictGame();
    const dateBefore = session.getCurrentDate();
    const controller = session.gameController as any;
    const simulate = vi.spyOn(controller, 'processTurnWithPrompts');
    session.queueAction('build_facility foundry');

    await expect(session.processAllPendingActions(30)).rejects.toMatchObject({
      name: 'EffectValidationError',
      code: 'DIRECT_MATERIAL_COMMAND',
    });

    // Il rifiuto avviene prima della chiamata al provider: nessun credito consumato.
    expect(simulate).not.toHaveBeenCalled();
    expect(session.getCurrentDate()).toBe(dateBefore);
    expect(db.prepare('SELECT COUNT(*) AS n FROM simulation_checkpoints WHERE game_id = ?').get(gameId).n).toBe(0);
    simulate.mockRestore();
    jumpMode = 'clean';
  });

  it('rifiuta un outcome senza actionId canonico (nessun fallback posizionale, C01)', async () => {
    jumpMode = 'bad_outcome';
    const { gameId, session } = createStrictGame();
    const dateBefore = session.getCurrentDate();
    session.queueAction('Azione');

    await expect(session.processAllPendingActions(30)).rejects.toMatchObject({
      name: 'EffectValidationError',
      code: 'MISSING_ACTION_ID',
    });

    expect(session.getCurrentDate()).toBe(dateBefore);
    expect(db.prepare('SELECT COUNT(*) AS n FROM simulation_checkpoints WHERE game_id = ?').get(gameId).n).toBe(0);
    expect(db.prepare('SELECT COUNT(*) AS n FROM simulation_outbox WHERE game_id = ?').get(gameId).n).toBe(0);
    expect(db.prepare('SELECT status FROM simulation_runs WHERE game_id = ?').get(gameId).status).toBe('failed');
    jumpMode = 'clean';
  });

  it('rifiuta effects non consentiti (MAT37/MAT38)', async () => {
    jumpMode = 'bad_effects';
    const { gameId, session } = createStrictGame();
    const dateBefore = session.getCurrentDate();
    session.queueAction('Azione');

    await expect(session.processAllPendingActions(30)).rejects.toMatchObject({
      name: 'EffectValidationError',
      code: 'MISSING_CAUSE',
    });

    expect(session.getCurrentDate()).toBe(dateBefore);
    expect(db.prepare('SELECT COUNT(*) AS n FROM simulation_checkpoints WHERE game_id = ?').get(gameId).n).toBe(0);
    expect(db.prepare('SELECT COUNT(*) AS n FROM simulation_outbox WHERE game_id = ?').get(gameId).n).toBe(0);
    expect(db.prepare('SELECT status FROM simulation_runs WHERE game_id = ?').get(gameId).status).toBe('failed');
    jumpMode = 'clean';
  });

  it('risultato valido senza eventi non muta nulla (C10)', async () => {
    jumpMode = 'no_event';
    const { gameId, session } = createStrictGame();
    const dateBefore = session.getCurrentDate();
    const turnBefore = session.getCurrentTurn();
    const queued = session.queueAction('Attendere');

    const processed = await session.processAllPendingActions(0);

    expect(processed).toEqual([]);
    expect(session.getCurrentDate()).toBe(dateBefore);
    expect(session.getCurrentTurn()).toBe(turnBefore);
    expect(session.getPendingActions()).toEqual([expect.objectContaining({ id: queued.id, status: 'pending' })]);
    expect(db.prepare('SELECT COUNT(*) AS n FROM simulation_checkpoints WHERE game_id = ?').get(gameId).n).toBe(0);
    jumpMode = 'clean';
  });

  it('rollback checkpoint pausato annulla anche cashflow/ledger del tick', async () => {
    jumpMode = 'two_events';
    const { gameId, session } = createStrictGame();
    const branchId = gameRepository.getHeadBranch(gameId);
    if (!branchId) throw new Error('branch fixture mancante');
    const ledger = await import('../src/repositories/ledger.repository');
    const finance = await import('../src/services/FinanceService');
    ledger.appendLedgerEntries(gameId, branchId, [{ effectId: 'cash-seed', entryIndex: 0, cause: 'incasso', kind: 'money', unitId: 'test', fromRef: null, toRef: 'treasury', delta: '50', atDate: '1951-01-01' }]);
    finance.createCashflow(gameId, branchId, { cashflowId: 'due-in-step', debtor: { ref: 'treasury', currencyId: 'test' }, creditor: { ref: 'court', currencyId: 'test' }, amount: '50', dueDate: '1951-01-05', legalPriority: 0, partialAllowed: false, shortagePolicy: 'arrears' });
    const queued = session.queueAction('Periodo con scadenza');
    currentActionId = queued.id;
    const fault = vi.spyOn(gameRepository, 'addSimulationEvents').mockImplementation(() => { throw new Error('fault dopo tick'); });
    await expect(session.processAllPendingActions(30)).rejects.toThrow('fault dopo tick');
    fault.mockRestore();
    const accounts = ledger.reconstructBalances(branchId).accounts;
    expect(accounts.find(x => x.ref === 'treasury')?.balance).toBe('50');
    expect(accounts.find(x => x.ref === 'court')).toBeUndefined();
    expect(db.prepare('SELECT status, outstanding_amount FROM finance_cashflows WHERE branch_id = ? AND cashflow_id = ?').get(branchId, 'due-in-step')).toEqual({ status: 'scheduled', outstanding_amount: '50' });
    expect(db.prepare('SELECT COUNT(*) AS n FROM simulation_checkpoints WHERE game_id = ?').get(gameId).n).toBe(0);
    currentActionId = '';
    jumpMode = 'clean';
  });

  it('fault della completion dopo l ultimo step committato non rolla due volte (B2)', async () => {
    jumpMode = 'two_events_chained_fault';
    const { session } = createStrictGame();
    const queued = session.queueAction('Salto con completion fault');
    currentActionId = queued.id;
    const first = await session.processAllPendingActions(30);
    if (Array.isArray(first)) throw new Error('playback atteso');
    // L'ultimo evento (01-31 = destinazione) chiama la completion DALLO step:
    // il suo fault non deve ripassare dal catch dello step (doppio rollback).
    await expect(session.continueSimulation(first.simulationId)).rejects.toThrow(/non staged/);
    // RAM = post-step (data dell'ultimo evento), non pre-step; run failed; niente pausedRun fantasma.
    expect(session.getCurrentDate()).toBe('1951-01-31');
    expect(db.prepare('SELECT status FROM simulation_runs WHERE id=?').get(first.simulationId).status).toBe('failed');
    expect(session.getPausedRunInfo()).toBeNull();
    expect(session.getPendingActions()).toEqual([expect.objectContaining({ id: queued.id, status: 'pending' })]);
    // La sessione NON è bloccata: un salto pulito successivo funziona.
    jumpMode = 'clean';
    currentActionId = '';
    const again = session.queueAction('Nuovo ordine dopo il fault');
    currentActionId = again.id;
    // La coda contiene il requeue + il nuovo ordine: entrambi processati = sessione viva.
    await expect(session.processAllPendingActions(30)).resolves.toHaveLength(2);
    currentActionId = '';
    jumpMode = 'clean';
  });

  it('fault sul checkpoint non perde evento estratto dalla RAM; retry lo ricommette', async () => {
    jumpMode = 'two_events';
    const { session } = createStrictGame();
    const queued = session.queueAction('Playback con retry');
    currentActionId = queued.id;
    const first = await session.processAllPendingActions(30);
    if (Array.isArray(first)) throw new Error('playback atteso');
    const fault = vi.spyOn(gameRepository, 'addSimulationEvents').mockImplementation(() => { throw new Error('checkpoint fault'); });
    await expect(session.continueSimulation(first.simulationId)).rejects.toThrow('checkpoint fault');
    fault.mockRestore();
    // M2 (quarta revisione): i campi checkpoint fantasma sono ripristinati:
    // il lettore continua a puntare al checkpoint confermato, non al tentativo fallito.
    expect(session.getPausedRunInfo()).toMatchObject({ eventId: first.event.id });
    const retried = await session.continueSimulation(first.simulationId);
    if (!retried.paused) throw new Error('pausa attesa dopo retry');
    expect(retried.event.headline).toBe('Seconda');
    expect(retried.newDate).toBe('1951-01-20');
    currentActionId = '';
    jumpMode = 'clean';
  });

  it('effect staged resta valido attraverso i checkpoint del playback', async () => {
    jumpMode = 'two_events_staged';
    const { gameId, session } = createStrictGame();
    const branchId = gameRepository.getHeadBranch(gameId);
    if (!branchId) throw new Error('branch fixture mancante');
    const ledger = await import('../src/repositories/ledger.repository');
    const staging = await import('../src/repositories/strict-effect-staging.repository');
    ledger.appendLedgerEntries(gameId, branchId, [{ effectId: 'playback-seed', entryIndex: 0, cause: 'incasso', kind: 'money', unitId: 'test', fromRef: null, toRef: 'treasury', delta: '20', atDate: '1951-01-01' }]);
    staging.stageLedgerEffect(gameId, branchId, gameRepository.getWorldRevision(gameId), { effectId: 'playback-payment', entryIndex: 0, cause: 'pagamento', kind: 'money', unitId: 'test', fromRef: 'treasury', toRef: 'court', delta: '20', atDate: '1951-01-31' });
    const queued = session.queueAction('Pagamento in playback');
    currentActionId = queued.id;
    const first = await session.processAllPendingActions(30);
    if (Array.isArray(first)) throw new Error('playback atteso');
    expect(db.prepare('SELECT anchor_revision FROM strict_effect_staging WHERE branch_id=? AND effect_id=?').get(branchId, 'playback-payment').anchor_revision).toBe(1);
    const second = await session.continueSimulation(first.simulationId);
    if (!second.paused) throw new Error('seconda pausa attesa');
    expect(db.prepare('SELECT anchor_revision FROM strict_effect_staging WHERE branch_id=? AND effect_id=?').get(branchId, 'playback-payment').anchor_revision).toBe(2);
    await expect(session.continueSimulation(first.simulationId)).resolves.toMatchObject({ paused: false, type: 'run_completed' });
    expect(ledger.reconstructBalances(branchId).accounts.find(x => x.ref === 'court')?.balance).toBe('20');
    currentActionId = '';
    jumpMode = 'clean';
  });

  it('failure durante failed+requeue rollbacka entrambe e conserva paused coerente', async () => {
    jumpMode = 'two_events_missing_staged';
    const { gameId, session } = createStrictGame();
    const queued = session.queueAction('Failure della transizione failed');
    currentActionId = queued.id;
    const first = await session.processAllPendingActions(30);
    if (Array.isArray(first)) throw new Error('playback atteso');
    const second = await session.continueSimulation(first.simulationId);
    if (!second.paused) throw new Error('seconda pausa attesa');
    const fault = vi.spyOn(gameRepository, 'replacePendingActions').mockImplementation(() => { throw new Error('requeue fault'); });
    await expect(session.continueSimulation(first.simulationId)).rejects.toThrow(/non staged/);
    fault.mockRestore();
    expect(db.prepare('SELECT status FROM simulation_runs WHERE id=?').get(first.simulationId).status).toBe('awaiting_next');
    expect(session.getPausedRunInfo()).toMatchObject({ simulationId: first.simulationId });
    expect(db.prepare('SELECT status FROM pending_actions WHERE game_id=? AND id=?').get(gameId, queued.id).status).toBe('processing');
    currentActionId = '';
    jumpMode = 'clean';
  });

  it('completion staged mancante chiude un run pausato come failed', async () => {
    jumpMode = 'two_events_missing_staged';
    const { gameId, session } = createStrictGame();
    const queued = session.queueAction('Periodo staged invalido');
    currentActionId = queued.id;
    const first = await session.processAllPendingActions(30);
    if (Array.isArray(first)) throw new Error('playback atteso');
    const second = await session.continueSimulation(first.simulationId);
    if (!second.paused) throw new Error('seconda pausa attesa');
    await expect(session.continueSimulation(first.simulationId)).rejects.toThrow(/non staged/);
    expect(db.prepare('SELECT status FROM simulation_runs WHERE id = ?').get(first.simulationId).status).toBe('failed');
    expect(session.getPausedRunInfo()).toBeNull();
    expect(session.getPendingActions()).toEqual([expect.objectContaining({ id: queued.id, status: 'pending' })]);
    currentActionId = '';
    jumpMode = 'clean';
  });

  it('GameSession produce e applica project_tick da lavoro server schedulato (M05→M06)', async () => {
    jumpMode = 'clean';
    const { gameId, session } = createStrictGame();
    const branchId = gameRepository.getHeadBranch(gameId);
    if (!branchId) throw new Error('branch fixture mancante');
    const engine = await import('../src/core/projects/ProjectEngine');
    const projects = await import('../src/repositories/project-runtime.repository');
    const producer = await import('../src/services/StrictEffectProducerService');
    const plan: import('../src/core/projects/ProjectEngine').ProjectPlan = { id: 'e2e_project', phases: [{ id: 'phase', dependencyIds: [], workload: '5', minDays: 1, requiresCommissioning: false }] };
    projects.createProjectRuntime(gameId, branchId, plan, engine.activatePhase(plan, engine.authorizeProject(engine.createProject(plan)), 'phase'));
    producer.scheduleVerifiedProjectWork(gameId, branchId, { effectId: 'e2e-work', projectId: 'e2e_project', phaseId: 'phase', workDone: '5', dueDate: '1951-01-02' });
    const queued = session.queueAction('Continua il progetto verificato');
    currentActionId = queued.id;
    await expect(session.processAllPendingActions(30)).resolves.toHaveLength(1);
    expect(projects.getProjectRuntime(branchId, 'e2e_project')).toMatchObject({ version: 1, state: { phases: [{ status: 'completed', completedWork: '5', workedDays: 1 }] } });
    expect(db.prepare('SELECT status FROM project_work_schedule WHERE branch_id=? AND effect_id=?').get(branchId, 'e2e-work').status).toBe('applied');
    currentActionId = '';
  });

  it('applica un ledger solo se staged dal server sullo stesso anchor (M02→M06)', async () => {
    jumpMode = 'staged_ledger';
    const { gameId, session } = createStrictGame();
    const branchId = gameRepository.getHeadBranch(gameId);
    if (!branchId) throw new Error('branch fixture mancante');
    const ledger = await import('../src/repositories/ledger.repository');
    const staging = await import('../src/repositories/strict-effect-staging.repository');
    ledger.appendLedgerEntries(gameId, branchId, [{ effectId: 'm06-seed', entryIndex: 0, cause: 'incasso', kind: 'money', unitId: 'test', fromRef: null, toRef: 'treasury', delta: '30', atDate: '1951-01-01' }]);
    staging.stageLedgerEffect(gameId, branchId, gameRepository.getWorldRevision(gameId), { effectId: 'm06-staged-payment', entryIndex: 0, cause: 'pagamento', kind: 'money', unitId: 'test', fromRef: 'treasury', toRef: 'court', delta: '30', atDate: '1951-01-10' });
    const queued = session.queueAction('Pagamento autorizzato');
    currentActionId = queued.id;
    await expect(session.processAllPendingActions(30)).resolves.toHaveLength(1);
    expect(ledger.reconstructBalances(branchId).accounts.find(x => x.ref === 'court')?.balance).toBe('30');
    expect(db.prepare("SELECT status FROM strict_effect_staging WHERE branch_id = ? AND effect_id = ?").get(branchId, 'm06-staged-payment').status).toBe('consumed');
    currentActionId = '';
    jumpMode = 'clean';
  });

  it('commit strict valido non avanza PIL/popolazione/militare legacy (M06)', async () => {
    jumpMode = 'clean';
    const { gameId, session } = createStrictGame();
    const before = db.prepare('SELECT population, gdp, military_power FROM game_regions WHERE game_id = ? AND region_id = ?')
      .get(gameId, `${STRICT_WORLD}_DEU`);
    const queued = session.queueAction('Azione');
    currentActionId = queued.id;

    const processed = await session.processAllPendingActions(30);

    expect(processed).toHaveLength(1);
    expect(session.getCurrentDate()).toBe('1951-01-31');
    expect(db.prepare('SELECT COUNT(*) AS n FROM simulation_checkpoints WHERE game_id = ?').get(gameId).n).toBe(1);
    expect(db.prepare('SELECT status FROM simulation_runs WHERE game_id = ?').get(gameId).status).toBe('completed');
    const after = db.prepare('SELECT population, gdp, military_power FROM game_regions WHERE game_id = ? AND region_id = ?')
      .get(gameId, `${STRICT_WORLD}_DEU`);
    expect(after).toEqual(before);
    currentActionId = '';
    jumpMode = 'clean';
  });
});
