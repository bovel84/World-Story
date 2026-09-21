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
import type { InfrastructureMapItem, MapResourceSite } from './thematicMapModel';

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
