/**
 * WS-GOV-PRESET-REALITY-PIPELINE §1 — Una sola realtà per il paese giocatore.
 *
 * Il conto nazionale dichiara una CAPACITÀ derivata (ports, factories) anche per
 * un paese non-authored dal preset (es. KHM in `millennium_dawn`: selezionabile,
 * assente da `simulation/polities.json`, treasuries/inventory vuoti). Senza
 * materializzazione il dossier mostrava «ports: 2» e l'inventario canonico era
 * vuoto: due realtà per lo stesso paese.
 *
 * Qui la capacità diventa l'UNICA rappresentazione canonica: oggetti
 * deterministici su regioni CONTROLLATE e compatibili (i porti solo su coste),
 * marcati internamente `metadata.derivedFrom` (invisibile al giocatore).
 * `WorldStateEngine` non li conta nell'account (li rappresenta già la baseline),
 * così capacità e inventario dicono lo stesso numero.
 */
import { canonicalAssetKind } from './CanonicalAssetTypes';

export interface DerivedInfrastructureRegion {
  readonly id: string;
  readonly name: string;
  readonly owner: string;
  readonly coastal?: boolean;
  readonly population?: number;
  readonly objects?: readonly unknown[];
}

export interface DerivedInfrastructureCapacity {
  readonly ports: number;
  readonly factories: number;
}

const typeOf = (object: unknown): string | null => {
  if (!object || typeof object !== 'object') return null;
  const value = (object as { type?: unknown }).type;
  return typeof value === 'string' ? value : null;
};
const isDerived = (object: unknown): boolean => {
  if (!object || typeof object !== 'object') return false;
  const metadata = (object as { metadata?: unknown }).metadata;
  return !!metadata && typeof metadata === 'object'
    && (metadata as { derivedFrom?: unknown }).derivedFrom === 'national_capacity';
};

/** Oggetti da aggiungere per regione. Vuoto se non serve o non è il caso. */
export function derivedInfrastructureObjects(
  regions: readonly DerivedInfrastructureRegion[],
  polityId: string,
  capacity: DerivedInfrastructureCapacity,
): Map<string, unknown[]> {
  const additions = new Map<string, unknown[]>();
  const owned = regions.filter(region => region.owner === polityId);
  if (!owned.length) return additions;
  // Il paese ha già una realtà infrastrutturale authored: non si tocca nulla.
  if (owned.some(region => (region.objects ?? []).some(object => canonicalAssetKind(typeOf(object))))) return additions;

  const byPopulation = [...owned].sort((left, right) => (right.population ?? 0) - (left.population ?? 0));
  const ports = Math.max(0, Math.floor(capacity.ports || 0));
  const factories = Math.max(0, Math.floor(capacity.factories || 0));
  const push = (region: DerivedInfrastructureRegion, object: Record<string, unknown>): void => {
    const list = additions.get(region.id);
    if (list) list.push(object);
    else additions.set(region.id, [object]);
  };

  // Porti: solo su coste reali, dalla più popolosa; mai più di una per provincia.
  const coastal = byPopulation.filter(region => region.coastal === true);
  for (let index = 0; index < Math.min(ports, coastal.length); index += 1) {
    const region = coastal[index]!;
    push(region, {
      id: `derived-port-${region.id}`, type: 'port', name: `Porto di ${region.name}`,
      owner: polityId, level: 1,
      metadata: { status: 'operational', source: 'bootstrap', derivedFrom: 'national_capacity' },
    });
  }
  // Stabilimenti: sulla provincia più popolosa, fino alla capacità.
  for (let index = 0; index < Math.min(factories, byPopulation.length); index += 1) {
    const region = byPopulation[index]!;
    push(region, {
      id: `derived-factory-${region.id}`, type: 'factory', name: `Stabilimento di ${region.name}`,
      owner: polityId, level: 1,
      metadata: { status: 'operational', source: 'bootstrap', derivedFrom: 'national_capacity' },
    });
  }
  return additions;
}
