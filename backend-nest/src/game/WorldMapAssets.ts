/**
 * MAP P6 — read model della geografia economica canonica mondiale
 * ===============================================================
 * Political/Economy/Diplomacy/Infrastructure leggono il mondo intero; il layer
 * Resources di MAP P5 dipendeva invece dal quadro operativo `/arsenal`, che è
 * **player-scoped**. Questo modulo chiude l'asimmetria pubblicando i giacimenti
 * e gli impianti che il **catalogo di scenario** già possiede per ogni potenza.
 *
 * Regole non negoziabili:
 *  - nessuna risorsa viene generata, spostata, stimata o dedotta dal nome;
 *  - `NaturalResourceSummary` (riserva nazionale) non diventa mai geografia;
 *  - `polityId` deriva **solo** da `ownerActorId → EconomicActor.polityId`,
 *    mai da `region.owner` (occupazione territoriale ≠ proprietà economica);
 *  - solo siti la cui `regionId` esiste nel mondo: nessun sito orfano;
 *  - i giacimenti `hidden` non sono osservabili per il motore (`loader` li
 *    esclude dalle fonti estraibili) e **non vengono pubblicati**;
 *  - lettura pura: nessuna scrittura, nessun seed, nessuna materializzazione
 *    di stato NPC. `known: null` resta «ignoto», mai `0`.
 */
import path from 'path';
import { gameRepository, operationalObjectRepository, worldRepository } from '../repositories';
import { loadSimulationCatalog } from '../scenario/loader';
import { loadPreset, loadPresetMap } from '../utils/preset-loader';
import { loadNativeMap, resolveMapSource } from '../utils/native-maps';
import type { MapFeature } from '../utils/map-detail';
import type { Deposit, EstimatedRange, Quantity, SimulationCatalog } from '../scenario/types';

export interface WorldResourceSite {
  /** Id canonico del giacimento nel catalogo. */
  id: string;
  resourceId: string;
  /** Nome della risorsa **dal catalogo** (`ResourceDefinition.name`), mai dal testo del giacimento. */
  resourceName: string;
  regionId: string;
  accessibility: 'open' | 'requires_extraction';
  /** `false` = il dato autorevole manca (ignoranza ≠ assenza). */
  known: boolean;
  knownQuantity: Quantity | null;
  estimated?: EstimatedRange;
}

export interface WorldFacilitySite {
  /** Id canonico dell'impianto nel catalogo (identità verificabile, mai il nome). */
  id: string;
  typeId: string;
  /** Nome del tipo dal catalogo (`FacilityType.name`); fallback tecnico `typeId`. */
  typeName: string;
  regionId: string;
  ownerActorId: string;
  ownerActorName?: string;
  controllerActorId: string;
  controllerActorName?: string;
  /** Proprietà economica: `ownerActorId → actors[].polityId`. `null` se non verificabile. */
  polityId: string | null;
  controllerPolityId: string | null;
  operational: boolean;
}

export interface WorldMapAssets {
  resources: WorldResourceSite[];
  facilities: WorldFacilitySite[];
  /** `true` solo quando esiste un catalogo strict bindato: nessun dato inventato in legacy. */
  canonical: boolean;
}

/** Risposta esplicita per mondi legacy / catalogo non disponibile: `[]`, mai geografia falsa. */
export const EMPTY_WORLD_MAP_ASSETS: WorldMapAssets = { resources: [], facilities: [], canonical: false };

/** Fatti geografici minimi di una regione **reale** del mondo (BUG 3). */
export interface WorldRegionFact {
  /** Id completo della regione nel mondo (`<worldId>_<codice>`). */
  id: string;
  /** Paese (ISO3) di appartenenza: chiave di ancoraggio **indipendente dalla mappa**. */
  country: string;
  /** `true` solo per la provincia-capitale del paese. */
  isCapital: boolean;
}

/**
 * Indice di ancoraggio map-agnostico (BUG 3). Il catalogo nomina le regioni con
 * i codici della **sua** mappa di riferimento; il mondo le espone con i codici
 * della mappa con cui è stato generato. Quando i due spazi non combaciano,
 * l'asset viene collocato sulla regione del **suo paese** — mai su una regione
 * altrui, mai su geografia inventata.
 */
export interface RegionAnchorIndex {
  /** Codice di regione del catalogo → paese (ISO3). Derivato dalla mappa di riferimento. */
  countryByCatalogCode: ReadonlyMap<string, string>;
  /** Regioni reali del mondo (stesso set di `worldRegionIds`), ordinate. */
  worldRegions: ReadonlyArray<WorldRegionFact>;
}

export interface BuildWorldMapAssetsInput {
  catalog: SimulationCatalog;
  /** Id delle regioni che esistono davvero nel mondo della partita. */
  worldRegionIds: ReadonlySet<string>;
  /**
   * MAP P6.2 — id del mondo. Obbligatorio **solo** se il catalogo dichiara
   * `manifest.regionIdBinding.space === 'world_scoped'`: senza di esso i codici
   * di regione del catalogo non sono risolvibili e nessun asset viene
   * pubblicato (meglio nessun asset che un asset nella regione sbagliata).
   */
  worldId?: string;
  /** Stato persistente canonico: usato **solo** con id identico e solo per proprietà dinamiche. */
  persistedFacilities?: ReadonlyArray<{ id: string; data: Record<string, unknown> }>;
  /**
   * BUG 3 — indice di ancoraggio map-agnostico. **Assente** = comportamento
   * storico (risoluzione esatta, un id mancante esclude l'asset). Presente =
   * se l'id esatto non esiste, l'asset viene ancorato alla capitale del suo
   * paese, oppure alla prima regione del paese, oppure escluso se il paese è
   * assente. Nessuna geografia viene mai dedotta dal nome o dal testo.
   */
  anchor?: RegionAnchorIndex;
}

/**
 * Risolutore del binding regioni (MAP P6.2).
 *
 *  - catalogo senza binding → gli id del catalogo **sono** id del mondo (legacy);
 *  - `world_scoped` → `<worldId>_<codice mappa>`: costruzione deterministica di
 *    un id, mai una somiglianza. La verifica di esistenza resta obbligatoria e
 *    avviene prima della pubblicazione.
 */
export function regionIdResolver(
  catalog: SimulationCatalog,
  worldId?: string,
): (catalogRegionId: string) => string | null {
  const binding = catalog.manifest?.regionIdBinding;
  if (binding?.space !== 'world_scoped') return catalogRegionId => catalogRegionId;
  if (!worldId) return () => null;
  return catalogRegionId => `${worldId}_${catalogRegionId}`;
}

/**
 * BUG 3 — indice `codice di regione del catalogo → paese` derivato dalla mappa
 * di riferimento del preset (`resolveMapSource`, la stessa sorgente usata dalla
 * generazione dei mondi). Con cache per preset: la mappa non cambia a runtime e
 * il GeoJSON Pax pesa 7,3 MB. Ritorna una mappa vuota, mai un errore, se il
 * preset o la mappa non sono leggibili.
 */
const catalogCodeCountryCache = new Map<string, ReadonlyMap<string, string>>();

function catalogCodeCountryIndex(templateId: string): ReadonlyMap<string, string> {
  const cached = catalogCodeCountryCache.get(templateId);
  if (cached) return cached;
  const index = new Map<string, string>();
  const preset = loadPreset(templateId);
  if (preset) {
    const source = resolveMapSource({ hasCustomMap: preset.has_custom_map, mapBase: preset.map_base });
    const map = source.kind === 'preset' ? loadPresetMap(templateId) : loadNativeMap(source.id);
    const features = (map?.features as MapFeature[] | undefined) || [];
    for (const feature of features) {
      const properties = (feature?.properties || {}) as Record<string, unknown>;
      // Chiave condivisa fra le mappe: `country` per le mappe provinciali,
      // altrimenti il codice paese stesso è il paese della feature.
      const code = typeof properties.code === 'string' ? properties.code : null;
      if (!code || index.has(code)) continue;
      index.set(code, typeof properties.country === 'string' && properties.country ? properties.country : code);
    }
  }
  catalogCodeCountryCache.set(templateId, index);
  return index;
}

/**
 * Costruisce l'indice di ancoraggio per un mondo. Deterministico: la mappa di
 * riferimento fornisce `codice → paese`; le regioni reali forniscono
 * `paese → regioni` (e la capitale). I codici del mondo sono aggiunti come
 * fallback, così funziona anche quando la mappa corrente del preset e quella
 * con cui il mondo è stato generato non coincidono. **Non** scrive nulla.
 */
export function buildRegionAnchor(
  templateId: string,
  worldId: string,
  worldRegions: ReadonlyArray<WorldRegionFact>,
): RegionAnchorIndex | undefined {
  const countryByCatalogCode = new Map(catalogCodeCountryIndex(templateId));
  for (const region of worldRegions) {
    const code = region.id.startsWith(`${worldId}_`) ? region.id.slice(worldId.length + 1) : region.id;
    if (region.country && !countryByCatalogCode.has(code)) countryByCatalogCode.set(code, region.country);
  }
  if (countryByCatalogCode.size === 0) return undefined;
  return { countryByCatalogCode, worldRegions };
}

/** Regioni del mondo raggruppate per paese, nell'ordine ricevuto (deterministico). */
function indexRegionsByCountry(regions: ReadonlyArray<WorldRegionFact>): Map<string, WorldRegionFact[]> {
  const byCountry = new Map<string, WorldRegionFact[]>();
  for (const region of regions) {
    if (!region.country) continue;
    const list = byCountry.get(region.country);
    if (list) list.push(region);
    else byCountry.set(region.country, [region]);
  }
  return byCountry;
}

/**
 * Costruisce il read model. Puro e deterministico: stessi input ⇒ stessi output,
 * nessun accesso a rete/DB, nessuna mutazione degli input.
 */
export function buildWorldMapAssets(input: BuildWorldMapAssetsInput): WorldMapAssets {
  const { catalog, worldRegionIds } = input;
  const resourceNames = new Map((catalog.resources || []).map(item => [item.id, item.name]));
  const typeNames = new Map((catalog.facilityTypes || []).map(item => [item.id, item.name]));
  const actors = new Map((catalog.actors || []).map(item => [item.actorId, item]));
  const persisted = persistedOperational(input.persistedFacilities);
  const resolveRegionId = regionIdResolver(catalog, input.worldId);
  const regionsByCountry = input.anchor ? indexRegionsByCountry(input.anchor.worldRegions) : null;

  /**
   * BUG 3 — risoluzione di un `regionId` del catalogo in un id che esiste
   * **davvero** nel mondo:
   *   1. esatto (`<worldId>_<codice>`) — retrocompatibile, i mondi sulla stessa
   *      mappa restano identici;
   *   2. ancoraggio per paese alla capitale;
   *   3. prima regione del paese;
   *   4. `null` → l'asset è escluso. Mai geografia inventata.
   */
  const resolveSiteRegionId = (catalogRegionId: string): string | null => {
    const exact = resolveRegionId(catalogRegionId);
    if (exact && worldRegionIds.has(exact)) return exact;
    if (!regionsByCountry || !input.anchor) return null;
    const country = input.anchor.countryByCatalogCode.get(catalogRegionId);
    if (!country) return null;
    const regions = regionsByCountry.get(country);
    if (!regions || regions.length === 0) return null;
    const target = regions.find(region => region.isCapital) ?? regions[0];
    return worldRegionIds.has(target.id) ? target.id : null;
  };

  const resources: WorldResourceSite[] = [];
  for (const deposit of catalog.initialState?.deposits || []) {
    if (!isPublishableDeposit(deposit)) continue;
    const regionId = resolveSiteRegionId(deposit.regionId);
    if (!regionId) continue;
    resources.push({
      id: deposit.id,
      resourceId: deposit.resourceId,
      resourceName: resourceNames.get(deposit.resourceId) ?? deposit.resourceId,
      regionId,
      accessibility: deposit.accessibility,
      known: deposit.known !== null,
      knownQuantity: deposit.known ?? null,
      ...(deposit.estimated ? { estimated: deposit.estimated } : {}),
    });
  }

  const facilities: WorldFacilitySite[] = [];
  for (const facility of catalog.initialState?.facilities || []) {
    const regionId = resolveSiteRegionId(facility.regionId);
    if (!regionId) continue;
    const owner = actors.get(facility.ownerActorId);
    const controller = actors.get(facility.controllerActorId);
    const persistedOperationalState = persisted.get(facility.id);
    facilities.push({
      id: facility.id,
      typeId: facility.typeId,
      // Nessuna deduzione dal nome: il tipo viene dal catalogo, altrimenti resta tecnico.
      typeName: typeNames.get(facility.typeId) ?? facility.typeId,
      regionId,
      ownerActorId: facility.ownerActorId,
      ...(owner?.name ? { ownerActorName: owner.name } : {}),
      controllerActorId: facility.controllerActorId,
      ...(controller?.name ? { controllerActorName: controller.name } : {}),
      polityId: owner?.polityId ?? null,
      controllerPolityId: controller?.polityId ?? null,
      operational: persistedOperationalState ?? facility.operational,
    });
  }

  return {
    resources: resources.sort((a, b) => a.id.localeCompare(b.id)),
    facilities: facilities.sort((a, b) => a.id.localeCompare(b.id)),
    canonical: true,
  };
}

/**
 * Policy di visibilità dei giacimenti. Il motore tratta `hidden` come **non
 * estraibile e non osservabile** (`loader`: solo `accessibility !== 'hidden'`
 * entra fra le fonti); pubblicarlo rivelerebbe un'informazione che il motore
 * considera non disponibile.
 */
function isPublishableDeposit(deposit: Deposit): deposit is Deposit & { accessibility: 'open' | 'requires_extraction' } {
  return deposit.accessibility === 'open' || deposit.accessibility === 'requires_extraction';
}

/**
 * Stato persistente: **solo** con id canonico identico e **solo** per proprietà
 * dinamiche (`operational`). La geografia resta quella del catalogo.
 */
function persistedOperational(
  rows: ReadonlyArray<{ id: string; data: Record<string, unknown> }> | undefined,
): Map<string, boolean> {
  const map = new Map<string, boolean>();
  for (const row of rows || []) {
    const value = row?.data?.operational;
    if (typeof value === 'boolean') map.set(row.id, value);
  }
  return map;
}

/**
 * Binding della partita → catalogo della **sola** preset bindata, senza passare
 * dalle API che materializzano sessioni o idratano oggetti: una GET della mappa
 * non deve produrre scritture.
 */
export function loadWorldMapAssets(gameId: string): WorldMapAssets {
  const binding = gameRepository.getWorldBinding(gameId);
  if (!binding) return EMPTY_WORLD_MAP_ASSETS;
  if (!binding.templateId) return EMPTY_WORLD_MAP_ASSETS;
  const loaded = loadSimulationCatalog(path.join(process.cwd(), 'data', 'presets', binding.templateId));
  if (!loaded.catalog) return EMPTY_WORLD_MAP_ASSETS;
  // MAP P6.2 — la condizione è **l'esistenza di un catalogo valido**, non la
  // modalità economica della partita: un catalogo `authored` è pienamente
  // valido (loader: stesse regole, `mode` dichiara solo la rigidità del
  // bilanciamento) e la geografia che pubblica è autorevole esattamente come in
  // `strict`. Legare la mappa a `economy_mode` significava confondere il *layer
  // di lettura* con il *percorso economico* della partita.
  // BUG 3 — la mappa reale del mondo è quella persistita con le sue regioni:
  // paese e capitale sono letti dalle regioni, non dedotti dai codici.
  const worldRegions = worldRepository.regionFacts(binding.worldId);
  return buildWorldMapAssets({
    catalog: loaded.catalog,
    worldId: binding.worldId,
    worldRegionIds: new Set(worldRegions.map(region => region.id)),
    // Lettura esatta, senza materializzare né seedare lo stato operativo.
    persistedFacilities: operationalObjectRepository.list(gameId, 'facility'),
    // Ancoraggio map-agnostico: senza di esso i mondi su mappe diverse dalla
    // mappa del catalogo pubblicherebbero `[]` senza alcun segnale.
    anchor: buildRegionAnchor(binding.templateId, binding.worldId, worldRegions),
  });
}
