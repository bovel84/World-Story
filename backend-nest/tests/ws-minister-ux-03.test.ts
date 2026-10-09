/**
 * WS-MINISTER-UX-03 — La conversazione guida la tavola (contratto del prompt)
 * ==========================================================================
 * Il modello non riceve dati: riceve il permesso di **scegliere un riferimento**
 * di presentazione, in un formato delimitato, con l'elenco chiuso delle chiavi.
 * Il resolver (frontend) costruisce il blocco. Qui si difende il contratto lato
 * briefing: formato, vocabolario chiuso e divieto di HTML/JS/numeri/geometrie.
 */
import { describe, expect, it } from 'vitest';
import { briefingFor } from '../src/core/government/MinisterChat';
import { SEAT_LABEL, SEAT_READS, type CabinetAddress, type CabinetItem } from '../src/core/government/Cabinet';
import type { GovernmentAgenda } from '../src/core/government/GovernmentAgenda';

const emptyAgenda: GovernmentAgenda = { voices: [], headline: '', canonicalMutation: false };

const item: CabinetItem = {
  voiceId: 'debt_service',
  need: 'Coprire il disavanzo',
  because: 'Le uscite superano le entrate',
  urgency: 'critica',
  figures: [{ label: 'Fabbisogno', value: '12', unit: 'mld', basis: { kind: 'measured', source: 'conti nazionali' } }],
  paths: [{ id: 'a', title: 'Via A', detail: 'd', prerequisites: [], expected: 'e', recommended: true }],
};

const address = (seat: CabinetAddress['seat']): CabinetAddress => ({
  seat, label: SEAT_LABEL[seat], reads: SEAT_READS[seat], items: [item], opening: 'Apertura.',
});

describe('WS-MINISTER-UX-03 — contratto di presentazione nel briefing', () => {
  it('il briefing dichiara la sezione PRESENTAZIONE con il formato delimitato', () => {
    const briefing = briefingFor(address('tesoro'), emptyAgenda);
    expect(briefing.context).toContain('PRESENTAZIONE (la tavola');
    expect(briefing.context).toContain('```tavola');
    expect(briefing.context).toContain('{"op":"focus","evidence":"spesa"}');
  });

  it('il vocabolario è chiuso: op e chiavi di evidenza dichiarate', () => {
    const context = briefingFor(address('tesoro'), emptyAgenda).context;
    expect(context).toContain('show, focus, compare, annotate, dismiss');
    expect(context).toContain('spesa, trend, cifre, piano, mappa, idee');
  });

  it('vieta HTML, JavaScript, numeri, geometrie e chiavi extra nel blocco', () => {
    const context = briefingFor(address('tesoro'), emptyAgenda).context;
    // Il divieto riguarda tutti gli elementi, anche quando sono in una sola frase.
    expect(context).toMatch(/Nel blocco tavola: niente HTML, JavaScript, numeri o geometrie/);
    expect(context).toContain('Rispetta il protocollo e i limiti del parser esistenti');
    // La scelta non è un obbligo: se non serve, il blocco non si aggiunge.
    expect(context).toMatch(/PRESENTAZIONE \(la tavola, solo se serve\)/);
  });

  it('non introduce cifre nuove: la presentazione resta una scelta', () => {
    // Il contratto di presentazione non deve contenere numeri propri: ogni cifra
    // continua a venire dai fatti. Il blocco d'esempio non è un dato.
    const presentationSection = briefingFor(address('tesoro'), emptyAgenda).context
      .split('PRESENTAZIONE')[1]
      .split(/\n\[[A-Z ]+\]/)[0];
    expect(presentationSection).not.toMatch(/\d/);
  });

  it.each(Object.keys(SEAT_LABEL) as CabinetAddress['seat'][])('%s può richiedere la scheda con lo stesso protocollo, senza dichiararla già visibile', seat => {
    const context = briefingFor(address(seat), emptyAgenda).context;
    expect(context).toContain('La stessa direttiva show/focus mappa');
    expect(context).toContain('per qualsiasi sedia');
    expect(context).toContain('Una direttiva è una richiesta, non prova che la mappa sia visibile');
    expect(context).toContain('Non dire «La mappa conferma»');
    expect(context).toContain('ID canonici');
  });

  it('le regole dei dati restano intatte accanto alla presentazione', () => {
    const context = briefingFor(address('tesoro'), emptyAgenda).context;
    expect(context).toContain('un’opinione non è un dato');
    expect(context).toContain('il tuo profilo non ti autorizza a stimare');
    expect(context).toContain('Non impegni nulla');
  });
});
