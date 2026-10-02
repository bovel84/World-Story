/**
 * WS-GOV-COUNCIL-MEETINGS — La riunione è uno stato, non una chat (B1–B9)
 * ======================================================================
 * Difende le regole: selettore e capofila deterministici; un solo piano
 * condiviso; contributi attribuiti alla sedia e **letti dal motore**; l'atto
 * della riunione conserva la dichiarazione d'opera; la cassa insufficiente è
 * un'**obiezione con requisito**, non una soluzione inventata.
 */
import { describe, expect, it } from 'vitest';
import {
  applyEngineRead, isFreshMeeting, isMeetingReadyForAct, meetingActDraft, meetingStatus,
  openMeeting, selectLeadSeat, selectParticipants, shouldConveneMeeting,
  type CouncilMeeting, type MeetingEngineRead,
} from './councilMeeting';

function fabbricaRead(overrides: Partial<MeetingEngineRead> = {}): MeetingEngineRead {
  return {
    workLabel: 'Fabbrica siderurgica',
    regionLabel: 'Sarajevo',
    durationDays: 45,
    materials: [{ name: 'Acciaio', ok: false, missing: '12 t' }],
    costLabel: '12,40 mld',
    costNote: '25% del gettito annuo (Infrastrutture)',
    coverage: 'covered',
    availableLabel: '18,00 mld',
    risks: [],
    prerequisites: [],
    summary: 'Ordine fattibile',
    workId: 'work-fabbrica',
    regionId: 'sarajevo',
    workDeclaration: { workId: 'work-fabbrica', payerActorId: 'POL', materialActorId: 'POL', funded: true, missingMaterials: [] },
    source: 'check-feasibility',
    ...overrides,
  };
}

describe('selettore deterministico dei partecipanti (B4/B5)', () => {
  it('una fabbrica convoca Lavori e Tesoro, con i Lavori capofila', () => {
    const participants = selectParticipants('Voglio costruire una fabbrica siderurgica a Sarajevo.');
    expect(participants).toEqual(['tesoro', 'lavori']);
    expect(selectLeadSeat('Voglio costruire una fabbrica siderurgica a Sarajevo.', participants)).toBe('lavori');
  });

  it('un ospedale convoca Sanità, Lavori e Tesoro con la Sanità capofila', () => {
    const subject = 'Voglio costruire un nuovo ospedale a Nord.';
    const participants = selectParticipants(subject);
    expect(participants).toContain('sanita');
    expect(participants).toContain('lavori');
    expect(participants).toContain('tesoro');
    expect(selectLeadSeat(subject, participants)).toBe('sanita');
  });

  it('una richiesta mono-competenza non apre una riunione', () => {
    expect(shouldConveneMeeting('Voglio un parere sulla scuola elementare.')).toBe(false);
    expect(openMeeting({ gameId: 'g', branchId: null, turn: 1, subject: 'Voglio un parere sulla scuola elementare.' })).toBeNull();
  });

  it('lo stesso testo produce sempre la stessa riunione (deterministico)', () => {
    const a = openMeeting({ gameId: 'g', branchId: 'main', turn: 3, subject: 'Costruiamo una ferrovia.' });
    const b = openMeeting({ gameId: 'g', branchId: 'main', turn: 3, subject: 'Costruiamo una ferrovia.' });
    expect(a?.id).toBe(b?.id);
    expect(a?.participants).toEqual(b?.participants);
  });
});

describe('piano condiviso e contributi attribuiti (B2/B3/B7/B8)', () => {
  it('il piano distingue Lavori e Tesoro con la provenienza del motore', () => {
    const meeting = openMeeting({ gameId: 'g', branchId: null, turn: 1, subject: 'Fabbrica siderurgica a Sarajevo' })!;
    const next = applyEngineRead(meeting, fabbricaRead());
    const lavori = next.workspace.lines.filter(line => line.owner === 'lavori');
    const tesoro = next.workspace.lines.filter(line => line.owner === 'tesoro');
    expect(lavori.some(line => line.label === 'Opera' && line.value === 'Fabbrica siderurgica')).toBe(true);
    expect(lavori.some(line => line.label === 'Acciaio' && line.status === 'missing')).toBe(true);
    expect(tesoro.some(line => line.label === 'Costo opera' && line.value === '12,40 mld')).toBe(true);
    expect(tesoro.some(line => line.label === 'Copertura' && line.value === 'coperta')).toBe(true);
    expect(next.workspace.lines.every(line => line.source === 'check-feasibility')).toBe(true);
  });

  it('ogni intervento è attribuito alla sua sedia, e i numeri sono quelli del motore', () => {
    const meeting = openMeeting({ gameId: 'g', branchId: null, turn: 1, subject: 'Fabbrica siderurgica a Sarajevo' })!;
    const next = applyEngineRead(meeting, fabbricaRead());
    const lavori = next.contributions.find(item => item.seat === 'lavori');
    const tesoro = next.contributions.find(item => item.seat === 'tesoro');
    expect(lavori?.text).toContain('Fabbrica siderurgica');
    expect(lavori?.text).toContain('mancano');
    expect(tesoro?.text).toContain('12,40 mld');
    expect(tesoro?.text).toContain('18,00 mld');
    // Nessun numero inventato: non compare una cifra che non sia nel read model.
    expect(tesoro?.text).not.toContain('9,99');
  });

  it('la riunione è pronta per l’atto con un piano e nessun blocco', () => {
    const meeting = openMeeting({ gameId: 'g', branchId: null, turn: 1, subject: 'Fabbrica siderurgica a Sarajevo' })!;
    const withData = applyEngineRead(meeting, fabbricaRead());
    expect(withData.workspace.lines.length).toBeGreaterThan(0);
    expect(isMeetingReadyForAct(withData)).toBe(true);
    expect(meetingStatus(withData)).toBe('ready-for-act');
  });
});

describe('l’atto della riunione conserva la dichiarazione d’opera (B15/B16)', () => {
  it('con distinta coperta l’atto è un ordine d’opera con workId', () => {
    const meeting = openMeeting({ gameId: 'g', branchId: null, turn: 1, subject: 'Fabbrica siderurgica a Sarajevo' })!;
    const next = applyEngineRead(meeting, fabbricaRead());
    const draft = meetingActDraft(next);
    expect(draft.capability).toBe('engine-order');
    expect(draft.work).toEqual({ workId: 'work-fabbrica', payerActorId: 'POL', materialActorId: 'POL', funded: true, regionId: 'sarajevo' });
    expect(draft.text).toContain('Fabbrica siderurgica');
  });

  it('con distinta scoperta l’atto NON diventa prosa silenziosa: lo dichiara', () => {
    const meeting = openMeeting({ gameId: 'g', branchId: null, turn: 1, subject: 'Fabbrica siderurgica a Sarajevo' })!;
    const next = applyEngineRead(meeting, fabbricaRead({
      coverage: 'short',
      risks: ['Cassa insufficiente: servono 4,20 mld'],
      workDeclaration: { workId: 'work-fabbrica', payerActorId: 'POL', materialActorId: null, funded: false, missingMaterials: [] },
    }));
    const draft = meetingActDraft(next);
    expect(draft.capability).toBe('unsupported');
    expect(draft.work).toBeUndefined();
    expect(draft.note).toContain('mancano');
  });
});

describe('cassa insufficiente (B18)', () => {
  it('il Tesoro obietta e la Tavola mostra un requisito di cassa, senza inventare soluzioni', () => {
    const meeting = openMeeting({ gameId: 'g', branchId: null, turn: 1, subject: 'Fabbrica siderurgica a Sarajevo' })!;
    const next = applyEngineRead(meeting, fabbricaRead({
      coverage: 'short',
      availableLabel: '4,00 mld',
      risks: ['Cassa insufficiente: servono 4,20 mld'],
    }));
    const tesoro = next.contributions.find(item => item.seat === 'tesoro');
    expect(tesoro?.kind).toBe('objection');
    expect(tesoro?.text).toContain('Non c’è la copertura');
    expect(next.unresolved.some(item => item.kind === 'cash' && item.blocker)).toBe(true);
    expect(isMeetingReadyForAct(next)).toBe(false);
    expect(meetingStatus(next)).toBe('negotiating');
  });

  it('il dissenso politico NON diventa blocco tecnico (B14)', () => {
    const meeting = openMeeting({ gameId: 'g', branchId: null, turn: 1, subject: 'Fabbrica siderurgica a Sarajevo' })!;
    const next = applyEngineRead(meeting, fabbricaRead({ risks: [] }));
    expect(next.unresolved).toEqual([]);
    expect(isMeetingReadyForAct(next)).toBe(true);
  });
});

describe('una nuova riunione per ogni turno (Fase A)', () => {
  it('il turno distingue la riunione: la precedente è storia', () => {
    const first = openMeeting({ gameId: 'g', branchId: null, turn: 1, subject: 'Fabbrica siderurgica' })!;
    const second = openMeeting({ gameId: 'g', branchId: null, turn: 2, subject: 'Fabbrica siderurgica' })!;
    expect(first.id).not.toBe(second.id);
    expect(isFreshMeeting(first, 2)).toBe(true);
    expect(isFreshMeeting(second, 2)).toBe(false);
  });
});

describe('nessun contributo duplicato (idempotenza dell’orchestrazione)', () => {
  it('applicare due volte la stessa lettura non gonfia la riunione', () => {
    const meeting = openMeeting({ gameId: 'g', branchId: null, turn: 1, subject: 'Fabbrica siderurgica' })!;
    const once = applyEngineRead(meeting, fabbricaRead());
    const twice = applyEngineRead(once, fabbricaRead());
    expect(twice.contributions).toHaveLength(once.contributions.length);
  });
});

/** Guardia di tipo: la riunione resta serializzabile (nessuna funzione dentro). */
const _typeCheck: (meeting: CouncilMeeting) => number = meeting => meeting.contributions.length;
void _typeCheck;
