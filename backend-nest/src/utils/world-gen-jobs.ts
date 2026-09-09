/**
 * World Story — World Generation Jobs
 * ================================
 * Registro in-memory dei job di generazione del mondo.
 *
 * Perché esiste: la generazione completa (BalanceAgent su ~200+ paesi) dura
 * diversi minuti. Non può restare sincrona dentro una richiesta HTTP perché
 * Cloudflare Tunnel (trycloudflare.com) interrompe le risposte oltre ~100s
 * con un errore 524.
 *
 * Flusso:
 *   1. POST /worlds/generate  → crea il job, lancia il lavoro in background
 *      e risponde IMMEDIATAMENTE con { jobId } (HTTP 202).
 *   2. GET  /worlds/jobs/:jobId → il client interroga lo stato/progresso;
 *      allo stato "completed" il campo `result` contiene lo stesso payload
 *      della vecchia risposta sincrona.
 */

import { shortId } from './short-id';

export type WorldGenJobStatus = 'queued' | 'running' | 'completed' | 'failed';

export interface WorldGenJobProgress {
  /** Paesi già completati */
  done: number;
  /** Paesi totali da generare */
  total: number;
  /** Descrizione della fase corrente (per il loader) */
  stage: string;
}

export interface WorldGenJob {
  id: string;
  status: WorldGenJobStatus;
  createdAt: number;
  updatedAt: number;
  progress: WorldGenJobProgress;
  /** Presente solo allo stato "completed": payload identico alla vecchia API sincrona. */
  result?: unknown;
  /** Presente solo allo stato "failed". */
  error?: string;
}

const jobs = new Map<string, WorldGenJob>();

/** I job completati restano recuperabili per 1 ora, poi vengono ripuliti. */
const JOB_TTL_MS = 60 * 60 * 1000;
/** Tetto massimo di job in memoria (protezione da leak). */
const JOB_MAX = 100;

function prune(): void {
  const now = Date.now();
  for (const [id, job] of jobs) {
    if (now - job.createdAt > JOB_TTL_MS) jobs.delete(id);
  }
  while (jobs.size > JOB_MAX) {
    const oldest = jobs.keys().next().value;
    if (oldest === undefined) break;
    jobs.delete(oldest);
  }
}

export function createWorldGenJob(): WorldGenJob {
  prune();
  const now = Date.now();
  const job: WorldGenJob = {
    id: shortId(),
    status: 'queued',
    createdAt: now,
    updatedAt: now,
    progress: { done: 0, total: 0, stage: 'In coda…' },
  };
  jobs.set(job.id, job);
  return job;
}

export function getWorldGenJob(id: string): WorldGenJob | undefined {
  return jobs.get(id);
}

/** Aggiorna i campi di un job (id/createdAt non modificabili). */
export function updateWorldGenJob(
  id: string,
  patch: Partial<Omit<WorldGenJob, 'id' | 'createdAt'>>,
): void {
  const job = jobs.get(id);
  if (!job) return;
  Object.assign(job, patch, { updatedAt: Date.now() });
}

/** Scrittura comoda del progresso (marca il job come "running"). */
export function setWorldGenProgress(id: string, done: number, total: number, stage: string): void {
  updateWorldGenJob(id, {
    status: 'running',
    progress: { done, total, stage },
  });
}