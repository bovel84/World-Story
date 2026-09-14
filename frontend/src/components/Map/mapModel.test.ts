import { describe, expect, it } from 'vitest';
import type { Region } from '../../types';
import { RegionFeatureIndex, diffRegionFeatures, parseRegionGeometry, objectIconFor, objectIsVisible, objectMinZoom, objectQualifiesAtZoom, DEFAULT_MAP_FILTERS, buildMapSearchIndex, searchMap } from './mapModel';

const geometry = { type: 'Polygon', coordinates: [[[0, 0], [5, 0], [5, 5], [0, 0]]] };
const region = (id: string, overrides: Partial<Region> = {}): Region => ({
  id, name: `Territorio ${id}`, color: '#445566', owner: 'ITA', population: 100,
  gdp: 20, militaryPower: 3, objects: [], borders: [], metadata: {}, status: 'active' as Region['status'],
  geojson: JSON.stringify({ type: 'Feature', geometry, properties: { id: 'untrusted-import-id' } }),
  ...overrides,
});

describe('Incremental game map', () => {
  it('uses canonical IDs, caches unchanged geometry, and ignores statistics/assets in the geographic diff', () => {
    const index = new RegionFeatureIndex();
    const a = region('a');
    const before = index.build([a]);
    const after = index.build([{ ...a, gdp: 900, objects: [{ id: 'army', type: 'army', name: 'Unità', lat: 1, lng: 2 }] }]);
    expect(after.get('a')?.id).toBe('a');
    expect(after.get('a')).toBe(before.get('a'));
    expect(diffRegionFeatures(before, after)).toBeNull();
  });

  it('patches ownership/color without re-uploading borders', () => {
    const index = new RegionFeatureIndex();
    const before = index.build([region('a')], 'ITA');
    const next = index.build([region('a', { owner: 'FRA', color: '#aa1122' })], 'ITA');
    const diff = diffRegionFeatures(before, next)!;
    expect(diff.add).toEqual([]);
    expect(diff.update).toHaveLength(1);
    expect(diff.update![0].newGeometry).toBeUndefined();
    expect(diff.update![0].addOrUpdateProperties).toEqual(expect.arrayContaining([
      { key: 'owner', value: 'FRA' }, { key: 'isPlayer', value: false }, { key: 'color', value: '#aa1122' },
    ]));
  });

  it('handles region creation, deletion, reordering and replacement geometry independently', () => {
    const index = new RegionFeatureIndex();
    const a = region('a'), b = region('b');
    const before = index.build([a, b]);
    expect(diffRegionFeatures(before, index.build([b, a]))).toBeNull();
    const newGeometry = { ...geometry, coordinates: [[[1, 1], [6, 1], [6, 6], [1, 1]]] };
    const next = index.build([region('a', { geojson: JSON.stringify({ type: 'Feature', geometry: newGeometry }) }), region('c')]);
    const diff = diffRegionFeatures(before, next)!;
    expect(diff.remove).toEqual(['b']);
    expect(diff.add?.map(feature => feature.id)).toEqual(['c']);
    expect(diff.update?.[0].newGeometry).toEqual(newGeometry);
  });

  it.each([undefined, '{broken', 'null', '{}', JSON.stringify({ geometry: { type: 'Point', coordinates: [0, 0] } }),
    JSON.stringify({ geometry: { type: 'Polygon', coordinates: [] } }),
    JSON.stringify({ geometry: { type: 'Polygon', coordinates: [[[0, 100], [0, 0], [1, 0], [0, 100]]] } }),
    JSON.stringify({ geometry: { type: 'Polygon', coordinates: [[['bad', 0], [0, 0], [1, 0], ['bad', 0]]] } }),
  ])('skips malformed geometry without losing healthy regions: %s', bad => {
    expect(parseRegionGeometry(bad)).toBeNull();
    expect([...new RegionFeatureIndex().build([region('bad', { geojson: bad }), region('ok')]).keys()]).toEqual(['ok']);
  });

  it('accepts multipolygons and evicts an invalidated/deleted feature', () => {
    const multi = JSON.stringify({ geometry: { type: 'MultiPolygon', coordinates: [geometry.coordinates] } });
    expect(parseRegionGeometry(multi)?.type).toBe('MultiPolygon');
    const index = new RegionFeatureIndex();
    const before = index.build([region('a')]);
    expect(diffRegionFeatures(before, index.build([region('a', { geojson: '{}' })]))?.remove).toEqual(['a']);
    index.build([]);
    expect(index.build([region('a')]).get('a')).not.toBe(before.get('a'));
  });

  it('filters future/unknown facilities as well as existing military/port/city types', () => {
    expect(objectIsVisible('army', { ...DEFAULT_MAP_FILTERS, showUnits: false })).toBe(false);
    expect(objectIsVisible('naval_base', { ...DEFAULT_MAP_FILTERS, showPorts: false })).toBe(false);
    expect(objectIsVisible('capital', { ...DEFAULT_MAP_FILTERS, showCities: false })).toBe(false);
    expect(objectIsVisible('future_facility', { ...DEFAULT_MAP_FILTERS, showIndustry: false })).toBe(false);
    expect(objectIsVisible('port', { ...DEFAULT_MAP_FILTERS, showCities: false })).toBe(true);
  });

  it('finds military formations and construction sites, including new live objects', () => {
    const entries = buildMapSearchIndex([region('uige', { objects: [
      { id: 'unit', type: 'mobilization', name: 'Eroi', lat: -7, lng: 15 },
      { id: 'site', type: 'construction_site', name: 'Nuovo porto', lat: -8, lng: 13 },
    ] })]);
    expect(searchMap(entries, 'eroi')[0]).toMatchObject({ regionId: 'uige', point: [15, -7] });
    expect(searchMap(entries, 'eroi')[0].context).toContain('In formazione');
    expect(searchMap(entries, 'nuovo porto')[0].context).toContain('Cantiere');
  });

  it('searches cities, territories and polity names ignoring case/accents; caps results', () => {
    const index = buildMapSearchIndex([region('a', { name: 'Île du Nord', polityName: 'Repubblica Alfa', objects: [
      { id: 'city', type: 'city', name: 'Città Nuova', lat: 3, lng: 2 },
    ] }), region('bad', { geojson: '{}' })]);
    expect(searchMap(index, 'ILE')[0].regionId).toBe('a');
    expect(searchMap(index, ' Citta ')[0].point).toEqual([2, 3]);
    expect(searchMap(index, 'alfa')).toHaveLength(2);
    expect(searchMap(index, 'alfa', 1)).toHaveLength(1);
    expect(searchMap(index, '  ')).toEqual([]);
    expect(searchMap(index, 'missing')).toEqual([]);
  });

  it('entra per gradi con lo zoom: il mondo resta pulito, il dettaglio arriva avvicinandosi', () => {
    // Gerarchia di comparsa: capitali → unità → porti → opere/industria.
    expect(objectMinZoom('capital')).toBeLessThan(objectMinZoom('army'));
    expect(objectMinZoom('army')).toBeLessThan(objectMinZoom('port'));
    expect(objectMinZoom('port')).toBeLessThan(objectMinZoom('factory'));
    // A vista mondo (zoom 1) nessun oggetto è visibile.
    expect(objectQualifiesAtZoom('capital', 1)).toBe(false);
    expect(objectQualifiesAtZoom('army', 1)).toBe(false);
    expect(objectQualifiesAtZoom('factory', 1)).toBe(false);
    // Le metropoli entrano prima delle cittadine minori.
    expect(objectQualifiesAtZoom('city', 2.7, 3)).toBe(true);
    expect(objectQualifiesAtZoom('city', 2.7, 1)).toBe(false);
    expect(objectQualifiesAtZoom('city', 3.2, 1)).toBe(true);
    // Tipi sconosciuti/futuri ricadono sulla soglia dell'industria.
    expect(objectMinZoom('future_facility')).toBe(objectMinZoom('factory'));
    // Viewport mobile: il bias di zoom mostra prima unità e opere, così le
    // icone dei cambiamenti non spariscono su uno schermo stretto.
    expect(objectQualifiesAtZoom('army', 1.4)).toBe(false);
    expect(objectQualifiesAtZoom('army', 1.4, 0, 0.9)).toBe(true);
    expect(objectQualifiesAtZoom('factory', 1.8, 0, 0.9)).toBe(true);
    expect(objectQualifiesAtZoom('factory', 1.8)).toBe(false);
  });

  it('icona personalizzata per cantieri e mobilitazioni in preparazione', () => {
    expect(objectIconFor({ type: 'construction_site', metadata: { plannedType: 'factory' } }).label).toBe('⚙');
    expect(objectIconFor({ type: 'construction_site', metadata: { plannedType: 'naval_base' } }).label).toBe('⚓');
    expect(objectIconFor({ type: 'mobilization', metadata: { plannedType: 'fleet' } }).label).toBe('≋');
    expect(objectIconFor({ type: 'mobilization', metadata: { plannedType: 'battalion' } }).label).toBe('Ⅰ');
    // Fallback: cantiere/leva senza tipo noto mantengono il glifo generico.
    expect(objectIconFor({ type: 'construction_site', metadata: {} }).label).toBe('⋯');
    expect(objectIconFor({ type: 'mobilization' }).label).toBe('↟');
    // Unità e opere operative restano invariate.
    expect(objectIconFor({ type: 'fleet' }).label).toBe('≋');
    expect(objectIconFor({ type: 'airbase' }).label).toBe('✈');
    expect(objectIconFor({ type: 'missile' }).label).toBe('➤');
    expect(objectIconFor({ type: 'kind_inesistente' }).label).toBe('●');
  });
});
