/**
 * World Story — Validazione delle richieste HTTP (Fase 6)
 * =======================================================
 * Livello unico per la validazione dei body in ingresso: gli schemi Zod
 * vivono in `./games/schemas.ts`, qui c'è solo l'adattatore verso Express.
 *
 * Il contratto è deliberatamente semplice e sincrono:
 *  - in caso di successo restituisce i dati normalizzati (o `null`);
 *  - in caso di errore risponde `400 { error, code: 'invalid_body', issues }`
 *    e restituisce `null`, così l'handler fa `if (!validateBody(...)) return;`.
 *
 * La validazione avviene DENTRO l'handler (e non come middleware) per non
 * cambiare la catena di `router.stack`: i test che invocano direttamente gli
 * handler continuano a vedere un solo livello, e nessun `next()` implicito.
 */
import type { Response } from 'express';
import type { ZodType } from 'zod';

export function validateBody<T>(res: Response, schema: ZodType<T>, raw: unknown): T | null {
  const parsed = schema.safeParse(raw ?? {});
  if (!parsed.success) {
    res.status(400).json({
      error: 'Corpo della richiesta non valido',
      code: 'invalid_body',
      issues: parsed.error.issues.map(issue => ({
        path: issue.path.join('.'),
        message: issue.message,
      })),
    });
    return null;
  }
  return parsed.data;
}
