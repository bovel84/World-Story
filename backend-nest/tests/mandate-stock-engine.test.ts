import { describe, expect, it } from 'vitest';
import { createMandate, type MandateDefinition } from '../src/core/mandates/MandateEngine';
import { assessMandateMinimumStock } from '../src/core/mandates/MandateStockEngine';

const base: MandateDefinition = {
  id: 'stock-guard', title: 'Riserva utensili', currencyId: 'test', ceiling: '1000',
  startDate: '1951-01-01', endDate: '1951-02-01', whitelist: ['purchase'], suppliers: ['vendor'],
  resourceId: 'tools', minStock: '30', noNewDebt: true,
};

describe('M07 µ4 — motore puro scorte minime', () => {
  it('deficit con purchase in whitelist → decisione, mai acquisto automatico', () => {
    const state = createMandate(base);
    expect(assessMandateMinimumStock(base, state, '1951-01-10', '20')).toEqual({
      status: 'decision_required', kind: 'stock_shortfall_authorized', mandateId: 'stock-guard',
      resourceId: 'tools', minStock: '30', availableStock: '20', shortfall: '10',
    });
    expect(state).toEqual({ id: 'stock-guard', status: 'active', spent: '0', executions: [] });
  });

  it('deficit fuori whitelist → decisione esplicita, non estensione autonoma', () => {
    const definition = { ...base, id: 'no-purchase', whitelist: ['maintain'] };
    expect(assessMandateMinimumStock(definition, createMandate(definition), '1951-01-10', '0')).toMatchObject({
      status: 'decision_required', kind: 'stock_shortfall_outside_authorization', shortfall: '30',
    });
  });

  it('rispetta periodo/sufficienza e rifiuta una guardia configurata a metà', () => {
    const state = createMandate(base);
    expect(assessMandateMinimumStock(base, state, '1950-12-31', '0')).toEqual({ status: 'not_started' });
    expect(assessMandateMinimumStock(base, state, '1951-01-10', '30')).toEqual({ status: 'sufficient' });
    expect(assessMandateMinimumStock(base, state, '1951-02-02', '0')).toEqual({ status: 'expired' });
    const incomplete = { ...base, id: 'incomplete', minStock: undefined };
    expect(() => createMandate(incomplete)).toThrow(/resourceId e minStock/);
  });
});