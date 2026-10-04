/**
 * WS-GOV-PRESET-REALITY-RESIDUALS §1/§2 — Materializzazione per TIPO, senza
 * doppio conteggio e senza lasciare capacità non rappresentata.
 *
 * Il conto nazionale dichiara una CAPACITÀ (ports, factories) che per un paese
 * non-authored dal preset (es. KHM) non ha inventario. Qui la capacità diventa
 * rappresentazione canonica deterministica:
 *  - per ogni categoria si confronta `capacità` e `inventario esistente` e si
 *    materializza SOLO la parte mancante (una strada authored non impedisce i
 *    porti mancanti, un porto authored non impedisce le fabbriche);
 *  - i porti vanno solo su coste reali; le fabbriche sulla provincia più
 *    popolosa, distribuite in round-robin deterministico;
 *  - la capacità in eccesso rispetto alle province si rappresenta con `level`:
 *    `Σ level` degli asset derivati **equivale** alla capacità dichiarata;
 *  - ogni oggetto porta `metadata.derivedFrom = 'national_capacity'` (interno):
 *    `WorldStateEngine` non li conta, perché li rappresenta già la baseline.
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

/** Capacità già rappresentata da oggetti authored, per tipo: usa `level`. */
function authoredCapacity(regions: readonly DerivedInfrastructureRegion[], polityId: string, kind: 'port' | 'factory'): number {
  let total = 0;
  for (const region of regions) {
    if (region.owner !== polityId) continue;
    for (const object of region.objects ?? []) {
      if (canonicalAssetKind(typeOf(object)) !== kind) continue;
      if (!object || typeof object !== 'object') continue;
      const level = Number((object as { level?: unknown }).level);
      total += Number.isFinite(level) && level > 0 ? Math.floor(level) : 1;
    }
  }
  return total;
}

const hasKind = (region: DerivedInfrastructureRegion, kind: 'port' | 'factory'): boolean =>
  (region.objects ?? []).some(object => canonicalAssetKind(typeOf(object)) === kind);

/**
 * Regioni candidate per un tipo: prima quelle che NON hanno già un asset di
 * quel tipo (una strada authored non blocca i porti, un porto authored non
 * blocca le fabbriche), poi — se la capacità è maggiore — anche le altre.
 */
function candidatesFor(
  regions: readonly DerivedInfrastructureRegion[],
  kind: 'port' | 'factory',
  compatible: (region: DerivedInfrastructureRegion) => boolean,
): DerivedInfrastructureRegion[] {
  const eligible = regions.filter(compatible);
  const free = eligible.filter(region => !hasKind(region, kind));
  return [...free, ...eligible.filter(region => hasKind(region, kind))];
}

/** Round-robin deterministico: `Σ level` = `count` sulle regioni candidate. */
function distribute(count: number, regions: readonly DerivedInfrastructureRegion[]): Map<string, number> {
  const levels = new Map<string, number>();
  if (count <= 0 || regions.length === 0) return levels;
  for (let index = 0; index < count; index += 1) {
    const region = regions[index % regions.length]!;
    levels.set(region.id, (levels.get(region.id) ?? 0) + 1);
  }
  return levels;
}

/** Oggetti da aggiungere per regione. Vuoto se non c'è capacità mancante. */
export function derivedInfrastructureObjects(
  regions: readonly DerivedInfrastructureRegion[],
  polityId: string,
  capacity: DerivedInfrastructureCapacity,
): Map<string, unknown[]> {
  const additions = new Map<string, unknown[]>();
  const owned = regions.filter(region => region.owner === polityId);
  if (!owned.length) return additions;
  const byPopulation = [...owned].sort((left, right) => (right.population ?? 0) - (left.population ?? 0));

  const push = (region: DerivedInfrastructureRegion, object: Record<string, unknown>): void => {
    const list = additions.get(region.id);
    if (list) list.push(object);
    else additions.set(region.id, [object]);
  };
  const derived = (type: 'port' | 'factory', region: DerivedInfrastructureRegion, level: number): void => push(region, {
    id: `derived-${type}-${region.id}`, type, name: type === 'port' ? `Porto di ${region.name}` : `Stabilimento di ${region.name}`,
    owner: polityId, level, metadata: { status: 'operational', source: 'bootstrap', derivedFrom: 'national_capacity' },
  });

  // §1 — Porti: SOLO la parte mancante, solo su coste reali.
  const missingPorts = Math.max(0, Math.floor(capacity.ports || 0) - authoredCapacity(owned, polityId, 'port'));
  const coastal = candidatesFor(byPopulation, 'port', region => region.coastal === true);
  for (const [regionId, level] of distribute(missingPorts, coastal)) {
    const region = coastal.find(item => item.id === regionId);
    if (region) derived('port', region, level);
  }

  // §2 — Fabbriche: SOLO la parte mancante; l'eccesso rispetto alle province
  // diventa `level`, così `Σ level` equivale alla capacità dichiarata.
  const missingFactories = Math.max(0, Math.floor(capacity.factories || 0) - authoredCapacity(owned, polityId, 'factory'));
  const industrial = candidatesFor(byPopulation, 'factory', () => true);
  for (const [regionId, level] of distribute(missingFactories, industrial)) {
    const region = industrial.find(item => item.id === regionId);
    if (region) derived('factory', region, level);
  }
  return additions;
}
