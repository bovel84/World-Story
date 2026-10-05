import { describe, expect, it } from 'vitest';
import { emptyUnit, unitEstablishmentPersonnel, unitReadiness, unitRifleRequirement } from '../src/core/simulation/OperationalState';
import { resolveFront, unitStrength } from '../src/core/simulation/WarFronts';

const supply = { food: 1, fuel: 1, weapons: 1 };
const brigade = {
  ...emptyUnit({ id: 'small', armyId: 'army', polityId: 'AAA', epoch: 'moderno', date: '2026-01-01' }),
  personnel: 3_000, establishmentPersonnel: 3_000, equipment: { fucili: 2_250 },
  status: 'operational' as const, readiness: 1,
};

describe('persistent formation establishment', () => {
  it('retains epoch fallback for units from legacy saves', () => {
    const { establishmentPersonnel: _, ...legacy } = brigade;
    expect(unitEstablishmentPersonnel(legacy, 'moderno')).toBe(12_000);
    expect(unitRifleRequirement(legacy, 'moderno')).toBe(9_000);
    expect(unitReadiness({ unit: legacy, epoch: 'moderno' })).toBe(0.25);
  });

  it('combat strength staffing uses the brigade establishment rather than 12,000', () => {
    expect(unitStrength({ unit: brigade, epoch: 'moderno', supply, motorized: false }).personnelFactor).toBe(1);
    expect(unitStrength({ unit: { ...brigade, personnel: 2_400 }, epoch: 'moderno', supply, motorized: false }).personnelFactor).toBe(0.8);
  });

  it('combat recomputes brigade readiness and depletion against fixed authorized staffing', () => {
    const result = resolveFront({
      front: { id: 'front', name: 'Front', attackerPolityId: 'AAA', defenderPolityId: 'BBB', regionIds: [], status: 'active', objectiveRegionId: null, attackerPressure: 1, defenderPressure: 1, createdDate: '2026-01-01', updatedDate: '2026-01-01' },
      epoch: 'moderno', date: '2026-01-02', stepDays: 0, theatre: [],
      attacker: { units: [brigade], legacyPower: 0, supply, motorized: false },
      defender: { units: [{ ...brigade, id: 'defender', polityId: 'BBB' }], legacyPower: 0, supply, motorized: false },
    });
    expect(result.outcomes[0].personnelAfter).toBe(3_000);
    expect(result.outcomes[0].statusAfter).toBe('operational');
    expect(result.outcomes[0].readinessAfter).toBe(1);
    expect(brigade.establishmentPersonnel).toBe(3_000);
  });
});
