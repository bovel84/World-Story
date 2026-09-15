import { describe, expect, it } from 'vitest';
import { describePressure, generatePressures, type PressureSnapshot } from '../src/core/simulation/PeacetimePressures';

const base: PressureSnapshot = {
  polityId: 'ITA',
  name: 'Italia',
  turn: 3,
  date: '1951-04-01',
  seed: 'game-abc',
  atWar: false,
  stability: 55,
  socialTension: 25,
  annualGrowthRate: 0.02,
  deficitRatioPct: 0,
  debtRatioPct: 20,
  taxRatePct: 12,
  militaryPower: 120,
  provinces: 4,
  mobilized: 0,
  foodCoverageMonths: 5,
  neighbours: [{ polityId: 'FRA', name: 'Francia', militaryPower: 150, stance: 'neutral' }],
};

describe('PeacetimePressures', () => {
  it('garantisce sempre una sfida interna e una esterna, anche in pace', () => {
    const pressures = generatePressures(base);
    expect(pressures.length).toBeGreaterThanOrEqual(2);
    expect(pressures.length).toBeLessThanOrEqual(3);
    expect(pressures.some(pressure => pressure.kind === 'internal')).toBe(true);
    expect(pressures.some(pressure => pressure.kind === 'external')).toBe(true);
    for (const pressure of pressures) {
      expect(pressure.title.length).toBeGreaterThan(0);
      expect(pressure.detail.length).toBeGreaterThan(0);
      expect(pressure.options.length).toBeGreaterThanOrEqual(2);
      expect(pressure.severity).toBeGreaterThanOrEqual(1);
      expect(pressure.severity).toBeLessThanOrEqual(3);
      for (const option of pressure.options) {
        expect(option.label.length).toBeGreaterThan(0);
        expect(option.effect.note.length).toBeGreaterThan(0);
      }
      expect(pressure.inaction.note.length).toBeGreaterThan(0);
    }
  });

  it('è deterministica: stesso seme e stesso turno, stesse sfide', () => {
    const first = generatePressures(base).map(pressure => pressure.id);
    const second = generatePressures({ ...base }).map(pressure => pressure.id);
    expect(second).toEqual(first);
  });

  it('cambia sfide al cambio di turno e non riusa gli id', () => {
    const first = generatePressures({ ...base, turn: 1 }).map(pressure => pressure.id);
    const second = generatePressures({ ...base, turn: 2 }).map(pressure => pressure.id);
    expect(second.some(id => first.includes(id))).toBe(false);
  });

  it('una nazione in crisi riceve sfide gravi e pertinenti', () => {
    const crisis = generatePressures({
      ...base,
      stability: 22,
      socialTension: 88,
      annualGrowthRate: -0.03,
      deficitRatioPct: 11,
      debtRatioPct: 140,
      taxRatePct: 34,
      mobilized: 6,
      foodCoverageMonths: 0.5,
    });
    const templates = crisis.map(pressure => pressure.template);
    // Le tre più urgenti tra scioperi, carestia, separatismo, inflazione,
    // veterani e crisi esterne.
    const expected = ['strike-wave', 'harvest-failure', 'separatist-movement', 'inflation-spiral', 'veterans-unrest', 'corruption-scandal'];
    expect(templates.some(template => expected.includes(template))).toBe(true);
    expect(crisis.every(pressure => pressure.severity >= 2)).toBe(true);
  });

  it('senza dati sul cibo non inventa una carestia', () => {
    const pressures = generatePressures({ ...base, foodCoverageMonths: null });
    expect(pressures.some(pressure => pressure.template === 'harvest-failure')).toBe(false);
  });

  it('un vicino più armato genera una sfida esterna di riarmo', () => {
    const pressures = generatePressures({
      ...base,
      militaryPower: 40,
      neighbours: [{ polityId: 'FRA', name: 'Francia', militaryPower: 200, stance: 'hostile' }],
    });
    const external = pressures.filter(pressure => pressure.kind === 'external');
    expect(external.length).toBeGreaterThanOrEqual(1);
    expect(external.some(pressure => pressure.template === 'neighbour-buildup' || pressure.template === 'border-incident')).toBe(true);
  });

  it('le opzioni con effetti dichiarano costi o relazioni coerenti', () => {
    const pressures = generatePressures({
      ...base,
      stability: 22,
      socialTension: 88,
      militaryPower: 40,
      neighbours: [{ polityId: 'FRA', name: 'Francia', militaryPower: 200, stance: 'hostile' }],
    });
    const withRelationship = pressures.flatMap(pressure => pressure.options).filter(option => option.effect.relationship);
    for (const option of withRelationship) {
      expect(option.effect.relationship!.target).toBe('FRA');
      expect(['improve', 'degrade']).toContain(option.effect.relationship!.direction);
    }
  });

  it('describePressure riassume la sfida per prompt e bollettino', () => {
    const pressure = generatePressures(base)[0];
    const text = describePressure(pressure);
    expect(text).toContain(pressure.title);
    expect(text).toMatch(/interna|esterna/);
  });
});
