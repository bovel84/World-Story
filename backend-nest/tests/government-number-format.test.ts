import { describe, expect, it } from 'vitest';
import { formatGovernmentNumber, governmentFigureValue, type GovernmentNumberKind } from '../src/core/government/GovernmentNumberFormat';

describe('GovernmentNumberFormat', () => {
  it.each<[number | string | bigint, GovernmentNumberKind, string, string]>([
    [7.60987654321, 'money', '7,61', '7.61'],
    [-7.60987654321, 'money', '-7,61', '-7.61'],
    [1234.56789, 'money', '1234,57', '1234.57'],
    [7.6, 'money', '7,6', '7.6'],
    [0, 'money', '0', '0'],
    [-0.001, 'money', '-0', '-0'],
    [1.005, 'money', '1,01', '1.01'],
    [110.123456789, 'percent', '110,1', '110.1'],
    [35, 'percent', '35', '35'],
    [34.987654321, 'ratio', '35', '35'],
    [41.23456789, 'ratio', '41,2', '41.2'],
    [0, 'ratio', '0', '0'],
    [100, 'ratio', '100', '100'],
    [200.123456789, 'integer', '200', '200'],
    [1200.987654321, 'integer', '1201', '1201'],
    ['900719925474099312345', 'integer', '900719925474099312345', '900719925474099312345'],
    [900719925474099312345n, 'integer', '900719925474099312345', '900719925474099312345'],
  ])('formats %s as %s for prose and display DTOs', (value, kind, prose, figure) => {
    expect(formatGovernmentNumber(value, kind)).toBe(prose);
    expect(governmentFigureValue(value, kind)).toBe(figure);
  });
});
