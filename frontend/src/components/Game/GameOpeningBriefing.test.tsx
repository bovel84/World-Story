/**
 * WS-GAME-OPENING — le cinque pagine esistono e le porte sono ingressi, non missioni.
 */
import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { OpeningPanelContent } from './GameOpeningBriefing';
import type { GameOpeningBriefing as OpeningData } from './openingBriefing';

const opening: OpeningData = {
  world: { name: 'Millennium Dawn', date: '2000-01-01', dateLabel: '1 GENNAIO 2000', paragraphs: ['La Guerra Fredda è finita.'] },
  nation: { name: 'Bosnia ed Erzegovina', identity: 'Il paese eredita problemi aperti.', readings: [{ key: 'economy', label: 'Economia', value: 'Fragile', tone: 'warning' }], neighbors: [{ id: 'srb', name: 'Serbia', relation: 'Rapporto teso', tone: 'warning' }] },
  inheritedSituation: [{ id: 'infra', symbol: 'problem', label: 'Ricostruzione incompleta' }],
  worldAroundYou: [{ id: 'srb', name: 'Serbia', relation: 'Rapporto teso', tone: 'warning' }],
  firstQuestions: [{ id: 'infra', label: 'Ricostruzione incompleta' }],
  council: [{ seat: 'lavori', label: 'Ministro dei Lavori', line: 'Ditemi dove e io vi dico cosa serve per partire.' }],
  entryPoints: [
    { id: 'orders', label: 'Governo', icon: '🏛' },
    { id: 'map', label: 'Mappa', icon: '🗺' },
    { id: 'advisor', label: 'Consigliere', icon: '✦' },
  ],
};

const render = (page: number) => renderToStaticMarkup(
  <OpeningPanelContent briefing={opening} onFinish={() => {}} onSkip={() => {}} initialPage={page} />,
);

describe('WS-GAME-OPENING — GameOpeningBriefing', () => {
  it('rende le cinque pagine discrete, senza step-wizard', () => {
    expect(render(0)).toContain('IL MONDO');
    expect(render(1)).toContain('IL PAESE');
    expect(render(2)).toContain('IL QUADRO');
    expect(render(3)).toContain('IL CONSIGLIO');
    expect(render(4)).toContain('ORA TOCCA A TE');
    const html = render(0);
    expect(html).not.toContain('Step 1');
    expect(html).not.toContain('Skip tutorial');
  });

  it('l’ultima pagina offre le tre porte e l’ingresso diretto', () => {
    const html = render(4);
    expect(html).toContain('Governo');
    expect(html).toContain('Mappa');
    expect(html).toContain('Consigliere');
    expect(html).toContain('Entra direttamente nella partita');
    expect(html).toContain('Non esiste una strada obbligata');
  });

  it('mostra problemi e opportunità con simboli distinti', () => {
    const html = render(2);
    expect(html).toContain('opening-symbol-problem');
    expect(html).toContain('Ricostruzione incompleta');
  });

  it('il consiglio mette una sola coppia di virgolette (niente ««»»)', () => {
    const html = render(3);
    expect(html).toContain('«Ditemi dove e io vi dico cosa serve per partire.»');
    expect(html).not.toContain('««');
    expect(html).not.toContain('»»');
  });
});
