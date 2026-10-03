/**
 * GAMEPLAY-LONG — integrazione su una partita lunga.
 *
 * I singoli pezzi (crisi in giorni, sfide di pace con scadenza, memoria delle
 * fazioni, agenda NPC, registro degli impegni) sono coperti dai test dedicati.
 * Qui si verifica la cosa che conta davvero: che **regga la partita lunga**,
 * cioè che attraversino insieme turni, salvataggi, rewind, rami e il
 * consolidamento della cronaca — il punto in cui la memoria narrativa si
 * accorcia e lo stato strutturato deve restare intatto.
 */
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import os from 'os';
import path from 'path';
import fs from 'fs';
import { SITUATION_FOLLOW_UP_DAYS } from '../src/core/government/GovernmentSituations';

const TEST_DB = path.join(os.tmpdir(), `world-story-gplong-${process.pid}-${Date.now()}.db`);
process.env.OPEN_PAX_DB_PATH = TEST_DB;

const WORLD_ID = 'gplong_world';
let db: any;
let createGame: () => { gameId: string; session: any };

/** Riassunto canonico: il narratore accorcia, il registro no. */
const CANONICAL = 'Nel 1951 l’Italia consolidò i confini e strinse un patto commerciale con la Francia.';

const stubProvider: any = {
  consolidation: { startRound: 1, chunkSize: 1, keepRawTail: 0 },
  async generate(mechanic: string) {
    if (mechanic === 'consolidation') return { content: CANONICAL };
    return { content: '{}' };
  },
  async stream(mechanic: string, _s: string, _u: string, onToken: (chars: number) => void) {
    if (mechanic !== 'jump') throw new Error(`unexpected mechanic ${mechanic}`);
    const content = JSON.stringify({
      events: [{ headline: 'Colloqui di confine', description: 'Le delegazioni si incontrano.', date: '1951-02-01', mapChanges: [] }],
      narration: 'Il tempo passa senza nuove direttive.',
      voided: [],
      startChat: [],
      relationshipChanges: [],
      worldChanges: { regionOwners: {}, regionColors: {} },
      actionOutcomes: [],
    });
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
    { id: WORLD_ID, name: 'Long World', description: '', startDate: '2026-01-01', basePrompt: 'Test', historicalAccuracy: 0.8 },
    [
      {
        id: `${WORLD_ID}_ROM`, name: 'Italia', color: '#FF0000', owner: 'ROM',
        population: 59_000_000, gdp: 2300, militaryPower: 110, flag: 'ROM', coastal: true,
        borders: [`${WORLD_ID}_GAL`],
        objects: [{ id: 'f1', type: 'factory', name: 'Acciaierie', level: 4 }],
      },
      {
        id: `${WORLD_ID}_GAL`, name: 'Francia', color: '#0000FF', owner: 'GAL',
        population: 68_000_000, gdp: 2900, militaryPower: 160, flag: 'GAL', coastal: true,
        borders: [`${WORLD_ID}_ROM`],
        objects: [],
      },
      {
        id: `${WORLD_ID}_GER`, name: 'Germania', color: '#333333', owner: 'GER',
        population: 84_000_000, gdp: 4200, militaryPower: 190, flag: 'GER', coastal: true,
        borders: [`${WORLD_ID}_GAL`],
        objects: [],
      },
    ],
  );
  createGame = () => registry.createSession(WORLD_ID, 'Player', `${WORLD_ID}_ROM`, '#FF0000');
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

const pressure = (id: string, over: Record<string, unknown> = {}) => ({
  id,
  kind: 'internal' as const,
  template: 'strike-wave',
  title: 'Sciopero generale',
  detail: 'I sindacati chiedono aumenti.',
  severity: 2 as const,
  source: 'Sindacati',
  durationDays: 90,
  inaction: { socialTension: 8, stability: -3, note: 'Scioperi ignorati: la protesta si allarga.' },
  options: [
    { id: 'concede', label: 'Concedere aumenti', detail: 'Salari più alti.', effect: { socialTension: -14, revenueMultiplierDelta: -0.06, note: 'Aumenti concessi.' } },
    { id: 'refuse', label: 'Resistere', detail: 'Nessuna concessione.', effect: { stability: -6, socialTension: 9, note: 'Nessuna concessione.' } },
  ],
  ...over,
});

describe('GAMEPLAY-LONG — partita lunga', () => {
  it('il tempo scorre in giorni di calendario e la crisi non collassa in tre turni', async () => {
    const { session } = createGame();
    expect(session.getCurrentDate()).toBe('2026-01-01');
    await session.advanceDate(30);
    expect(session.getCurrentDate()).toBe('2026-01-31');
    expect(session.getCurrentTurn()).toBe(2);
    await session.advanceDate(30);
    expect(session.getCurrentDate()).toBe('2026-03-02');
    await session.advanceDate(30);
    expect(session.getCurrentDate()).toBe('2026-04-01');
    expect(session.getCurrentTurn()).toBe(4);

    // Tre «turni» sono 90 giorni: la soglia di collasso è misurata in giorni,
    // non nel numero di avanzamenti, quindi lo stato non può già essere crollato.
    const crisis = session.getCrisis();
    expect(crisis.collapseDays).toBeGreaterThan(0);
    const longestCriticalSpan = Math.max(0, ...Object.values(crisis.state.criticalDays));
    expect(longestCriticalSpan).toBeLessThan(crisis.collapseDays);
  });

  it('una sfida di pace scade alla sua data: l’inerzia presenta il conto', async () => {
    const { gameId, session } = createGame();
    const repos = await import('../src/repositories');
    const player = session.getPlayer();
    repos.gameRepository.insertPressures(gameId, player.polityId, [pressure('long#1')], session.getCurrentDate(), session.getCurrentTurn());

    await session.advanceDate(30);
    const afterOneTurn = session.getPeacetimePressures();
    const stillOpen = afterOneTurn.pressures.find((item: any) => item.id === 'long#1');
    // Dopo un solo turno la sfida è ancora aperta: la finestra è in giorni.
    expect(stillOpen).toBeTruthy();
    expect(stillOpen.status).toBe('active');
    expect(stillOpen.deadlineDate).toBe('2026-04-01');

    // Oltre la finestra di 90 giorni: scade anche senza essere guardata.
    await session.advanceDate(60);
    await session.advanceDate(30);
    const afterWindow = session.getPeacetimePressures();
    const expired = afterWindow.recent.find((item: any) => item.id === 'long#1');
    expect(expired?.status).toBe('expired');
    expect(expired?.resolution || '').toMatch(/inerzia|Scaduta/i);
  });

  it('la memoria delle fazioni accompagna la partita e non sostituisce i dati', async () => {
    const { gameId, session } = createGame();
    const repos = await import('../src/repositories');
    const player = session.getPlayer();
    repos.gameRepository.insertPressures(gameId, player.polityId, [pressure('long#mem')], session.getCurrentDate(), session.getCurrentTurn());
    session.resolvePeacetimePressure('long#mem', 'concede');

    const favourite = session.getGovernment().factions.find((item: any) => item.id === 'lavoratori');
    expect(favourite.politicalMemory.trust).toBeGreaterThan(50);
    expect(favourite.politicalMemory.pressure).toBeLessThan(0);

    // Dopo un anno di gioco la stessa memoria è più debole: decade col calendario.
    await session.advanceDate(365);
    const later = session.getGovernment().factions.find((item: any) => item.id === 'lavoratori');
    expect(Math.abs(later.politicalMemory.pressure)).toBeLessThan(Math.abs(favourite.politicalMemory.pressure));

    // La soddisfazione resta derivata dai dati: la memoria non la riscrive.
    expect(typeof later.satisfaction).toBe('number');
  });

  it('gli obiettivi delle potenze restano gli stessi fra un turno e l’altro', async () => {
    const { session } = createGame();
    const action = session.queueAction('Rafforza i confini settentrionali');
    session.gameController.processTurnWithPrompts = vi.fn().mockResolvedValue({
      events: [{ headline: 'Esercitazione', description: 'Manovre ai confini.', date: '2026-01-31', mapChanges: [] }],
      narration: 'Le forze si schierano.',
      convertedActions: [],
      actionOutcomes: [{ actionId: action.id, status: 'accepted', summary: 'Manovre eseguite' }],
      voided: [], startChat: [], worldChanges: { regionOwners: {}, regionColors: {} },
    } as any);
    await session.processNextAction(31);
    const first = session.getStrategicAgenda().powers;
    expect(first.some((power: any) => power.objectives.length > 0)).toBe(true);

    await session.advanceDate(30);
    const second = session.getStrategicAgenda().powers;

    // Stessa potenza, stesso obiettivo: la strategia non cambia a ogni lettura.
    let compared = 0;
    for (const power of first) {
      const after = second.find((item: any) => item.polityId === power.polityId);
      if (!after || after.objectives.length === 0) continue;
      expect(after.objectives[0].description).toBe(power.objectives[0].description);
      expect(after.objectives[0].since).toBe(power.objectives[0].since);
      compared += 1;
    }
    expect(compared).toBeGreaterThan(0);
  });

  it('dopo il consolidamento della cronaca il registro degli impegni è ancora lì', async () => {
    const { session } = createGame();
    const service = (session as any).commitments;
    service.apply([{
      type: 'trade-agreement', actor: 'ROM', counterparty: 'GAL',
      description: 'Accordo commerciale italo-francese', importance: 3, deadline: null,
      sourceEventId: 'test:long#treaty',
    }]);

    // Un turno vero: la cronaca si accorcia in memoria canonica (una riga).
    const action = session.queueAction('Commercia con la Francia');
    session.gameController.processTurnWithPrompts = vi.fn().mockResolvedValue({
      events: [{ headline: 'Trattative commerciali', description: 'Le delegazioni firmano.', date: '2026-01-31', mapChanges: [] }],
      narration: 'Le trattative proseguono.',
      convertedActions: [],
      actionOutcomes: [{ actionId: action.id, status: 'accepted', summary: 'Trattative avviate' }],
      voided: [], startChat: [], worldChanges: { regionOwners: {}, regionColors: {} },
    } as any);
    await session.processNextAction(31);

    const history = (session as any).consolidatedHistory;
    expect(history).toBe(CANONICAL);
    expect(history).not.toContain('Accordo commerciale italo-francese');

    // …ma il trattato è ancora disponibile, con stato e controparte.
    const commitments = session.getCommitments();
    const treaty = commitments.commitments.find((item: any) => item.type === 'trade-agreement');
    expect(treaty?.status).toBe('active');
    expect(treaty?.counterparty).toBe('GAL');
    expect(treaty?.description).toContain('italo-francese');
  });

  it('save/load, rewind e ramo conservano lo stato strutturato senza ereditare il futuro', async () => {
    const { gameId, session } = createGame();
    const repos = await import('../src/repositories');
    const player = session.getPlayer();
    const service = (session as any).commitments;
    service.apply([{
      type: 'treaty', actor: 'ROM', counterparty: 'GAL',
      description: 'Patto di non aggressione', importance: 3, deadline: null, sourceEventId: 'test:long#pact',
    }]);
    repos.gameRepository.insertPressures(gameId, player.polityId, [pressure('long#save')], session.getCurrentDate(), session.getCurrentTurn());
    session.resolvePeacetimePressure('long#save', 'concede');

    // Save/load: registro, memoria e agenda sopravvivono al ripristino.
    const expectedTrust = session.getGovernment().factions.find((item: any) => item.id === 'lavoratori').politicalMemory.trust;
    const { GameSession } = await import('../src/game-session');
    const restored = new GameSession(gameId, WORLD_ID, stubProvider);
    await restored.reconstructFromDB({
      currentTurn: session.getCurrentTurn(),
      currentDate: session.getCurrentDate(),
      players: [session.getPlayer()],
    });
    expect(restored.getCommitments().commitments.some((item: any) => item.description === 'Patto di non aggressione')).toBe(true);
    expect(restored.getGovernment().factions.find((item: any) => item.id === 'lavoratori').politicalMemory.trust).toBe(expectedTrust);

    // Il rewind riporta lo stato al turno restaurato, non a un turno dopo.
    await session.advanceDate(30);
    service.apply([{
      type: 'ultimatum', actor: 'ROM', counterparty: 'AUT',
      description: 'Ultimatum sul corridoio alpino', importance: 3, deadline: '2026-03-01', sourceEventId: 'test:long#ultimatum',
    }]);
    expect(session.getCommitments().commitments.some((item: any) => item.type === 'ultimatum')).toBe(true);
    expect(session.rewind()).toBeTruthy();
    expect(session.getCurrentDate()).toBe(restored.getCurrentDate());
    // L'ultimatum è sparito, il patto resta: si torna allo stato di allora.
    expect(session.getCommitments().commitments.some((item: any) => item.type === 'ultimatum')).toBe(false);
    expect(session.getCommitments().commitments.some((item: any) => item.description === 'Patto di non aggressione')).toBe(true);

    // Un ramo nuovo ha i propri registri: non eredita il futuro dell'altro ramo.
    const repos2 = await import('../src/repositories');
    const branchId = `branch-${Date.now()}`;
    repos2.gameRepository.createBranch({ id: branchId, gameId, name: 'ramo' });
    const branchCommitments = repos2.commitmentRepository.list(gameId, { branchId });
    const branchMemory = repos2.factionMemoryRepository.list(gameId, { branchId });
    expect(branchCommitments).toEqual([]);
    expect(branchMemory).toEqual([]);
    // Il ramo principale conserva invece ciò che ha firmato.
    expect(repos2.commitmentRepository.list(gameId).length).toBeGreaterThan(0);
  });

  it('P2-A — una decisione composta (forza + diplomazia) applica la somma degli effetti del motore', async () => {
    const { gameId, session } = createGame();
    const repos = await import('../src/repositories');
    const player = session.getPlayer();
    const incident = pressure('gov#border', {
      kind: 'external', template: 'border-incident', title: 'Incidente di frontiera con la Francia',
      detail: 'Due militari uccisi al valico.', severity: 3, source: 'Comando di frontiera', durationDays: 60,
      options: [
        { id: 'retaliate', label: 'Rispondere con la forza', detail: 'Colpo di mano.', effect: { relationship: { target: 'GAL', direction: 'degrade' }, stability: 4, socialTension: 6, note: 'Rappresaglia: escalation possibile.' } },
        { id: 'internationalize', label: 'Portare il caso all’ONU', detail: 'Tribuna internazionale.', effect: { socialTension: -3, stability: 2, note: 'Caso portato alla tribuna internazionale.' } },
      ],
      inaction: { socialTension: 7, stability: -4, note: 'Incidente senza risposta.' },
    });
    repos.gameRepository.insertPressures(gameId, player.polityId, [incident], session.getCurrentDate(), session.getCurrentTurn());

    const result = session.resolvePeacetimePressure('gov#border', ['retaliate', 'internationalize']);
    expect(result.pressure.status).toBe('resolved');
    expect(result.pressure.resolvedOption).toBe('retaliate,internationalize');
    expect(result.effect.stability).toBe(6);
    expect(result.effect.socialTension).toBe(3);
    expect(result.effect.note).toContain('Rappresaglia');
    expect(result.effect.note).toContain('tribuna');
    // Idempotente: una sfida chiusa non produce un secondo effetto.
    expect(() => session.resolvePeacetimePressure('gov#border', 'retaliate')).toThrow(/pressure_not_active/);
  });

  it('P2-C — una soluzione mista è composta dagli effetti reali delle opzioni scelte', async () => {
    const { gameId, session } = createGame();
    const repos = await import('../src/repositories');
    const player = session.getPlayer();
    const refugees = pressure('gov#ref', {
      kind: 'external', template: 'refugee-flow', title: 'Profughi dalla Francia',
      detail: 'Migliaia di civili al confine meridionale.', severity: 2, source: 'Prefetture di frontiera', durationDays: 60,
      options: [
        { id: 'accept-refugees', label: 'Accogliere', detail: 'Campi e sussidi.', effect: { moneyDeltaMld: -0.7, socialTension: 5, stability: 3, note: 'Profughi accolti.' } },
        { id: 'camps', label: 'Campi controllati', detail: 'Accoglienza limitata.', effect: { moneyDeltaMld: -0.35, socialTension: 2, note: 'Campi allestiti ai valichi.' } },
        { id: 'close-border', label: 'Chiudere il confine', detail: 'Frontiera blindata.', effect: { relationship: { target: 'GAL', direction: 'degrade' }, socialTension: -3, stability: -2, note: 'Confine chiuso.' } },
      ],
      inaction: { socialTension: 6, stability: -3, note: 'Caos ai valichi.' },
    });
    repos.gameRepository.insertPressures(gameId, player.polityId, [refugees], session.getCurrentDate(), session.getCurrentTurn());

    const result = session.resolvePeacetimePressure('gov#ref', ['accept-refugees', 'camps']);
    expect(result.effect.socialTension).toBe(7);
    expect(result.effect.stability).toBe(3);
    expect(result.effect.moneyDeltaMld).toBe(-1.05);
    expect(result.pressure.resolvedOption).toBe('accept-refugees,camps');
  });

  it('P2-B — alla scadenza l’inerzia presenta il conto, senza una decisione inventata', async () => {
    const { gameId, session } = createGame();
    const repos = await import('../src/repositories');
    const player = session.getPlayer();
    repos.gameRepository.insertPressures(gameId, player.polityId, [pressure('gov#infl', {
      kind: 'internal', template: 'inflation-spiral', title: 'Spirale inflazionistica',
      detail: 'Il disavanzo è al 6% del PIL: i prezzi corrono.', severity: 2, source: 'Banca centrale', durationDays: 30,
    })], session.getCurrentDate(), session.getCurrentTurn());

    await session.advanceDate(31);
    const expired = session.getPeacetimePressures().recent.find((item: any) => item.id === 'gov#infl');
    expect(expired?.status).toBe('expired');
    expect(expired?.resolution || '').toMatch(/inerzia|Scaduta/i);
  });

  it('P2-D — una nuova situazione nata da una decisione passata dichiara la provenienza', async () => {
    const { gameId, session } = createGame();
    const repos = await import('../src/repositories');
    const player = session.getPlayer();
    repos.gameRepository.insertPressures(gameId, player.polityId, [pressure('gov#old')], session.getCurrentDate(), session.getCurrentTurn());
    session.resolvePeacetimePressure('gov#old', 'concede');
    repos.gameRepository.insertPressures(gameId, player.polityId, [pressure('gov#new')], session.getCurrentDate(), session.getCurrentTurn());

    const situation = session.getPeacetimePressures().pressures.find((item: any) => item.id === 'gov#new')?.situation;
    expect(situation?.origin).toEqual({ type: 'previous-decision', sourceId: 'gov#old' });
  });

  it('P1.8 — alla data del seguito il ministro competente torna con i fatti di oggi', async () => {
    const { gameId, session } = createGame();
    const repos = await import('../src/repositories');
    const player = session.getPlayer();
    repos.gameRepository.insertPressures(gameId, player.polityId, [pressure('gov#follow')], session.getCurrentDate(), session.getCurrentTurn());
    session.resolvePeacetimePressure('gov#follow', 'concede');
    // Prima della data non c'è ancora un seguito da riferire.
    expect((session.getPeacetimePressures() as any).followUps ?? []).toHaveLength(0);

    await session.advanceDate(SITUATION_FOLLOW_UP_DAYS);
    const followUp = ((session.getPeacetimePressures() as any).followUps ?? []).find((item: any) => item.pressureId === 'gov#follow');
    expect(followUp).toBeTruthy();
    expect(followUp.origin).toEqual({ type: 'previous-decision', sourceId: 'gov#follow' });
    expect(followUp.owner).toBe('interno');
    expect(followUp.outcome.length).toBeGreaterThan(0);
  });

  it('P1.2 — la decisione composta rifiuta combinazioni incompatibili e resta risolvibile', async () => {
    const { gameId, session } = createGame();
    const repos = await import('../src/repositories');
    const player = session.getPlayer();
    repos.gameRepository.insertPressures(gameId, player.polityId, [pressure('gov#combo', {
      kind: 'external', template: 'border-incident', title: 'Incidente di frontiera', severity: 3, durationDays: 60,
      options: [
        { id: 'retaliate', label: 'Forza', detail: 'Colpo di mano.', effect: { stability: 4, socialTension: 6, note: 'Rappresaglia.' } },
        { id: 'de-escalate', label: 'De-escalation', detail: 'Commissione congiunta.', effect: { socialTension: -4, note: 'De-escalation.' } },
        { id: 'internationalize', label: 'ONU', detail: 'Tribuna internazionale.', effect: { stability: 2, socialTension: -3, note: 'Tribuna internazionale.' } },
      ],
    })], session.getCurrentDate(), session.getCurrentTurn());

    expect(() => session.resolvePeacetimePressure('gov#combo', ['retaliate', 'de-escalate'])).toThrow(/incompatible/);
    const ok = session.resolvePeacetimePressure('gov#combo', ['retaliate', 'internationalize']);
    expect(ok.pressure.status).toBe('resolved');
    expect(ok.effect.stability).toBe(6);
  });
});
