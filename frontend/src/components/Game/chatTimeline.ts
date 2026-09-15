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
