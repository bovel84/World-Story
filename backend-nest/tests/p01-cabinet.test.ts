/**
 * P01 — Il gabinetto: un ministro senza dati tace
 * ==============================================
 * L'autore ha chiesto «le persone che chattano con me e propongono i loro piani
 * e bisogni». Un gabinetto è un rischio preciso — inventare personalità che
 * dicono cose che il motore non sa — e questo file difende la regola che lo
 * evita: **un ministro non è una fonte di dati, è una proiezione dello stato
 * per competenza.**
 *
 * Le regole che i test difendono:
 *  - **un ministro senza dati NON compare**: il Tesoro parla se c'è tensione di
 *    bilancio o debito, i Lavori se c'è un cantiere o un'opera. Niente sedie
 *    riempite di frasi di circostanza;
 *  - **un paese senza problemi ha una seduta VUOTA**, e il presidente lo dice;
 *  - **ogni cifra arriva dall'agenda con la sua provenienza**: il gabinetto non
 *    aggiunge numeri, li distribuisce per competenza;
 *  - **nessuno impegna nulla**: `canonicalMutation: false` sempre.
 *
 * Guardia contro il falso verde: si verifica anche il caso opposto — con i dati
 * giusti il ministro DEVE comparire. Senza quel controllo, un gabinetto che non
 * parla mai passerebbe tutti i test.
 */
import { describe, expect, it } from 'vitest';
import {
  CABINET_SEATS, SEAT_LABEL, SEAT_READS, composeCabinet, seatOfVoice, voicesForSeat,
} from '../src/core/government/Cabinet';
import type { GovernmentAgenda, GovernmentVoice } from '../src/core/government/GovernmentAgenda';

/** Una voce minima, con la sua cifra misurata. */
function voice(id: string, urgency: GovernmentVoice['urgency'] = 'ordinaria'): GovernmentVoice {
  return {
    id,
    need: `Bisogno ${id}`,
    because: `La condizione che l’ha fatto emergere: ${id}`,
    urgency,
    factionId: id.startsWith('faction_') ? id.replace('faction_', '') : null,
    figures: [{ label: 'Misura', value: '1', unit: 'unità', basis: { kind: 'measured', source: 'motore' } }],
    paths: [
      { id: 'a', title: 'Via A', detail: 'Dettaglio A', prerequisites: [], expected: 'Esito A', recommended: true },
      { id: 'b', title: 'Via B', detail: 'Dettaglio B', prerequisites: [], expected: 'Esito B', recommended: false },
    ],
  };
}

const agenda = (voices: GovernmentVoice[]): GovernmentAgenda => ({
  voices,
  headline: `${voices.length} voci`,
  canonicalMutation: false,
});

describe('P01 — il gabinetto dei ministri', () => {
  it('un paese senza problemi ha una seduta VUOTA, e il presidente lo dice', () => {
    const session = composeCabinet(agenda([]));
    expect(session.addresses).toEqual([]);
    expect(session.summary).toEqual({ total: 0, critical: 0 });
    expect(session.president.opening).toContain('nulla sul tavolo');
    expect(session.president.closing).toContain('senza delibere');
    // E non impegna nulla, come sempre.
    expect(session.canonicalMutation).toBe(false);
  });

  it('un ministro SENZA dati non compare: la sedia resta vuota', () => {
    // Il caso che rende onesto il gabinetto: c'è una voce dei Lavori, e il
    // Tesoro — che non ha nulla da dire — non occupa una sedia.
    const session = composeCabinet(agenda([voice('deficit_MATERIAL_SHORTAGE_steel', 'critica')]));
    const seats = session.addresses.map(address => address.seat);
    expect(seats).toEqual(['lavori']);
    expect(seats).not.toContain('tesoro');
    expect(seats).not.toContain('guerra');
  });

  it('con i dati giusti il ministro COMPARE: il gabinetto non tace per partito preso', () => {
    // Il controllo opposto, senza il quale un gabinetto muto passerebbe tutto.
    const session = composeCabinet(agenda([
      voice('debt_service', 'critica'),
      voice('faction_operai', 'urgente'),
      voice('build_w_road'),
    ]));
    const seats = session.addresses.map(address => address.seat);
    expect(seats).toContain('tesoro');
    expect(seats).toContain('interno');
    expect(seats).toContain('lavori');
  });

  it('ogni sedia dichiara che cosa legge: la competenza non è implicita', () => {
    const session = composeCabinet(agenda([voice('debt_service')]));
    for (const address of session.addresses) {
      expect(SEAT_READS[address.seat]).toBeTruthy();
      expect(address.reads).toBe(SEAT_READS[address.seat]);
      expect(address.label).toBe(SEAT_LABEL[address.seat]);
    }
    // E le sedie sono un elenco chiuso: nessuna competenza inventata.
    // WS-GOVOFFICE-05 — sette sedie: le cinque storiche più Istruzione e
    // Sanità, con la loro competenza dichiarata. L'elenco resta chiuso.
    expect(CABINET_SEATS).toHaveLength(7);
    expect([...CABINET_SEATS]).toEqual(['tesoro', 'lavori', 'istruzione', 'sanita', 'esteri', 'interno', 'guerra']);
  });

  it('le cifre arrivano dall’agenda con la loro provenienza: nessun numero nuovo', () => {
    const session = composeCabinet(agenda([voice('deficit_MATERIAL_SHORTAGE_steel')]));
    const item = session.addresses[0].items[0];
    // La cifra è quella della voce, con la sua origine dichiarata.
    expect(item.figures[0].basis).toEqual({ kind: 'measured', source: 'motore' });
    // E le strade sono quelle dell'agenda, non inventate qui.
    expect(item.paths.map(path => path.id)).toEqual(['a', 'b']);
  });

  it('una voce con provenienza IGNOTA resta ignota nel gabinetto', () => {
    // Il ministro non arrotonda e non deduce: se il dato manca, lo dice.
    const unknown: GovernmentVoice = {
      ...voice('build_w_port'),
      figures: [{ label: 'Costo', value: '', unit: '', basis: { kind: 'unknown', missing: 'prezzo non dichiarato dal catalogo' } }],
    };
    const session = composeCabinet(agenda([unknown]));
    const figure = session.addresses[0].items[0].figures[0];
    expect(figure.basis.kind).toBe('unknown');
    if (figure.basis.kind === 'unknown') expect(figure.basis.missing).toContain('non dichiarato');
  });

  it('la seduta si apre con la sintesi: quante questioni, quante bloccanti', () => {
    const session = composeCabinet(agenda([
      voice('deficit_MATERIAL_SHORTAGE_steel', 'critica'),
      voice('debt_service', 'urgente'),
      voice('build_w_road', 'ordinaria'),
    ]));
    expect(session.summary).toEqual({ total: 3, critical: 1 });
    expect(session.president.opening).toContain('3 questioni');
    expect(session.president.opening).toContain('1 bloccante');
    // E chiude ricordando che nulla è stato impegnato: è la promessa del piano.
    expect(session.president.closing).toContain('Nessuna di queste proposte impegna');
  });

  it('l’ordine delle sedie mette i fatti prima delle opinioni', () => {
    // Un deficit materiale (fatto) viene prima di una fazione scontenta
    // (opinione): è l'ordine in cui il paese li sente.
    const session = composeCabinet(agenda([
      voice('faction_operai', 'critica'),
      voice('deficit_MATERIAL_SHORTAGE_steel', 'critica'),
    ]));
    expect(session.addresses.map(address => address.seat)).toEqual(['lavori', 'interno']);
  });

  it('la competenza di una voce la decide il suo TIPO, non il suo testo', () => {
    // Se la competenza dipendesse dal testo, un ordine scritto male cambierebbe
    // chi lo porta in consiglio. Il test lo fissa.
    expect(seatOfVoice(voice('deficit_INSUFFICIENT_CASH_TEST'))).toBe('tesoro');
    expect(seatOfVoice(voice('deficit_MATERIAL_SHORTAGE_steel'))).toBe('lavori');
    expect(seatOfVoice(voice('debt_service'))).toBe('tesoro');
    expect(seatOfVoice(voice('faction_operai'))).toBe('interno');
    expect(seatOfVoice(voice('build_w_road'))).toBe('lavori');
  });

  it('ogni sedia riceve solo le voci che le competono', () => {
    const all = agenda([
      voice('debt_service'), voice('faction_operai'), voice('build_w_road'),
      voice('deficit_MATERIAL_SHORTAGE_steel'),
    ]);
    expect(voicesForSeat('tesoro', all).map(v => v.id)).toEqual(['debt_service']);
    expect(voicesForSeat('interno', all).map(v => v.id)).toEqual(['faction_operai']);
    expect(voicesForSeat('lavori', all).map(v => v.id)).toEqual(['build_w_road', 'deficit_MATERIAL_SHORTAGE_steel']);
    // E una sedia senza voci non compare nella seduta.
    expect(voicesForSeat('guerra', all)).toEqual([]);
  });

  it('la frase di apertura di un ministro dice quante cose porta', () => {
    const session = composeCabinet(agenda([
      voice('debt_service', 'critica'),
      voice('deficit_MATERIAL_SHORTAGE_steel', 'critica'),
    ]));
    const tesoro = session.addresses.find(address => address.seat === 'tesoro')!;
    expect(tesoro.opening).toContain('1 cosa');
    expect(tesoro.opening).toContain('urgente');
    // Il plurale è corretto quando le cose sono più d'una.
    const lavori = session.addresses.find(address => address.seat === 'lavori')!;
    expect(lavori.opening).toContain('1 cosa');
  });
});

/**
 * WS-GOVOFFICE-05B — «Ho 1 cosa», non «Ho l cosa»
 * ================================================
 * Il conteggio è un **numero**: con una cosa il singolare, con più d'una il
 * plurale. La frase nasce in `openingFor` da un'interpolazione numerica
 * (`${count}`), quindi nel codice la cifra c'è sempre; qui si fissa perché il
 * comportamento non possa cambiare e nessuna «l» (maiuscola o minuscola) prenda
 * il posto di una cifra.
 */
describe('WS-GOVOFFICE-05B — la frase d’apertura', () => {
  it('singolare esatto con una cosa sola', () => {
    const session = composeCabinet(agenda([voice('debt_service', 'critica')]));
    const tesoro = session.addresses.find(address => address.seat === 'tesoro')!;
    expect(tesoro.opening).toBe('Ho 1 cosa da portare al consiglio, 1 urgente.');
  });

  it('plurale esatto con più cose', () => {
    const session = composeCabinet(agenda([
      voice('debt_service', 'critica'),
      voice('treasury_condition', 'ordinaria'),
    ]));
    const tesoro = session.addresses.find(address => address.seat === 'tesoro')!;
    expect(tesoro.opening).toBe('Ho 2 cose da portare al consiglio, 1 urgente.');
  });

  it('nessuna «l» al posto di una cifra, mai', () => {
    const session = composeCabinet(agenda([
      voice('debt_service', 'critica'),
      voice('treasury_condition', 'ordinaria'),
    ]));
    // La frase comincia sempre con un numero, non con una lettera.
    expect(session.addresses[0].opening).toMatch(/^Ho \d+ cos/);
    for (const address of session.addresses) {
      // Nessuna «l» isolata (le «l» di «consiglio»/«al» non sono isolate).
      expect(address.opening).not.toMatch(/\bl\b/i);
    }
  });

  it('i valori pieni del motore restano INTATTI: la resa non li tocca', () => {
    // La formattazione (virgola, 2 decimali) vive solo nella VISTA: il
    // gabinetto distribuisce la cifra così com'è, senza arrotondarla.
    const raw = '0.06575272084693667';
    const session = composeCabinet(agenda([{
      ...voice('treasury_condition'),
      figures: [{
        label: 'Saldo di bilancio',
        value: raw,
        unit: 'mld',
        basis: { kind: 'measured', source: 'conti nazionali' },
      }],
    }]));
    const tesoro = session.addresses.find(address => address.seat === 'tesoro')!;
    expect(tesoro.items[0].figures[0].value).toBe(raw);
    // Il valore attraversa il gabinetto senza diventare una stringa «italiana».
    expect(tesoro.items[0].figures[0].value).not.toContain(',');
  });
});

/**
 * WS-GOVOFFICE-05 — Le due sedie nuove: Istruzione e Sanità
 * ==========================================================
 * L'autore ha chiesto «più ministri». Le due sedie nuove obbediscono alla stessa
 * regola delle cinque storiche: compaiono **quando e solo quando** l'agenda ha la
 * loro voce. Qui si difendono tre cose, e la terza è la più importante:
 *
 *  - Istruzione e Sanità compaiono con la loro voce, con l'etichetta giusta;
 *  - senza la voce **tacciono** — non occupano una sedia a vuoto;
 *  - `seatOfVoice` assegna le due voci nuove **senza riassegnare** le esistenti:
 *    deficit, opere, fazioni, Tesoro, Guerra restano dove sono.
 */
describe('WS-GOVOFFICE-05 — Istruzione e Sanità nel gabinetto', () => {
  it('Istruzione COMPARE quando la sua voce è in agenda', () => {
    const session = composeCabinet(agenda([voice('education_condition')]));
    expect(session.addresses.map(address => address.seat)).toEqual(['istruzione']);
    expect(session.addresses[0].label).toBe('Ministro dell’Istruzione');
    // La competenza è quella dichiarata, con la spesa e la tensione sociale.
    expect(session.addresses[0].reads).toBe(SEAT_READS.istruzione);
    expect(session.addresses[0].reads).toContain('istruzione e ricerca');
  });

  it('Sanità COMPARE quando la sua voce è in agenda', () => {
    const session = composeCabinet(agenda([voice('health_condition')]));
    expect(session.addresses.map(address => address.seat)).toEqual(['sanita']);
    expect(session.addresses[0].label).toBe('Ministro della Sanità');
    // Onestà del dato: la competenza dichiara che la spesa è sanità + sostegno.
    expect(session.addresses[0].reads).toBe(SEAT_READS.sanita);
    expect(session.addresses[0].reads).toContain('sanità e sostegno');
  });

  it('senza la voce, la sedia TACE: non compare a vuoto', () => {
    // Con Istruzione in agenda, la Sanità — che non ha voce — non occupa una sedia.
    const session = composeCabinet(agenda([voice('education_condition')]));
    expect(session.addresses.map(address => address.seat)).not.toContain('sanita');
    // E viceversa.
    const onlyHealth = composeCabinet(agenda([voice('health_condition')]));
    expect(onlyHealth.addresses.map(address => address.seat)).not.toContain('istruzione');
  });

  it('seatOfVoice assegna le voci nuove SENZA riassegnare le esistenti', () => {
    // Le due voci nuove hanno la loro sedia.
    expect(seatOfVoice(voice('education_condition'))).toBe('istruzione');
    expect(seatOfVoice(voice('health_condition'))).toBe('sanita');
    // Regressione: le voci esistenti restano esattamente dove erano.
    expect(seatOfVoice(voice('deficit_MATERIAL_SHORTAGE_steel'))).toBe('lavori');
    expect(seatOfVoice(voice('deficit_WORKFORCE_SHORTAGE_x'))).toBe('lavori');
    expect(seatOfVoice(voice('deficit_INSUFFICIENT_CASH_x'))).toBe('tesoro');
    expect(seatOfVoice(voice('build_w_road'))).toBe('lavori');
    expect(seatOfVoice(voice('faction_operai'))).toBe('interno');
    expect(seatOfVoice(voice('treasury_condition'))).toBe('tesoro');
    expect(seatOfVoice(voice('debt_service'))).toBe('tesoro');
    expect(seatOfVoice(voice('defence_condition'))).toBe('guerra');
  });

  it('l’ordine delle sedie mette Istruzione e Sanità fra i fatti materiali', () => {
    // Sono fatti della nazione, non opinioni politiche: vengono dopo i Lavori e
    // prima di Esteri e Interno.
    const session = composeCabinet(agenda([
      voice('health_condition'),
      voice('education_condition'),
      voice('faction_operai'),
      voice('defence_condition'),
    ]));
    expect(session.addresses.map(address => address.seat)).toEqual([
      'istruzione', 'sanita', 'interno', 'guerra',
    ]);
  });
});
