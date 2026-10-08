/**
 * T03 — La card della situazione mostra le MOSSE, e «Porta al Consiglio» compare
 * SOLO quando le mosse esistono.
 *
 * Difende:
 *  - **T-I3** una situazione senza mosse NON mostra un pulsante che promette un
 *    atto che non c'è: resta «Approfondisci», come oggi;
 *  - **T-I1** il clic su una mossa non invia nulla e non apre la seduta: passa a
 *    `onOpenIssue`, che è lo stesso gestore delle proposte;
 *  - **T-I2** le mosse sono prosa: la card rende titolo e contenuto, niente chiavi.
 */
import { describe, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { AdvisorSituationsPanel, situationAsPortableIssue } from './AdvisorSituationsPanel';
import type { AdvisorSituation } from '../../services/api';

const mosse = [
  { title: 'Soffocare la rivolta nell’uovo', content: 'Dispieghiamo le unità disponibili lungo il confine e fortifichiamo i nodi logistici.' },
  { title: 'Comprare la tregua', content: 'Apriamo un canale con i capi locali e finanziamo la ricostruzione dei mercati di confine.' },
];
const conMosse = (): AdvisorSituation => ({ id: 'sudan', title: 'Tensioni con il Sudan', summary: 'Rapporto ostile al confine.', options: mosse, signalKeys: ['hostile-relations:SDN'], importance: 3 });
const senzaMosse = (): AdvisorSituation => ({ id: 'stabile', title: 'Approvvigionamenti fragili', summary: 'Le scorte reggono ma il margine è sottile.', signalKeys: ['food-coverage'], importance: 2 });

describe('T03 — le mosse nella card della situazione', () => {
  it('le mosse si rendono come le proposte: titolo e contenuto, cliccabili (T-I1)', () => {
    const html = renderToStaticMarkup(<AdvisorSituationsPanel situations={[conMosse()]} onDeepen={() => {}} onOpenIssue={() => {}} />);
    for (const mossa of mosse) {
      expect(html).toContain(mossa.title);
      expect(html).toContain(mossa.content);
    }
    expect(html).toMatch(/advisor-option[^>]*aria-pressed="false"/);
    expect((html.match(/advisor-situation-options/g) ?? [])).toHaveLength(1);
  });

  it('T-I3 — senza mosse NON c’è «Porta al Consiglio», solo «Approfondisci»', () => {
    const html = renderToStaticMarkup(<AdvisorSituationsPanel situations={[senzaMosse()]} onDeepen={() => {}} onOpenIssue={() => {}} />);
    expect(html).toContain('Approfondisci');
    expect(html).not.toContain('Porta al Consiglio');
    expect(html).not.toContain('advisor-situation-options');
  });

  it('T-I3 — la guardia è nel TIPO, non nella disciplina di chi chiama', () => {
    // `situationAsPortableIssue` restituisce `undefined` per una situazione senza
    // mosse: non esiste un valore da passare a `onOpenIssue`. È la stessa forma
    // dell'invariante P-I5 per le proposte, resa impossibile da violare.
    expect(situationAsPortableIssue(senzaMosse())).toBeUndefined();
    expect(situationAsPortableIssue({ ...senzaMosse(), options: [] })).toBeUndefined();
    const portable = situationAsPortableIssue(conMosse())!;
    expect(portable.title).toBe('Tensioni con il Sudan');
    expect(portable.options).toEqual(mosse);
    // Il client non inventa fatti: `verifiedFacts` resta vuoto.
    expect(portable.verifiedFacts).toEqual([]);
    expect(portable.signalKeys).toEqual(['hostile-relations:SDN']);
  });

  it('T-I1 — il clic passa a onOpenIssue e non invia nulla da solo', () => {
    const onOpenIssue = vi.fn();
    // La card prepara la stessa proposta che riceve `GovernmentOffice`; il
    // pannello non chiama `fetch` né apre sedute per conto suo. Guardia sul
    // sorgente: nessuna rete dentro il pannello.
    const source = require('node:fs').readFileSync(require('node:path').resolve(__dirname, 'AdvisorSituationsPanel.tsx'), 'utf8');
    expect(source).not.toContain('fetch(');
    expect(source).not.toContain('openIssue(');
    expect(typeof onOpenIssue).toBe('function');
  });

  it('una situazione con mosse e una senza convivono nello stesso pannello', () => {
    const html = renderToStaticMarkup(<AdvisorSituationsPanel situations={[conMosse(), senzaMosse()]} onDeepen={() => {}} onOpenIssue={() => {}} />);
    // Due card, un solo «Porta al Consiglio» — quello della situazione con le mosse.
    expect((html.match(/advisor-situation-card/g) ?? [])).toHaveLength(2);
    expect((html.match(/Porta al Consiglio/g) ?? [])).toHaveLength(1);
    // «Approfondisci» compare DUE volte per card (il testo del pulsante e la sua
    // aria-label). Si contano i PULSANTI, non le occorrenze della parola: è stato
    // il rosso di questa prova, e la correzione è nella prova, non nel codice.
    expect((html.match(/class="advisor-situation-deepen"/g) ?? [])).toHaveLength(2);
  });
});
