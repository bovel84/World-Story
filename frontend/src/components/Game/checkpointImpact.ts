/**
 * World Story — LW02: Impatto di un evento/checkpoint (read model puro)
 * ====================================================================
 * Calcola il **delta reale** tra due stati già pubblicati dal motore
 * (`before → after`). Non tocca la simulazione, non avvia l'LLM e non
 * interpreta causalità: mostra solo la variazione nel turno.
 *
 * Fonte autorevole: lo storico dei conti nazionali registrato dal motore a
 * ogni tick (`GET /:id/national-state` → `history`). La stessa funzione accetta
 * anche il magazzino materiale quando disponibile.
 */

import type { NationAccount, NationResources } from './NationDock/types';

export type ImpactTone = 'positive' | 'negative' | 'warning' | 'neutral';

export interface ImpactDelta {
  id: string;
  label: string;
  /** Variazione numerica `after - before`. */
  delta: number;
  /** Testo formattato con segno e unità. */
  text: string;
  tone: ImpactTone;
  /** Direzione favorevole, per la colorazione. */
  goodDirection: 'up' | 'down' | 'none';
}

export interface CheckpointImpact {
  deltas: ImpactDelta[];
  hasChanges: boolean;
}

export interface ImpactSnapshot {
  account?: Partial<NationAccount> | null;
  resources?: Partial<NationResources> | null;
}

interface MetricSpec {
  id: string;
  label: string;
  /** Percorso nel conto nazionale. */
  source: 'account' | 'resources';
  key: string;
  unit?: string;
  decimals?: number;
  /** Percentuale: il delta è in punti. */
  points?: boolean;
  goodDirection: 'up' | 'down' | 'none';
}

/** Solo metriche già pubblicate; nessuna formula del motore ricreata qui. */
const ACCOUNT_METRICS: MetricSpec[] = [
  { id: 'money', label: 'Tesoreria', source: 'account', key: 'money', unit: ' mld', decimals: 2, goodDirection: 'up' },
  { id: 'monthlyBalance', label: 'Saldo mensile', source: 'account', key: 'monthlyBalance', unit: ' mld', decimals: 2, goodDirection: 'up' },
  { id: 'stability', label: 'Stabilità', source: 'account', key: 'stability', points: true, decimals: 0, goodDirection: 'up' },
  { id: 'socialTension', label: 'Tensione sociale', source: 'account', key: 'socialTension', points: true, decimals: 0, goodDirection: 'down' },
  { id: 'warEffort', label: 'Sforzo bellico', source: 'account', key: 'warEffort', points: true, decimals: 0, goodDirection: 'none' },
  { id: 'debtRatioPct', label: 'Debito/PIL', source: 'account', key: 'debtRatioPct', points: true, decimals: 1, goodDirection: 'down' },
  { id: 'gdp', label: 'PIL', source: 'account', key: 'gdp', unit: ' mld', decimals: 1, goodDirection: 'up' },
  { id: 'militaryPower', label: 'Potenza militare', source: 'account', key: 'militaryPower', decimals: 1, goodDirection: 'up' },
  { id: 'population', label: 'Popolazione', source: 'account', key: 'population', decimals: 2, goodDirection: 'none' },
];

const RESOURCE_METRICS: MetricSpec[] = [
  { id: 'res-food', label: 'Viveri', source: 'resources', key: 'food', decimals: 1, goodDirection: 'up' },
  { id: 'res-clothing', label: 'Vestiario', source: 'resources', key: 'clothing', decimals: 1, goodDirection: 'up' },
  { id: 'res-weapons', label: 'Armamenti', source: 'resources', key: 'weapons', decimals: 1, goodDirection: 'up' },
  { id: 'res-fuel', label: 'Carburante', source: 'resources', key: 'fuel', decimals: 1, goodDirection: 'up' },
  { id: 'res-research', label: 'Ricerca', source: 'resources', key: 'research', decimals: 1, goodDirection: 'up' },
];

function read(source: ImpactSnapshot, spec: MetricSpec): number | null {
  const bag = spec.source === 'account' ? source.account : source.resources;
  if (!bag) return null;
  const raw = (bag as Record<string, unknown>)[spec.key];
  if (raw === undefined || raw === null) return null;
  const n = Number(raw);
  return Number.isFinite(n) ? n : null;
}

function toneFor(delta: number, goodDirection: 'up' | 'down' | 'none'): ImpactTone {
  if (delta === 0 || goodDirection === 'none') return 'neutral';
  const good = goodDirection === 'up' ? delta > 0 : delta < 0;
  return good ? 'positive' : 'negative';
}

function format(delta: number, spec: MetricSpec): string {
  const decimals = spec.decimals ?? 1;
  const sign = delta > 0 ? '+' : delta < 0 ? '−' : '';
  const value = Math.abs(delta).toFixed(decimals);
  const suffix = spec.points ? ' pt' : spec.unit ?? '';
  return `${sign}${value}${suffix}`;
}

/** Soglia sotto la quale una variazione è rumore e non viene mostrata. */
const EPSILON = 0.005;

/**
 * Delta deterministico tra due stati. `before`/`after` sono snapshot già
 * pubblicati dal motore; l'ordine conta.
 */
export function deriveCheckpointImpact(before: ImpactSnapshot, after: ImpactSnapshot): CheckpointImpact {
  const deltas: ImpactDelta[] = [];
  for (const spec of [...ACCOUNT_METRICS, ...RESOURCE_METRICS]) {
    const b = read(before, spec);
    const a = read(after, spec);
    if (b === null || a === null) continue;
    const delta = a - b;
    if (Math.abs(delta) < EPSILON) continue;
    deltas.push({
      id: spec.id,
      label: spec.label,
      delta,
      text: format(delta, spec),
      tone: toneFor(delta, spec.goodDirection),
      goodDirection: spec.goodDirection,
    });
  }
  return { deltas, hasChanges: deltas.length > 0 };
}

/** Punto storico minimo letto dal motore. */
export interface HistoryPointLike {
  date: string;
  turn?: number;
  account: Record<string, unknown>;
}

/**
 * Impatto per turno dallo storico dei conti: confronta ogni punto col
 * precedente. La chiave è il numero di turno (o l'indice, se assente).
 * Non ordina l'input: si aspetta la serie dal più vecchio al più recente,
 * come la restituisce il motore.
 */
export function impactsByTurn(history: readonly HistoryPointLike[]): Map<number, CheckpointImpact> {
  const result = new Map<number, CheckpointImpact>();
  for (let i = 1; i < history.length; i += 1) {
    const previous = history[i - 1];
    const current = history[i];
    const turn = typeof current.turn === 'number' ? current.turn : i;
    result.set(turn, deriveCheckpointImpact(
      { account: previous.account as Partial<NationAccount> },
      { account: current.account as Partial<NationAccount> },
    ));
  }
  return result;
}
