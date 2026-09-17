/**
 * MAP-DETAIL — livelli di profondità della mappa: funzioni pure.
 * =============================================================
 * nations (1 regione per paese) · grouped (gruppi deterministici) · full
 * (1 regione per provincia, identico al comportamento storico).
 *
 * Nessun LLM, nessun DB di gioco: solo proiezione e derivazione.
 */
import { describe, it, expect, beforeAll } from 'vitest';
import os from 'os';
import path from 'path';

process.env.OPEN_PAX_DB_PATH = path.join(os.tmpdir(), `world-story-mapdetail-${process.pid}-${Date.now()}.db`);

import {
  GROUPING_HIERARCHY_KEYS,
  MAP_DETAILS,
  buildProvinceAdjacency,
  deriveGroupBorders,
  deriveGroups,
  distributeCountryStats,
  groupingKeysFor,
  hasProvinceFeatures,
  isMapDetail,
  isMapGrouping,
  normalizeMapDetail,
  normalizeMapGrouping,
  resolveMapDetail,
  type DerivedGroup,
  type MapFeature,
} from '../src/utils/map-detail';

let NationStateService: any;

beforeAll(async () => {
  NationStateService = (await import('../src/game/NationStateService')).NationStateService;
});

/** Provincia quadrata 1×1 a partire da [lng, lat]. */
function province(code: string, country: string, lng: number, lat: number, extra: Record<string, unknown> = {}): MapFeature {
  return {
    type: 'Feature',
    properties: { code, country, name: extra.name ?? code, is_capital: extra.is_capital ?? false, centroid: [lng, lat], ...extra },
    geometry: {
      type: 'Polygon',
      coordinates: [[[lng, lat], [lng + 1, lat], [lng + 1, lat + 1], [lng, lat + 1], [lng, lat]]],
    },
  };
}

/** Formula storica di distribuzione, per la regressione di `full`. */
function referenceStats(totals: { population: number; gdp: number; military: number }, features: MapFeature[]) {
  const areas = features.map(f => {
    const coords = (f.geometry as any).coordinates[0];
    let a = 0;
    for (let i = 0; i < coords.length - 1; i++) a += coords[i][0] * coords[i + 1][1] - coords[i + 1][0] * coords[i][1];
    return Math.abs(a / 2) || 0.0001;
  });
  const weights = features.map((f, i) => areas[i] * ((f.properties as any).is_capital ? 1.6 : 1));
  const totalWeight = weights.reduce((s, w) => s + w, 0) || 1;
  return features.map((f, i) => {
    const share = weights[i] / totalWeight;
    const capital = !!(f.properties as any).is_capital;
    return {
      population: Math.max(100000, Math.round(totals.population * share)),
      gdp: Math.max(1, Math.round(totals.gdp * share)),
      militaryPower: Math.max(1, Math.round(totals.military * share * (capital ? 1.25 : 1))),
    };
  });
}

describe('MAP-DETAIL — validazione e default', () => {
  it('riconosce solo i tre valori ammessi', () => {
    expect(MAP_DETAILS).toEqual(['nations', 'grouped', 'full']);
    expect(isMapDetail('grouped')).toBe(true);
    expect(isMapDetail('province')).toBe(false);
    expect(normalizeMapDetail('nations')).toBe('nations');
    expect(normalizeMapDetail(undefined)).toBeUndefined();
  });

  it('default retrocompatibile: mappa provinciale → full, altrimenti nations', () => {
    expect(resolveMapDetail(undefined, true)).toBe('full');
    expect(resolveMapDetail(undefined, false)).toBe('nations');
  });

  it('full/grouped senza mappa provinciale ricadono su nations', () => {
    expect(resolveMapDetail('full', false)).toBe('nations');
    expect(resolveMapDetail('grouped', false)).toBe('nations');
    expect(resolveMapDetail('nations', false)).toBe('nations');
    expect(resolveMapDetail('grouped', true)).toBe('grouped');
  });

  it('riconosce una mappa provinciale solo con properties.country ≠ code', () => {
    expect(hasProvinceFeatures([province('IT-RM', 'ITA', 12, 41)])).toBe(true);
    expect(hasProvinceFeatures([{ type: 'Feature', properties: { code: 'ITA', name: 'Italia' }, geometry: { type: 'Polygon', coordinates: [] } }])).toBe(false);
  });
});

describe('MAP-DETAIL — nations', () => {
  const features = [
    province('ALB1', 'ALB', 19, 41, { name: 'Tirana', is_capital: true }),
    province('ALB2', 'ALB', 20, 41, { name: 'Durazzo' }),
    province('ALB3', 'ALB', 20, 40, { name: 'Valona' }),
  ];

  it('dissolve N province in 1 regione con la capitale preservata', () => {
    const groups = deriveGroups(features, 'nations', { owner: 'ALB', countryName: 'Albania' });
    expect(groups).toHaveLength(1);
    expect(groups[0].code).toBe('ALB');
    expect(groups[0].name).toBe('Albania');
    expect(groups[0].hasCapital).toBe(true);
    expect(groups[0].memberCodes).toEqual(['ALB1', 'ALB2', 'ALB3']);
    expect(groups[0].geometry.type).toBe('MultiPolygon');
  });

  it('somma popolazione/GDP/potenza in modo coerente con full', () => {
    const totals = { population: 3_000_000, gdp: 900, military: 120 };
    const full = deriveGroups(features, 'full', { owner: 'ALB', countryName: 'Albania' });
    const fullStats = distributeCountryStats(totals, full);
    const nationsGroups = deriveGroups(features, 'nations', { owner: 'ALB', countryName: 'Albania' });
    const [aggregate] = distributeCountryStats(totals, nationsGroups);
    const sum = fullStats.reduce((acc, s) => ({
      population: acc.population + s.population,
      gdp: acc.gdp + s.gdp,
      militaryPower: acc.militaryPower + s.militaryPower,
    }), { population: 0, gdp: 0, militaryPower: 0 });
    expect(aggregate).toEqual(sum);
    expect(aggregate.population).toBeGreaterThan(0);
    expect(aggregate.gdp).toBeGreaterThan(0);
    expect(aggregate.militaryPower).toBeGreaterThan(0);
  });
  it('preserva surface_type nel GeoJSON del gruppo (capacità navale)', () => {
    const coastal = province('A1', 'AAA', 0, 0, { surface_type: 'Coastal' });
    const inland = province('A2', 'AAA', 2, 0, { surface_type: 'Land' });
    const [single] = deriveGroups([coastal], 'full', { owner: 'AAA' });
    expect((single.properties as any).surface_type).toBe('Coastal');
    const [group] = deriveGroups([inland, coastal], 'nations', { owner: 'AAA' });
    expect((group.properties as any).surface_type).toBe('Coastal');
  });
});

describe('MAP-DETAIL — grouped', () => {
  it('usa la gerarchia reale quando presente', () => {
    const features = [
      province('IT1', 'ITA', 9, 45, { region: 'Nord' }),
      province('IT2', 'ITA', 10, 45, { region: 'Nord' }),
      province('IT3', 'ITA', 12, 41, { region: 'Sud' }),
      province('IT4', 'ITA', 15, 40, { region: 'Sud' }),
    ];
    const groups = deriveGroups(features, 'grouped', { owner: 'ITA', countryName: 'Italia' });
    expect(groups).toHaveLength(2);
    expect(groups[0].name).toBe('Italia · Nord');
    expect(groups[0].memberCodes.sort()).toEqual(['IT1', 'IT2']);
    expect(groups[1].name).toBe('Italia · Sud');
    expect(groups[1].memberCodes.sort()).toEqual(['IT3', 'IT4']);
  });

  it('senza gerarchia è deterministico: stesso input → stesso output', () => {
    const features = [
      province('P1', 'XXX', 0, 0), province('P2', 'XXX', 0.2, 0.1), province('P3', 'XXX', 0.4, 0),
      province('P4', 'XXX', 10, 10), province('P5', 'XXX', 10.2, 10.1), province('P6', 'XXX', 10.4, 10),
    ];
    const first = deriveGroups(features, 'grouped', { owner: 'XXX', countryName: 'Test' });
    const second = deriveGroups(features, 'grouped', { owner: 'XXX', countryName: 'Test' });
    expect(JSON.stringify(first)).toEqual(JSON.stringify(second));
    // K = ceil(6/3) = 2 gruppi; ogni feature compare una sola volta.
    expect(first).toHaveLength(2);
    const members = first.flatMap(g => g.memberCodes).sort();
    expect(members).toEqual(['P1', 'P2', 'P3', 'P4', 'P5', 'P6']);
    expect(first[0].geometry.type).toBe('MultiPolygon');
  });

  it('per un preset storico usa la chiave dichiarata (map_grouping), anche fuori dalla lista nota', () => {
    const features = [
      province('OT1', 'OTT', 28, 41, { eyalet: 'Rumelia' }),
      province('OT2', 'OTT', 29, 41, { eyalet: 'Rumelia' }),
      province('OT3', 'OTT', 32, 39, { eyalet: 'Anatolia' }),
      province('OT4', 'OTT', 35, 39, { eyalet: 'Anatolia' }),
    ];
    // `eyalet` non è tra le chiavi note: senza map_grouping si userebbe il clustering.
    const auto = deriveGroups(features, 'grouped', { owner: 'OTT', countryName: 'Impero ottomano' });
    const groups = deriveGroups(features, 'grouped', {
      owner: 'OTT',
      countryName: 'Impero ottomano',
      hierarchyKeys: groupingKeysFor('eyalet'),
    });
    expect(groups).toHaveLength(2);
    expect(groups.map(g => g.name)).toEqual(['Impero ottomano · Anatolia', 'Impero ottomano · Rumelia']);
    expect(groups[0].memberCodes.sort()).toEqual(['OT3', 'OT4']);
    expect(groups[1].memberCodes.sort()).toEqual(['OT1', 'OT2']);
    // La chiave dichiarata ha priorità; l'output automatico resta valido.
    expect(auto).not.toBeNull();
  });

  it('se la chiave dichiarata non raggruppa, ricade su gerarchia nota/geografico', () => {
    const features = [
      province('X1', 'XXX', 0, 0, { region: 'A' }),
      province('X2', 'XXX', 1, 0, { region: 'A' }),
      province('X3', 'XXX', 2, 0, { region: 'B' }),
      province('X4', 'XXX', 3, 0, { region: 'B' }),
    ];
    // `missing` non esiste → si usa `region`, la gerarchia nota presente.
    const groups = deriveGroups(features, 'grouped', {
      owner: 'XXX',
      countryName: 'Test',
      hierarchyKeys: groupingKeysFor('missing'),
    });
    expect(groups).toHaveLength(2);
    expect(groups.map(g => g.name)).toEqual(['Test · A', 'Test · B']);
  });

  it('groupingKeysFor mette la chiave dichiarata in testa e non duplica', () => {
    expect(groupingKeysFor()).toEqual(GROUPING_HIERARCHY_KEYS);
    expect(groupingKeysFor('  admin1  ')[0]).toBe('admin1');
    expect(groupingKeysFor('admin1')).toEqual([
      'admin1',
      ...GROUPING_HIERARCHY_KEYS.filter(key => key !== 'admin1'),
    ]);
  });
});

describe('MAP-DETAIL — validazione di map_grouping', () => {
  it('accetta chiavi di proprietà valide e normalizza gli spazi', () => {
    expect(isMapGrouping('region')).toBe(true);
    expect(isMapGrouping('admin.1-x')).toBe(true);
    expect(normalizeMapGrouping('  eyalet ')).toBe('eyalet');
  });

  it('rifiuta valori non validi o vuoti', () => {
    expect(isMapGrouping('1bad')).toBe(false);
    expect(isMapGrouping('has space')).toBe(false);
    expect(isMapGrouping('')).toBe(false);
    expect(isMapGrouping(42)).toBe(false);
    expect(normalizeMapGrouping('')).toBeUndefined();
    expect(normalizeMapGrouping('   ')).toBeUndefined();
    expect(normalizeMapGrouping(undefined)).toBeUndefined();
  });
});

describe('MAP-DETAIL — full', () => {
  const features = [
    province('IT1', 'ITA', 9, 45, { name: 'Torino', is_capital: true }),
    province('IT2', 'ITA', 12, 41, { name: 'Roma' }),
  ];

  it('1 regione per provincia, come il comportamento attuale', () => {
    const groups = deriveGroups(features, 'full', { owner: 'ITA', countryName: 'Italia' });
    expect(groups.map(g => g.code)).toEqual(['IT1', 'IT2']);
    expect(groups.map(g => g.name)).toEqual(['Torino', 'Roma']);
    expect(groups[0].memberCodes).toEqual(['IT1']);
  });

  it('la distribuzione delle statistiche è identica alla formula storica', () => {
    const totals = { population: 5_000_000, gdp: 1_500, military: 200 };
    const groups = deriveGroups(features, 'full', { owner: 'ITA', countryName: 'Italia' });
    const stats = distributeCountryStats(totals, groups);
    expect(stats).toEqual(referenceStats(totals, features));
  });
});

describe('MAP-DETAIL — confini derivati', () => {
  const features = [
    province('ALB1', 'ALB', 19, 41, { is_capital: true }),
    province('ALB2', 'ALB', 20, 41),
    province('ITA1', 'ITA', 21, 41),
    province('FIN1', 'FIN', 25, 62),
  ];
  const adjacency: Record<string, string[]> = {
    ALB1: ['ALB2'], ALB2: ['ALB1', 'ITA1'], ITA1: ['ALB2'], FIN1: [],
  };

  it('due gruppi confinanti risultano adiacenti a vicenda', () => {
    const groups = deriveGroups(features.filter(f => f.properties!.country === 'ALB'), 'nations', { owner: 'ALB' });
    const ita = deriveGroups(features.filter(f => f.properties!.country === 'ITA'), 'nations', { owner: 'ITA' });
    const fin = deriveGroups(features.filter(f => f.properties!.country === 'FIN'), 'nations', { owner: 'FIN' });
    const borders = deriveGroupBorders([...groups, ...ita, ...fin], adjacency);
    expect(borders.ALB).toEqual(['ITA']);
    expect(borders.ITA).toEqual(['ALB']);
    expect(borders.FIN).toEqual([]);
  });

  it('deriva l\'adiacenza dalla geometria quando manca `adjacencies`', () => {
    const a = province('A', 'XXX', 0, 0);
    const b = province('B', 'XXX', 1, 0);
    const c = province('C', 'XXX', 10, 10);
    const built = buildProvinceAdjacency([a, b, c]);
    expect(built.A ?? []).toContain('B');
    expect(built.B ?? []).toContain('A');
    expect(built.C ?? []).toEqual([]);
  });

  it('usa `adjacencies` esplicite (mappa Pax) mappando pax_region_id', () => {
    const a: MapFeature = { type: 'Feature', properties: { code: 'pax-0', pax_region_id: '0', adjacencies: ['1'] }, geometry: { type: 'Polygon', coordinates: [] } };
    const b: MapFeature = { type: 'Feature', properties: { code: 'pax-1', pax_region_id: '1', adjacencies: ['0', '2'] }, geometry: { type: 'Polygon', coordinates: [] } };
    const c: MapFeature = { type: 'Feature', properties: { code: 'pax-2', pax_region_id: '2', adjacencies: ['1'] }, geometry: { type: 'Polygon', coordinates: [] } };
    const built = buildProvinceAdjacency([a, b, c]);
    expect(built['pax-0']).toEqual(['pax-1']);
    expect(built['pax-1']).toEqual(['pax-0', 'pax-2']);
  });
});

describe('MAP-DETAIL — pressureNeighbours con mondo nations', () => {
  it('l\'adiacenza resta corretta: il vicino lontano non compare', () => {
    const features = [
      province('ALB1', 'ALB', 19, 41, { is_capital: true }),
      province('ALB2', 'ALB', 20, 41),
      province('ITA1', 'ITA', 21, 41),
      province('FIN1', 'FIN', 25, 62),
    ];
    const adjacency: Record<string, string[]> = {
      ALB1: ['ALB2'], ALB2: ['ALB1', 'ITA1'], ITA1: ['ALB2'], FIN1: [],
    };
    const groups: DerivedGroup[] = [
      ...deriveGroups(features.filter(f => f.properties!.country === 'ALB'), 'nations', { owner: 'ALB' }),
      ...deriveGroups(features.filter(f => f.properties!.country === 'ITA'), 'nations', { owner: 'ITA' }),
      ...deriveGroups(features.filter(f => f.properties!.country === 'FIN'), 'nations', { owner: 'FIN' }),
    ];
    const borders = deriveGroupBorders(groups, adjacency);

    const regions = new Map<string, { owner: string; militaryPower: number; borders: string[] }>([
      ['ALB', { owner: 'ALB', militaryPower: 50, borders: borders.ALB || [] }],
      ['ITA', { owner: 'ITA', militaryPower: 80, borders: borders.ITA || [] }],
      ['FIN', { owner: 'FIN', militaryPower: 9999, borders: borders.FIN || [] }],
    ]);
    const service = new NationStateService({
      gameId: 'g', currentTurn: () => 1, currentDate: () => '1951-01-01', isStrictGame: () => false,
      playerPolityId: () => 'ALB', worldStateOptions: () => ({}), initialAccounts: () => ({}), sessionAccounts: () => ({}),
      regions: () => regions, publicPolityName: (id: string) => id, relationToPlayer: () => 'neutral',
    } as any);

    const neighbours = service.pressureNeighbours() as Array<{ polityId: string }>;
    expect(neighbours.map(n => n.polityId)).toEqual(['ITA']);
    expect(neighbours.map(n => n.polityId)).not.toContain('FIN');
  });
});
