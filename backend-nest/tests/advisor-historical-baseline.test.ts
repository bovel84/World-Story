/**
 * WS-GOV-ADVISOR-HISTORICAL-BASELINE — REAL HISTORY → START DATE → PLAYER HISTORY.
 *
 * Test mirati: la storia reale del paese diventa un blocco esplicito e canonico
 * del contesto del Consulente; il taglio temporale è rigido; il current state
 * prevale; la prima apertura usa il percorso LLM con fallback deterministico.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
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
const historyFor = (country: string) => [
  `${country}, fino al 2000, arriva al nuovo secolo dopo decenni di trasformazioni profonde.`,
  'L\u2019evoluzione politica recente ha alternato aperture e regressioni, lasciando istituzioni giovani e non sempre solide.',
  'Le guerre e i conflitti precedenti, compresi quelli degli anni 1970 e 1993, hanno distrutto infrastrutture e capitali umano.',
  'Le trasformazioni economiche hanno aperto il paese ai mercati regionali, ma la crescita dipende ancora da pochi settori.',
  'I rapporti regionali restano diffidenti, con vicini piu grandi e una diplomazia che cerca garanzie senza concedere troppo.',
  'Le debolezze istituzionali, la situazione sociale e le infrastrutture incompiute spiegano perché serva una scelta di priorità.',
].join(' ');

let baselineCalls = 0;
let openingCalls = 0;
let openingProse = 'Presidente, il paese entra nel nuovo secolo dopo decenni difficili. La priorità è scegliere dove concentrare risorse ancora limitate, evitando di aprire troppi fronti.';
let failGeneration = false;

const stubProvider: any = {
  consolidation: { startRound: 25, chunkSize: 5, keepRawTail: 10 },
  async generate(_mechanic: string, system: string, user: string) {
    if (failGeneration) throw new Error('provider offline');
    if (system.includes('storico di riferimento')) {
      baselineCalls += 1;
      const country = user.includes('KHM') ? 'Cambogia' : 'Stati Uniti';
      // Una frase con eventi REALI successivi al 2000: non deve entrare nel contesto.
      return { content: `${historyFor(country)} Nel 2008 una crisi globale avrebbe travolto il paese, ma non è ancora accaduto.` };
    }
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
    expect(gameRepository.getHistoricalBaseline(session.id)).toContain('Cambogia');
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
    const context = withAdvisorStrategicContext(buildRealityAdvisorContext(uganda(), undefined, sanitized).advisorContext, '1951-01-01', [], '');
    const prompt = buildRealityAdvisorPrompt(context, 'Cosa dobbiamo aspettarci?');
    expect(prompt).toContain('[HISTORICAL BASELINE');
    expect(prompt).not.toContain('2008');
    // Il taglio temporale resta dichiarato anche all'LLM.
    expect(prompt).toContain('Data iniziale del preset: 1951-01-01');
  });

  it('4 — un evento della partita del 2002 entra nella player history accanto alla baseline', () => {
    const base = buildRealityAdvisorContext(uganda('2002-06-01'), undefined, sanitizeHistoricalBaseline(historyFor('Cambogia'), '1951-01-01')!).advisorContext;
    const context = withAdvisorStrategicContext(base, '1951-01-01', [{
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

  it('8 — il prompt chiede di spiegare il presente con la storia, senza dump', () => {
    const prompt = buildHistoricalBaselinePrompt({
      worldName: 'Millennium Dawn', polityId: 'KHM', countryName: 'Cambogia', startDate: '2000-01-01',
      premise: 'Il mondo entra nel nuovo millennio.',
    });
    expect(prompt).toContain('Cambogia');
    expect(prompt).toContain('2000');
    expect(prompt).toContain('perché il paese è così oggi');
    expect(prompt).toContain('non raccontare eventi successivi al 2000');
    expect(prompt).toContain('Non descrivere il presente della simulazione');
  });
});
