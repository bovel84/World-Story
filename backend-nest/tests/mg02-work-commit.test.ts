/**
 * MG02 µ3 — Il cantiere nasce con le sue riserve, o non nasce affatto
 * ==================================================================
 * Il gate di MG02 era: «nessuna doppia spesa e nessun asset non pagato». Qui si
 * difendono le tre proprietà che lo rendono vero, tutte verificate su un
 * database vero:
 *
 *  - **Atomicità.** Un errore a metà — il caso più realistico è il runtime del
 *    progetto già presente con contenuto diverso — deve annullare anche le
 *    riserve già create. Niente denaro impegnato per un cantiere inesistente.
 *  - **Idempotenza.** Gli id derivano dall'ordine, non da un contatore: un
 *    retry ripropone gli stessi effectId e non crea seconde prenotazioni. Un
 *    retry con contenuto diverso fallisce chiuso invece di sovrascrivere.
 *  - **Si riserva, non si spende.** Il ledger non cresce: `available` cala,
 *    `total` no. Il movimento vero lo fa il tick quando la fase consuma.
 *
 * Guardia contro il falso verde: il test non guarda solo i valori di ritorno.
 * Conta le righe di `reservations`, ricostruisce il ledger e rilegge il runtime
 * dal database — cioè verifica lo STATO, non il resoconto della funzione.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { loadSimulationCatalog } from '../src/scenario/loader';
import { runtimeFor } from '../src/core/feasibility/WorkPlan';
// NOTA DI IGIENE: `WorkCommitService` e `project-runtime.repository` toccano il
// DATABASE all'import, quindi si caricano con `await import` DENTRO i test —
// dopo che `process.env.OPEN_PAX_DB_PATH` è impostato. Con un import statico il
// modulo verrebbe caricato prima, e il test scriverebbe nel database vero del
// repository invece che nel file temporaneo. È successo davvero mentre
// scrivevo questo test: gli altri test del progetto lo evitano perché importano
// solo moduli puri (`scenario/loader`, `feasibility/*`, `projects/ProjectEngine`).

const DB = path.join(os.tmpdir(), `world-story-mg02c-${process.pid}-${Date.now()}.db`);
process.env.OPEN_PAX_DB_PATH = DB;

const FIXTURE_DIR = path.join(process.cwd(), 'data', 'presets', 'realism_test_world');
const WORLD_ID = 'mg02c-world';
const REGION_ID = 'mg02c-region';

const catalog = () => loadSimulationCatalog(FIXTURE_DIR).catalog!;
const road = () => catalog().works.find(w => w.id === 'w_road')!;

describe('MG02 µ3 — commit di un’opera', () => {
  let db: any;
  let gameId = '';
  let branchId = '';

  beforeAll(async () => {
    const d = await import('../src/database');
    db = d.default;
    d.initDatabase();
    const worlds = (await import('../src/repositories/world.repository')).worldRepository;
    worlds.createWithRegions(
      { id: WORLD_ID, name: 'MG02c', templateId: 'realism_test_world' },
      [{ id: REGION_ID, name: 'A', color: '#000', owner: 'ALPHA', population: 1, gdp: 1, militaryPower: 1, flag: 'A' }],
    );
    const registry = await import('../src/session-registry');
    registry.initSessionRegistry({ consolidation: { startRound: 25, chunkSize: 5, keepRawTail: 10 }, clearCache() {} } as never);
    const created = registry.getSessionRegistry().createSession(WORLD_ID, 'P', REGION_ID);
    gameId = created.gameId;
    branchId = created.session.fenceContext().branchId!;
    const { bootstrapCatalogEconomy } = await import('../src/services/StrictEffectProducerService');
    bootstrapCatalogEconomy(gameId, branchId, catalog());

    // GUARDIA DI IGIENE: se un import statico avesse caricato il database prima
    // di `OPEN_PAX_DB_PATH`, il percorso sarebbe quello vero del repository e
    // questo test scriverebbe nelle partite dell'autore. Il test lo verifica
    // invece di sperarlo.
    const openedPath = (db as { name?: string }).name;
    expect(openedPath, 'il test deve girare su un database temporaneo, non su quello del repository').toBe(DB);
  });

  afterAll(() => {
    try { fs.rmSync(DB); } catch { /* tmp */ }
    for (const suffix of ['-wal', '-shm']) {
      try { fs.rmSync(DB + suffix); } catch { /* tmp */ }
    }
  });

  const reservations = (): number => (db.prepare(
    'SELECT COUNT(*) AS n FROM reservations WHERE branch_id = ?',
  ).get(branchId) as { n: number }).n;
  const projects = (): number => (db.prepare(
    'SELECT COUNT(*) AS n FROM project_runtime_states WHERE branch_id = ?',
  ).get(branchId) as { n: number }).n;
  const ledgerRows = (): number => (db.prepare(
    'SELECT COUNT(*) AS n FROM ledger_entries WHERE branch_id = ?',
  ).get(branchId) as { n: number }).n;

  it('la cassa di ALPHA copre l’opera: il commit riesce e il cantiere esiste', async () => {
    const { commitWork } = await import('../src/services/WorkCommitService');
    const before = { reservations: reservations(), projects: projects(), ledger: ledgerRows() };
    // Nota misurata: la cassa della nazione sta sulla TESORERIA, i materiali
    // sull'IMPRESA. Il commit vuole un solo `actorId`, quindi la fixture dà
    // all'impresa una propria tesoreria (`alpha_steel_co_treasury`): è lei che
    // possiede utensili, acciaio e i fondi per pagarli. Un attore senza cassa
    // non costruisce — e questo è il punto.
    const result = commitWork({
      gameId, branchId, orderId: 'ordine_alpha',
      holders: { money: 'alpha_steel_co_treasury', materials: 'alpha_steel_co' },
      work: road(),
    });
    expect(result.status).toBe('committed');
    expect(result.projectId.startsWith('prj_')).toBe(true);

    // Il cantiere è nel DATABASE, non solo nel resoconto.
    expect(projects()).toBe(before.projects + 1);
    const row = db.prepare(
      'SELECT plan_json, state_json FROM project_runtime_states WHERE branch_id = ? AND project_id = ?',
    ).get(branchId, result.projectId) as { plan_json: string; state_json: string };
    const plan = JSON.parse(row.plan_json);
    expect(plan.phases.map((p: any) => p.id)).toEqual(['subgrade', 'paving']);
    expect(JSON.parse(row.state_json).status).toBe('active');

    // Le riserve: cassa + i materiali dell'opera.
    expect(result.reservationIds).toHaveLength(3);
    expect(reservations()).toBe(before.reservations + 3);

    // Si è RISERVATO, non speso: il ledger non è cresciuto di una riga.
    expect(ledgerRows()).toBe(before.ledger);
  });

  it('un retry identico non crea seconde prenotazioni né un secondo cantiere', async () => {
    const { commitWork } = await import('../src/services/WorkCommitService');
    const before = { reservations: reservations(), projects: projects() };
    const result = commitWork({
      gameId, branchId, orderId: 'ordine_alpha',
      holders: { money: 'alpha_steel_co_treasury', materials: 'alpha_steel_co' },
      work: road(),
    });
    expect(result.status).toBe('already_committed');
    expect(reservations()).toBe(before.reservations);
    expect(projects()).toBe(before.projects);
  });

  it('la disponibilità cala alla creazione, e il totale del ledger non cambia', async () => {
    const { getReservationAvailability } = await import('../src/services/ReservationService');
    const { ledgerUnitId } = await import('../src/services/StrictEffectProducerService');
    const availability = getReservationAvailability(branchId, {
      kind: 'money', unitId: ledgerUnitId('TEST'), holderRef: 'alpha_steel_co_treasury',
    });
    // Il catalogo assegna 1000000; la strada ne impegna 20000.
    // La tesoreria dell'impresa riceve 400000 dal catalogo e ne impegna 20000.
    expect(availability.total).toBe('400000');
    expect(availability.committed).toBe('20000');
    expect(availability.available).toBe('380000');
  });

  it('un ordine diverso impegna di nuovo: la chiave è l’ordine, non la risorsa', async () => {
    const { commitWork } = await import('../src/services/WorkCommitService');
    const before = { reservations: reservations(), projects: projects() };
    const result = commitWork({
      gameId, branchId, orderId: 'ordine_beta',
      holders: { money: 'alpha_steel_co_treasury', materials: 'alpha_steel_co' },
      work: road(),
    });
    expect(result.status).toBe('committed');
    expect(result.projectId).not.toBe(commitWork({
      gameId, branchId, orderId: 'ordine_alpha',
      holders: { money: 'alpha_steel_co_treasury', materials: 'alpha_steel_co' },
      work: road(),
    }).projectId);
    expect(reservations()).toBe(before.reservations + 3);
    expect(projects()).toBe(before.projects + 1);
  });

  it('senza disponibilità il commit fallisce e NON lascia nulla dietro', async () => {
    const { commitWork } = await import('../src/services/WorkCommitService');
    // BETA ha la cassa (800000 > 20000) ma NON i materiali: utensili e acciaio
    // sono di ALPHA. L'opera non parte a metà, e nulla resta appeso.
    const before = { reservations: reservations(), projects: projects() };
    expect(() => commitWork({
      gameId, branchId, orderId: 'ordine_beta2',
      holders: { money: 'beta_treasury', materials: 'beta_treasury' },
      work: road(),
    })).toThrow();
    // Nessuna riserva parziale, nessun cantiere: l'opera non parte a metà.
    expect(reservations()).toBe(before.reservations);
    expect(projects()).toBe(before.projects);
  });

  it('un errore a metà annulla anche le riserve già create', async () => {
    const { commitWork } = await import('../src/services/WorkCommitService');
    const { createProjectRuntime } = await import('../src/repositories/project-runtime.repository');
    // Il caso più realistico: il runtime del progetto esiste già con un
    // contenuto DIVERSO (un piano differente sullo stesso id). Il commit deve
    // fallire, e le riserve create un istante prima devono sparire con lui.
    const orderId = 'ordine_conflitto';
    const { plan, state } = runtimeFor(road(), orderId);
    const altered = JSON.parse(JSON.stringify(plan));
    altered.phases[0].minDays = 99; // stesso id, contenuto diverso
    createProjectRuntime(gameId, branchId, altered, state);

    const before = { reservations: reservations(), projects: projects() };
    expect(() => commitWork({
      gameId, branchId, orderId,
      holders: { money: 'alpha_steel_co_treasury', materials: 'alpha_steel_co' },
      work: road(),
    })).toThrow();

    // Il cantiere preesistente resta quello alterato, e non se ne aggiunge uno.
    expect(projects()).toBe(before.projects);
    // E soprattutto: nessuna riserva è rimasta appesa da un commit fallito.
    expect(reservations()).toBe(before.reservations);
    const orphan = db.prepare(
      'SELECT COUNT(*) AS n FROM reservations WHERE branch_id = ? AND reservation_id LIKE ?',
    ).get(branchId, `wres_%${orderId.slice(0, 4)}%`) as { n: number };
    expect(orphan.n).toBe(0);
  });

  it('la chiave della riserva è derivata dall’ordine, quindi stabile', async () => {
    const { reservationIdFor } = await import('../src/services/WorkCommitService');
    expect(reservationIdFor('abc', 'TEST')).toBe(reservationIdFor('abc', 'TEST'));
    expect(reservationIdFor('abc', 'TEST')).not.toBe(reservationIdFor('abd', 'TEST'));
    // L'unità è quella del ledger (minuscola), non quella del catalogo.
    expect(reservationIdFor('abc', 'TEST')).toContain('test');
    expect(reservationIdFor('abc', 'TEST')).not.toContain('TEST');
  });
});
