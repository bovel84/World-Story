/**
 * Q02 µ2 — Protezione single-owner.
 * ================================
 * World Story è un gioco a proprietario unico. Finché non esiste una vera
 * multiutenza, l'esposizione (quick tunnel / Worker Cloudflare) va protetta
 * con un token di proprietario.
 *
 * Regole:
 *  - Se `WORLD_STORY_OWNER_TOKEN` non è configurato la modalità è
 *    `open-single-user`: comportamento invariato (uso locale, nessuna
 *    esposizione ampliata). Nessuna regressione per test e sviluppo.
 *  - Se il token è configurato la modalità è `owner-token`: ogni richiesta
 *    `/api/*` (eccetto `/health` e `/api/health`, necessarie ai probe di
 *    readiness) deve portare `X-Owner-Token: <token>` oppure
 *    `Authorization: Bearer <token>`. In assenza o con token errato si
 *    risponde 403 uniforme PRIMA di qualunque handler: un game ID indovinato
 *    non distingue "non autorizzato" da "inesistente" (niente enumerazione).
 *
 * Il token non viene mai restituito nelle risposte (health compreso).
 */
import crypto from 'node:crypto';
import type { NextFunction, Request, Response } from 'express';

export const OWNER_TOKEN_HEADER = 'x-owner-token';
export const OWNER_TOKEN_ENV = 'WORLD_STORY_OWNER_TOKEN';

export type OwnerAuthMode = 'open-single-user' | 'owner-token';

/** Percorsi sempre raggiungibili anche in modalità `owner-token`. */
const PUBLIC_PATHS = new Set(['/health', '/api/health']);

export function getOwnerToken(env: NodeJS.ProcessEnv = process.env): string | null {
  const raw = (env[OWNER_TOKEN_ENV] ?? '').trim();
  return raw.length > 0 ? raw : null;
}

export function ownerAuthMode(env: NodeJS.ProcessEnv = process.env): OwnerAuthMode {
  return getOwnerToken(env) ? 'owner-token' : 'open-single-user';
}

function equalConstantTime(a: string, b: string): boolean {
  const left = Buffer.from(a, 'utf8');
  const right = Buffer.from(b, 'utf8');
  if (left.length !== right.length) return false;
  return crypto.timingSafeEqual(left, right);
}

/** Estrae il token da header dedicato, `Authorization: Bearer`, o query (SSE). */
export function extractOwnerToken(
  req: Pick<Request, 'headers'> & { query?: Request['query'] },
): string | null {
  const headers = req.headers ?? {};
  const direct = headers[OWNER_TOKEN_HEADER];
  if (typeof direct === 'string' && direct.trim()) return direct.trim();
  const auth = headers.authorization;
  if (typeof auth === 'string' && auth.toLowerCase().startsWith('bearer ')) {
    const value = auth.slice('bearer '.length).trim();
    if (value.length > 0) return value;
  }
  // EventSource non permette header personalizzati: il token può arrivare
  // in query string. Non finisce nei log di accesso del backend.
  const fromQuery = req.query?.owner_token;
  if (typeof fromQuery === 'string' && fromQuery.trim()) return fromQuery.trim();
  return null;
}

export function isOwnerRequest(
  req: Pick<Request, 'headers'> & { query?: Request['query'] },
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  const expected = getOwnerToken(env);
  if (!expected) return true; // modalità locale single-user
  const provided = extractOwnerToken(req);
  return provided !== null && equalConstantTime(provided, expected);
}

export function isPublicPath(pathname: string): boolean {
  return PUBLIC_PATHS.has(pathname);
}

/**
 * Middleware applicativo. Installato in `index.ts` PRIMA dei router: protegge
 * ogni endpoint senza toccare gli stack delle route (i test che invocano gli
 * handler direttamente restano validi).
 */
export function ownerGuard(req: Request, res: Response, next: NextFunction): void {
  if (ownerAuthMode() === 'open-single-user') return next();
  if (!req.path.startsWith('/api/') && req.path !== '/api') return next();
  if (isPublicPath(req.path)) return next();
  if (isOwnerRequest(req)) return next();
  res.status(403).json({
    error: 'Operazione riservata al proprietario dell\u2019istanza',
    code: 'owner_token_required',
  });
}
