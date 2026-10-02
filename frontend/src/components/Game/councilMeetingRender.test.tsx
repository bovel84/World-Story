/**
 * WS-GOV-COUNCIL-MEETINGS — La tavola della riunione, resa (B12/B19)
 * =================================================================
 * Difende la resa: una sola tavola condivisa, le competenze distinte
 * (LAVORI/TESORO), i blocchi del motore contro le obiezioni, e l'atto che si
 * prepara solo quando la riunione è pronta.
 */
import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { CouncilMeetingBoard } from './CouncilMeetingBoard';
import { applyEngineRead, openMeeting, type MeetingEngineRead } from './councilMeeting';

function read(overrides: Partial<MeetingEngineRead> = {}): MeetingEngineRead {
  return {
    workLabel: 'Fabbrica siderurgica',
    regionLabel: 'Sarajevo',
    durationDays: 45,
    materials: [{ name: 'Acciaio', ok: false, missing: '12 t' }],
    costLabel: '12,40 mld',
    costNote: '25% del gettito annuo (Infrastrutture)',
    coverage: 'covered',
    availableLabel: '18,00 n',
    risks: [],
    prerequisites: [],
    summary: 'Ordine fattibile',
    workId: 'work-fabbrica',
    workDeclaration: { workId: 'work-fabbrica', payerActorId: 'POL', materialActorId: 'POL', funded: true, missingMaterials: [] },
    source: 'check-feasibility',
    ...overrides,
  };
}

function meeting(overrides: Partial<MeetingEngineRead> = {}) {
  const opened = openMeeting({ gameId: 'g', branchId: null, turn: 1, subject: 'Voglio costruire una fabbrica siderurgica a Sarajevo.' })!;
  return applyEngineRead(opened, read(overrides));
}

describe('CouncilMeetingBoard — la tavola della riunione', () => {
  it('mostra oggetto, partecipanti e le competenze distinte', () => {
    const html = renderToStaticMarkup(<CouncilMeetingBoard meeting={meeting()} onPrepareAct={() => {}} />);
    expect(html).toContain('Riunione di Governo');
    expect(html).toContain('Partecipano');
    expect(html).toContain('Ministro dei Lavori');
    expect(html).toContain('Ministro del Tesoro');
    expect(html).toContain('data-owner="lavori"');
    expect(html).toContain('data-owner="tesoro"');
    expect(html).toContain('Fabbrica siderurgica');
    expect(html).toContain('12,40 mld');
    // La provenienza è dichiarata per ogni riga.
    expect(html).toContain('data-status="missing"');
  });

  it('pronta per l’atto: offre il pulsante di preparazione', () => {
    const html = renderToStaticMarkup(<CouncilMeetingBoard meeting={meeting()} onPrepareAct={() => {}} />);
    expect(html).toContain('Prepara l’atto della riunione');
    expect(html).toContain('data-status="ready-for-act"');
  });

  it('cassa insufficiente: mostra il blocco del motore e NON offre l’atto', () => {
    const html = renderToStaticMarkup(
      <CouncilMeetingBoard
        meeting={meeting({ coverage: 'short', risks: ['Cassa insufficiente: servono 4,20 mld'] })}
        onPrepareAct={() => {}}
      />,
    );
    expect(html).toContain('blocco del motore');
    expect(html).toContain('Da risolvere');
    expect(html).not.toContain('Prepara l’atto della riunione');
  });

  it('gli approfondimenti e le evidenze nascono chiusi', () => {
    const html = renderToStaticMarkup(<CouncilMeetingBoard meeting={meeting()} />);
    expect(html).toContain('<details class="council-meeting-evidence">');
    expect(html).not.toContain('<details class="council-meeting-evidence" open');
  });
});
