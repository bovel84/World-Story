import { afterEach, describe, expect, it, vi } from 'vitest';
import { addDays, dateInPeriod, formatItalianDate, jumpHorizon, resolvePeriod } from '../src/core/simulation/calendar';
import { withinDeadline } from '../src/core/simulation/deadline';
import { canNpcCapture, indexPolities, npcRepresentatives } from '../src/core/simulation/npc-policy';
import { WorldStateEngine } from '../src/core/simulation/WorldStateEngine';
import { NPCCountryAgent } from '../src/npc-agents';
import type { RegionState } from '../src/game-session';

const region = (id: string, owner = 'AAA', borders: string[] = []): RegionState => ({
  id, owner, name: id, borders, population: 1000, gdp: 0.003, militaryPower: 0.01,
  color: '#123456', objects: [], status: 'active',
});

describe('UTC simulation calendar', () => {
  it.each([
    ['2024-03-25', 7, '2024-04-01'], // European DST start
    ['2024-10-21', 7, '2024-10-28'], // European DST end
    ['2024-02-28', 1, '2024-02-29'],
    ['2023-02-28', 1, '2023-03-01'],
  ])('%s plus %i days is %s', (start, days, end) => expect(addDays(start, days)).toBe(end));

  it.each([NaN, Infinity, 1.5, 36501])('rejects invalid horizon %s', days => {
    expect(() => jumpHorizon(days)).toThrow();
  });

  it('rejects rolled-over and out-of-period event dates', () => {
    for (const date of ['2024-02-30', '2023-12-31', '2025-01-01', '2024-01-20T12:00:00Z']) {
      expect(dateInPeriod(date, '2024-01-01', '2024-12-31')).toBe(false);
    }
  });

  it('formats grammatical Italian dates without host-timezone drift', () =>
    expect(formatItalianDate('1951-03-25')).toBe('25 marzo 1951'));

  const base = { start: '2024-01-01', days: 365, auto: true, interrupted: false };
  it('auto-jump advances only elapsed days, not the whole search horizon', () => {
    expect(resolvePeriod({ ...base, target: '2024-01-20', eventDates: ['2024-01-20'] }))
      .toEqual({ end: '2024-01-20', elapsedDays: 19 });
  });
  it('uses the first event when targetDate is missing, later or invalid', () => {
    for (const target of [undefined, '2024-01-02', '2024-02-30', '2099-01-01']) {
      expect(resolvePeriod({ ...base, target, eventDates: ['2024-01-20'] }).end).toBe('2024-01-20');
    }
    // A late targetDate or extra records must not make auto-jump pass the
    // first important event.
    expect(resolvePeriod({
      ...base,
      target: '2024-02-15',
      eventDates: ['2024-01-12', '2024-01-20'],
    })).toEqual({ end: '2024-01-12', elapsedDays: 11 });
  });
  it('does not advance an interrupted turn with no applied events', () => {
    expect(resolvePeriod({ ...base, interrupted: true, target: '2024-12-31', eventDates: [] }))
      .toEqual({ end: '2024-01-01', elapsedDays: 0 });
  });
});

describe('province economy precision', () => {
  it('keeps small non-zero GDP and military indices alive', () => {
    const r = region('tiny');
    WorldStateEngine.advance([r], 7);
    expect(r.gdp).toBeGreaterThan(0.003);
    expect(r.militaryPower).toBeGreaterThan(0.009);
  });
  it('is independent of time step size when rates and assets stay unchanged', () => {
    const single = region('a'), weekly = region('a');
    WorldStateEngine.advance([single], 365);
    for (let n = 0; n < 52; n++) WorldStateEngine.advance([weekly], 7);
    WorldStateEngine.advance([weekly], 1);
    for (const key of ['gdp', 'population', 'militaryPower'] as const) {
      expect(weekly[key]).toBeCloseTo(single[key], 8);
    }
  });
  it('accounts for the full multi-year duration', () => {
    const r = region('a');
    WorldStateEngine.advance([r], 730);
    expect(r.gdp).toBeCloseTo(0.003 * 1.012 ** 2, 10);
  });
  it('zero elapsed days cause no rounding or mutation', () => {
    const r = region('a'), before = structuredClone(r);
    expect(WorldStateEngine.advance([r], 0).changedRegions).toEqual([]);
    expect(r).toEqual(before);
  });
  it('counts battalions and accepts arbitrary polity IDs safely', () => {
    const r = region('a', '__proto__');
    r.objects = [{ type: 'battalion', level: 2 }];
    expect(WorldStateEngine.accounts([r])['__proto__'].forces).toBe(2);
  });
});

describe('national NPC policy', () => {
  const regions = new Map([
    ['p', region('p', 'PLAYER')], ['a', region('a', 'AAA', ['b', 'x'])],
    ['b', region('b', 'AAA')], ['x', region('x', 'BBB')],
    ['z', region('z', 'neutral')], ['far', region('far', 'CCC')],
  ]);
  it('budgets one call per current country, excluding player and neutral provinces', () => {
    expect(npcRepresentatives([...regions.keys()], regions, 'PLAYER')).toEqual(['a', 'x', 'far']);
  });
  it('uses actual international borders, including one-sided legacy adjacency', () => {
    const index = indexPolities(regions);
    expect(index.owned.get('AAA')).toHaveLength(2);
    expect([...index.frontier.get('AAA')!]).toEqual(['x']);
    expect([...index.frontier.get('BBB')!]).toEqual(['a']);
    expect(index.frontier.has('CCC')).toBe(false);
  });
  it('rejects self-conquest, non-adjacent targets and non-hostile countries', () => {
    expect(canNpcCapture('AAA', regions.get('b'), new Set(['b']), 'hostile')).toBe(false);
    expect(canNpcCapture('AAA', regions.get('far'), new Set(['x']), 'hostile')).toBe(false);
    for (const relation of ['neutral', 'ally']) {
      expect(canNpcCapture('AAA', regions.get('x'), new Set(['x']), relation)).toBe(false);
    }
    expect(canNpcCapture('AAA', regions.get('x'), new Set(['x']), 'hostile')).toBe(true);
  });
  it('does not invent a fallback war on a provider failure', async () => {
    const agent = new NPCCountryAgent({ generate: async () => ({ content: 'not JSON' }) } as any,
      { regionId: 'a', regionName: 'Province A', personality: 'aggressive', aggression: 1, resources: 1 });
    const action = await agent.think({ turn: 1, population: 100, gdp: 2, militaryPower: 20,
      neighbors: [{ id: 'b', name: 'B', owner: 'AAA', militaryPower: 1, gdp: 1 }], recentEvents: [] });
    expect(action.type).toBe('neutral');
  });
});

describe('NPC deadlines', () => {
  afterEach(() => vi.useRealTimers());
  it('clears timers after a fast success or rejection', async () => {
    vi.useFakeTimers();
    expect(await withinDeadline(Promise.resolve('ok'), 12000)).toBe('ok');
    expect(vi.getTimerCount()).toBe(0);
    await expect(withinDeadline(Promise.reject(new Error('offline')), 12000)).rejects.toThrow('offline');
    expect(vi.getTimerCount()).toBe(0);
  });
  it('returns null at deadline and does not apply a late result', async () => {
    vi.useFakeTimers();
    let resolve!: (value: string) => void;
    const promise = withinDeadline(new Promise<string>(r => { resolve = r; }), 12000);
    await vi.advanceTimersByTimeAsync(12000);
    expect(await promise).toBeNull();
    resolve('late');
    expect(await promise).toBeNull();
    expect(vi.getTimerCount()).toBe(0);
  });
});
