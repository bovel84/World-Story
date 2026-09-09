/**
 * F05 µ1 — job asincroni per il salto temporale.
 *
 * POST accetta il job con 202 senza attendere il provider; la stessa chiave
 * con lo stesso payload restituisce lo stesso job (nessuna seconda generazione
 * pagata); la stessa chiave con payload diverso è un conflitto 409 (C09);
 * un lease scaduto dopo un crash marca il job failed e il run paused_recovery
 * all'ultimo checkpoint, senza rigenerare nulla (C13).
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';

const TEST_DB = path.join(os.tmpdir(), `world-story-jobs-${process.pid}-${Date.now()}.db`);
process.env.OPEN_PAX_DB_PATH = TEST_DB;

let db: any;
let worldRepository: any;
let gameRepository: any;
let gamesRouter: any;
let simulationJobService: any;
let sessionRegistry: any;

const WORLD_ID = 'jobs-world';
const REGION_ID = `${WORLD_ID}-A`;
let blockJump = false;
let releaseJump: (() => void) | null = null;
let jumpCalls = 0;
let eventsPerJump = 1;

/** Stub condiviso: gate sul salto e sul convertitore per le prove di abort. */
const providerStub: any = {
  consolidation: { startRound: 25, chunkSize: 5, keepRawTail: 10 },
  converterGate: false,
  converterBlocked: false,
  onConverterBlocked: null as null | ((signal?: AbortSignal) => Promise<void>),
  async generate(mechanic: string, _system: string, _user: string, options?: any) {
    if (mechanic === 'converter') {
      if (this.converterGate) {
        this.converterBlocked = true;
        if (this.onConverterBlocked) await this.onConverterBlocked(options?.signal);
        this.converterBlocked = false;
      }
      return { content: JSON.stringify({ type: 'action', text: 'ordine' }) };
    }
    return { content: JSON.stringify({ type: 'develop', description: '', priority: 1 }) };
  },
  async stream(mechanic: string, _system: string, _user: string, onToken: (n: number) => void) {
    if (mechanic !== 'jump') throw new Error(`Unexpected streamed mechanic: ${mechanic}`);
    jumpCalls++;
    if (blockJump) await new Promise<void>(resolve => { releaseJump = resolve; });
    const events = eventsPerJump >= 2 ? [
      { headline: 'Evento del percorso 1', description: 'Descrizione.', date: '1951-01-15', mapChanges: [] },
      { headline: 'Evento del percorso 2', description: 'Descrizione.', date: '1951-01-25', mapChanges: [] },
    ] : [
      { headline: 'Evento del percorso', description: 'Descrizione.', date: '1951-01-15', mapChanges: [] },
    ];
    const content = JSON.stringify({
      events,
      narration: 'Fixture', voided: [], startChat: [], relationshipChanges: [],
      worldChanges: { regionOwners: {}, regionColors: {} },
    });
    onToken(content.length);
    return { content };
  },
  clearCache() {},
};
const providerStubRef = providerStub;

function callRoute(method: string, url: string, body?: any, headers: Record<string, string> = {}) {
  return new Promise<any>((resolve, reject) => {
    const pathPart = (url.replace(/^\/games/, '') || '/');
    const req: any = { method, url, params: {}, body: body || {}, get: (name: string) => (headers[name.toLowerCase()] ?? undefined), query: {} };
    const res: any = {
      statusCode: 200,
      body: undefined,
      status(code: number) { this.statusCode = code; return this; },
      set(_name: string, _value: string) { return this; },
      json(payload: any) { this.body = payload; resolve({ status: this.statusCode, body: payload }); return this; },
    };
    const stack = (gamesRouter as any).stack.filter((layer: any) =>
      layer.route && layer.route.methods[method.toLowerCase()]
    );
    for (const layer of stack) {
      const routePath: string = layer.route.path;
      const names = [...routePath.matchAll(/:([^/]+)/g)].map(m => m[1]);
      const pattern = new RegExp('^' + routePath.replace(/:[^/]+/g, '([^/]+)').replace(/\//g, '\\/') + '$');
      const groups = pathPart.match(pattern);
      if (!groups) continue;
      names.forEach((name, index) => { req.params[name] = decodeURIComponent(groups[index + 1]); });
      layer.route.stack[0].handle(req, res, (err: any) => err ? reject(err) : reject(new Error('next() called')));
      return;
    }
    reject(new Error(`Route not found: ${method} ${pathPart}`));
  });
}

async function waitFor(condition: () => boolean, timeoutMs = 3000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!condition()) {
    if (Date.now() > deadline) throw new Error('timeout attesa condizione');
    await new Promise(resolve => setTimeout(resolve, 10));
  }
}

async function waitForJob(gameId: string, jobId: string): Promise<any> {
  const deadline = Date.now() + 3000;
  for (;;) {
    const job = (await callRoute('GET', `/games/${gameId}/simulation-jobs/${jobId}`)).body;
    if (job.status === 'completed' || job.status === 'failed') return job;
    if (Date.now() > deadline) throw new Error(`timeout attesa job ${jobId} (stato: ${job.status})`);
    await new Promise(resolve => setTimeout(resolve, 10));
  }
}

function countJobs(gameId: string, status?: string): number {
  const row = status
    ? db.prepare('SELECT COUNT(*) AS n FROM simulation_jobs WHERE game_id = ? AND status = ?').get(gameId, status)
    : db.prepare('SELECT COUNT(*) AS n FROM simulation_jobs WHERE game_id = ?').get(gameId);
  return Number((row as any).n);
}

beforeAll(async () => {
  const database = await import('../src/database');
  db = database.default;
  database.initDatabase();
  worldRepository = (await import('../src/repositories/world.repository')).worldRepository;
  gameRepository = (await import('../src/repositories/game.repository')).gameRepository;
  gamesRouter = (await import('../src/routes/games.routes')).gamesRouter;
  sessionRegistry = (await import('../src/session-registry'));
  (sessionRegistry as any).initSessionRegistry(providerStub);
  const jobsModule = await import('../src/jobs/SimulationJobService');
  simulationJobService = jobsModule.simulationJobService;

  worldRepository.createWithRegions(
    { id: WORLD_ID, name: 'Jobs fixture', description: '', startDate: '1951-01-01', basePrompt: 'Fixture', historicalAccuracy: 0.8 },
    [{ id: REGION_ID, name: 'A', color: '#123456', owner: 'POL', population: 1_000, gdp: 1, militaryPower: 1, flag: 'A' }],
  );
});

afterAll(() => {
  try {
    db?.close();
    for (const suffix of ['', '-wal', '-shm']) {
      const file = `${TEST_DB}${suffix}`;
      if (fs.existsSync(file)) fs.rmSync(file);
    }
  } catch { /* fixture temporanea */ }
});

describe('F05 µ1 — job asincroni del salto', () => {
  it('POST accetta con 202 mentre il provider è bloccato; il job poi si completa', async () => {
    const session = sharedSession();
    blockJump = true;
    const accepted = await callRoute('POST', `/games/${session.id}/simulation-jobs`, { mode: 'fixed', jump_days: 30 }, { 'idempotency-key': 'job-key-1' });
    // L’accettazione avviene prima che il provider finisca (il gate è chiuso).
    expect(accepted.status).toBe(202);
    expect(accepted.body).toMatchObject({ type: 'job_accepted', status: 'queued' });
    const jobId = accepted.body.jobId;
    expect(jobId).toBeTruthy();

    // Il worker lo prende in carico e resta in esecuzione finché il gate è chiuso.
    await waitFor(() => jumpCalls >= 1);
    const running = await callRoute('GET', `/games/${session.id}/simulation-jobs/${jobId}`);
    expect(running.body).toMatchObject({ id: jobId, status: 'running' });

    releaseJump!();
    let job: any = null;
    const deadline = Date.now() + 3000;
    while (Date.now() < deadline) {
      job = (await callRoute('GET', `/games/${session.id}/simulation-jobs/${jobId}`)).body;
      if (job.status === 'completed') break;
      await new Promise(resolve => setTimeout(resolve, 10));
    }
    expect(job.status).toBe('completed');
    expect(job.runId).toBeTruthy();
    const run = gameRepository.getSimulationRun(session.id, job.runId);
    expect(run?.status).toBe('completed');
    blockJump = false;
  });

  it('stessa chiave e stesso payload → stesso job, nessuna seconda generazione', async () => {
    const session = sharedSession();
    const first = await callRoute('POST', `/games/${session.id}/simulation-jobs`, { mode: 'fixed', jump_days: 30 }, { 'idempotency-key': 'job-key-2' });
    expect(first.status).toBe(202);
    await waitForJob(session.id, first.body.jobId); // il job della chiave è davvero esaurito

    const callsAfter = jumpCalls;
    const replay = await callRoute('POST', `/games/${session.id}/simulation-jobs`, { mode: 'fixed', jump_days: 30 }, { 'idempotency-key': 'job-key-2' });
    expect(replay.status).toBe(200);
    expect(replay.body.replayed).toBe(true);
    expect(replay.body.jobId).toBe(first.body.jobId);
    await new Promise(resolve => setTimeout(resolve, 50));
    expect(jumpCalls).toBe(callsAfter); // nessuna seconda generazione pagata
  });

  it('stessa chiave con payload diverso → 409 idempotency_conflict (C09)', async () => {
    const session = sharedSession();
    const first = await callRoute('POST', `/games/${session.id}/simulation-jobs`, { mode: 'fixed', jump_days: 30 }, { 'idempotency-key': 'job-key-3' });
    await waitForJob(session.id, first.body.jobId); // nessun lavoro in volo prima del conflitto
    const conflict = await callRoute('POST', `/games/${session.id}/simulation-jobs`, { mode: 'fixed', jump_days: 60 }, { 'idempotency-key': 'job-key-3' });
    expect(conflict.status).toBe(409);
    expect(conflict.body.code).toBe('idempotency_conflict');
  });

  it('lease scaduto → job failed e run in paused_recovery, nessuna rigenerazione (C13)', async () => {
    const session = sharedSession();
    // Job rimasto 'running' con lease scaduto (simula crash del worker)…
    const jobId = 'job-crash-1';
    db.prepare(`INSERT INTO simulation_jobs (id, game_id, type, status, payload_json, payload_hash, idempotency_key, lease_owner, lease_expires_at, created_at, updated_at)
      VALUES (?, ?, 'jump', 'running', '{}', 'h', NULL, 'worker-morto', '2000-01-01T00:00:00Z', ?, ?)`)
      .run(jobId, session.id, new Date().toISOString(), new Date().toISOString());
    // …e il run che quel worker aveva aperto.
    gameRepository.createSimulationRun({ id: 'run-crash-1', gameId: session.id, mode: 'fixed', startDate: '1951-01-01' });

    const recovered = simulationJobService.recoverExpiredLeases();
    expect(recovered).toBeGreaterThanOrEqual(1);
    const job = gameRepository.getJob(jobId);
    expect(job.status).toBe('failed');
    expect(job.error).toContain('lease_expired');
    const run = db.prepare('SELECT status FROM simulation_runs WHERE id = ?').get('run-crash-1') as any;
    expect(run.status).toBe('paused_recovery');
    // Nessuna chiamata al provider per «recuperare».
    const callsBefore = jumpCalls;
    await new Promise(resolve => setTimeout(resolve, 50));
    expect(jumpCalls).toBe(callsBefore);
  });
});

/** Una sola partita condivisa: le chiavi di idempotenza sono per partita. */
let cachedSession: any = null;
function sharedSession(): any {
  if (cachedSession) return cachedSession;
  const created = sessionRegistry.getSessionRegistry().createSession(WORLD_ID, 'Player', REGION_ID);
  cachedSession = created.session;
  return cachedSession;
}

/** Partita nuova per i test µ3: nessuna coda ereditata dagli altri test. */
function freshSession(): any {
  const created = sessionRegistry.getSessionRegistry().createSession(WORLD_ID, 'Player', REGION_ID);
  return created.session;
}

describe('F05 µ3 — endpoint legacy delegano al percorso job', () => {
  it('time-skip resta compatibile: stessa risposta, esecuzione via worker', async () => {
    const session = freshSession();
    const skip = await callRoute('POST', `/games/${session.id}/time-skip`, { jump_days: 30 });
    expect(skip.body.type).toBe('world_advanced');
    expect(skip.body.simulationId).toBeTruthy();
    expect(skip.body.newDate).toBe('1951-01-31');
    expect(skip.body.result.periodStart).toBe('1951-01-01');
  });

  it('time-skip: stessa chiave con payload diverso → 409 idempotency_conflict (C09 chiuso)', async () => {
    const session = freshSession();
    const first = await callRoute('POST', `/games/${session.id}/time-skip`, { jump_days: 30 }, { 'idempotency-key': 'ts-key-1' });
    expect(first.status).toBe(200);

    const conflict = await callRoute('POST', `/games/${session.id}/time-skip`, { jump_days: 60 }, { 'idempotency-key': 'ts-key-1' });
    expect(conflict.status).toBe(409);
    expect(conflict.body.code).toBe('idempotency_conflict');

    // Stessa chiave e stesso payload → replay della stessa risposta.
    const replay = await callRoute('POST', `/games/${session.id}/time-skip`, { jump_days: 30 }, { 'idempotency-key': 'ts-key-1' });
    expect(replay.status).toBe(200);
    expect(replay.body.type).toBe('world_advanced');
    expect(replay.body.simulationId).toBe(first.body.simulationId);
  });

  it('time-skip in pausa → 409 simulation_paused, nessun nuovo job', async () => {
    const session = freshSession();
    session.queueAction('direttiva di prova');
    eventsPerJump = 2; // due eventi nel salto → playback in pausa al primo checkpoint
    const skip = await callRoute('POST', `/games/${session.id}/time-skip`, { jump_days: 90 });
    expect(skip.body.type).toBe('awaiting_next');
    const jobsForGame = Number((db.prepare('SELECT COUNT(*) AS n FROM simulation_jobs WHERE game_id = ? AND status = ?').get(session.id, 'running') as any).n);
    expect(jobsForGame).toBe(0); // il job del salto in pausa è completato, non resta appeso

    const conflict = await callRoute('POST', `/games/${session.id}/time-skip`, { jump_days: 30 });
    expect(conflict.status).toBe(409);
    expect(conflict.body.code).toBe('simulation_paused');
    eventsPerJump = 1;
  });

  it('process-all delega al worker e conserva la forma sincrona', async () => {
    const session = freshSession();
    session.queueAction('direttiva del lotto');
    const processed = await callRoute('POST', `/games/${session.id}/actions/process-all`, { jump_days: 30 });
    expect(processed.status).toBe(200);
    expect(processed.body.processedCount).toBe(1);
    expect(processed.body.actions).toHaveLength(1);
    expect(processed.body.simulationId).toBeTruthy();
  });
});

describe('F05 µ2 — arresto controllato, heartbeat, ripresa/chiusura', () => {
  it('lo shutdown abortisce il provider fino al convertitore e segna il job failed', async () => {
    const session = sharedSession();
    session.queueAction('ordine che passa dal convertitore');

    let converterAborted = false;
    providerStubRef.converterGate = true;
    providerStubRef.onConverterBlocked = (signal?: AbortSignal) => new Promise<void>((_resolve, reject) => {
      if (signal) signal.addEventListener('abort', () => { converterAborted = true; reject(new Error('aborted: shutdown')); }, { once: true });
      else setTimeout(() => reject(new Error('nessun segnale di abort passato al convertitore')), 50);
    });

    const submitted = simulationJobService.submit(session.id, 'jump', { mode: 'fixed', jump_days: 30 }, undefined);
    await waitFor(() => providerStubRef.converterBlocked === true);

    await simulationJobService.shutdown();
    expect(converterAborted).toBe(true); // l’abort ha raggiunto l’adattatore del convertitore
    const job = gameRepository.getJob(submitted.id);
    expect(job.status).toBe('failed');
    expect(job.error).toMatch(/abort/i);
    providerStubRef.converterGate = false;
  });

  it('il rinnovo del lease è fenced: solo il proprietario può rinnovare', () => {
    const session = sharedSession();
    const jobId = 'job-heartbeat-1';
    db.prepare(`INSERT INTO simulation_jobs (id, game_id, type, status, payload_json, payload_hash, idempotency_key, lease_owner, lease_expires_at, created_at, updated_at)
      VALUES (?, ?, 'jump', 'running', '{}', 'h', NULL, 'worker-a', '2030-01-01T00:00:00Z', ?, ?)`)
      .run(jobId, session.id, new Date().toISOString(), new Date().toISOString());

    // Un altro worker non può rubare il lease (fencing).
    expect(gameRepository.renewJobLease(jobId, 'worker-b', '2030-01-02T00:00:00Z')).toBe(false);
    // Il proprietario rinnova: la scadenza si estende, il gioco non avanza.
    expect(gameRepository.renewJobLease(jobId, 'worker-a', '2030-01-03T00:00:00Z')).toBe(true);
    const job = gameRepository.getJob(jobId);
    expect(job.lease_expires_at).toBe('2030-01-03T00:00:00Z');
    expect(job.status).toBe('running');
  });

  it('la chiusura del recupero porta il run a interrupted', async () => {
    const session = sharedSession();
    gameRepository.createSimulationRun({ id: 'run-close-1', gameId: session.id, mode: 'fixed', startDate: '1951-01-01' });
    gameRepository.markRunPausedRecovery('run-close-1', 'lease_expired');

    const closed = await callRoute('POST', `/games/${session.id}/simulations/run-close-1/close-recovery`);
    expect(closed.status).toBe(200);
    expect(closed.body).toMatchObject({ type: 'recovery_closed', runId: 'run-close-1', status: 'interrupted' });
    const run = db.prepare('SELECT status FROM simulation_runs WHERE id = ?').get('run-close-1') as any;
    expect(run.status).toBe('interrupted');
  });

  it('la ripresa autorizzata riaccoda il job e genera un nuovo run (mai automatica)', async () => {
    const session = sharedSession();
    // Il servizio riparte come farebbe il processo dopo il crash (µ2: startup).
    simulationJobService.startup();
    // Scenario crash: job failed + run in paused_recovery.
    gameRepository.createSimulationRun({ id: 'run-resume-1', gameId: session.id, mode: 'fixed', startDate: '1951-01-01' });
    gameRepository.markRunPausedRecovery('run-resume-1', 'lease_expired');
    db.prepare(`INSERT INTO simulation_jobs (id, game_id, type, status, payload_json, payload_hash, idempotency_key, run_id, lease_owner, lease_expires_at, created_at, updated_at)
      VALUES ('job-resume-1', ?, 'jump', 'failed', '{"mode":"fixed","jump_days":30}', 'h', NULL, 'run-resume-1', 'worker-morto', '2000-01-01T00:00:00Z', ?, ?)`)
      .run(session.id, new Date().toISOString(), new Date().toISOString());

    const callsBefore = jumpCalls;
    const resumed = await callRoute('POST', `/games/${session.id}/simulations/run-resume-1/resume-recovery`);
    expect(resumed.status).toBe(202);
    expect(resumed.body).toMatchObject({ type: 'job_requeued', jobId: 'job-resume-1' });

    const job = await waitForJob(session.id, 'job-resume-1');
    expect(job.status).toBe('completed');
    expect(job.runId).toBeTruthy();
    expect(job.runId).not.toBe('run-resume-1'); // il run nuovo sostituisce quello interrotto
    expect(jumpCalls).toBeGreaterThan(callsBefore); // ripresa esplicita: una nuova chiamata autorizzata
    const oldRun = db.prepare('SELECT status FROM simulation_runs WHERE id = ?').get('run-resume-1') as any;
    expect(oldRun.status).toBe('interrupted');
  });
});