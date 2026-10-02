/**
 * WS-MINISTER-UX-05 — La memoria del ministro sul client
 * =====================================================
 * La fase chiede una memoria **persistente**, separata dai numeri del mondo. La
 * persistenza server-side (tabella + repository + agganci in `GameSession` e
 * `game.repository`) è **eseguita** (innesto autorizzato; vedi
 * `WS-MINISTER-UX-05-report.md` §6).
 *
 * Qui vive la **rete del client**: gli stessi ricordi del contratto puro del
 * backend, derivati dagli **eventi espliciti** della seduta (una proposta
 * confrontata, un atto accodato, una seduta chiusa senza ordine), tenuti nel
 * browser per partita e per sedia e **inviati con la richiesta** al ministro
 * (campo `memory`), dove il server li valida, ne deriva il mandato e li persiste.
 * Sopravvivono a chiusura della seduta, cambio ministro e ricarica del browser;
 * la copia autorevole è quella server-side, per partita, ramo e mandato.
 *
 * Regole, le stesse del backend: nessuna cifra nuova; ogni ricordo ha una
 * provenienza; al rewind si potano i ricordi oltre la data corrente.
 *
 * Modulo **puro** per la parte di logica (derivazione, selezione, potatura,
 * prompt); la persistenza `localStorage` è confinata in `loadMemory`/`saveMemory`.
 *
 * WS-GOVUX-P6 — La memoria del Consiglio, quattro regole in più:
 *  - le quattro **famiglie** (decisione confermata / preferenza dichiarata /
 *    questione aperta / ipotesi esplorata) sono **derivate** dal genere, non un
 *    nuovo campo (compatibile coi vecchi salvataggi);
 *  - la **revoca conserva la storia**: il ricordo resta, marcato `revoked`, e
 *    non riemerge nel retrieval;
 *  - il tempo del ricordo è il **turno di gioco**, non l'istante in cui è
 *    scritto (il timestamp tecnico è solo del database);
 *  - lo scope resta la **partita** (game + ramo + mandato).
 */

export type MinisterMemoryKind =
  | 'objective'
  | 'proposal-discussed'
  | 'proposal-rejected'
  | 'open-question'
  | 'queued-decision'
  | 'verified-outcome';

export type MinisterMemoryState =
  | 'open' | 'discussed' | 'rejected' | 'queued' | 'executed' | 'verified' | 'revoked';
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

/**
 * WS-MINISTER-UX-08 (4) — Lo scope del client, come quello del server:
 * **partita + ramo + mandato**. Il solo `gameId` faceva riemergere ricordi di
 * altri rami e di governi diversi. Il mandato è l'identità del governo (polity
 * + fazione dominante), la stessa che il server ricava da sé (`mandateFor`).
 */
export interface MinisterMemoryScope {
  readonly gameId: string;
  readonly branchId: string | null;
  readonly mandate: string;
}

/**
 * L'identità del mandato sul client, gemella di quella server-side
 * (`MinisterMemory.mandateFor`): polity + fazione dominante. Il motore non
 * modella una legislatura; quando la dominante cambia, il mandato cambia e la
 * memoria non si mescola fra governi diversi.
 */
export function clientMandate(
  government: { dominantId?: string | null } | null | undefined,
  polityId: string | null | undefined,
): string {
  return `${polityId ?? 'unknown'}:${government?.dominantId ?? 'council'}`;
}

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
  revoked: 'revocata',
};

/**
 * WS-GOVUX-P6 — Le **quattro famiglie** della memoria del Consiglio, come le
 * nomina la roadmap: decisione confermata, preferenza dichiarata, questione
 * aperta, ipotesi esplorata. È una classificazione **derivata** dal genere del
 * ricordo (nessun nuovo campo, nessuna migrazione): le sei voci esistenti
 * restano la granularità, le quattro famiglie sono la lettura che il giocatore e
 * il prompt usano per non confondere ciò che è deciso da ciò che è solo pensato.
 */
export type MinisterMemoryFamily =
  | 'confirmed-decision'   // un atto accodato o un esito verificato
  | 'declared-preference'  // un obiettivo/preferenza esplicitato dal Presidente
  | 'open-question'        // una questione rimasta senza decisione
  | 'explored-hypothesis'; // una proposta discussa o respinta

export const FAMILY_LABEL: Record<MinisterMemoryFamily, string> = {
  'confirmed-decision': 'decisione confermata',
  'declared-preference': 'preferenza dichiarata',
  'open-question': 'questione aperta',
  'explored-hypothesis': 'ipotesi esplorata',
};

/** La famiglia di un ricordo: una sola funzione, così la lettura non diverge. */
export function memoryFamily(record: Pick<MinisterMemoryRecord, 'kind'>): MinisterMemoryFamily {
  switch (record.kind) {
    case 'queued-decision':
    case 'verified-outcome':
      return 'confirmed-decision';
    case 'objective':
      return 'declared-preference';
    case 'open-question':
      return 'open-question';
    case 'proposal-discussed':
    case 'proposal-rejected':
    default:
      return 'explored-hypothesis';
  }
}

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

/** I ricordi pertinenti: prima i più vincolanti, a parità i più recenti. I
 * ricordi **revocati** restano nello storico ma non riemergono (P6). */
export function relevantMemory(records: readonly MinisterMemoryRecord[], limit = 8): MinisterMemoryRecord[] {
  const active = records.filter(record => record.state !== 'revoked');
  const indexed = active.map((record, index) => ({ record, index }));
  indexed.sort((a, b) => {
    const byKind = KIND_PRIORITY[a.record.kind] - KIND_PRIORITY[b.record.kind];
    return byKind !== 0 ? byKind : b.index - a.index;
  });
  return indexed.slice(0, limit).map(entry => entry.record);
}

/** I ricordi revocati: la storia resta, non sparisce (P6). */
export function revokedMemory(records: readonly MinisterMemoryRecord[]): MinisterMemoryRecord[] {
  return records.filter(record => record.state === 'revoked');
}

/**
 * WS-GOVUX-P6 — Revocare una memoria: **non** la cancella, la marca revocata e
 * conserva il motivo precedente accanto a quello della revoca. Il ricordo esce
 * dal retrieval (`relevantMemory` lo salta) ma resta nello storico della sedia.
 */
export function revokeMemory(
  records: readonly MinisterMemoryRecord[],
  id: string,
  note?: string,
): MinisterMemoryRecord[] {
  const marker = note && note.trim() ? `revocata: ${note.trim()}` : 'revocata dal Presidente';
  return records.map(record => {
    if (record.id !== id || record.state === 'revoked') return record;
    return {
      ...record,
      state: 'revoked' as const,
      reason: record.reason ? `${record.reason} · ${marker}` : marker,
    };
  });
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
  // WS-GOVUX-P6 — Il tempo del ricordo è il turno del mondo (e la data), non
  // l'istante tecnico in cui è stato scritto.
  if (refs.turn != null) parts.push(`turno ${refs.turn}`);
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

/**
 * WS-GOVUX-P6 — Una **preferenza dichiarata**: il Presidente indica la strada
 * che preferisce, senza averla ancora decisa. È una famiglia distinta dalla
 * decisione (l'atto accodato) e dall'ipotesi (la proposta solo discussa).
 */
export function declaredPreference(seat: string, text: string, ref: MinisterMemoryRef): MinisterMemoryRecord {
  return {
    id: `${seat}:preferenza:${slug(text) || 'preferenza'}`,
    kind: 'objective',
    summary: `Preferenza dichiarata: ${text}`,
    state: 'open',
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

/** La chiave dello scope: partita + ramo + mandato (parti vuote dichiarate). */
export function memoryScopeKey(scope: MinisterMemoryScope): string {
  return [scope.gameId || 'no-game', scope.branchId || 'no-branch', scope.mandate || 'no-mandate'].join('::');
}

function storageOrNull(): Storage | null {
  try {
    return typeof localStorage === 'undefined' ? null : localStorage;
  } catch {
    return null;
  }
}

/** Carica la memoria dello scope; uno storage rotto non rompe la seduta. */
export function loadMemory(scope: MinisterMemoryScope, storage: Storage | null = storageOrNull()): MinisterMemoryStore {
  if (!storage) return {};
  try {
    const raw = storage.getItem(`${STORAGE_PREFIX}${memoryScopeKey(scope)}`);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' ? parsed as MinisterMemoryStore : {};
  } catch {
    return {};
  }
}

/** Salva la memoria dello scope; un errore di quota non è fatale. */
export function saveMemory(
  scope: MinisterMemoryScope,
  store: MinisterMemoryStore,
  storage: Storage | null = storageOrNull(),
): void {
  if (!storage) return;
  try {
    storage.setItem(`${STORAGE_PREFIX}${memoryScopeKey(scope)}`, JSON.stringify(store));
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
