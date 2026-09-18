/**
 * World Story — Games route helpers (Fase 5)
 * ========================================
 * Responder HTTP ed helper condivisi dai controller di gioco.
 */
import { Router } from 'express';
import { shortId } from '../../utils/short-id';
import { gameRepository } from '../../repositories';
import { countryRepository } from '../../repositories/country.repository';
import { getSessionRegistry } from '../../session-registry';
import { SimulationInProgressError, SimulationPausedError, SimulationStaleCheckpointError, GameOverError, type TurnResultRecord, type PausedBatchResult, type CompletedBatchResult } from '../../game-session';
import { IdempotencyConflictError, simulationJobService } from '../../jobs/SimulationJobService';
import { addDays, jumpHorizon } from '../../core/simulation/calendar';
import { addSSEClient, removeSSEClient, broadcastToGame, hasClients } from '../../sse';
import { LLMError, LLMContractError } from '../../llm';
import path from 'path';
import { loadSimulationCatalog } from '../../scenario/loader';
import type { SimulationCatalog } from '../../scenario/types';
import { normalizeOrderIntent } from '../../core/feasibility/intent';
import { FeasibilityService } from '../../core/feasibility/FeasibilityService';
import { AssessmentStore } from '../../core/feasibility/AssessmentStore';
import { createCashflow, FinanceError } from '../../services/FinanceService';
import { createReservation, InsufficientAvailabilityError, ReservationError } from '../../services/ReservationService';
import { ledgerUnitId, bootstrapCatalogEconomy } from '../../services/StrictEffectProducerService';
import { executeMandateEconomy } from '../../services/MandateEconomyService';
import { createMandateRecord, getMandateRemaining, MandateConflictError } from '../../services/MandateService';
import { MandateError } from '../../core/mandates/MandateEngine';
import { MandateDecisionError, acknowledgeMandateDecision, cancelMandateAndResolveDecisions, listOpenMandateDecisions } from '../../services/MandateDecisionService';
import { parseInteger } from '../../domain/quantities';

export const assessmentStore = new AssessmentStore<unknown>();
export const TRADE_ERROR_CODES = [
  'unknown_resource', 'resource_not_held', 'insufficient_stockpile',
  'insufficient_money', 'quantity_invalid', 'trade_mode_invalid', 'trade_unavailable',
];
export const PROCURE_ERROR_CODES = [
  'equipment_unknown', 'equipment_quantity_invalid', 'build_unavailable', 'buy_unavailable', 'procurement_mode_invalid', 'credit_exhausted',
];
/** Errori della formazione di reparti (OP-OBJECTS): dal motore, non dalla UI. */
export const FORMATION_ERROR_CODES = ['formation_blocked', 'credit_exhausted', 'formation_invalid'];
export const DEBT_ERROR_CODES = ['amount_invalid', 'credit_exhausted'];
export function respondDomainError(res: any, e: any, codes: string[], fallback: string): void {
  const message = typeof e?.message === 'string' ? e.message : '';
  const code = codes.find(candidate => message.includes(candidate));
  if (code) {
    res.status(400).json({ error: message || code, code });
    return;
  }
  respondRouteError(res, e, fallback);
}
export function respondRouteError(res: any, e: any, fallback: string): void {
  if (e instanceof LLMError) {
    // I Quick Tunnel sostituiscono i 502 JSON con una pagina HTML generica.
    // 424 conserva il dettaglio del provider per la UI.
    res.status(424).json({ error: `LLM (${e.provider}): ${e.message}` });
  } else if (e instanceof LLMContractError) {
    // Il modello ha risposto, ma fuori contratto (anche dopo il repair):
    // 424 con codice esplicito, mai un turno vuoto presentato come riuscito.
    res.status(424).json({ error: e.message, code: 'llm_contract_error', mechanic: e.mechanic });
  } else if (e instanceof SimulationInProgressError) {
    res.status(409).json({ error: e.message, code: 'simulation_in_progress' });
  } else if (typeof e?.message === 'string' && e.message.includes('snapshot_hash_mismatch')) {
    // F04 §9.4.1: snapshot manomesso o incompatibile — il restore è rifiutato
    // esplicitamente (errore tecnico, mai applicato parzialmente).
    res.status(422).json({ error: e.message, code: 'snapshot_hash_mismatch' });
  } else if (e instanceof SimulationPausedError) {
    // §9.3: un playback in pausa attende una decisione; un nuovo salto è un
    // conflitto esplicito, non un fallimento silenzioso.
    res.status(409).json({ error: e.message, code: 'simulation_paused', simulationId: e.runId });
  } else if (e instanceof SimulationStaleCheckpointError) {
    // G22: il lettore ha cambiato pagina/checkpoint: il vecchio controllo
    // non può interrompere il run successivo.
    res.status(409).json({ error: e.message, code: 'stale_checkpoint', simulationId: e.runId });
  } else if (e instanceof GameOverError) {
    // La nazione è caduta: nessuna azione è più possibile, solo l'epilogo.
    res.status(409).json({ error: e.message, code: 'game_over', ending: e.ending });
  } else if (typeof e?.message === 'string' && e.message.includes('not found')) {
    res.status(404).json({ error: e.message });
  } else {
    res.status(500).json({ error: fallback });
  }
}
export function normalizeAdvisorHistory(raw: any): { role: 'user' | 'assistant'; content: string }[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .filter((m: any) => m && typeof m.content === 'string' && (m.role === 'user' || m.role === 'assistant'))
    .map((m: any) => ({ role: m.role as 'user' | 'assistant', content: m.content as string }));
}
export type EconomyBinding = { session: { getPlayer: () => { polityId?: string } | undefined }; branchId: string; actorId: string; currencyId: string; catalog: SimulationCatalog };
export function bindStrictEconomy(gameId: string, bootstrap = true): EconomyBinding | { error: { status: number; payload: Record<string, unknown> } } {
  if (gameRepository.getEconomyMode(gameId) !== 'strict') {
    return { error: { status: 409, payload: { error: 'Percorso economico disponibile solo in strict', code: 'economy_mode_legacy' } } };
  }
  const game = gameRepository.findById(gameId);
  const templateId = (game?.world as { template_id?: unknown } | undefined)?.template_id;
  if (typeof templateId !== 'string' || !templateId) {
    return { error: { status: 409, payload: { error: 'Binding catalogo mancante', code: 'catalog_binding_missing' } } };
  }
  const loaded = loadSimulationCatalog(path.join(process.cwd(), 'data', 'presets', templateId));
  if (!loaded.catalog) {
    return { error: { status: 422, payload: { error: 'Catalogo server non valido', code: 'catalog_invalid' } } };
  }
  const session = getSessionRegistry().getSessionOrThrow(gameId);
  const player = session.getPlayer();
  const actor = loaded.catalog.actors.find(item => item.polityId === player?.polityId && item.type === 'treasury');
  if (!actor) {
    return { error: { status: 409, payload: { error: 'Identità economica server non disponibile', code: 'actor_binding_missing' } } };
  }
  const treasury = loaded.catalog.initialState.treasuries.find(item => item.actorId === actor.actorId);
  if (!treasury) {
    return { error: { status: 409, payload: { error: 'Conto tesoreria assente dal catalogo', code: 'treasury_binding_missing' } } };
  }
  const branchId = gameRepository.getHeadBranch(gameId);
  if (!branchId) {
    return { error: { status: 409, payload: { error: 'Ramo canonico mancante', code: 'branch_missing' } } };
  }
  // Bootstrap idempotente: le disponibilità esistono già alla prima command.
  // I GET restano read-only (`bootstrap=false`), senza mutazioni nascoste.
  if (bootstrap) bootstrapCatalogEconomy(gameId, branchId, loaded.catalog);
  return { session, branchId, actorId: actor.actorId, currencyId: ledgerUnitId(treasury.currencyId), catalog: loaded.catalog };
}
export function respondEconomyError(res: any, e: unknown): void {
  if (e instanceof FinanceError || e instanceof ReservationError || e instanceof InsufficientAvailabilityError) {
    res.status(422).json({ error: e.message, code: (e as { code?: string }).code ?? 'economy_rejected', canonical: false });
    return;
  }
  respondRouteError(res, e, 'Failed to commit economy command');
}
export function respondMandateError(res: any, e: unknown): void {
  if (e instanceof MandateError || e instanceof MandateConflictError || e instanceof FinanceError || e instanceof MandateDecisionError) {
    res.status(422).json({ error: e.message, code: (e as { code?: string }).code ?? 'mandate_rejected', canonical: false });
    return;
  }
  respondRouteError(res, e, 'Failed to commit mandate command');
}
export function respondLegacyFeasibility(res: any, session: any, text: string): void {
  let costs: any = { timeDays: 0, inputs: [], upkeep: [], basis: 'none' };
  let warnings = ['Partita legacy: la stima viene dal conto nazionale e sarà addebitata all\'esecuzione.'];
  try {
    const estimate = session.estimateOrderCost(text);
    costs = {
      timeDays: estimate.timeDays,
      inputs: [{
        resourceId: 'money',
        name: 'Tesoreria',
        quantity: estimate.amountMld.toFixed(2).replace('.', ','),
        unit: 'mld',
      }],
      upkeep: [],
      basis: 'request',
      note: estimate.basis,
      category: estimate.label,
    };
  } catch (error) {
    warnings = ['Partita legacy: stima del costo non disponibile, l\'ordine resta registrabile.'];
  }
  res.json({
    feasible: true,
    costs,
    prerequisites: [],
    risks: [],
    warnings,
    summary: 'Ordine registrabile (modalità legacy)',
  });
}
export function respondTimeSkipResult(res: any, session: any, result: any, periodStart: string, jumpDays: number): void {
  if (Array.isArray(result)) {
    res.json({
      type: 'actions_processed',
      simulationId: result.at(-1)?.result?.simulationId,
      processedCount: result.length,
      actions: result,
      // F06 µ2: la revisione canonica permette al client di ordinare il delta.
      revision: gameRepository.getWorldRevision(session.id),
    });
    return;
  }
  const pausedResult = result as PausedBatchResult | null;
  if (pausedResult?.paused === true) {
    res.json(pausedResult);
    return;
  }
  // PLAYBACK-INTERMEDIATE-OVER: il salto può chiudersi dentro il playback
  // (budget esaurito, intervento, collasso della nazione). L'esito del playback
  // è già la risposta terminale: stessa forma che il client riceve da
  // `POST /games/:id/simulations/:runId/next`.
  const playbackClose = result as CompletedBatchResult | null;
  if (playbackClose?.type === 'game_over' || playbackClose?.type === 'paused_budget' || playbackClose?.type === 'intervened') {
    res.json(playbackClose);
    return;
  }
  const worldResult = result as TurnResultRecord | null;
  if (!worldResult) {
    res.json({
      type: 'no_event_found',
      simulationId: gameRepository.getLatestSimulationRun(session.id)?.id,
      startDate: periodStart,
      searchedUntil: addDays(periodStart, jumpHorizon(jumpDays)),
    });
    return;
  }
  res.json({
    type: 'world_advanced',
    simulationId: worldResult.simulationId,
    // F06 µ2: la revisione canonica permette al client di ordinare il delta.
    revision: gameRepository.getWorldRevision(session.id),
    result: {
      simulationId: worldResult.simulationId,
      turn: worldResult.turn,
      narration: worldResult.narration,
      events: worldResult.events,
      eventDetails: worldResult.timelineEvents || [],
      periodStart,
      periodEnd: session.getCurrentDate(),
    },
    newDate: session.getCurrentDate(),
    newTurn: session.getCurrentTurn(),
  });
}
export function respondJobFailure(res: any, job: any): void {
  if (job.error_name === 'LLMError') {
    // I Quick Tunnel sostituiscono i 502 JSON con una pagina HTML generica.
    // 424 conserva il dettaglio del provider per la UI.
    res.status(424).json({ error: job.error });
  } else if (job.error_name === 'SimulationInProgressError') {
    res.status(409).json({ error: job.error, code: 'simulation_in_progress' });
  } else if (job.error_name === 'SimulationPausedError') {
    res.status(409).json({ error: job.error, code: 'simulation_paused' });
  } else if (job.error_name === 'GameOverError') {
    // La nazione è caduta: nessun turno può più avanzare.
    res.status(409).json({ error: job.error, code: 'game_over' });
  } else {
    res.status(500).json({ error: job.error || 'job_failed' });
  }
}
