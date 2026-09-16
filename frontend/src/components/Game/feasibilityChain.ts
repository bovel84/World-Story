/**
 * U02 passo 2 — catena della fattibilità (modello puro).
 * =====================================================
 * Trasforma un esito di verifica (`FeasibilityResult` + `FeasibilityExplanation`)
 * in una catena ordinata e leggibile *senza colori*: cosa è richiesto, quali
 * costi dichiara il catalogo, cosa manca (deficit) e da quale fonte viene ogni
 * dato. Nessuna stima nuova: si proiettano soltanto dati già presenti.
 *
 * La stessa vista alimenta sia l'elenco mobile sia la lista/tabella desktop:
 * il testo porta il significato, il colore è solo decorazione.
 */
import type { FeasibilityExplanation } from './feasibilityExplanation';

export interface ChainCostLine {
  readonly resourceId: string;
  readonly name: string;
  readonly quantity: string;
  readonly unit: string;
}

export interface ChainUpkeep {
  readonly line: ChainCostLine;
  readonly periodDays: number;
}

export interface FeasibilityChainCosts {
  readonly basis: 'recipe' | 'upkeep' | 'request' | 'none';
  readonly timeDays: number;
  readonly inputs: readonly ChainCostLine[];
  readonly upkeep: readonly ChainUpkeep[];
  readonly category?: string;
  readonly note?: string;
}

export interface FeasibilityChainInput {
  readonly orderText: string;
  readonly costs: FeasibilityChainCosts;
  readonly prerequisites: readonly string[];
  readonly explanation: FeasibilityExplanation;
}

export type ChainNodeKind = 'richiesta' | 'costo' | 'deficit';

export interface ChainNode {
  readonly kind: ChainNodeKind;
  readonly label: string;
  readonly detail: string;
  /** Da dove viene il dato: bozza, catalogo, richiesta, preflight. */
  readonly source: string;
}

export interface FeasibilityChainView {
  readonly nodes: readonly ChainNode[];
  readonly sources: readonly string[];
  readonly hasCosts: boolean;
  readonly hasDeficit: boolean;
}

export const BASIS_SOURCE: Record<FeasibilityChainCosts['basis'], string> = {
  recipe: 'Catalogo (ricetta di produzione)',
  upkeep: 'Catalogo (mantenimento impianto)',
  request: 'Richiesta esplicita (stima)',
  none: 'Nessun consumo dichiarato',
};

function truncate(text: string, max = 80): string {
  const clean = String(text ?? '').replace(/\s+/g, ' ').trim();
  if (clean.length <= max) return clean;
  return `${clean.slice(0, max - 1).trimEnd()}…`;
}

function lineDetail(quantity: string, unit: string): string {
  const q = String(quantity ?? '').trim();
  const u = String(unit ?? '').trim();
  if (!q) return u || '—';
  return u ? `${q} ${u}` : q;
}

/** Costruisce la catena leggibile; input incompleti non producono nodi inventati. */
export function buildFeasibilityChain(input: FeasibilityChainInput): FeasibilityChainView {
  const nodes: ChainNode[] = [];
  const costs = input.costs ?? ({} as FeasibilityChainCosts);
  const basis: FeasibilityChainCosts['basis'] = costs.basis ?? 'none';

  const requestDetail = costs.category ? `Categoria: ${costs.category}` : 'Ordine in bozza';
  nodes.push({
    kind: 'richiesta',
    label: truncate(input.orderText) || 'Ordine',
    detail: requestDetail,
    source: 'Bozza giocatore',
  });

  const inputs = Array.isArray(costs.inputs) ? costs.inputs : [];
  const upkeep = Array.isArray(costs.upkeep) ? costs.upkeep : [];
  for (const line of inputs) {
    nodes.push({
      kind: 'costo',
      label: line.name || line.resourceId,
      detail: lineDetail(line.quantity, line.unit),
      source:
        basis === 'request'
          ? `${BASIS_SOURCE.request}${costs.note ? ` — ${costs.note}` : ''}`
          : BASIS_SOURCE[basis],
    });
  }
  if (inputs.length === 0 && basis === 'none') {
    nodes.push({
      kind: 'costo',
      label: 'Nessun consumo materiale',
      detail: 'Il catalogo non dichiara input per questo tipo d’ordine.',
      source: BASIS_SOURCE.none,
    });
  }

  for (const entry of upkeep) {
    const line = entry.line;
    nodes.push({
      kind: 'costo',
      label: `Mantenimento ${line?.name || line?.resourceId || ''}`.trim(),
      detail: `${lineDetail(line?.quantity ?? '', line?.unit ?? '')} ogni ${entry.periodDays} giorni`,
      source: BASIS_SOURCE.upkeep,
    });
  }

  const deficitLabels = new Set<string>();
  for (const blocker of input.explanation?.blockers ?? []) {
    const detail = blocker.missing.length > 0 ? blocker.missing.join(', ') : blocker.detail;
    deficitLabels.add(blocker.label);
    nodes.push({
      kind: 'deficit',
      label: blocker.label,
      detail,
      source: 'Preflight (motore)',
    });
  }
  for (const prerequisite of input.prerequisites ?? []) {
    if (!prerequisite || deficitLabels.has(prerequisite)) continue;
    deficitLabels.add(prerequisite);
    nodes.push({
      kind: 'deficit',
      label: 'Prerequisito',
      detail: prerequisite,
      source: 'Preflight (motore)',
    });
  }

  const sources = [...new Set(nodes.map(node => node.source))];
  const hasCosts = inputs.length > 0 || upkeep.length > 0;
  const hasDeficit = nodes.some(node => node.kind === 'deficit');
  return { nodes, sources, hasCosts, hasDeficit };
}
