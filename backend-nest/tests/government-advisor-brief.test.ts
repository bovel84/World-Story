/**
 * WS-GOV-ADVISOR-HUB — Il briefing del Primo Consulente.
 * =====================================================
 * Read model strutturato: roster SEMPRE completo dei sette ministri, lifecycle
 * delle situazioni, follow-up e decisioni recenti. Nessun fatto inventato.
 */
import { describe, expect, it } from 'vitest';
import { buildGovernmentAdvisorBrief, situationLifecycle } from '../src/core/government/GovernmentAdvisorBrief';
import type { GovernmentSituation } from '../src/core/government/GovernmentSituations';

const situation = (over: Partial<GovernmentSituation> = {}): GovernmentSituation => ({
  id: 'situation:p1', pressureId: 'p1', title: 'Incidente di frontiera', briefing: 'Due morti.',
  source: 'Comando di frontiera', severity: 3, priority: 'critica', openedDate: '1951-03-01', openedTurn: 3,
  deadline: null, daysLeft: 12, leadMinister: 'guerra', suggestedMinisters: ['tesoro'],
  verifiedFacts: ['Forze mobilitate 35'], decisionQuestion: 'Come rispondiamo all’incidente?',
  options: [], inaction: { note: 'Peggiora.' }, affectedDomains: ['difesa'], origin: { type: 'state' }, ...over,
});

describe('GovernmentAdvisorBrief', () => {
  it('espone SEMPRE i sette ministri, engaged o available', () => {
    const brief = buildGovernmentAdvisorBrief({ date: '1951-03-01', situations: [situation()], followUps: [] });
    expect(brief.cabinet).toHaveLength(7);
    expect(brief.cabinet.map(entry => entry.seat)).toEqual(['tesoro', 'lavori', 'istruzione', 'sanita', 'esteri', 'interno', 'guerra']);
    expect(brief.cabinet.find(entry => entry.seat === 'guerra')?.state).toBe('engaged');
    expect(brief.cabinet.find(entry => entry.seat === 'lavori')?.state).toBe('available');
  });

  it('classifica il lifecycle: nuovo, aperto, seguito', () => {
    expect(situationLifecycle(situation({ openedTurn: 3 }), 3)).toBe('new');
    expect(situationLifecycle(situation({ openedTurn: 1 }), 3)).toBe('active');
    expect(situationLifecycle(situation({ origin: { type: 'previous-decision', sourceId: 'p0' } }), 3)).toBe('follow-up');
    expect(situationLifecycle(situation({ origin: { type: 'inaction', sourceId: 'p0' } }), 3)).toBe('follow-up');
  });

  it('include follow-up e decisioni recenti, e non inventa fatti', () => {
    const followUp = {
      id: 'follow-up:p1', pressureId: 'p1', owner: 'guerra' as const, dueDate: '1951-03-31', daysLeft: -1,
      label: 'Schieramento al confine', checks: [], outcome: ['Forze mobilitate 35'],
      origin: { type: 'previous-decision' as const, sourceId: 'p1' }, situation: situation(),
    };
    const brief = buildGovernmentAdvisorBrief({
      date: '1951-03-01', situations: [], followUps: [followUp],
      recentDecisions: [{ id: 'p1', title: 'Incidente', resolution: 'Rappresaglia.' }],
    });
    expect(brief.followUps).toHaveLength(1);
    expect(brief.cabinet.find(entry => entry.seat === 'guerra')?.state).toBe('engaged');
    expect(brief.recentDecisions[0]).toEqual({ pressureId: 'p1', title: 'Incidente', resolution: 'Rappresaglia.' });
  });
});
