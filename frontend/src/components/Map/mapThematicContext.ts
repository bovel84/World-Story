/**
 * MAP P5 — contesto tematico del territorio (read model puro)
 * ==========================================================
 * La mappa di MAP P3 risponde a «dove». Questo modulo risponde a «che cosa
 * significa», per il territorio selezionato, **senza** aggiungere un secondo
 * motore e **senza** inventare geografia:
 *
 *   layer attivo → regione canonica → modello P3 (stesso oggetto) → dossier
 *
 * Regole di ferro:
 *  - nessun fetch, nessuna mutazione, nessuna simulazione, nessuno stato;
 *  - i valori economici vengono dal **modello P3** (`buildEconomyMapModel`):
 *    stesso bucket, stesse soglie di quantile, stesso colore del layer;
 *  - le risorse sono solo quelle con `regionId` canonico (`canonicalResourceSites`);
 *    gli stock nazionali non vengono distribuiti sulle province;
 *  - infrastrutture e tipo di opera usano `infrastructureKind()`, non copie;
 *  - `PowerAgenda` e `Commitment` appartengono alla **polity**: qui vengono
 *    esposti come contesto della potenza, mai come fatto provinciale;
 *  - nessuna causa viene dedotta per i cambiamenti: solo `changedRegionIds`.
 */
import type { Commitment, OperatingPicturePayload, PowerAgenda, StrategicObjective } from '../../services/api';
import type { WorldMapAssetsPayload } from '../../services/api';
import type { MapObject, Region } from '../../types';
import { constructionReport } from '../../utils/construction';
import { mapLayerDefinition, type MapLayer } from './mapModel';
import {
  DIPLOMACY_COLORS,
  DIPLOMACY_LABELS,
  economyColorForBucket,
  economyLegendRanges,
  infrastructureKind,
  isEconomyValue,
  type DiplomaticMapStatus,
  type InfrastructureMapItem,
  type CanonicalFacilitySite,
  type MapResourceSite,
  type ResourceSiteCandidate,
  type ThematicMapModel,
} from './thematicMapModel';

// ── Tipi pubblici ──────────────────────────────────────────────────────────
export interface RegionPoliticalContext {
  /** `null` quando il territorio è neutrale: nessun proprietario inventato. */
  ownerId: string | null;
  ownerName: string;
  isPlayer: boolean;
  regionStatus: string;
  borders: number;
  /** Solo `changedRegionIds`: nessuna causa dedotta. */
  changedRecently: boolean;
}

export interface RegionEconomyContext {
  gdp: number | null;
  bucket: number | null;
  bucketCount: number;
  color: string;
  /** Intervallo reale del bucket nella legenda quantitativa P3. */
  range: { min: number | null; max: number | null } | null;
  edges: number[];
  /** False quando il motore non pubblica PIL territoriale per nessuna regione. */
  available: boolean;
}

export interface RegionResourcesContext {
  sites: MapResourceSite[];
  /** Motivo esplicito quando la nazione ha riserve ma nessun sito canonico. */
  unavailableReason: string | null;
}

export interface RegionInfrastructureItem extends InfrastructureMapItem {
  /** Righe di stato già pubblicate dal motore (cantieri). */
  report: Array<{ label: string; value: string }>;
  underConstruction: boolean;
}

export interface RegionInfrastructureContext {
  items: RegionInfrastructureItem[];
  operative: RegionInfrastructureItem[];
  underConstruction: RegionInfrastructureItem[];
  strategic: RegionInfrastructureItem[];
  available: boolean;
}

export interface RegionDiplomacyContext {
  status: DiplomaticMapStatus;
  label: string;
  /** Colore **identico** a quello disegnato sulla mappa per questo stato. */
  color: string;
  /** False quando `relationships` non è disponibile: lo stato resta «sconosciuto». */
  available: boolean;
  /** Valore canonico pubblicato dal motore (`ally`/`neutral`/`hostile`), se esiste. */
  relationshipValue: string | null;
}

export interface RegionTerrainContext {
  surfaceType: string | null;
  /** Solo chiavi fisiche **già presenti** nei metadati canonici. */
  facts: Array<{ label: string; value: string }>;
}

export interface PolityAgendaContext {
  polityId: string;
  name: string;
  objectives: StrategicObjective[];
}

export interface PolityCommitmentsContext {
  /** `status === 'active'` secondo il registro del motore. */
  active: Commitment[];
  /** Storico pubblicato (concluso, rotto, scaduto, sostituito). */
  recent: Commitment[];
}

export interface PolityContext {
  polityId: string;
  name: string;
  relationship: RegionDiplomacyContext | null;
  agenda: PolityAgendaContext | null;
  commitments: PolityCommitmentsContext;
}

/**
 * MAP P5.1 — il contesto della potenza è **nazionale**: non deve occupare la
 * priorità dei layer che rispondono a domande territoriali. Resta quindi
 * visibile solo dove è semanticamente utile (Diplomazia, Politica): negli altri
 * layer — incluso `military`, dove l'esperienza MAP P4 resta prioritaria — le
 * sezioni territoriali vengono prima e questo blocco non compare.
 */
export const POLITY_CONTEXT_LAYERS: readonly MapLayer[] = ['diplomacy', 'political'];

export function showsPolityContext(layer: MapLayer): boolean {
  return POLITY_CONTEXT_LAYERS.includes(layer);
}

export interface RegionThematicContext {
  regionId: string;
  layer: MapLayer;
  layerLabel: string;
  layerDescription: string;
  political: RegionPoliticalContext;
  economy: RegionEconomyContext;
  resources: RegionResourcesContext;
  infrastructure: RegionInfrastructureContext;
  diplomacy: RegionDiplomacyContext;
  changes: { changed: boolean };
  terrain: RegionTerrainContext;
  /** Contesto della **potenza**: mai fatti della provincia. */
  polity: PolityContext | null;
}

/** Chiavi di metadati fisici mostrabili: nessuna derivazione, solo presenza. */
export const TERRAIN_FACT_KEYS: ReadonlyArray<{ key: string; label: string }> = [
  { key: 'surface_type', label: 'Superficie' },
  { key: 'terrain', label: 'Terreno' },
  { key: 'terrain_type', label: 'Tipo di terreno' },
  { key: 'relief', label: 'Rilievo' },
  { key: 'coast', label: 'Costa' },
  { key: 'water', label: 'Acqua' },
];

/** Storico impegni mostrato: leggibilità prima del volume. */
export const COMMITMENTS_RECENT_LIMIT = 5;

/** Nome leggibile della polity, dagli stessi campi canonici usati dal dossier. */
export function polityLabel(polityId: string, regions: readonly Region[]): string {
  if (!polityId || polityId === 'neutral') return 'Neutrale';
  const representative = regions.find(region => region.owner === polityId && region.polityName)
    ?? regions.find(region => region.owner === polityId);
  return representative?.polityName || representative?.name || polityId;
}

function ownerIdOf(region: Region): string | null {
  return region.owner && region.owner !== 'neutral' ? region.owner : null;
}

/**
 * MAP P5.1 — **una sola** classificazione diplomatica: quella di MAP P3
 * (`buildDiplomacyMapModel` / `diplomaticRegionStatus`). Qui il valore viene
 * soltanto letto dal modello condiviso, così mappa e dossier non possono
 * divergere (`neutral` resta `neutral` con la matrice disponibile, `unknown`
 * resta `unknown` senza matrice).
 */
function diplomacyFromModel(input: {
  regionId: string;
  ownerId: string | null;
  playerPolityId?: string | null;
  relationships?: Record<string, Record<string, string>> | null;
  model: ThematicMapModel;
}): RegionDiplomacyContext {
  const status: DiplomaticMapStatus = input.model.diplomacy.byRegion[input.regionId] ?? 'unknown';
  const relationshipValue = input.ownerId && input.playerPolityId
    ? input.relationships?.[input.playerPolityId]?.[input.ownerId] ?? null
    : null;
  return {
    status,
    label: DIPLOMACY_LABELS[status],
    color: DIPLOMACY_COLORS[status],
    available: input.model.diplomacy.available,
    relationshipValue,
  };
}

function commitmentsFor(polityId: string, registry: readonly Commitment[] | null | undefined): PolityCommitmentsContext {
  const involved = (registry || []).filter(item => item.actor === polityId || item.counterparty === polityId);
  const active = involved.filter(item => item.status === 'active');
  const recent = involved
    .filter(item => item.status !== 'active')
    .sort((a, b) => String(b.updatedDate || '').localeCompare(String(a.updatedDate || '')))
    .slice(0, COMMITMENTS_RECENT_LIMIT);
  return { active, recent };
}

function agendaFor(polityId: string, agenda: { powers: PowerAgenda[] } | null | undefined): PolityAgendaContext | null {
  const power = agenda?.powers?.find(item => item.polityId === polityId);
  if (!power) return null;
  return { polityId: power.polityId, name: power.name, objectives: power.objectives || [] };
}

export interface BuildRegionThematicContextInput {
  region: Region;
  activeLayer: MapLayer;
  /** Modello P3 già costruito: **stessa** istanza che disegna la mappa. */
  model: ThematicMapModel;
  regions: readonly Region[];
  playerPolityId?: string | null;
  relationships?: Record<string, Record<string, string>> | null;
  changedRegionIds?: readonly string[];
  strategicAgenda?: { powers: PowerAgenda[] } | null;
  commitments?: readonly Commitment[] | null;
}

export function buildRegionThematicContext(input: BuildRegionThematicContextInput): RegionThematicContext {
  const { region, model } = input;
  const ownerId = ownerIdOf(region);
  const changed = (input.changedRegionIds || []).includes(region.id);
  const layer = mapLayerDefinition(input.activeLayer);

  // Economia: il valore/bucket/colore vengono dal modello P3, non ricalcolati.
  const economyValue = model.economy.byRegion[region.id];
  const ranges = economyLegendRanges(model.economy);
  const range = economyValue ? ranges[economyValue.bucket] ?? null : null;

  // Risorse: solo siti canonici del territorio; nessuno stock nazionale sparso.
  const sites = model.resources.byRegion[region.id] || [];

  // Infrastrutture: stessa classificazione del layer (`infrastructureKind`).
  const objectsById = new Map<string, MapObject>((region.objects || []).map(object => [object.id, object]));
  const infrastructureItems: RegionInfrastructureItem[] = (model.infrastructure.byRegion[region.id] || []).map(item => {
    const object = objectsById.get(item.id);
    const underConstruction = item.type === 'construction_site';
    return {
      ...item,
      report: object ? constructionReport(object) : [],
      underConstruction,
    };
  });

  const diplomacy = diplomacyFromModel({
    regionId: region.id, ownerId, playerPolityId: input.playerPolityId,
    relationships: input.relationships, model,
  });

  const metadata = region.metadata || {};
  const terrainFacts = TERRAIN_FACT_KEYS
    .filter(entry => entry.key !== 'surface_type' && metadata[entry.key] !== undefined && metadata[entry.key] !== null)
    .map(entry => ({ label: entry.label, value: String(metadata[entry.key]) }));

  return {
    regionId: region.id,
    layer: input.activeLayer,
    layerLabel: layer.label,
    layerDescription: layer.description,
    political: {
      ownerId,
      ownerName: ownerId ? polityLabel(ownerId, input.regions) : 'Neutrale',
      isPlayer: Boolean(ownerId && input.playerPolityId && ownerId === input.playerPolityId),
      regionStatus: region.status,
      borders: region.borders?.length || 0,
      changedRecently: changed,
    },
    economy: {
      gdp: isEconomyValue(region.gdp) ? region.gdp : null,
      bucket: economyValue ? economyValue.bucket : null,
      bucketCount: model.economy.bucketCount,
      color: economyColorForBucket(economyValue ? economyValue.bucket : null),
      range,
      edges: model.economy.edges,
      available: model.economy.available,
    },
    resources: {
      sites,
      unavailableReason: sites.length ? null : model.resources.unavailableReason ?? null,
    },
    infrastructure: {
      items: infrastructureItems,
      // Gruppi mutuamente esclusivi: un'installazione strategica non è anche «operativa».
      operative: infrastructureItems.filter(item => !item.underConstruction && !item.strategic),
      underConstruction: infrastructureItems.filter(item => item.underConstruction),
      strategic: infrastructureItems.filter(item => item.strategic),
      available: model.infrastructure.available,
    },
    diplomacy,
    changes: { changed },
    terrain: {
      surfaceType: metadata.surface_type ? String(metadata.surface_type) : null,
      facts: terrainFacts,
    },
    // Contesto della potenza: agenda e impegni sono **nazionali**, non provinciali.
    polity: ownerId ? {
      polityId: ownerId,
      name: polityLabel(ownerId, input.regions),
      relationship: diplomacy,
      agenda: agendaFor(ownerId, input.strategicAgenda),
      commitments: commitmentsFor(ownerId, input.commitments),
    } : null,
  };
}

/** Il layer attivo ha una sezione tematica propria nel dossier? */
export function layerHasThematicSection(layer: MapLayer): boolean {
  return layer !== 'military';
}

/**
 * MAP P5.1 — candidati risorsa **geografici**: solo oggetti operativi di tipo
 * `mine` con un `regionId` pubblicato dal motore. La geografia non viene mai
 * dedotta dal nome della miniera o della risorsa.
 *
 * Il tipo della risorsa non è pubblicato in modo machine-readable (vive nel
 * `label` e nell'`id`): nessun parsing testuale, quindi si usa il valore tecnico
 * neutro `mine` già previsto dal read model.
 */
export const RESOURCE_SITE_KIND = 'mine';

/**
 * MAP P6 — candidati risorsa **canonici e mondiali**: giacimenti di tutte le
 * potenze pubblicati dal catalogo. `kind` è il vero `resourceId` e `label` il
 * `resourceName` dichiarato dal catalogo: nessun parsing del testo.
 * La geografia è solo `regionId` (il modello P3 scarta gli id sconosciuti).
 */
export function resourceCandidatesFromWorldAssets(
  assets?: WorldMapAssetsPayload | null,
): ResourceSiteCandidate[] {
  return (assets?.resources || []).map(site => ({
    id: site.id,
    kind: site.resourceId,
    label: site.resourceName,
    regionId: site.regionId,
    accessibility: site.accessibility,
    known: site.known,
    ...(site.estimated ? { estimated: { low: site.estimated.low, base: site.estimated.base, high: site.estimated.high } } : {}),
  }));
}

/** MAP P6 — impianti canonici per il layer Infrastrutture (stessa fonte del dossier). */
export function canonicalFacilitiesFromWorldAssets(
  assets?: WorldMapAssetsPayload | null,
): CanonicalFacilitySite[] {
  return (assets?.facilities || []).map(site => ({
    id: site.id,
    regionId: site.regionId,
    typeId: site.typeId,
    typeName: site.typeName,
    operational: site.operational,
    ownerActorId: site.ownerActorId,
    ...(site.ownerActorName ? { ownerActorName: site.ownerActorName } : {}),
    controllerActorId: site.controllerActorId,
    ...(site.controllerActorName ? { controllerActorName: site.controllerActorName } : {}),
    polityId: site.polityId,
    controllerPolityId: site.controllerPolityId,
  }));
}

/**
 * MAP P5.1 — candidati dal quadro operativo del giocatore (`kind: 'mine'` con
 * `regionId` pubblicato). Da MAP P6 è **fallback/enrichment**: la sorgente
 * mondiale sono i giacimenti canonici del catalogo.
 */
export function resourceCandidatesFromOperatingPicture(
  picture?: OperatingPicturePayload | null,
): ResourceSiteCandidate[] {
  return (picture?.objects || [])
    .filter(object => object.kind === 'mine' && Boolean(object.regionId))
    .map(object => ({
      id: object.id,
      kind: RESOURCE_SITE_KIND,
      label: object.label,
      ...(object.statusLabel ? { status: object.statusLabel } : {}),
      regionId: object.regionId as string,
    }));
}

// Ri-esportazioni: i consumatori del dossier usano un solo import.
export { infrastructureKind };
export type { CanonicalFacilitySite, InfrastructureMapItem, MapResourceSite };
