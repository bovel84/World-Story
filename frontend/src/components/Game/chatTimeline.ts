/**
 * World Story — Date e ordinamento delle chat diplomatiche
 * =======================================================
 * Funzioni pure usate dal pannello chat: la data del MONDO è la fonte
 * primaria (mai il timestamp locale, che introdurrebbe fusi orari e date di
 * sistema), il timestamp reale è solo un fallback per capire quale chat è la
 * più recente quando la data del mondo non è ancora registrata.
 */

const MONTHS_SHORT = ['gen', 'feb', 'mar', 'apr', 'mag', 'giu', 'lug', 'ago', 'set', 'ott', 'nov', 'dic'];

/** «4 mar 2026» da una data ISO (YYYY-MM-DD); stringa vuota se non valida. */
export function formatGameDate(value?: string): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(value || '');
  if (!match) return '';
  return `${Number(match[3])} ${MONTHS_SHORT[Number(match[2]) - 1]} ${match[1]}`;
}

/**
 * Etichetta data/ora dell'ultimo messaggio: la data del MONDO quando
 * disponibile, altrimenti l'orario reale (HH:MM oggi, «4 mar 14:32» altrove).
 */
export function formatChatStamp(gameDate?: string, timestamp?: string, now: Date = new Date()): string {
  const worldDate = formatGameDate(gameDate);
  if (worldDate) return worldDate;
  if (!timestamp) return '';
  const date = new Date(timestamp);
  if (isNaN(date.getTime())) return '';
  const hh = String(date.getHours()).padStart(2, '0');
  const mm = String(date.getMinutes()).padStart(2, '0');
  if (date.toDateString() === now.toDateString()) return `${hh}:${mm}`;
  return `${date.getDate()} ${MONTHS_SHORT[date.getMonth()]} ${hh}:${mm}`;
}

/** Chiave di ordinamento: l'ultima chat aggiornata deve salire in cima. */
export function chatSortKey(chat: {
  lastMessageAt?: string;
  lastMessageGameDate?: string;
  createdAt?: string;
}): string {
  return chat.lastMessageAt || chat.lastMessageGameDate || chat.createdAt || '';
}

/** Elenco ordinato dal più recente (non muta l'input). */
export function orderChatsByLatest<T extends { lastMessageAt?: string; lastMessageGameDate?: string; createdAt?: string }>(
  chats: T[],
): T[] {
  return [...chats].sort((a, b) => chatSortKey(b).localeCompare(chatSortKey(a)));
}

/** Insieme canonico degli interlocutori, usato per capire se due chat parlano con le stesse nazioni. */
export function participantSetKey(participants?: { id: string; role?: string }[]): string {
  return [...new Set((participants || []).map(p => p.id).filter(Boolean))].sort().join('|');
}

/**
 * Una nuova discussione con gli stessi interlocutori rende obsoleta la
 * precedente: quando arriva un messaggio su `chatId`, le altre chat attive con
 * gli stessi partecipanti vengono marcate come archiviate nella UI. La stessa
 * regola è applicata dal backend, qui serve a non mostrare due discussioni
 * attive in contemporanea nell'attesa del refresh.
 */
export function archiveSiblingThreads<
  T extends { id: string; participants?: { id: string; role?: string }[]; archived?: boolean },
>(chats: T[], chatId: string): T[] {
  const incoming = chats.find(chat => chat.id === chatId);
  if (!incoming) return chats;
  const key = participantSetKey(incoming.participants);
  if (!key) return chats;
  return chats.map(chat => (
    chat.id !== chatId && !chat.archived && participantSetKey(chat.participants) === key
      ? { ...chat, archived: true }
      : chat
  ));
}

// ---------------------------------------------------------------------------
// Ordine dei messaggi di un thread
// ---------------------------------------------------------------------------

/** Campi di un messaggio che partecipano all'ordinamento (tutti opzionali tranne id/role). */
export interface ChatOrderFields {
  id?: string;
  role?: string;
  /** Data del MONDO (YYYY-MM-DD): chiave primaria. */
  gameDate?: string | null;
  /** Turno del mondo: chiave più fine della data (più messaggi nello stesso giorno). */
  turn?: number | null;
  /** Sequenza di inserimento del server (rowid): tie-breaker stabile. */
  seq?: number | null;
  /** Timestamp del SERVER (ISO): fallback quando `seq` non è disponibile. */
  createdAt?: string | null;
}

const isoDay = (value?: string | null): string => {
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(value || '');
  return match ? `${match[1]}-${match[2]}-${match[3]}` : '';
};

/**
 * Chiave di ordinamento di un messaggio, come tupla confrontabile.
 *
 * Perché **non** l'ordine di arrivo: i tre percorsi che riempiono il thread
 * (fetch dal server, invio/risposta locale, messaggio in arrivo via SSE)
 * possono consegnare i messaggi in ordini diversi — e il server stesso può
 * contenere messaggi inseriti **dopo** ma appartenenti a una data precedente
 * (una nota collegata a un evento vecchio). L'ordine mostrato deve essere
 * quello della **timeline del mondo**, non quello di consegna.
 *
 * Ordine delle chiavi (crescente):
 *  1. `gameDate` — la data del mondo è la fonte primaria (0 = nota, 1 = ignota);
 *  2. `turn` — nello stesso giorno possono cadere più turni: il turno è più fine;
 *  3. `seq` — sequenza di inserimento del server (rowid): tie-breaker stabile
 *     per i messaggi dello stesso giorno **e** dello stesso turno;
 *  4. `createdAt` — timestamp del server, solo quando `seq` manca (payload
 *     vecchi o messaggi creati altrove): non è mai il timestamp locale;
 *  5. `id` — ultimo criterio, così due messaggi identici hanno comunque un
 *     ordine deterministico.
 */
export function chatMessageOrderKey(message: ChatOrderFields): Array<number | string> {
  const day = isoDay(message?.gameDate);
  const turn = Number(message?.turn);
  const seq = Number(message?.seq);
  const createdAt = typeof message?.createdAt === 'string' ? message.createdAt : '';
  return [
    day ? 0 : 1, day,
    Number.isFinite(turn) && turn > 0 ? 0 : 1, Number.isFinite(turn) ? turn : 0,
    Number.isFinite(seq) ? 0 : 1, Number.isFinite(seq) ? seq : 0,
    createdAt ? 0 : 1, createdAt,
    String(message?.id || ''),
  ];
}

/**
 * Ordina i messaggi di un thread secondo la timeline del mondo. Funzione
 * **pura**, non muta l'input e **deterministica**: lo stesso elenco produce
 * sempre lo stesso ordine, anche con date identiche e senza `seq`.
 */
export function orderChatMessages<T extends ChatOrderFields>(messages: readonly T[] | null | undefined): T[] {
  if (!Array.isArray(messages) || messages.length < 2) return Array.isArray(messages) ? [...messages] : [];
  return [...messages].sort((a, b) => compareChatMessages(a, b));
}

/** Confronto fra due messaggi: negativo se `a` precede `b`. */
export function compareChatMessages(a: ChatOrderFields, b: ChatOrderFields): number {
  const left = chatMessageOrderKey(a);
  const right = chatMessageOrderKey(b);
  for (let index = 0; index < left.length; index += 1) {
    const l = left[index];
    const r = right[index];
    if (l === r) continue;
    if (typeof l === 'number' && typeof r === 'number') return l - r;
    return String(l).localeCompare(String(r));
  }
  return 0;
}

/**
 * Ultimo messaggio nella timeline del mondo (il più recente per data/turno/seq),
 * non l'ultimo arrivato: serve a tenere corretto «ultimo messaggio» in elenco
 * quando un messaggio vecchio arriva in ritardo.
 */
export function lastChatMessage<T extends ChatOrderFields>(messages: readonly T[] | null | undefined): T | null {
  const ordered = orderChatMessages(messages);
  return ordered.length > 0 ? ordered[ordered.length - 1] : null;
}
