/**
 * WS-GOV-MOBILE-FOCUS (A1–A5, H6, H8, H11, H12, H16) — Prove dei moduli puri.
 * =========================================================================
 * Non monta la stanza: prova che l'identità della riunione, il blocco di
 * localizzazione, la rinvia alla regione attuale e il view model mobile sono
 * derivazioni pure e deterministiche.
 */
import { describe, expect, it } from 'vitest';
import {
  applyEngineRead, continueMeeting, openMeeting, councilMeetingIdentity,
  type CouncilMeeting, type MeetingEngineRead,
} from './councilMeeting';
import { hasCurrentRegionAnaphora, resolveCurrentRegionRef, resolveMeetingLocation } from './meetingLocalization';
import {
  blockerKey, ministerSectionsFromMeeting, mobileDecisionSummary, mobileHistory, participantChips,
  readableMeetingStatus, shouldShowBoardDot, uniqueSourceLabels,
} from './mobileFocus';
import { isGovernmentCompactSize } from '../../hooks/useIsMobile';

function meeting(subject = 'Voglio costruire una fabbrica siderurgica'): CouncilMeeting {
  const opened = openMeeting({ gameId: 'g1', branchId: 'main', turn: 13, subject });
  if (!opened) throw new Error('la riunione doveva aprirsi');
  return opened;
}

/** Una lettura generica, con la stessa materia della riunione. */
function read(overrides: Partial<MeetingEngineRead> = {}): MeetingEngineRead {
  return {
    workLabel: 'Fabbrica siderurgica',
    subject: 'Voglio costruire una fabbrica siderurgica',
    regionLabel: null,
    durationDays: 180,
    materials: [{ name: 'Acciaio', ok: true }],
    costLabel: '2,4 mld',
    costNote: null,
    coverage: 'covered',
    availableLabel: '2,7 mld',
    risks: [],
    prerequisites: [],
    summary: 'Opera coperta',
    source: 'check-feasibility',
    location: { status: 'missing', candidates: [], region: null },
    ...overrides,
  };
}

describe('A1 — l’identità della riunione non è i partecipanti', () => {
  it('due convocazioni diverse nello stesso turno hanno id diversi anche con le stesse competenze', () => {
    const a = openMeeting({ gameId: 'g1', branchId: 'main', turn: 13, subject: 'Voglio costruire una fabbrica' })!;
    const b = openMeeting({ gameId: 'g1', branchId: 'main', turn: 13, subject: 'Voglio costruire un porto' })!;
    expect(a.participants).toEqual(b.participants);
    expect(a.participants).toEqual(['tesoro', 'lavori']);
    expect(a.id).not.toBe(b.id);
    expect(a.sessionId).toBe(b.sessionId);
    expect(a.meetingId).not.toBe(b.meetingId);
  });

  it('la stessa materia nello stesso turno resta la stessa convocazione (idempotenza)', () => {
    const a = councilMeetingIdentity({ gameId: 'g1', branchId: 'main', turn: 13, subject: 'Costruire una fabbrica' });
    const b = councilMeetingIdentity({ gameId: 'g1', branchId: 'main', turn: 13, subject: 'Costruire una fabbrica' });
    expect(a).toEqual(b);
  });

  it('il messaggio di origine vince sul testo: l’id è quello del messaggio', () => {
    const identity = councilMeetingIdentity({ gameId: 'g1', branchId: null, turn: 4, subject: 'x', sourceMessageId: 'm-9' });
    expect(identity.meetingId).toBe('msg-m-9');
    expect(identity.sessionId).toBe('g1|main|4');
  });
});

describe('A2/A3 — una lettura estranea non tocca la riunione', () => {
  it('applyEngineRead ignora una lettura con un altro soggetto', () => {
    const base = meeting();
    const foreign = applyEngineRead(base, read({ subject: 'Voglio costruire un porto' }));
    expect(foreign).toBe(base);
  });

  it('applyEngineRead accetta una lettura della stessa materia', () => {
    const base = meeting();
    const next = applyEngineRead(base, read());
    expect(next.workspace.lines.length).toBeGreaterThan(0);
    expect(next.contributions.some(c => c.seat === 'tesoro')).toBe(true);
  });
});

describe('A4 — un’opera fisica senza localizzazione è un blocco', () => {
  it('senza localizzazione, con una distinta d’opera, compare il blocco «Dove…»', () => {
    const base = meeting();
    const next = applyEngineRead(base, read({
      location: { status: 'missing', candidates: [], region: null },
      workDeclaration: {
        workId: 'w1', payerActorId: 'a1', materialActorId: 'a2', funded: true, missingMaterials: [],
      },
    }));
    const blocker = next.unresolved.find(item => item.kind === 'location');
    expect(blocker?.label).toBe('Dove deve sorgere l’opera?');
    expect(blocker?.blocker).toBe(true);
  });

  it('con la localizzazione risolta non si aggiunge il blocco', () => {
    const base = meeting();
    const next = applyEngineRead(base, read({
      location: { status: 'resolved', candidates: [{ regionId: 'SARAJEVO', regionLabel: 'Sarajevo' }], region: { regionId: 'SARAJEVO', regionLabel: 'Sarajevo' } },
      regionLabel: 'Sarajevo',
      regionId: 'SARAJEVO',
      workDeclaration: { workId: 'w1', payerActorId: 'a1', materialActorId: 'a2', funded: true, missingMaterials: [] },
    }));
    expect(next.unresolved.some(item => item.kind === 'location')).toBe(false);
    expect(next.execution.regionId).toBe('SARAJEVO');
  });
});

describe('A5 — «qui» si risolve solo con una regione canonica nota', () => {
  const regions = [
    { id: 'SARAJEVO', name: 'Sarajevo', owner: 'player', metadata: { isCapitalProvince: true } },
    { id: 'MOSTAR', name: 'Mostar', owner: 'player', metadata: {} },
  ];

  it('riconosce la rinvia esplicita e non la confonde con una regione nominata', () => {
    expect(hasCurrentRegionAnaphora('Voglio costruire qui')).toBe(true);
    expect(hasCurrentRegionAnaphora('Voglio costruire a Mostar')).toBe(false);
  });

  it('con la capitale marcata, «qui» risolve alla capitale', () => {
    const current = resolveCurrentRegionRef(regions, 'player');
    expect(current).toEqual({ id: 'SARAJEVO', name: 'Sarajevo' });
    const location = resolveMeetingLocation('Costruiamo la fabbrica qui', regions, current);
    expect(location.status).toBe('resolved');
    expect(location.region?.regionId).toBe('SARAJEVO');
  });

  it('senza capitale e con più regioni possedute non si sceglie: resta mancante', () => {
    const noCapital = [
      { id: 'A', name: 'Alfa', owner: 'player', metadata: {} },
      { id: 'B', name: 'Beta', owner: 'player', metadata: {} },
    ];
    expect(resolveCurrentRegionRef(noCapital, 'player')).toBeNull();
    const location = resolveMeetingLocation('Costruiamo la fabbrica qui', noCapital, null);
    expect(location.status).toBe('missing');
  });
});

describe('H8/H11 — il view model mobile', () => {
  it('traduce lo stato in linguaggio leggibile, mai in gergo tecnico', () => {
    expect(readableMeetingStatus('gathering-inputs')).toBe('In definizione');
    expect(readableMeetingStatus('ready-for-act')).toBe('Pronta per l’atto');
  });

  it('con blocchi non pronta: la CTA è continuare, non preparare', () => {
    const base = meeting();
    const next = applyEngineRead(base, read({
      location: { status: 'missing', candidates: [], region: null },
      workDeclaration: { workId: 'w1', payerActorId: 'a1', materialActorId: 'a2', funded: true, missingMaterials: [] },
    }));
    const summary = mobileDecisionSummary({ meeting: next, workspace: null, actPrepared: false, actStale: false, signed: false, pendingMeetingPrompt: null });
    expect(summary.unresolved.length).toBeGreaterThan(0);
    expect(summary.primaryAction).toBe('continue');
  });

  it('un atto preparato e firmato cambia la prossima azione', () => {
    const signed = mobileDecisionSummary({ meeting: meeting(), workspace: null, actPrepared: true, actStale: false, signed: true, pendingMeetingPrompt: null });
    expect(signed.status).toBe('Firmata');
    expect(signed.primaryAction).toBeNull();
    const prepared = mobileDecisionSummary({ meeting: meeting(), workspace: null, actPrepared: true, actStale: false, signed: false, pendingMeetingPrompt: null });
    expect(prepared.status).toBe('Atto preparato');
    expect(prepared.primaryAction).toBe('sign');
  });

  it('H6: il pallino compare solo in Dialogo e solo per un cambiamento reale', () => {
    expect(shouldShowBoardDot({ view: 'dialogue', seenRevision: 0, currentRevision: 0, seenMeetingRevision: 0, currentMeetingRevision: 0, seenBlockerKey: '', currentBlockerKey: '' })).toBe(false);
    expect(shouldShowBoardDot({ view: 'dialogue', seenRevision: 0, currentRevision: 1, seenMeetingRevision: 0, currentMeetingRevision: 0, seenBlockerKey: '', currentBlockerKey: '' })).toBe(true);
    expect(shouldShowBoardDot({ view: 'board', seenRevision: 0, currentRevision: 1, seenMeetingRevision: 0, currentMeetingRevision: 0, seenBlockerKey: '', currentBlockerKey: '' })).toBe(false);
    expect(blockerKey(meeting())).toBe('');
  });

  it('H12: la cronologia mobile elenca le revisioni, non il workspace', () => {
    const workspace = {
      seat: 'lavori', status: 'shaping' as const, problem: null, objective: null, proposals: [], activeProposalId: null,
      evidenceIds: [], revision: 3,
      history: [{ revision: 1, summary: 'Fabbrica siderurgica' }, { revision: 2, summary: 'Sarajevo' }, { revision: 3, summary: 'Copertura verificata' }],
    };
    expect(mobileHistory(workspace).map(entry => `v${entry.revision}`)).toEqual(['v3', 'v2', 'v1']);
  });

  it('H16: i partecipanti si comprimono in chip con «+N»', () => {
    const base = meeting();
    const wider: CouncilMeeting = { ...base, participants: ['lavori', 'tesoro', 'sanita', 'interno', 'esteri'] };
    const chips = participantChips(wider, 3);
    expect(chips.shown).toHaveLength(3);
    expect(chips.hidden).toBe(2);
    expect(chips.shown[0].lead).toBe(true);
  });
});

describe('WS-GOV-MOBILE-CLEANUP — identità, risultato, layout compatto', () => {
  it('M1/M3 — due convocazioni con lo stesso testo nello stesso turno hanno identità diverse', () => {
    const a = openMeeting({ gameId: 'g1', branchId: 'main', turn: 20, subject: 'Costruiamo una fabbrica a Sarajevo.', sourceMessageId: 'g1|main|20|lavori:user-4' })!;
    const b = openMeeting({ gameId: 'g1', branchId: 'main', turn: 20, subject: 'Costruiamo una fabbrica a Sarajevo.', sourceMessageId: 'g1|main|20|lavori:user-18' })!;
    expect(a.sessionId).toBe(b.sessionId);
    expect(a.meetingId).not.toBe(b.meetingId);
    expect(a.id).not.toBe(b.id);
    expect(a.subject).toBe(b.subject);
    expect(a.participants).toEqual(b.participants);
  });

  it('M1/M3 — lo stesso sourceMessageId è la stessa convocazione (idempotenza)', () => {
    const a = openMeeting({ gameId: 'g1', branchId: 'main', turn: 20, subject: 'Costruiamo una fabbrica a Sarajevo.', sourceMessageId: 'g1|main|20|lavori:user-4' })!;
    const b = openMeeting({ gameId: 'g1', branchId: 'main', turn: 20, subject: 'Costruiamo una fabbrica a Sarajevo.', sourceMessageId: 'g1|main|20|lavori:user-4' })!;
    expect(a.id).toBe(b.id);
    expect(a.meetingId).toBe(b.meetingId);
  });

  it('M2 — continuare la riunione attiva non cambia identità, ma porta una nuova lettura', () => {
    const base = meeting();
    const next = continueMeeting(base, read({ regionLabel: 'Sarajevo', location: { status: 'resolved', candidates: [{ regionId: 'SARAJEVO', regionLabel: 'Sarajevo' }], region: { regionId: 'SARAJEVO', regionLabel: 'Sarajevo' } } }));
    expect(next.id).toBe(base.id);
    expect(next.meetingId).toBe(base.meetingId);
    expect(next.workspace.lines.some(line => line.label === 'Luogo' && line.value === 'Sarajevo')).toBe(true);
  });

  it('M15 — la Tavola mobile raggruppa il piano per ministero, non il transcript', () => {
    const next = applyEngineRead(meeting(), read({ money: { required: '2,4', available: '2,7', missing: null, margin: '0,3', coverage: 'covered', unit: 'mld' } }));
    const sections = ministerSectionsFromMeeting(next);
    expect(sections.map(section => section.seat)).toEqual(['lavori', 'tesoro']);
    const lavori = sections.find(section => section.seat === 'lavori')!;
    expect(lavori.lines.map(line => line.label)).toContain('Opera');
    const tesoro = sections.find(section => section.seat === 'tesoro')!;
    expect(tesoro.lines.some(line => line.label === 'Copertura')).toBe(true);
  });

  it('M8 — le fonti si deduplicano e l’id tecnico diventa leggibile', () => {
    expect(uniqueSourceLabels(['check-feasibility', 'check-feasibility', 'ledger', 'work-catalog']))
      .toEqual(['Motore di fattibilità', 'Ledger', 'Catalogo opere']);
  });

  it('M4 — il telefono in orizzontale è compatto, il desktop no', () => {
    expect(isGovernmentCompactSize(390, 844)).toBe(true);
    expect(isGovernmentCompactSize(412, 915)).toBe(true);
    expect(isGovernmentCompactSize(844, 390)).toBe(true);
    expect(isGovernmentCompactSize(1024, 768)).toBe(false);
    expect(isGovernmentCompactSize(1366, 768)).toBe(false);
  });
});
