/**
 * WS-GOVUX-P4 — La card dell'evidenza in linea (render)
 * =====================================================
 * Difende ciò che il giocatore vede nel dialogo:
 *  - una card **compatta sotto il messaggio**, con lo **stesso id** (`data-block-id`)
 *    e lo **stesso titolo** del blocco sulla tavola;
 *  - la card **non ridisegna** l'evidenza (nessun secondo grafico, nessun SVG);
 *  - il blocco `tavola` non compare mai come prosa;
 *  - senza un'evidenza reale (o senza gestore del clic) la card non si mostra.
 * Render statico, come gli altri test dei componenti.
 */
import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { MinisterChat } from './MinisterChat';
import type { EvidenceCardIndex } from './inlineEvidence';
import type { AdvisorHistoryItem, CabinetAddressView } from '../../services/api';

const address: CabinetAddressView = {
  seat: 'tesoro',
  label: 'Ministro del Tesoro',
  reads: 'Cassa, debito e bilancio',
  opening: 'La cassa regge, ma il margine si assottiglia.',
  items: [],
};

const index: EvidenceCardIndex = {
  spesa: { id: 'bilancio', title: 'Dove va il denaro', kind: 'chart' },
  piano: { id: 'piano', title: 'Il piano del Tesoro', kind: 'strategy' },
};

const render = (
  messages: AdvisorHistoryItem[],
  opts: { withIndex?: boolean; withFocus?: boolean } = {},
) => renderToStaticMarkup(
  <MinisterChat
    gameId="g1"
    address={address}
    messages={messages}
    streaming={false}
    onAddMessage={() => {}}
    onAppendToken={() => {}}
    onStreamingChange={() => {}}
    {...(opts.withIndex === false ? {} : { evidenceIndex: index })}
    {...(opts.withFocus === false ? {} : { onFocusEvidence: () => {} })}
  />,
);

const assistantWith = (fence: string): AdvisorHistoryItem => ({
  role: 'assistant',
  content: `Signor Presidente, ecco.\n\n\`\`\`tavola\n${fence}\n\`\`\``,
});

describe('P4 — la card dell’evidenza sotto il messaggio', () => {
  it('riferisce l’evidenza reale: stesso id e stesso titolo del blocco', () => {
    const html = render([
      { role: 'user', content: 'Mi mostri dove va la spesa?' },
      assistantWith('{"op":"focus","evidence":"spesa"}'),
    ]);
    expect(html).toContain('minister-evidence-card');
    expect(html).toContain('data-block-id="bilancio"');
    expect(html).toContain('data-kind="evidence"');
    expect(html).toContain('data-evidence="spesa"');
    expect(html).toContain('Dove va il denaro');
  });

  it('non è un secondo grafico: la card è un riferimento, non un disegno', () => {
    const html = render([
      { role: 'user', content: 'Mi mostri dove va la spesa?' },
      assistantWith('{"op":"focus","evidence":"spesa"}'),
    ]);
    const cardStart = html.indexOf('minister-evidence-card');
    const card = html.slice(cardStart, html.indexOf('</button>', cardStart));
    expect(card).not.toContain('<svg');
    expect(card).not.toContain('seat-canvas-block');
    expect(card).not.toContain('advisor-chart');
  });

  it('il blocco `tavola` non compare mai come prosa', () => {
    const html = render([
      { role: 'user', content: 'Mi mostri dove va la spesa?' },
      assistantWith('{"op":"focus","evidence":"spesa"}'),
    ]);
    expect(html).not.toContain('```');
    expect(html).not.toContain('"op"');
  });

  it('senza il gestore del clic la card non si mostra', () => {
    const html = render([
      { role: 'user', content: 'x' },
      assistantWith('{"op":"focus","evidence":"spesa"}'),
    ], { withFocus: false });
    expect(html).not.toContain('minister-evidence-card');
  });

  it('un’evidenza che la sedia non ha non produce una card fantasma', () => {
    const html = render([
      { role: 'user', content: 'x' },
      assistantWith('{"op":"focus","evidence":"trend"}'),
    ]);
    expect(html).not.toContain('minister-evidence-card');
  });

  it('il confronto è una card a parte', () => {
    const html = render([
      { role: 'user', content: 'Confronta le due strade' },
      assistantWith('{"op":"compare"}'),
    ]);
    expect(html).toContain('data-kind="comparison"');
    expect(html).toContain('data-block-id="comparison"');
    expect(html).toContain('Confronto');
  });

  it('due evidenze in un solo messaggio producono due card', () => {
    const html = render([
      { role: 'user', content: 'x' },
      {
        role: 'assistant',
        content: 'Ecco.\n```tavola\n{"op":"focus","evidence":"spesa"}\n```\n```tavola\n{"op":"focus","evidence":"piano"}\n```',
      },
    ]);
    expect(html).toContain('data-block-id="bilancio"');
    expect(html).toContain('data-block-id="piano"');
  });
});
