import { describe, expect, it } from 'vitest';
import {
  buildVerifiedWorldSnapshot,
  type VerifiedWorldGameData,
} from '../src/core/government/VerifiedWorldSnapshot';

function uganda(): VerifiedWorldGameData {
  return {
    id: 'verified-game', currentDate: '1951-02-01', currentTurn: 2,
    playerPolityId: 'UGA', playerPolityName: 'Uganda', polityNames: { UGA: 'Uganda', KEN: 'Kenya' },
    world: { regions: {
      uga: { id: 'uga', name: 'Uganda', owner: 'UGA', coastal: false, borders: ['ken'], objects: [] },
      ken: { id: 'ken', name: 'Kenya', owner: 'KEN', coastal: true, borders: ['uga'], objects: [] },
    } },
    worldState: {
      accounts: { UGA: { polityId: 'UGA', ports: 9, factories: 12, forces: 4,
        mobilized: 0, population: 5_000_000, monthlyBalance: -0.06575272084693667,
        monthlyRevenue: 1.123456789, monthlyExpenses: 1.18920950984693667, socialTension: 41.23456789 } },
      resources: { stock: { money: 7.60987654321, food: 8, debts: [] }, needs: { food: 10, fuel: 2 } },
      arsenal: { units: { fucili: 12345 } },
    },
    relationships: {}, actions: [], results: [], ongoingProcesses: [],
  };
}

const build = (gameData = uganda()) => buildVerifiedWorldSnapshot({ gameData, operationalRows: [] });

describe('VerifiedWorldSnapshot — canonical reality, not capacity or historical geography', () => {
  it('Uganda has no ports, railways, factories or navy even when national capacity is positive', () => {
    const snapshot = build();
    expect(snapshot.polityId).toBe('UGA');
    expect(snapshot.geography).toMatchObject({ coastal: false, landlocked: true,
      borderingPolities: [{ polityId: 'KEN', polityName: 'Kenya' }] });
    expect(snapshot.infrastructure.ports).toEqual([]);
    expect(snapshot.infrastructure.railways).toEqual([]);
    expect(snapshot.infrastructure.factories).toEqual([]);
    expect(snapshot.military.formations).toEqual([]);
    expect(snapshot.military.navalUnits).toEqual([]);
    expect(snapshot.facts.ports.value).toBe('Porti posseduti: nessuno');
    expect(snapshot.facts.railways.value).toBe('Ferrovie possedute: nessuna');
    expect(snapshot.facts.navalUnits.value).toBe('Unità navali registrate: nessuna');
    expect(JSON.stringify(snapshot)).not.toContain('Kampala Port');
  });

  it('coast is independent of ports: a coastal country can have an empty inventory', () => {
    const game = uganda();
    game.world!.regions!.uga.coastal = true;
    const snapshot = build(game);
    expect(snapshot.geography.coastal).toBe(true);
    expect(snapshot.geography.landlocked).toBe(false);
    expect(snapshot.infrastructure.ports).toEqual([]);
  });

  it('a real port does not establish a coast when the map explicitly says landlocked', () => {
    const game = uganda();
    game.world!.regions!.uga.objects = [{ id: 'lake-port', name: 'Approdo', type: 'port', level: 2 }];
    const snapshot = build(game);
    expect(snapshot.geography.coastal).toBe(false);
    expect(snapshot.geography.landlocked).toBe(true);
    expect(snapshot.infrastructure.ports).toMatchObject([{ id: 'lake-port', name: 'Approdo', regionId: 'uga', regionName: 'Uganda' }]);
  });

  it('missing coastal flags are unknown, not a real-world geography guess', () => {
    const game = uganda();
    delete game.world!.regions!.uga.coastal;
    expect(build(game).geography).toMatchObject({ coastal: null, landlocked: null });
    expect(build(game).facts.coastal).toBeUndefined();
  });

  it('uses canonical GeoJSON coastal metadata when present, never ports or country knowledge', () => {
    const game = uganda();
    delete game.world!.regions!.uga.coastal;
    game.world!.regions!.uga.id = 'verified-geography-test';
    game.world!.regions!.uga.geojson = '{"properties":{"surface_type":"Coastal"}}';
    expect(build(game).geography).toMatchObject({ coastal: true, landlocked: false });
  });

  it('geometry alone without surface metadata does not prove an inland country', () => {
    const game = uganda();
    delete game.world!.regions!.uga.coastal;
    game.world!.regions!.uga.geojson = '{"type":"Polygon","coordinates":[]}';
    expect(build(game).geography).toMatchObject({ coastal: null, landlocked: null });
  });

  it('uses the effective food coverage supplied by the canonical engine when available', () => {
    const snapshot = buildVerifiedWorldSnapshot({ gameData: uganda(), foodCoverageMonths: 0.7123456789 });
    expect(snapshot.economy.foodCoverageMonths).toBe(0.7123456789);
    expect(snapshot.facts.foodCoverageMonths.rawValue).toBe(0.7123456789);
    expect(snapshot.facts.foodCoverageMonths.value).toBe('0,7 mesi');
    expect(buildVerifiedWorldSnapshot({ gameData: uganda(), foodCoverageMonths: null }).economy.foodCoverageMonths).toBeNull();
  });

  it('one verified coast is sufficient, while mixed inland/unknown regions cannot prove landlocked', () => {
    const game = uganda();
    game.world!.regions!.other = { id: 'other', name: 'Provincia', owner: 'UGA', borders: [], objects: [] };
    expect(build(game).geography.landlocked).toBeNull();
    game.world!.regions!.other.coastal = true;
    expect(build(game).geography.coastal).toBe(true);
  });

  it('inventories only actual supported map assets, excluding foreign objects and planned infrastructure', () => {
    const game = uganda();
    game.world!.regions!.uga.objects = [
      { id: 'air', name: 'Base aerea', type: 'airbase' },
      { id: 'rail', name: 'Linea completata', type: 'ft_railway' },
      { id: 'road', name: 'Strada completata', type: 'ft_road' },
      { id: 'factory', name: 'Officine', type: 'factory' },
      { id: 'site', name: 'Nuovo porto', type: 'construction_site', metadata: { plannedType: 'port' } },
      { id: 'generic', name: 'Ferrovia immaginata', type: 'infrastructure' },
      { id: 'foreign', name: 'Base straniera', type: 'port', owner: 'KEN' },
    ];
    game.world!.regions!.ken.objects = [{ id: 'ken-port', name: 'Porto Kenya', type: 'port' }];
    const snapshot = build(game);
    expect(snapshot.infrastructure.ports).toEqual([]);
    expect(snapshot.infrastructure.airfields.map(asset => asset.id)).toEqual(['air']);
    expect(snapshot.infrastructure.railways.map(asset => asset.id)).toEqual(['rail']);
    expect(snapshot.infrastructure.roads.map(asset => asset.id)).toEqual(['road']);
    expect(snapshot.infrastructure.factories.map(asset => asset.id)).toEqual(['factory']);
    expect(snapshot.infrastructure.constructionSites.map(asset => asset.id)).toEqual(['site']);
  });

  it('recognizes delivered catalogue facility types, without turning industrial capacity into ports', () => {
    const game = uganda();
    game.world!.regions!.uga.objects = [
      { id: 'rail', type: 'ft_railway' }, { id: 'road', type: 'ft_road' },
      { id: 'factory', type: 'ft_factory' }, { id: 'works', type: 'ft_works' },
      { id: 'foundry', type: 'ft_foundry' }, { id: 'power', type: 'ft_power' },
      { id: 'school', type: 'ft_school' }, { id: 'water', type: 'ft_water' },
    ];
    const snapshot = build(game);
    expect(snapshot.infrastructure.factories!.map(asset => asset.id)).toEqual(['factory', 'works', 'foundry']);
    expect(snapshot.infrastructure.other!.map(asset => asset.id)).toEqual(['power', 'school', 'water']);
    expect(snapshot.infrastructure.ports).toEqual([]);
  });

  it('missing object inventories are unknown, not evidence of no ports, railways or navy', () => {
    const game = uganda();
    delete game.world!.regions!.uga.objects;
    const snapshot = build(game);
    expect(snapshot.infrastructure.ports).toBeNull();
    expect(snapshot.infrastructure.railways).toBeNull();
    expect(snapshot.facts.ports).toBeUndefined();
    expect(snapshot.facts.railways).toBeUndefined();
    expect(snapshot.facts.navalUnits).toBeUndefined();
    expect(snapshot.unavailable).toContain('infrastructure.ports');
    expect(snapshot.unavailable).toContain('military.formations');
  });

  it('one missing owned inventory prevents claiming a complete inventory from the other regions', () => {
    const game = uganda();
    game.world!.regions!.other = { id: 'other', name: 'Provincia', owner: 'UGA', coastal: false, borders: [] };
    expect(build(game).infrastructure.ports).toBeNull();
    expect(build(game).facts.ports).toBeUndefined();
  });

  it('ignores unsupported prototype-named map types rather than inventing infrastructure or crashing', () => {
    const game = uganda();
    game.world!.regions!.uga.objects = [{ id: 'unknown', type: 'constructor', name: 'Oggetto non supportato' }];
    expect(build(game).infrastructure.ports).toEqual([]);
    expect(build(game).infrastructure.other).toEqual([]);
  });

  it('does not assert that there are no neighbours when map adjacency is incomplete', () => {
    const game = uganda();
    game.world!.regions!.uga.borders!.push('missing-region');
    expect(build(game).geography.borderingPolities).toBeNull();
  });

  it('preserves exact raw values, formats facts only, and detaches the snapshot from engine state', () => {
    const game = uganda();
    const before = structuredClone(game);
    const snapshot = build(game);
    expect(snapshot.economy.treasury).toBe(7.60987654321);
    expect(snapshot.economy.monthlyBalance).toBe(-0.06575272084693667);
    expect(snapshot.economy.foodCoverageMonths).toBe(0.8);
    expect(snapshot.facts.treasury).toMatchObject({ key: 'treasury', rawValue: 7.60987654321,
      value: '7,61 mld USD', source: 'national_economy', sourceRef: 'worldState.resources.stock.money' });
    expect(snapshot.facts.foodCoverageMonths.value).toBe('0,8 mesi');
    expect(snapshot.facts.socialTension.value).toBe('41,2 / 100');
    expect(game).toEqual(before);
    game.worldState!.resources!.stock!.money = 99;
    expect(snapshot.economy.resources!.money).toBe(7.60987654321);
  });

  it('missing economy and military data stays unknown, never zero or doctrine-invented units', () => {
    const snapshot = buildVerifiedWorldSnapshot({ gameData: { id: 'empty', playerPolityId: 'UGA' } });
    expect(snapshot.geography.coastal).toBeNull();
    expect(snapshot.economy.treasury).toBeNull();
    expect(snapshot.economy.debt).toBeNull();
    expect(snapshot.economy.foodCoverageMonths).toBeNull();
    expect(snapshot.military.manpower).toBeNull();
    expect(snapshot.military.readiness).toBeNull();
    expect(snapshot.military.equipment).toBeNull();
    expect(snapshot.facts.treasury).toBeUndefined();
  });

  it('registered hostility is not a war; diplomacy is not inferred from prose or map neighbours', () => {
    const game = uganda();
    game.relationships = { UGA: { KEN: 'hostile', ITA: 'ally' }, FRA: { DEU: 'hostile' } };
    const snapshot = build(game);
    expect(snapshot.diplomacy.relations).toHaveLength(2);
    expect(snapshot.diplomacy.alliances).toMatchObject([{ polityId: 'ITA', relationship: 'ally' }]);
    expect(snapshot.diplomacy.wars).toBeNull();
    expect(snapshot.diplomacy.sanctions).toBeNull();
    expect(snapshot.diplomacy.activeNegotiations).toBeNull();
    expect(snapshot.diplomacy.commitments).toBeNull();
  });

  it('missing diplomacy is unknown, whereas an available empty registry is empty', () => {
    const game = uganda();
    delete game.relationships;
    expect(build(game).diplomacy.relations).toBeNull();
    game.relationships = {};
    expect(build(game).diplomacy.relations).toEqual([]);
  });

  it('reads only player-owned operational units, and does not turn seeded shipyards into ports', () => {
    const snapshot = buildVerifiedWorldSnapshot({ gameData: uganda(), operationalRows: [
      { id: 'seeded-shipyard', kind: 'facility', data: { id: 'seeded-shipyard', kind: 'shipyard', name: 'Cantiere Uganda', regionId: 'uga', legacyDerived: true } },
      { id: 'ug-unit', kind: 'unit', data: { id: 'ug-unit', polityId: 'UGA', name: 'Reparto reale', readiness: 0.7123456789, regionId: 'uga', personnel: 777, equipment: { fucili: 400 }, order: 'defend' } },
      { id: 'ke-unit', kind: 'unit', data: { id: 'ke-unit', polityId: 'KEN', name: 'Reparto Kenya', regionId: 'uga' } },
      { id: 'front', kind: 'front', data: { id: 'front', attackerPolityId: 'UGA', defenderPolityId: 'KEN', status: 'active', regionIds: ['uga', 'ken'] } },
    ] });
    expect(snapshot.infrastructure.ports).toEqual([]);
    expect(snapshot.military.units.map(unit => unit.id)).toEqual(['ug-unit']);
    expect(snapshot.military.readiness).toEqual([{ unitId: 'ug-unit', value: 0.7123456789 }]);
    expect(snapshot.military.fronts.map(front => front.id)).toEqual(['front']);
  });

  it('includes real recent events, orders, consequences, processes and due verified reports without quest options', () => {
    const game = uganda();
    game.actions = [{ id: 'order-1', playerId: 'player', turn: 1, text: 'Importare cibo', createdAt: '1951-01-01' }];
    game.results = [{ id: 'result-1', turn: 1, date: '1951-01-01', narration: 'Importazioni iniziate.', countryResponse: '', events: [],
      timelineEvents: [{ id: 'event-1', date: '1951-01-01', headline: 'Importazioni', detail: 'Avvio registrato.', source: 'world', sourceActionIds: ['order-1'] }] }];
    game.ongoingProcesses = [{ id: 'project-1', title: 'Importazioni', sourceActionId: 'order-1', progress: 20.123456789 }];
    const snapshot = buildVerifiedWorldSnapshot({ gameData: game, decisions: [
      { id: 'decision-1', title: 'Approvvigionamento', status: 'resolved', resolution: 'Importare per 90 giorni', resolvedDate: '1951-01-01' },
    ] });
    expect(snapshot.recent.events[0]).toMatchObject({ id: 'event-1', sourceActionIds: ['order-1'] });
    expect(snapshot.recent.orders[0].id).toBe('order-1');
    expect(snapshot.recent.consequences[0].id).toBe('result-1');
    expect(snapshot.economy.ongoingProjects![0].progress).toBe(20.123456789);
    expect(snapshot.recent.followUps![0]).toMatchObject({ sourceDecisionId: 'decision-1', label: 'Importare per 90 giorni' });
    expect(JSON.stringify(snapshot.recent.followUps)).not.toContain('options');
  });

  it('cannot assert a trend without a real earlier same-game same-branch snapshot', () => {
    const snapshot = build();
    expect(snapshot.changes).toMatchObject({ available: false, reason: 'previous_snapshot_unavailable', deltas: [] });
    const game = uganda();
    game.currentTurn = 1; game.currentDate = '1951-01-01';
    const previous = build(game);
    previous.gameId = 'another-game';
    expect(buildVerifiedWorldSnapshot({ gameData: uganda(), previousSnapshot: previous }).changes.available).toBe(false);
  });

  it('preserves overdue report timing and takes the latest decisions independent of repository ordering', () => {
    const decisions = Array.from({ length: 12 }, (_, index) => ({
      id: `decision-${index}`, title: 'Atto', status: 'resolved', createdTurn: index,
      resolution: 'Decisione registrata', resolvedDate: `1950-12-${String(index + 1).padStart(2, '0')}`,
    })).reverse();
    const snapshot = buildVerifiedWorldSnapshot({ gameData: uganda(), decisions });
    expect(snapshot.recent.decisions!.map(decision => decision.id)).toEqual([
      'decision-4', 'decision-5', 'decision-6', 'decision-7', 'decision-8', 'decision-9', 'decision-10', 'decision-11',
    ]);
    expect(snapshot.recent.followUps!.find(report => report.sourceDecisionId === 'decision-11')!.daysLeft).toBe(-21);
  });

  it('malformed legacy dates do not become an invented overdue report or break the read model', () => {
    const snapshot = buildVerifiedWorldSnapshot({ gameData: uganda(), decisions: [
      { id: 'legacy', title: 'Atto legacy', status: 'resolved', resolvedDate: 'invalid-date' },
    ] });
    expect(snapshot.recent.decisions![0].id).toBe('legacy');
    expect(snapshot.recent.followUps).toEqual([]);
  });

  it('ships already registered outside the depot are not presented as an absent navy', () => {
    const snapshot = buildVerifiedWorldSnapshot({ gameData: uganda(), operationalRows: [
      { id: 'ship-1', kind: 'ship', data: { id: 'ship-1', name: 'Nave registrata', equipmentId: 'pattugliatori', regionId: 'uga' } },
    ] });
    expect(snapshot.facts.navalUnits.value).not.toBe('Unità navali registrate: nessuna');
    expect(snapshot.facts.navalUnits.value).toContain('Nave registrata');
  });

  it('resources and real military unit readiness have referencable readable facts and raw deltas', () => {
    const oldGame = uganda(); oldGame.currentTurn = 1; oldGame.currentDate = '1951-01-01';
    oldGame.worldState!.resources!.stock!.food = 10;
    const previous = buildVerifiedWorldSnapshot({ gameData: oldGame });
    const snapshot = buildVerifiedWorldSnapshot({ gameData: uganda(), previousSnapshot: previous, operationalRows: [
      { id: 'unit-1', kind: 'unit', data: { id: 'unit-1', polityId: 'UGA', name: 'Reparto', readiness: 0.7123456789, personnel: 777 } },
    ] });
    expect(snapshot.facts['resources.food'].rawValue).toBe(8);
    expect(snapshot.changes.deltas.find(delta => delta.key === 'resources.food')).toMatchObject({ before: 10, after: 8, delta: -2 });
    expect(snapshot.facts['military.units.unit-1.readiness']).toMatchObject({ rawValue: 0.7123456789, value: '71,2%' });
  });

  it('does not silently compare to an older turn when the immediately previous turn is unavailable', () => {
    const oldGame = uganda(); oldGame.currentTurn = 0; oldGame.currentDate = '1950-12-01';
    expect(buildVerifiedWorldSnapshot({ gameData: uganda(), previousSnapshot: build(oldGame) }).changes)
      .toMatchObject({ available: false, reason: 'previous_snapshot_not_comparable', deltas: [] });
  });

  it('distinguishes missing historical food from unchanged measured values', () => {
    const oldGame = uganda(); oldGame.currentTurn = 1; oldGame.currentDate = '1951-01-01';
    const previous = buildVerifiedWorldSnapshot({ gameData: oldGame, foodCoverageMonths: null });
    const snapshot = buildVerifiedWorldSnapshot({ gameData: uganda(), previousSnapshot: previous });
    expect(snapshot.changes.comparedKeys).toContain('treasury');
    expect(snapshot.changes.unavailableKeys).toContain('foodCoverageMonths');
    expect(snapshot.changes.comparedKeys).not.toContain('foodCoverageMonths');
    expect(snapshot.changes.deltas.some(delta => delta.key === 'foodCoverageMonths')).toBe(false);
  });

  it('computes deltas from raw comparable earlier facts, not rounded prompt values or observations in one turn', () => {
    const oldGame = uganda();
    oldGame.currentTurn = 1; oldGame.currentDate = '1951-01-01';
    oldGame.worldState!.resources!.stock!.money = 7.609;
    const previous = buildVerifiedWorldSnapshot({ gameData: oldGame, branchId: 'main' });
    const snapshot = buildVerifiedWorldSnapshot({ gameData: uganda(), branchId: 'main', previousSnapshot: previous });
    expect(snapshot.changes.available).toBe(true);
    expect(snapshot.changes.comparedKeys).toContain('socialTension');
    expect(snapshot.changes.unavailableKeys).toContain('military');
    expect(snapshot.changes.deltas.find(delta => delta.key === 'treasury')).toMatchObject({
      before: 7.609, after: 7.60987654321, delta: 7.60987654321 - 7.609,
    });
    expect(buildVerifiedWorldSnapshot({ gameData: uganda(), branchId: 'fork', previousSnapshot: previous }).changes.available).toBe(false);
    expect(buildVerifiedWorldSnapshot({ gameData: uganda(), previousSnapshot: build() }).changes.available).toBe(false);
  });
});
