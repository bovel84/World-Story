import { describe, expect, it } from 'vitest';
import {
  buildGovernmentSituation,
  buildGovernmentFollowUp,
  leadMinisterFor,
  originFor,
  situationFacts,
  suggestedMinistersFor,
  type SituationFactSource,
  type SituationPressureInput,
} from '../src/core/government/GovernmentSituations';
import type { PressureOption } from '../src/core/simulation/PeacetimePressures';

const pressure: SituationPressureInput = {
  id: 'external:border-incident#t3',
  kind: 'external',
  template: 'border-incident',
  title: 'Incidente di frontiera con Serbia',
  detail: 'Un posto di guardia è stato attaccato: due morti e accuse incrociate con Serbia.',
  severity: 3,
  source: 'Comando di frontiera e stampa',
  createdDate: '1951-03-01',
  options: [
    { id: 'retaliate', label: 'Rispondere con la forza', detail: 'Colpo di mano.', effect: { stability: 4, note: 'Rappresaglia: escalation possibile.' } },
    { id: 'de-escalate', label: 'De-escalation', detail: 'Commissione congiunta.', effect: { relationship: { target: 'ser', direction: 'improve' }, note: 'De-escalation: accuse di debolezza.' } },
  ] as PressureOption[],
  inaction: { socialTension: 7, stability: -4, note: 'Incidente senza risposta: la stampa parla di governo assente.' },
};

const facts: SituationFactSource = {
  socialTension: 41.23456789,
  stability: 62.987654321,
  deficitRatioPct: 4.123456789,
  debtRatioPct: 110.123456789,
  taxRatePct: 24.123456789,
  militaryPower: 1200.987654321,
  mobilized: 34.987654321,
  foodCoverageMonths: 1.23456789,
};

const longDecimals = /[.,]\d{3,}/;

describe('GovernmentSituations — read model della Pressure canonica', () => {
  it.each([
    ['border-incident', 'external', 'guerra'],
    ['neighbour-buildup', 'external', 'guerra'],
    ['alliance-offer', 'external', 'esteri'],
    ['trade-dispute', 'external', 'esteri'],
    ['sanctions-threat', 'external', 'esteri'],
    ['refugee-flow', 'external', 'interno'],
    ['inflation-spiral', 'internal', 'tesoro'],
    ['veterans-unrest', 'internal', 'interno'],
    ['material-shortage', 'internal', 'lavori'],
  ] as const)('assegna %s alla sedia competente', (template, kind, seat) => {
    expect(leadMinisterFor({ template, kind })).toBe(seat);
  });

  it('ricade sulla natura della questione per i template senza competenza esplicita', () => {
    expect(leadMinisterFor({ template: 'sconosciuto', kind: 'external' })).toBe('esteri');
    expect(leadMinisterFor({ template: 'sconosciuto', kind: 'internal' })).toBe('interno');
  });

  it('suggerisce colleghi diversi dal relatore, senza doppioni', () => {
    const suggested = suggestedMinistersFor(pressure);
    expect(suggested).not.toContain('guerra');
    expect(new Set(suggested).size).toBe(suggested.length);
    expect(suggested).toEqual(expect.arrayContaining(['tesoro', 'esteri']));
  });

  it('costruisce fatti solo da misure reali, senza decimali lunghi e senza inventare', () => {
    const external = situationFacts(pressure, facts);
    expect(external.join('\n')).not.toMatch(longDecimals);
    expect(external.join('\n')).toContain('Potenziale militare 1201');
    expect(external.join('\n')).toContain('Forze mobilitate 35');
    // Una copertura alimentare ignota non diventa zero: non compare.
    expect(situationFacts(pressure, { ...facts, foodCoverageMonths: null }).join('\n')).not.toContain('Copertura alimentare');
  });

  it('deduce la provenienza: stato, decisione precedente, inerzia', () => {
    expect(originFor(pressure, [])).toEqual({ type: 'state' });
    expect(originFor(pressure, [{ id: 'x', template: 'border-incident', status: 'resolved', createdTurn: 1 }]))
      .toEqual({ type: 'previous-decision', sourceId: 'x' });
    expect(originFor(pressure, [{ id: 'y', template: 'border-incident', status: 'expired', createdTurn: 2 }]))
      .toEqual({ type: 'inaction', sourceId: 'y' });
  });

  it('conserva opzioni e inerzia del motore e non muta la Pressure', () => {
    const before = structuredClone(pressure);
    const situation = buildGovernmentSituation({ pressure, window: { daysLeft: 4.9, expired: false }, priority: 'critica', facts });

    expect(situation.options.map(option => option.id)).toEqual(['retaliate', 'de-escalate']);
    expect(situation.options[0].label).toBe(pressure.options[0].label);
    expect(situation.options[0].effectNote).toBe(pressure.options[0].effect.note);
    expect(situation.inaction.note).toBe(pressure.inaction.note);
    expect(situation.daysLeft).toBe(5);
    expect(situation.decisionQuestion).toContain('incidente');
    expect(situation.leadMinister).toBe('guerra');
    expect(situation.affectedDomains).toEqual(expect.arrayContaining(['difesa', 'diplomazia']));
    expect(situation.verifiedFacts.join('\n')).not.toMatch(longDecimals);
    expect(pressure).toEqual(before);
  });

  it('P1.8 — il follow-up di una decisione porta proprietario, scadenza, verifica e fatti reali', () => {
    const resolved = { ...pressure, status: 'resolved', resolution: 'Rappresaglia: escalation possibile.', resolvedOption: 'retaliate' };
    const followUp = buildGovernmentFollowUp({ pressure: resolved, owner: leadMinisterFor(resolved), dueDate: '1951-03-31', daysLeft: -2, facts });

    expect(followUp.owner).toBe('guerra');
    expect(followUp.origin).toEqual({ type: 'previous-decision', sourceId: pressure.id });
    expect(followUp.checks.join('\n')).toContain('escalation possibile');
    expect(followUp.outcome.join('\n')).not.toMatch(longDecimals);
    expect(followUp.situation.origin).toEqual(followUp.origin);
    expect(followUp.dueDate).toBe('1951-03-31');
  });

  it('P1.8 — il follow-up di un’inerzia dichiara la provenienza `inaction`', () => {
    const expired = { ...pressure, status: 'expired', resolution: 'Scaduta: l’inerzia ha presentato il conto.' };
    const followUp = buildGovernmentFollowUp({ pressure: expired, owner: leadMinisterFor(expired), dueDate: '1951-03-31', daysLeft: 0, facts });
    expect(followUp.origin.type).toBe('inaction');
    expect(followUp.situation.origin.type).toBe('inaction');
  });
});
