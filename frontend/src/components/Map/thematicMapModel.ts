/**
 * MAP P3 — read model tematico puro
 * =================================
 * Ogni layer risponde a una domanda diversa leggendo **solo** stato canonico:
 *
 *   political      → region.owner / color / polityName
 *   military       → MilitaryUnitState + WarFrontState   (via militaryMapModel)
 *   economy        → region.gdp                          (nessun indice composito)
 *   resources      → solo siti con regionId canonico     (mai riserve nazionali sparse)
 *   infrastructure → region.objects geolocalizzati
 *   diplomacy      → relationships[player][owner]        (nessuna inferenza da eventi)
 *   changes        → changedRegionIds / cicatrici         (invariato da MAP P1)
 *   terrain        → base cartografica, colori attenuati
 *
 * Nessun valore viene inventato o persistito: qui vive soltanto presentazione
 * derivata, tutta testabile senza MapLibre.
 */
import type { Region } from '../../types';
import {
  INFRASTRUCTURE_OBJECT_TYPES,
  MILITARY_OBJECT_TYPES,
  STRATEGIC_OBJECT_TYPES,
  type MapLayer,
} from './mapModel';

// ── Matrice di presentazione (unico punto, niente condizioni sparse) ───────
export interface MapLayerPresentation {
  id: MapLayer;
  /** Opacità del riempimento politico di base. */
  politicalFillOpacity: number;
  /** Riempimento coropletico tematico (economia/diplomazia) o nessuno. */
  thematic: 'none' | 'economy' | 'diplomacy';
  /** Overlay militare persistente P2 in evidenza. */
  emphasizeMilitary: boolean;
  /** Enfasi sulle opere territoriali. */
  emphasizeInfrastructure: boolean;
  /** Zoom minimo (virtuale) sotto cui le opere del layer restano visibili. */
  infrastructureMinZoom: number;
  /** Il layer richiede siti risorsa canonici. */
  needsResourceSites: boolean;
}

export const MAP_LAYER_PRESENTATIONS: Record<MapLayer, MapLayerPresentation> = {
  political: { id: 'political', politicalFillOpacity: 0.52, thematic: 'none', emphasizeMilitary: false, emphasizeInfrastructure: false, infrastructureMinZoom: 2.6, needsResourceSites: false },
  military: { id: 'military', politicalFillOpacity: 0.25, thematic: 'none', emphasizeMilitary: true, emphasizeInfrastructure: false, infrastructureMinZoom: 2.6, needsResourceSites: false },
  economy: { id: 'economy', politicalFillOpacity: 0.72, thematic: 'economy', emphasizeMilitary: false, emphasizeInfrastructure: false, infrastructureMinZoom: 2.6, needsResourceSites: false },
  resources: { id: 'resources', politicalFillOpacity: 0.18, thematic: 'none', emphasizeMilitary: false, emphasizeInfrastructure: false, infrastructureMinZoom: 2.6, needsResourceSites: true },
  infrastructure: { id: 'infrastructure', politicalFillOpacity: 0.2, thematic: 'none', emphasizeMilitary: false, emphasizeInfrastructure: true, infrastructureMinZoom: 2.0, needsResourceSites: false },
  diplomacy: { id: 'diplomacy', politicalFillOpacity: 0.72, thematic: 'diplomacy', emphasizeMilitary: false, emphasizeInfrastructure: false, infrastructureMinZoom: 2.6, needsResourceSites: false },
  changes: { id: 'changes', politicalFillOpacity: 0.18, thematic: 'none', emphasizeMilitary: false, emphasizeInfrastructure: false, infrastructureMinZoom: 2.6, needsResourceSites: false },
  terrain: { id: 'terrain', politicalFillOpacity: 0.12, thematic: 'none', emphasizeMilitary: false, emphasizeInfrastructure: false, infrastructureMinZoom: 2.6, needsResourceSites: false },
};

export function mapLayerPresentation(layer: MapLayer): MapLayerPresentation {
  return MAP_LAYER_PRESENTATIONS[layer] ?? MAP_LAYER_PRESENTATIONS.political;
}

// ── Palette tematica centralizzata ─────────────────────────────────────────
export const THEMATIC_NO_DATA_COLOR = '#3a4150';

export const ECONOMY_BUCKET_COUNT = 5;
/** Scala sequenziale dedicata: mai colori politici per l'economia. */
export const ECONOMY_COLORS = ['#1f3a52', '#2c5f78', '#3f8a93', '#6fb391', '#a9d69a'];

export type DiplomaticMapStatus = 'player' | 'ally' | 'neutral' | 'hostile' | 'unknown';
export const DIPLOMACY_COLORS: Record<DiplomaticMapStatus, string> = {
  player: '#3f7fbf', ally: '#4f9d6a', neutral: '#8c8f98', hostile: '#c0503f', unknown: THEMATIC_NO_DATA_COLOR,
};
export const DIPLOMACY_LABELS: Record<DiplomaticMapStatus, string> = {
  player: 'Il tuo Stato', ally: 'Alleato', neutral: 'Neutrale', hostile: 'Ostile', unknown: 'Sconosciuto',
};

// ── Economia — region.gdp, nessun indice composito ─────────────────────────
export interface EconomyRegionValue { gdp: number; bucket: number; }
export interface EconomyMapModel {
  byRegion: Record<string, EconomyRegionValue>;
  /** Regioni senza dato (0, NaN, undefined legacy): stile «no data». */
  noData: string[];
  /** Soglie di quantile reali derivate dal dataset corrente. */
  edges: number[];
  domain: [number, number] | null;
  available: boolean;
  bucketCount: number;
}

/** Un PIL è un dato solo se è un numero finito e positivo. */
export function isEconomyValue(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0;
}

/** Quantile con interpolazione lineare su un array già ordinato. */
function quantile(sorted: number[], q: number): number {
  if (!sorted.length) return 0;
  const position = (sorted.length - 1) * q;
  const lower = Math.floor(position);
  const upper = Math.ceil(position);
  if (lower === upper) return sorted[lower];
  return sorted[lower] + (sorted[upper] - sorted[lower]) * (position - lower);
}

/**
 * Soglie **robuste** (quantili): un outlier estremo non schiaccia la scala.
 * Ritorna al più `bucketCount - 1` soglie crescenti e distinte.
 */
export function economyBucketEdges(values: readonly number[], bucketCount = ECONOMY_BUCKET_COUNT): number[] {
  const sorted = values.filter(isEconomyValue).sort((a, b) => a - b);
  if (sorted.length < 2 || bucketCount < 2) return [];
  const edges: number[] = [];
  for (let index = 1; index < bucketCount; index += 1) {
    const edge = quantile(sorted, index / bucketCount);
    if (edges.length && edge <= edges[edges.length - 1]) continue;
    edges.push(edge);
  }
  return edges;
}

/** Bucket = quante soglie il valore supera. `edges` vuoto → sempre 0. */
export function economyBucketFor(value: number, edges: readonly number[]): number {
  let bucket = 0;
  while (bucket < edges.length && value >= edges[bucket]) bucket += 1;
  return bucket;
}

export function economyColorForBucket(bucket: number | null): string {
  if (bucket === null || bucket < 0) return THEMATIC_NO_DATA_COLOR;
  return ECONOMY_COLORS[Math.min(bucket, ECONOMY_COLORS.length - 1)];
}

/**
 * Espressione MapLibre del riempimento tematico (economia/diplomazia).
 * **La selezione non compare**: il colore resta quello del layer anche quando
 * la feature è selezionata. L'evidenza della selezione vive sull'outline di
 * `regions-line`, mai sul riempimento. Così «selezionato» e «significato del
 * layer» restano due cose distinte.
 */
export function thematicFillExpression(): unknown[] {
  return [
    'case',
    ['boolean', ['feature-state', 'hasThematic'], false],
    ['coalesce', ['feature-state', 'thematicColor'], THEMATIC_NO_DATA_COLOR],
    THEMATIC_NO_DATA_COLOR,
  ];
}

export function buildEconomyMapModel(regions: readonly Region[], bucketCount = ECONOMY_BUCKET_COUNT): EconomyMapModel {
  const values = regions.map(region => region.gdp).filter(isEconomyValue);
  const edges = economyBucketEdges(values, bucketCount);
  const byRegion: Record<string, EconomyRegionValue> = Object.create(null);
  const noData: string[] = [];
  for (const region of regions) {
    if (!isEconomyValue(region.gdp)) { noData.push(region.id); continue; }
    byRegion[region.id] = { gdp: region.gdp, bucket: economyBucketFor(region.gdp, edges) };
  }
  const sorted = [...values].sort((a, b) => a - b);
  const domain: [number, number] | null = sorted.length
    ? [sorted[0], sorted[sorted.length - 1]] : null;
  return {
    byRegion, noData, edges, domain,
    available: values.length > 0, bucketCount: edges.length + 1,
  };
}

/** Intervalli leggibili per la legenda quantitativa (range reali, non giudizi). */
export function economyLegendRanges(model: EconomyMapModel): Array<{ index: number; min: number | null; max: number | null }> {
  const ranges: Array<{ index: number; min: number | null; max: number | null }> = [];
  const boundaries = [Number.NEGATIVE_INFINITY, ...model.edges, Number.POSITIVE_INFINITY];
  for (let index = 0; index < boundaries.length - 1; index += 1) {
    ranges.push({
      index,
      min: Number.isFinite(boundaries[index]) ? boundaries[index] as number : null,
      max: Number.isFinite(boundaries[index + 1]) ? boundaries[index + 1] as number : null,
    });
  }
  return ranges;
}

// ── Diplomazia — relationships[player][owner] ──────────────────────────────
export const RELATIONSHIP_VALUES = ['ally', 'neutral', 'hostile'] as const;

/**
 * Classificazione **relativa al giocatore**. L'autorità è sempre la matrice
 * `relationships`; senza di essa (refresh fallito) lo stato è «sconosciuto»,
 * mai una classificazione diplomatica stale.
 */
export function diplomaticRegionStatus(input: {
  owner?: string | null;
  playerPolityId?: string | null;
  relationships?: Record<string, Record<string, string>> | null;
}): DiplomaticMapStatus {
  const owner = input.owner && input.owner !== 'neutral' ? input.owner : null;
  if (!owner) return 'unknown';
  if (input.playerPolityId && owner === input.playerPolityId) return 'player';
  if (!input.relationships || !input.playerPolityId) return 'unknown';
  const relationship = input.relationships[input.playerPolityId]?.[owner];
  if (relationship === 'ally') return 'ally';
  if (relationship === 'hostile') return 'hostile';
  return 'neutral';
}

export interface DiplomacyMapModel {
  byRegion: Record<string, DiplomaticMapStatus>;
  counts: Record<DiplomaticMapStatus, number>;
  available: boolean;
}

export function buildDiplomacyMapModel(
  regions: readonly Region[],
  relationships?: Record<string, Record<string, string>> | null,
  playerPolityId?: string | null,
): DiplomacyMapModel {
  const available = Boolean(relationships) && Boolean(playerPolityId);
  const byRegion: Record<string, DiplomaticMapStatus> = Object.create(null);
  const counts: Record<DiplomaticMapStatus, number> = { player: 0, ally: 0, neutral: 0, hostile: 0, unknown: 0 };
  for (const region of regions) {
    const status: DiplomaticMapStatus = available
      ? diplomaticRegionStatus({ owner: region.owner, playerPolityId, relationships })
      : 'unknown';
    byRegion[region.id] = status;
    counts[status] += 1;
  }
  return { byRegion, counts, available };
}

// ── Infrastrutture — region.objects geolocalizzati ─────────────────────────
export interface InfrastructureMapItem {
  id: string;
  regionId: string;
  type: string;
  name: string;
  /** Installazione strategica (base/radar/…): infrastruttura ma gated dal filtro unità. */
  strategic: boolean;
  /** MAP P6 — origine dell'opera: oggetto del territorio o impianto canonico mondiale. */
  source?: 'territory' | 'canonical';
  /** Tipo canonico dal catalogo (`FacilityInstance.typeId`), mai dedotto dal nome. */
  facilityTypeId?: string;
  operational?: boolean;
  ownerActorId?: string;
  ownerActorName?: string;
  controllerActorId?: string;
  controllerActorName?: string;
  /** Proprietà economica dal registro attori: `region.owner` non viene mai usato. */
  polityId?: string | null;
  controllerPolityId?: string | null;
}

/**
 * MAP P6 — impianto canonico mondiale pubblicato dal catalogo di scenario.
 * La geografia è `regionId`; l'identità è l'`id` canonico.
 */
export interface CanonicalFacilitySite {
  id: string;
  regionId: string;
  typeId: string;
  typeName: string;
  operational: boolean;
  ownerActorId?: string;
  ownerActorName?: string;
  controllerActorId?: string;
  controllerActorName?: string;
  polityId?: string | null;
  controllerPolityId?: string | null;
}

export type InfrastructureKind = 'core' | 'strategic' | null;

export function infrastructureKind(type: string): InfrastructureKind {
  if ((INFRASTRUCTURE_OBJECT_TYPES as readonly string[]).includes(type)) return 'core';
  if ((STRATEGIC_OBJECT_TYPES as readonly string[]).includes(type)) return 'strategic';
  return null;
}

export interface InfrastructureMapModel {
  byRegion: Record<string, InfrastructureMapItem[]>;
  total: number;
  available: boolean;
}

/**
 * MAP P6 — infrastruttura territoriale = oggetti canonici del territorio **più**
 * impianti canonici mondiali del catalogo. Deduplicazione **solo** a id esatto:
 * mai per nome. Un reparto non diventa mai un'opera (la classificazione resta
 * `infrastructureKind`).
 */
export function buildInfrastructureMapModel(
  regions: readonly Region[],
  canonicalFacilities: readonly CanonicalFacilitySite[] = [],
): InfrastructureMapModel {
  const byRegion: Record<string, InfrastructureMapItem[]> = Object.create(null);
  const seen = new Set<string>();
  const worldRegionIds = new Set(regions.map(region => region.id));
  let total = 0;
  for (const region of regions) {
    const items: InfrastructureMapItem[] = [];
    for (const object of region.objects || []) {
      const kind = infrastructureKind(object.type);
      if (!kind) continue;
      seen.add(object.id);
      items.push({ id: object.id, regionId: region.id, type: object.type, name: object.name, strategic: kind === 'strategic', source: 'territory' });
    }
    if (items.length) { byRegion[region.id] = items; total += items.length; }
  }
  for (const site of canonicalFacilities) {
    // Geografia canonica: un impianto la cui regione non esiste nel mondo è
    // un sito orfano e non entra nel modello.
    if (!site.regionId || !worldRegionIds.has(site.regionId) || seen.has(site.id)) continue;
    // Un reparto non è mai un'opera, nemmeno se pubblicato come facility.
    if ((MILITARY_OBJECT_TYPES as readonly string[]).includes(site.typeId)) continue;
    seen.add(site.id);
    (byRegion[site.regionId] ??= []).push({
      id: site.id,
      regionId: site.regionId,
      type: 'facility',
      name: site.typeName || site.typeId,
      strategic: false,
      source: 'canonical',
      facilityTypeId: site.typeId,
      operational: site.operational,
      ...(site.ownerActorId ? { ownerActorId: site.ownerActorId } : {}),
      ...(site.ownerActorName ? { ownerActorName: site.ownerActorName } : {}),
      ...(site.controllerActorId ? { controllerActorId: site.controllerActorId } : {}),
      ...(site.controllerActorName ? { controllerActorName: site.controllerActorName } : {}),
      polityId: site.polityId ?? null,
      controllerPolityId: site.controllerPolityId ?? null,
    });
    total += 1;
  }
  return { byRegion, total, available: total > 0 };
}

// ── Risorse — SOLO geolocalizzazione canonica ──────────────────────────────
export interface MapResourceSite {
  id: string;
  regionId: string;
  /** Id canonico della risorsa dal catalogo (`coal`, `iron_ore`, …) o tipo tecnico. */
  kind: string;
  label: string;
  status?: string;
  accessibility?: 'open' | 'requires_extraction';
  known?: boolean;
  estimated?: { low: string; base: string; high: string };
}

/**
 * Qualsiasi candidato (riserva nazionale, oggetto estrattivo, giacimento
 * canonico P6) con eventuale `regionId`. I campi `accessibility`/`known`/
 * `estimated` sono la semantica pubblicata dal motore per i giacimenti canonici.
 */
export interface ResourceSiteCandidate {
  id?: string;
  kind: string;
  label?: string;
  status?: string;
  regionId?: string | null;
  accessibility?: 'open' | 'requires_extraction';
  /** `false` = dato autorevole mancante: ignoranza, mai assenza. */
  known?: boolean;
  estimated?: { low: string; base: string; high: string };
}

/**
 * `NationalResourceSummary` è uno stato **nazionale**, non un'allocazione
 * geografica: una riserva senza `regionId` non viene mai posizionata. Vengono
 * accettati soltanto i candidati con `regionId` che esiste davvero nel mondo.
 */
export function canonicalResourceSites(
  candidates: readonly ResourceSiteCandidate[],
  regions: readonly Region[],
): MapResourceSite[] {
  const regionIds = new Set(regions.map(region => region.id));
  const sites: MapResourceSite[] = [];
  let index = 0;
  for (const candidate of candidates) {
    index += 1;
    if (!candidate.regionId || !regionIds.has(candidate.regionId)) continue;
    sites.push({
      id: candidate.id || `${candidate.kind}-${candidate.regionId}-${index}`,
      regionId: candidate.regionId,
      kind: candidate.kind,
      label: candidate.label || candidate.kind,
      ...(candidate.status ? { status: candidate.status } : {}),
      ...(candidate.accessibility ? { accessibility: candidate.accessibility } : {}),
      ...(candidate.known === undefined ? {} : { known: candidate.known }),
      ...(candidate.estimated ? { estimated: candidate.estimated } : {}),
    });
  }
  return sites;
}

export interface ResourceMapModel {
  sites: MapResourceSite[];
  byRegion: Record<string, MapResourceSite[]>;
  available: boolean;
  unavailableReason?: string;
}

export const RESOURCES_UNAVAILABLE_REASON =
  'Le risorse naturali sono registrate a livello nazionale: nessuna ha ancora una localizzazione territoriale canonica.';

export function buildResourceMapModel(input: {
  regions: readonly Region[];
  candidates?: readonly ResourceSiteCandidate[];
  /** MAP P6 — motivo esplicito (es. sorgente canonica non disponibile). */
  unavailableReason?: string;
}): ResourceMapModel {
  const sites = canonicalResourceSites(input.candidates || [], input.regions);
  const byRegion: Record<string, MapResourceSite[]> = Object.create(null);
  for (const site of sites) (byRegion[site.regionId] ??= []).push(site);
  if (sites.length) return { sites, byRegion, available: true };
  return { sites: [], byRegion, available: false, unavailableReason: input.unavailableReason || RESOURCES_UNAVAILABLE_REASON };
}

// ── Modello combinato ──────────────────────────────────────────────────────
export interface ThematicMapModel {
  economy: EconomyMapModel;
  diplomacy: DiplomacyMapModel;
  infrastructure: InfrastructureMapModel;
  resources: ResourceMapModel;
}

export function buildThematicMapModel(input: {
  regions: readonly Region[];
  relationships?: Record<string, Record<string, string>> | null;
  playerPolityId?: string | null;
  resourceCandidates?: readonly ResourceSiteCandidate[];
  /** MAP P6 — impianti canonici mondiali (catalogo di scenario). */
  worldFacilities?: readonly CanonicalFacilitySite[];
  /** MAP P6 — messaggio fail-closed: la sorgente canonica non è disponibile. */
  resourcesUnavailableReason?: string;
}): ThematicMapModel {
  return {
    economy: buildEconomyMapModel(input.regions),
    diplomacy: buildDiplomacyMapModel(input.regions, input.relationships, input.playerPolityId),
    infrastructure: buildInfrastructureMapModel(input.regions, input.worldFacilities),
    resources: buildResourceMapModel({
      regions: input.regions,
      candidates: input.resourceCandidates,
      ...(input.resourcesUnavailableReason ? { unavailableReason: input.resourcesUnavailableReason } : {}),
    }),
  };
}

/**
 * Messaggio quando un layer è supportato ma non ha dati territoriali da
 * mostrare. `null` = il layer ha qualcosa da disegnare.
 */
export function thematicUnavailableMessage(layer: MapLayer, model: ThematicMapModel): string | null {
  if (layer === 'economy' && !model.economy.available) return 'Nessun dato di PIL territoriale disponibile.';
  if (layer === 'diplomacy' && !model.diplomacy.available) return 'Relazioni diplomatiche non disponibili.';
  if (layer === 'resources' && !model.resources.available) return model.resources.unavailableReason || null;
  if (layer === 'infrastructure' && !model.infrastructure.available) return 'Nessuna opera territoriale pubblicata.';
  return null;
}
