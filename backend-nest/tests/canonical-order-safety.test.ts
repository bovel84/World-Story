import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { FeasibilityService } from '../src/core/feasibility/FeasibilityService';
import { canonicalOrderBlockers } from '../src/core/feasibility/CanonicalOrderSafety';
import { draftIntentCandidate, normalizeOrderIntent } from '../src/core/feasibility/intent';
import { loadSimulationCatalog } from '../src/scenario/loader';

const DB = path.join(os.tmpdir(), `world-story-canonical-orders-${process.pid}-${Date.now()}.db`);
process.env.OPEN_PAX_DB_PATH = DB;
let db: any;
let router: any;
let registry: any;
let repositories: any;
let legacy: any;
let strict: any;
const generate = vi.fn(async () => { throw new Error('provider must not be called for an impossible order'); });
const catalog = loadSimulationCatalog(path.join(process.cwd(), 'data/presets/realism_test_world')).catalog!;

beforeAll(async () => {
  const database = await import('../src/database');
  db = database.default;
  database.initDatabase();
  repositories = await import('../src/repositories');
  for (const [world, region, owner, template] of [
    ['safety-uganda', 'safety-kampala', 'UGA', undefined],
    ['safety-strict', 'safety-alpha', 'ALPHA', 'realism_test_world'],
  ]) {
    repositories.worldRepository.createWithRegions({ id: world, name: 'Safety', templateId: template }, [
      { id: region, name: 'Kampala', owner, color: '#000', population: 1000, gdp: 1, militaryPower: 1, objects: [], borders: [], coastal: false },
    ]);
  }
  const sessions = await import('../src/session-registry');
  sessions.initSessionRegistry({ consolidation: { startRound: 25, chunkSize: 5, keepRawTail: 10 }, generate, stream: generate, clearCache() {} } as never);
  registry = sessions.getSessionRegistry();
  legacy = registry.createSession('safety-uganda', 'President', 'safety-kampala');
  strict = registry.createSession('safety-strict', 'President', 'safety-alpha');
  router = (await import('../src/routes/games.routes')).gamesRouter;
});

afterAll(() => {
  db?.close();
  for (const suffix of ['', '-wal', '-shm']) fs.rmSync(DB + suffix, { force: true });
});

function route(method: string, endpoint: string, gameId: string, body: unknown, actionId?: string): Promise<{ status: number; payload: any }> {
  return new Promise((resolve, reject) => {
    const layer = router.stack.find((item: any) => item.route?.path === endpoint && item.route.methods[method]);
    if (!layer) { reject(new Error(`Missing route ${endpoint}`)); return; }
    const res = { statusCode: 200, status(code: number) { this.statusCode = code; return this; }, json(payload: unknown) { resolve({ status: this.statusCode, payload }); return this; } };
    Promise.resolve(layer.route.stack.at(-1).handle({ params: { id: gameId, actionId }, headers: {}, body }, res)).catch(reject);
  });
}

function setObjects(created: any, regionId: string, objects: any[]) {
  repositories.worldRepository.updateRegion(regionId, { objects });
  created.session.regions.get(regionId).objects = objects;
}

const cases = [
  ['Usa il porto di Kampala', 'INFRASTRUCTURE_MISSING'],
  ['Ampliare Kampala Port', 'INFRASTRUCTURE_MISSING'],
  ['Usiamo la ferrovia esistente per i convogli alimentari', 'INFRASTRUCTURE_MISSING'],
  ['Priorità ferroviaria ai convogli alimentari', 'INFRASTRUCTURE_MISSING'],
  ['Mandiamo la flotta', 'MILITARY_ASSET_MISSING'],
];

describe('canonical backend order safety', () => {
  it.each(cases)('the pure feasibility gate rejects %s from canonical empty inventories', (text, code) => {
    const normalized = normalizeOrderIntent(draftIntentCandidate({ id: 'ord_safe', actorPolityId: 'ALPHA', originalText: text }));
    if (!normalized.ok) throw new Error('Invalid test intent');
    const assessment = new FeasibilityService(catalog).evaluate(normalized.intent, {
      actorId: 'alpha_treasury', verifiedPolityId: 'ALPHA', approvals: ['user'], rights: [], knowledgeIds: [], capabilityIds: [],
      canonicalWorld: { regions: [{ id: 'alpha', name: 'Kampala', owner: 'ALPHA', objects: [] }], operationalObjects: [] },
    });
    expect(assessment.status).toBe('blocked');
    expect(assessment.blockers).toEqual(expect.arrayContaining([expect.objectContaining({ code })]));
  });

  it.each(cases)('legacy and strict HTTP preflight both reject %s without mutation or LLM', async (text, code) => {
    for (const created of [legacy, strict]) {
      const beforeVersion = created.session.getQueueVersion();
      const beforeObjects = db.prepare('SELECT objects FROM world_regions WHERE world_id = ?').all(created.session.worldId);
      const result = await route('post', '/:id/actions/check-feasibility', created.gameId, { text });
      expect(result.status).toBe(200);
      expect(result.payload.feasible).toBe(false);
      expect(result.payload.rawAssessment.blockers).toEqual(expect.arrayContaining([expect.objectContaining({ code })]));
      expect(created.session.getQueueVersion()).toBe(beforeVersion);
      expect(db.prepare('SELECT objects FROM world_regions WHERE world_id = ?').all(created.session.worldId)).toEqual(beforeObjects);
    }
    expect(generate).not.toHaveBeenCalled();
  });

  it('structured evaluate cannot bypass the geography guard with a qualitative intent', async () => {
    const intent = draftIntentCandidate({ id: 'ord_eval', actorPolityId: 'ALPHA', originalText: 'Usa il porto di Kampala' });
    const result = await route('post', '/:id/actions/evaluate', strict.gameId, { intent });
    expect(result.status).toBe(200);
    expect(result.payload.orders[0]).toMatchObject({ status: 'blocked', blockers: [expect.objectContaining({ code: 'INFRASTRUCTURE_MISSING' })] });
  });

  it.each(cases)('queue admission rejects %s even without a client preflight', async (text) => {
    const before = legacy.session.getQueueVersion();
    const result = await route('post', '/:id/actions/queue', legacy.gameId, { text });
    expect(result.status).toBe(422);
    expect(result.payload).toMatchObject({ code: 'order_reality_blocked', canonicalMutation: false });
    expect(legacy.session.getQueueVersion()).toBe(before);
    expect(legacy.session.getPendingActions()).toEqual([]);
  });

  it('queue edits cannot replace an admitted act with nonexistent infrastructure use', async () => {
    const action = legacy.session.queueAction('Costruisci una nuova ferrovia verso nord');
    const before = legacy.session.getQueueVersion();
    const result = await route('patch', '/:id/actions/queue/:actionId', legacy.gameId, { text: 'Usa il porto di Kampala' }, action.id);
    expect(result.status).toBe(422);
    expect(action.text).toBe('Costruisci una nuova ferrovia verso nord');
    expect(legacy.session.getQueueVersion()).toBe(before);
    legacy.session.removePendingAction(action.id);
  });

  it.each([
    'Voglio costruire una ferrovia verso nord',
    'Costruisci una nuova ferrovia',
    'Build a new railway',
  ])('does not mistake a planned NEW railway for missing EXISTING infrastructure: %s', async text => {
    const result = await route('post', '/:id/actions/check-feasibility', legacy.gameId, { text });
    expect(result.payload.feasible).toBe(true);
    const action = legacy.session.queueAction(text);
    expect(action.workOrder).toBeUndefined(); // no invented bill, route or execution effects
    legacy.session.removePendingAction(action.id);
  });

  it.each([
    'Costruisci una nuova ferrovia e usa il porto di Kampala',
    'Costruisci una nuova ferrovia; poi utilizza la ferrovia esistente',
    'Build a new railway and deploy the fleet',
  ])('a new construction clause cannot exempt another impossible instruction: %s', async text => {
    const result = await route('post', '/:id/actions/check-feasibility', legacy.gameId, { text });
    expect(result.payload.feasible).toBe(false);
  });

  it('an untyped infrastructure marker or a planned port does not prove a railway/port exists', async () => {
    setObjects(legacy, 'safety-kampala', [
      { id: 'infra', type: 'infrastructure', name: 'Ferrovia immaginata' },
      { id: 'port-plan', type: 'construction_site', name: 'Kampala Port', metadata: { targetType: 'port' } },
    ]);
    for (const text of ['Usa il porto di Kampala', 'Usiamo la ferrovia esistente']) {
      expect((await route('post', '/:id/actions/check-feasibility', legacy.gameId, { text })).payload.feasible).toBe(false);
    }
    setObjects(legacy, 'safety-kampala', []);
  });

  it('real map assets, including delivered ft_railway, satisfy existence but foreign assets do not', async () => {
    setObjects(legacy, 'safety-kampala', [
      { id: 'p', type: 'port', name: 'Kampala Port' },
      { id: 'rail', type: 'ft_railway', name: 'Ferrovia del nord', metadata: { status: 'operational' } },
    ]);
    for (const text of ['Usa il porto di Kampala', 'Usiamo la ferrovia esistente']) {
      expect((await route('post', '/:id/actions/check-feasibility', legacy.gameId, { text })).payload.feasible).toBe(true);
    }
    setObjects(legacy, 'safety-kampala', [{ id: 'p', type: 'port', name: 'Kampala Port', owner: 'KEN' }]);
    expect((await route('post', '/:id/actions/check-feasibility', legacy.gameId, { text: 'Usa il porto di Kampala' })).payload.feasible).toBe(false);
    setObjects(legacy, 'safety-kampala', []);
  });

  it('an existing asset clause does not turn a subsequent NEW construction into existing use', async () => {
    setObjects(legacy, 'safety-kampala', [{ id: 'road', type: 'ft_road', name: 'Strada' }]);
    const result = await route('post', '/:id/actions/check-feasibility', legacy.gameId, { text: 'Usa la strada esistente e costruisci una nuova ferrovia' });
    expect(result.payload.feasible).toBe(true);
    setObjects(legacy, 'safety-kampala', []);
  });

  it('a different real port cannot legitimize a named invented port', async () => {
    setObjects(legacy, 'safety-kampala', [{ id: 'p', type: 'port', name: 'Entebbe Port' }]);
    expect((await route('post', '/:id/actions/check-feasibility', legacy.gameId, { text: 'Usa il porto di Mombasa' })).payload.feasible).toBe(false);
    setObjects(legacy, 'safety-kampala', []);
  });

  it('naval inventory comes from persisted ships, not empty fleets or ports', async () => {
    const ops = repositories.operationalObjectRepository;
    ops.upsert(legacy.gameId, 'fleet', 'f', { name: '1ª Flotta', shipIds: ['s'] });
    ops.upsert(legacy.gameId, 'ship', 's', { name: 'Nave', fleetId: 'f', status: 'under_construction' });
    expect((await route('post', '/:id/actions/check-feasibility', legacy.gameId, { text: 'Mandiamo la flotta' })).payload.feasible).toBe(false);
    ops.upsert(legacy.gameId, 'ship', 's', { name: 'Nave', fleetId: 'f', status: 'operational' });
    expect((await route('post', '/:id/actions/check-feasibility', legacy.gameId, { text: 'Mandiamo la flotta' })).payload.feasible).toBe(true);
    ops.remove(legacy.gameId, 's');
    ops.remove(legacy.gameId, 'f');
  });

  it('a declared construction region must exist and belong to the acting polity', async () => {
    const work = { workId: 'w_railway', payerActorId: 'alpha_treasury', materialActorId: 'alpha_treasury', funded: true, regionId: 'not-a-region' };
    const result = await route('post', '/:id/actions/queue', strict.gameId, { text: 'Costruisci una nuova ferrovia', work });
    expect(result.status).toBe(422);
    expect(result.payload.blockers).toEqual(expect.arrayContaining([expect.objectContaining({ code: 'UNKNOWN_ENTITY', targetId: 'not-a-region' })]));
  });

  it('canonical treasury, materials, knowledge and authority blockers are retained alongside geography', () => {
    const normalized = normalizeOrderIntent(draftIntentCandidate({ id: 'ord_constraints', actorPolityId: 'ALPHA', originalText: 'Usa il porto di Kampala' }));
    if (!normalized.ok) throw new Error('Invalid test intent');
    const assessment = new FeasibilityService(catalog).evaluate(normalized.intent, {
      actorId: 'beta_treasury', verifiedPolityId: 'ALPHA', approvals: [], rights: [], knowledgeIds: [], capabilityIds: [],
      requirements: { qualitative: { allOf: ['verified-technology'] } },
      deficits: [
        { code: 'INSUFFICIENT_CASH', id: 'test', phaseId: 'p', required: '10', available: '0', missing: '10', holder: 'alpha_treasury' },
        { code: 'MATERIAL_SHORTAGE', id: 'steel', phaseId: 'p', required: '5', available: '0', missing: '5', holder: 'alpha_treasury' },
      ],
      canonicalWorld: { regions: [], operationalObjects: [] },
    });
    expect(assessment.blockers.map(blocker => blocker.code)).toEqual(expect.arrayContaining([
      'INFRASTRUCTURE_MISSING', 'UNAUTHORIZED_ACTOR', 'KNOWLEDGE_MISSING', 'INSUFFICIENT_CASH', 'MATERIAL_SHORTAGE',
    ]));
  });

  it('a known foreign construction region is rejected rather than treated as an owned location', async () => {
    repositories.worldRepository.addRegion({ id: 'safety-foreign', worldId: 'safety-strict', name: 'Foreign', owner: 'BETA', objects: [] });
    const work = { workId: 'w_railway', payerActorId: 'alpha_treasury', materialActorId: 'alpha_treasury', funded: true, regionId: 'safety-foreign' };
    const result = await route('post', '/:id/actions/queue', strict.gameId, { text: 'Costruisci una nuova ferrovia', work });
    expect(result.status).toBe(422);
    expect(result.payload.blockers).toEqual(expect.arrayContaining([expect.objectContaining({ code: 'UNAUTHORIZED_ACTOR', targetId: 'safety-foreign' })]));
  });

  it.each(['step', 'completion'])('restored playback %s also rechecks impossible orders before effects', async boundary => {
    const { PlaybackService } = await import('../src/game/PlaybackService');
    const action = { id: `playback-${boundary}`, text: 'Usa il porto di Kampala', createdAt: '1951-01-01', status: 'pending' };
    repositories.gameRepository.queuePendingAction({ ...action, gameId: legacy.gameId });
    legacy.session.getPendingActions().push(action);
    const apply = vi.fn(() => { throw new Error('unprotected playback checkpoint'); });
    const playback = new PlaybackService({
      gameId: legacy.gameId, state: legacy.session.state, orders: legacy.session.orders,
      reconcileNpcMaterialMeasures: apply,
    } as any);
    const run = { runId: 'restored-run', batchActionIds: [action.id], completion: {}, remainingEvents: [] } as any;
    const operation = boundary === 'step'
      ? playback.commitPausedStepUnlocked(run, { date: '1951-01-02' } as any)
      : playback.completePausedRunUnlocked(run, 'completed');
    await expect(operation).rejects.toThrow(/order_reality_blocked/);
    expect(apply).not.toHaveBeenCalled();
    expect(action.status).toBe('pending');
    legacy.session.removePendingAction(action.id);
  });

  it('execution rechecks restored/bypassed orders before calling a provider or changing the world', async () => {
    const action = { id: 'restored-impossible', text: 'Usa il porto di Kampala', createdAt: '1951-01-01', status: 'pending' };
    repositories.gameRepository.queuePendingAction({ ...action, gameId: legacy.gameId });
    legacy.session.getPendingActions().push(action);
    const date = legacy.session.getCurrentDate();
    const version = legacy.session.getQueueVersion();
    await expect(legacy.session.processNextAction(30)).rejects.toThrow(/order_reality_blocked/);
    expect(action.status).toBe('pending');
    expect(legacy.session.getCurrentDate()).toBe(date);
    expect(legacy.session.getQueueVersion()).toBe(version);
    expect(generate).not.toHaveBeenCalled();
    legacy.session.removePendingAction(action.id);
  });

  it('execution uses current assets, not a previous successful admission', async () => {
    setObjects(legacy, 'safety-kampala', [{ id: 'p', type: 'port', name: 'Kampala Port' }]);
    const action = legacy.session.queueAction('Usa il porto di Kampala');
    setObjects(legacy, 'safety-kampala', []);
    await expect(legacy.session.processNextAction(30)).rejects.toThrow(/order_reality_blocked/);
    expect(action.status).toBe('pending');
    expect(generate).not.toHaveBeenCalled();
    legacy.session.removePendingAction(action.id);
  });
});

describe('canonical land-attack preflight (WS-GOV-DOSSIER-SALIENCE)', () => {
  const empty = { regions: [{ id: 'r', name: 'R', owner: 'ALPHA', objects: [] as unknown[] }], operationalObjects: [] as Array<{ id: string; kind: string; data: Record<string, unknown> }> };
  const withUnit = { regions: empty.regions, operationalObjects: [{ id: 'u1', kind: 'unit', data: { polityId: 'ALPHA', status: 'operational', personnel: 800 } }] };
  const withFormingUnit = { regions: empty.regions, operationalObjects: [{ id: 'u2', kind: 'unit', data: { polityId: 'ALPHA', status: 'forming', personnel: 800 } }] };
  const withArmy = { regions: [{ id: 'r', name: 'R', owner: 'ALPHA', objects: [{ id: 'a1', type: 'army', name: 'I Armata', level: 3 }] }], operationalObjects: [] as Array<{ id: string; kind: string; data: Record<string, unknown> }> };
  const withFleet = { regions: [{ id: 'r', name: 'R', owner: 'ALPHA', objects: [{ id: 'f1', type: 'fleet', name: 'I Flotta' }] }], operationalObjects: [] as Array<{ id: string; kind: string; data: Record<string, unknown> }> };
  const withMissile = { regions: [{ id: 'r', name: 'R', owner: 'ALPHA', objects: [{ id: 'm1', type: 'missile', name: 'Missili' }] }], operationalObjects: [] as Array<{ id: string; kind: string; data: Record<string, unknown> }> };
  const withShip = { regions: empty.regions, operationalObjects: [{ id: 's1', kind: 'ship', data: { polityId: 'ALPHA', status: 'operational', name: 'Nave' } }] };
  const codes = (text: string, world: Parameters<typeof canonicalOrderBlockers>[2]) => canonicalOrderBlockers(text, 'ALPHA', world).map(blocker => blocker.code);

  it('blocca un ordine esplicito di attacco senza alcun reparto terrestre', () => {
    expect(codes('Attacchiamo il Kenya', empty)).toContain('MILITARY_ASSET_MISSING');
    expect(codes('Invadiamo il Kenya', empty)).toContain('MILITARY_ASSET_MISSING');
    expect(codes("Lanciamo un'offensiva contro il Kenya", empty)).toContain('MILITARY_ASSET_MISSING');
  });

  it('non blocca lo stesso ordine con un reparto terrestre canonico utilizzabile', () => {
    for (const world of [withUnit, withArmy]) {
      expect(codes('Attacchiamo il Kenya', world)).not.toContain('MILITARY_ASSET_MISSING');
    }
  });

  it('un reparto in formazione non è ancora una forza utilizzabile', () => {
    expect(codes('Attacchiamo il Kenya', withFormingUnit)).toContain('MILITARY_ASSET_MISSING');
  });

  it('discussione, ipotesi e negazione non sono esecuzione', () => {
    for (const text of ['Valutiamo se attaccare il Kenya', 'Se attacchiamo il Kenya perderemo', 'Non attacchiamo il Kenya', 'Attaccare il Kenya sarebbe un errore']) {
      expect(codes(text, empty)).not.toContain('MILITARY_ASSET_MISSING');
    }
  });

  it('distingue un ordine esplicito da movimento o impiego navale', () => {
    expect(codes('Ordina di attaccare il Kenya', empty)).toContain('MILITARY_ASSET_MISSING');
    expect(canonicalOrderBlockers('Attacchiamo il Kenya', 'ALPHA', empty).map(blocker => blocker.field)).toContain('military.landForces');
    expect(canonicalOrderBlockers('Mandiamo la flotta', 'ALPHA', empty).map(blocker => blocker.field)).toEqual(['military.navalAssets']);
    expect(codes('Rafforziamo la frontiera settentrionale', empty)).toEqual([]);
  });

  it('un attacco navale o missilistico non è trattato come attacco terrestre', () => {
    expect(canonicalOrderBlockers('Ordina alla I Flotta di attaccare in Italia', 'ALPHA', withFleet).map(blocker => blocker.field)).not.toContain('military.landForces');
    expect(canonicalOrderBlockers('Lanciamo un attacco missilistico', 'ALPHA', withMissile).map(blocker => blocker.field)).not.toContain('military.landForces');
  });
});

describe('military domain preflight (WS-GOV-MILITARY-PREFLIGHT)', () => {
  const empty = { regions: [{ id: 'r', name: 'R', owner: 'ALPHA', objects: [] as unknown[] }], operationalObjects: [] as Array<{ id: string; kind: string; data: Record<string, unknown> }> };
  const unit = (personnel: number, status = 'operational') => ({ regions: empty.regions, operationalObjects: [{ id: 'u1', kind: 'unit', data: { polityId: 'ALPHA', status, personnel } }] });
  const ship = { regions: empty.regions, operationalObjects: [{ id: 's1', kind: 'ship', data: { polityId: 'ALPHA', status: 'operational', name: 'Nave' } }] };
  const fleetObject = { regions: [{ id: 'r', name: 'R', owner: 'ALPHA', objects: [{ id: 'f1', type: 'fleet', name: 'I Flotta' }] }], operationalObjects: [] as Array<{ id: string; kind: string; data: Record<string, unknown> }> };
  const missileObject = { regions: [{ id: 'r', name: 'R', owner: 'ALPHA', objects: [{ id: 'm1', type: 'missile', name: 'Missili' }] }], operationalObjects: [] as Array<{ id: string; kind: string; data: Record<string, unknown> }> };
  const blockersFor = (text: string, world: Parameters<typeof canonicalOrderBlockers>[2]) => canonicalOrderBlockers(text, 'ALPHA', world);
  const codes = (text: string, world: Parameters<typeof canonicalOrderBlockers>[2]) => blockersFor(text, world).map(blocker => blocker.code);
  const fields = (text: string, world: Parameters<typeof canonicalOrderBlockers>[2]) => blockersFor(text, world).map(blocker => blocker.field);

  it('terra: attacco senza reparti => blocked', () => {
    expect(fields('Attacchiamo il Kenya', empty)).toContain('military.landForces');
  });

  it('terra: un reparto con personnel 0 non conta', () => {
    expect(fields('Attacchiamo il Kenya', unit(0))).toContain('military.landForces');
  });

  it('terra: un reparto operativo con personale non è bloccato da questo guard', () => {
    expect(fields('Attacchiamo il Kenya', unit(800))).not.toContain('military.landForces');
  });

  it('mare: attacco navale senza flotta/navi => blocked', () => {
    expect(fields('Ordina alla I Flotta di attaccare in Italia', empty)).toContain('military.navalAssets');
  });

  it('mare: attacco navale con asset valido => ok', () => {
    for (const world of [ship, fleetObject]) {
      expect(fields('Ordina alla I Flotta di attaccare in Italia', world)).not.toContain('military.navalAssets');
    }
  });

  it('missili: lancio senza capacità => blocked', () => {
    expect(fields('Lanciamo un attacco missilistico', empty)).toContain('military.missileAssets');
  });

  it('missili: lancio con capacità canonica => ok', () => {
    expect(fields('Lanciamo un attacco missilistico', missileObject)).not.toContain('military.missileAssets');
  });

  it('aria: capacità non modellata => DATA_UNAVAILABLE', () => {
    const air = blockersFor('Usiamo l’aviazione per bombardare il Kenya', empty);
    expect(air).toEqual([expect.objectContaining({ code: 'DATA_UNAVAILABLE', field: 'military.airAssets' })]);
  });

  it('domande, ipotesi e negazioni non producono blocker esecutivi', () => {
    for (const text of ['Valutiamo un attacco missilistico', 'Valutiamo se attaccare il Kenya', 'Come usiamo la flotta?', 'Non lanciamo missili', 'Un’analisi dell’attacco missilistico']) {
      expect(codes(text, empty)).toEqual([]);
    }
  });
});
