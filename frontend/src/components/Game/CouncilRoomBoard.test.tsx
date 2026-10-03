import { describe, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { CouncilRoomBoard } from './CouncilRoomBoard';
import {
  confirmCouncilProposal, createCouncilRoom, type CouncilRoomState,
} from './councilRoom';
import { applyDecisionBatch } from './decisionWorkspace';
import { seatSpeaker } from './councilMeeting';

function roomWithProposal(): CouncilRoomState {
  const room = createCouncilRoom({ id: 'council-1', scopeKey: 'turn-1', initiatorMinister: 'lavori' });
  return {
    ...room,
    topic: 'Come collegare le regioni isolate?',
    participants: ['lavori', 'tesoro'],
    sharedBoard: applyDecisionBatch(room.sharedBoard, [
      { op: 'set-objective', objective: 'Collegare le regioni isolate', source: 'president' },
      { op: 'update-proposal', changes: [
        { label: 'Strade regionali', sharePct: 65, amount: 120, unit: 'milioni', source: 'minister' },
        { label: 'Priorità territoriale', value: 'Regioni montane', source: 'president' },
        { label: 'Cassa verificata', amount: 0, unit: 'milioni', source: 'engine' },
        { label: 'Tracciato ferroviario', status: 'unresolved', source: 'minister' },
        { label: 'Pedaggio', value: 'annuale', status: 'rejected', source: 'president' },
      ], unresolvedQuestions: ['Quali regioni servire per prime?'] },
    ], { messageId: 'proposal-1' }),
    assessments: {
      lavori: { agreements: ['Priorità alle regioni isolate'], disagreements: ['Tempi del cantiere da verificare'] },
      tesoro: { agreements: [], disagreements: ['Copertura da discutere'] },
    },
    invitations: [{ id: 'input-sanita', from: 'lavori', minister: 'sanita', question: 'Quali ospedali restano senza collegamenti?' }],
  };
}

function section(html: string, label: string): string {
  const content = html.match(new RegExp(`<section\\b[^>]*aria-label="${label}"[^>]*>([\\s\\S]*?)</section>`))?.[1];
  expect(content, `Sezione ${label}`).toBeDefined();
  return content!;
}

function button(html: string, label: string): string {
  const markup = html.match(new RegExp(`<button\\b[^>]*>${label}</button>`))?.[0];
  expect(markup, `Pulsante ${label}`).toBeDefined();
  return markup!;
}

function position(html: string, seat: string): string {
  const row = section(html, 'POSIZIONI').match(new RegExp(`<li\\b[^>]*data-seat="${seat}"[^>]*>[\\s\\S]*?</li>`))?.[0];
  expect(row, `Posizione ${seat}`).toBeDefined();
  return row!;
}

describe('CouncilRoomBoard — Tavola del Consiglio', () => {
  it('belongs to the shared question, not the initiating minister, and invents no proposal', () => {
    const room = createCouncilRoom({ id: 'empty', scopeKey: 'turn-1', initiatorMinister: 'sanita' });
    const html = renderToStaticMarkup(<CouncilRoomBoard room={room} onPrepare={() => {}} />);

    expect(html).toContain('aria-label="Tavola del Consiglio"');
    expect(html).toContain('class="council-room-board"');
    expect(html).not.toContain('La tavola della Sanità');
    expect(html.toLowerCase()).not.toContain('workspace');
    for (const label of ['QUESTIONE', 'PROPOSTA ATTUALE', 'ACCORDI DICHIARATI', 'QUESTIONI APERTE', 'POSIZIONI']) {
      expect(section(html, label)).toContain(label);
    }
    expect(section(html, 'QUESTIONE')).toContain('Questione da definire');
    expect(section(html, 'PROPOSTA ATTUALE')).toContain('Nessuna misura');
    expect(section(html, 'PROPOSTA ATTUALE')).not.toContain('<li');
    expect(html).not.toContain('Conferma proposta');
    expect(button(html, 'Prepara bozza comune')).toContain('disabled');
    expect(html).toContain('Nessuna misura definita');
  });

  it('renders only the live active shared proposal, including amounts, values, shares and provenance', () => {
    const room = roomWithProposal();
    const active = room.sharedBoard.proposals[0];
    room.sharedBoard = {
      ...room.sharedBoard,
      proposals: [{ ...active, id: 'old', measures: [{ ...active.measures[0], label: 'Vecchia proposta' }] }, active],
    };
    const html = renderToStaticMarkup(<CouncilRoomBoard room={room} />);
    const proposal = section(html, 'PROPOSTA ATTUALE');

    expect(section(html, 'QUESTIONE')).toContain(room.topic);
    for (const value of ['Strade regionali', '65%', '120 milioni', 'Regioni montane', '0 milioni', 'Tracciato ferroviario', 'Pedaggio']) {
      expect(proposal).toContain(value);
    }
    for (const value of ['proposta del ministro', 'scelta del Presidente', 'dato del motore', 'da definire', 'esclusa']) {
      expect(proposal).toContain(value);
    }
    expect(proposal).toContain('data-status="proposed"');
    expect(proposal).toContain('data-source="minister"');
    expect(proposal).not.toContain('Vecchia proposta');
  });

  it('reflects a new shared revision without preserving preset measures', () => {
    const room = roomWithProposal();
    const updated = {
      ...room,
      sharedBoard: applyDecisionBatch(room.sharedBoard, [{ op: 'update-proposal', changes: [
        { label: 'Strade regionali', sharePct: 75, source: 'minister' },
      ] }], { messageId: 'proposal-2' }),
    };
    const html = renderToStaticMarkup(<CouncilRoomBoard room={updated} />);

    expect(section(html, 'PROPOSTA ATTUALE')).toContain('75%');
    expect(section(html, 'PROPOSTA ATTUALE')).not.toContain('65%');
    expect(html).toContain(`revisione ${updated.sharedBoard.revision}`);
  });

  it('attributes declared agreements to their actual minister rather than asserting unanimous consensus', () => {
    const html = renderToStaticMarkup(<CouncilRoomBoard room={roomWithProposal()} />);
    const agreements = section(html, 'ACCORDI DICHIARATI');
    const declaration = agreements.match(/<li\b[^>]*>[\s\S]*?<\/li>/)?.[0];

    expect(declaration).toContain('Priorità alle regioni isolate');
    expect(declaration).toContain(seatSpeaker('lavori'));
    expect(declaration).not.toContain(seatSpeaker('tesoro'));
    expect(agreements).not.toMatch(/unanimità|tutti i ministri concordano|consenso del Consiglio/i);
  });

  it('keeps open questions and disagreements visible alongside explicitly requested unconsulted input', () => {
    const onConvene = vi.fn();
    const room = roomWithProposal();
    const html = renderToStaticMarkup(<CouncilRoomBoard room={room} onConvene={onConvene} />);
    const questions = section(html, 'QUESTIONI APERTE');

    expect(questions).toContain('Quali regioni servire per prime?');
    expect(questions).toContain('Tempi del cantiere da verificare');
    expect(questions).toContain('Copertura da discutere');
    expect(questions).toContain('Quali ospedali restano senza collegamenti?');
    expect(questions).toContain(seatSpeaker('sanita'));
    expect(questions).toContain(seatSpeaker('lavori'));
    expect(button(questions, `Convoca ${seatSpeaker('sanita')}`)).not.toContain('disabled');
    expect(html).not.toContain(`Convoca ${seatSpeaker('esteri')}`);
    expect(onConvene).not.toHaveBeenCalled();
    expect(room.participants).toEqual(['lavori', 'tesoro']);
  });

  it('does not offer to convene ministers who have already joined', () => {
    const room = roomWithProposal();
    room.participants = [...room.participants, 'sanita'];
    const html = renderToStaticMarkup(<CouncilRoomBoard room={room} onConvene={() => {}} />);

    expect(html).not.toContain(`Convoca ${seatSpeaker('sanita')}`);
    expect(section(html, 'QUESTIONI APERTE')).not.toContain('Quali ospedali restano senza collegamenti?');
  });

  it('presidential confirmation never erases open questions or means every minister agrees', () => {
    const room = confirmCouncilProposal(roomWithProposal(), 'president-confirmation');
    const html = renderToStaticMarkup(<CouncilRoomBoard room={room} onConfirm={() => {}} />);

    expect(html).not.toContain('Conferma proposta');
    expect(section(html, 'PROPOSTA ATTUALE')).toContain('data-status="accepted"');
    expect(section(html, 'PROPOSTA ATTUALE')).toContain('scelta del Presidente');
    expect(section(html, 'QUESTIONI APERTE')).toContain('Quali regioni servire per prime?');
    expect(section(html, 'QUESTIONI APERTE')).toContain('Copertura da discutere');
    expect(section(html, 'QUESTIONI APERTE')).toContain('Quali ospedali restano senza collegamenti?');
  });

  it('shows every participant’s position and reason, marking only older declared positions as needing an update', () => {
    const room = roomWithProposal();
    const revision = room.sharedBoard.revision;
    room.participants = ['lavori', 'tesoro', 'esteri', 'interno', 'istruzione'];
    room.positions = {
      lavori: { status: 'support', reason: 'Collegamenti necessari', revision: revision - 1 },
      tesoro: { status: 'conditional', reason: 'Serve una copertura certa', revision },
      esteri: { status: 'oppose', reason: 'Priorità agli scambi', revision },
      interno: { status: 'pending', reason: 'Attendo le regioni indicate', revision },
    };
    const html = renderToStaticMarkup(<CouncilRoomBoard room={room} />);

    for (const seat of room.participants) expect(position(html, seat)).toContain(seatSpeaker(seat));
    expect(position(html, 'lavori')).toContain('Favorevole');
    expect(position(html, 'lavori')).toContain('Collegamenti necessari');
    expect(position(html, 'lavori')).toContain('Da aggiornare');
    expect(position(html, 'lavori')).toContain(`revisione ${revision - 1}`);
    expect(position(html, 'tesoro')).toContain('Favorevole con condizioni');
    expect(position(html, 'tesoro')).toContain('Serve una copertura certa');
    expect(position(html, 'tesoro')).not.toContain('Da aggiornare');
    expect(position(html, 'esteri')).toContain('Contrario');
    expect(position(html, 'esteri')).toContain('Priorità agli scambi');
    expect(position(html, 'interno')).toContain('In attesa');
    expect(position(html, 'interno')).toContain('Attendo le regioni indicate');
    expect(position(html, 'istruzione')).toContain('In attesa');
    expect(position(html, 'istruzione')).toContain('Non ha ancora dichiarato una posizione');
    expect(position(html, 'istruzione')).not.toContain('Da aggiornare');
  });

  it.each([
    { canPrepare: true, busy: false, disabled: false },
    { canPrepare: false, busy: false, disabled: true },
    { canPrepare: true, busy: true, disabled: true },
    { canPrepare: false, busy: true, disabled: true },
  ])('gates explicit actions when canPrepare=$canPrepare and busy=$busy', ({ canPrepare, busy, disabled }) => {
    const onPrepare = vi.fn();
    const onConfirm = vi.fn();
    const onConvene = vi.fn();
    const html = renderToStaticMarkup(
      <CouncilRoomBoard room={roomWithProposal()} canPrepare={canPrepare} busy={busy}
        onPrepare={onPrepare} onConfirm={onConfirm} onConvene={onConvene} />,
    );

    expect(button(html, 'Prepara bozza comune').includes('disabled')).toBe(disabled);
    expect(button(html, 'Conferma proposta').includes('disabled')).toBe(busy);
    expect(button(html, `Convoca ${seatSpeaker('sanita')}`).includes('disabled')).toBe(busy);
    expect(onPrepare).not.toHaveBeenCalled();
    expect(onConfirm).not.toHaveBeenCalled();
    expect(onConvene).not.toHaveBeenCalled();
  });

  it('disables draft preparation with a reason when there are no draftable measures', () => {
    const room = roomWithProposal();
    room.sharedBoard = {
      ...room.sharedBoard,
      proposals: room.sharedBoard.proposals.map(proposal => ({
        ...proposal,
        measures: proposal.measures.filter(measure => measure.status === 'rejected' || measure.status === 'unresolved'),
      })),
    };
    const html = renderToStaticMarkup(<CouncilRoomBoard room={room} canPrepare onPrepare={() => {}} />);

    expect(button(html, 'Prepara bozza comune')).toContain('disabled');
    expect(html).toContain('Nessuna misura definita');
    expect(html).not.toContain('Conferma proposta');
  });

  it('keeps optional actions disabled without handlers and renders the parent’s act and evidence children', () => {
    const html = renderToStaticMarkup(
      <CouncilRoomBoard room={roomWithProposal()} canPrepare>
        <article aria-label="Atto comune">Bozza fornita dal Presidente</article>
        <details><summary>Evidenze del motore</summary>Cifre verificate</details>
      </CouncilRoomBoard>,
    );

    expect(button(html, 'Prepara bozza comune')).toContain('disabled');
    expect(button(html, 'Conferma proposta')).toContain('disabled');
    expect(button(html, `Convoca ${seatSpeaker('sanita')}`)).toContain('disabled');
    expect(html).toContain('aria-label="Atto comune"');
    expect(html).toContain('Bozza fornita dal Presidente');
    expect(html).toContain('<details><summary>Evidenze del motore</summary>Cifre verificate</details>');
  });
});
