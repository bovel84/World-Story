/**
 * WS-GOV-COUNCIL-HARDENING — Il Tesoro autorevole (punto 16) e la localizzazione
 * =============================================================================
 * Difende il criterio di successo: Tavola, Feasibility e `funded` dicono la
 * stessa cosa. Mai «coperta» con `funded=false` senza un blocco visibile. E la
 * localizzazione canonica arriva fino al piano d'esecuzione.
 */
import { describe, expect, it } from 'vitest';
import { applyEngineRead, isMeetingReadyForAct, meetingStatus, openMeeting } from './councilMeeting';
import { meetingReadFromFeasibility, type MeetingFeasibilityInput } from './meetingEngineRead';

function feasibility(overrides: Partial<MeetingFeasibilityInput> = {}): MeetingFeasibilityInput {
  return {
    feasible: true,
    costs: {
      timeDays: 45,
      note: '25% del gettito annuo (Infrastrutture)',
      inputs: [
        { resourceId: 'money', name: 'Tesoreria', quantity: '240', unit: 'mld' },
        { resourceId: 'acciaio', name: 'Acciaio', quantity: '12', unit: 't' },
      ],
    },
    risks: [],
    prerequisites: [],
    summary: 'Ordine fattibile',
    workDeclaration: {
      workId: 'work-fabbrica', payerActorId: 'POL', materialActorId: 'POL', funded: true, missingMaterials: [],
    },
    ...overrides,
  };
}

const SARAJEVO = [{ id: 'SARAJEVO', name: 'Sarajevo' }];

function openFabbrica(subject = 'Voglio costruire una fabbrica siderurgica a Sarajevo.') {
  return openMeeting({ gameId: 'g', branchId: null, turn: 10, subject })!;
}

describe('copertura monetaria autorevole (punto 16)', () => {
  it('fixture 240/270/0: coperta, margine 30, funded true, riunione pronta', () => {
    const input = feasibility({ availability: { money: [{ holder: 'POL', unitId: 'mld', available: '270' }] } });
    const meeting = openFabbrica();
    const read = meetingReadFromFeasibility(meeting, input, SARAJEVO);
    expect(read.money).toMatchObject({ required: '240', available: '270', missing: null, margin: '30,00', coverage: 'covered' });

    const next = applyEngineRead(meeting, read);
    const tesoro = next.workspace.lines.filter(line => line.owner === 'tesoro');
    expect(tesoro.some(line => line.label === 'Costo opera' && line.value === '240 mld')).toBe(true);
    expect(tesoro.some(line => line.label === 'Disponibile' && line.value === '270 mld')).toBe(true);
    expect(tesoro.some(line => line.label === 'Margine' && line.value === '30,00 mld')).toBe(true);
    expect(tesoro.some(line => line.label === 'Copertura' && line.value === 'coperta')).toBe(true);
    expect(isMeetingReadyForAct(next)).toBe(true);
  });

  it('fixture 240/180/60: insufficiente, mancano 60, funded false, riunione non pronta', () => {
    const input = feasibility({
      feasible: false,
      workDeclaration: { workId: 'work-fabbrica', payerActorId: 'POL', materialActorId: 'POL', funded: false, missingMaterials: [] },
      deficits: [{ code: 'INSUFFICIENT_CASH', id: 'mld', required: '240', available: '180', missing: '60', holder: 'POL' }],
      risks: ['per la fase fondazioni: richiesti 240, disponibili 180, mancano 60 (detentore POL)'],
    });
    const meeting = openFabbrica();
    const read = meetingReadFromFeasibility(meeting, input, SARAJEVO);
    expect(read.money).toMatchObject({ required: '240', available: '180', missing: '60', coverage: 'short' });

    const next = applyEngineRead(meeting, read);
    const tesoro = next.workspace.lines.filter(line => line.owner === 'tesoro');
    expect(tesoro.some(line => line.label === 'Costo opera' && line.value === '240 mld')).toBe(true);
    expect(tesoro.some(line => line.label === 'Disponibile' && line.value === '180 mld')).toBe(true);
    expect(tesoro.some(line => line.label === 'Mancano' && line.value === '60 mld')).toBe(true);
    expect(tesoro.some(line => line.label === 'Copertura' && line.value === 'scoperta')).toBe(true);
    expect(next.unresolved.some(item => item.kind === 'cash' && item.blocker)).toBe(true);
    expect(isMeetingReadyForAct(next)).toBe(false);
    expect(meetingStatus(next)).toBe('negotiating');
  });

  it('mai «coperta» con funded=false senza un blocco del motore', () => {
    const input = feasibility({
      feasible: false,
      workDeclaration: { workId: 'work-fabbrica', payerActorId: 'POL', materialActorId: null, funded: false, missingMaterials: [{ resourceId: 'acciaio', missing: '12 t' }] },
      risks: [],
    });
    const next = applyEngineRead(openFabbrica(), meetingReadFromFeasibility(openFabbrica(), input, SARAJEVO));
    expect(next.workspace.lines.some(line => line.label === 'Copertura' && line.value === 'coperta')).toBe(false);
    expect(next.unresolved.some(item => item.blocker)).toBe(true);
    expect(isMeetingReadyForAct(next)).toBe(false);
  });
});

describe('localizzazione canonica fino al piano d’esecuzione (punto 15)', () => {
  it('Sarajevo risolta: regionLabel e regionId arrivano al piano', () => {
    const meeting = openFabbrica();
    const read = meetingReadFromFeasibility(meeting, feasibility(), SARAJEVO);
    expect(read.regionLabel).toBe('Sarajevo');
    expect(read.regionId).toBe('SARAJEVO');
    const next = applyEngineRead(meeting, read);
    expect(next.workspace.region).toBe('Sarajevo');
    expect(next.execution.regionId).toBe('SARAJEVO');
  });

  it('localizzazione ambigua: nessun regionId arbitrario e riunione non pronta', () => {
    const regions = [{ id: 'SARAJEVO', name: 'Sarajevo' }, { id: 'NOVI_SAD', name: 'Novi Sad' }];
    const meeting = openFabbrica('Colleghiamo Sarajevo e Novi Sad con una ferrovia.');
    const read = meetingReadFromFeasibility(meeting, feasibility({ workDeclaration: null }), regions);
    expect(read.location?.status).toBe('ambiguous');
    const next = applyEngineRead(meeting, read);
    expect(next.execution.regionId).toBeUndefined();
    expect(next.unresolved.some(item => item.kind === 'location' && item.blocker)).toBe(true);
    expect(isMeetingReadyForAct(next)).toBe(false);
  });
});
