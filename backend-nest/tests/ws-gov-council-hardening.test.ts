/**
 * WS-GOV-COUNCIL-HARDENING — i tre fatti che il Governo deve leggere dal motore
 * ============================================================================
 * Il modulo Governo (riunione condivisa) non deve dedurre i dati del motore:
 *  - il **denaro disponibile** è quello che il preflight misura sul ledger, non
 *    il saldo nazionale ricalcolato dal client;
 *  - i **deficit** sono quelli di `measureDeficits`, con i tre numeri;
 *  - la **localizzazione** di un'opera è un dato canonico (la regione scelta
 *    nell'atto), e viaggia con l'ordine fino al contesto del progetto.
 *
 * Guardia contro il falso verde: la disponibilità monetaria è verificata
 * **anche quando copre** il fabbisogno — è il caso in cui `deficits` è vuoto e
 * il client non avrebbe da dove ricavarla — e la regione è riletta dal
 * database del progetto, non dal valore di ritorno.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { loadSimulationCatalog } from '../src/scenario/loader';
import { measureDeficits } from '../src/core/feasibility/Availability';
import type { AvailabilityReadings } from '../src/core/feasibility/Availability';
import { FeasibilityService } from '../src/core/feasibility/FeasibilityService';
import { normalizeOrderIntent, type OrderIntent } from '../src/core/feasibility/intent';
import type { PendingAction } from '../src/game/OrderExecutionService';

const DB = path.join(os.tmpdir(), `world-story-wsgov-${process.pid}-${Date.now()}.db`);
process.env.OPEN_PAX_DB_PATH = DB;

const FIXTURE_DIR = path.join(process.cwd(), 'data', 'presets', 'realism_test_world');
const WORLD_ID = 'wsgov-world';
const REGION_ID = 'wsgov-region';

const catalog = () => loadSimulationCatalog(FIXTURE_DIR).catalog!;

function roadIntent(): OrderIntent {
  const normalized = normalizeOrderIntent({
    id: 'ord_road', actorPolityId: 'ALPHA', originalText: 'Costruisci una strada',
    actionKind: 'construct', targetIds: ['ALPHA', 'w_road'], catalogRef: 'w_road',
    priority: 1, dependencyIds: [],
    authorization: { allowPartialStart: false, allowedPhaseIds: [] },
  });
  if (!normalized.ok) throw new Error(JSON.stringify(normalized.clarifications));
  return normalized.intent;
}

// ─── La disponibilità misurata (puro) ────────────────────────────────────────

describe('WS-GOV-COUNCIL-HARDENING — la disponibilità che il Tesoro legge', () => {
  it('a opera COPERTO il denaro disponibile è comunque misurato (nessun deficit da cui ricavarlo)', () => {
    const readings: AvailabilityReadings = {
      money: [{ holder: 'alpha_treasury', unitId: 'test', available: '25000' }],
      stock: [
        { holder: 'alpha_treasury', unitId: 'steel', available: '50' },
        { holder: 'alpha_treasury', unitId: 'tools', available: '10' },
      ],
    };
    const { deficits, availableMoney } = measureDeficits(roadIntent(), catalog(), readings, 'alpha_treasury');
    expect(deficits).toEqual([]);
    expect(availableMoney).toEqual([{ holder: 'alpha_treasury', unitId: 'test', available: '25000' }]);
  });

  it('a opera SCOPERTA il disponibile coincide con quello del deficit: nessuna contraddizione', () => {
    const readings: AvailabilityReadings = {
      money: [{ holder: 'alpha_treasury', unitId: 'test', available: '10000' }],
      stock: [],
    };
    const { deficits, availableMoney } = measureDeficits(roadIntent(), catalog(), readings, 'alpha_treasury');
    const cash = deficits.find(d => d.code === 'INSUFFICIENT_CASH')!;
    expect(cash).toMatchObject({ required: '20000', available: '10000', missing: '10000' });
    // Stesso numero del deficit: il Tesoro non può dire «disponibile 0» e
    // «mancano 10000» mentre il deficit dice available 10000.
    expect(availableMoney).toEqual([{ holder: 'alpha_treasury', unitId: 'test', available: '10000' }]);
  });

  it('il denaro di un altro detentore non entra nella disponibilità', () => {
    const readings: AvailabilityReadings = {
      money: [{ holder: 'beta_treasury', unitId: 'test', available: '999999' }],
      stock: [],
    };
    const { availableMoney } = measureDeficits(roadIntent(), catalog(), readings, 'alpha_treasury');
    expect(availableMoney).toBeUndefined();
  });

  it('`evaluate` copia disponibilità e deficit nel giudizio, senza ricalcolarli', () => {
    const readings: AvailabilityReadings = {
      money: [{ holder: 'alpha_treasury', unitId: 'test', available: '25000' }],
      stock: [
        { holder: 'alpha_treasury', unitId: 'steel', available: '50' },
        { holder: 'alpha_treasury', unitId: 'tools', available: '10' },
      ],
    };
    const measured = measureDeficits(roadIntent(), catalog(), readings, 'alpha_treasury');
    const service = new FeasibilityService(catalog());
    const assessment = service.evaluate(roadIntent(), {
      actorId: 'alpha_treasury', verifiedPolityId: 'ALPHA', approvals: [], rights: [],
      knowledgeIds: [], capabilityIds: [], deficits: measured.deficits, unknownRequirements: measured.unknown,
      availableMoney: measured.availableMoney,
    });
    expect(assessment.availableMoney).toEqual([{ holder: 'alpha_treasury', unitId: 'test', available: '25000' }]);
    expect(assessment.deficits).toEqual([]);
  });
});

// ─── La regione canonica nel contesto del progetto (database) ────────────────

const roadDeclaration = (funded = true) => ({
  workId: 'w_road', payerActorId: 'alpha_steel_co_treasury', materialActorId: 'alpha_steel_co', funded,
});

function order(id: string, text: string, declaration?: PendingAction['workOrder']): PendingAction {
  return {
    id, text, createdAt: '1951-01-01', status: 'processing',
    ...(declaration ? { workOrder: declaration } : {}),
  };
}

describe('WS-GOV-COUNCIL-HARDENING — la localizzazione canonica viaggia con l’ordine', () => {
  let db: any;
  let gameId = '';
  let branchId = '';

  beforeAll(async () => {
    const d = await import('../src/database');
    db = d.default;
    d.initDatabase();
    const worlds = (await import('../src/repositories/world.repository')).worldRepository;
    worlds.createWithRegions(
      { id: WORLD_ID, name: 'WSGOV', templateId: 'realism_test_world' },
      [{ id: REGION_ID, name: 'Sarajevo', color: '#000', owner: 'ALPHA', population: 1, gdp: 1, militaryPower: 1, flag: 'S' }],
    );
    const registry = await import('../src/session-registry');
    registry.initSessionRegistry({ consolidation: { startRound: 25, chunkSize: 5, keepRawTail: 10 }, clearCache() {} } as never);
    const created = registry.getSessionRegistry().createSession(WORLD_ID, 'P', REGION_ID);
    gameId = created.gameId;
    branchId = created.session.fenceContext().branchId!;
    const { bootstrapCatalogEconomy } = await import('../src/services/StrictEffectProducerService');
    bootstrapCatalogEconomy(gameId, branchId, catalog());
    expect((db as { name?: string }).name, 'database temporaneo').toBe(DB);
  });

  afterAll(() => {
    try { fs.rmSync(DB); } catch { /* tmp */ }
    for (const suffix of ['-wal', '-shm']) {
      try { fs.rmSync(DB + suffix); } catch { /* tmp */ }
    }
  });

  const contextOf = (projectId: string): { regionId?: string } | null => {
    const row = db.prepare(
      'SELECT context_json FROM project_runtime_states WHERE branch_id = ? AND project_id = ?',
    ).get(branchId, projectId) as { context_json: string | null } | undefined;
    return row?.context_json ? JSON.parse(row.context_json) : null;
  };

  it('la regione DICHIARATA nell’atto vince sulla regione dell’ordine', async () => {
    const { applyWorkCommits } = await import('../src/game/WorkCommitTurn');
    const outcomes = applyWorkCommits({
      gameId, branchId, catalog: catalog(),
      // La regione dell'ordine è quella del giocatore (REGION_ID); l'atto
      // dichiara SARAJEVO: deve vincere la dichiarazione canonica.
      regionId: REGION_ID,
      actions: [order('loc1', 'Fabbrica', { ...roadDeclaration(), regionId: 'SARAJEVO' })],
      wasAccepted: () => true, playerPolityId: 'ALPHA',
    });
    expect(outcomes[0]).toMatchObject({ kind: 'committed', orderId: 'loc1' });
    const committed = outcomes[0] as { projectId: string };
    expect(contextOf(committed.projectId)?.regionId).toBe('SARAJEVO');
  });

  it('senza dichiarazione resta la regione fornita dall’ordine (comportamento precedente)', async () => {
    const { applyWorkCommits } = await import('../src/game/WorkCommitTurn');
    const outcomes = applyWorkCommits({
      gameId, branchId, catalog: catalog(),
      regionId: REGION_ID,
      actions: [order('loc2', 'Fabbrica', roadDeclaration())],
      wasAccepted: () => true, playerPolityId: 'ALPHA',
    });
    expect(outcomes[0]).toMatchObject({ kind: 'committed', orderId: 'loc2' });
    const committed = outcomes[0] as { projectId: string };
    expect(contextOf(committed.projectId)?.regionId).toBe(REGION_ID);
  });
});
