import { describe, expect, it } from 'vitest';
import { assessMaintenanceObligations } from '../src/core/maintenance/MaintenanceObligations';

const facility = (overrides: Record<string, unknown>) => ({
  id: 'f1', typeId: 'steel_mill', ownerActorId: 'treasury', controllerActorId: 'treasury',
  regionId: 'r1', operational: true, ...overrides,
}) as any;
const type = (overrides: Record<string, unknown>) => ({
  id: 'steel_mill', name: 'Acciaieria', capacity: { unit: 't', perDay: '10' },
  maintenance: { resourceId: 'steel', baseUnits: '100', periodDays: 90 }, ...overrides,
}) as any;

describe('M07 passo 2 — assessMaintenanceObligations (proiezione pura)', () => {
  it('proietta l’obbligo dal catalogo e segnala stock sufficiente', () => {
    const out = assessMaintenanceObligations({
      facilities: [facility({})],
      facilityTypes: [type({})],
      ownerActorIds: new Set(['treasury']),
      ownedStock: [{ owner: 'treasury', resourceId: 'steel', quantity: '150' }],
    });
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({ facilityId: 'f1', resourceId: 'steel', baseUnits: '100', periodDays: 90, sufficient: true, shortfall: '0' });
    expect(out[0].available).toBe('150');
  });

  it('calcola il deficit quando lo stock posseduto non basta', () => {
    const out = assessMaintenanceObligations({
      facilities: [facility({})],
      facilityTypes: [type({})],
      ownerActorIds: new Set(['treasury']),
      ownedStock: [{ owner: 'treasury', resourceId: 'steel', quantity: '40' }],
    });
    expect(out[0].sufficient).toBe(false);
    expect(out[0].shortfall).toBe('60');
  });

  it('ignora gli impianti non posseduti dalla polity', () => {
    const out = assessMaintenanceObligations({
      facilities: [facility({ ownerActorId: 'foreign' })],
      facilityTypes: [type({})],
      ownerActorIds: new Set(['treasury']),
      ownedStock: [{ owner: 'treasury', resourceId: 'steel', quantity: '1000' }],
    });
    expect(out).toEqual([]);
  });

  it('ignora i tipi senza termine di manutenzione e i termini non positivi', () => {
    const out = assessMaintenanceObligations({
      facilities: [facility({ typeId: 'no_maint' }), facility({ id: 'f2', typeId: 'zero' })],
      facilityTypes: [type({ id: 'no_maint', maintenance: undefined }), type({ id: 'zero', maintenance: { resourceId: 'steel', baseUnits: '0', periodDays: 10 } })],
      ownerActorIds: new Set(['treasury']),
      ownedStock: [],
    });
    expect(out).toEqual([]);
  });

  it('ordina per deficit decrescente, poi per id (priorità leggibile)', () => {
    const out = assessMaintenanceObligations({
      facilities: [facility({ id: 'a', typeId: 't' }), facility({ id: 'b', typeId: 't' }), facility({ id: 'c', typeId: 't' })],
      facilityTypes: [type({ id: 't', maintenance: { resourceId: 'steel', baseUnits: '100', periodDays: 90 } })],
      ownerActorIds: new Set(['treasury']),
      ownedStock: [{ owner: 'treasury', resourceId: 'steel', quantity: '0' }],
    });
    // tutti con lo stesso deficit: ordine per id
    expect(out.map(o => o.facilityId)).toEqual(['a', 'b', 'c']);
  });

  it('non attribuisce stock di attori estranei o di altre risorse', () => {
    const out = assessMaintenanceObligations({
      facilities: [facility({})],
      facilityTypes: [type({})],
      ownerActorIds: new Set(['treasury']),
      ownedStock: [
        { owner: 'foreign', resourceId: 'steel', quantity: '1000' },
        { owner: 'treasury', resourceId: 'coal', quantity: '1000' },
        { owner: 'treasury', resourceId: 'steel', quantity: '25' },
      ],
    });
    expect(out[0].available).toBe('25');
    expect(out[0].shortfall).toBe('75');
  });
});
