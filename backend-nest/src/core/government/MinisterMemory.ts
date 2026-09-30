/**
 * WS-MINISTER-UX-05 — La memoria del ministro (contratto e motore, puri)
 * =====================================================================
 * La roadmap chiede una memoria conversazionale **persistente**, separata dai
 * numeri del mondo, e chiede di preparare il prompt con «profilo, sintesi breve
 * dei ricordi pertinenti, scambi recenti e fatti aggiornati», senza rimandare
 * ogni volta tutta la cronologia.
 *
 * Questo modulo è la parte **pura** di quella fase: definisce che cos'è un
 * ricordo, come si registra, come si seleziona per il prompt, come si copia su
 * un ramo e come si pota al rewind. Non tocca il database, non fa I/O, non
 * chiama il modello: l'innesto di persistenza è documentato nel report
 * `WS-MINISTER-UX-05-report.md`.
 *
 * Tre regole, le stesse del progetto:
 *  - **la memoria non è una seconda contabilità**: non porta cifre nuove e non
 *    sostituisce i fatti aggiornati del briefing (che vincono sempre);
 *  - **ogni ricordo ha un riferimento** (messaggio, atto, ordine, data, turno):
 *    un ricordo senza provenienza non è verificabile e non entra;
 *  - **una decisione futura non compare nel passato**: al rewind si potano i
 *    ricordi oltre il punto di ripristino.
 *
 * Il ricordo distingue ciò che è **discusso** da ciò che è **accodato** da ciò
 * che è **verificato**: «il Presidente valuta una scuola» non è «ha firmato
 * l'ordine» e non è «la scuola è operativa».
 */

import type { CabinetSeat } from './Cabinet';

/** Che cosa è un ricordo, nella grammatica concordata con la roadmap. */
export type MinisterMemoryKind =
  | 'objective'           // obiettivo esplicitato dal Presidente
  | 'proposal-discussed'  // una proposta messa sul tavolo
  | 'proposal-rejected'   // una proposta respinta, con il motivo
  | 'open-question'       // una questione rimasta aperta
  | 'queued-decision'     // una decisione accodata (atto nel registro)
  | 'verified-outcome';   // un esito constatato dopo l'avanzamento del tempo

/** Lo stato di un ricordo: dice a che punto è, non cosa vale. */
export type MinisterMemoryState =
  | 'open'
  | 'discussed'
  | 'rejected'
  | 'queued'
  | 'executed'
  | 'verified';

/**
 * L'identità della memoria: partita, ramo, sedia e mandato. Il solo nome della
 * sedia non basta se il ministro cambia: il `mandate` è l'identità di chi siede.
 */
export interface MinisterMemoryScope {
  readonly gameId: string;
  readonly branchId: string | null;
  readonly seat: CabinetSeat;
  readonly mandate: string;
}

/** Il riferimento che rende verificabile un ricordo. La data è del mondo. */
export interface MinisterMemoryRef {
  readonly messageId?: string;
  readonly actId?: string;
  readonly orderId?: string;
  readonly gameDate: string;
  readonly turn?: number;
}

export interface MinisterMemoryRecord {
  /** Chiave stabile: lo stesso `id` aggiorna il ricordo invece di duplicarlo. */
  readonly id: string;
  readonly kind: MinisterMemoryKind;
  readonly summary: string;
  /** Per una proposta respinta: il motivo. Per le altre: assente. */
  readonly reason?: string;
  readonly state: MinisterMemoryState;
  readonly refs: MinisterMemoryRef;
}

export interface MinisterMemory {
  readonly scope: MinisterMemoryScope;
  readonly records: readonly MinisterMemoryRecord[];
}

/** Quanti ricordi si conservano: oltre, si potano i meno significativi. */
export const MINISTER_MEMORY_LIMIT = 40;

/** L'ordine con cui i ricordi contano nel prompt (prima i più vincolanti). */
const KIND_PRIORITY: Record<MinisterMemoryKind, number> = {
  'proposal-rejected': 0,
  'queued-decision': 1,
  'verified-outcome': 2,
  'open-question': 3,
  objective: 4,
  'proposal-discussed': 5,
};

const KIND_LABEL: Record<MinisterMemoryKind, string> = {
  objective: 'obiettivo',
  'proposal-discussed': 'discussa',
  'proposal-rejected': 'respinta',
  'open-question': 'aperta',
  'queued-decision': 'accodata',
  'verified-outcome': 'verificata',
};

const STATE_LABEL: Record<MinisterMemoryState, string> = {
  open: 'aperta',
  discussed: 'discussa',
  rejected: 'respinta',
  queued: 'accodata',
  executed: 'eseguita',
  verified: 'verificato',
};

/** Una memoria vuota, con la sua identità: il punto di partenza. */
export function emptyMinisterMemory(scope: MinisterMemoryScope): MinisterMemory {
  return { scope, records: [] };
}

export function isMinisterMemoryEmpty(memory: MinisterMemory | null | undefined): boolean {
  return !memory || memory.records.length === 0;
}

/** Un ricordo ha senso solo con una sintesi e una data: niente provenienza, niente ricordo. */
function isValid(record: MinisterMemoryRecord): boolean {
  return Boolean(
    record.id
    && record.summary.trim()
    && record.refs
    && typeof record.refs.gameDate === 'string'
    && record.refs.gameDate.trim(),
  );
}

/**
 * Registra un ricordo. Se l'`id` esiste già, **aggiorna** (stato, motivo, refs):
 * è così che «discussa» diventa «accodata» senza duplicare la voce. Oltre il
 * limite si potano i ricordi meno significativi e più vecchi.
 */
export function recordMinisterMemory(
  memory: MinisterMemory,
  input: MinisterMemoryRecord,
): MinisterMemory {
  if (!isValid(input)) return memory;
  const records = memory.records.some(record => record.id === input.id)
    ? memory.records.map(record => (record.id === input.id ? input : record))
    : [...memory.records, input];
  return { ...memory, records: pruneToLimit(records) };
}

/** Tiene i ricordi più significativi (e, a parità, i più recenti). */
function pruneToLimit(records: readonly MinisterMemoryRecord[]): readonly MinisterMemoryRecord[] {
  if (records.length <= MINISTER_MEMORY_LIMIT) return records;
  const indexed = records.map((record, index) => ({ record, index }));
  indexed.sort((a, b) => {
    const byKind = KIND_PRIORITY[a.record.kind] - KIND_PRIORITY[b.record.kind];
    if (byKind !== 0) return byKind;
    return b.index - a.index; // più recente prima
  });
  const kept = new Set(indexed.slice(0, MINISTER_MEMORY_LIMIT).map(entry => entry.record.id));
  return records.filter(record => kept.has(record.id));
}

/**
 * I ricordi pertinenti per il prompt: prima i più vincolanti (respinte,
 * accodate, verificate, aperte), poi obiettivi e discussioni; a parità, i più
 * recenti. Non è tutta la cronologia, è la sintesi breve che la roadmap chiede.
 */
export function relevantMinisterMemory(
  memory: MinisterMemory,
  limit = 8,
): readonly MinisterMemoryRecord[] {
  const indexed = memory.records.map((record, index) => ({ record, index }));
  indexed.sort((a, b) => {
    const byKind = KIND_PRIORITY[a.record.kind] - KIND_PRIORITY[b.record.kind];
    if (byKind !== 0) return byKind;
    return b.index - a.index;
  });
  return indexed.slice(0, limit).map(entry => entry.record);
}

/**
 * Il blocco di prompt che porta la memoria. È **esplicito** sul confine: la
 * memoria non contiene cifre nuove e non batte i fatti aggiornati del briefing.
 */
export function memorySection(memory: MinisterMemory, limit = 8): string {
  const records = relevantMinisterMemory(memory, limit);
  if (records.length === 0) return '';
  const lines: string[] = [
    'MEMORIA DELLA SEDUTA (non è una seconda contabilità: non contiene cifre nuove; se un ricordo',
    'contrasta con i fatti aggiornati qui sopra, vincono i fatti aggiornati):',
  ];
  for (const record of records) {
    const ref = formatRef(record.refs);
    const reason = record.kind === 'proposal-rejected' && record.reason
      ? ` — motivo: ${record.reason}`
      : '';
    lines.push(`- [${KIND_LABEL[record.kind]} · ${STATE_LABEL[record.state]}] ${record.summary}${reason} (${ref})`);
  }
  lines.push('Usa la memoria per non ripeterti e per ricordare gli impegni già presi: non è una richiesta nuova.');
  return lines.join('\n');
}

/** Una data con il suo riferimento: la provenienza rende il ricordo verificabile. */
function formatRef(refs: MinisterMemoryRef): string {
  const parts: string[] = [];
  if (refs.turn != null) parts.push(`turno ${refs.turn}`);
  if (refs.messageId) parts.push(`messaggio ${refs.messageId}`);
  if (refs.orderId) parts.push(`ordine ${refs.orderId}`);
  if (refs.actId) parts.push(`atto ${refs.actId}`);
  parts.push(refs.gameDate);
  return parts.join(', ');
}

/**
 * La copia su un ramo: i ricordi si portano con sé, l'identità cambia.
 * Nessuna riscrittura, nessun ricalcolo: il passato è già passato.
 */
export function forkMinisterMemory(
  memory: MinisterMemory,
  scope: MinisterMemoryScope,
): MinisterMemory {
  return { scope, records: [...memory.records] };
}

/**
 * Il ripristino a un punto: si **potano** i ricordi che stanno oltre il punto di
 * ripristino. È la regola «una decisione futura non deve comparire nel passato».
 * Il taglio si applica per turno (se noto) e per data (confronto ISO).
 */
export function pruneMinisterMemory(
  memory: MinisterMemory,
  cutoff: { turn?: number; gameDate?: string },
): MinisterMemory {
  const records = memory.records.filter(record => {
    if (cutoff.turn != null && record.refs.turn != null && record.refs.turn > cutoff.turn) return false;
    if (cutoff.gameDate && record.refs.gameDate > cutoff.gameDate) return false;
    return true;
  });
  return records.length === memory.records.length ? memory : { ...memory, records };
}
