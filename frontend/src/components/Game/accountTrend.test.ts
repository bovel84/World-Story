import { describe, it, expect } from 'vitest';
import { sparkPoints, trendFrom, deltaTone, trendLabel } from './accountTrend';

describe('sparkPoints', () => {
  it('restituisce vuoto con meno di due valori finiti', () => {
    expect(sparkPoints([])).toEqual([]);
    expect(sparkPoints([3])).toEqual([]);
    expect(sparkPoints([NaN, Infinity])).toEqual([]);
  });

  it('normalizza il minimo in basso e il massimo in alto', () => {
    const points = sparkPoints([0, 10, 5], 56, 18, 2);
    expect(points).toHaveLength(3);
    expect(points[0]).toEqual({ x: 2, y: 16 });
    expect(points[1]).toEqual({ x: 28, y: 2 });
    expect(points[2]).toEqual({ x: 54, y: 9 });
  });

  it('non produce NaN su serie piatta', () => {
    const points = sparkPoints([4, 4, 4]);
    expect(points.every((point) => Number.isFinite(point.y))).toBe(true);
  });
});

describe('trendFrom', () => {
  const history = [
    { date: '1951-01-01', account: { monthlyBalance: -2 } },
    { date: '1951-02-01', account: { monthlyBalance: -1 } },
    { date: '1951-03-01', account: {} },
    { date: '1951-04-01', account: { monthlyBalance: 1 } },
  ];

  it('salta i punti mancanti e calcola la variazione sugli ultimi due letti', () => {
    const trend = trendFrom(history, (point) => point.account.monthlyBalance);
    expect(trend).not.toBeNull();
    expect(trend!.series).toEqual([-2, -1, 1]);
    expect(trend!.dates).toEqual(['1951-01-01', '1951-02-01', '1951-04-01']);
    expect(trend!.delta).toBe(2);
  });

  it('restituisce null con meno di due punti validi', () => {
    expect(trendFrom([{ date: '1951-01-01', account: {} }], (p) => p.account.monthlyBalance)).toBeNull();
  });
});

describe('deltaTone', () => {
  it('dipende dalla direzione favorevole', () => {
    expect(deltaTone(2, 'up')).toBe('positive');
    expect(deltaTone(2, 'down')).toBe('negative');
    expect(deltaTone(-2, 'down')).toBe('positive');
    expect(deltaTone(0, 'up')).toBe('neutral');
    expect(deltaTone(NaN, 'up')).toBe('neutral');
  });
});

describe('trendLabel', () => {
  it('usa «mese scorso» per variazioni entro 45 giorni', () => {
    expect(trendLabel(['1951-01-01', '1951-02-01'])).toBe('vs mese scorso');
  });
  it('usa un\'etichetta generica per salti lunghi o incompleti', () => {
    expect(trendLabel(['1951-01-01', '1951-06-01'])).toBe('vs rilevazione precedente');
    expect(trendLabel(['1951-01-01'])).toBe('vs rilevazione precedente');
  });
});
