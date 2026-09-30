/**
 * WS-MINISTER-UX-07 (C) — L'autoscroll che non strappa la lettura
 * ===============================================================
 * Difetto C: la chat del ministro riportava sempre in fondo a ogni token dello
 * streaming. Chi risaliva la cronologia per rileggere veniva trascinato giù
 * mentre il ministro scriveva. La regola è: si segue il fondo **solo se il
 * giocatore era già in fondo**; se ha risalito, lo streaming non lo tocca.
 *
 * La decisione è una funzione pura su tre numeri — niente DOM nel test.
 */

/** Quanta distanza dal fondo conta ancora come «sto leggendo il fondo». */
export const STICK_THRESHOLD_PX = 48;

export interface ScrollMetrics {
  readonly scrollTop: number;
  readonly scrollHeight: number;
  readonly clientHeight: number;
}

/**
 * Vero se il contenitore è (quasi) in fondo. La soglia assorbe l'arrotondamento
 * dei browser e i piccoli scarti durante lo streaming.
 */
export function isNearBottom(metrics: ScrollMetrics, threshold = STICK_THRESHOLD_PX): boolean {
  const distance = metrics.scrollHeight - metrics.scrollTop - metrics.clientHeight;
  return distance <= threshold;
}
