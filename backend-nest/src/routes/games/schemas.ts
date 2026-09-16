/**
 * World Story — Schemi Zod dei body delle route games (Fase 6)
 * ===========================================================
 * Gli schemi descrivono solo i campi che un handler legge: `.passthrough()`
 * lascia passare campi aggiuntivi, così i client vecchi e i test esistenti
 * non vengono rotti. I vincoli di merito (tetti, whitelist, valuta, importi)
 * restano affidati al motore: qui si valida la *forma* della richiesta.
 */
import { z } from 'zod';

const nonEmpty = z.string().trim().min(1);

/** `POST /api/games` — creazione partita. */
export const createGameSchema = z
  .object({
    worldId: nonEmpty.optional(),
    world_id: nonEmpty.optional(),
    playerName: z.string().optional(),
    player_name: z.string().optional(),
    playerRegionId: nonEmpty.optional(),
    player_region_id: nonEmpty.optional(),
    playerColor: z.string().optional(),
    player_color: z.string().optional(),
    difficulty: z.string().optional(),
  })
  .passthrough()
  .refine(value => Boolean(value.worldId || value.world_id), {
    message: 'worldId (o world_id) è obbligatorio',
    path: ['worldId'],
  })
  .refine(value => Boolean(value.playerRegionId || value.player_region_id), {
    message: 'playerRegionId (o player_region_id) è obbligatorio',
    path: ['playerRegionId'],
  });

/** `POST /:id/actions/evaluate` — intent canonico del preflight. */
export const evaluateActionSchema = z
  .object({ intent: z.unknown() })
  .passthrough()
  .refine(value => value.intent !== undefined && value.intent !== null, {
    message: 'intent è obbligatorio',
    path: ['intent'],
  });

/** `POST /:id/actions/queue` — testo dell'ordine da accodare. */
export const queueActionSchema = z.object({ text: nonEmpty }).passthrough();

/** `POST /:id/actions/check-feasibility` e `POST /:id/action` / `enhance`. */
export const actionTextSchema = z.object({ text: z.string().optional() }).passthrough();

/** `POST /:id/actions/process` e `/:id/actions/process-all`. */
export const processActionSchema = z.object({ jump_days: z.number().optional() }).passthrough();

/** `POST /:id/advisor` e `/:id/advisor/stream` — dialogo del consigliere. */
export const advisorSchema = z
  .object({
    message: z.string().optional(),
    history: z.array(z.unknown()).optional(),
  })
  .passthrough();

/** `POST /:id/save` — nome opzionale del salvataggio. */
export const saveSchema = z.object({ name: z.string().optional() }).passthrough();

/** `POST /:id/time-skip` e `POST /:id/simulation-jobs` — salto temporale. */
export const timeSkipSchema = z
  .object({
    mode: z.enum(['next_event', 'fixed']).optional(),
    jump_days: z.number().optional(),
    idempotencyKey: z.string().max(128).optional(),
  })
  .passthrough();

/** `POST /:id/intervene` — ancora del checkpoint su cui interrompere. */
export const interveneSchema = z
  .object({
    simulationId: z.string().optional(),
    simulation_id: z.string().optional(),
    eventId: z.string().optional(),
    event_id: z.string().optional(),
    revision: z.number().int().optional(),
  })
  .passthrough();
