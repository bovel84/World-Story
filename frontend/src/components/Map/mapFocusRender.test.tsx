import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import type { Region } from '../../types';
import { GameMap, type GameMapProps } from '../Game/GameMap';
import { focusViewBox } from '../Game/regionFocus';
import { MapView } from './MapView';
import { StaticGeoMap } from './StaticGeoMap';
import { buildStaticMap } from './staticMapModel';

const regions = [0, 1, 2].map(index => ({ id: `r${index}`, name: `Provincia ${index}`, owner: 'A', color: '#315f87', objects: [], borders: [], metadata: {},
  svgPath: `M${index * 100} 100L${index * 100 + 100} 100L${index * 100 + 100} 200L${index * 100} 200Z`,
  geojson: JSON.stringify({ type: 'Feature', geometry: { type: 'Polygon', coordinates: [[[index, 0], [index + 1, 0], [index + 1, 1], [index, 1], [index, 0]]] } }),
})) as Region[];
const focus = { regionIds: ['r0', 'r1'], requestId: 1 };
const viewBox = (html: string) => html.match(/viewBox="([^"]+)"/)?.[1];
const whiteBorders = (html: string) => html.match(/<path[^>]+stroke="#ffffff"/g)?.length ?? 0;
const gameMapProps: GameMapProps = { regions, activeLayer: 'political', filters: {}, onLayerChange: () => {}, onFiltersChange: () => {}, onRegionClick: () => {}, onUnitClick: () => {}, onFrontClick: () => {}, changedRegionIds: [], temporalScars: [], events: [], militaryUnits: [], militaryFronts: [], showFlags: false, playerCountryCode: 'A', onBackToScenarios: () => {} };

describe('Explicit main-map focus in real SVG fallbacks', () => {
  it('StaticGeoMap frames and highlights every requested region, not the whole world', () => {
    const html = renderToStaticMarkup(<StaticGeoMap regions={regions} focusRegionRequest={focus} />);
    const model = buildStaticMap(regions);
    expect(viewBox(html)).toBe(focusViewBox(model.paths.map(path => ({ id: path.id, svgPath: path.path })), focus.regionIds, 20));
    expect(viewBox(html)).not.toBe('0 0 1000 600');
    expect(whiteBorders(html)).toBe(2);
  });

  it('GameMap forwards the same request to the no-WebGL renderer', () => {
    const html = renderToStaticMarkup(<GameMap {...gameMapProps} focusRegionRequest={focus} />);
    expect(html).toContain('static-geo-map');
    expect(whiteBorders(html)).toBe(2);
    expect(viewBox(html)).not.toBe('0 0 1000 600');
  });

  it('GameMap forwards multi-focus to legacy SVG and retains single-region focus', () => {
    const svgRegions = regions.map(region => ({ ...region, geojson: undefined }));
    const multi = renderToStaticMarkup(<GameMap {...gameMapProps} regions={svgRegions} focusRegionRequest={focus} />);
    expect(viewBox(multi)).toBe(focusViewBox(svgRegions, focus.regionIds, 40));
    expect(whiteBorders(multi)).toBe(2);
    const single = renderToStaticMarkup(<MapView regions={svgRegions} focusRegionRequest={{ regionId: 'r0', requestId: 2 }} />);
    expect(viewBox(single)).toBe(focusViewBox(svgRegions, ['r0'], 40));
    expect(whiteBorders(single)).toBe(1);
  });

  it('missing geometry never silently frames/highlights only a subset', () => {
    const svgRegions = regions.map((region, index) => ({ ...region, geojson: undefined, svgPath: index === 0 ? undefined : region.svgPath }));
    const html = renderToStaticMarkup(<MapView regions={svgRegions} focusRegionRequest={focus} />);
    expect(viewBox(html)).toBe('0 0 2000 1500');
    expect(whiteBorders(html)).toBe(0);
  });
});
