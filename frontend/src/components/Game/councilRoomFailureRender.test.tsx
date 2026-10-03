/**
 * P0.2 / P0.4 — Un guasto tecnico non è un intervento del ministro.
 * ================================================================
 * La Sala del Consiglio mostra un errore operativo con il retry del solo
 * ministro fallito; non appare mai la vecchia frase hard-coded
 * «Non riesco ora a valutare gli interventi dei colleghi…».
 */
import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { CouncilRoomView } from './CouncilRoomView';
import { createCouncilRoom } from './councilRoom';
import type { CabinetSeat } from './seatDecisionBoards';

const room = createCouncilRoom({ id: 'room-1', scopeKey: 'scope', initiatorMinister: 'tesoro' });

const base = {
  room,
  evidenceIndex: {},
  onFocusEvidence: () => {},
  nationalName: 'Italia',
  isMobile: false,
  busy: false,
  speaking: null,
  streamText: '',
  input: '',
  target: 'council' as CabinetSeat | 'council',
  onInput: () => {},
  onTarget: () => {},
  onSend: () => {},
  onInterrupt: () => {},
  onConvene: () => {},
  onBack: () => {},
  onClose: () => {},
  onConclude: () => {},
  onSheetChange: () => {},
  board: null,
  draftPrepared: false,
};

describe('CouncilRoomView — errore operativo e retry', () => {
  it('mostra l’avviso e il retry del ministro fallito, mai una posizione inventata', () => {
    const html = renderToStaticMarkup(<CouncilRoomView {...base} failure={{ seat: 'guerra' }} onRetry={() => {}} />);
    expect(html).toContain('Il Ministro della Guerra non riesce a intervenire in questo momento.');
    expect(html).toContain('Riprova Guerra');
    expect(html).toContain('council-room-failure');
    expect(html).not.toContain('Non riesco ora a valutare gli interventi dei colleghi');
    expect(html).not.toContain('preferisce non pronunciarsi');
    // L'errore non è un intervento: nessun messaggio assistant.
    expect(html).not.toContain('council-room-message assistant');
  });

  it('senza guasto non c’è alcun blocco di errore', () => {
    const html = renderToStaticMarkup(<CouncilRoomView {...base} />);
    expect(html).not.toContain('council-room-failure');
    expect(html).not.toContain('non riesce a intervenire');
  });

  it('il composer parte da una riga sola (leggibilità desktop)', () => {
    const html = renderToStaticMarkup(<CouncilRoomView {...base} />);
    expect(html).toContain('rows="1"');
    expect(html).toContain('Messaggio del Presidente');
  });
});
