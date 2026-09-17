/**
 * GAMEPLAY-LONG P1 — Registro strutturato degli impegni.
 *
 * La cronaca racconta, il registro ricorda: dopo il consolidamento della sintesi
 * narrativa un trattato firmato venti turni prima deve essere ancora
 * disponibile, con stato e scadenza.
 */
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import os from 'os';
import path from 'path';
import fs from 'fs';
import {
  COMMITMENT_MAX_IDLE_DAYS, activeCommitments, applyCommitmentProposals, commitmentKey,
  commitmentUrgency, commitmentsForPolity, commitmentsWorthAttention, describeCommitments,
  normalizeCommitmentStatus, normalizeCommitmentType, ultimatumProposal,
  type Commitment, type CommitmentProposal,
} from '../src/core/simulation/Commitments';

const TEST_DB = path.join(os.tmpdir(), `world-story-commitments-${process.pid}-${Date.now()}.db`);
process.env.OPEN_PAX_DB_PATH = TEST_DB;

const WORLD_ID = 'commitments_world';
let db: any;
let createGame: () => { gameId: string; session: any };

const stubProvider: any = {
  consolidation: { startRound: 25, chunkSize: 5, keepRawTail: 10 },
  async generate() { return { content: '{}' }; },
  async stream(mechanic: string, _s: string, _u: string, onToken: (chars: number) => void) {
    if (mechanic !== 'jump') throw new Error(`unexpected mechanic ${mechanic}`);
    const content = JSON.stringify({
      events: [{ headline: 'Colloqui di confine', description: 'Le delegazioni si incontrano.', date: '1951-02-01', mapChanges: [] }],
      narration: 'Il tempo passa.',
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

const treaty = (over: Partial<CommitmentProposal> = {}): CommitmentProposal => ({
  type: 'treaty', actor: 'ITA', counterparty: 'FRA',
  description: 'Patto di non aggressione ventennale', importance: 3, ...over,
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
    { id: WORLD_ID, name: 'Commitments World', description: '', startDate: '1951-01-01', basePrompt: 'Test', historicalAccuracy: 0.8 },
    [
      {
        id: `${WORLD_ID}_ITA`, name: 'Italia', color: '#FF0000', owner: 'ITA',
        population: 47_000_000, gdp: 2400, militaryPower: 110, flag: 'ITA', coastal: true,
        borders: [`${WORLD_ID}_FRA`], objects: [],
      },
      {
        id: `${WORLD_ID}_FRA`, name: 'Francia', color: '#0000FF', owner: 'FRA',
        population: 42_000_000, gdp: 2200, militaryPower: 160, flag: 'FRA', coastal: true,
        borders: [`${WORLD_ID}_ITA`], objects: [],
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
      if (fs.existsSync(file)) fs.unlinkSync(file);
    }
  } catch { /* tmp */ }
});

const active = (over: Partial<Commitment> = {}): Commitment => ({
  id: 'ITA|FRA|treaty|patto', type: 'treaty', actor: 'ITA', counterparty: 'FRA',
  description: 'Patto di non aggressione', createdDate: '1951-01-01', createdTurn: 1,
  status: 'active', deadline: null, sourceEventId: null, importance: 3,
  updatedDate: '1951-01-01', updatedTurn: 1, note: '', ...over,
});

describe('impegni: forma e ciclo di vita', () => {
  it('normalizza tipi e stati scritti in italiano', () => {
    expect(normalizeCommitmentType('trattato')).toBe('treaty');
    expect(normalizeCommitmentType('cessate il fuoco')).toBe('ceasefire');
    expect(normalizeCommitmentType('accordo_commerciale')).toBe('trade-agreement');
    expect(normalizeCommitmentType('inventato')).toBeNull();
    expect(normalizeCommitmentStatus('tradito')).toBe('broken');
    expect(normalizeCommitmentStatus('onorato')).toBe('fulfilled');
    expect(normalizeCommitmentStatus('boh')).toBeNull();
  });

  it('la chiave dell’impegno è stabile e leggibile', () => {
    const key = commitmentKey({ actor: 'ITA', counterparty: 'FRA', type: 'treaty', description: 'Patto di non aggressione!' });
    expect(key).toBe(commitmentKey({ actor: 'ITA', counterparty: 'FRA', type: 'treaty', description: 'Patto di non aggressione?' }));
    expect(key).toContain('ITA|FRA|treaty');
    expect(commitmentKey({ actor: 'ITA', type: 'promise', description: 'Riforma interna' })).toContain('|interno|');
  });

  it('un nuovo impegno nasce attivo e non si duplica', () => {
    const first = applyCommitmentProposals([], [treaty()], { date: '1951-01-01', turn: 1 });
    expect(first.created).toHaveLength(1);
    expect(first.created[0].status).toBe('active');
    expect(first.created[0].importance).toBe(3);
    // Stessa proposta al turno dopo: nessun doppione.
    const again = applyCommitmentProposals(first.commitments, [treaty()], { date: '1951-02-01', turn: 2 });
    expect(again.created).toEqual([]);
    expect(again.commitments).toHaveLength(1);
  });

  it('un impegno contraddittorio sostituisce il precedente invece di accumularsi', () => {
    const first = applyCommitmentProposals([], [
      treaty({ description: 'Patto di non aggressione ventennale' }),
    ], { date: '1951-01-01', turn: 1 });
    const second = applyCommitmentProposals(first.commitments, [
      treaty({ description: 'Patto di mutua difesa' }),
    ], { date: '1951-03-01', turn: 3 });
    expect(second.created).toHaveLength(1);
    expect(second.updated.map(item => item.status)).toEqual(['superseded']);
    expect(activeCommitments(second.commitments)).toHaveLength(1);
    expect(activeCommitments(second.commitments)[0].description).toContain('mutua difesa');
  });

  it('lo stato si aggiorna solo con un id esatto', () => {
    const first = applyCommitmentProposals([], [treaty()], { date: '1951-01-01', turn: 1 });
    const id = first.created[0].id;
    const broken = applyCommitmentProposals(first.commitments, [
      { type: 'treaty', actor: 'ITA', counterparty: 'FRA', description: '', id, status: 'broken', note: 'Violato a marzo.' },
    ], { date: '1951-04-01', turn: 4 });
    expect(broken.updated[0].status).toBe('broken');
    expect(broken.updated[0].note).toContain('Violato');
    expect(activeCommitments(broken.commitments)).toHaveLength(0);
    // Un id inesistente non crea nulla.
    const ghost = applyCommitmentProposals(broken.commitments, [
      { type: 'treaty', actor: 'ITA', counterparty: 'FRA', description: '', id: 'non-esiste', status: 'fulfilled' },
    ], { date: '1951-04-02', turn: 4 });
    expect(ghost.created).toEqual([]);
    expect(ghost.updated).toEqual([]);
  });

  it('un ultimatum nasce con scadenza e decade quando scade', () => {
    const proposal = ultimatumProposal({ issuer: 'ITA', counterparty: 'AUT', topic: 'Ritirate le truppe dal confine.', date: '1951-01-01' });
    expect(proposal.type).toBe('ultimatum');
    expect(proposal.deadline).toBe('1951-01-31');
    const created = applyCommitmentProposals([], [proposal], { date: '1951-01-01', turn: 1 });
    expect(commitmentUrgency(created.created[0], '1951-01-16').daysLeft).toBe(15);
    expect(commitmentUrgency(created.created[0], '1951-01-16').label).toContain('scade fra 15');
    const after = applyCommitmentProposals(created.commitments, [], { date: '1951-02-05', turn: 2 });
    expect(after.updated.map(item => item.status)).toEqual(['expired']);
    expect(after.updated[0].note).toContain('Ultimatum scaduto');
  });

  it('un impegno senza scadenza non resta in vigore per sempre', () => {
    const created = applyCommitmentProposals([], [treaty()], { date: '1951-01-01', turn: 1 });
    const later = applyCommitmentProposals(created.commitments, [], { date: '1951-06-01', turn: 6 });
    expect(later.updated).toEqual([]);
    const forgotten = applyCommitmentProposals(created.commitments, [], { date: '1957-01-01', turn: 60 });
    expect(forgotten.updated[0].status).toBe('expired');
    expect(COMMITMENT_MAX_IDLE_DAYS).toBeGreaterThan(1_000);
  });

  it('descrive gli impegni in vigore per il prompt, senza inventarne', () => {
    const created = applyCommitmentProposals([], [
      treaty(),
      treaty({ type: 'promise', description: 'Riforma agraria entro il 1952', counterparty: null, importance: 2 }),
      { type: 'ceasefire', actor: 'AUT', counterparty: 'FRA', description: 'Tregua sul fronte alpino', status: 'broken', id: 'x' },
    ], { date: '1951-01-01', turn: 1 });
    const text = describeCommitments(created.commitments, { today: '1951-02-01' });
    expect(text).toContain('Trattato ITA verso FRA');
    expect(text).toContain('Promessa ITA (impegno interno)');
    expect(text).not.toContain('Tregua sul fronte alpino');
    expect(describeCommitments([], { today: '1951-02-01' })).toContain('nessun impegno in vigore');
    expect(describeCommitments(created.commitments, { today: '1951-02-01', polityId: 'FRA' })).toContain('Patto');
    expect(commitmentsForPolity(created.commitments, 'FRA')).toHaveLength(1);
  });

  it('porta al briefing solo ciò che merita attenzione', () => {
    const list = [
      active({ id: 'a', importance: 3 }),
      active({ id: 'b', importance: 1, deadline: '1951-01-20' }),
      active({ id: 'c', importance: 1, deadline: '1953-01-01' }),
    ];
    const attention = commitmentsWorthAttention(list, { today: '1951-01-10' });
    expect(attention.map(item => item.id)).toEqual(['b', 'a']);
  });
});

describe('impegni: persistenza in partita', () => {
  it('sopravvive al consolidamento della cronaca', async () => {
    const { gameId, session } = createGame();
    const repos = await import('../src/repositories');
    // Un trattato firmato al primo turno.
    const service = (session as any).commitments;
    service.apply([treaty({ description: 'Trattato di commercio con la Francia', deadline: null })]);
    expect(session.getCommitments().commitments).toHaveLength(1);

    // Molti turni dopo: la cronaca si consolida, il registro resta.
    for (let i = 0; i < 6; i++) await session.advanceDate(30);
    await (session as any).maybeConsolidate?.();
    const after = session.getCommitments();
    expect(after.commitments.some((item: any) => item.description.includes('Trattato di commercio'))).toBe(true);
    expect(after.commitments[0].createdTurn).toBe(1);
    expect(after.commitments[0].status).toBe('active');
    // E la riga esiste davvero in banca dati (non in memoria di processo).
    expect(repos.commitmentRepository.list(gameId).length).toBeGreaterThan(0);
  });

  it('un ultimatum lanciato in chat entra nel registro con scadenza', async () => {
    const { gameId, session } = createGame();
    const repos = await import('../src/repositories');
    const player = session.getPlayer();
    repos.commitmentRepository.list(gameId);
    // La chat strutturata è la fonte: `kind: 'ultimatum'`.
    (session as any).recordCommitments({
      startChat: [{ participants: ['FRA'], kind: 'ultimatum', topic: 'Ritirate le guarnigioni entro un mese.' }],
    });
    const list = session.getCommitments().commitments;
    const ultimatum = list.find((item: any) => item.type === 'ultimatum');
    expect(ultimatum).toBeTruthy();
    expect(ultimatum.actor).toBe(player.polityId);
    expect(ultimatum.counterparty).toBe('FRA');
    expect(ultimatum.deadline).toBeTruthy();
    expect(ultimatum.importance).toBe(3);
    // Dopo la scadenza il motore lo dichiara decaduto, senza chiedere al modello.
    await session.advanceDate(40);
    (session as any).recordCommitments({});
    const after = session.getCommitments().commitments.find((item: any) => item.type === 'ultimatum');
    expect(after.status).toBe('expired');
  });

  it('sopravvive a save e load e il rewind cancella le decisioni annullate', async () => {
    const { gameId, session } = createGame();
    (session as any).commitments.apply([treaty({ description: 'Accordo di navigazione' })]);
    expect(session.getCommitments().commitments).toHaveLength(1);

    const { GameSession } = await import('../src/game-session');
    const restored = new GameSession(gameId, WORLD_ID, stubProvider);
    await restored.reconstructFromDB({
      currentTurn: session.getCurrentTurn(),
      currentDate: session.getCurrentDate(),
      players: [session.getPlayer()],
    });
    expect(restored.getCommitments().commitments.some((item: any) => item.description.includes('Accordo di navigazione'))).toBe(true);

    // Nuovo impegno dopo un avanzamento, poi rewind: sparisce.
    await restored.advanceDate(30);
    (restored as any).commitments.apply([treaty({ description: 'Patto segreto annullato', counterparty: 'AUT' })]);
    expect(restored.getCommitments().commitments.some((item: any) => item.description.includes('annullato'))).toBe(true);
    restored.rewind();
    expect(restored.getCommitments().commitments.some((item: any) => item.description.includes('annullato'))).toBe(false);
    expect(restored.getCommitments().commitments.some((item: any) => item.description.includes('Accordo di navigazione'))).toBe(true);
  });
});
