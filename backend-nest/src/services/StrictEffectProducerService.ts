/** M06 µ5d — producer applicativi server per progetto e spedizione. */
import db, { withCanonicalTransaction } from '../database';
import { parseInteger, isIdString } from '../domain/quantities';
import { validateLedgerEntry, type LedgerEntryInput } from '../domain/ledger';
import { departShipment, deliverShipment, type Shipment, type ShipmentTransition } from '../core/economy/TransitEngine';
import { appendLedgerEntries, listLedgerEntries, reconstructBalances } from '../repositories/ledger.repository';
import type { SimulationCatalog } from '../scenario/types';
import { consumeStagedProjectTick, stageProjectTick } from '../repositories/project-runtime.repository';
import {
  assertCanonicalEffectAnchor,
  consumeStagedLedgerEffect,
  consumeStagedShipmentEffect,
  stageLedgerEffect,
  stageShipmentEffect,
  StrictEffectStagingError,
} from '../repositories/strict-effect-staging.repository';

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
function isCanonicalDate(value:string):boolean{if(!ISO_DATE.test(value))return false;const time=Date.parse(`${value}T00:00:00.000Z`);return Number.isFinite(time)&&new Date(time).toISOString().slice(0,10)===value;}

function assertHeadBranch(gameId: string, branchId: string): void {
  const row = db.prepare(`
    SELECT g.head_branch_id, b.game_id AS branch_game_id
    FROM games g LEFT JOIN game_branches b ON b.id = ? WHERE g.id = ?
  `).get(branchId, gameId) as { head_branch_id: string | null; branch_game_id: string | null } | undefined;
  if (!row || row.head_branch_id !== branchId || row.branch_game_id !== gameId) {
    throw new StrictEffectStagingError('BAD_BRANCH_FENCE', 'ramo non head o non appartenente alla partita');
  }
}

function validateShipment(shipment: Shipment): void {
  if (!shipment.id || !shipment.resourceId || !shipment.originRef || !shipment.destinationRef || !shipment.ownerRef || !shipment.carrierRef) {
    throw new StrictEffectStagingError('BAD_SHIPMENT_RUNTIME', 'shipment incompleto');
  }
  if (!isCanonicalDate(shipment.departureDate) || !isCanonicalDate(shipment.arrivalDate) || shipment.arrivalDate < shipment.departureDate) {
    throw new StrictEffectStagingError('BAD_SHIPMENT_RUNTIME', 'date shipment non valide');
  }
  if (parseInteger(shipment.quantity, 'shipment.quantity') <= 0n) {
    throw new StrictEffectStagingError('BAD_SHIPMENT_RUNTIME', 'quantità shipment non positiva');
  }
}

/** Movimento già autorizzato dal server; endpoint/importo non arrivano dalla LLM. */
export function scheduleVerifiedLedgerEffect(gameId: string, branchId: string, entry: LedgerEntryInput): boolean {
  assertHeadBranch(gameId, branchId);
  validateLedgerEntry(entry);
  return withCanonicalTransaction(() => {
    const json = JSON.stringify(entry);
    const old = db.prepare('SELECT game_id,entry_json,due_date FROM strict_ledger_schedule WHERE branch_id=? AND effect_id=?')
      .get(branchId, entry.effectId) as { game_id: string; entry_json: string; due_date: string } | undefined;
    if (old) {
      if (old.game_id !== gameId || old.entry_json !== json || old.due_date !== entry.atDate) {
        throw new StrictEffectStagingError('LEDGER_SCHEDULE_CONFLICT', 'movimento ledger già schedulato con contenuto diverso');
      }
      return false;
    }
    db.prepare('INSERT INTO strict_ledger_schedule (game_id,branch_id,effect_id,entry_json,due_date) VALUES (?,?,?,?,?)')
      .run(gameId, branchId, entry.effectId, json, entry.atDate);
    return true;
  });
}

/** Lavoro già misurato dal server; il client/LLM non chiama questo contratto. */
export function scheduleVerifiedProjectWork(
  gameId: string,
  branchId: string,
  input: { effectId: string; projectId: string; phaseId: string; workDone: string; dueDate: string },
): boolean {
  assertHeadBranch(gameId, branchId);
  if (!input.effectId || !input.projectId || !input.phaseId || !isCanonicalDate(input.dueDate) || parseInteger(input.workDone, 'workDone') <= 0n) {
    throw new StrictEffectStagingError('BAD_PROJECT_WORK', 'lavoro progetto verificato non valido');
  }
  return withCanonicalTransaction(() => {
    const project = db.prepare('SELECT game_id FROM project_runtime_states WHERE branch_id = ? AND project_id = ?')
      .get(branchId, input.projectId) as { game_id: string } | undefined;
    if (!project || project.game_id !== gameId) throw new StrictEffectStagingError('MISSING_PROJECT_RUNTIME', 'progetto runtime non trovato');
    const old = db.prepare('SELECT * FROM project_work_schedule WHERE branch_id = ? AND effect_id = ?')
      .get(branchId, input.effectId) as Record<string, unknown> | undefined;
    const expected = [gameId, branchId, input.effectId, input.projectId, input.phaseId, input.workDone, input.dueDate];
    if (old) {
      const actual = [old.game_id, old.branch_id, old.effect_id, old.project_id, old.phase_id, old.work_done, old.due_date];
      if (JSON.stringify(actual) !== JSON.stringify(expected)) throw new StrictEffectStagingError('PROJECT_WORK_CONFLICT', 'lavoro già schedulato con contenuto diverso');
      return false;
    }
    db.prepare(`INSERT INTO project_work_schedule
      (game_id,branch_id,effect_id,project_id,phase_id,work_done,due_date) VALUES (?,?,?,?,?,?,?)`)
      .run(...expected);
    return true;
  });
}

/** Shipment già autorizzato dal server con rotta, date e vettore espliciti. */
export function createShipmentRuntime(gameId: string, branchId: string, shipment: Shipment, transportAuthorized: boolean): boolean {
  assertHeadBranch(gameId, branchId);
  validateShipment(shipment);
  if (shipment.status !== 'planned') throw new StrictEffectStagingError('BAD_SHIPMENT_RUNTIME', 'nuovo shipment deve essere planned');
  return withCanonicalTransaction(() => {
    const json = JSON.stringify(shipment);
    const old = db.prepare('SELECT game_id,shipment_json,transport_authorized FROM shipment_runtime_states WHERE branch_id=? AND shipment_id=?')
      .get(branchId, shipment.id) as { game_id: string; shipment_json: string; transport_authorized: number } | undefined;
    if (old) {
      if (old.game_id !== gameId || old.shipment_json !== json || old.transport_authorized !== Number(transportAuthorized)) {
        throw new StrictEffectStagingError('SHIPMENT_RUNTIME_CONFLICT', 'shipment runtime già presente con contenuto diverso');
      }
      return false;
    }
    db.prepare(`INSERT INTO shipment_runtime_states
      (game_id,branch_id,shipment_id,shipment_json,transport_authorized) VALUES (?,?,?,?,?)`)
      .run(gameId, branchId, shipment.id, json, Number(transportAuthorized));
    return true;
  });
}

function movementEntries(effectId: string, shipment: Shipment, transition: ShipmentTransition, atDate: string): LedgerEntryInput[] {
  return transition.movements.map((movement, entryIndex) => ({
    effectId,
    entryIndex,
    cause: movement.cause,
    kind: 'material',
    unitId: movement.resourceId,
    fromRef: movement.fromRef,
    toRef: movement.toRef,
    ownerRef: shipment.ownerRef,
    delta: movement.quantity,
    atDate,
  }));
}

function stock(branchId: string, shipment: Shipment): string {
  return reconstructBalances(branchId).stock.find(item =>
    item.holder === shipment.originRef && item.resourceId === shipment.resourceId)?.quantity ?? '0';
}

/** M06 µ6a (B1): i cataloghi dichiarano valute/risorse case-insensitive; il
 *  ledger canonicalizza in minuscolo (codec §4.1). Punto unico di mapping. */
export function ledgerUnitId(catalogId: string): string {
  const normalized = catalogId.toLowerCase();
  if (!isIdString(normalized)) throw new StrictEffectStagingError('BAD_CATALOG_UNIT', `id catalogo non canonicalizzabile: ${catalogId}`);
  return normalized;
}

/** M06 µ6a (B1): il bootstrap materializza lo stato iniziale del catalogo nel
 *  ledger del ramo (stanziamenti tesorerie, estrazioni lotti), datato alla
 *  startDate del manifest (lo stato iniziale esiste alla nascita del mondo:
 *  data STABILE tra batch, senza conflitti di idempotenza). */
export function bootstrapCatalogEconomy(gameId: string, branchId: string, catalog: SimulationCatalog): number {
  assertHeadBranch(gameId, branchId);
  const atDate = catalog.manifest.startDate;
  if (!isCanonicalDate(atDate)) throw new StrictEffectStagingError('BAD_EFFECT_DATE', 'manifest.startDate non canonica');
  const entries: LedgerEntryInput[] = [];
  for (const treasury of catalog.initialState.treasuries) {
    entries.push({ effectId: 'catalog:bootstrap', entryIndex: entries.length, cause: 'stanziamento', kind: 'money', unitId: ledgerUnitId(treasury.currencyId), fromRef: null, toRef: treasury.actorId, delta: treasury.balanceMinorUnits, atDate });
  }
  for (const lot of catalog.initialState.inventory) {
    entries.push({ effectId: 'catalog:bootstrap', entryIndex: entries.length, cause: 'estrazione', kind: 'material', unitId: ledgerUnitId(lot.quantity.resourceId), fromRef: null, toRef: lot.ownerActorId, ownerRef: lot.ownerActorId, delta: lot.quantity.baseUnits, atDate });
  }
  if (!entries.length) return 0;
  // Rami creati prima di M07 µ4b hanno bootstrap senza ownerRef. Non
  // riscriviamo l'append-only né attribuiamo proprietà retroattiva: se il
  // bootstrap è completo lo accettiamo come provenienza ignota (minStock
  // prudenzialmente non lo conta); se è parziale falliamo chiuso.
  const oldBootstrap = listLedgerEntries(branchId).filter(entry => entry.effectId === 'catalog:bootstrap');
  if (oldBootstrap.length > 0) {
    if (oldBootstrap.length !== entries.length) throw new StrictEffectStagingError('BOOTSTRAP_INCOMPLETE', 'bootstrap catalogo legacy incompleto');
    const materialBootstrap = oldBootstrap.filter(entry => entry.kind === 'material');
    const fullyLegacyOwnerless = materialBootstrap.length > 0
      && materialBootstrap.every(entry => typeof entry.ownerRef === 'undefined');
    if (fullyLegacyOwnerless) {
      const sameIgnoringLegacyOwner = oldBootstrap.every((entry) => {
        const expected = entries.find(candidate => candidate.entryIndex === entry.entryIndex);
        return expected !== undefined
          && entry.cause === expected.cause && entry.kind === expected.kind && entry.unitId === expected.unitId
          && entry.fromRef === expected.fromRef && entry.toRef === expected.toRef
          && entry.delta === expected.delta && entry.atDate === expected.atDate;
      });
      if (!sameIgnoringLegacyOwner) throw new StrictEffectStagingError('BOOTSTRAP_CONFLICT', 'bootstrap catalogo legacy divergente');
      return 0;
    }
  }
  return appendLedgerEntries(gameId, branchId, entries).appended;
}

/** Chiamato dal TurnOrchestrator dentro la transazione del checkpoint. */
export function applyDueCanonicalEffects(gameId: string, branchId: string, anchorRevision: number, asOfDate: string): void {
  assertCanonicalEffectAnchor(gameId, branchId, anchorRevision);
  if (!isCanonicalDate(asOfDate)) throw new StrictEffectStagingError('BAD_EFFECT_DATE', 'data tick non valida');
  withCanonicalTransaction(() => {
    const ledgerRows = db.prepare(`SELECT effect_id,entry_json FROM strict_ledger_schedule
      WHERE game_id=? AND branch_id=? AND due_date<=? AND status='scheduled' ORDER BY due_date,effect_id`)
      .all(gameId, branchId, asOfDate) as Array<{ effect_id: string; entry_json: string }>;
    for (const item of ledgerRows) {
      let value: unknown;
      try { value = JSON.parse(item.entry_json) as unknown; }
      catch { throw new StrictEffectStagingError('BAD_LEDGER_SCHEDULE', 'ledger schedule JSON non valido'); }
      if (!value || typeof value !== 'object' || Array.isArray(value)) throw new StrictEffectStagingError('BAD_LEDGER_SCHEDULE', 'ledger schedule malformato');
      const entry = value as LedgerEntryInput;
      validateLedgerEntry(entry);
      if (entry.effectId !== item.effect_id) throw new StrictEffectStagingError('BAD_LEDGER_SCHEDULE', 'effectId ledger divergente');
      stageLedgerEffect(gameId, branchId, anchorRevision, entry);
      consumeStagedLedgerEffect(gameId, branchId, anchorRevision, entry.effectId);
      db.prepare("UPDATE strict_ledger_schedule SET status='applied' WHERE branch_id=? AND effect_id=? AND status='scheduled'")
        .run(branchId, entry.effectId);
    }

    const work = db.prepare(`SELECT effect_id,project_id,phase_id,work_done FROM project_work_schedule
      WHERE game_id=? AND branch_id=? AND due_date<=? AND status='scheduled' ORDER BY due_date,effect_id`)
      .all(gameId, branchId, asOfDate) as Array<{ effect_id: string; project_id: string; phase_id: string; work_done: string }>;
    for (const item of work) {
      stageProjectTick(gameId, branchId, anchorRevision, item.effect_id, item.project_id, item.phase_id, item.work_done);
      consumeStagedProjectTick(gameId, branchId, anchorRevision, item.effect_id);
      db.prepare("UPDATE project_work_schedule SET status='applied' WHERE branch_id=? AND effect_id=? AND status='scheduled'")
        .run(branchId, item.effect_id);
    }

    const rows = db.prepare('SELECT shipment_json,transport_authorized FROM shipment_runtime_states WHERE game_id=? AND branch_id=? ORDER BY shipment_id')
      .all(gameId, branchId) as Array<{ shipment_json: string; transport_authorized: number }>;
    for (const row of rows) {
      let shipment = JSON.parse(row.shipment_json) as Shipment;
      validateShipment(shipment);
      if ((shipment.status === 'planned' || shipment.status === 'blocked') && shipment.departureDate <= asOfDate) {
        const transition = departShipment(shipment, asOfDate, stock(branchId, shipment), row.transport_authorized === 1);
        shipment = transition.shipment;
        if (transition.movements.length) {
          const effectId = `shipment:${shipment.id}:departure`;
          stageShipmentEffect(gameId, branchId, anchorRevision, effectId, movementEntries(effectId, shipment, transition, shipment.departureDate));
          consumeStagedShipmentEffect(gameId, branchId, anchorRevision, effectId);
        }
      }
      if (shipment.status === 'in_transit' && shipment.arrivalDate <= asOfDate) {
        const transition = deliverShipment(shipment, asOfDate);
        shipment = transition.shipment;
        if (transition.movements.length) {
          const effectId = `shipment:${shipment.id}:delivery`;
          stageShipmentEffect(gameId, branchId, anchorRevision, effectId, movementEntries(effectId, shipment, transition, shipment.arrivalDate));
          consumeStagedShipmentEffect(gameId, branchId, anchorRevision, effectId);
        }
      }
      db.prepare('UPDATE shipment_runtime_states SET shipment_json=?,version=version+1 WHERE game_id=? AND branch_id=? AND shipment_id=?')
        .run(JSON.stringify(shipment), gameId, branchId, shipment.id);
    }
  });
}
