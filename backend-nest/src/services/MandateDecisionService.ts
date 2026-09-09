/**
 * World Story — M07 µ4: decisioni persistenti per scorte minime.
 * ============================================================
 * Questo servizio è chiamato SOLO dal tick strict. Confronta il minimo di un
 * mandato con le giacenze ledger possedute dagli attori della polity giocante
 * (refs ottenuti dal catalogo server), apre/aggiorna una sola decisione per
 * deficit e non esegue mai acquisti: mancano quantità e quotazioni verificate.
 */
import db, { withCanonicalTransaction } from '../database';
import { intToString, parseInteger, type IntString } from '../domain/quantities';
import { reconstructOwnedStock } from '../repositories/ledger.repository';
import { assessMandateMinimumStock, type MandateStockDecisionKind } from '../core/mandates/MandateStockEngine';
import { cancelMandateRecordForGame, listActiveMandateRecords } from './MandateService';

export type MandateDecisionStatus = 'open' | 'acknowledged' | 'resolved';

export interface MandateDecisionRecord {
  readonly mandateId: string;
  readonly kind: MandateStockDecisionKind;
  readonly resourceId: string;
  readonly minStock: IntString;
  readonly availableStock: IntString;
  readonly shortfall: IntString;
  readonly asOfDate: string;
  readonly status: MandateDecisionStatus;
}

export class MandateDecisionError extends Error {
  readonly code: string;
  constructor(code: string, message: string) {
    super(message);
    this.name = 'MandateDecisionError';
    this.code = code;
  }
}

interface DecisionRow {
  game_id: string;
  branch_id: string;
  mandate_id: string;
  decision_kind: MandateStockDecisionKind;
  resource_id: string;
  min_stock: IntString;
  available_stock: IntString;
  shortfall: IntString;
  as_of_date: string;
  status: MandateDecisionStatus;
}

const KINDS: readonly MandateStockDecisionKind[] = ['stock_shortfall_authorized', 'stock_shortfall_outside_authorization'];

function assertKind(kind: string): asserts kind is MandateStockDecisionKind {
  if (!KINDS.includes(kind as MandateStockDecisionKind)) throw new MandateDecisionError('bad_kind', `tipo decisione mandato non ammesso: ${kind}`);
}

function toRecord(row: DecisionRow): MandateDecisionRecord {
  return {
    mandateId: row.mandate_id,
    kind: row.decision_kind,
    resourceId: row.resource_id,
    minStock: row.min_stock,
    availableStock: row.available_stock,
    shortfall: row.shortfall,
    asOfDate: row.as_of_date,
    status: row.status,
  };
}

function ownedStock(branchId: string, ownerRefs: ReadonlySet<string>, resourceId: string): IntString {
  let total = 0n;
  for (const item of reconstructOwnedStock(branchId)) {
    if (ownerRefs.has(item.owner) && item.resourceId === resourceId) total += parseInteger(item.quantity, 'ledger.ownedStock');
  }
  return intToString(total);
}

function findDecision(gameId: string, branchId: string, mandateId: string, kind: MandateStockDecisionKind): DecisionRow | null {
  const row = db.prepare(`SELECT game_id,branch_id,mandate_id,decision_kind,resource_id,min_stock,available_stock,shortfall,as_of_date,status
    FROM mandate_decisions WHERE game_id=? AND branch_id=? AND mandate_id=? AND decision_kind=?`)
    .get(gameId, branchId, mandateId, kind) as DecisionRow | undefined;
  return row ?? null;
}

function findDecisionForMandate(gameId: string, branchId: string, mandateId: string): DecisionRow | null {
  const row = db.prepare(`SELECT game_id,branch_id,mandate_id,decision_kind,resource_id,min_stock,available_stock,shortfall,as_of_date,status
    FROM mandate_decisions WHERE game_id=? AND branch_id=? AND mandate_id=?`)
    .get(gameId, branchId, mandateId) as DecisionRow | undefined;
  return row ?? null;
}

function upsertShortfall(
  gameId: string,
  branchId: string,
  value: Extract<ReturnType<typeof assessMandateMinimumStock>, { status: 'decision_required' }>,
  asOfDate: string,
): { readonly record: MandateDecisionRecord; readonly opened: boolean } {
  const existing = findDecision(gameId, branchId, value.mandateId, value.kind) ?? findDecisionForMandate(gameId, branchId, value.mandateId);
  if (!existing) {
    db.prepare(`INSERT INTO mandate_decisions(game_id,branch_id,mandate_id,decision_kind,resource_id,min_stock,available_stock,shortfall,as_of_date,status)
      VALUES(?,?,?,?,?,?,?,?,?,'open')`)
      .run(gameId, branchId, value.mandateId, value.kind, value.resourceId, value.minStock, value.availableStock, value.shortfall, asOfDate);
    const inserted = findDecision(gameId, branchId, value.mandateId, value.kind);
    if (!inserted) throw new MandateDecisionError('write_failed', `decisione mandato non creata: ${value.mandateId}`);
    return { record: toRecord(inserted), opened: true };
  }
  const nextStatus: MandateDecisionStatus = existing.status === 'resolved' ? 'open' : existing.status;
  db.prepare(`UPDATE mandate_decisions SET decision_kind=?,resource_id=?,min_stock=?,available_stock=?,shortfall=?,as_of_date=?,status=?
    WHERE game_id=? AND branch_id=? AND mandate_id=?`)
    .run(value.kind, value.resourceId, value.minStock, value.availableStock, value.shortfall, asOfDate, nextStatus, gameId, branchId, value.mandateId);
  const updated = findDecision(gameId, branchId, value.mandateId, value.kind);
  if (!updated) throw new MandateDecisionError('write_failed', `decisione mandato non aggiornata: ${value.mandateId}`);
  return { record: toRecord(updated), opened: existing.status === 'resolved' };
}

function resolveForMandate(gameId: string, branchId: string, mandateId: string): void {
  db.prepare(`UPDATE mandate_decisions SET status='resolved' WHERE game_id=? AND branch_id=? AND mandate_id=? AND status<>'resolved'`)
    .run(gameId, branchId, mandateId);
}

/** Valutazione tick-only. Restituisce SOLO decisioni appena aperte/ria­perte,
 * così una scorta già nota non genera decine di notifiche contabili. */
export function refreshMandateStockDecisions(
  gameId: string,
  branchId: string,
  asOfDate: string,
  ownerActorRefs: readonly string[],
): readonly MandateDecisionRecord[] {
  const owners = new Set(ownerActorRefs.filter((value) => typeof value === 'string' && value.length > 0));
  return withCanonicalTransaction(() => {
    const activeMandates = listActiveMandateRecords(gameId, branchId);
    const stockMandates = activeMandates.filter(mandate =>
      typeof mandate.definition.resourceId !== 'undefined' || typeof mandate.definition.minStock !== 'undefined');
    // Un gioco strict senza mandate minStock non necessita un binding owner:
    // altrimenti M07 cambierebbe il comportamento M06 di tick senza mandati.
    if (stockMandates.length > 0 && owners.size === 0) {
      throw new MandateDecisionError('owner_binding_missing', 'nessun attore catalogo per la polity del giocatore');
    }
    // Un annullamento è una decisione del giocatore: chiude le eccezioni
    // residue. Le scadenze restano invece visibili finché il giocatore non
    // rinnova/annulla esplicitamente il mandato.
    db.prepare(`UPDATE mandate_decisions SET status='resolved' WHERE game_id=? AND branch_id=? AND status<>'resolved'
      AND mandate_id IN (SELECT mandate_id FROM mandates WHERE game_id=? AND branch_id=? AND status<>'active')`)
      .run(gameId, branchId, gameId, branchId);

    const opened: MandateDecisionRecord[] = [];
    for (const mandate of stockMandates) {
      const resourceId = mandate.definition.resourceId;
      const available = typeof resourceId === 'undefined' ? '0' : ownedStock(branchId, owners, resourceId);
      const assessment = assessMandateMinimumStock(mandate.definition, mandate.state, asOfDate, available);
      if (assessment.status === 'decision_required') {
        const outcome = upsertShortfall(gameId, branchId, assessment, asOfDate);
        if (outcome.opened) opened.push(outcome.record);
      } else if (assessment.status === 'sufficient') {
        resolveForMandate(gameId, branchId, mandate.definition.id);
      }
    }
    return opened;
  });
}

/** Dashboard eccezioni: il giocatore vede solo decisioni non risolte. */
export function listOpenMandateDecisions(gameId: string, branchId: string): readonly MandateDecisionRecord[] {
  const rows = db.prepare(`SELECT game_id,branch_id,mandate_id,decision_kind,resource_id,min_stock,available_stock,shortfall,as_of_date,status
    FROM mandate_decisions WHERE game_id=? AND branch_id=? AND status<>'resolved'
    ORDER BY mandate_id,decision_kind`)
    .all(gameId, branchId) as DecisionRow[];
  return rows.map(toRecord);
}

/** Cancellazione gameplay atomica: status mandato e decisione residua cambiano
 * insieme; GET/ack non possono osservare una richiesta ancora aperta. */
export function cancelMandateAndResolveDecisions(gameId: string, branchId: string, mandateId: string) {
  return withCanonicalTransaction(() => {
    const state = cancelMandateRecordForGame(gameId, branchId, mandateId);
    resolveForMandate(gameId, branchId, mandateId);
    return state;
  });
}

/** Acknowledgement non è un acquisto né un consenso implicito: nasconde la
 * ripetizione, ma la decisione rimane visibile e nessuna risorsa è mutata. */
export function acknowledgeMandateDecision(
  gameId: string,
  branchId: string,
  mandateId: string,
  kind: string,
): MandateDecisionRecord {
  assertKind(kind);
  return withCanonicalTransaction(() => {
    const current = findDecision(gameId, branchId, mandateId, kind);
    if (!current) throw new MandateDecisionError('not_found', `decisione mandato non trovata: ${mandateId}/${kind}`);
    if (current.status === 'resolved') throw new MandateDecisionError('not_open', `decisione mandato già risolta: ${mandateId}/${kind}`);
    if (current.status === 'open') {
      db.prepare(`UPDATE mandate_decisions SET status='acknowledged' WHERE game_id=? AND branch_id=? AND mandate_id=? AND decision_kind=?`)
        .run(gameId, branchId, mandateId, kind);
    }
    const updated = findDecision(gameId, branchId, mandateId, kind);
    if (!updated) throw new MandateDecisionError('write_failed', `decisione mandato non aggiornata: ${mandateId}/${kind}`);
    return toRecord(updated);
  });
}