/**
 * World Story — Stato di lettura dei dispacci
 * =========================================
 * Funzioni pure per il feed «Dispacci del mondo»: un dispaccio nuovo arriva
 * senza `read`, l'apertura dell'articolo (o la sua dismissione) lo marca
 * letto. Tenerle separate da App.tsx le rende verificabili e impedisce che un
 * aggiornamento dell'elenco perda lo stato di lettura.
 */

export interface ReadableFeedItem {
  id: string;
  read?: boolean;
}

/** Numero di dispacci ancora da leggere. */
export function countUnread(items: ReadableFeedItem[]): number {
  return items.reduce((total, item) => total + (item.read ? 0 : 1), 0);
}

/** Marca un dispaccio come letto; restituisce lo stesso array se era già letto o assente. */
export function markItemRead<T extends ReadableFeedItem>(items: T[], id: string): T[] {
  const target = items.find(item => item.id === id);
  if (!target || target.read) return items;
  return items.map(item => (item.id === id ? { ...item, read: true } : item));
}

/** Marca tutti i dispacci come letti; restituisce lo stesso array se non c'è nulla da fare. */
export function markAllRead<T extends ReadableFeedItem>(items: T[]): T[] {
  return items.some(item => !item.read)
    ? items.map(item => (item.read ? item : { ...item, read: true }))
    : items;
}
