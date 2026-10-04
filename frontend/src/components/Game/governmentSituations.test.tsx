/**
 * WS-GOV-SITUATIONS — la porta del Governo mostra le situazioni del motore.
 * ========================================================================
 * Read model: la vista non genera nulla, raggruppa urgenze e opportunità,
 * mostra i fatti verificabili del motore e apre il Consiglio. Nessun numero
 * con più di due decimali arriva nella prosa.
 */
import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { GovernmentSituations } from './GovernmentSituations';
import type { GovernmentFollowUpView, GovernmentSituationView, PeacetimePressure } from '../../services/api';

function pressure(input: {
  id: string;
  title: string;
  priority?: string;
  verifiedFacts?: string[];
}): PeacetimePressure {
  const situation: GovernmentSituationView = {
    id: `situation:${input.id}`,
    pressureId: input.id,
    title: input.title,
    briefing: 'Un posto di guardia è stato attaccato: due morti.',
    source: 'Comando di frontiera',
    severity: input.priority === 'ordinaria' ? 1 : 3,
    priority: input.priority ?? 'critica',
    openedDate: '1951-03-01',
    deadline: null,
    daysLeft: 4,
    leadMinister: 'guerra',
    suggestedMinisters: ['tesoro', 'esteri'],
    verifiedFacts: input.verifiedFacts ?? ['Forze mobilitate 35'],
    decisionQuestion: 'Come rispondiamo all’incidente?',
    options: [{ id: 'retaliate', label: 'Rispondere con la forza', detail: 'Colpo di mano.', effectNote: 'Escalation possibile.' }],
    inaction: { note: 'La stampa parla di governo assente.' },
    affectedDomains: ['difesa'],
    origin: { type: 'state' },
  };
  return {
    id: input.id, kind: 'external', template: 'border-incident', title: input.title,
    detail: situation.briefing, severity: situation.severity, source: situation.source,
    options: [], status: 'active', createdDate: '1951-03-01', createdTurn: 3, situation,
  };
}

describe('GovernmentSituations', () => {
  it('separa le urgenze dalle opportunità e mostra fatti e domanda', () => {
    const html = renderToStaticMarkup(<GovernmentSituations
      pressures={[
        pressure({ id: 'p1', title: 'Incidente di frontiera con Serbia', verifiedFacts: ['Forze mobilitate 35', 'Disavanzo annuo 4,1% del PIL'] }),
        pressure({ id: 'p2', title: 'Romania propone un accordo', priority: 'ordinaria', verifiedFacts: [] }),
      ]}
      onOpen={() => {}} />);

    expect(html).toContain('PROBLEMI CHE RICHIEDONO DECISIONE');
    expect(html).toContain('OPPORTUNITÀ');
    expect(html).toContain('Incidente di frontiera con Serbia');
    expect(html).toContain('Forze mobilitate 35');
    expect(html).toContain('Come rispondiamo all’incidente?');
    expect(html).not.toMatch(/[.,]\d{3,}/);
    expect(html.match(/Porta al Consiglio/g)).toHaveLength(2);
  });

  it('mostra i seguiti dovuti nella home, con proprietario e apertura rapporto', () => {
    const followUp: GovernmentFollowUpView = {
      id: 'follow-up:p#1', pressureId: 'p#1', owner: 'tesoro', dueDate: '1951-03-31', daysLeft: -1,
      label: 'Schieramento al confine: copertura logistica', checks: [], outcome: ['Disavanzo annuo 4,1% del PIL'],
      origin: { type: 'previous-decision', sourceId: 'p#1' },
      situation: pressure({ id: 'p#1', title: 'Incidente di frontiera con Serbia' }).situation!,
    };
    const html = renderToStaticMarkup(<GovernmentSituations followUps={[followUp]} onOpen={() => {}} onOpenFollowUp={() => {}} />);
    expect(html).toContain('RAPPORTI DA LEGGERE');
    expect(html).toContain('Schieramento al confine: copertura logistica');
    expect(html).toContain('Apri rapporto');
    expect(html).toContain('previsto oggi');
  });

  it('non mostra nulla se il motore non pubblica situazioni', () => {
    expect(renderToStaticMarkup(<GovernmentSituations pressures={[]} onOpen={() => {}} />)).toBe('');
  });
});
