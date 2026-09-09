/**
 * World Story — M02 µ2: dominio del ledger (maestro §6.1–6.2, §4.3).
 * ==============================================================
 * - Ogni trasferimento monetario ha origine/destinazione bilanciate nella
 *   STESSA valuta: una riga, un delta > 0 che passa da `fromRef` a `toRef`.
 * - Ogni movimento fisico indica provenienza e destinazione; estrazione,
 *   produzione, consegna, partenza, consumo e perdita sono causali distinte.
 * - Append-only nel ramo: chiave unica (branchId, effectId, entryIndex);
 *   la ripetizione è no-op VERIFICATA, non un secondo pagamento (§6.2).
 * - Ricorsitruzione: saldo(ref) = Σ ingressi − Σ uscite, in IntString.
 * Nessuna I/O qui: il repository applica le stesse funzioni pure.
 */
import {
  IntString,
  QuantityCodecError,
  isIdString,
  parseInteger,
  intToString,
} from './quantities';

export type LedgerKind = 'money' | 'material';

export const MONEY_CAUSES = [
  'incasso', 'pagamento', 'prestito_erogato', 'rimborso', 'interesse', 'trasferimento', 'stanziamento',
] as const;
export const MATERIAL_CAUSES = [
  'estrazione', 'produzione', 'consegna', 'partenza', 'consumo', 'perdita', 'scarto', 'recupero', 'trasferimento',
] as const;

export type MoneyCause = (typeof MONEY_CAUSES)[number];
export type MaterialCause = (typeof MATERIAL_CAUSES)[number];
export type LedgerCause = MoneyCause | MaterialCause;

export interface LedgerEntryInput {
  /** Evento/fase/azione che genera l'effetto (§4.3: chiave unica con branch+index). */
  readonly effectId: string;
  /** Posizione dell'effetto dentro l'evento: un evento può muovere più lotti/conti. */
  readonly entryIndex: number;
  readonly cause: LedgerCause;
  readonly kind: LedgerKind;
  /** Valuta (money) o risorsa (material) del movimento. */
  readonly unitId: string;
  /** Origine: conto/attore/lotto; null solo per creazione dal nulla (estrazione/produzione). */
  readonly fromRef: string | null;
  /** Destinazione: conto/attore/lotto; null solo per uscita (consumo/perdita/scarto). */
  readonly toRef: string | null;
  /** Proprietario economico del materiale. Opzionale per righe legacy senza
   * provenienza; obbligatorio ai producer strict che vogliono renderlo
   * disponibile alle guardie minStock. Mai applicabile al denaro. */
  readonly ownerRef?: string | null;
  /** Quantità MOSSA: intero canonico strettamente positivo (unità minime/base). */
  readonly delta: IntString;
  /** Data del mondo (ISO-8601) in cui il movimento è committato. */
  readonly atDate: string;
}

export class LedgerEntryError extends Error {
  readonly code: string;
  constructor(code: string, message: string) {
    super(message);
    this.name = 'LedgerEntryError';
    this.code = code;
  }
}

export function isMoneyCause(cause: string): cause is MoneyCause {
  return (MONEY_CAUSES as readonly string[]).includes(cause);
}

export function isMaterialCause(cause: string): cause is MaterialCause {
  return (MATERIAL_CAUSES as readonly string[]).includes(cause);
}

const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
function isCanonicalDate(value:string):boolean{if(!ISO_DATE_RE.test(value))return false;const time=Date.parse(`${value}T00:00:00.000Z`);return Number.isFinite(time)&&new Date(time).toISOString().slice(0,10)===value;}

/** Validazione completa di una riga di ledger: rifiuta con percorso e motivo. */
export function validateLedgerEntry(entry: LedgerEntryInput): void {
  if (!entry.effectId || typeof entry.effectId !== 'string') {
    throw new LedgerEntryError('bad_effect', `effectId obbligatorio, ricevuto ${String(entry.effectId)}`);
  }
  if (!Number.isInteger(entry.entryIndex) || entry.entryIndex < 0) {
    throw new LedgerEntryError('bad_index', `entryIndex deve essere un intero ≥ 0, ricevuto ${String(entry.entryIndex)}`);
  }
  if (!isCanonicalDate(entry.atDate)) {
    throw new LedgerEntryError('bad_date', `atDate attesa ISO-8601 YYYY-MM-DD, ricevuto "${entry.atDate}"`);
  }
  if (!isMoneyCause(entry.cause) && !isMaterialCause(entry.cause)) {
    throw new LedgerEntryError('bad_cause', `causale non ammessa: ${String(entry.cause)}`);
  }
  if (entry.kind === 'money' && !isMoneyCause(entry.cause)) {
    throw new LedgerEntryError('bad_cause', `causale ${entry.cause} non ammessa per movimenti monetari`);
  }
  if (entry.kind === 'material' && !isMaterialCause(entry.cause)) {
    throw new LedgerEntryError('bad_cause', `causale ${entry.cause} non ammessa per movimenti fisici`);
  }
  if (!isIdString(entry.unitId)) {
    throw new LedgerEntryError('bad_id', `unitId atteso [a-z0-9_], ricevuto "${String(entry.unitId)}"`);
  }
  if (entry.fromRef !== null && typeof entry.fromRef !== 'string') {
    throw new LedgerEntryError('bad_ref', 'fromRef atteso stringa o null');
  }
  if (entry.toRef !== null && typeof entry.toRef !== 'string') {
    throw new LedgerEntryError('bad_ref', 'toRef atteso stringa o null');
  }
  if (typeof entry.ownerRef !== 'undefined' && entry.ownerRef !== null && (typeof entry.ownerRef !== 'string' || !entry.ownerRef)) {
    throw new LedgerEntryError('bad_owner_ref', 'ownerRef atteso stringa non vuota, null o assente');
  }
  if (entry.kind === 'money' && entry.ownerRef != null) {
    throw new LedgerEntryError('bad_owner_ref', 'ownerRef ammesso solo per movimenti materiali');
  }
  if (entry.fromRef === null && entry.toRef === null) {
    throw new LedgerEntryError('no_endpoint', 'un movimento richiede almeno un endpoint (origine o destinazione)');
  }
  if (entry.fromRef !== null && entry.fromRef === entry.toRef) {
    throw new LedgerEntryError('self_move', 'origine e destinazione coincidono: movimento nullo vietato');
  }
  try {
    const delta = parseInteger(entry.delta, 'delta');
    if (delta <= 0n) throw new LedgerEntryError('bad_delta', `delta deve essere > 0 (la quantità MOSSA), ricevuto ${entry.delta}`);
  } catch (e) {
    if (e instanceof QuantityCodecError) throw new LedgerEntryError(e.code, `delta: ${e.message}`);
    throw e;
  }
}

/** Chiave di saldo: kind + unità + titolare. */
export interface HoldingKey {
  readonly kind: LedgerKind;
  readonly unitId: string;
  readonly ref: string;
}

/**
 * Chiave interna non ambigua: i riferimenti sono opachi e possono contenere
 * `:` (un semplice join/split perderebbe dati nella ricostruzione).
 */
export function holdingKey(kind: LedgerKind, unitId: string, ref: string): string {
  return JSON.stringify([kind, unitId, ref]);
}

export function parseHoldingKey(key: string): HoldingKey {
  const decoded: unknown = JSON.parse(key);
  if (!Array.isArray(decoded) || decoded.length !== 3) throw new LedgerEntryError('bad_holding_key', 'chiave saldo interna non valida');
  const [kind, unitId, ref] = decoded;
  if ((kind !== 'money' && kind !== 'material') || typeof unitId !== 'string' || typeof ref !== 'string') {
    throw new LedgerEntryError('bad_holding_key', 'chiave saldo interna non valida');
  }
  return { kind, unitId, ref };
}

/** Mappa dei saldi: chiave stringa → valore IntString. */
export type BalanceMap = Map<string, IntString>;

/** Applica UN movimento ai saldi: uscita da fromRef, ingresso in toRef. */
export function applyLedgerEntry(balances: BalanceMap, entry: LedgerEntryInput): BalanceMap {
  validateLedgerEntry(entry);
  const delta = parseInteger(entry.delta, 'delta');
  const next = new Map(balances);
  if (entry.fromRef !== null) {
    const k = holdingKey(entry.kind, entry.unitId, entry.fromRef);
    next.set(k, intToString(parseInteger(next.get(k) ?? '0') - delta));
  }
  if (entry.toRef !== null) {
    const k = holdingKey(entry.kind, entry.unitId, entry.toRef);
    next.set(k, intToString(parseInteger(next.get(k) ?? '0') + delta));
  }
  return next;
}

/** Applica una sequenza in ordine: la ricostruzione ripercorre il ledger append-only. */
export function applyLedgerEntries(balances: BalanceMap, entries: readonly LedgerEntryInput[]): BalanceMap {
  let next: BalanceMap = balances;
  for (const entry of entries) {
    next = applyLedgerEntry(next, entry);
  }
  return next;
}