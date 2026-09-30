/**
 * WS-MINISTER-UX-04 — Le conseguenze di una proposta, dichiarate per quello che sono
 * =================================================================================
 * Il confronto di UX-03 mostrava costo e guadagno. La roadmap chiede di più, e
 * chiede soprattutto **onestà**: distinguere ciò che il motore calcola da ciò che
 * il catalogo dichiara e da ciò che non è simulato affatto.
 *
 * Tre regole, le stesse del progetto:
 *  - **nessuna cifra nuova**: ogni valore viene dall'atto (`TreasuryRoad`) o
 *    dalla dichiarazione dell'opera (`CabinetItemView.declaration`/`figures`);
 *  - **dove il motore non dichiara, la tavola lo dice**: spesa ricorrente, tempi
 *    ed effetti sociali non sono inventati, sono marcati «non dichiarato» o
 *    «non simulato»;
 *  - **omogeneità**: si confrontano le stesse dimensioni per ogni strada,
 *    ciascuna con la sua provenienza (`measured`/`estimated`/`declared`/
 *    `unavailable`).
 *
 * Modulo **puro**: nessun I/O, nessuno stato.
 */

import type { CabinetItemView } from '../../services/api';
import type { TreasuryRoad } from './treasuryAct';

export type ConsequenceBasis = 'measured' | 'estimated' | 'declared' | 'unavailable';

export interface ComparisonCell {
  readonly value: string;
  readonly basis: ConsequenceBasis;
}

export type DimensionId =
  | 'initial' | 'recurring' | 'timing' | 'coverage' | 'constraints' | 'benefit' | 'uncertainty';

export interface ComparisonDimension {
  readonly id: DimensionId;
  readonly label: string;
}

/** Le dimensioni del confronto, nello stesso ordine per ogni strada. */
export const COMPARISON_DIMENSIONS: readonly ComparisonDimension[] = [
  { id: 'initial', label: 'Costo immediato' },
  { id: 'recurring', label: 'Spesa ricorrente' },
  { id: 'timing', label: 'Tempi' },
  { id: 'coverage', label: 'Copertura' },
  { id: 'constraints', label: 'Vincoli' },
  { id: 'benefit', label: 'Benefici attesi' },
  { id: 'uncertainty', label: 'Incertezza' },
];

/** Un passo della catena finanziamento → opera → servizio → società. */
export interface ConsequenceStep {
  readonly label: string;
  readonly detail: string;
  readonly kind: 'simulated' | 'declared' | 'not-simulated';
}

export interface RoadComparison {
  readonly roadId: string;
  readonly title: string;
  readonly recommended: boolean;
  readonly voice: string;
  readonly cells: Readonly<Record<DimensionId, ComparisonCell>>;
  readonly flow: readonly ConsequenceStep[];
}

/** La frase fissa sugli effetti sociali: non calcolati, mai presentati come tali. */
export const SOCIAL_EFFECTS_NOTE =
  'Gli effetti sociali (consenso, occupazione) non sono calcolati dal motore: restano un’ipotesi qualitativa, non una previsione.';

const unavailable = (what: string): ComparisonCell => ({
  value: `${what}: non dichiarato dal motore`,
  basis: 'unavailable',
});

function workItem(road: TreasuryRoad): CabinetItemView | null {
  return road.order.kind === 'work' ? road.order.item : null;
}

/** L'incertezza si legge dalla provenienza delle cifre dell'opera, non si stima. */
function uncertaintyCell(item: CabinetItemView | null): ComparisonCell {
  if (!item || item.figures.length === 0) {
    return { value: 'dichiarata', basis: 'declared' };
  }
  const unknown = item.figures.filter(figure => figure.basis.kind === 'unknown');
  if (unknown.length > 0) {
    return {
      value: `dato mancante su ${unknown.map(figure => figure.label).join(', ')}`,
      basis: 'unavailable',
    };
  }
  if (item.figures.some(figure => figure.basis.kind === 'estimated')) {
    return { value: 'una voce stimata', basis: 'estimated' };
  }
  return { value: 'misurata sui dati del motore', basis: 'measured' };
}

function coverageCell(road: TreasuryRoad, item: CabinetItemView | null): ComparisonCell {
  const declaration = item?.declaration;
  if (!declaration) {
    return unavailable('Copertura');
  }
  if (declaration.funded) return { value: 'distinta coperta', basis: 'declared' };
  const missing = (declaration.missingMaterials ?? []).map(material => `${material.resourceId} (${material.missing})`);
  return {
    value: missing.length > 0 ? `scoperta: ${missing.join(', ')}` : 'distinta non coperta',
    basis: 'declared',
  };
}

function constraintsCell(road: TreasuryRoad): ComparisonCell {
  const prerequisites = road.order.kind === 'work' ? road.order.path.prerequisites : [];
  return prerequisites.length > 0
    ? { value: prerequisites.join(', '), basis: 'declared' }
    : { value: 'nessun prerequisito dichiarato', basis: 'declared' };
}

function flowFor(road: TreasuryRoad, item: CabinetItemView | null): ConsequenceStep[] {
  if (item) {
    return [
      { label: 'Finanziamento', detail: `Costo immediato ${road.declaredCost}: la cassa la addebita il motore all’esecuzione.`, kind: 'simulated' },
      { label: 'Cantiere', detail: 'Il motore apre il cantiere e scala i materiali dichiarati nella distinta.', kind: 'simulated' },
      { label: 'Capacità del servizio', detail: 'Effetto dichiarato dal catalogo dell’opera: il motore non lo simula passo per passo.', kind: 'declared' },
      { label: 'Effetti sociali', detail: SOCIAL_EFFECTS_NOTE, kind: 'not-simulated' },
    ];
  }
  return [
    { label: 'Impegno di cassa', detail: `${road.declaredCost} impegnati anziché rifinanziati.`, kind: 'declared' },
    { label: 'Scadenza', detail: 'Il titolo in scadenza non viene rifinanziato.', kind: 'declared' },
    { label: 'Interessi', detail: road.expectedGain, kind: 'declared' },
    { label: 'Effetti sociali', detail: SOCIAL_EFFECTS_NOTE, kind: 'not-simulated' },
  ];
}

/** Il confronto tra le strade dichiarate dal motore, cella per cella. */
export function compareRoads(roads: readonly TreasuryRoad[]): RoadComparison[] {
  return roads.map(road => {
    const item = workItem(road);
    return {
      roadId: road.id,
      title: road.title,
      recommended: road.recommended,
      voice: road.voice,
      cells: {
        initial: { value: road.declaredCost, basis: 'declared' },
        recurring: unavailable('Spesa ricorrente'),
        timing: unavailable('Tempi'),
        coverage: coverageCell(road, item),
        constraints: constraintsCell(road),
        benefit: { value: road.expectedGain, basis: 'declared' },
        uncertainty: uncertaintyCell(item),
      },
      flow: flowFor(road, item),
    };
  });
}

/** Quante dimensioni il motore non dichiara: la tavola lo dice nel contesto. */
export function countUnavailable(comparison: readonly RoadComparison[]): number {
  return comparison.reduce((total, road) => (
    total + COMPARISON_DIMENSIONS.filter(dimension => road.cells[dimension.id].basis === 'unavailable').length
  ), 0);
}
