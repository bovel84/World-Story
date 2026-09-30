/**
 * WS-MINISTER-UX-04 — La mappa focalizzata: il contratto dei riferimenti
 * ======================================================================
 * La fase UX-03 aveva aperto il blocco di presentazione. UX-04 aggiunge il caso
 * della **mappa**: il ministro può indicare gli `id` delle zone da mettere in
 * evidenza. Sono riferimenti, non geometrie: il path resta quello del read model.
 * Qui si difende la riga del briefing, accanto ai divieti già in vigore.
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

const address: CabinetAddress = {
  seat: 'tesoro', label: SEAT_LABEL.tesoro, reads: SEAT_READS.tesoro, items: [item], opening: 'Apertura.',
};

describe('WS-MINISTER-UX-04 — regionIds nel contratto di presentazione', () => {
  it('il briefing consente di indicare le zone con regionIds, come riferimento', () => {
    const context = briefingFor(address, emptyAgenda).context;
    expect(context).toContain('regionIds');
    expect(context).toContain('"regionIds":["ALPHA"]');
    expect(context).toContain('gli id');
  });

  it('restano i divieti: nessuna geometria, HTML, JavaScript o numero nel blocco', () => {
    const presentation = briefingFor(address, emptyAgenda).context
      .split('PRESENTAZIONE')[1]
      .split('I TUOI COLLEGHI')[0];
    expect(presentation).toContain('niente HTML');
    expect(presentation).toContain('niente geometrie');
    // La sezione non porta cifre proprie: l'esempio di regionIds usa un id, non un numero.
    expect(presentation).not.toMatch(/\d/);
  });

  it('le regole dei dati restano intatte', () => {
    const context = briefingFor(address, emptyAgenda).context;
    expect(context).toContain('un’opinione non è un dato');
    expect(context).toContain('il tuo profilo non ti autorizza a stimare');
  });
});
