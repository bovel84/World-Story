/**
 * World Story — C01: i dati dei grafici del Consulente
 * ==================================================
 * Il Consulente può chiedere di **mostrare** un grafico (la sintassi è nel suo
 * prompt). Questo modulo decide quali dati finiscono in quel grafico, e la regola
 * è ferrea: **il modello sceglie cosa mostrare, mai le cifre.** Ogni numero qui
 * dentro viene dal motore o dalla mappa; il blocco del modello porta solo un tipo
 * e un soggetto, e se il tipo non esiste il blocco non si rende.
 *
 * Perché conta: un grafico disegnato con numeri del modello sarebbe una figura
 * verosimile e falsa — il difetto peggiore possibile, perché *sembra* un dato.
 * Qui i numeri li fornisce il frontend dai read model già in memoria; il modello
 * al massimo dice «mostra dove va il denaro».
 *
 * Nessuna libreria di grafici: il progetto disegna in SVG nativo (vedi
 * `Landing`, `CreateWorld`, `TacticalOverlay`). Manteniamo quella disciplina —
 * niente dipendenze nuove per quattro figure.
 */
import type { Region } from '../../types';
import type { NationAccount, NationResources, HistoryPoint } from './NationDock/types';
import type { NationalBudgetDetail } from '../../services/api';
import { finiteOrNull } from './domainStatus';
import { formatNumber } from '../../utils/format';

/** I grafici che il Consulente può chiedere. Chiuso: un tipo ignoto non si rende. */
export type ChartKind = 'territorio' | 'bilancio' | 'risorse' | 'trend';

export const CHART_KINDS: readonly ChartKind[] = ['territorio', 'bilancio', 'risorse', 'trend'];

export const CHART_TITLE: Record<ChartKind, string> = {
  territorio: 'Dove sono ricche le province',
  bilancio: 'Dove va il denaro',
  risorse: 'Giacimenti e siti',
  trend: 'Come sta evolvendo',
};

/** Una voce di un grafico a barre: etichetta, valore, tono. */
export interface ChartBar {
  label: string;
  value: number;
  /** Testo da mostrare accanto alla barra, già formattato. */
  display: string;
  tone: 'positive' | 'warning' | 'critical' | 'neutral';
}

export interface ChartFigure {
  kind: ChartKind;
  title: string;
  /** Perché questo grafico risponde alla domanda: una riga, onesta. */
  note: string;
  /** Barre orizzontali ordinate per valore. Vuoto = non c'è nulla da mostrare. */
  bars: ChartBar[];
  /** Per `trend`: la serie, se il motore la pubblica. */
  series?: { points: number[]; label: string; deltaText: string; tone: 'positive' | 'warning' | 'critical' | 'neutral' };
  /** Unità dichiarata una volta per figura (N1). */
  unit?: string;
}

export interface ChartDataInput {
  regions?: Region[];
  account?: Partial<NationAccount> | null;
  resources?: Partial<NationResources> | null;
  budget?: Partial<NationalBudgetDetail> | null;
  history?: HistoryPoint[];
  facilities?: Array<{ typeName: string; regionId: string; operational: boolean; polityId: string | null }>;
  resourceSites?: Array<{ resourceName: string; regionId: string; knownQuantity: { baseUnits: string } | null }>;
  playerPolityId?: string;
}

const bar = (label: string, value: number, display: string, tone: ChartBar['tone'] = 'neutral'): ChartBar =>
  ({ label, value, display, tone });

/**
 * Il territorio: le province del paese ordinate per PIL. È il «dove investire»
 * in senso letterale — si vede dove il paese produce e dove è vuoto.
 */
export function territoryChart(input: ChartDataInput, limit = 12): ChartFigure {
  const own = (input.regions ?? []).filter(region => !input.playerPolityId || region.owner === input.playerPolityId);
  const rows = own
    .map(region => ({
      name: String(region.name || '—'),
      gdp: Number(region.gdp || 0),
      population: Number(region.population || 0),
    }))
    .filter(row => row.gdp > 0 || row.population > 0)
    .sort((a, b) => b.gdp - a.gdp)
    .slice(0, limit);

  const bars = rows.map(row => bar(
    row.name,
    row.gdp,
    `${formatNumber(row.gdp)} · ${formatNumber(row.population)} ab.`,
    'neutral',
  ));

  return {
    kind: 'territorio',
    title: CHART_TITLE.territorio,
    note: rows.length > 0
      ? `Le ${bars.length} province maggiori per prodotto, su ${own.length} controllate.`
      : 'Il motore non pubblica il prodotto delle province.',
    bars,
    unit: 'prodotto della provincia (indice del motore)',
  };
}

/**
 * Il bilancio: le uscite per voce. Si vede a colpo d'occhio quanto va a
 * istruzione, sanità, difesa, infrastrutture — il grafico del «dove va il denaro».
 */
export function budgetChart(input: ChartDataInput, limit = 10): ChartFigure {
  const expense = (input.budget as any)?.expense;
  const rows = (Array.isArray(expense) ? expense : [])
    .map((line: any) => ({ label: String(line.label || line.id || '—'), amount: Number(line.amount || 0) }))
    .filter((row: { amount: number }) => row.amount > 0)
    .sort((a: { amount: number }, b: { amount: number }) => b.amount - a.amount)
    .slice(0, limit);

  // Il tono delle voci civili è positivo, quello della difesa è neutro: non è un
  // giudizio, è il segno che il grafico serve a **vedere** il confronto.
  const bars = rows.map((row: { label: string; amount: number }) => {
    const civic = /istruzione|sanità|sostegno|infrastruttur|amministrazione/i.test(row.label);
    const arms = /difesa/i.test(row.label);
    return bar(row.label, row.amount, formatNumber(row.amount), civic ? 'positive' : arms ? 'warning' : 'neutral');
  });

  return {
    kind: 'bilancio',
    title: CHART_TITLE.bilancio,
    note: rows.length > 0
      ? 'Le uscite mensili per voce, come le pubblica il motore.'
      : 'Questo scenario non pubblica il dettaglio delle uscite.',
    bars,
    unit: 'uscita mensile (mld)',
  };
}

/** Le risorse: i giacimenti noti del paese, per quantità dichiarata. */
export function resourceChart(input: ChartDataInput, limit = 12): ChartFigure {
  const sites = input.resourceSites ?? [];
  const byResource = new Map<string, number>();
  for (const site of sites) {
    const qty = Number(site?.knownQuantity?.baseUnits ?? 0);
    if (!Number.isFinite(qty) || qty <= 0) continue;
    const name = String(site.resourceName || '—');
    byResource.set(name, (byResource.get(name) ?? 0) + qty);
  }
  const rows = [...byResource.entries()]
    .map(([label, value]) => ({ label, value }))
    .sort((a, b) => b.value - a.value)
    .slice(0, limit);

  const bars = rows.map(row => bar(row.label, row.value, formatNumber(row.value), 'neutral'));

  // Se i giacimenti non hanno quantità nota, restano i siti produttivi: il
  // grafico mostra ciò che c'è, dichiarando di cosa si tratta.
  if (bars.length === 0) {
    const facilities = input.facilities ?? [];
    const byType = new Map<string, number>();
    for (const facility of facilities) byType.set(String(facility.typeName || '—'), (byType.get(String(facility.typeName || '—')) ?? 0) + 1);
    const facilityBars = [...byType.entries()]
      .map(([label, value]) => bar(label, value, `${formatNumber(value)}`, 'neutral'))
      .sort((a, b) => b.value - a.value)
      .slice(0, limit);
    return {
      kind: 'risorse',
      title: CHART_TITLE.risorse,
      note: facilityBars.length > 0
        ? 'Nessuna quantità dichiarata per i giacimenti: il grafico conta i siti produttivi del paese.'
        : 'Il motore non pubblica né giacimenti misurati né siti produttivi.',
      bars: facilityBars,
      unit: facilityBars.length > 0 ? 'siti produttivi' : undefined,
    };
  }

  return {
    kind: 'risorse',
    title: CHART_TITLE.risorse,
    note: 'Le quantità che il motore dichiara note, sommate per risorsa.',
    bars,
    unit: 'quantità nota',
  };
}

/**
 * I trend: la serie storica che il motore già pubblica nell'account history.
 * Il grafico sceglie la cifra più significativa **disponibile**: prima la cassa,
 * poi il saldo, poi la stabilità, poi la tensione.
 */
export function trendChart(input: ChartDataInput): ChartFigure {
  const history = input.history ?? [];
  const picks: Array<{ label: string; get: (point: HistoryPoint) => number | undefined; good: 'up' | 'down'; decimals: number }> = [
    { label: 'Tesoreria', get: point => Number((point.account as any)?.money), good: 'up', decimals: 2 },
    { label: 'Saldo mensile', get: point => Number((point.account as any)?.monthlyBalance), good: 'up', decimals: 2 },
    { label: 'Stabilità', get: point => Number((point.account as any)?.stability), good: 'up', decimals: 0 },
    { label: 'Tensione sociale', get: point => Number((point.account as any)?.socialTension), good: 'down', decimals: 0 },
    { label: 'Crescita annua', get: point => Number((point.account as any)?.annualGrowthRate) * 100, good: 'up', decimals: 1 },
  ];

  for (const pick of picks) {
    const points = history
      .map(point => pick.get(point))
      .filter((value): value is number => Number.isFinite(value));
    if (points.length < 2) continue;
    const delta = points[points.length - 1] - points[0];
    const flat = Math.abs(delta) < 1e-9;
    const good = pick.good === 'up' ? delta > 0 : delta < 0;
    const tone: ChartBar['tone'] = flat ? 'neutral' : good ? 'positive' : 'warning';
    return {
      kind: 'trend',
      title: CHART_TITLE.trend,
      note: `${pick.label}: dal primo all'ultimo punto registrato dal motore.`,
      bars: [],
      series: {
        points,
        label: pick.label,
        deltaText: flat ? 'stabile' : `${delta > 0 ? '+' : '−'}${Math.abs(delta).toFixed(pick.decimals).replace('.', ',')}`,
        tone,
      },
    };
  }

  return {
    kind: 'trend',
    title: CHART_TITLE.trend,
    note: 'Il motore non ha ancora due punti storici da confrontare: il trend non è disegnabile.',
    bars: [],
  };
}

/** Il grafico per un tipo. `null` se il tipo è ignoto o non c'è nulla da mostrare. */
export function chartFor(kind: string, input: ChartDataInput): ChartFigure | null {
  const normalized = String(kind || '').trim().toLowerCase() as ChartKind;
  if (!CHART_KINDS.includes(normalized)) return null;
  const figure = normalized === 'territorio' ? territoryChart(input)
    : normalized === 'bilancio' ? budgetChart(input)
      : normalized === 'risorse' ? resourceChart(input)
        : trendChart(input);
  // Un grafico senza barre e senza serie non si rende: meglio il testo del
  // Consulente che una figura vuota.
  if (figure.bars.length === 0 && !figure.series) return null;
  return figure;
}

/** I tipi disponibili, per il prompt e per il test. */
export function availableKinds(input: ChartDataInput): ChartKind[] {
  return CHART_KINDS.filter(kind => chartFor(kind, input) !== null);
}

/** Il valore massimo fra le barre: la scala del grafico. Mai zero (divide). */
export function chartScale(figure: ChartFigure): number {
  return Math.max(1, ...figure.bars.map(bar => bar.value));
}

/** Quanti punti può avere una serie, per il disegno. */
export function finiteNumberOrNull(value: unknown): number | null {
  return finiteOrNull(value);
}
