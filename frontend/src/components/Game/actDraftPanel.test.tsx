/**
 * WS-MINISTER-UX-06 — render della bozza d'atto
 * ============================================
 * Difende il markup della decisione: capacità dichiarata, testo correggibile,
 * stato reale e firma esplicita. La firma è disabilitata quando l'atto è già in
 * coda: nessun atto duplicato.
 */
import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { ActDraftPanel } from './ActDraftPanel';
import { actStatus, type ProposalActDraft } from './actDraft';

const draft: ProposalActDraft = {
  id: 'tesoro:invest',
  seat: 'tesoro',
  roadId: 'invest',
  title: 'Investimento',
  text: 'Avviare il cantiere\n— Costruire: Scuola elementare',
  capability: 'engine-order',
  note: 'La distinta è coperta: il motore apre il cantiere e addebita la cassa all’esecuzione.',
  work: { workId: 'w_school', payerActorId: 'ITA', materialActorId: 'ITA', funded: true },
};

describe('ActDraftPanel', () => {
  it('mostra capacità, testo correggibile e la firma esplicita', () => {
    const html = renderToStaticMarkup(<ActDraftPanel draft={draft} status={actStatus(draft, [], [])} />);
    expect(html).toContain('Bozza d’atto');
    expect(html).toContain('ordine d’opera supportato');
    expect(html).toContain('La distinta è coperta');
    expect(html).toContain('Avviare il cantiere');
    expect(html).toContain('Testo dell’atto (modificabile dal Presidente)');
    expect(html).toContain('Firma e inserisci nel registro');
    expect(html).toContain('state-prepared');
  });

  it('una funzione assente lo dichiara e non promette il cantiere', () => {
    const unsupported: ProposalActDraft = { ...draft, capability: 'unsupported', note: 'Nessun comando supportato: registrare non produrrebbe l’effetto.', work: undefined };
    const html = renderToStaticMarkup(<ActDraftPanel draft={unsupported} status={actStatus(unsupported, [], [])} />);
    expect(html).toContain('funzione assente');
    expect(html).toContain('capability-unsupported');
    expect(html).toContain('non produrrebbe l’effetto');
  });

  it('un atto già in coda non si firma due volte', () => {
    const html = renderToStaticMarkup(
      <ActDraftPanel draft={draft} status={actStatus(draft, [{ id: 'a1', text: draft.text }], [])} />,
    );
    expect(html).toContain('Già nel registro');
    expect(html).toContain('state-queued');
    expect(html).toContain('disabled');
  });

  it('un esito respinto si legge «fallito», con la sua spiegazione', () => {
    const html = renderToStaticMarkup(
      <ActDraftPanel draft={draft} status={actStatus(draft, [], [{ turn: 3, action: draft.text, result: 'no', outcomeStatus: 'rejected' }])} />,
    );
    expect(html).toContain('state-failed');
    expect(html).toContain('non l’ha accolto');
  });
});
