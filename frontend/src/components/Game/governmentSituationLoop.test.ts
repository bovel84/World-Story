/**
 * WS-GOV-SITUATIONS-LOOP — Il ciclo nella stanza del Consiglio.
 * ============================================================
 * La seduta nata da una `GovernmentSituation` conserva la situazione, riceve le
 * strade canoniche SOLO se esistono, e trasmette la provenienza all'atto. Le
 * sedute manuali restano identiche.
 */
import { describe, expect, it } from 'vitest';
import { createCouncilRoom, confirmPressureOption, excludePressureOption, councilContext, councilDraft, receiveCouncilReply, togglePressureOption } from './councilRoom';
import type { GovernmentSituationView } from '../../services/api';

const situation: GovernmentSituationView = {
  id: 'situation:external:border-incident#t3',
  pressureId: 'external:border-incident#t3',
  title: 'Incidente di frontiera con Serbia',
  briefing: 'Due militari uccisi e accuse incrociate.',
  source: 'Comando di frontiera',
  severity: 3,
  priority: 'critica',
  openedDate: '1951-03-01',
  deadline: '1951-03-31',
  daysLeft: 12,
  leadMinister: 'guerra',
  suggestedMinisters: ['esteri', 'tesoro'],
  verifiedFacts: ['Forze mobilitate 35'],
  decisionQuestion: 'Come rispondiamo all’incidente?',
  options: [
    { id: 'retaliate', label: 'Rafforzare il settore', detail: 'Un battaglione.', effectNote: 'Escalation possibile.' },
    { id: 'internationalize', label: 'Portare il caso all’ONU', detail: 'Tribuna internazionale.', effectNote: 'Tempo guadagnato.' },
  ],
  inaction: { note: 'La tensione al confine aumenta.' },
  affectedDomains: ['difesa'],
  origin: { type: 'state' },
};

describe('CouncilRoom con sourceSituation', () => {
  it('la stanza conserva la situazione e usa il TITOLO come oggetto', () => {
    const room = createCouncilRoom({ id: 'r1', scopeKey: 's', initiatorMinister: 'guerra', sourceSituation: situation });
    expect(room.topic).toBe('Incidente di frontiera con Serbia');
    expect(room.sourceSituation?.pressureId).toBe('external:border-incident#t3');
    expect(room.sourceSituation?.verifiedFacts).toEqual(['Forze mobilitate 35']);
    expect(room.selectedPressureOptions).toEqual([]);
  });

  it('le pressureOptions del modello diventano PROPOSTE, mai scelte confermate', () => {
    const room = createCouncilRoom({ id: 'r1', scopeKey: 's', initiatorMinister: 'guerra', sourceSituation: situation });
    const next = receiveCouncilReply(room, 'guerra', 'Propongo di rafforzare il settore.\n```consiglio\n{"pressureOptions":["retaliate","inventata","internationalize"]}\n```', 'm1');
    // L'id inventato è scartato; gli altri sono PROPOSTE, non scelte.
    expect(next.proposedPressureOptions).toEqual([
      { optionId: 'retaliate', proposedBy: 'guerra', messageId: 'm1' },
      { optionId: 'internationalize', proposedBy: 'guerra', messageId: 'm1' },
    ]);
    expect(next.selectedPressureOptions).toEqual([]);
  });

  it('solo la Conferma del Presidente porta una strada in selectedPressureOptions', () => {
    const room = createCouncilRoom({ id: 'r1', scopeKey: 's', initiatorMinister: 'guerra', sourceSituation: situation });
    const proposed = receiveCouncilReply(room, 'guerra', 'Ok.\n```consiglio\n{"pressureOptions":["retaliate"]}\n```', 'm1');
    expect(proposed.proposedPressureOptions).toHaveLength(1);
    expect(proposed.selectedPressureOptions).toEqual([]);
    const confirmed = confirmPressureOption(proposed, 'retaliate');
    expect(confirmed.selectedPressureOptions).toEqual(['retaliate']);
    expect(excludePressureOption(confirmed, 'retaliate').selectedPressureOptions).toEqual([]);
    expect(confirmPressureOption(proposed, 'inventata')).toBe(proposed);
  });

  it('una stanza manuale ignora le pressureOptions del modello', () => {
    const room = createCouncilRoom({ id: 'r2', scopeKey: 's', initiatorMinister: 'tesoro' });
    expect(room.topic).toBe('');
    const next = receiveCouncilReply(room, 'tesoro', 'Ok.\n```consiglio\n{"pressureOptions":["retaliate"]}\n```', 'm1');
    expect(next.selectedPressureOptions).toEqual([]);
  });

  it('il Presidente conferma/esclude le strade canoniche e non quelle ignote', () => {
    const room = createCouncilRoom({ id: 'r1', scopeKey: 's', initiatorMinister: 'guerra', sourceSituation: situation });
    const selected = togglePressureOption(room, 'retaliate');
    expect(selected.selectedPressureOptions).toEqual(['retaliate']);
    expect(togglePressureOption(selected, 'retaliate').selectedPressureOptions).toEqual([]);
    expect(togglePressureOption(selected, 'inventata')).toBe(selected);
  });

  it('il draft e il contesto portano la provenienza tecnica della situazione', () => {
    const room = createCouncilRoom({ id: 'r1', scopeKey: 's', initiatorMinister: 'guerra', sourceSituation: situation });
    const selected = togglePressureOption(room, 'retaliate');
    const draft = councilDraft(selected, 3);
    expect(draft.sourcePressureId).toBe('external:border-incident#t3');
    expect(draft.sourceSituationId).toBe(situation.id);
    const context = councilContext(selected);
    expect(context.sourceSituation?.pressureId).toBe('external:border-incident#t3');
    expect(context.selectedPressureOptions).toEqual(['retaliate']);
  });

  it('P2 — il draft congela la selezione confermata e la sua firma cambia con essa', () => {    const room = createCouncilRoom({ id: 'r1', scopeKey: 's', initiatorMinister: 'guerra', sourceSituation: situation });
    const selected = confirmPressureOption(room, 'retaliate');
    const draft = councilDraft(selected, 3);
    expect(draft.selectedPressureOptions).toEqual(['retaliate']);
    expect(draft.draftSignature).toBeTruthy();
    const withSecond = confirmPressureOption(selected, 'internationalize');
    expect(councilDraft(withSecond, 3).draftSignature).not.toBe(draft.draftSignature);
    expect(councilDraft(withSecond, 3).selectedPressureOptions).toEqual(['retaliate', 'internationalize']);
  });

  it('P3 — una stanza di follow-up riferisce il rapporto, non ripropone strade', () => {
    const followUp = { pressureId: 'p#1', label: 'Schieramento al confine', owner: 'tesoro' as const, dueDate: '1951-03-31', checks: ['Copertura logistica'], outcome: ['Disavanzo annuo 4,1% del PIL'], originDecision: 'p#1' };
    const room = createCouncilRoom({ id: 'r3', scopeKey: 's', initiatorMinister: 'tesoro', sourceFollowUp: followUp });
    expect(room.topic).toBe('Rapporto: Schieramento al confine');
    expect(room.sourceFollowUp?.outcome).toEqual(['Disavanzo annuo 4,1% del PIL']);
    expect(room.sourceSituation).toBeUndefined();
    expect(councilContext(room).sourceFollowUp?.pressureId).toBe('p#1');
  });
});
