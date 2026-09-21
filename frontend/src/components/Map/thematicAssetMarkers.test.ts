/**
 * MAP P6.1 — marker degli asset canonici (modello puro)
 * =====================================================
 * I marker devono derivare dal **modello tematico** — la stessa fonte di tooltip
 * e dossier — e non dalla risposta API grezza: marker · tooltip · inspector
 * raccontano così lo stesso oggetto.
 */
import { describe, it, expect } from 'vitest';
import {
  buildThematicAssetMarkers,
  markerAriaLabel,
  markerSlotOffset,
  MARKER_SLOT_SPACING,
  type BuildThematicAssetMarkersInput,
} from './thematicAssetMarkers';
import {
  buildThematicMapModel,
  type CanonicalFacilitySite,
  type InfrastructureMapItem,
  type MapResourceSite,
} from './thematicMapModel';
import { buildRegionThematicContext, resourceCandidatesFromWorldAssets } from './mapThematicContext';
import type { Region } from '../../types';

const SITES: MapResourceSite[] = [
  { id: 'dep_coal_deu', regionId: 'DEU', kind: 'coal', label: 'Carbone', accessibility: 'requires_extraction', known: true },
  { id: 'dep_uranium_deu', regionId: 'DEU', kind: 'uranium', label: 'Uranio', accessibility: 'open', known: false },
  { id: 'dep_iron_ita', regionId: 'ITA', kind: 'iron_ore', label: 'Minerale di ferro', accessibility: 'open', known: true },
  { id: 'dep_ghost', regionId: 'GHOST', kind: 'oil', label: 'Petrolio', accessibility: 'open', known: true },
];

const CANONICAL: InfrastructureMapItem = {
  id: 'fac_foundry_fra', regionId: 'FRA', type: 'facility', name: 'Altoforno',
  strategic: false, source: 'canonical', facilityTypeId: 'ft_foundry', operational: true,
};
const TERRITORIAL: InfrastructureMapItem = {
  id: 'fac-territorio', regionId: 'FRA', type: 'factory', name: 'Fabbrica del territorio', strategic: false, source: 'territory',
};

const build = (patch: Partial<BuildThematicAssetMarkersInput> = {}) => buildThematicAssetMarkers({
  activeLayer: 'resources',
  resourceSites: SITES,
  infrastructureByRegion: { FRA: [CANONICAL, TERRITORIAL], DEU: [] },
  regionIds: new Set(['ITA', 'DEU', 'FRA']),
  ...patch,
});

describe('MAP P6.1 — marker derivati dal modello tematico', () => {
  it('il layer Risorse produce marker risorsa dal modello, non dall’API', () => {
    const markers = build();
    expect(markers.map(marker => marker.id)).toEqual(['dep_coal_deu', 'dep_uranium_deu', 'dep_iron_ita']);
    expect(markers.every(marker => marker.kind === 'resource')).toBe(true);
    // Una regione inesistente nel mondo non produce marker orfani.
    expect(markers.map(marker => marker.id)).not.toContain('dep_ghost');
  });

  it('il layer Infrastrutture produce **solo** impianti canonici', () => {
    const markers = build({ activeLayer: 'infrastructure' });
    expect(markers.map(marker => marker.id)).toEqual(['fac_foundry_fra']);
    expect(markers[0]).toMatchObject({ kind: 'facility', regionId: 'FRA', label: 'Altoforno', detail: 'operativo' });
  });

  it('gli altri layer non hanno marker: il layer controlla l’enfasi (P3)', () => {
    for (const layer of ['political', 'military', 'economy', 'diplomacy', 'changes', 'terrain'] as const) {
      expect(build({ activeLayer: layer })).toEqual([]);
    }
  });

  it('più asset nella stessa regione restano tutti, con slot deterministici', () => {
    const markers = build();
    const deu = markers.filter(marker => marker.regionId === 'DEU');
    expect(deu.map(marker => marker.slot)).toEqual([0, 1]);
    // Determinismo: stesso input, stesso ordine e stessi slot.
    expect(build()).toEqual(markers);
    expect(markers.map(marker => marker.regionId)).toEqual(['DEU', 'DEU', 'ITA']);
  });

  it('la quantità ignota non compare: semantica, mai zero', () => {
    const unknown = build().find(marker => marker.id === 'dep_uranium_deu');
    expect(unknown?.detail).toBe('accessibile · quantità non determinata');
    expect(unknown?.detail).not.toContain('0');
    const known = build().find(marker => marker.id === 'dep_coal_deu');
    expect(known?.detail).toBe('richiede estrazione · dato noto');
  });

  it('l’etichetta accessibile nomina asset e regione', () => {
    const marker = build()[0];
    expect(markerAriaLabel(marker, 'Germania')).toBe('Carbone — Germania · richiede estrazione · dato noto');
    expect(markerAriaLabel(build({ activeLayer: 'infrastructure' })[0], 'Francia')).toBe('Altoforno — Francia · operativo');
  });

  it('gli offset sono pixel deterministici, mai coordinate geografiche', () => {
    expect(markerSlotOffset(0)).toEqual([0, 0]);
    const offsets = [0, 1, 2, 3, 4, 5, 6].map(slot => markerSlotOffset(slot));
    expect(new Set(offsets.map(offset => offset.join(','))).size).toBe(offsets.length);
    for (const [dx, dy] of offsets) {
      expect(Number.isInteger(dx) && Number.isInteger(dy)).toBe(true);
    }
  });

  it('la spaziatura non è più piccola del target di tocco: i marker non si coprono', () => {
    // Target massimo della CSS: 24 px su `pointer: coarse`.
    expect(MARKER_SLOT_SPACING).toBeGreaterThanOrEqual(24);
    const distance = (slot: number) => {
      const [dx, dy] = markerSlotOffset(slot);
      return Math.hypot(dx, dy);
    };
    // Lo slot 1 dista dall'anchor esattamente la spaziatura: mai sopra l'anchor.
    expect(distance(1)).toBeCloseTo(MARKER_SLOT_SPACING, 0);
    // Due slot adiacenti dello stesso anello distano almeno il diametro del target.
    const [x1, y1] = markerSlotOffset(1);
    const [x2, y2] = markerSlotOffset(2);
    expect(Math.hypot(x2 - x1, y2 - y1)).toBeGreaterThanOrEqual(24);
    // Il settimo asset apre un anello più largo: la densità non comprime nulla.
    expect(markerSlotOffset(6)).toEqual(markerSlotOffset(6));
    expect(distance(7)).toBeCloseTo(MARKER_SLOT_SPACING * 2, 0);
    expect(distance(7)).toBeGreaterThan(distance(6));
});
});

/**
 * MAP P6.1 — «marker = tooltip = inspector» è una proprietà, non una speranza:
 * le tre superfici leggono lo **stesso** `ThematicMapModel`. Qui si prova
 * l'identità lista per lista (non solo la forma) e si fissa il confine
 * dell'anchor: il modello dei marker **non contiene coordinate**.
 */
describe('MAP P6.1 — marker, tooltip e dossier sono la stessa lista', () => {
  const region = (id: string, owner: string, objects: Region['objects'] = []): Region => ({
    id, name: id, color: '#609f87', owner, population: 1_000_000, gdp: 500, militaryPower: 30,
    objects, borders: [], status: 'active', metadata: {},
  } as Region);
  const REGIONS = [
    region('USTX', 'USA'),
    // Provincia con un'opera del territorio: cantiere, non asset canonico.
    region('NLNH', 'NLD', [{ id: 'cantiere-nl', type: 'construction_site', name: 'Diga' } as never]),
    // Cantiere + impianto canonico nella stessa provincia e nella stessa regione
    // di un giacimento: le tre superfici devono continuare a coincidere.
    region('ZANW', 'ZAF'),
  ];
  const assets = {
    canonical: true,
    resources: [
      { id: 'deposit:USTX:crude_oil:1', resourceId: 'crude_oil', resourceName: 'Petrolio greggio', regionId: 'USTX', accessibility: 'open', known: false, knownQuantity: null },
      { id: 'deposit:ZANW:coal:1', resourceId: 'coal', resourceName: 'Carbone', regionId: 'ZANW', accessibility: 'open', known: false, knownQuantity: null },
      { id: 'deposit:GHOST:coal:1', resourceId: 'coal', resourceName: 'Carbone', regionId: 'GHOST-region', accessibility: 'open', known: false, knownQuantity: null },
    ],
    facilities: [
      { id: 'facility:NLNH:refinery:1', typeId: 'refinery', typeName: 'Raffineria', regionId: 'NLNH', operational: true, ownerActorId: 'a', ownerActorName: 'A', controllerActorId: 'b', controllerActorName: 'B', polityId: 'NLD', controllerPolityId: 'USA' },
      { id: 'facility:NLNH:refinery:2', typeId: 'refinery', typeName: 'Raffineria', regionId: 'NLNH', operational: false, ownerActorId: 'b', ownerActorName: 'B', controllerActorId: 'b', controllerActorName: 'B', polityId: 'NLD', controllerPolityId: 'NLD' },
    ],
  };
  const model = buildThematicMapModel({
    regions: REGIONS,
    relationships: {},
    playerPolityId: 'USA',
    resourceCandidates: resourceCandidatesFromWorldAssets(assets),
    worldFacilities: assets.facilities as unknown as CanonicalFacilitySite[],
  });
  const regionIds = new Set(REGIONS.map(item => item.id));
  const markersOn = (activeLayer: 'resources' | 'infrastructure') => buildThematicAssetMarkers({
    activeLayer,
    resourceSites: model.resources.sites,
    infrastructureByRegion: model.infrastructure.byRegion,
    regionIds,
  });
  const inspectorOn = (id: string, activeLayer: 'resources' | 'infrastructure') => buildRegionThematicContext({
    region: REGIONS.find(item => item.id === id)!, activeLayer, model, regions: REGIONS,
    playerPolityId: 'USA', relationships: {}, changedRegionIds: [], strategicAgenda: null, commitments: [],
  });

  it('ogni marker Risorse corrisponde al tooltip e al dossier della stessa regione', () => {
    for (const item of REGIONS) {
      const markers = markersOn('resources').filter(marker => marker.regionId === item.id);
      // tooltip: `thematic.resources.byRegion`
      const tooltip = model.resources.byRegion[item.id] || [];
      expect(markers.map(marker => marker.id), item.id).toEqual(tooltip.map(site => site.id));
      // dossier: la lista che l'inspector disegna
      expect(markers.map(marker => marker.id), item.id)
        .toEqual(inspectorOn(item.id, 'resources').resources.sites.map(site => site.id));
    }
  });

  it('ogni marker Infrastrutture corrisponde al tooltip e al dossier, cantiere escluso', () => {
    for (const item of REGIONS) {
      const markers = markersOn('infrastructure').filter(marker => marker.regionId === item.id);
      expect(markers.every(marker => marker.kind === 'facility'), item.id).toBe(true);
      expect(markers.map(marker => marker.id), item.id).toEqual(['facility:NLNH:refinery:1', 'facility:NLNH:refinery:2']
        .filter(id => item.id === 'NLNH'));
      const dossier = inspectorOn(item.id, 'infrastructure').infrastructure;
      // Stessa lista, ordine diverso: la mappa ordina per id, il dossier raggruppa
      // per stato (fermo/operativo). L'insieme è lo stesso, e i gruppi sono provati sotto.
      expect(markers.map(marker => marker.id).sort(), item.id)
        .toEqual(dossier.inactive.concat(dossier.operative).map(entry => entry.id).sort());
      if (item.id === 'NLNH') {
        expect(dossier.inactive.map(entry => entry.id)).toEqual(['facility:NLNH:refinery:2']);
        expect(dossier.operative.map(entry => entry.id)).toEqual(['facility:NLNH:refinery:1']);
      }
      // Il cantiere del territorio resta nel dossier ma non diventa un asset canonico.
      if (item.id === 'NLNH') {
        expect(dossier.underConstruction.map(entry => entry.id)).toEqual(['cantiere-nl']);
        expect(markers.map(marker => marker.id)).not.toContain('cantiere-nl');
      }
    }
  });

  it('l’impianto fermo è un marker come gli altri: cambia il gruppo, non la geografia', () => {
    const stopped = markersOn('infrastructure').find(marker => marker.id === 'facility:NLNH:refinery:2');
    expect(stopped).toMatchObject({ kind: 'facility', regionId: 'NLNH', detail: 'non operativo' });
  });

  it('un asset fuori dal mondo non compare in nessuna delle tre superfici', () => {
    expect(markersOn('resources').map(marker => marker.id)).not.toContain('deposit:GHOST:coal:1');
    expect(model.resources.byRegion['GHOST-region']).toBeUndefined();
  });

  it('il modello dei marker non contiene coordinate: l’anchor è del renderer, non del dato', () => {
    for (const marker of [...markersOn('resources'), ...markersOn('infrastructure')]) {
      expect(Object.keys(marker).sort()).toEqual(['detail', 'id', 'kind', 'label', 'regionId', 'slot']);
      expect(Number.isInteger(marker.slot)).toBe(true);
    }
  });
});
