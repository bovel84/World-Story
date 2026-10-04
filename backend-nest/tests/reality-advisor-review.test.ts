import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import express from 'express';
import http, { type Server } from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { buildVerifiedWorldSnapshot, type VerifiedWorldGameData } from '../src/core/government/VerifiedWorldSnapshot';
import { buildRealityAdvisorContext, guardRealityAdvisorOutput, verifiedRequestCorrection } from '../src/core/government/RealityAdvisor';
import { resolveCouncilIssue } from '../src/core/government/CouncilIssue';
import { canonicalOrderBlockers } from '../src/core/feasibility/CanonicalOrderSafety';

// Review-only regression specifications. Failures intentionally demonstrate
// unmet WS-GOV-REALITY-ADVISOR invariants; production is not patched here.
function gameData(): VerifiedWorldGameData {
  return {
    id: 'review-pure', playerPolityId: 'UGA', currentDate: '1951-02-01', currentTurn: 2,
    world: { regions: { ug: { id: 'ug', name: 'Uganda', owner: 'UGA', coastal: false, borders: [], objects: [] } } },
    worldState: { resources: { stock: { money: 10, food: 8 }, needs: { food: 10 } }, arsenal: { units: {} } },
  };
}
const snapshot = () => buildVerifiedWorldSnapshot({ gameData: gameData(), operationalRows: [], commitments: [] });
const issue = (factKey = 'treasury') => ({
  title: 'Piano trasporti', question: 'Quale copertura?', suggestedMinisters: ['lavori', 'tesoro'],
  verifiedFacts: [{ key: factKey, label: 'FORGED_LABEL', value: 'FORGED_PORT_KAMPALA', source: 'client', sourceRef: 'client-ref' }],
  sourceRefs: ['client-ref'], createdDate: '2099-01-01',
});

describe('review: verified fact rehydration remains fail-closed', () => {
  it('does not accept client fact values, labels, provenance or creation date', () => {
    const world = snapshot();
    const resolved = resolveCouncilIssue(world, issue());
    expect(resolved.verifiedFacts[0]).toMatchObject({ key: 'treasury', label: world.facts.treasury.label, value: world.facts.treasury.value, sourceRef: world.facts.treasury.sourceRef });
    expect(JSON.stringify(resolved)).not.toContain('FORGED_');
    expect(resolved.createdDate).toBe(world.date);
  });
  it('does not silently downgrade an unknown verified key to client narrative', () => {
    expect(() => resolveCouncilIssue(snapshot(), issue('invented-port'))).toThrow(/fact/i);
  });
});

describe('review: advisor contradictions must not survive harmless neighboring clauses', () => {
  it.each([
    'Possiamo costruire una strada e usare il porto di Kampala.',
    'Non serve spendere altro: la nostra flotta è pronta.',
    'La nostra ferrovia esistente è disponibile senza ulteriori spese.',
    'La ferrovia collega Kampala al confine.',
    'Il porto di Kampala gestisce i nostri convogli.',
  ])('rejects unsupported existing-asset claim: %s', prose => {
    const reply = guardRealityAdvisorOutput(buildRealityAdvisorContext(snapshot()).advisorContext, prose);
    expect(reply).toContain('Non ho un dato verificato');
    expect(reply).not.toBe(prose);
  });
  it('unknown wars and negotiations cannot be asserted absent by the output guard', () => {
    const context = buildRealityAdvisorContext(snapshot()).advisorContext;
    expect(context.verifiedWorldSnapshot.diplomacy.wars).toBeNull();
    expect(context.verifiedWorldSnapshot.diplomacy.activeNegotiations).toBeNull();
    const reply = guardRealityAdvisorOutput(context, 'Non siamo in guerra e non ci sono trattative attive.');
    expect(reply).toContain('Non ho un dato verificato');
  });
  it('does not reject a correctly named canonical port', () => {
    const game = gameData();
    game.world!.regions!.ug.objects = [{ id: 'port-1', type: 'port', name: 'Entebbe Port' }];
    const context = buildRealityAdvisorContext(buildVerifiedWorldSnapshot({ gameData: game })).advisorContext;
    const prose = 'Possiamo usare il porto di Entebbe Port.';
    expect(guardRealityAdvisorOutput(context, prose)).toBe(prose);
  });
});

describe('review: snapshot cannot certify unavailable assets or unrecorded reports', () => {
  it.each(['planned', 'under_construction', 'destroyed'])('does not advertise %s infrastructure as an existing usable railway', status => {
    const game = gameData();
    game.world!.regions!.ug.objects = [{ id: 'rail-1', type: 'ft_railway', name: 'Linea nord', metadata: { status } }];
    const world = buildVerifiedWorldSnapshot({ gameData: game });
    expect(verifiedRequestCorrection(world, 'Usiamo la ferrovia esistente') ?? 'NO_CORRECTION').toContain('non risultano ferrovie');
  });
  it('an empty fleet or a ship under construction cannot establish a deployable navy', () => {
    const world = buildVerifiedWorldSnapshot({ gameData: gameData(), operationalRows: [
      { id: 'fleet-1', kind: 'fleet', data: { name: 'Flotta vuota', shipIds: [] } },
      { id: 'ship-1', kind: 'ship', data: { name: 'Scafo incompleto', status: 'under_construction', fleetId: null } },
    ] });
    expect(verifiedRequestCorrection(world, 'Mandiamo la flotta') ?? 'NO_CORRECTION').toContain('non risultano unità navali');
  });
  it('the expiry of an old Pressure is not a newly received verified report', () => {
    const world = buildVerifiedWorldSnapshot({ gameData: gameData(), decisions: [
      { id: 'expired-1', title: 'Situazione scaduta', status: 'expired', resolvedDate: '1951-01-01' },
    ] });
    expect(world.recent.events).toEqual([]);
    expect(world.recent.followUps).toEqual([]);
    expect(buildRealityAdvisorContext(world).reply).not.toContain('rapporti di verifica');
  });
});

describe('review: canonical order references cannot authorize invented named assets', () => {
  it.each(['Usa Kampala Port', 'Amplia Kampala Port'])('rejects %s when only a different port exists', order => {
    const blockers = canonicalOrderBlockers(order, 'UGA', {
      regions: [{ id: 'ug', name: 'Uganda', owner: 'UGA', objects: [{ id: 'actual-port', type: 'port', name: 'Entebbe Port' }] }],
      operationalObjects: [],
    });
    expect(blockers).toEqual(expect.arrayContaining([expect.objectContaining({ code: 'INFRASTRUCTURE_MISSING' })]));
  });
});

const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'ws-reality-review-'));
const originalDb = process.env.OPEN_PAX_DB_PATH;
const originalJev = process.env.JEV_MEMORY_ENABLED;
process.env.OPEN_PAX_DB_PATH = path.join(directory, 'test.sqlite');
process.env.JEV_MEMORY_ENABLED = 'false';
let db: typeof import('../src/database').default;
let repositories: typeof import('../src/repositories');
let session: import('../src/game-session').GameSession;
let strictSession: import('../src/game-session').GameSession;
let server: Server;
let base: string;
let modelReply = 'Possiamo valutare il programma.';
let jumpReply: string | undefined;
const captured: string[] = [];
const provider: any = {
  consolidation: { startRound: 25, chunkSize: 5, keepRawTail: 10 }, clearCache() {},
  async generate(mechanic: string, system: string, prompt: string) {
    captured.push(system + '\n' + prompt);
    return { content: jumpReply === undefined ? modelReply : mechanic === 'jump' ? jumpReply : '{}' };
  },
  async stream(mechanic: string, system: string, prompt: string, token: (chunk: unknown) => void) {
    captured.push(system + '\n' + prompt); token('UNSAFE_PARTIAL_TOKEN');
    return { content: jumpReply === undefined ? modelReply : mechanic === 'jump' ? jumpReply : '{}' };
  },
};
beforeAll(async () => {
  const database = await import('../src/database'); db = database.default; database.initDatabase();
  repositories = await import('../src/repositories');
  for (const [worldId, regionId, polity, templateId] of [
    ['review-world', 'review-uganda', 'UGA', undefined],
    ['review-strict-world', 'review-alpha', 'ALPHA', 'realism_test_world'],
  ]) {
    repositories.worldRepository.createWithRegions({ id: worldId!, name: 'Review', startDate: '1951-01-01', templateId }, [
      { id: regionId!, name: 'Uganda', owner: polity!, population: 5_000_000, gdp: 100, militaryPower: 0, objects: [], coastal: false, borders: [] },
    ]);
  }
  const { initSessionRegistry } = await import('../src/session-registry');
  const registry = initSessionRegistry(provider);
  session = registry.createSession('review-world', 'President', 'review-uganda').session;
  strictSession = registry.createSession('review-strict-world', 'President', 'review-alpha').session;
  const { registerAdvisorRoutes } = await import('../src/routes/games/advisor.routes');
  const { registerActionsRoutes } = await import('../src/routes/games/actions.routes');
  const app = express(); app.use(express.json()); const router = express.Router();
  registerAdvisorRoutes(router); registerActionsRoutes(router); app.use('/api/games', router);
  server = http.createServer(app); await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  base = `http://127.0.0.1:${(server.address() as import('node:net').AddressInfo).port}/api/games/`;
});
afterAll(async () => {
  server?.closeAllConnections(); if (server?.listening) await new Promise<void>(resolve => server.close(() => resolve()));
  if (db?.open) db.close(); fs.rmSync(directory, { recursive: true, force: true });
  if (originalDb === undefined) delete process.env.OPEN_PAX_DB_PATH; else process.env.OPEN_PAX_DB_PATH = originalDb;
  if (originalJev === undefined) delete process.env.JEV_MEMORY_ENABLED; else process.env.JEV_MEMORY_ENABLED = originalJev;
});
const post = (route: string, body: unknown, target = session) => fetch(base + target.id + route, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });

describe('review: minister transport and live-game order boundaries', () => {
  it.each(['', '/opening', '/stream'])('minister %s never publishes fabricated Kampala Port prose', async suffix => {
    modelReply = 'Possiamo ampliare il porto di Kampala.';
    const response = await post('/government/minister/lavori' + suffix, { message: 'Quale programma suggerisci?', sourceIssue: issue() });
    const text = await response.text();
    expect(captured.at(-1)).not.toContain('FORGED_PORT_KAMPALA');
    expect(text).not.toContain('Kampala');
    expect(text).not.toContain('UNSAFE_PARTIAL_TOKEN');
  });
  it('sourceIssue unknown keys fail before any minister generation (no legacy fallback)', async () => {
    const count = captured.length;
    const response = await post('/government/minister/lavori', { message: 'Approfondiamo', sourceIssue: issue('missing-port') });
    expect(response.status).toBe(400);
    expect(captured.length).toBe(count);
  });
  it('advisor API does not publish a mixed-clause invented asset claim', async () => {
    modelReply = 'Possiamo costruire una strada e usare il porto di Kampala.';
    const response = await post('/advisor/reality', { message: 'Quale programma suggerisci?' });
    expect(response.status).toBe(200);
    const result = await response.json();
    expect(result.reply).not.toContain('Kampala');
    expect(result.reply).toContain('Non ho un dato verificato');
  });
  it.each(['/actions/check-feasibility', '/actions/queue'])('%s reads game_regions, not the unchanged world template', async route => {
    // This is how a completed construction is actually persisted: world_regions
    // remains the template; game_regions is isolated dynamic game reality.
    const region = (session as any).state.regions.get('review-uganda');
    const previous = region.objects;
    region.objects = [{ id: 'delivered-rail', type: 'ft_railway', name: 'Linea nord' }];
    session.syncRegionsToDB();
    try {
      expect(session.getVerifiedWorldSnapshot().infrastructure.railways).toHaveLength(1);
      const response = await post(route, { text: 'Usiamo la ferrovia esistente' });
      expect(response.status).toBe(200);
      if (route.endsWith('/check-feasibility')) expect((await response.json()).feasible).toBe(true);
    } finally {
      for (const action of session.getPendingActions().slice()) session.removePendingAction(action.id);
      region.objects = previous; session.syncRegionsToDB();
    }
  });
  it('execution cannot authorize an invented named port merely because another real port exists', () => {
    const action = { id: 'review-invented-port', text: 'Usa Kampala Port', createdAt: '1951-01-01', status: 'pending' };
    const liveRegions = [{ id: 'review-uganda', name: 'Uganda', owner: 'UGA', objects: [{ id: 'actual-port', type: 'port', name: 'Entebbe Port' }] }];
    expect(() => (session as any).orders.assertExecutableOrders([action], liveRegions)).toThrow(/order_reality_blocked/);
  });
  it('Intervene can close a valid run after its first committed event destroys the used fleet', async () => {
    repositories.worldRepository.createWithRegions({ id: 'review-playback', name: 'Playback review', startDate: '1951-01-01' }, [
      { id: 'review-playback-ug', name: 'Uganda', owner: 'UGA', population: 5_000_000, gdp: 100, militaryPower: 0, borders: [], objects: [{ id: 'review-fleet', type: 'fleet', name: 'Flotta di prova' }] },
    ]);
    const { getSessionRegistry } = await import('../src/session-registry');
    const playback = getSessionRegistry().createSession('review-playback', 'President', 'review-playback-ug').session;
    const action = playback.queueAction('Mandiamo la flotta');
    jumpReply = JSON.stringify({
      events: [
        { date: '1951-01-05', headline: 'Flotta perduta', description: 'La flotta viene distrutta durante la missione.', mapChanges: [{ type: 'remove_unit', regionName: 'Uganda', feature: { id: 'review-fleet', type: 'fleet', name: 'Flotta di prova' } }] },
        { date: '1951-01-10', headline: 'Rapporto successivo', description: 'Arriva una nota sul periodo.', mapChanges: [] },
      ],
      narration: 'Il periodo procede.', voided: [], startChat: [], worldChanges: { regionOwners: {}, regionColors: {} },
      actionOutcomes: [{ actionId: action.id, action: action.text, status: 'accepted', summary: 'Missione avviata.' }],
    });
    try {
      const first = await playback.processWorldAdvance(30) as any;
      expect(first.paused).toBe(true);
      expect(playback.getVerifiedWorldSnapshot().military.formations).toEqual([]);
      await expect(playback.tryIntervenePausedRun(first.simulationId)).resolves.toMatchObject({ type: 'intervened' });
      expect(playback.getPausedRunInfo()).toBeNull();
    } finally { jumpReply = undefined; }
  });
  it('strict free-form railway construction is not certified without route, cost or material verification', async () => {
    const response = await post('/actions/check-feasibility', {
      text: 'Costruisci una nuova ferrovia tra regione_inesistente_A e regione_inesistente_B usando 999999 tonnellate di acciaio.',
    }, strictSession);
    expect(response.status).toBe(200);
    const result = await response.json();
    expect(result.feasible).toBe(false);
    expect(result.rawAssessment.status).toMatch(/needs_data|blocked/);
  });
});
