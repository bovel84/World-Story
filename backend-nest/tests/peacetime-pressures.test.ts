import { describe, expect, it } from 'vitest';
import {
  PRESSURE_DURATION_DAYS, PRESSURE_ESCALATION_AT, PRESSURE_MAX_HIGHLIGHTED,
  describePressure, generatePressures, highlightPressures, pressureDeadline, pressureDurationDays,
  pressurePriority, pressureWindow, scalePressureEffect,
  type PressureSnapshot,
} from '../src/core/simulation/PeacetimePressures';

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

describe('GAMEPLAY-LONG — finestra temporale delle sfide (tempo di calendario)', () => {
  it('ogni sfida nasce con una finestra di giorni coerente con la gravità', () => {
    const pressures = generatePressures({ ...base, stability: 22, socialTension: 88, militaryPower: 40,
      neighbours: [{ polityId: 'FRA', name: 'Francia', militaryPower: 200, stance: 'hostile' }] });
    for (const pressure of pressures) {
      expect(pressure.durationDays).toBe(pressureDurationDays(pressure.severity));
      expect(pressure.durationDays).toBeGreaterThanOrEqual(PRESSURE_DURATION_DAYS[3]);
      expect(pressure.durationDays).toBeLessThanOrEqual(PRESSURE_DURATION_DAYS[1]);
    }
    // Più grave = meno tempo per rispondere.
    expect(PRESSURE_DURATION_DAYS[3]).toBeLessThan(PRESSURE_DURATION_DAYS[1]);
  });

  it('la scadenza è una data di calendario, non un turno', () => {
    expect(pressureDeadline('1951-01-01', 60)).toBe('1951-03-02');
    expect(pressureDeadline('1951-01-01', 120)).toBe('1951-05-01');
  });

  it('P0 pressione con deadline 60 giorni: a 30 giorni resta aperta, oltre scade', () => {
    const pressure = { createdDate: '1951-01-01', durationDays: 60, severity: 1, escalated: false };
    const open = pressureWindow(pressure, '1951-01-31', 30);
    expect(open.expired).toBe(false);
    expect(open.daysElapsed).toBe(30);
    expect(open.daysLeft).toBe(30);
    expect(open.urgency).toBe('prossima');
    // Oltre la scadenza l'inerzia presenta il conto.
    const overdue = pressureWindow(pressure, '1951-03-05', 63);
    expect(overdue.expired).toBe(true);
    expect(overdue.daysLeft).toBe(0);
    expect(overdue.urgency).toBe('scaduta');
  });

  it('7 giorni e 12 mesi non producono lo stesso stato: una grave peggiora prima di scadere', () => {
    const grave = { createdDate: '1951-01-01', durationDays: 60, severity: 3, escalated: false };
    // Dopo una settimana è presto: nessun peggioramento.
    expect(pressureWindow(grave, '1951-01-08', 7).escalationDue).toBe(false);
    // Dopo 40 giorni (oltre il 60% della finestra) la sfida si inasprisce.
    expect(pressureWindow(grave, '1951-02-10', Math.round(60 * PRESSURE_ESCALATION_AT)).escalationDue).toBe(true);
    // Una sfida lieve non peggiora da sola.
    expect(pressureWindow({ ...grave, severity: 1 }, '1951-02-10', 45).escalationDue).toBe(false);
    // Già peggiorata una volta: non si ripete.
    expect(pressureWindow({ ...grave, escalated: true }, '1951-02-20', 50).escalationDue).toBe(false);
    // Un salto lunghissimo oltre la scadenza è inazione piena, non escalation.
    const year = pressureWindow(grave, '1952-01-01', 365);
    expect(year.expired).toBe(true);
    expect(year.escalationDue).toBe(false);
  });

  it('l’escalation è metà dell’effetto di inazione, mai un effetto nuovo', () => {
    const inaction = { socialTension: 12, stability: -6, moneyDeltaMld: -0.8, growthModifier: -0.003, note: 'Carestia ignorata.' };
    const scaled = scalePressureEffect(inaction);
    expect(scaled.note).toBe(inaction.note);
    expect(scaled.socialTension).toBe(6);
    expect(scaled.stability).toBe(-3);
    expect(scaled.moneyDeltaMld).toBe(-0.4);
    expect(scaled.growthModifier).toBe(-0.0015);
    // La scala dell'escalation è più leggera dell'inerzia piena.
    expect(Math.abs(scaled.socialTension!)).toBeLessThan(Math.abs(inaction.socialTension));
  });

  it('P2: al massimo due questioni in evidenza, le altre restano nel dossier', () => {
    const pressures = [
      { id: 'a', severity: 1 },
      { id: 'b', severity: 3 },
      { id: 'c', severity: 2 },
    ];
    const windows = {
      a: { expired: false, urgency: 'aperta' as const, daysElapsed: 1, daysLeft: 119 },
      b: { expired: false, urgency: 'prossima' as const, daysElapsed: 45, daysLeft: 15 },
      c: { expired: false, urgency: 'prossima' as const, daysElapsed: 40, daysLeft: 50 },
    };
    const highlighted = highlightPressures(pressures, windows);
    expect(highlighted.size).toBe(PRESSURE_MAX_HIGHLIGHTED);
    // La critica c'è sempre; la seconda è la più grave fra le rimanenti.
    expect(highlighted.has('b')).toBe(true);
    expect(highlighted.has('c')).toBe(true);
    expect(highlighted.has('a')).toBe(false);
    // Le priorità raccontano il perché.
    expect(pressurePriority({ severity: 3 }, windows.b)).toBe('critica');
    expect(pressurePriority({ severity: 2 }, windows.c)).toBe('rilevante');
    expect(pressurePriority({ severity: 1 }, windows.a)).toBe('ordinaria');
    // Una sfida scaduta è critica a prescindere dalla gravità.
    expect(pressurePriority({ severity: 1 }, { ...windows.a, expired: true })).toBe('critica');
  });

  it('describePressure dice da quanto è aperta e quanto tempo resta', () => {
    const pressure = generatePressures(base)[0];
    const window = pressureWindow(pressure, '1951-04-11', 10);
    const text = describePressure(pressure, window);
    expect(text).toContain('aperta da 10 giorni');
    expect(text).toContain('restano');
    const expired = describePressure(pressure, pressureWindow(pressure, '1951-12-01', 244));
    expect(expired).toContain('scaduta');
  });
});
