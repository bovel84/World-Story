import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import type { Region } from '../../types';
import type { MilitaryUnitPayload } from '../../services/api';
import type { CanonicalFacilitySite } from './thematicMapModel';
import { staticOperationalEntries, StaticOperationalIndex } from './StaticOperationalIndex';

const regions = [
  { id: 'gulu', name: 'Gulu', owner: 'UGA', objects: [
    { id: 'plant-1', type: 'factory', name: 'Zuccherificio' },
    { id: 'port-1', type: 'port', name: 'Porto sul lago' },
  ] },
  { id: 'ituri', name: 'Ituri', owner: 'COD', objects: [] },
] as unknown as Region[];
const unit = (id: string, polityId: string, regionId: string, status = 'operational') =>
  ({ id, name: id, polityId, regionId, status } as MilitaryUnitPayload);
const facility = (id: string, regionId: string, polityId: string): CanonicalFacilitySite =>
  ({ id, regionId, polityId, typeName: 'Zuccherificio', typeId: 'sugar', operational: false });

describe('Fallback map — canonical operational state', () => {
  it('shows the player army deployed abroad, but not foreign units or destroyed formations', () => {
    const rows = staticOperationalEntries(regions, [
      unit('UPDF Ituri', 'UGA', 'ituri'), unit('Rwanda army', 'RWA', 'ituri'),
      unit('destroyed', 'UGA', 'gulu', 'destroyed'),
    ], [], 'UGA');
    expect(rows).toEqual([
      { id: 'UPDF Ituri', name: 'UPDF Ituri', kind: 'unit', regionId: 'ituri',
        regionName: 'Ituri', status: 'operational' },
      { id: 'plant-1', name: 'Zuccherificio', kind: 'infrastructure',
        regionId: 'gulu', regionName: 'Gulu', status: 'registrato sulla mappa' },
      { id: 'port-1', name: 'Porto sul lago', kind: 'infrastructure',
        regionId: 'gulu', regionName: 'Gulu', status: 'registrato sulla mappa' },
    ]);
  });

  it('keeps status and location from canonical facilities, without double counting map objects', () => {
    const rows = staticOperationalEntries(regions, [], [
      facility('plant-1', 'gulu', 'UGA'),
      facility('foreign-plant', 'ituri', 'COD'),
    ], 'UGA');
    expect(rows.find(row => row.id === 'plant-1')).toMatchObject({
      kind: 'facility', regionId: 'gulu', status: 'non operativo',
    });
    expect(rows.filter(row => row.name === 'Zuccherificio')).toHaveLength(1);
    expect(rows.some(row => row.id === 'foreign-plant')).toBe(false);
  });

  it('renders real regional drilldowns and no fake marker if the snapshot is empty', () => {
    const rows = staticOperationalEntries(regions, [unit('UPDF Ituri', 'UGA', 'ituri')], [], 'UGA');
    const html = renderToStaticMarkup(<StaticOperationalIndex entries={rows} onRegionClick={() => {}} onUnitClick={() => {}} />);
    expect(html).toContain('Situazione operativa');
    expect(html).toContain('Ituri · operational');
    expect(html).toContain('Zuccherificio');
    expect(renderToStaticMarkup(<StaticOperationalIndex entries={[]} />)).toBe('');
  });
});
