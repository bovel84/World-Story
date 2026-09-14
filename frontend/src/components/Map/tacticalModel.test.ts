import { describe, expect, it } from 'vitest';
import type { Region } from '../../types';
import type { FeedItem } from '../Game/EventFeed';
import { buildBattleReports, buildUnitRoutes, interpolateCoordinate, isRecentReport } from './tacticalModel';

const region = (id: string, name = id): Region => ({ id, name, owner: id, objects: [],
  geojson: JSON.stringify({ geometry: { type: 'Polygon', coordinates: [[[10, 40], [14, 40], [14, 44], [10, 44], [10, 40]]] } }),
} as Region);
const report = (text: string, patch: Partial<FeedItem> = {}): FeedItem => ({ id: text, text, date: '1951-02-01', kind: 'world', ...patch });

describe('tactical map records', () => {
  it('shows only real recent movement coordinates, without mistaking mobilization for movement', () => {
    const origin = region('home', 'Roma'), target = region('away', 'Milano');
    const unit = { id: 'u', type: 'army', owner: 'home', name: 'I Armata', lng: 12, lat: 44,
      metadata: { previousLng: 11, previousLat: 41, previousRegionId: 'home', movedDate: '1951-02-01' } };
    target.objects = [unit];
    expect(buildUnitRoutes([origin, target], '1951-02-10')).toEqual([{
      id: 'u', name: 'I Armata', owner: 'home', from: [11, 41], to: [12, 44], origin: 'Roma', destination: 'Milano', date: '1951-02-01',
    }]);
    expect(buildUnitRoutes([origin, target], '1951-03-10')).toEqual([]);
    expect(buildUnitRoutes([origin, target], '1951-01-20')).toEqual([]);
    target.objects = [{ ...unit, type: 'mobilization' }];
    expect(buildUnitRoutes([origin, target], '1951-02-10')).toEqual([]);
    target.objects = [{ ...unit, lng: NaN }];
    expect(buildUnitRoutes([origin, target], '1951-02-10')).toEqual([]);
    target.objects = [{ ...unit, metadata: { ...unit.metadata, previousRegionId: 'away' } }];
    expect(buildUnitRoutes([origin, target], '1951-02-10')).toEqual([]);
  });
  it('validates dates and never shows undated or future records', () => {
    expect(isRecentReport('1951-02-01', '1951-03-03')).toBe(true);
    expect(isRecentReport('1951-02-01', '1951-03-04')).toBe(false);
    expect(isRecentReport('1951-02-30', '1951-03-05')).toBe(false);
    expect(isRecentReport(undefined, '1951-03-05')).toBe(false);
    expect(isRecentReport('1951-03-06', '1951-03-05')).toBe(false);
  });
  it('localizes a battle report, not every region changed in the event', () => {
    const regions = [region('a', 'Roma'), region('b', 'Milano')];
    const reports = buildBattleReports(regions, [report('Battaglia di Milano', { regionIds: ['a', 'b'] })], '1951-02-10');
    expect(reports).toHaveLength(1);
    expect(reports[0]).toMatchObject({ regionId: 'b', point: [12, 42] });
  });
  it.each(['Le truppe si schierano a Milano', 'Evitata la battaglia di Milano', 'Piani per la battaglia di Milano',
    'Nessuno scontro a Milano', 'Tregua dopo la battaglia di Milano', 'Anniversario della battaglia di Milano',
    'Battaglia simulata a Milano', 'Rischio di scontri a Milano',
    'Un battaglione arriva a Milano', 'Due battaglioni a Milano', 'Il battaglione si rischiera'])('does not invent combat: %s', text => {
    expect(buildBattleReports([region('a', 'Milano')], [report(text)], '1951-02-01')).toEqual([]);
  });
  it('ignores ambiguous places and retains just the latest report per territory', () => {
    const regions = [region('a', 'Roma'), region('b', 'Roma Nord')];
    expect(buildBattleReports(regions, [report('Battaglia di Roma Nord')], '1951-02-01')[0].regionId).toBe('b');
    expect(buildBattleReports([region('a', 'Roma'), region('b', 'Roma')], [report('Battaglia di Roma')], '1951-02-01')).toEqual([]);
    expect(buildBattleReports(regions, [report('Scontri al confine', { regionIds: ['a', 'b'] })], '1951-02-01')).toEqual([]);
    expect(buildBattleReports(regions, [report('Battaglia di Roma', { id: 'old', date: '1951-01-20' }), report('Battaglia di Roma', { id: 'new' })], '1951-02-01').map(r => r.id)).toEqual(['new']);
  });
  it('moves over the short arc at the date line without crossing the entire map', () => {
    expect(interpolateCoordinate([179, 20], [-179, 22], 0.5)).toEqual([180, 21]);
    expect(interpolateCoordinate([12, 41], [16, 45], 0.5)).toEqual([14, 43]);
    // Unwrapped world copies after eastward panning must wrap forward, not loop backward.
    expect(interpolateCoordinate([539, 20], [-179, 22], 0.5)).toEqual([540, 21]);
    expect(interpolateCoordinate([-541, 20], [181, 22], 0.5)).toEqual([-540, 21]);
  });
});
