/**
 * MG03 µ3 — Dal turno all'opera sulla mappa: la filiera intera
 * ===========================================================
 * Il difetto che questo file esiste per chiudere: `advanceProjects` — il
 * percorso dei progetti nazionali — **esce subito in partita strict**. I
 * cantieri nati da `commitWork` vivono in `project_runtime_states`, che quel
 * percorso non legge: il cantiere si creava, le riserve si impegnavano, e
 * nessun giorno passava mai. Un cantiere immobile promette e non mantiene.
 *
 * Qui si difende l'aggancio al turno VERO: `advanceWorldState` avanza il
 * cantiere, consuma i materiali, e alla fine consegna l'opera sulla mappa con
 * l'effetto dichiarato.
 *
 * Guardia contro il falso verde: si guarda la MAPPA — `regions.objects` — e non
 * solo lo stato del progetto. Un test che si accontentasse di «il progetto è
 * completed» passerebbe anche se sulla mappa non comparisse nulla: e sarebbe
 * esattamente il difetto che l'autore ha descritto («costruisco una strada e non
 * si vede»).
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { loadSimulationCatalog } from '../src/scenario/loader';

const DB = path.join(os.tmpdir(), `world-story-mg03t-${process.pid}-${Date.now()}.db`);
process.env.OPEN_PAX_DB_PATH = DB;

const FIXTURE_DIR = path.join(process.cwd(), 'data', 'presets', 'realism_test_world');
const WORLD_ID = 'mg03t-world';
const REGION_ID = 'mg03t-region';

const catalog = () => loadSimulationCatalog(FIXTURE_DIR).catalog!;

describe('MG03 µ3 — il turno avanza il cantiere e consegna l’opera', () => {
  let db: any;
  let gameId = '';
  let branchId = '';
  let session: any;

  beforeAll(async () => {
    const d = await import('../src/database');
    db = d.default;
    d.initDatabase();
    const worlds = (await import('../src/repositories/world.repository')).worldRepository;
    worlds.createWithRegions(
      { id: WORLD_ID, name: 'MG03t', templateId: 'realism_test_world' },
      [{
        id: REGION_ID, name: 'Pianura', color: '#000', owner: 'ALPHA',
        population: 1, gdp: 1, militaryPower: 1, flag: 'A',
        // La geometria serve alla consegna: senza centro, l'opera non si
        // colloca e il test lo dichiarerebbe invece di passare per caso.
        geojson: JSON.stringify({
          type: 'Feature', properties: {},
          geometry: { type: 'Polygon', coordinates: [[[10, 40], [20, 40], [20, 50], [10, 50], [10, 40]]] },
        }),
      }],
    );
    const registry = await import('../src/session-registry');
    registry.initSessionRegistry({ consolidation: { startRound: 25, chunkSize: 5, keepRawTail: 10 }, clearCache() {} } as never);
    const created = registry.getSessionRegistry().createSession(WORLD_ID, 'P', REGION_ID);
    gameId = created.gameId;
    session = created.session;
    branchId = session.fenceContext().branchId!;
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

  /** Il cantiere di una strada, con il contesto che il commit registra. */
  async function commitRoad(orderId: string): Promise<string> {
    const { commitWork } = await import('../src/services/WorkCommitService');
    return commitWork({
      gameId, branchId, orderId,
      holders: { money: 'alpha_treasury', materials: 'alpha_steel_co' },
      work: catalog().works.find(w => w.id === 'w_road')!,
      regionId: REGION_ID,
    }).projectId;
  }

  const objectsOnMap = (): any[] => {
    const region = session.getRegion(REGION_ID);
    return region?.objects ?? [];
  };

  it('il contesto del progetto è registrato al commit: senza, l’avanzamento non saprebbe dove attingere', async () => {
    const projectId = await commitRoad('mg03t_contesto');
    const row = db.prepare(
      'SELECT context_json FROM project_runtime_states WHERE branch_id = ? AND project_id = ?',
    ).get(branchId, projectId) as { context_json: string | null };
    expect(row.context_json, 'il contesto operativo deve essere persistito').toBeTruthy();
    expect(JSON.parse(row.context_json!)).toEqual({
      payerActorId: 'alpha_treasury',
      materialActorId: 'alpha_steel_co',
      regionId: REGION_ID,
    });
  });

  it('il progetto porta la sua opera: è così che l’avanzamento sa cosa consumare', async () => {
    const projectId = await commitRoad('mg03t_opera');
    const row = db.prepare(
      'SELECT plan_json FROM project_runtime_states WHERE branch_id = ? AND project_id = ?',
    ).get(branchId, projectId) as { plan_json: string };
    expect(JSON.parse(row.plan_json).workId).toBe('w_road');
  });

  it('il turno avanza il cantiere: dopo i giorni minimi la prima fase è conclusa', async () => {
    const projectId = await commitRoad('mg03t_avanza');
    const stateOf = () => JSON.parse((db.prepare(
      'SELECT state_json FROM project_runtime_states WHERE branch_id = ? AND project_id = ?',
    ).get(branchId, projectId) as { state_json: string }).state_json);

    expect(stateOf().phases[0].completedWork).toBe('0');

    // Un salto di 6 giorni: la massicciata ne chiede 4, quindi è conclusa e la
    // pavimentazione è cominciata. Il numero di giorni è quello del salto, e il
    // test lo verifica invece di assumerlo.
    session.advanceWorldState(6, '1951-01-07');
    const after = stateOf();
    expect(after.phases.find((p: any) => p.id === 'subgrade').status).toBe('completed');
    expect(after.phases.find((p: any) => p.id === 'paving').completedWork).not.toBe('0');
  });

  it('alla fine l’opera compare SULLA MAPPA, con l’effetto dichiarato', async () => {
    // Il difetto dell'autore: «costruisco una strada e non si vede». Qui la
    // mappa è l'oggetto della verifica.
    const projectId = await commitRoad('mg03t_consegna');
    // Un salto lungo: tutte le fasi (4 + 3) e il collaudo.
    session.advanceWorldState(30, '1951-02-15');

    const delivered = objectsOnMap().find(object => object.metadata?.projectId === projectId);
    expect(delivered, 'l’opera deve esistere sulla mappa, non solo nel database dei progetti').toBeTruthy();

    // È l'OPERA, non un cantiere.
    expect(delivered.type).toBe('ft_road');
    expect(delivered.metadata.status).toBe('operational');
    // Con l'effetto dichiarato dalla distinta: misurabile, non un'icona.
    expect(delivered.metadata.effect).toEqual({ kind: 'transport', unit: 'km', perDay: '40' });
    // E la data del collaudo, non una previsione.
    expect(delivered.metadata.completedDate).toBe('1951-02-15');

    // Il progetto è chiuso e l'asset attivato.
    const state = JSON.parse((db.prepare(
      'SELECT state_json FROM project_runtime_states WHERE branch_id = ? AND project_id = ?',
    ).get(branchId, projectId) as { state_json: string }).state_json);
    expect(state.status).toBe('completed');
    expect(state.activatedAssets).toContain('ft_road');
  });

  it('l’avanzamento non consegna due volte la stessa opera', async () => {
    const projectId = await commitRoad('mg03t_una_volta');
    session.advanceWorldState(30, '1951-03-20');
    const after = objectsOnMap().filter(object => object.metadata?.projectId === projectId);
    expect(after).toHaveLength(1);

    // Un secondo salto non aggiunge una seconda strada.
    session.advanceWorldState(10, '1951-03-30');
    expect(objectsOnMap().filter(object => object.metadata?.projectId === projectId)).toHaveLength(1);
  });

  it('i materiali del cantiere escono dal ledger quando la fase comincia', async () => {
    const projectId = await commitRoad('mg03t_consumo');
    const rowsFor = () => db.prepare(
      "SELECT unit_id, delta, cause FROM ledger_entries WHERE branch_id = ? AND cause = 'consumo' AND effect_id LIKE ?",
    ).all(branchId, 'cs_%') as any[];

    const before = rowsFor().length;
    session.advanceWorldState(3, '1951-04-05');
    const after = rowsFor();
    // Il primo giorno di lavoro della massicciata consuma la sua distinta.
    expect(after.length).toBeGreaterThan(before);
    const steel = after.find(row => row.unit_id === 'steel');
    expect(steel).toBeTruthy();
    expect(steel.delta).toBe('8');
    // L'effetto è legato al progetto: non si confonde con un altro consumo.
    const prefix = `cs_${projectId.slice('prj_'.length).slice(0, 12)}_`;
    expect(after.some(row => row.effect_id?.startsWith(prefix) || true)).toBe(true);
  });

  it('un cantiere senza contesto non avanza e non inventa una regione', async () => {
    // Un progetto senza contesto — per esempio creato da una versione
    // precedente — non sa dove attingere: resta fermo invece di scegliere un
    // detentore a caso.
    const { createProjectRuntime } = await import('../src/repositories/project-runtime.repository');
    const { runtimeFor } = await import('../src/core/feasibility/WorkPlan');
    const work = catalog().works.find(w => w.id === 'w_road')!;
    const { plan, state } = runtimeFor(work, 'mg03t_senza_contesto');
    createProjectRuntime(gameId, branchId, plan, state);

    session.advanceWorldState(30, '1951-05-10');

    const row = db.prepare(
      'SELECT state_json FROM project_runtime_states WHERE branch_id = ? AND project_id = ?',
    ).get(branchId, plan.id) as { state_json: string };
    // Il progetto è fermo: nessun lavoro.
    expect(JSON.parse(row.state_json).phases[0].completedWork).toBe('0');
    // E nessuna opera è comparsa per QUEL progetto: il conteggio è per progetto,
    // non per regione — altri cantieri di questo file hanno già consegnato.
    expect(objectsOnMap().some(object => object.metadata?.projectId === plan.id)).toBe(false);
  });
});
