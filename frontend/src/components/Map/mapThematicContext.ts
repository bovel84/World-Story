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
import type { Commitment, PowerAgenda, StrategicObjective } from '../../services/api';
import type { MapObject, Region } from '../../types';
import { constructionReport } from '../../utils/construction';
import { mapLayerDefinition, type MapLayer } from './mapModel';
import {
  DIPLOMACY_LABELS,
  economyColorForBucket,
  economyLegendRanges,
  infrastructureKind,
  isEconomyValue,
  type DiplomaticMapStatus,
  type InfrastructureMapItem,
  type MapResourceSite,
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

function diplomacyContext(input: {
  ownerId: string | null;
  playerPolityId?: string | null;
  relationships?: Record<string, Record<string, string>> | null;
}): RegionDiplomacyContext {
  const available = Boolean(input.relationships) && Boolean(input.playerPolityId);
  if (!input.ownerId) return { status: 'unknown', label: DIPLOMACY_LABELS.unknown, available, relationshipValue: null };
  if (input.playerPolityId && input.ownerId === input.playerPolityId) {
    return { status: 'player', label: DIPLOMACY_LABELS.player, available, relationshipValue: null };
  }
  if (!available) return { status: 'unknown', label: DIPLOMACY_LABELS.unknown, available: false, relationshipValue: null };
  const value = input.relationships?.[input.playerPolityId as string]?.[input.ownerId] ?? null;
  // `unknown` non è mai `neutral`: se il motore non dichiara il rapporto, resta sconosciuto.
  const status: DiplomaticMapStatus = value === 'ally' || value === 'hostile' || value === 'neutral' ? value : 'unknown';
  return { status, label: DIPLOMACY_LABELS[status], available: true, relationshipValue: value };
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

  const diplomacy = diplomacyContext({
    ownerId, playerPolityId: input.playerPolityId, relationships: input.relationships,
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

/** Candidati risorsa derivati dallo stato nazionale: senza `regionId` non sono siti. */
export function resourceCandidatesFromNational(
  natural: ReadonlyArray<{ kind: string; label: string }> | null | undefined,
): Array<{ id?: string; kind: string; label: string; regionId?: string | null }> {
  return (natural || []).map((item, index) => ({
    id: `national-${item.kind}-${index}`,
    kind: item.kind,
    label: item.label,
    // Il motore non pubblica oggi un `regionId` per le riserve nazionali: il
    // campo resta letto se esiste, altrimenti il sito non viene posizionato.
    regionId: (item as { regionId?: string | null }).regionId ?? null,
  }));
}

// Ri-esportazioni: i consumatori del dossier usano un solo import.
export { infrastructureKind };
export type { InfrastructureMapItem, MapResourceSite };
