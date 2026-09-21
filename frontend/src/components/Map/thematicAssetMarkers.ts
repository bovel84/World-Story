/**
 * MAP P6.1 — marker cartografici degli asset economici canonici
 * =============================================================
 * MAP P6 rendeva i giacimenti e gli impianti canonici leggibili nel dossier ma
 * **non disegnati** sulla superficie cartografica: i marker nascevano solo da
 * `region.objects`. Questo modulo deriva dal **modello tematico** (lo stesso che
 * alimenta tooltip e dossier) la lista dei marker da disegnare, così
 * marker · tooltip · inspector raccontano lo stesso oggetto.
 *
 * Regole:
 *  - il layer attivo decide l'enfasi: `resources` → giacimenti, `infrastructure`
 *    → impianti canonici, ogni altro layer → nessun marker (P3 conservato);
 *  - la geografia è `regionId`: un asset la cui regione non esiste nel mondo è
 *    escluso (nessun marker orfano);
 *  - `slot` è un **offset visivo deterministico** in pixel per gli asset della
 *    stessa regione (più asset nella stessa provincia non si sovrappongono):
 *    non è una coordinata, non modifica lat/lng, non è geografia;
 *  - nessuna quantità viene mostrata quando il dato non è noto.
 */
import type { MapLayer } from './mapModel';
import type { InfrastructureMapItem, MapResourceSite } from './thematicMapModel';

export type ThematicAssetMarkerKind = 'resource' | 'facility';

export interface ThematicAssetMarker {
  id: string;
  kind: ThematicAssetMarkerKind;
  regionId: string;
  /** Testo del marker (nome risorsa o tipo dell'impianto). */
  label: string;
  /** Riga semantica: accessibilità/stato. Mai una quantità ignota. */
  detail: string;
  /** Indice nella regione: offset visivo deterministico, non geografico. */
  slot: number;
}

export interface BuildThematicAssetMarkersInput {
  activeLayer: MapLayer;
  /** `thematic.resources.sites` — mai la risposta API grezza. */
  resourceSites: readonly MapResourceSite[];
  /** `thematic.infrastructure.byRegion` — filtrato su `source === 'canonical'`. */
  infrastructureByRegion: Readonly<Record<string, readonly InfrastructureMapItem[]>>;
  /** Regioni che esistono davvero nel mondo. */
  regionIds: ReadonlySet<string>;
}

const ACCESSIBILITY_LABELS: Record<string, string> = {
  open: 'accessibile',
  requires_extraction: 'richiede estrazione',
};

function resourceDetail(site: MapResourceSite): string {
  const accessibility = site.accessibility ? ACCESSIBILITY_LABELS[site.accessibility] ?? site.accessibility : '';
  const knowledge = site.known === undefined ? '' : site.known ? 'dato noto' : 'quantità non determinata';
  return [accessibility, knowledge].filter(Boolean).join(' · ');
}

function facilityDetail(item: InfrastructureMapItem): string {
  return item.operational ? 'operativo' : 'non operativo';
}

export function buildThematicAssetMarkers(input: BuildThematicAssetMarkersInput): ThematicAssetMarker[] {
  const { activeLayer, regionIds } = input;
  const markers: ThematicAssetMarker[] = [];
  if (activeLayer === 'resources') {
    for (const site of input.resourceSites) {
      if (!regionIds.has(site.regionId)) continue;
      markers.push({
        id: site.id, kind: 'resource', regionId: site.regionId,
        label: site.label, detail: resourceDetail(site), slot: 0,
      });
    }
  } else if (activeLayer === 'infrastructure') {
    for (const items of Object.values(input.infrastructureByRegion)) {
      for (const item of items || []) {
        // Solo gli impianti canonici: le opere del territorio hanno già il loro marker.
        if (item.source !== 'canonical' || !regionIds.has(item.regionId)) continue;
        markers.push({
          id: item.id, kind: 'facility', regionId: item.regionId,
          label: item.name, detail: facilityDetail(item), slot: 0,
        });
      }
    }
  }
  // Ordine deterministico: regione, poi id. Lo `slot` è l'indice nella regione.
  markers.sort((a, b) => (a.regionId === b.regionId ? a.id.localeCompare(b.id) : a.regionId.localeCompare(b.regionId)));
  const seen: Record<string, number> = Object.create(null);
  for (const marker of markers) {
    marker.slot = seen[marker.regionId] ?? 0;
    seen[marker.regionId] = marker.slot + 1;
  }
  return markers;
}

/**
 * Offset in **pixel** per lo slot: un anello deterministico attorno all'anchor
 * della regione. Non è una coordinata: due asset della stessa provincia restano
 * entrambi visibili senza spostare nulla sulla mappa.
 */
export function markerSlotOffset(slot: number): [number, number] {
  if (slot <= 0) return [0, 0];
  const ring = Math.ceil(slot / 6);
  const index = (slot - 1) % 6;
  const radius = 14 * ring;
  const angle = (Math.PI * 2 * index) / 6 - Math.PI / 2;
  return [Math.round(Math.cos(angle) * radius), Math.round(Math.sin(angle) * radius)];
}

/** Etichetta accessibile del marker: «Carbone — Germania · richiede estrazione». */
export function markerAriaLabel(marker: ThematicAssetMarker, regionName: string): string {
  return [marker.label, regionName].filter(Boolean).join(' — ') + (marker.detail ? ` · ${marker.detail}` : '');
}
