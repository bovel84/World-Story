/**
 * WS-GOVUX-P1 — La schermata di scelta resa dall'agenda viva
 * =========================================================
 * Render statico (come gli altri test dei componenti): difende il contratto
 * della scelta — stato, frase, argomento, questioni, ripresa — e il fatto che
 * la sintesi mostrata venga dagli **stessi** record della lista.
 *
 * Non è uno snapshot: si verificano i fatti che il P0 aveva rilevato mancanti.
 */
import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { CabinetSession } from './CabinetSession';
import { deriveCouncilAgenda } from './councilAgenda';
import type { CabinetAddressView, CabinetSessionView } from '../../services/api';
import type { AdvisorMessage } from '../../stores/chatStore';

function item(urgency: 'ordinaria' | 'urgente' | 'critica', need: string): CabinetAddressView['items'][number] {
  return { voiceId: `v-${need}`, need, because: `perché ${need}`, urgency, figures: [], paths: [] };
}

const addresses: CabinetAddressView[] = [
  {
    seat: 'tesoro', label: 'Ministro del Tesoro', reads: 'bilancio, debito e cassa',
    opening: 'La cassa regge, ma il margine si assottiglia.',
    items: [item('critica', 'Coprire il disavanzo')],
  },
  {
    seat: 'lavori', label: 'Ministro dei Lavori', reads: 'cantieri e opere',
    opening: 'Il cantiere è fermo.',
    items: [item('ordinaria', 'Sbloccare il cantiere')],
  },
];

const session: CabinetSessionView = {
  addresses,
  president: { opening: 'Il consiglio è riunito.', closing: 'Seduta chiusa.' },
  summary: { total: 2, critical: 1 },
  canonicalMutation: false,
};

const thread: AdvisorMessage[] = [
  { role: 'user', content: 'Parliamo del cantiere' },
  { role: 'assistant', content: 'Serve acciaio.' },
];

describe('WS-GOVUX-P1 — la scelta mostra l’agenda viva', () => {
  const agenda = deriveCouncilAgenda({ session, threads: { lavori: thread }, memory: {} });
  const html = renderToStaticMarkup(
    <CabinetSession variant="pick" session={session} agenda={agenda} onOpenSeat={() => {}} />,
  );

  it('mostra la sintesi, contata sugli stessi record della lista', () => {
    expect(html).toContain('2 ministri');
    expect(html).toContain('1 richiede attenzione');
    expect(html).toContain('1 discussione aperta');
    expect(html).toContain('2 questioni sul tavolo');
    // La sintesi è un record della lista, non un numero a sé.
    expect(html).toContain('data-state="richiede-attenzione"');
    expect(html).toContain('data-state="discussione-aperta"');
  });

  it('ogni ministro porta stato, frase, argomento e questioni', () => {
    expect(html).toContain('Ministro del Tesoro');
    expect(html).toContain('La cassa regge, ma il margine si assottiglia.');
    expect(html).toContain('Sul tavolo: Coprire il disavanzo');
    expect(html).toContain('Ministro dei Lavori');
    expect(html).toContain('Sbloccare il cantiere');
  });

  it('una sedia con un colloquio avviato invita a riprenderlo', () => {
    expect(html).toContain('Riprendi il colloquio');
    expect(html).toContain('2 scambi');
  });

  it('l’ordine è quello dichiarato: il Tesoro precede i Lavori', () => {
    expect(html.indexOf('data-seat="tesoro"')).toBeLessThan(html.indexOf('data-seat="lavori"'));
  });

  it('senza agenda resta la scelta storica (retro-compatibile)', () => {
    const legacy = renderToStaticMarkup(<CabinetSession variant="pick" session={session} onOpenSeat={() => {}} />);
    expect(legacy).toContain('Ministro del Tesoro');
    expect(legacy).toContain('Ministro dei Lavori');
    // Nessuno stato inventato quando l'agenda non viene fornita.
    expect(legacy).not.toContain('council-state');
  });
});
