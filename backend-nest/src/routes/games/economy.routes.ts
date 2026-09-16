/**
 * World Story — Games: economy routes (Fase 5)
 * =========================================
 * Economia strict (cashflow, riserve) e mandati.
 */
import { Router } from 'express';
import { shortId } from '../../utils/short-id';
import { gameRepository } from '../../repositories';
import { countryRepository } from '../../repositories/country.repository';
import { getSessionRegistry } from '../../session-registry';
import { SimulationInProgressError, SimulationPausedError, SimulationStaleCheckpointError, GameOverError, type TurnResultRecord, type PausedBatchResult } from '../../game-session';
import { IdempotencyConflictError, simulationJobService } from '../../jobs/SimulationJobService';
import { addDays, jumpHorizon } from '../../core/simulation/calendar';
import { addSSEClient, removeSSEClient, broadcastToGame, hasClients } from '../../sse';
import { LLMError } from '../../llm';
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
import { reconstructOwnedStock } from '../../repositories/ledger.repository';
import { assessMaintenanceObligations } from '../../core/maintenance/MaintenanceObligations';
import {
  TRADE_ERROR_CODES, PROCURE_ERROR_CODES, DEBT_ERROR_CODES,
  respondDomainError, respondRouteError, normalizeAdvisorHistory,
  bindStrictEconomy, respondEconomyError, respondMandateError,
  respondLegacyFeasibility, respondTimeSkipResult, respondJobFailure,
  assessmentStore,
} from './helpers';

export function registerEconomyRoutes(router: Router): void {
router.post('/:id/economy/cashflows', (req, res) => {
  try {
    const bound = bindStrictEconomy(req.params.id);
    if ('error' in bound) { res.status(bound.error.status).json(bound.error.payload); return; }
    const { cashflowId, creditorRef, amount, dueDate, legalPriority, partialAllowed, shortagePolicy } = req.body ?? {};
    if (typeof cashflowId !== 'string' || !cashflowId.trim() || typeof creditorRef !== 'string' || !creditorRef.trim()
      || typeof amount !== 'string' || typeof dueDate !== 'string') {
      res.status(422).json({ error: 'Campi obbligatori mancanti o invalidi', code: 'invalid_economy_command', canonical: false });
      return;
    }
    if (cashflowId.startsWith('mandate_')) {
      // M07 µ2-bis (M-2): il prefisso dei mandati è riservato, il client non
      // può pre-seminare (o dirottare la policy di) obblighi generati da µ2.
      res.status(422).json({ error: 'prefisso mandate_ riservato agli obblighi dei mandati', code: 'reserved_cashflow_id', canonical: false });
      return;
    }
    if (parseInteger(amount, 'amount') <= 0n) {
      res.status(422).json({ error: 'Importo deve essere positivo', code: 'invalid_economy_command', canonical: false });
      return;
    }
    const created = createCashflow(req.params.id, bound.branchId, {
      cashflowId,
      debtor: { ref: bound.actorId, currencyId: bound.currencyId },
      creditor: { ref: creditorRef, currencyId: bound.currencyId },
      amount,
      dueDate,
      legalPriority: typeof legalPriority === 'number' && Number.isInteger(legalPriority) && legalPriority >= 0 ? legalPriority : 0,
      partialAllowed: partialAllowed === true,
      shortagePolicy: shortagePolicy === 'default' ? 'default' : 'arrears',
    });
    res.status(created ? 201 : 200).json({ cashflowId, debtor: bound.actorId, currencyId: bound.currencyId, canonical: true });
  } catch (e) { respondEconomyError(res, e); }
});

/** M06 µ6a (B1): prenotazione monetaria del tesoro bound; shortfall esplicito,
 *  mai clampato (MAT05), e blocco spending se arretrato/default (M02 µ4). */
router.post('/:id/economy/reservations', (req, res) => {
  try {
    const bound = bindStrictEconomy(req.params.id);
    if ('error' in bound) { res.status(bound.error.status).json(bound.error.payload); return; }
    const { reservationId, amount } = req.body ?? {};
    if (typeof reservationId !== 'string' || !reservationId.trim() || typeof amount !== 'string') {
      res.status(422).json({ error: 'Campi obbligatori mancanti o invalidi', code: 'invalid_economy_command', canonical: false });
      return;
    }
    if (parseInteger(amount, 'amount') <= 0n) {
      res.status(422).json({ error: 'Importo deve essere positivo', code: 'invalid_economy_command', canonical: false });
      return;
    }
    const outcome = createReservation(req.params.id, bound.branchId, {
      reservationId,
      target: { kind: 'money', unitId: bound.currencyId, holderRef: bound.actorId },
      amount,
    });
    res.status(outcome.created ? 201 : 200).json({
      reservationId,
      holder: bound.actorId,
      currencyId: bound.currencyId,
      availability: outcome.availability,
      canonical: true,
    });
  } catch (e) { respondEconomyError(res, e); }
});

/** M07 µ2: mandati di delega (MAT31) collegati alla finanza canonica.
 *  Il client propone tetto/periodo/whitelist/fornitori: valuta, tesoro e ramo
 *  sono server-bound; ogni esecuzione cita mandateId e produce un obbligo
 *  datato reale, liquitato dal tick strict. */
router.post('/:id/mandates', (req, res) => {
  try {
    const bound = bindStrictEconomy(req.params.id);
    if ('error' in bound) { res.status(bound.error.status).json(bound.error.payload); return; }
    const { mandateId, title, ceiling, startDate, endDate, whitelist, suppliers, priceLimit, resourceId, minStock, noNewDebt } = req.body ?? {};
    if (typeof mandateId !== 'string' || !mandateId.trim() || typeof title !== 'string' || !title.trim()
      || typeof ceiling !== 'string' || typeof startDate !== 'string' || typeof endDate !== 'string'
      || !Array.isArray(whitelist) || !whitelist.every(item => typeof item === 'string')
      || !Array.isArray(suppliers) || !suppliers.every(item => typeof item === 'string')
      || typeof noNewDebt !== 'boolean') {
      res.status(422).json({ error: 'Campi mandato mancanti o invalidi', code: 'invalid_mandate', canonical: false });
      return;
    }
    if (priceLimit !== undefined && (typeof priceLimit !== 'string' || priceLimit === '')) {
      res.status(422).json({ error: 'priceLimit atteso stringa non vuota', code: 'invalid_mandate', canonical: false });
      return;
    }
    if ((resourceId === undefined) !== (minStock === undefined)
      || (resourceId !== undefined && (typeof resourceId !== 'string' || !resourceId))
      || (minStock !== undefined && (typeof minStock !== 'string' || !minStock))) {
      res.status(422).json({ error: 'resourceId e minStock devono essere dichiarati insieme', code: 'incomplete_stock_guard', canonical: false });
      return;
    }
    if (typeof resourceId === 'string' && !bound.catalog.resources.some(resource => resource.id === resourceId)) {
      res.status(422).json({ error: `Risorsa catalogo sconosciuta: ${resourceId}`, code: 'unknown_resource', canonical: false });
      return;
    }
    const outcome = createMandateRecord(req.params.id, bound.branchId, {
      id: mandateId,
      title,
      currencyId: bound.currencyId,
      ceiling,
      startDate,
      endDate,
      whitelist: whitelist as string[],
      suppliers: suppliers as string[],
      ...(priceLimit !== undefined ? { priceLimit: priceLimit as string } : {}),
      ...(resourceId !== undefined ? { resourceId: resourceId as string, minStock: minStock as string } : {}),
      noNewDebt,
    });
    res.status(outcome.created ? 201 : 200).json({
      mandateId,
      currencyId: bound.currencyId,
      treasury: bound.actorId,
      spent: outcome.mandate.spent,
      canonical: true,
    });
  } catch (e) { respondMandateError(res, e); }
});

router.post('/:id/mandates/:mandateId/executions', (req, res) => {
  try {
    const bound = bindStrictEconomy(req.params.id);
    if ('error' in bound) { res.status(bound.error.status).json(bound.error.payload); return; }
    const { executionId, actionType, supplier, amount, price, quantity, atDate } = req.body ?? {};
    if (typeof executionId !== 'string' || !executionId.trim() || typeof actionType !== 'string' || !actionType.trim()
      || typeof supplier !== 'string' || !supplier.trim() || typeof amount !== 'string' || typeof atDate !== 'string') {
      res.status(422).json({ error: 'Campi esecuzione mancanti o invalidi', code: 'invalid_mandate_execution', canonical: false });
      return;
    }
    const outcome = executeMandateEconomy(req.params.id, bound.branchId, req.params.mandateId, {
      executionId,
      mandateId: req.params.mandateId,
      actionType,
      supplier,
      amount,
      ...(price !== undefined ? { price: price as string } : {}),
      ...(quantity !== undefined ? { quantity: quantity as string } : {}),
      atDate,
    }, { actorId: bound.actorId, currencyId: bound.currencyId });
    res.status(outcome.applied ? 201 : 200).json({
      executionId,
      mandateId: req.params.mandateId,
      applied: outcome.applied,
      cashflowId: outcome.cashflowId,
      spent: outcome.mandate.spent,
      remaining: getMandateRemaining(bound.branchId, req.params.mandateId),
      canonical: true,
    });
  } catch (e) { respondMandateError(res, e); }
});

router.post('/:id/mandates/:mandateId/cancel', (req, res) => {
  try {
    const bound = bindStrictEconomy(req.params.id);
    if ('error' in bound) { res.status(bound.error.status).json(bound.error.payload); return; }
    const state = cancelMandateAndResolveDecisions(req.params.id, bound.branchId, req.params.mandateId);
    res.status(200).json({ mandateId: req.params.mandateId, status: state.status, spent: state.spent, canonical: true });
  } catch (e) { respondMandateError(res, e); }
});

/** M07 µ4: dashboard read-only delle eccezioni aperte/acknowledged. GET non
 *  esegue bootstrap né refresh: le decisioni nascono SOLO al tick strict. */
router.get('/:id/mandates/decisions', (req, res) => {
  try {
    const bound = bindStrictEconomy(req.params.id, false);
    // Read model: nei giochi legacy non esistono mandati strict, quindi la
    // dashboard è legittimamente vuota (non è un errore operativo del client).
    if ('error' in bound) {
      if (bound.error.payload.code === 'economy_mode_legacy') {
        res.status(200).json({ decisions: [], decisionRequired: false, maintenance: [], maintenanceRequired: false, canonical: true });
        return;
      }
      res.status(bound.error.status).json(bound.error.payload);
      return;
    }
    const decisions = listOpenMandateDecisions(req.params.id, bound.branchId);
    // M07 passo 2: obblighi di manutenzione degli impianti posseduti (proiezione
    // read-only; nessuna mutazione, nessuno scadenzario). Priorità per deficit.
    const playerPolityId = bound.session.getPlayer()?.polityId;
    const ownerActorIds = new Set(
      bound.catalog.actors.filter(actor => actor.polityId === playerPolityId).map(actor => actor.actorId),
    );
    const maintenance = assessMaintenanceObligations({
      facilities: bound.catalog.initialState.facilities,
      facilityTypes: bound.catalog.facilityTypes,
      ownerActorIds,
      ownedStock: reconstructOwnedStock(bound.branchId),
    });
    res.status(200).json({
      decisions,
      decisionRequired: decisions.length > 0,
      maintenance,
      maintenanceRequired: maintenance.some(item => !item.sufficient),
      canonical: true,
    });
  } catch (e) { respondMandateError(res, e); }
});

/** L'acknowledgement sopprime solo la ripetizione: non autorizza né acquista. */
router.post('/:id/mandates/:mandateId/decisions/:kind/acknowledge', (req, res) => {
  try {
    const bound = bindStrictEconomy(req.params.id);
    if ('error' in bound) { res.status(bound.error.status).json(bound.error.payload); return; }
    const decision = acknowledgeMandateDecision(req.params.id, bound.branchId, req.params.mandateId, req.params.kind);
    res.status(200).json({ decision, decisionRequired: true, canonical: true });
  } catch (e) { respondMandateError(res, e); }
});
}
