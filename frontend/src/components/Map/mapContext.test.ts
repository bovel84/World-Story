import { describe, expect, it } from 'vitest';
import type { MilitaryUnitPayload, OperatingPicturePayload, WarFrontPayload } from '../../services/api';
import type { Region } from '../../types';
import {
  buildMapContextIndex,
  mapContextRegionId,
  operatingObjectForUnit,
  playerControlsUnit,
  resolveMapContext,
} from './mapContext';

const region = (id: string, owner = 'ITA'): Region => ({
  id, name: id, owner, color: '#334455', status: 'stable', borders: [], objects: [],
});
const unit = (id: string, polityId: string, regionId: string | null, patch: Partial<MilitaryUnitPayload> = {}): MilitaryUnitPayload => ({
  id, polityId, regionId, armyId: `army-${polityId}`, name: id, personnel: 8_400,
  equipment: {}, monthlyNeeds: { fuel: 1, weapons: 2, food: 3 }, readiness: 0.72,
  status: 'operational', regionName: regionId, updatedDate: '1951-02-01', legacyDerived: false,
  order: 'defend', frontId: null, ...patch,
});
const front = (id: string, patch: Partial<WarFrontPayload> = {}): WarFrontPayload => ({
  id, name: id, attackerPolityId: 'ITA', defenderPolityId: 'AUT', regionIds: ['AUT1'],
  status: 'active', objectiveRegionId: 'AUT1', attackerPressure: 0.6, defenderPressure: 0.4,
  createdDate: '1951-01-01', updatedDate: '1951-02-01', ...patch,
});

const index = buildMapContextIndex({
  regions: [region('ITA1'), region('AUT1', 'HUN')],
  units: [unit('ita-1', 'ITA', 'ITA1'), unit('aut-1', 'AUT', 'AUT1', { frontId: 'F1' })],
  fronts: [front('F1')],
});

describe('MAP P4 — ID-only map context selection', () => {
  it('resolves region, persistent unit and front by canonical ID', () => {
    expect(resolveMapContext({ kind: 'region', regionId: 'AUT1' }, index)).toMatchObject({ kind: 'region', region: { id: 'AUT1' } });
    expect(resolveMapContext({ kind: 'unit', unitId: 'ita-1' }, index)).toMatchObject({ kind: 'unit', unit: { id: 'ita-1' } });
    expect(resolveMapContext({ kind: 'front', frontId: 'F1' }, index)).toMatchObject({ kind: 'front', front: { id: 'F1' } });
  });

  it('returns null for missing, destroyed or closed canonical objects', () => {
    expect(resolveMapContext({ kind: 'unit', unitId: 'missing' }, index)).toBeNull();
    const stale = buildMapContextIndex({
      regions: [region('ITA1')],
      units: [unit('gone', 'ITA', 'ITA1', { status: 'destroyed' })],
      fronts: [front('closed', { status: 'closed' })],
    });
    expect(resolveMapContext({ kind: 'unit', unitId: 'gone' }, stale)).toBeNull();
    expect(resolveMapContext({ kind: 'front', frontId: 'closed' }, stale)).toBeNull();
  });

  it('derives geographic focus without turning territory into authority', () => {
    expect(mapContextRegionId(resolveMapContext({ kind: 'unit', unitId: 'aut-1' }, index))).toBe('AUT1');
    expect(mapContextRegionId(resolveMapContext({ kind: 'front', frontId: 'F1' }, index))).toBe('AUT1');
  });
});

describe('MAP P4 — unit ownership and engine action join', () => {
  it('makes player units actionable and NPC units read-only by unit.polityId', () => {
    expect(playerControlsUnit(index.unitsById.get('ita-1')!, 'ITA')).toBe(true);
    expect(playerControlsUnit(index.unitsById.get('aut-1')!, 'ITA')).toBe(false);
  });

  it('does not transfer unit authority when the territory is conquered', () => {
    const conquered = index.unitsById.get('aut-1')!;
    expect(index.regionsById.get('AUT1')?.owner).toBe('HUN');
    expect(conquered.polityId).toBe('AUT');
    expect(playerControlsUnit(conquered, 'ITA')).toBe(false);
  });

  it('joins only an exact kind=unit operating object; otherwise read-only', () => {
    const picture = {
      objects: [
        { id: 'ita-1', kind: 'unit', label: 'ITA 1', status: 'operational', statusLabel: 'Operativo', facts: [], problems: [], actions: [], parentId: 'army-ITA' },
        { id: 'aut-1', kind: 'army', label: 'Not a unit', status: 'operational', statusLabel: 'Operativo', facts: [], problems: [], actions: [] },
      ], chains: [], counts: {}, conventions: [],
    } as OperatingPicturePayload;
    expect(operatingObjectForUnit(picture, 'ita-1')?.kind).toBe('unit');
    expect(operatingObjectForUnit(picture, 'aut-1')).toBeNull();
    expect(operatingObjectForUnit(null, 'ita-1')).toBeNull();
  });
});
