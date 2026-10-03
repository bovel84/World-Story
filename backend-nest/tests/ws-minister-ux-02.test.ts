/**
 * WS-MINISTER-UX-02 — Identità e voce del ministro
 * =================================================
 * Il ministro smette di essere un ripetitore di cifre e diventa **una persona
 * con un ruolo, una voce e delle priorità** — restando una fonte di
 * *interpretazione*, mai di *dati*.
 *
 * Le invarianti che questo file difende:
 *  - **profilo stabile per ogni sedia**: cinque tratti tipizzati, senza cifre e
 *    senza biografie storiche;
 *  - **voci riconoscibili**: due ministri, la stessa questione, contesti diversi
 *    (voce, priorità e firma di stile diverse);
 *  - **un'opinione non è un dato**: il profilo autorizza a raccomandare e
 *    argomentare, non a stimare; un `DATO MANCANTE` resta mancante;
 *  - **il rimando al collega non è secco**: nomina il collega e dice cosa
 *    guarderebbe lui, senza decidere al posto di chi ha la competenza;
 *  - **primo messaggio vero**: incarico + una o due questioni + invito a
 *    indicare la priorità; la riapertura non si ripresenta (continuità parziale,
 *    finché non c'è memoria persistente — UX-05).
 */
import { describe, expect, it } from 'vitest';
import { briefingFor, colleagueRedirect, ministerDossierFrom, openingMessage, seatForQuestion } from '../src/core/government/MinisterChat';
import { CABINET_SEATS, SEAT_LABEL, SEAT_READS, type CabinetAddress, type CabinetItem } from '../src/core/government/Cabinet';
import { MINISTER_PERSONAS, firstMessage, personaFor, personaSection } from '../src/core/government/MinisterPersona';
import type { GovernmentAgenda } from '../src/core/government/GovernmentAgenda';

const emptyAgenda: GovernmentAgenda = { voices: [], headline: '', canonicalMutation: false };

function item(voiceId: string, overrides: Partial<CabinetItem> = {}): CabinetItem {
  return {
    voiceId,
    need: `Bisogno ${voiceId}`,
    because: `Perché ${voiceId}`,
    urgency: 'ordinaria',
    figures: [
      { label: 'Misura', value: '1', unit: 'unità', basis: { kind: 'measured', source: 'motore' } },
    ],
    paths: [
      { id: 'a', title: 'Via A', detail: 'Dettaglio A', prerequisites: [], expected: 'Esito A', recommended: true },
      { id: 'b', title: 'Via B', detail: 'Dettaglio B', prerequisites: [], expected: 'Esito B', recommended: false },
    ],
    ...overrides,
  };
}

function address(seat: CabinetAddress['seat'], items: CabinetItem[]): CabinetAddress {
  return { seat, label: SEAT_LABEL[seat], reads: SEAT_READS[seat], items, opening: 'Apertura.' };
}

const traits = (seat: CabinetAddress['seat']): string[] => {
  const p = MINISTER_PERSONAS[seat];
  return [p.mandate, p.voice, p.priorities, p.risk, p.president, p.signature];
};

describe('WS-MINISTER-UX-02 — identità del ministro', () => {
  it('ogni sedia ha un profilo completo: incarico, voce, priorità, rischio, rapporto col Presidente', () => {
    for (const seat of CABINET_SEATS) {
      const p = MINISTER_PERSONAS[seat];
      expect(p.seat).toBe(seat);
      for (const trait of traits(seat)) {
        // Ogni tratto è una frase vera, non un segnaposto.
        expect(trait.trim().length).toBeGreaterThan(15);
      }
    }
  });

  it('il profilo non contiene cifre: non è una fonte di numeri', () => {
    // La guardia contro il falso verde: se un profilo introducesse un numero,
    // il modello potrebbe usarlo come dato. Qui si fissa che non accade.
    for (const seat of CABINET_SEATS) {
      expect(traits(seat).join(' ')).not.toMatch(/\d/);
      expect(personaSection(MINISTER_PERSONAS[seat])).not.toMatch(/\d/);
    }
  });

  it('ogni briefing porta il proprio profilo e la sua sezione', () => {
    for (const seat of CABINET_SEATS) {
      const briefing = briefingFor(address(seat, [item(`v_${seat}`)]), emptyAgenda);
      expect(briefing.context).toContain('[IDENTITY]');
      expect(briefing.context).toContain(personaFor(seat).mandate);
      expect(briefing.context).toContain(personaFor(seat).voice);
      expect(briefing.context).toContain(personaFor(seat).priorities);
    }
  });

  it('due ministri, la stessa questione: voce e priorità riconoscibili', () => {
    // La stessa voce di agenda per entrambe le sedie: cambia solo il profilo.
    const sameItem = item('condivisa', { need: 'Bisogno condiviso', because: 'Condizione condivisa' });
    const tesoro = briefingFor(address('tesoro', [sameItem]), emptyAgenda);
    const sanita = briefingFor(address('sanita', [sameItem]), emptyAgenda);
    // Il contesto non è lo stesso testo con un nome cambiato.
    expect(tesoro.context).not.toBe(sanita.context);
    // Ciascuna sedia porta la propria voce, le proprie priorità e la propria firma.
    expect(tesoro.context).toContain(MINISTER_PERSONAS.tesoro.voice);
    expect(tesoro.context).toContain(MINISTER_PERSONAS.tesoro.priorities);
    expect(tesoro.context).toContain(MINISTER_PERSONAS.tesoro.signature);
    expect(sanita.context).toContain(MINISTER_PERSONAS.sanita.voice);
    expect(sanita.context).toContain(MINISTER_PERSONAS.sanita.priorities);
    expect(sanita.context).toContain(MINISTER_PERSONAS.sanita.signature);
    // E non quella dell'altra.
    expect(tesoro.context).not.toContain(MINISTER_PERSONAS.sanita.voice);
    expect(tesoro.context).not.toContain(MINISTER_PERSONAS.sanita.signature);
    expect(sanita.context).not.toContain(MINISTER_PERSONAS.tesoro.voice);
    expect(sanita.context).not.toContain(MINISTER_PERSONAS.tesoro.signature);
  });
});

describe('WS-MINISTER-UX-02 — lettura, proposta e limiti del dato', () => {
  it('il briefing separa il dossier verificato dai livelli di ragionamento interni', () => {
    const briefing = briefingFor(address('tesoro', [item('debt_service')]), emptyAgenda);
    expect(briefing.context).toContain('[VERIFIED FACTS]');
    expect(briefing.context).toContain('[DIALOGUE STYLE]');
    expect(ministerDossierFrom(briefing.context)).toEqual({ seat: 'tesoro', issues: [item('debt_service')] });
    expect(briefing.context).toContain('Usa internamente fatti, interpretazione e consiglio');
    expect(briefing.context).toMatch(/NON mostrare.*FATTI \/ LETTURA \/ PROPOSTA/);
    expect(briefing.context).toContain('un’opinione non è un dato');
  });

  it('«aiutare le famiglie senza peggiorare il bilancio»: il Tesoro ragiona, non rinvia', () => {
    const question = 'Voglio aiutare le famiglie senza peggiorare troppo il bilancio.';
    // La domanda tocca il bilancio: è materia del Tesoro, non di un collega.
    expect(seatForQuestion(question)).toBe('tesoro');
    expect(colleagueRedirect('tesoro', question)).toBeNull();
    // Il contesto gli chiede di ragionare per livelli e di chiedere il dettaglio
    // che manca — non di rimbalzare.
    const briefing = briefingFor(address('tesoro', [item('debt_service')]), emptyAgenda);
    expect(briefing.context).toContain('Usa internamente fatti, interpretazione e consiglio');
    expect(briefing.context).toContain('Se serve un dato mancante, chiedi una sola cosa concreta');
    expect(briefing.context).toContain(personaFor('tesoro').voice);
  });

  it('il profilo non aggiunge cifre né trasforma un unknown in stima', () => {
    const withUnknown = item('debt_service', {
      need: 'Coprire il disavanzo',
      figures: [
        { label: 'Fabbisogno', value: '12', unit: 'mld', basis: { kind: 'measured', source: 'conti nazionali' } },
        { label: 'Copertura', value: '', unit: '', basis: { kind: 'unknown', missing: 'il credito non è stato letto' } },
      ],
    });
    const briefing = briefingFor(address('tesoro', [withUnknown]), emptyAgenda);
    // La cifra misurata c'è, col valore del motore.
    expect(ministerDossierFrom(briefing.context)?.issues[0].figures).toEqual([
      { label: 'Fabbisogno', value: '12', unit: 'mld', basis: { kind: 'measured', source: 'conti nazionali' } },
      { label: 'Copertura', value: '', unit: '', basis: { kind: 'unknown', missing: 'il credito non è stato letto' } },
    ]);
    // L'ignota resta ignota, e il profilo non la copre.
    expect(briefing.context).toContain('Copertura: DATO MANCANTE');
    expect(briefing.context).toContain('non lo sostituisci con una stima plausibile');
    expect(briefing.context).toContain('il tuo profilo non ti autorizza a stimare');
    // L'opinione è ammessa, ma dichiarata: non è mai un dato.
    expect(briefing.context).toContain('un’opinione non è un dato');
    expect(briefing.context).toContain('Non sei neutrale');
  });

  it('il rimando al collega non è più secco: dice cosa guarderebbe lui', () => {
    const redirect = colleagueRedirect('tesoro', 'Servono più cantieri per le fabbriche.');
    expect(redirect).toContain(SEAT_LABEL.lavori.replace(/^Ministro /, 'il ministro '));
    expect(redirect).toMatch(/Io .*finanziariamente.*margine.*conti/);
    expect(redirect).not.toMatch(/Non è la mia materia|se ne occupa|e legge/);
    // È una lettura finanziaria, non l'approvazione di un cantiere.
    expect(redirect).not.toMatch(/avvio|approvo|costruiamo|spendiamo/i);
  });

  it('il formato discorsivo regge anche con il profilo attivo', () => {
    const briefing = briefingFor(address('sanita', [item('health_condition')]), emptyAgenda);
    expect(briefing.context).toMatch(/racconta, non elencare/i);
    expect(briefing.context).toContain('Non sei neutrale');
    expect(briefing.context).toContain('dichiarale come tue');
  });
});

describe('WS-MINISTER-UX-02 — apertura e riapertura', () => {
  it('fallback: punto centrale, consiglio e domanda, senza recitare il dossier', () => {
    const items = [
      item('debt_service', { need: 'Coprire il disavanzo', because: 'Le uscite superano le entrate', urgency: 'critica' }),
      item('treasury_condition', { need: 'Rifinanziare una scadenza', because: 'Una tranche arriva a maturazione' }),
    ];
    const opening = openingMessage(briefingFor(address('tesoro', items), emptyAgenda), items);
    expect(opening).not.toContain(personaFor('tesoro').mandate);
    expect(opening).toContain('Coprire il disavanzo');
    expect(opening).not.toContain('Le uscite superano le entrate');
    expect(opening).toContain('Io verificherei');
    expect(opening).toContain('Vuoi che confrontiamo le coperture');
    expect(opening).not.toContain('Dimmi tu qual è la priorità');
  });

  it('il primo messaggio non è un elenco: al massimo due questioni', () => {
    const opening = firstMessage('lavori', [
      item('a', { need: 'Prima questione' }),
      item('b', { need: 'Seconda questione' }),
      item('c', { need: 'Terza questione' }),
    ]);
    expect(opening).toContain('Prima questione');
    expect(opening).not.toContain('Seconda questione');
    expect(opening).not.toContain('Terza questione');
  });

  it('una sedia senza bisogni non finge una preoccupazione', () => {
    const briefing = briefingFor(address('guerra', []), emptyAgenda);
    const opening = openingMessage(briefing, []);
    expect(briefing.hasNeeds).toBe(false);
    expect(opening).not.toContain(personaFor('guerra').mandate);
    expect(opening).toContain('non ho nulla da portare');
    expect(opening).toContain('Chiedimi quello che vuoi');
  });

  it('la riapertura non si ripresenta e riprende la decisione discussa', () => {
    const briefing = briefingFor(address('tesoro', [item('debt_service')]), emptyAgenda);
    expect(briefing.context).toContain('NON ripresentarti');
    expect(briefing.context).toContain('nel contesto dell’ultima decisione discussa');
    expect(briefing.context).toContain('NON RIPETERE ciò che hai appena detto');
  });
});
