import { describe, expect, it } from 'vitest';
import type { Region } from '../../types';
import { MAP_LAYERS, type MapLayer } from './mapModel';
import {
  DIPLOMACY_COLORS,
  ECONOMY_COLORS,
  MAP_LAYER_PRESENTATIONS,
  RESOURCES_UNAVAILABLE_REASON,
  THEMATIC_NO_DATA_COLOR,
  buildDiplomacyMapModel,
  buildEconomyMapModel,
  buildInfrastructureMapModel,
  buildResourceMapModel,
  buildThematicMapModel,
  canonicalResourceSites,
  diplomaticRegionStatus,
  economyBucketFor,
  economyBucketEdges,
  economyColorForBucket,
  economyLegendRanges,
  infrastructureKind,
  mapLayerPresentation,
  thematicFillExpression,
  thematicUnavailableMessage,
} from './thematicMapModel';

const region = (id: string, patch: Partial<Region> = {}): Region => ({
  id,
  name: `Regione ${id}`,
  polityName: `Politia ${id}`,
  owner: id,
  color: '#667788',
  flag: id,
  population: 1_000_000,
  gdp: 100,
  militaryPower: 10,
  objects: [],
  borders: [],
  metadata: {},
  status: 'active' as Region['status'],
  ...patch,
});

describe('MAP P3 — layer presentation', () => {
  it('defines a valid presentation for every layer id', () => {
    const ids = MAP_LAYERS.map(layer => layer.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const layer of MAP_LAYERS) {
      const presentation = mapLayerPresentation(layer.id);
      expect(presentation.id).toBe(layer.id);
      expect(presentation.politicalFillOpacity).toBeGreaterThanOrEqual(0);
      expect(presentation.politicalFillOpacity).toBeLessThanOrEqual(1);
    }
    // La matrice copre esattamente gli 8 layer, senza buchi.
    expect(Object.keys(MAP_LAYER_PRESENTATIONS).sort()).toEqual([...ids].sort());
  });

  it('routes thematic fills only to economy and diplomacy', () => {
    const thematic = (['political', 'military', 'economy', 'resources', 'infrastructure', 'diplomacy', 'changes', 'terrain'] as MapLayer[])
      .filter(layer => mapLayerPresentation(layer).thematic !== 'none');
    expect(thematic).toEqual(['economy', 'diplomacy']);
  });
});

describe('MAP P3 — economy (Region.gdp only)', () => {
  const gdp = (id: string, value: number) => region(id, { gdp: value });

  it('places low/medium/high GDP in increasing buckets, independently of input order', () => {
    const regions = [gdp('low', 10), gdp('mid', 30), gdp('high', 50)];
    const forward = buildEconomyMapModel(regions);
    const reversed = buildEconomyMapModel([...regions].reverse());
    expect(forward.byRegion).toEqual(reversed.byRegion);
    expect(forward.edges).toEqual(reversed.edges);
    expect(forward.byRegion.low.bucket).toBeLessThan(forward.byRegion.mid.bucket);
    expect(forward.byRegion.mid.bucket).toBeLessThan(forward.byRegion.high.bucket);
  });

  it('treats 0, NaN and legacy undefined as no-data rather than extreme poverty', () => {
    const model = buildEconomyMapModel([
      gdp('zero', 0), region('missing', { gdp: undefined as unknown as number }),
      region('nan', { gdp: Number.NaN }), gdp('real', 100),
    ]);
    expect(model.noData).toEqual(expect.arrayContaining(['zero', 'missing', 'nan']));
    expect(model.byRegion.zero).toBeUndefined();
    expect(model.byRegion.missing).toBeUndefined();
    expect(model.byRegion.real).toEqual({ gdp: 100, bucket: 0 });
    expect(model.available).toBe(true);
  });

  it('keeps a robust scale when a single outlier dominates the raw range', () => {
    const regions = [10, 20, 30, 40, 50, 1_000_000].map((value, index) => gdp(`r${index}`, value));
    const model = buildEconomyMapModel(regions);
    // Le soglie sono quantili: l'outlier non collassa tutti gli altri sul fondo.
    expect(model.edges).toEqual([20, 30, 40, 50]);
    expect(model.byRegion.r0.bucket).toBe(0);
    expect(model.byRegion.r5.bucket).toBe(4);
    // Il dominio resta quello reale dei dati, non viene clampato in silenzio.
    expect(model.domain).toEqual([10, 1_000_000]);
  });

  it('never mutates region.gdp and exposes real legend ranges', () => {
    const regions = [gdp('a', 10), gdp('b', 50)];
    const before = regions.map(item => item.gdp);
    const model = buildEconomyMapModel(regions);
    expect(regions.map(item => item.gdp)).toEqual(before);
    const ranges = economyLegendRanges(model);
    expect(ranges[0].min).toBeNull();
    expect(ranges[ranges.length - 1].max).toBeNull();
    expect(economyBucketFor(50, economyBucketEdges([10, 50], 5))).toBeGreaterThan(0);
  });

  it('reports availability for an empty or all-no-data world', () => {
    expect(buildEconomyMapModel([]).available).toBe(false);
    expect(buildEconomyMapModel([gdp('a', 0)]).available).toBe(false);
    expect(thematicUnavailableMessage('economy', buildThematicMapModel({ regions: [gdp('a', 0)] })))
      .toMatch(/PIL/);
  });
});

describe('MAP P3 — diplomacy (relationships relative to the player)', () => {
  const relationships = { ITA: { FRA: 'ally', AUT: 'hostile' } };
  const input = { playerPolityId: 'ITA', relationships };

  it('classifies player, ally, neutral, hostile and unknown from the canonical matrix', () => {
    expect(diplomaticRegionStatus({ owner: 'ITA', ...input })).toBe('player');
    expect(diplomaticRegionStatus({ owner: 'FRA', ...input })).toBe('ally');
    expect(diplomaticRegionStatus({ owner: 'AUT', ...input })).toBe('hostile');
    // Presente nella matrice ma senza voce → default canonico «neutral».
    expect(diplomaticRegionStatus({ owner: 'SUI', ...input })).toBe('neutral');
    // Nessuna matrice (refresh fallito) → sconosciuto, mai stale.
    expect(diplomaticRegionStatus({ owner: 'FRA', playerPolityId: 'ITA', relationships: null })).toBe('unknown');
    expect(diplomaticRegionStatus({ owner: 'neutral', ...input })).toBe('unknown');
    expect(diplomaticRegionStatus({ owner: null, ...input })).toBe('unknown');
  });

  it('maps region.owner to its relationship and stays stable across reads', () => {
    const regions = [region('a', { owner: 'ITA' }), region('b', { owner: 'FRA' }), region('c', { owner: 'AUT' }), region('d', { owner: 'SUI' })];
    const first = buildDiplomacyMapModel(regions, relationships, 'ITA');
    const second = buildDiplomacyMapModel(regions, relationships, 'ITA');
    expect(first.byRegion).toEqual(second.byRegion);
    expect(first.byRegion).toMatchObject({ a: 'player', b: 'ally', c: 'hostile', d: 'neutral' });
    expect(first.counts).toMatchObject({ player: 1, ally: 1, hostile: 1, neutral: 1, unknown: 0 });
    expect(first.available).toBe(true);
  });

  it('is unavailable without relationships, and defines a colour for every status', () => {
    const model = buildDiplomacyMapModel([region('a', { owner: 'FRA' })], null, 'ITA');
    expect(model.available).toBe(false);
    expect(model.byRegion.a).toBe('unknown');
    expect(thematicUnavailableMessage('diplomacy', buildThematicMapModel({ regions: [region('a')], relationships: null, playerPolityId: 'ITA' })))
      .toMatch(/diplomatiche/i);
    for (const status of ['player', 'ally', 'neutral', 'hostile', 'unknown'] as const) {
      expect(DIPLOMACY_COLORS[status]).toMatch(/^#[0-9a-f]{6}$/i);
    }
  });
});

describe('MAP P3 — infrastructure (geolocated objects only)', () => {
  it('keeps civil works and excludes pure military units', () => {
    const source = region('a', { objects: [
      { id: 'f', type: 'factory', name: 'Acciaieria' },
      { id: 'p', type: 'port', name: 'Porto' },
      { id: 'e', type: 'power_plant', name: 'Centrale' },
      { id: 'c', type: 'construction_site', name: 'Cantiere' },
      { id: 'base', type: 'airbase', name: 'Base aerea' },
      { id: 'army', type: 'army', name: '1ª Armata' },
      { id: 'btn', type: 'battalion', name: 'Battaglione' },
    ] });
    const model = buildInfrastructureMapModel([source]);
    const types = model.byRegion.a.map(item => item.type);
    expect(types).toEqual(expect.arrayContaining(['factory', 'port', 'power_plant', 'construction_site']));
    expect(types).not.toContain('army');
    expect(types).not.toContain('battalion');
    // La base aerea è infrastruttura strategica, marcata come tale.
    expect(model.byRegion.a.find(item => item.id === 'base')).toMatchObject({ strategic: true });
    expect(infrastructureKind('factory')).toBe('core');
    expect(infrastructureKind('army')).toBeNull();
    expect(model.available).toBe(true);
  });

  it('is unavailable with no works', () => {
    const model = buildInfrastructureMapModel([region('a')]);
    expect(model.available).toBe(false);
    expect(model.total).toBe(0);
  });
});

describe('MAP P3 — resources (no invented geography)', () => {
  it('keeps only candidates with a canonical regionId that exists', () => {
    const regions = [region('A'), region('B')];
    const sites = canonicalResourceSites([
      { kind: 'coal', regionId: 'B', label: 'Carbone' },
      { kind: 'iron', regionId: 'ZZ', label: 'Fantasima' },
    ], regions);
    expect(sites).toEqual([{ id: 'coal-B-1', regionId: 'B', kind: 'coal', label: 'Carbone' }]);
  });

  it('never places a national reserve that has no regionId', () => {
    const regions = [region('A'), region('B')];
    const model = buildResourceMapModel({
      regions,
      candidates: [
        { kind: 'oil', label: 'Petrolio' },
        { kind: 'gas', label: 'Gas naturale' },
      ],
    });
    expect(model.sites).toEqual([]);
    expect(model.available).toBe(false);
    expect(model.unavailableReason).toBe(RESOURCES_UNAVAILABLE_REASON);
    expect(thematicUnavailableMessage('resources', buildThematicMapModel({ regions, resourceCandidates: [{ kind: 'oil' }] })))
      .toBe(RESOURCES_UNAVAILABLE_REASON);
  });

  it('groups canonical sites by region without creating quantities', () => {
    const regions = [region('A')];
    const model = buildResourceMapModel({ regions, candidates: [{ kind: 'coal', regionId: 'A', label: 'Carbone' }] });
    expect(model.available).toBe(true);
    expect(model.byRegion.A).toHaveLength(1);
    expect(model.sites[0]).not.toHaveProperty('quantity');
  });
});

describe('MAP P3.1 — selection never overrides the thematic fill', () => {
  it('builds a thematic fill expression that does not reference selection', () => {
    const expression = JSON.stringify(thematicFillExpression());
    expect(expression).toContain('hasThematic');
    expect(expression).toContain('thematicColor');
    // La selezione resta sull'outline: non deve mai comparire nel riempimento.
    expect(expression).not.toContain('selected');
    expect(expression).not.toContain('"get","color"');
  });

  it('keeps the economy bucket colour identical with or without selection', () => {
    const bucket = 2;
    expect(economyColorForBucket(bucket)).toBe(economyColorForBucket(bucket));
    expect(economyColorForBucket(bucket)).toBe(ECONOMY_COLORS[bucket]);
    expect(economyColorForBucket(0)).not.toBe(economyColorForBucket(4));
  });

  it('keeps a no-data economy region no-data even when selected', () => {
    const model = buildEconomyMapModel([region('empty', { gdp: 0 }), region('real', { gdp: 500 })]);
    expect(model.byRegion.empty).toBeUndefined();
    expect(model.noData).toContain('empty');
    expect(economyColorForBucket(null)).toBe(THEMATIC_NO_DATA_COLOR);
  });

  it('keeps a hostile diplomacy colour hostile, and unknown unknown, when selected', () => {
    const relationships = { ITA: { AUT: 'hostile' } };
    const status = diplomaticRegionStatus({ owner: 'AUT', playerPolityId: 'ITA', relationships });
    expect(status).toBe('hostile');
    expect(DIPLOMACY_COLORS[status]).toBe(DIPLOMACY_COLORS.hostile);
    const unknown = diplomaticRegionStatus({ owner: 'AUT', playerPolityId: 'ITA', relationships: null });
    expect(DIPLOMACY_COLORS[unknown]).toBe(THEMATIC_NO_DATA_COLOR);
    // La classificazione non accetta alcun input di selezione: non può cambiarla.
    expect(diplomaticRegionStatus({ owner: 'AUT', playerPolityId: 'ITA', relationships }))
      .toBe(diplomaticRegionStatus({ owner: 'AUT', playerPolityId: 'ITA', relationships }));
  });
});
