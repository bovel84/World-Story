/**
 * WS-MINISTER-UX-05 — La memoria del ministro sul client (tappa intermedia)
 * ========================================================================
 * La fase chiede una memoria **persistente**, separata dai numeri del mondo. La
 * persistenza server-side (tabella + repository + passaggio da `GameSession`) è
 * bloccata dal freeze: l'innesto preciso è nel report `WS-MINISTER-UX-05-report.md`.
 *
 * Qui vive la **tappa intermedia dichiarata**: gli stessi ricordi del contratto
 * puro del backend, derivati dagli **eventi espliciti** della seduta (una
 * proposta confrontata, un atto accodato, una seduta chiusa senza ordine),
 * persistiti nel browser per partita e per sedia, e composti in un blocco di
 * prompt che la chat invia al ministro. Sopravvive a chiusura della seduta,
 * cambio ministro, ricarica del browser e riavvio del server; **non** è la
 * memoria definitiva, che resta l'innesto backend.
 *
 * Regole, le stesse del backend: nessuna cifra nuova; ogni ricordo ha una
 * provenienza; al rewind si potano i ricordi oltre la data corrente.
 *
 * Modulo **puro** per la parte di logica (derivazione, selezione, potatura,
 * prompt); la persistenza `localStorage` è confinata in `loadMemory`/`saveMemory`.
 */

export type MinisterMemoryKind =
  | 'objective'
  | 'proposal-discussed'
  | 'proposal-rejected'
  | 'open-question'
  | 'queued-decision'
  | 'verified-outcome';

export type MinisterMemoryState =
  | 'open' | 'discussed' | 'rejected' | 'queued' | 'executed' | 'verified';

export interface MinisterMemoryRef {
  readonly messageId?: string;
  readonly orderId?: string;
  readonly actId?: string;
  readonly gameDate: string;
  readonly turn?: number;
}

export interface MinisterMemoryRecord {
  readonly id: string;
  readonly kind: MinisterMemoryKind;
  readonly summary: string;
  readonly reason?: string;
  readonly state: MinisterMemoryState;
  readonly refs: MinisterMemoryRef;
}

/** I ricordi per sedia di una partita. */
export type MinisterMemoryStore = Record<string, MinisterMemoryRecord[]>;

export const MINISTER_MEMORY_LIMIT = 40;

const KIND_PRIORITY: Record<MinisterMemoryKind, number> = {
  'proposal-rejected': 0,
  'queued-decision': 1,
  'verified-outcome': 2,
  'open-question': 3,
  objective: 4,
  'proposal-discussed': 5,
};

export const KIND_LABEL: Record<MinisterMemoryKind, string> = {
  objective: 'obiettivo',
  'proposal-discussed': 'discussa',
  'proposal-rejected': 'respinta',
  'open-question': 'aperta',
  'queued-decision': 'accodata',
  'verified-outcome': 'verificata',
};

export const STATE_LABEL: Record<MinisterMemoryState, string> = {
  open: 'aperta',
  discussed: 'discussa',
  rejected: 'respinta',
  queued: 'accodata',
  executed: 'eseguita',
  verified: 'verificato',
};

function isValid(record: MinisterMemoryRecord): boolean {
  return Boolean(record.id && record.summary.trim() && record.refs && typeof record.refs.gameDate === 'string');
}

function pruneToLimit(records: readonly MinisterMemoryRecord[]): MinisterMemoryRecord[] {
  if (records.length <= MINISTER_MEMORY_LIMIT) return [...records];
  const indexed = records.map((record, index) => ({ record, index }));
  indexed.sort((a, b) => {
    const byKind = KIND_PRIORITY[a.record.kind] - KIND_PRIORITY[b.record.kind];
    return byKind !== 0 ? byKind : b.index - a.index;
  });
  const kept = new Set(indexed.slice(0, MINISTER_MEMORY_LIMIT).map(entry => entry.record.id));
  return records.filter(record => kept.has(record.id));
}

/** Registra o aggiorna un ricordo (stesso `id` ⇒ aggiornamento, mai duplicato). */
export function recordMemory(
  records: readonly MinisterMemoryRecord[],
  input: MinisterMemoryRecord,
): MinisterMemoryRecord[] {
  if (!isValid(input)) return [...records];
  const next = records.some(record => record.id === input.id)
    ? records.map(record => (record.id === input.id ? input : record))
    : [...records, input];
  return pruneToLimit(next);
}

/** I ricordi pertinenti: prima i più vincolanti, a parità i più recenti. */
export function relevantMemory(records: readonly MinisterMemoryRecord[], limit = 8): MinisterMemoryRecord[] {
  const indexed = records.map((record, index) => ({ record, index }));
  indexed.sort((a, b) => {
    const byKind = KIND_PRIORITY[a.record.kind] - KIND_PRIORITY[b.record.kind];
    return byKind !== 0 ? byKind : b.index - a.index;
  });
  return indexed.slice(0, limit).map(entry => entry.record);
}

/** Al riwind si potano i ricordi oltre la data corrente: nessun futuro nel passato. */
export function pruneMemoryByDate(
  records: readonly MinisterMemoryRecord[],
  currentDate: string | null,
): MinisterMemoryRecord[] {
  if (!currentDate) return [...records];
  return records.filter(record => !record.refs.gameDate || record.refs.gameDate <= currentDate);
}

/** La sintesi breve che finisce nel prompt, con il confine dichiarato. */
export function memorySection(records: readonly MinisterMemoryRecord[], limit = 8): string {
  const selected = relevantMemory(records, limit);
  if (selected.length === 0) return '';
  const lines: string[] = [
    'MEMORIA DELLA SEDUTA (non è una seconda contabilità: non contiene cifre nuove; se un ricordo',
    'contrasta con i fatti aggiornati, vincono i fatti aggiornati):',
  ];
  for (const record of selected) {
    const reason = record.kind === 'proposal-rejected' && record.reason ? ` — motivo: ${record.reason}` : '';
    lines.push(`- [${KIND_LABEL[record.kind]} · ${STATE_LABEL[record.state]}] ${record.summary}${reason} (${refLabel(record.refs)})`);
  }
  lines.push('Usa la memoria per non ripeterti e per ricordare gli impegni già presi: non è una richiesta nuova.');
  return lines.join('\n');
}

function refLabel(refs: MinisterMemoryRef): string {
  const parts: string[] = [];
  if (refs.messageId) parts.push(`messaggio ${refs.messageId}`);
  if (refs.orderId) parts.push(`ordine ${refs.orderId}`);
  if (refs.gameDate) parts.push(refs.gameDate);
  return parts.join(', ') || 'senza data';
}

/** Un id stabile e leggibile dal contenuto: lo stesso evento non si duplica. */
function slug(text: string): string {
  return text.normalize('NFKD').replace(/[^\p{L}\p{N}]+/gu, '-').replace(/^-+|-+$/g, '').toLowerCase().slice(0, 48);
}

/** Una proposta messa sul tavolo nel confronto. */
export function discussedProposal(
  seat: string,
  road: { id: string; title: string },
  ref: MinisterMemoryRef,
): MinisterMemoryRecord {
  return {
    id: `${seat}:proposta:${road.id}`,
    kind: 'proposal-discussed',
    summary: `Proposta discussa: ${road.title}`,
    state: 'discussed',
    refs: ref,
  };
}

/** Un atto accodato: è una decisione, non più una proposta. */
export function queuedDecision(seat: string, text: string, ref: MinisterMemoryRef): MinisterMemoryRecord {
  return {
    id: `${seat}:atto:${slug(text) || 'ordine'}`,
    kind: 'queued-decision',
    summary: `Atto accodato: ${text}`,
    state: 'queued',
    refs: ref,
  };
}

/** Una seduta chiusa senza ordine: la questione resta aperta. */
export function openQuestion(seat: string, summary: string, ref: MinisterMemoryRef): MinisterMemoryRecord {
  return {
    id: `${seat}:aperta:${slug(summary) || 'questione'}`,
    kind: 'open-question',
    summary,
    state: 'open',
    refs: ref,
  };
}

// ── Persistenza (tappa intermedia, confinata) ────────────────────────────────

const STORAGE_PREFIX = 'ws:minister-memory:';

function storageOrNull(): Storage | null {
  try {
    return typeof localStorage === 'undefined' ? null : localStorage;
  } catch {
    return null;
  }
}

/** Carica la memoria della partita; uno storage rotto non rompe la seduta. */
export function loadMemory(gameId: string, storage: Storage | null = storageOrNull()): MinisterMemoryStore {
  if (!storage) return {};
  try {
    const raw = storage.getItem(`${STORAGE_PREFIX}${gameId}`);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' ? parsed as MinisterMemoryStore : {};
  } catch {
    return {};
  }
}

/** Salva la memoria della partita; un errore di quota non è fatale. */
export function saveMemory(
  gameId: string,
  store: MinisterMemoryStore,
  storage: Storage | null = storageOrNull(),
): void {
  if (!storage) return;
  try {
    storage.setItem(`${STORAGE_PREFIX}${gameId}`, JSON.stringify(store));
  } catch {
    /* memoria solo in RAM: la seduta continua */
  }
}

/** Aggiorna i ricordi di una sedia dentro lo store, senza mutare l'originale. */
export function withSeatRecords(
  store: MinisterMemoryStore,
  seat: string,
  records: readonly MinisterMemoryRecord[],
): MinisterMemoryStore {
  return { ...store, [seat]: [...records] };
}

/** Ricordi di una sedia, potati alla data corrente. */
export function seatRecords(
  store: MinisterMemoryStore,
  seat: string,
  currentDate: string | null,
): MinisterMemoryRecord[] {
  return pruneMemoryByDate(store[seat] ?? [], currentDate);
}
