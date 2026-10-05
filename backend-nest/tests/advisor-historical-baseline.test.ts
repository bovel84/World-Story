/**
 * WS-GOV-ADVISOR-HISTORICAL-BASELINE — REAL HISTORY → START DATE → PLAYER HISTORY.
 *
 * Test mirati: la storia reale del paese diventa un blocco esplicito e canonico
 * del contesto del Consulente; il taglio temporale è rigido; il current state
 * prevale; la prima apertura usa il percorso LLM con fallback deterministico.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const DB = path.join(os.tmpdir(), `world-story-historical-baseline-${process.pid}-${Date.now()}.db`);
process.env.OPEN_PAX_DB_PATH = DB;

let db: typeof import('../src/database').default;
let registry: import('../src/session-registry').SessionRegistry;
let gameRepository: typeof import('../src/repositories').gameRepository;
let buildRealityAdvisorContext: typeof import('../src/core/government/RealityAdvisor').buildRealityAdvisorContext;
let buildRealityAdvisorPrompt: typeof import('../src/core/government/RealityAdvisor').buildRealityAdvisorPrompt;
let guardRealityAdvisorOutput: typeof import('../src/core/government/RealityAdvisor').guardRealityAdvisorOutput;
let withAdvisorStrategicContext: typeof import('../src/core/government/RealityAdvisor').withAdvisorStrategicContext;
let sanitizeHistoricalBaseline: typeof import('../src/core/government/HistoricalBaseline').sanitizeHistoricalBaseline;
let buildHistoricalBaselinePrompt: typeof import('../src/core/government/HistoricalBaseline').buildHistoricalBaselinePrompt;
let buildVerifiedWorldSnapshot: typeof import('../src/core/government/VerifiedWorldSnapshot').buildVerifiedWorldSnapshot;

const WORLD = 'hb_world';

/** Prosa "storica" abbastanza lunga da superare la soglia minima del sanitizer. */
const historyFor = (country: string) => country === 'Cambogia'
  ? 'La Cambogia portava l’eredità del regime dei Khmer Rossi, al potere dal 1975 al 1979, e di un lungo conflitto civile. Gli accordi di Parigi del 1991 e le elezioni del 1993 aprirono una fase di ricostruzione istituzionale. La distruzione del capitale umano e le fragilità amministrative pesavano sullo sviluppo. L’ingresso nell’ASEAN nel 1999 offriva prospettive di integrazione regionale, senza cancellare le sensibilità nei rapporti con il Vietnam.'
  : 'Gli Stati Uniti uscivano dalla Guerra Fredda con una posizione internazionale dominante dopo la dissoluzione dell’Unione Sovietica nel 1991. La NATO, fondata nel 1949, restava una componente importante del loro sistema di alleanze. L’economia degli anni Novanta beneficiava dell’innovazione informatica e dell’espansione dei servizi, mentre persistenti disuguaglianze e tensioni politiche interne rendevano controversa la distribuzione dei benefici della crescita.';

let baselineCalls = 0;
let openingCalls = 0;
let openingProse = 'Presidente, il paese entra nel nuovo secolo dopo decenni difficili. La priorità è scegliere dove concentrare risorse ancora limitate, evitando di aprire troppi fronti.';
let failGeneration = false;
let failBaselineOnly = false;
const capturedPrompts: string[] = [];

const stubProvider: any = {
  consolidation: { startRound: 25, chunkSize: 5, keepRawTail: 10 },
  async generate(_mechanic: string, system: string, user: string) {
    if (failGeneration) throw new Error('provider offline');
    if (system.includes('storico di riferimento')) {
      if (failBaselineOnly) throw new Error('history unavailable');
      baselineCalls += 1;
      const country = user.includes('KHM') ? 'Cambogia' : 'Stati Uniti';
      // Una frase con eventi REALI successivi al 2000: non deve entrare nel contesto.
      return { content: JSON.stringify({ entries: [{ date: '1999', text: historyFor(country) }, { date: '2008-01-01', text: 'EVENTO_REALE_FUTURO' }] }) };
    }
    capturedPrompts.push(user);
    if (_mechanic === 'jump') return { content: JSON.stringify({ type: 'complete', narration: 'Nessun nuovo impegno.', targetDate: '2000-01-08', actionOutcomes: [], voided: [], startChat: [], relationshipChanges: [], worldChanges: { regionOwners: {}, regionColors: {} } }) };
    openingCalls += 1;
    return { content: openingProse };
  },
  async stream(_mechanic: string, system: string, user: string) {
    return this.generate(_mechanic, system, user);
  },
  clearCache() {},
};

beforeAll(async () => {
  const database = await import('../src/database');
  db = database.default;
  database.initDatabase();
  const repos = await import('../src/repositories');
  gameRepository = repos.gameRepository;
  ({ buildRealityAdvisorContext, buildRealityAdvisorPrompt, guardRealityAdvisorOutput, withAdvisorStrategicContext } = await import('../src/core/government/RealityAdvisor'));
  ({ sanitizeHistoricalBaseline, buildHistoricalBaselinePrompt } = await import('../src/core/government/HistoricalBaseline'));
  ({ buildVerifiedWorldSnapshot } = await import('../src/core/government/VerifiedWorldSnapshot'));
  const registryModule = await import('../src/session-registry');
  registryModule.initSessionRegistry(stubProvider);
  registry = registryModule.getSessionRegistry();

  repos.worldRepository.createWithRegions(
    { id: WORLD, name: 'Millennium Dawn (baseline)', description: '', startDate: '2000-01-01', basePrompt: 'Il mondo entra nel nuovo millennio.', historicalAccuracy: 0.7 },
    [
      { id: 'hb_khm', name: 'Phnom Penh', color: '#123456', owner: 'KHM', population: 12_000_000, gdp: 3_600, militaryPower: 30, flag: 'KHM', coastal: true, borders: [], objects: [] },
      { id: 'hb_usa', name: 'Washington', color: '#223344', owner: 'USA', population: 280_000_000, gdp: 9_800_000, militaryPower: 900, flag: 'USA', coastal: true, borders: [], objects: [] },
    ],
  );
});

afterAll(() => {
  db?.close();
  for (const suffix of ['', '-wal', '-shm']) fs.rmSync(DB + suffix, { force: true });
});

const create = (regionId: string) => registry.getSession(registry.createSession(WORLD, 'Presidente', regionId, '#123456').gameId)!;

const uganda = (date = '1951-01-01', turn = 1) => buildVerifiedWorldSnapshot({ gameData: {
  id: 'uganda', playerPolityId: 'UGA', playerPolityName: 'Uganda', currentDate: date, currentTurn: turn,
  world: { regions: { ug: { id: 'ug', name: 'Uganda', owner: 'UGA', coastal: false, borders: [], objects: [] } } },
  worldState: { resources: { stock: { money: 10 }, needs: { food: 1 } }, accounts: { UGA: { socialTension: 25 } }, arsenal: { units: {} } },
}, commitments: [], operationalRows: [] });

describe('WS-GOV-ADVISOR-HISTORICAL-BASELINE', () => {
  it('1 — Cambogia 2000: la storia reale diventa un blocco canonico del contesto, generato una volta', async () => {
    const session = create('hb_khm');
    const opening = await session.getAdvisorOpening();
    expect(opening.advisorContext.historicalBaseline).toBeTruthy();
    expect(opening.advisorContext.historicalBaseline).toContain('Cambogia');
    expect(baselineCalls).toBe(1);
    // Canonico per la partita: persistito e riusato senza una seconda generazione.
    expect(gameRepository.getPolityHistoricalBaseline(session.id, 'KHM', '2000-01-01')?.historicalBackground).toContain('Cambogia');
    await session.getAdvisorOpening();
    expect(baselineCalls).toBe(1);
  });

  it('2 — USA 2000: baseline diversa per il paese selezionato', async () => {
    const usa = await create('hb_usa').getAdvisorOpening();
    const khm = await create('hb_khm').getAdvisorOpening();
    expect(usa.advisorContext.historicalBaseline).toContain('Stati Uniti');
    expect(usa.advisorContext.historicalBaseline).not.toBe(khm.advisorContext.historicalBaseline);
  });

  it('3 — eventi reali successivi alla data iniziale non entrano nel contesto', async () => {
    const raw = `${historyFor('Cambogia')} Nel 2008 una crisi globale travolse i mercati. Nel 2003 iniziò una guerra regionale.`;
    const sanitized = sanitizeHistoricalBaseline(raw, '2000-01-01')!;
    expect(sanitized).not.toContain('2008');
    expect(sanitized).not.toContain('2003');
    expect(sanitized).toContain('1993');
    const context = withAdvisorStrategicContext(buildRealityAdvisorContext(uganda('2000-01-01'), undefined, sanitized).advisorContext, '2000-01-01', [], '');
    const prompt = buildRealityAdvisorPrompt(context, 'Cosa dobbiamo aspettarci?');
    expect(prompt).toContain('[HISTORICAL BASELINE');
    expect(prompt).not.toContain('2008');
    // Il taglio temporale resta dichiarato anche all'LLM.
    expect(prompt).toContain('Data iniziale del preset: 2000-01-01');
  });

  it('4 — un evento della partita del 2002 entra nella player history accanto alla baseline', () => {
    const base = buildRealityAdvisorContext(uganda('2002-06-01'), undefined, sanitizeHistoricalBaseline(historyFor('Cambogia'), '2000-01-01')!).advisorContext;
    const context = withAdvisorStrategicContext(base, '2000-01-01', [{
      id: 'r2002', turn: 1, date: '2002-06-01', events: ['Riforma agraria approvata'], narration: '',
    }], 'riforma');
    const prompt = buildRealityAdvisorPrompt(context, 'Come procede la riforma agraria?');
    expect(prompt).toContain('[HISTORICAL BASELINE');
    expect(prompt).toContain('[CRONACA STRATEGICA');
    expect(prompt).toContain('Riforma agraria approvata');
    expect(prompt).toContain('2002-06-01');
  });

  it('5 — il current state prevale sulla baseline e la gerarchia è dichiarata', () => {
    const snapshot = uganda();
    const context = buildRealityAdvisorContext(snapshot, undefined, 'Storicamente il paese disponeva di un porto importante sul fiume.').advisorContext;
    const prompt = buildRealityAdvisorPrompt(context, 'Ampliamo il porto di Kampala.');
    expect(prompt).toContain('CURRENT STATE > PLAYER HISTORY > HISTORICAL BASELINE');
    expect(prompt).toContain("L'assenza di un dettaglio nel presente NON prova che sia storicamente inesistente");
    // La baseline non può autorizzare un bene assente dal present state.
    expect(guardRealityAdvisorOutput(context, 'Possiamo ampliare il porto di Kampala.')).toContain('Non ho un dato verificato');
  });

  it('6 — la prima apertura usa il percorso LLM, non il briefing deterministico', async () => {
    const session = create('hb_khm');
    const opening = await session.getAdvisorOpening();
    expect(opening.fallback).toBe(false);
    expect(opening.reply).toBe(openingProse);
    expect(opening.reply).not.toBe(opening.advisorContext.governmentBrief);
    expect(openingCalls).toBeGreaterThan(0);
    // 3-6 paragrafi brevi, nessuna sezione FACT visibile.
    expect(opening.reply).not.toMatch(/(?:^|\n)\s*(?:FACT|INFERENCE|FORECAST|PROPOSAL)\s*[—–:-]/);
  });

  it('7 — se la generazione fallisce resta il fallback deterministico', async () => {
    const session = create('hb_usa');
    failGeneration = true;
    try {
      const opening = await session.getAdvisorOpening();
      expect(opening.fallback).toBe(true);
      expect(opening.reply).toBe(opening.advisorContext.governmentBrief);
      expect(opening.reply.length).toBeGreaterThan(0);
      expect(opening.issues).toEqual([]);
    } finally {
      failGeneration = false;
    }
  });

  it('persists and coalesces a relevant NPC baseline across reconstructed sessions', async () => {
    const session = create('hb_khm');
    const before = baselineCalls;
    const [a, b] = await Promise.all([session.getPolityHistoricalBaseline('USA'), session.getPolityHistoricalBaseline('USA')]);
    expect(a).toEqual(b);
    expect(a).toMatchObject({ polityId: 'USA', startDate: '2000-01-01', version: 2 });
    expect(baselineCalls - before).toBe(1);
    const state = structuredClone((session as any).captureCheckpointData());
    const { GameSession } = await import('../src/game-session');
    const reloaded = new GameSession(session.id, WORLD, stubProvider);
    reloaded.loadFromSave(state);
    expect(await reloaded.getPolityHistoricalBaseline('USA')).toEqual(a);
    expect(baselineCalls - before).toBe(1);
    gameRepository.storePolityHistoricalBaseline(session.id, { ...a!, historicalBackground: historyFor('Cambogia') });
    expect(gameRepository.getPolityHistoricalBaseline(session.id, 'USA', '2000-01-01')).toEqual(a);
    expect(db.prepare('SELECT COUNT(*) AS n FROM game_polity_historical_baselines WHERE game_id = ? AND polity_id = ?').get(session.id, 'USA')).toEqual({ n: 1 });
    expect(await reloaded.getPolityHistoricalBaseline('NON_EXISTENT')).toBeNull();
  });

  it('relevant diplomacy NPC receives its own history but the current hostile relation wins', async () => {
    const session = create('hb_khm');
    const state = structuredClone((session as any).captureCheckpointData());
    state.relationships = { KHM: { USA: 'hostile' }, USA: { KHM: 'hostile' } };
    session.loadFromSave(state);
    const chat = session.ensureChat(['Washington']);
    await session.sendChatMessage(chat.id, 'Possiamo discutere una distensione?');
    const prompt = capturedPrompts.at(-1)!;
    expect(prompt).toContain('[OWN HISTORICAL BASELINE');
    expect(prompt).toContain('Stati Uniti');
    expect(prompt).toContain('[COUNTERPARTY HISTORICAL BASELINE');
    expect(prompt).toContain('Khmer Rossi');
    expect(prompt).toContain('Relazione corrente di USA con KHM: hostile');
    expect(prompt).toContain('La relazione CORRENTE prevale');
    expect(prompt).not.toContain('EVENTO_REALE_FUTURO');
  });

  it('stalled optional NPC history cannot hold play beyond its short context budget', async () => {
    const provider: LLMProvider = { ...stubProvider, generate: async (mechanic, system, user, options) => {
      if (system.includes('storico di riferimento')) return new Promise(() => {});
      return stubProvider.generate(mechanic, system, user, options);
    } };
    const original = create('hb_khm');
    const { GameSession } = await import('../src/game-session');
    const session = new GameSession(original.id, WORLD, provider);
    session.loadFromSave(structuredClone((original as any).captureCheckpointData()));
    const before = session.getVerifiedWorldSnapshot();
    vi.useFakeTimers();
    try {
      const context = session.preparePolityHistoricalBaselines(['USA']);
      await vi.advanceTimersByTimeAsync(2_001);
      expect(await context).toEqual([]);
      expect(session.getVerifiedWorldSnapshot()).toEqual(before);
      await vi.advanceTimersByTimeAsync(12_001);
      expect(await session.getPolityHistoricalBaseline('USA')).toBeNull();
    } finally { vi.useRealTimers(); }
  });

  it('cancelling one coalesced caller does not cancel history for the other caller', async () => {
    let release: (() => void) | undefined;
    const provider: LLMProvider = { ...stubProvider, generate: async (mechanic, system, user, options) => {
      if (!system.includes('storico di riferimento')) return stubProvider.generate(mechanic, system, user, options);
      return new Promise((resolve, reject) => {
        release = () => resolve({ content: JSON.stringify({ entries: [{ date: '1999', text: historyFor('Stati Uniti') }] }) });
        options?.signal?.addEventListener('abort', () => reject(new Error('aborted')), { once: true });
      });
    } };
    const original = create('hb_khm');
    const { GameSession } = await import('../src/game-session');
    const session = new GameSession(original.id, WORLD, provider);
    session.loadFromSave(structuredClone((original as any).captureCheckpointData()));
    const controller = new AbortController();
    const first = session.getPolityHistoricalBaseline('USA', controller.signal);
    const second = session.getPolityHistoricalBaseline('USA');
    while (!release) await new Promise(resolve => setTimeout(resolve, 0));
    controller.abort(); release();
    expect(await first).toBeNull();
    expect(await second).toMatchObject({ polityId: 'USA', version: 2 });
  });

  it('a council minister opening receives relevant counterpart history', async () => {
    const session = create('hb_khm');
    await session.getMinisterOpening('esteri', undefined, { title: 'Rapporti con Washington', briefing: 'Come valutiamo le alternative diplomatiche con Washington?' });
    expect(capturedPrompts.at(-1)).toContain('Stati Uniti');
    expect(capturedPrompts.at(-1)).toContain('Khmer Rossi');
  });

  it('passes the relevant NPC background to the strategic simulation prompt without applying historical effects', async () => {
    const session = create('hb_khm');
    const gameData = (session as any).buildGameData(['Washington']);
    gameData.polityHistoricalBaselines = await session.preparePolityHistoricalBaselines(['USA']);
    const { GameController } = await import('../src/agents');
    const controller = new GameController(stubProvider);
    const before = session.getVerifiedWorldSnapshot();
    await controller.processTurnWithPrompts(gameData, [], 7);
    const prompt = capturedPrompts.at(-1)!;
    expect(prompt).toContain('POLITY HISTORICAL BASELINES');
    expect(prompt).toContain('Stati Uniti');
    expect(prompt).toContain('Khmer Rossi');
    expect(prompt).toContain('CURRENT STATE > PLAYER HISTORY > HISTORICAL BASELINE');
    expect(session.getVerifiedWorldSnapshot()).toEqual(before);
  });

  it('imports the previous player-only background without assigning it to other polities', async () => {
    const session = create('hb_khm');
    db.prepare('UPDATE games SET historical_baseline = ? WHERE id = ?').run(`${historyFor('Cambogia')} In ottobre 2000 avvenne EVENTO_FUTURO.`, session.id);
    const { initDatabase } = await import('../src/database');
    initDatabase();
    const baseline = gameRepository.getPolityHistoricalBaseline(session.id, 'KHM', '2000-01-01');
    expect(baseline?.version).toBe(1);
    expect(baseline?.historicalBackground).toContain('Khmer Rossi');
    expect(baseline?.historicalBackground).not.toContain('EVENTO_FUTURO');
    expect(gameRepository.getPolityHistoricalBaseline(session.id, 'USA', '2000-01-01')).toBeNull();
    const before = baselineCalls;
    expect(await session.getPolityHistoricalBaseline('KHM')).toEqual(baseline);
    expect(baselineCalls).toBe(before);
  });

  it('initial opening and later turn briefing follow the server clock and actual game history', async () => {
    const session = create('hb_khm');
    await session.getAdvisorOpening();
    expect(capturedPrompts.at(-1)).toContain('[INITIAL HISTORICAL OPENING]');
    const state = structuredClone((session as any).captureCheckpointData());
    state.currentTurn = 2; state.currentDate = '2002-06-01';
    state.results = [{ id: 'reform', turn: 1, date: '2002-01-01', narration: '', countryResponse: '', events: ['Riforma del 2002 approvata nella partita'] }];
    session.loadFromSave(state);
    await session.getAdvisorOpening();
    const prompt = capturedPrompts.at(-1)!;
    expect(prompt).toContain('[TURN BRIEFING]');
    expect(prompt).not.toContain('primo intervento del mandato');
    expect(prompt).toContain('PLAYER HISTORY');
    expect(prompt).toContain('Riforma del 2002 approvata nella partita');
    expect(prompt).toContain('2002-01-01');
    expect(prompt).toContain('CURRENT STATE > PLAYER HISTORY > HISTORICAL BASELINE');
  });

  it('a failed NPC background does not prevent a diplomatic response from current state', async () => {
    const session = create('hb_khm');
    const chat = session.ensureChat(['Washington']);
    failBaselineOnly = true;
    try {
      const { reply } = await session.sendChatMessage(chat.id, 'Valutiamo le alternative.');
      expect(reply.content).toBeTruthy();
      expect(gameRepository.getPolityHistoricalBaseline(session.id, 'USA', '2000-01-01')).toBeNull();
      expect(capturedPrompts.at(-1)).not.toContain('[OWN HISTORICAL BASELINE');
    } finally { failBaselineOnly = false; }
  });

  it('8 — il prompt chiede di spiegare il presente con la storia, senza dump', () => {
    const prompt = buildHistoricalBaselinePrompt({
      worldName: 'Millennium Dawn', polityId: 'KHM', countryName: 'Cambogia', startDate: '2000-01-01',
      premise: 'Il mondo entra nel nuovo millennio.',
    });
    expect(prompt).toContain('Cambogia');
    expect(prompt).toContain('2000');
    expect(prompt).toContain('perché il paese è così oggi');
    expect(prompt).toContain('STRETTAMENTE anteriore a 2000-01-01');
    expect(prompt).toContain('Non descrivere il presente della simulazione');
  });
});
