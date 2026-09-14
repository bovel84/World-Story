/**
 * World Story — Tendenze del Dossier Nazione (revisione leggibilità)
 * =================================================================
 * Funzioni pure che trasformano la serie storica dei conti nazionali in
 * coordinate per una sparkline e in una variazione rispetto alla rilevazione
 * precedente. Nessun valore viene interpolato o inventato: se la storia ha
 * meno di due punti, la tendenza semplicemente non esiste.
 */

/** Tono semantico condiviso con il dossier. */
export type TrendTone = 'positive' | 'negative' | 'warning' | 'neutral';

export interface SparkPoint {
  x: number;
  y: number;
}

export interface Trend {
  /** Valori in ordine cronologico (dal più vecchio al più recente). */
  series: number[];
  /** Date ISO corrispondenti ai valori. */
  dates: string[];
  /** Variazione dell'ultimo punto rispetto al precedente. */
  delta: number;
}

/**
 * Mappa i valori in coordinate SVG dentro un riquadro `width × height`.
 * Il minimo tocca il bordo inferiore e il massimo quello superiore, così la
 * forma della linea è leggibile anche su serie quasi piatte.
 */
export function sparkPoints(values: number[], width = 56, height = 18, pad = 2): SparkPoint[] {
  const finite = values.filter((value) => Number.isFinite(value));
  if (finite.length < 2) return [];
  const min = Math.min(...finite);
  const max = Math.max(...finite);
  const span = max - min || 1;
  const innerW = width - pad * 2;
  const innerH = height - pad * 2;
  return finite.map((value, index) => ({
    x: Number((pad + (index / (finite.length - 1)) * innerW).toFixed(2)),
    y: Number((height - pad - ((value - min) / span) * innerH).toFixed(2)),
  }));
}

/**
 * Costruisce la tendenza a partire dai punti storici e da un estrattore di
 * campo. Ignora i punti in cui il campo manca o non è finito, così una storia
 * incompleta non produce una linea falsata.
 */
export function trendFrom<TPoint extends { date: string }>(
  points: readonly TPoint[],
  pick: (point: TPoint) => number | undefined | null,
): Trend | null {
  const series: number[] = [];
  const dates: string[] = [];
  for (const point of points) {
    const value = pick(point);
    if (value == null || !Number.isFinite(Number(value))) continue;
    series.push(Number(value));
    dates.push(point.date);
  }
  if (series.length < 2) return null;
  return { series, dates, delta: series[series.length - 1] - series[series.length - 2] };
}

/**
 * Tono della variazione. `goodDirection` dice quale direzione è favorevole
 * (es. «up» per il saldo, «down» per la tensione sociale). Una variazione
 * nulla non è né buona né cattiva.
 */
export function deltaTone(delta: number, goodDirection: 'up' | 'down'): TrendTone {
  if (!Number.isFinite(delta) || Math.abs(delta) < 1e-9) return 'neutral';
  const rising = delta > 0;
  const good = goodDirection === 'up' ? rising : !rising;
  return good ? 'positive' : 'negative';
}

/** Etichetta fattuale della variazione in base alla distanza fra le date. */
export function trendLabel(dates: readonly string[]): string {
  if (dates.length < 2) return 'vs rilevazione precedente';
  const days = Math.round((Date.parse(dates[dates.length - 1]) - Date.parse(dates[dates.length - 2])) / 86_400_000);
  return Number.isFinite(days) && days > 0 && days <= 45 ? 'vs mese scorso' : 'vs rilevazione precedente';
}
