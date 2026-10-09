import { describe, expect, it } from 'vitest';
import type { Region } from '../../types';
import type { WarFrontPayload } from '../../services/api';
import { buildMapContextIndex } from '../Map/mapContext';
import { regionIdsForFocus } from '../Map/mapFocus';
import { buildGovernmentVisualSnapshot, governmentVisualEpoch, governmentVisualRuntimeMatches, governmentVisualModel, mapFocusFromVisual, resolveGovernmentVisuals, type MapFocusVisual } from './governmentVisual';
import { actionSnapshotKey } from './actionSnapshot';

const polygon = (x: number) => JSON.stringify({ type: 'Feature', geometry: { type: 'Polygon', coordinates: [[[x, 0], [x + 1, 0], [x + 1, 1], [x, 1], [x, 0]]] } });
const regions: Region[] = [
  { id: 'north', name: 'Nord', owner: 'A', polityName: 'Paese A', color: '#315f87', geojson: polygon(0), objects: [], borders: ['east'], metadata: {} },
  { id: 'east', name: 'Est', owner: 'B', polityName: 'Paese B', color: '#ad7749', geojson: polygon(1), objects: [], borders: ['north'], metadata: {} },
] as Region[];
const front = { id: 'border', name: 'Fronte di confine', status: 'active', regionIds: ['north', 'east'], objectiveRegionId: 'east' } as WarFrontPayload;
const snapshot = (list = regions, fronts = [front], scopeKey = 'game:A:branch:1') => ({ scopeKey, index: buildMapContextIndex({ regions: list, fronts, units: [] }) });
const visual: MapFocusVisual = { type: 'map-focus', title: front.name, regionIds: ['north', 'east'], scopeKey: snapshot().scopeKey };

describe('Government visual resolver — current canonical geography only', () => {
  it('valid region IDs produce real paths, owner colors and dynamic legend', () => {
    const model = governmentVisualModel(visual, snapshot())!;
    expect(model.preview?.paths.map(path => path.id)).toEqual(visual.regionIds);
    expect(model.preview?.paths[0].path).toMatch(/^M/);
    expect(model.legend.map(entry => [entry.label, entry.color])).toEqual([['Paese A', '#315f87'], ['Paese B', '#ad7749']]);
    expect(model.regions.map(region => region.name)).toEqual(['Nord', 'Est']);
  });

  it('rejects unknown IDs, even when a known ID is also supplied', () => {
    expect(governmentVisualModel({ ...visual, regionIds: ['invented'] }, snapshot())).toBeNull();
    expect(governmentVisualModel({ ...visual, regionIds: ['north', 'invented'] }, snapshot())).toBeNull();
    expect(mapFocusFromVisual({ ...visual, regionIds: ['invented'] }, snapshot(), 1)).toBeNull();
  });

  it('resolves only referenced active fronts, never text names or general military/economic keys', () => {
    const cue = { role: 'assistant' as const, content: 'Il Nord richiede attenzione.', situations: [{ signalKeys: ['conflict:border'] }], issues: [{ signalKeys: ['conflict:border'] }] };
    expect(resolveGovernmentVisuals(cue, snapshot()).map(card => card.regionIds)).toEqual([['north', 'east']]);
    for (const signalKeys of [[], ['military-readiness'], ['military-supply'], ['monthly-balance'], ['conflict:unknown']]) {
      expect(resolveGovernmentVisuals({ ...cue, issues: [], situations: [{ signalKeys }] }, snapshot())).toEqual([]);
    }
    expect(resolveGovernmentVisuals({ ...cue, role: 'user' }, snapshot())).toEqual([]);
    expect(resolveGovernmentVisuals(cue, snapshot(regions, [{ ...front, status: 'closed' }]))).toEqual([]);
  });

  it('does not re-badge old military arrays during the pre-refresh render of a new game/branch/rewind/restore', () => {
    const game = { id: 'A', currentTurn: 2, currentDate: '1951-01-02', worldRevision: 3, headBranchId: 'branch1' };
    const runtime = { gameId: 'A', branchId: 'branch1', worldRevision: 3 };
    expect(governmentVisualRuntimeMatches(game, runtime)).toBe(true);
    expect(governmentVisualRuntimeMatches(game, { ...runtime, branchId: 'branch2' })).toBe(false);
    expect(governmentVisualRuntimeMatches(game, { ...runtime, worldRevision: 4 })).toBe(false);
    expect(governmentVisualRuntimeMatches(game, { ...runtime, gameId: 'B' })).toBe(false);
    expect(governmentVisualRuntimeMatches(game, null)).toBe(false);
    const militarySnapshotKey = actionSnapshotKey(game);
    const base = { scopeKey: 'fresh-UI-epoch', canonicalSnapshotKey: militarySnapshotKey, militarySnapshotKey, index: snapshot().index, unavailable: false };
    expect(buildGovernmentVisualSnapshot(base)?.index).toBe(base.index);
    for (const next of [{ ...game, id: 'B' }, { ...game, headBranchId: 'branch2' }, { ...game, currentTurn: 1 }, { ...game, worldRevision: 4 }]) {
      const current = buildGovernmentVisualSnapshot({ ...base, canonicalSnapshotKey: actionSnapshotKey(next) })!;
      expect(current.militaryAvailable).toBe(false);
      expect(resolveGovernmentVisuals({ role: 'assistant', situations: [{ signalKeys: ['conflict:border'] }] }, current)).toEqual([]);
    }
    expect(buildGovernmentVisualSnapshot({ ...base, militarySnapshotKey: null })?.militaryAvailable).toBe(false);
    expect(buildGovernmentVisualSnapshot({ ...base, unavailable: true })).toBeUndefined();
    expect(governmentVisualEpoch({ state: { gameId: 'A', branchId: 'b', worldRevision: 1 }, commandGeneration: 2 })).not.toEqual(
      governmentVisualEpoch({ state: { gameId: 'A', branchId: 'b', worldRevision: 1 }, commandGeneration: 3 }));
  });

  it('does not retain references across games/branches/rewind, or deleted regions/fronts', () => {
    for (const scopeKey of ['game:B:branch:1', 'game:A:branch:2', 'game:A:branch:1:rewind']) {
      expect(governmentVisualModel(visual, snapshot(regions, [front], scopeKey))).toBeNull();
      expect(mapFocusFromVisual(visual, snapshot(regions, [front], scopeKey), 1)).toBeNull();
    }
    expect(governmentVisualModel(visual, snapshot(regions.slice(0, 1)))).toBeNull();
    expect(resolveGovernmentVisuals({ role: 'assistant', situations: [{ signalKeys: ['conflict:border'] }] }, snapshot(regions, []))).toEqual([]);
  });

  it('region updates re-resolve current names, owners and geometry, without mutating state', () => {
    const updated = [{ ...regions[0], color: '#bb2244', polityName: 'Nuovo proprietario', owner: 'C', geojson: polygon(2) }, regions[1]];
    const before = JSON.stringify(updated);
    const model = governmentVisualModel(visual, snapshot(updated))!;
    expect(model.legend[0].label).toBe('Nuovo proprietario');
    expect(model.legend[0].color).toBe('#bb2244');
    expect(model.preview?.paths[0].path).not.toEqual(governmentVisualModel(visual, snapshot())!.preview?.paths[0].path);
    expect(JSON.stringify(updated)).toBe(before);
  });

  it('missing/corrupt geometry or mixed coordinate systems use the complete textual territory list', () => {
    for (const updated of [
      regions.map(region => ({ ...region, geojson: undefined })),
      [{ ...regions[0], geojson: 'invalid' }, regions[1]],
      [{ ...regions[0], geojson: undefined, svgPath: 'M0 0L10 0L10 10Z' }, regions[1]],
    ]) {
      const model = governmentVisualModel(visual, snapshot(updated))!;
      expect(model.preview).toBeNull();
      expect(model.regions).toHaveLength(2);
    }
  });

  it('reuses SVG paths verbatim and frames their real coordinates', () => {
    const svgRegions = regions.map((region, index) => ({ ...region, geojson: undefined, svgPath: `M${100 + index * 100} 200 L${150 + index * 100} 200 L${150 + index * 100} 250 Z` }));
    const model = governmentVisualModel(visual, snapshot(svgRegions))!;
    expect(model.preview?.paths.map(path => path.path)).toEqual(svgRegions.map(region => region.svgPath));
    expect(model.preview?.viewBox).not.toBe('0 0 2000 1500');
  });

  it('preserves MultiPolygon parts and holes from the canonical GeoJSON', () => {
    const geojson = JSON.stringify({ type: 'Feature', geometry: { type: 'MultiPolygon', coordinates: [
      [[[0, 0], [4, 0], [4, 4], [0, 4], [0, 0]], [[1, 1], [2, 1], [2, 2], [1, 2], [1, 1]]],
      [[[5, 0], [6, 0], [6, 1], [5, 1], [5, 0]]],
    ] } });
    const model = governmentVisualModel({ ...visual, regionIds: ['north'] }, snapshot([{ ...regions[0], geojson }]))!;
    expect(model.preview?.paths[0].path.match(/M/g)).toHaveLength(3);
    expect(model.preview?.paths[0].path.match(/Z/g)).toHaveLength(3);
  });

  it('refuses an antimeridian-spanning approximation instead of drawing a misleading preview', () => {
    const geojson = JSON.stringify({ type: 'Feature', geometry: { type: 'Polygon', coordinates: [[[179, 0], [-179, 0], [-179, 1], [179, 1], [179, 0]]] } });
    expect(governmentVisualModel({ ...visual, regionIds: ['north'] }, snapshot([{ ...regions[0], geojson }]))!.preview).toBeNull();
  });

  it('MapLibre-style focus preserves all validated IDs and repeats explicit commands', () => {
    expect(mapFocusFromVisual(visual, snapshot(), 7)).toEqual({ regionIds: ['north', 'east'], requestId: 7, scopeKey: visual.scopeKey });
    expect(regionIdsForFocus({ regionId: 'north', requestId: 1 }, snapshot().index.regionsById)).toEqual(['north']);
    expect(regionIdsForFocus({ regionIds: ['east', 'north', 'east'], requestId: 2 }, snapshot().index.regionsById)).toEqual(['east', 'north']);
    expect(regionIdsForFocus({ regionIds: ['north', 'missing'], requestId: 2 }, snapshot().index.regionsById)).toEqual([]);
  });
});
