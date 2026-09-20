import { describe, expect, it } from 'vitest';
import type { MilitaryUnitPayload, WarFrontPayload } from '../../services/api';
import type { Region } from '../../types';
import {
  buildMilitaryMapModel,
  militaryPolityPresentation,
  militaryRegionAnchor,
  militaryUnitDensity,
  type MilitaryMapUnitPayload,
} from './militaryMapModel';

const region = (id: string, owner: string, offset = 0, overrides: Partial<Region> = {}): Region => ({
  id,
  name: `Regione ${id}`,
  polityName: `Politia ${owner}`,
  owner,
  color: owner === 'AAA' ? '#aa0000' : owner === 'BBB' ? '#0000bb' : '#667788',
  flag: owner,
  population: 1,
  gdp: 1,
  militaryPower: 1,
  objects: [],
  borders: [],
  metadata: {},
  status: 'active' as Region['status'],
  geojson: JSON.stringify({ geometry: {
    type: 'Polygon',
    coordinates: [[[offset, 0], [offset + 4, 0], [offset + 4, 4], [offset, 4], [offset, 0]]],
  } }),
  ...overrides,
});

const unit = (
  id: string,
  polityId: string,
  regionId: string | null,
  patch: Partial<MilitaryMapUnitPayload> = {},
): MilitaryMapUnitPayload => ({
  id,
  polityId,
  armyId: `army-${id}`,
  name: `Unità ${id}`,
  personnel: 10_000,
  equipment: {},
  monthlyNeeds: { fuel: 1, weapons: 2, food: 3 },
  readiness: 0.8,
  status: 'operational',
  regionId,
  regionName: regionId,
  updatedDate: '1951-02-01',
  legacyDerived: false,
  frontId: null,
  ...patch,
});

const front = (id: string, patch: Partial<WarFrontPayload> = {}): WarFrontPayload => ({
  id,
  name: `Fronte ${id}`,
  attackerPolityId: 'AAA',
  defenderPolityId: 'BBB',
  regionIds: ['a', 'b'],
  status: 'active',
  objectiveRegionId: 'b',
  attackerPressure: 2,
  defenderPressure: 1,
  momentumPolityId: 'AAA',
  createdDate: '1951-01-01',
  updatedDate: '1951-02-01',
  ...patch,
});

const movement = (patch: Partial<NonNullable<MilitaryUnitPayload['movement']>> = {}): NonNullable<MilitaryUnitPayload['movement']> => ({
  path: ['a', 'b', 'c'],
  targetRegionId: 'c',
  targetRegionName: 'Regione c',
  startedDate: '1951-02-01',
  pathIndex: 1,
  daysPerHop: 7,
  remainingDaysToNextHop: 4,
  totalHops: 2,
  estimatedArrivalDate: '1951-02-15',
  motorized: false,
  lastAdvancedDate: '1951-02-03',
  ...patch,
});

describe('MAP P2 — persistent military map read model', () => {
  it('uses unit polityId for nationality and regionId alone for its valid GeoJSON position', () => {
    const regions = [region('a', 'AAA', 0), region('occupied', 'BBB', 10)];
    const model = buildMilitaryMapModel({
      regions,
      units: [unit('expeditionary', 'AAA', 'occupied', { regionName: 'Wrong name' })],
      fronts: [],
    });

    expect(militaryRegionAnchor(regions[1])).toEqual([12, 2]);
    expect(model.units[0]).toMatchObject({
      id: 'expeditionary', polityId: 'AAA', regionId: 'occupied', point: [12, 2],
      polity: { id: 'AAA', name: 'Politia AAA', color: '#aa0000', flag: 'AAA' },
    });
    expect(model.units[0].polity.id).not.toBe(regions[1].owner);
  });

  it('anchors the largest valid MultiPolygon part and rejects malformed GeoJSON', () => {
    const multi = region('islands', 'AAA', 0, { geojson: JSON.stringify({ geometry: {
      type: 'MultiPolygon',
      coordinates: [
        [[[0, 0], [1, 0], [1, 1], [0, 1], [0, 0]]],
        [[[10, 0], [16, 0], [16, 6], [10, 6], [10, 0]]],
      ],
    } }) });
    const malformed = region('bad', 'AAA', 0, { geojson: JSON.stringify({ geometry: {
      type: 'Polygon', coordinates: [[[0, 0], [4, 0], [4, 4], [0, 4]]],
    } }) });

    expect(militaryRegionAnchor(multi)).toEqual([13, 3]);
    expect(militaryRegionAnchor(malformed)).toBeNull();
  });

  it('filters destroyed units but preserves forming, operational, degraded, and retreating states', () => {
    const statuses: MilitaryMapUnitPayload['status'][] = [
      'forming', 'operational', 'degraded', 'retreating', 'destroyed',
    ];
    const model = buildMilitaryMapModel(
      [region('a', 'AAA')],
      statuses.map(status => unit(status, 'AAA', 'a', { status })),
    );

    expect(model.units.map(item => item.status)).toEqual([
      'degraded', 'forming', 'operational', 'retreating',
    ]);
    expect(model.units.map(item => item.id)).not.toContain('destroyed');
  });

  it('copies only the committed movement suffix and keeps raw ETA/progress fields', () => {
    const route = movement({ path: ['a', 'c', 'b'], pathIndex: 1, remainingDaysToNextHop: 3 });
    const model = buildMilitaryMapModel({
      regions: [
        region('a', 'AAA', 0, { borders: ['b'] }),
        region('b', 'AAA', 10, { borders: ['a', 'c'] }),
        region('c', 'AAA', 20, { borders: ['b'] }),
      ],
      units: [unit('moving', 'AAA', 'a', { movement: route })],
      fronts: [],
    });

    expect(model.movements).toHaveLength(1);
    expect(model.movements[0].route.path).toEqual(route.path.slice(route.pathIndex));
    // The read model does not replace the engine path with the graph's a→b→c path.
    expect(model.movements[0].route.path).toEqual(['c', 'b']);
    expect(model.movements[0].route).toMatchObject({
      pathIndex: 1,
      remainingDaysToNextHop: 3,
      daysPerHop: 7,
      totalHops: 2,
      estimatedArrivalDate: '1951-02-15',
      startedDate: '1951-02-01',
      motorized: false,
      lastAdvancedDate: '1951-02-03',
    });
    expect(model.movements[0].route.anchors).toEqual([
      { regionId: 'c', point: [22, 2] },
      { regionId: 'b', point: [12, 2] },
    ]);
    expect(route.path).toEqual(['a', 'c', 'b']);
  });

  it('assigns fronts only from unit.frontId and excludes moving units from active combat', () => {
    const model = buildMilitaryMapModel({
      regions: [region('a', 'AAA'), region('b', 'BBB', 10)],
      units: [
        unit('active', 'AAA', 'a', { frontId: 'f' }),
        unit('moving', 'AAA', 'a', { frontId: 'f', movement: movement() }),
        unit('same-region-no-front', 'BBB', 'a'),
        unit('destroyed', 'BBB', 'b', { frontId: 'f', status: 'destroyed' }),
      ],
      fronts: [front('f')],
    });

    expect(model.fronts[0].unitIds).toEqual(['active', 'moving']);
    expect(model.fronts[0].activeCombatUnitIds).toEqual(['active']);
  });

  it('represents NPC–NPC fronts and units through the same model as every other polity', () => {
    const model = buildMilitaryMapModel({
      regions: [region('n1', 'NPC-1'), region('n2', 'NPC-2', 10)],
      units: [
        unit('npc-one', 'NPC-1', 'n1', { frontId: 'npc-front' }),
        unit('npc-two', 'NPC-2', 'n2', { frontId: 'npc-front' }),
      ],
      fronts: [front('npc-front', {
        attackerPolityId: 'NPC-1', defenderPolityId: 'NPC-2', momentumPolityId: 'NPC-1',
      })],
    });

    expect(model.units.map(item => item.polityId)).toEqual(['NPC-1', 'NPC-2']);
    expect(model.fronts[0].unitIds).toEqual(['npc-one', 'npc-two']);
    expect(Object.keys(model.polities)).toEqual(['NPC-1', 'NPC-2']);

    const withPlayer = buildMilitaryMapModel({
      regions: [...model.units.map((_, index) => region(`p${index}`, `NPC-${index + 1}`)), region('home', 'PLAYER', 20)],
      units: [unit('player', 'PLAYER', 'home'), unit('npc', 'NPC-1', 'p0')],
      fronts: [],
    });
    expect(withPlayer.units.map(item => item.polityId)).toEqual(['PLAYER', 'NPC-1']);
  });

  it('does not naturalize a unit when its location is conquered', () => {
    const conqueredHome = region('aaa-home', 'BBB', 0, { polityName: 'Politia BBB', flag: 'BBB', color: '#0000bb' });
    const model = buildMilitaryMapModel({
      regions: [conqueredHome],
      units: [unit('survivor', 'AAA', 'aaa-home')],
      fronts: [],
    });

    expect(model.units[0]).toMatchObject({ polityId: 'AAA', regionId: 'aaa-home' });
    expect(model.units[0].polity).toMatchObject({ id: 'AAA', name: 'AAA', flag: null });
    expect(model.units[0].polity.color).not.toBe('#0000bb');
    expect(model.units[0].polity.id).not.toBe('BBB');
  });

  it('omits closed fronts and copies objective and momentum without deriving either', () => {
    const open = front('open', { objectiveRegionId: 'objective', momentumPolityId: 'BBB' });
    const model = buildMilitaryMapModel({
      regions: [region('a', 'AAA')],
      units: [],
      fronts: [front('closed', { status: 'closed' }), open],
    });

    expect(model.fronts).toHaveLength(1);
    expect(model.fronts[0]).toMatchObject({
      id: 'open', objectiveRegionId: 'objective', momentumPolityId: 'BBB',
    });
  });

  it('orders each region deterministically and exposes three counters plus overflow', () => {
    const regions = [region('a', 'AAA')];
    const shuffled = [
      unit('z', 'BBB', 'a', { armyId: '2' }),
      unit('c', 'AAA', 'a', { armyId: '2' }),
      unit('b', 'AAA', 'a', { armyId: '1' }),
      unit('a', 'AAA', 'a', { armyId: '1' }),
      unit('off-map', 'AAA', null),
    ];
    const first = buildMilitaryMapModel(regions, shuffled);
    const second = buildMilitaryMapModel(regions, [...shuffled].reverse());

    expect(first.unitsByRegion.a.map(item => item.id)).toEqual(['a', 'b', 'c', 'z']);
    expect(second.unitsByRegion.a.map(item => item.id)).toEqual(['a', 'b', 'c', 'z']);
    expect(first.stacksByRegion.a.visible.map(item => item.id)).toEqual(['a', 'b', 'c']);
    expect(first.stacksByRegion.a).toMatchObject({ overflow: 1, total: 4 });
    expect(militaryUnitDensity([1, 2])).toEqual({ visible: [1, 2], overflow: 0, total: 2 });
    expect(militaryUnitDensity([1, 2, 3, 4])).toEqual({ visible: [1, 2, 3], overflow: 1, total: 4 });
  });

  it('derives stable polity presentation independently of region input order', () => {
    const province = region('z-province', 'AAA', 10, { name: 'Provincia', polityName: 'Stato Alfa' });
    const capital = region('a-capital', 'AAA', 0, {
      name: 'Capitale', polityName: 'Stato Alfa', color: '#123456', flag: 'ALF', metadata: { isCapitalProvince: true },
    });

    expect(militaryPolityPresentation('AAA', [province, capital])).toEqual(
      militaryPolityPresentation('AAA', [capital, province]),
    );
    expect(militaryPolityPresentation('AAA', [province, capital])).toEqual({
      id: 'AAA', name: 'Stato Alfa', color: '#123456', flag: 'ALF',
    });
    expect(militaryPolityPresentation('MISSING', [province, capital])).toMatchObject({
      id: 'MISSING', name: 'MISSING', flag: null,
    });
    // Il fallback è stabile (hash del polityId) e mai il colore del territorio.
    expect(militaryPolityPresentation('MISSING', [province, capital]).color)
      .toBe(militaryPolityPresentation('MISSING', [capital]).color);
    expect(militaryPolityPresentation('MISSING', [province, capital]).color).not.toBe('#123456');
  });

  it('suppresses legacy military objects only on exact persistent unit/army ids', () => {
    const area = region('a', 'AAA', 0, { objects: [
      { id: 'unit-exact', type: 'battalion', name: 'Duplicate unit' },
      { id: 'army-exact', type: 'army', name: 'Duplicate army' },
      { id: 'Unit-Exact', type: 'army', name: 'Different case' },
      { id: 'unit-exact-old', type: 'army', name: 'Similar only' },
      { id: 'legacy-only', type: 'fleet', name: 'Fallback fleet', owner: 'BBB' },
      { id: 'factory', type: 'factory', name: 'Not military' },
      { id: 'dead-id', type: 'army', name: 'Must not resurrect' },
    ] });
    const model = buildMilitaryMapModel({
      regions: [area],
      units: [
        unit('unit-exact', 'AAA', 'a', { armyId: 'army-exact' }),
        unit('dead-id', 'AAA', 'a', { armyId: 'dead-army', status: 'destroyed' }),
      ],
      fronts: [],
    });

    expect(model.legacyObjects.map(item => item.id)).toEqual(['Unit-Exact', 'legacy-only', 'unit-exact-old']);
    expect(model.legacyObjects.find(item => item.id === 'legacy-only')).toMatchObject({
      source: 'legacy', regionId: 'a', polityId: 'BBB', point: [2, 2],
    });
  });

  it('keeps a legacy fallback when there is no exact persistent match', () => {
    const model = buildMilitaryMapModel({
      regions: [region('a', 'AAA', 0, { objects: [
        { id: 'old-army', type: 'army', name: 'Vecchia armata' },
      ] })],
      units: [unit('new-unit', 'AAA', 'a', { armyId: 'new-army', name: 'Vecchia armata' })],
      fronts: [],
    });

    expect(model.units.map(item => item.id)).toEqual(['new-unit']);
    expect(model.legacyObjects.map(item => item.id)).toEqual(['old-army']);
  });
});
