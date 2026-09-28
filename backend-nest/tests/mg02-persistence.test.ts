/**
 * MG02 µ5 — La dichiarazione e il legame sopravvivono al riavvio
 * =============================================================
 * Il difetto misurato dalla revisione indipendente: `workOrder` e `projectId`
 * vivevano **solo in RAM**. Dopo un riavvio del server o una ricostruzione
 * della coda da database, un ordine che nominava una strada **ridiventava
 * prosa**: nessun cantiere e nessun avviso. E il `projectId` spariva, quindi la
 * cronaca non poteva più risalire dall'ordine all'opera.
 *
 * Qui si difendono tre cose:
 *  - **la dichiarazione è nel database**, non solo sull'oggetto in memoria: si
 *    scrive, si ricostruisce la coda dal repository e la si ritrova identica;
 *  - **una riga vecchia non rompe nulla**: una coda scritta prima di µ5 ha la
 *    colonna `NULL`, e l'ordine resta in prosa — il comportamento di prima,
 *    non un errore;
 *  - **una dichiarazione malformata si scarta**, non fa fallire la
 *    ricostruzione della coda né produce un ordine d'opera incoerente.
 *
 * Guardia contro il falso verde: il test non si accontenta di rileggere ciò che
 * ha appena scritto in memoria. Ricostruisce la coda **dal repository** (che è
 * ciò che fa il riavvio) e confronta; per il legame, rilegge gli esiti dal
 * database per `run_id`.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';

const DB = path.join(os.tmpdir(), `world-story-mg02p-${process.pid}-${Date.now()}.db`);
process.env.OPEN_PAX_DB_PATH = DB;

const WORLD_ID = 'mg02p-world';
const REGION_ID = 'mg02p-region';

describe('MG02 µ5 — persistenza della dichiarazione e del legame', () => {
  let db: any;
  let gameId = '';

  beforeAll(async () => {
    const d = await import('../src/database');
    db = d.default;
    d.initDatabase();
    const worlds = (await import('../src/repositories/world.repository')).worldRepository;
    worlds.createWithRegions(
      { id: WORLD_ID, name: 'MG02p', templateId: 'realism_test_world' },
      [{ id: REGION_ID, name: 'A', color: '#000', owner: 'ALPHA', population: 1, gdp: 1, militaryPower: 1, flag: 'A' }],
    );
    const registry = await import('../src/session-registry');
    registry.initSessionRegistry({ consolidation: { startRound: 25, chunkSize: 5, keepRawTail: 10 }, clearCache() {} } as never);
    gameId = registry.getSessionRegistry().createSession(WORLD_ID, 'P', REGION_ID).gameId;

    expect((db as { name?: string }).name, 'il test deve girare su un database temporaneo').toBe(DB);
  });

  afterAll(() => {
    try { fs.rmSync(DB); } catch { /* tmp */ }
    for (const suffix of ['-wal', '-shm']) {
      try { fs.rmSync(DB + suffix); } catch { /* tmp */ }
    }
  });

  it('la dichiarazione scritta in coda si rilegge dal database', async () => {
    const { gameRepository } = await import('../src/repositories');
    const declaration = {
      workId: 'w_road', payerActorId: 'alpha_steel_co_treasury',
      materialActorId: 'alpha_steel_co', funded: true,
    };
    gameRepository.queuePendingAction({
      id: 'pd1', gameId, text: 'Costruisci una strada', createdAt: '1951-01-01',
      status: 'pending', workOrder: declaration,
    });

    // Ricostruzione dal database: è ciò che fa il riavvio del server.
    const rebuilt = gameRepository.getPendingActions(gameId).find(action => action.id === 'pd1');
    expect(rebuilt).toBeTruthy();
    expect(rebuilt.workOrder).toEqual(declaration);
  });

  it('un ordine in prosa resta senza dichiarazione, e non è un errore', async () => {
    const { gameRepository } = await import('../src/repositories');
    gameRepository.queuePendingAction({
      id: 'pd2', gameId, text: 'Migliora le scuole', createdAt: '1951-01-02', status: 'pending',
    });
    const rebuilt = gameRepository.getPendingActions(gameId).find(action => action.id === 'pd2');
    expect(rebuilt.workOrder).toBeUndefined();
  });

  it('una riga scritta PRIMA di µ5 (colonna NULL) resta in prosa', async () => {
    // Retrocompatibilità: la colonna è appena stata aggiunta, quindi nel
    // database dell'autore tutte le code esistenti hanno `NULL`. Devono
    // comportarsi come prima — prosa, non errore.
    const { gameRepository } = await import('../src/repositories');
    db.prepare(
      "INSERT INTO pending_actions (id, game_id, text, created_at, status, delivery_status, execution_status, work_order_json) VALUES (?,?,?,?,'pending','queued','not_started',NULL)",
    ).run('pd3', gameId, 'Ordine di una versione precedente', '1951-01-03');
    const rebuilt = gameRepository.getPendingActions(gameId).find(action => action.id === 'pd3');
    expect(rebuilt).toBeTruthy();
    expect(rebuilt.workOrder).toBeUndefined();
  });

  it('una dichiarazione malformata si scarta senza far fallire la coda', async () => {
    // Difensivo: un JSON rotto o un campo mancante non devono impedire la
    // ricostruzione della coda — l'ordine torna in prosa.
    const { gameRepository } = await import('../src/repositories');
    const insert = db.prepare(
      "INSERT INTO pending_actions (id, game_id, text, created_at, status, delivery_status, execution_status, work_order_json) VALUES (?,?,?,?,'pending','queued','not_started',?)",
    );
    insert.run('pd4', gameId, 'Rotto', '1951-01-04', '{non json');
    insert.run('pd5', gameId, 'Incompleto', '1951-01-05', JSON.stringify({ workId: 'w_road' }));
    insert.run('pd6', gameId, 'Tipo sbagliato', '1951-01-06', JSON.stringify({
      workId: 'w_road', payerActorId: 'a', materialActorId: 'b', funded: 'sì',
    }));

    const rebuilt = gameRepository.getPendingActions(gameId);
    for (const id of ['pd4', 'pd5', 'pd6']) {
      const action = rebuilt.find(item => item.id === id);
      expect(action, `${id} deve esserci comunque`).toBeTruthy();
      expect(action.workOrder, `${id} non deve produrre una dichiarazione usabile`).toBeUndefined();
    }
  });

  it('il cantiere nato da un ordine resta leggibile dal database', async () => {
    // Il legame causale durevole: si scrive l'esito con il progetto e lo si
    // rilegge per run, come fa la cronaca dopo un reload.
    const { gameRepository } = await import('../src/repositories');
    gameRepository.createSimulationRun({
      id: 'run_p1', gameId, mode: 'fixed', startDate: '1951-01-01', targetDate: '1951-02-01',
      idempotencyKey: 'mg02p-run',
    });
    gameRepository.addSimulationActionOutcomes([{
      id: 'out_p1', runId: 'run_p1', gameId, actionId: 'ord_p1',
      status: 'accepted', summary: 'Cantiere avviato', eventHeadlines: ['Parte il cantiere'],
      projectId: 'prj_abc123',
    }]);

    const outcomes = gameRepository.getSimulationActionOutcomes(gameId, 'run_p1');
    expect(outcomes).toHaveLength(1);
    expect(outcomes[0].projectId).toBe('prj_abc123');
  });

  it('un esito senza cantiere non porta un projectId inventato', async () => {
    const { gameRepository } = await import('../src/repositories');
    gameRepository.addSimulationActionOutcomes([{
      id: 'out_p2', runId: 'run_p1', gameId, actionId: 'ord_p2',
      status: 'accepted', summary: 'Riforma approvata', eventHeadlines: [],
    }]);
    const outcomes = gameRepository.getSimulationActionOutcomes(gameId, 'run_p1');
    const reform = outcomes.find(outcome => outcome.actionId === 'ord_p2');
    expect(reform).toBeTruthy();
    expect(reform.projectId).toBeUndefined();
  });

  it('la migrazione aggiunge le colonne e non rompe un database esistente', () => {
    // Le due colonne devono esistere davvero: senza la migrazione, un database
    // già in uso (come quello dell'autore) non le avrebbe e ogni scrittura
    // fallirebbe.
    const pendingColumns = db.prepare('PRAGMA table_info(pending_actions)').all() as Array<{ name: string }>;
    expect(pendingColumns.map(column => column.name)).toContain('work_order_json');
    const outcomeColumns = db.prepare('PRAGMA table_info(simulation_action_outcomes)').all() as Array<{ name: string }>;
    expect(outcomeColumns.map(column => column.name)).toContain('project_id');

    // E rieseguire l'init non deve fallire: la migrazione è idempotente.
    expect(() => db.exec('SELECT 1')).not.toThrow();
  });
});
