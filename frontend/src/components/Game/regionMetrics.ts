/**
 * MAP04 — Colorare da un dato, non dalla bandiera
 * ==============================================
 * La legenda di una scheda mappa, oggi, ha una voce sola: il colore del
 * proprietario. È tautologica — dice quello che il titolo già dice — e spreca
 * l'unica cosa che una mappa sa fare meglio di una frase: mostrare **dove**.
 *
 * Qui la scheda impara a colorare da un **dato canonico per regione**, con la
 * disciplina che il progetto ha già scelto per la mappa grande e che questo modulo
 * non reinventa: `thematicMapModel.ts` è puro, espone le soglie a quantili, il
 * colore per fascia e gli intervalli per la legenda. Quel modulo resta l'unico
 * posto dove un valore diventa un colore — la scheda lo **riusa**, non lo duplica.
 *
 * Il confine è quello di C01, e vale la pena ripeterlo: **il modello sceglie cosa
 * mostrare, mai le cifre.** La metrica la sceglie una funzione deterministica dal
 * testo della conversazione, come già fa `classifyGovernmentMapIntent` per
 * l'intento; i numeri vengono dalle regioni canoniche. Nessun numero del modello
 * entra in una scheda.
 *
 * Modulo **puro**: nessun I/O, nessuno stato.
 */

import type { Region } from '../../types';
import {
  economyBucketEdges, economyBucketFor, economyColorForBucket, economyLegendRanges,
  isEconomyValue, ECONOMY_COLORS, type EconomyMapModel,
} from '../Map/thematicMapModel';

/** Le metriche che una scheda può mostrare, e come si chiamano al giocatore. */
export type RegionMetric = 'pil' | 'popolazione' | 'difesa';

export const REGION_METRICS: readonly RegionMetric[] = ['pil', 'popolazione', 'difesa'];

export const METRIC_LABEL: Record<RegionMetric, string> = {
  pil: 'Prodotto della provincia',
  popolazione: 'Popolazione della provincia',
  difesa: 'Presidio militare della provincia',
};

/**
 * Il valore canonico di una regione per una metrica, o `null` se il dato non c'è.
 * Un valore è un dato solo se è finito e positivo: `isEconomyValue` è la stessa
 * guardia che la mappa grande usa per il PIL, e vale per ogni grandezza.
 */
export function metricValue(region: Region, metric: RegionMetric): number | null {
  const raw = metric === 'pil' ? region.gdp : metric === 'popolazione' ? region.population : region.militaryPower;
  const value = Number(raw);
  return isEconomyValue(value) ? value : null;
}

/**
 * Le parole che fanno scegliere una metrica: stessa disciplina di un regex
 * d'intento. Le radici sono **prefissi** e non portano `\b` finale: «economia»,
 * «popolazione», «produzione» sono radici seguite da una desinenza, e un `\b` le
 * renderebbe inerte il pattern (difetto trovato dalla verifica indipendente).
 * Il confine di parola resta **all'inizio**, che è ciò che evita «economico»
 * dentro un'altra parola.
 */
const METRIC_PATTERNS: ReadonlyArray<[RegionMetric, RegExp]> = [
  ['difesa', /\b(?:difesa|militar[ei]|presidi|guarnigion|truppe|reparti|forze armate|esercito)/i],
  ['popolazione', /\b(?:popolazion|abitanti|demografi|densit|dove vive)/i],
  ['pil', /\b(?:pil|prodotto|economi|industri|ricche|produzion|reddito|investiment)/i],
];

/**
 * La metrica che la conversazione sta chiedendo. `undefined` = si resta sul
 * colore politico, che è il comportamento di sempre: la scheda non colora da un
 * dato se nessuno ha chiesto quel dato.
 */
export function metricFromText(text: string | undefined): RegionMetric | undefined {
  if (!text) return undefined;
  for (const [metric, pattern] of METRIC_PATTERNS) if (pattern.test(text)) return metric;
  return undefined;
}

/** Una fascia della legenda, con il colore e l'intervallo dichiarati. */
export interface MetricLegendEntry {
  readonly color: string;
  readonly label: string;
}

export interface MetricShading {
  readonly metric: RegionMetric;
  /** id → colore della fascia (o il colore dichiarato per il dato assente). */
  readonly colors: ReadonlyMap<string, string>;
  readonly legend: readonly MetricLegendEntry[];
  /** Quante regioni della scheda hanno il dato. */
  readonly measured: number;
}

/** Un numero leggibile: 1328 → «1.328», 2,5 → «2,5». */
function display(value: number): string {
  return new Intl.NumberFormat('it-IT', {
    maximumFractionDigits: value >= 100 ? 0 : 1,
  }).format(value);
}

/** L'intervallo di una fascia, nella forma breve che usa già la legenda della mappa. */
function rangeLabel(min: number | null, max: number | null): string {
  if (min === null) return `< ${display(max ?? 0)}`;
  if (max === null) return `≥ ${display(min)}`;
  return `${display(min)} – ${display(max)}`;
}

/**
 * I colori per fascia e la legenda, calcolati **sulle regioni della scheda** (non
 * su tutte le regioni del mondo: la scala deve descrivere ciò che si vede). Se
 * nessuna regione ha il dato, `null`: la scheda resta quella di prima invece di
 * colorare tutto di «assente».
 *
 * Le soglie sono i **quantili** di `thematicMapModel`: un valore estremo non
 * schiaccia la scala. Il colore di una fascia è `economyColorForBucket`, l'unica
 * funzione del progetto che trasforma un valore in un colore.
 */
export function shadeRegions(regions: readonly Region[], metric: RegionMetric): MetricShading | null {
  const values = regions.map(region => metricValue(region, metric));
  const measured = values.filter((value): value is number => value !== null);
  if (measured.length === 0) return null;
  const edges = economyBucketEdges(measured);
  const colors = new Map<string, string>();
  regions.forEach((region, index) => {
    // Il dato assente si colora con `null`: `economyColorForBucket` risponde con
    // il colore dichiarato per il «non disponibile», mai con una fascia a caso.
    colors.set(region.id, economyColorForBucket(values[index] === null ? null : economyBucketFor(values[index]!, edges)));
  });
  return { metric, colors, legend: legendFor(edges), measured: measured.length };
}

/** La legenda dagli stessi intervalli che la mappa grande pubblica per l'economia. */
function legendFor(edges: readonly number[]): MetricLegendEntry[] {
  const model: EconomyMapModel = {
    byRegion: Object.create(null), noData: [], edges: [...edges], domain: null, available: true, bucketCount: edges.length + 1,
  };
  return economyLegendRanges(model).map(range => ({
    color: economyColorForBucket(range.index),
    label: rangeLabel(range.min, range.max),
  }));
}

/** I colori della scala, esposti per chi deve disegnare uno swatch. */
export const METRIC_SCALE_COLORS = ECONOMY_COLORS;

/**
 * MAP11 — La mappa grande ha un layer che mostra **la stessa** grandezza?
 *
 * Solo il PIL: il layer `economy` è dichiarato «Dove è concentrato il PIL
 * territoriale», cioè la stessa lettura della scheda. La **popolazione** e il
 * **presidio militare** non hanno un layer corrispondente — `military` mostra
 * fronti, reparti e trasferimenti, che sono un'altra cosa. Meglio restare sulla
 * mappa politica che aprirne una che mostra qualcosa di diverso.
 */
export function mapLayerForMetric(metric: RegionMetric): 'economy' | undefined {
  return metric === 'pil' ? 'economy' : undefined;
}
