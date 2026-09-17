/**
 * GAMEPLAY-LONG P1 — Agenda strategica degli NPC.
 *
 * Il motore **deriva** gli obiettivi dallo stato e li **mantiene**: un obiettivo
 * dura più turni, non cambia a ogni chiamata LLM, si aggiorna con indicatori
 * già pubblicati e si chiude solo con una condizione verificabile.
 */
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import os from 'os';
import path from 'path';
import fs from 'fs';
import {
  AGENDA_MAX_OBJECTIVES, AGENDA_REVIEW_DAYS, agendaReviewDate, describeAgenda, describeObjective,
  deriveObjectiveSeeds, objectiveAchieved, objectiveProgress, reviewAgenda,
  type NpcAgendaContext, type NpcObjective,
} from '../src/core/simulation/NpcAgenda';

const TEST_DB = path.join(os.tmpdir(), `world-story-npc-agenda-${process.pid}-${Date.now()}.db`);
process.env.OPEN_PAX_DB_PATH = TEST_DB;

const WORLD_ID = 'agenda_world';
let db: any;
let createGame: () => { gameId: string; session: any };

const stubProvider: any = {
  consolidation: { startRound: 25, chunkSize: 5, keepRawTail: 10 },
  async generate() { return { content: '{}' }; },
  async stream(mechanic: string, _s: string, _u: string, onToken: (chars: number) => void) {
    if (mechanic !== 'jump') throw new Error(`unexpected mechanic ${mechanic}`);
    const content = JSON.stringify({
      events: [{ headline: 'Manovre di confine', description: 'Le due nazioni si osservano.', date: '1951-02-01', mapChanges: [] }],
      narration: 'Il mondo tira avanti.',
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

const context = (over: Partial<NpcAgendaContext> = {}): NpcAgendaContext => ({
  relationshipToPlayer: 'neutral', hostileNeighbours: 0, hostileActors: 0, alliedActors: 0,
  militaryPower: 100, playerMilitaryPower: 100, monthlyBalance: 1, stability: 60,
  socialTension: 30, warEffort: 0, ...over,
});

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
    { id: WORLD_ID, name: 'Agenda World', description: '', startDate: '1951-01-01', basePrompt: 'Test', historicalAccuracy: 0.8 },
    [
      {
        id: `${WORLD_ID}_ITA`, name: 'Italia', color: '#FF0000', owner: 'ITA',
        population: 47_000_000, gdp: 2400, militaryPower: 110, flag: 'ITA', coastal: true,
        borders: [`${WORLD_ID}_FRA`], objects: [{ id: 'f1', type: 'factory', name: 'Acciaierie', level: 4 }],
      },
      {
        // Francia: molto armata e con un PIL sottile — disavanzo strutturale,
        // così l'agenda ha un obiettivo reale da perseguire (senza inventarlo).
        id: `${WORLD_ID}_FRA`, name: 'Francia', color: '#0000FF', owner: 'FRA',
        population: 18_000_000, gdp: 260, militaryPower: 900, flag: 'FRA', coastal: true,
        borders: [`${WORLD_ID}_ITA`], objects: [{ id: 'f2', type: 'factory', name: 'Officine', level: 5 }],
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

describe('agenda NPC: derivazione degli obiettivi', () => {
  it('una minaccia ostile produce un obiettivo di contenimento, non un ordine generico', () => {
    const seeds = deriveObjectiveSeeds({}, context({
      hostileActors: 2, hostileNeighbours: 1, hostileTarget: 'AUT', hostileTargetName: 'Austria',
    }));
    const contain = seeds.find(seed => seed.type === 'contain-hostile')!;
    expect(contain.priority).toBe(3);
    expect(contain.targetPolityId).toBe('AUT');
    expect(contain.description).toContain('Austria');
    expect(contain.reason).toContain('2 relazioni ostili');
  });

  it('un alleato registrato e un focus economico aprono accesso commerciale', () => {
    const seeds = deriveObjectiveSeeds({ economicFocus: 70 }, context({ alliedActors: 1, allyTarget: 'FRA', allyTargetName: 'Francia' }));
    expect(seeds.map(seed => seed.type)).toContain('preserve-alliance');
    expect(seeds.map(seed => seed.type)).toContain('trade-access');
  });

  it('un conto in rosso apre la stabilizzazione, non un’avventura estera', () => {
    const seeds = deriveObjectiveSeeds({}, context({ monthlyBalance: -2.4, stability: 30 }));
    const stabilize = seeds.find(seed => seed.type === 'stabilize-economy')!;
    expect(stabilize.priority).toBe(3);
    expect(stabilize.reason).toContain('-2.4');
  });

  it('l’inferiorità militare verso una polity ostile apre il rafforzamento', () => {
    const seeds = deriveObjectiveSeeds({}, context({
      relationshipToPlayer: 'hostile', militaryPower: 40, playerMilitaryPower: 200,
    }));
    const build = seeds.find(seed => seed.type === 'build-capability')!;
    expect(build.measure).toBe('military');
    expect(build.reason).toContain('40');
  });

  it('niente minacce e conti in ordine: nessun obiettivo inventato', () => {
    expect(deriveObjectiveSeeds({ sovereigntySensitivity: 40, economicFocus: 40 }, context({ alliedActors: 0 }))).toEqual([]);
  });
});

describe('agenda NPC: progresso e chiusura', () => {
  const objective = (over: Partial<NpcObjective> = {}): NpcObjective => ({
    id: 'FRA:stabilize-economy:-:1', polityId: 'FRA', type: 'stabilize-economy',
    targetPolityId: null, targetRegionId: null, description: 'Rimettere in ordine i conti.',
    priority: 3, status: 'active', progress: 50, measure: 'balance', baseline: -2,
    reason: 'saldo -2 mld', createdDate: '1951-01-01', createdTurn: 1,
    reviewDate: '1951-05-01', reviewedDate: '1951-01-01', reviewedTurn: 1,
    ...over,
  });

  it('il progresso si misura sugli indicatori, non su un’impressione', () => {
    expect(objectiveProgress(objective(), context({ monthlyBalance: -2 }))).toBe(50);
    expect(objectiveProgress(objective(), context({ monthlyBalance: 0 }))).toBe(100);
    expect(objectiveProgress(objective(), context({ monthlyBalance: -6 }))).toBe(0);
    // Capacità militare: +25% è l'obiettivo dichiarato.
    const build = objective({ type: 'build-capability', measure: 'military', baseline: 100 });
    expect(objectiveProgress(build, context({ militaryPower: 100 }))).toBe(50);
    expect(objectiveProgress(build, context({ militaryPower: 125 }))).toBe(75);
    expect(objectiveAchieved(build, context({ militaryPower: 130 }))).toBe(true);
  });

  it('un obiettivo si chiude solo con una condizione verificabile', () => {
    expect(objectiveAchieved(objective(), context({ monthlyBalance: 0, stability: 60 }))).toBe(true);
    expect(objectiveAchieved(objective(), context({ monthlyBalance: 0.5, stability: 40 }))).toBe(false);
    expect(objectiveAchieved(objective({ type: 'contain-hostile', measure: 'hostile-actors' }), context({ hostileActors: 0 }))).toBe(true);
    // Un'alleanza non si «raggiunge»: si preserva.
    expect(objectiveAchieved(objective({ type: 'preserve-alliance', measure: 'alliance' }), context({ alliedActors: 3 }))).toBe(false);
  });

  it('la revisione chiude un obiettivo raggiunto e ne apre uno nuovo se serve', () => {
    // Il saldo è tornato in attivo: la stabilizzazione è raggiunta.
    const solved = context({ monthlyBalance: 0.5, stability: 60 });
    const review = reviewAgenda([objective()], deriveObjectiveSeeds({}, solved), solved, {
      polityId: 'FRA', date: '1951-02-01', turn: 2,
    });
    expect(review.closed.map(item => item.status)).toEqual(['achieved']);
    expect(review.active).toEqual([]);
    expect(review.opened).toEqual([]);
    expect(review.changed).toBe(true);
  });

  it('la revisione aggiorna il progresso senza ricreare l’obiettivo', () => {
    const before = objective({ progress: 50 });
    const still = context({ monthlyBalance: -4, stability: 55 });
    const review = reviewAgenda([before], deriveObjectiveSeeds({}, still), still, {
      polityId: 'FRA', date: '1951-02-01', turn: 2,
    });
    expect(review.closed).toEqual([]);
    expect(review.opened).toEqual([]);
    expect(review.active).toHaveLength(1);
    // Stessa identità, motivo rinnovato con i numeri di oggi.
    expect(review.active[0].id).toBe(before.id);
    expect(review.active[0].progress).toBeLessThan(before.progress);
    expect(review.active[0].reason).toContain('-4');
    expect(review.changed).toBe(true);
  });

  it('un obiettivo non si abbandona prima della finestra di revisione', () => {
    // I conti sono a posto ma il consenso è ancora fragile: la stabilizzazione
    // non è più giustificata dallo stato, eppure non è ancora raggiunta.
    const stale = objective({ type: 'stabilize-economy', baseline: -2, progress: 30 });
    const healthy = context({ monthlyBalance: 2, stability: 47 });
    const noSeeds = deriveObjectiveSeeds({}, healthy);
    // Il mondo è cambiato, ma l'obiettivo ha 30 giorni: resta la strategia.
    const early = reviewAgenda([stale], noSeeds, healthy, { polityId: 'FRA', date: '1951-01-31', turn: 2 });
    expect(early.active.map(item => item.id)).toEqual([stale.id]);
    expect(early.closed).toEqual([]);
    // Passata la finestra (120 giorni) il motore lo abbandona, dichiarandolo.
    const late = reviewAgenda([stale], noSeeds, healthy, {
      polityId: 'FRA', date: agendaReviewDate('1951-01-01'), turn: 5,
    });
    expect(late.active).toEqual([]);
    expect(late.closed[0].status).toBe('abandoned');
    expect(AGENDA_REVIEW_DAYS).toBe(120);
  });

  it('una minaccia nuova e decisiva sostituisce l’obiettivo più debole, ma solo dopo la sua finestra', () => {
    // Tre obiettivi vecchi (oltre la finestra di revisione) e uno solo debole.
    const old = (type: any, priority: number, target: string | null = null) => objective({
      id: `FRA:${type}:${target ?? '-'}:1`, type, targetPolityId: target, priority, createdDate: '1951-01-01',
    });
    const three = [
      old('preserve-alliance', 3, 'AUT'),
      old('reduce-dependency', 2),
      old('trade-access', 1),
    ];
    const threat = context({
      hostileActors: 1, hostileNeighbours: 1, hostileTarget: 'AUT', hostileTargetName: 'Austria',
      alliedActors: 1, allyTarget: 'FRA', allyTargetName: 'Francia',
    });
    const seeds = deriveObjectiveSeeds({ economicFocus: 80, sovereigntySensitivity: 90 }, threat);
    const fresh = reviewAgenda(three, seeds, threat, { polityId: 'FRA', date: '1951-06-01', turn: 6 });
    // Il meno prioritario lascia il posto alla minaccia; chi conta di più resta.
    expect(fresh.closed.map(item => item.status)).toEqual(['superseded']);
    expect(fresh.closed[0].priority).toBe(2);
    expect(fresh.active.some(item => item.type === 'preserve-alliance')).toBe(true);
    expect(fresh.opened.map(item => item.type)).toEqual(['contain-hostile']);
    expect(fresh.active).toHaveLength(3);

    // Un obiettivo appena nato non si tocca, anche se arriva una minaccia nuova:
    // il motore libera spazio solo fra quelli che hanno già avuto la loro finestra.
    const churnContext = context({ hostileActors: 3, monthlyBalance: -5, stability: 20, hostileTarget: 'AUT' });
    const churn = reviewAgenda(fresh.active, deriveObjectiveSeeds({}, churnContext), churnContext, {
      polityId: 'FRA', date: '1951-06-05', turn: 7,
    });
    expect(churn.closed.filter(item => item.status === 'superseded').map(item => item.type))
      .not.toContain('contain-hostile');
    expect(churn.active.some(item => item.type === 'contain-hostile')).toBe(true);

    // Con spazio libero non si sostituisce nulla: si aggiunge.
    const single = reviewAgenda([fresh.opened[0]], deriveObjectiveSeeds({ economicFocus: 80 }, churnContext), churnContext, {
      polityId: 'FRA', date: '1951-06-05', turn: 7,
    });
    expect(single.closed).toEqual([]);
    expect(single.active.length).toBeGreaterThan(1);
  });

  it('mai più di tre obiettivi attivi: una strategia, non un elenco', () => {
    const seeds = deriveObjectiveSeeds({ economicFocus: 80, sovereigntySensitivity: 90 }, context({
      hostileActors: 2, hostileNeighbours: 1, alliedActors: 1, monthlyBalance: -3, stability: 25,
      militaryPower: 20, playerMilitaryPower: 200, relationshipToPlayer: 'hostile',
      hostileTarget: 'AUT', allyTarget: 'FRA',
    }));
    const review = reviewAgenda([], seeds, context({}), { polityId: 'FRA', date: '1951-01-01', turn: 1 });
    expect(review.opened.length).toBe(AGENDA_MAX_OBJECTIVES);
    expect(review.active.length).toBe(AGENDA_MAX_OBJECTIVES);
    // Priorità decrescente: prima le questioni decisive.
    expect(review.active[0].priority).toBe(3);
  });

  it('describeAgenda racconta la strategia in corso, non le intenzioni', () => {
    const text = describeAgenda([
      objective({ id: 'FRA:stabilize-economy:-:1' }),
      objective({ id: 'FRA:contain-hostile:AUT:1', type: 'contain-hostile', targetPolityId: 'AUT', priority: 3, progress: 40 }),
    ]);
    expect(text).toContain('[FRA:contain-hostile:AUT:1]');
    expect(text).toContain('priorità 3/3');
    expect(text).toContain('progresso 40%');
    expect(text).toContain('motivo:');
    expect(describeAgenda([])).toContain('nessun obiettivo attivo');
    expect(describeObjective(objective())).toContain('dal 1951-01-01');
  });
});

describe('agenda NPC: ciclo di vita in partita', () => {
  it('l’obiettivo resta lo stesso attraverso i turni e non si duplica', async () => {
    const { session } = createGame();
    // Il primo dossier NPC rivede l'agenda (come nel turno reale).
    session.buildGameData();
    const first = session.getStrategicAgenda().powers;
    expect(first.length).toBeGreaterThan(0);
    const power = first[0];
    const objectives = power.objectives.map((item: any) => item.id);

    await session.advanceDate(30);
    session.buildGameData();
    const after = session.getStrategicAgenda().powers.find((item: any) => item.polityId === power.polityId);
    // Stessa strategia: gli obiettivi non vengono ricreati a ogni turno.
    expect(after.objectives.map((item: any) => item.id).sort()).toEqual(objectives.sort());

    const repos = await import('../src/repositories');
    const rows = repos.npcAgendaRepository.list(session.id, { polityId: power.polityId });
    expect(rows.length).toBeGreaterThanOrEqual(objectives.length);
    // La versione più recente porta la data della revisione, non una nuova nascita.
    for (const objective of rows) {
      expect(objective.createdTurn).toBeLessThanOrEqual(session.getCurrentTurn());
      expect(objective.reviewDate).toBe(agendaReviewDate(objective.createdDate));
    }
  });

  it('sopravvive a save e load', async () => {
    const { gameId, session } = createGame();
    session.buildGameData();
    const expected = session.getStrategicAgenda();
    expect(expected.powers.length).toBeGreaterThan(0);

    const { GameSession } = await import('../src/game-session');
    const restored = new GameSession(gameId, WORLD_ID, stubProvider);
    await restored.reconstructFromDB({
      currentTurn: session.getCurrentTurn(),
      currentDate: session.getCurrentDate(),
      players: [session.getPlayer()],
    });
    expect(restored.getStrategicAgenda().powers.map((item: any) => item.polityId))
      .toEqual(expected.powers.map((item: any) => item.polityId));
  });

  it('il rewind riporta l’agenda alla versione precedente', async () => {
    const { gameId, session } = createGame();
    const repos = await import('../src/repositories');
    session.buildGameData();
    const baseline = repos.npcAgendaRepository.list(gameId).length;

    await session.advanceDate(30);
    session.buildGameData();
    const afterAdvance = repos.npcAgendaRepository.list(gameId).length;
    expect(afterAdvance).toBeGreaterThanOrEqual(baseline);

    expect(session.rewind()).toBeTruthy();
    const afterRewind = repos.npcAgendaRepository.list(gameId);
    // Nessuna versione resta appesa a un futuro annullato.
    expect(afterRewind.every((row: any) => row.reviewedTurn <= session.getCurrentTurn())).toBe(true);
    // E l'agenda è ancora utilizzabile dopo il ritorno indietro.
    session.buildGameData();
    expect(session.getStrategicAgenda().powers.length).toBeGreaterThan(0);
  });
});
