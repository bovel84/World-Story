/**
 * P01 — Il gabinetto: chi ha qualcosa da dire, e perché
 * ====================================================
 * L'autore ha chiesto una sala di consiglio: «le persone che chattano con me e
 * propongono i loro piani e bisogni». Un gabinetto di ministri è però un rischio
 * preciso — inventare personalità che dicono cose che il motore non sa. Questo
 * modulo esiste per evitarlo, e la regola è una sola:
 *
 * **Un ministro non è una fonte di dati, è una proiezione dello stato per
 * competenza.**
 *
 * Da cui, tre conseguenze che il codice applica:
 *
 *  - **Un ministro senza dati TACE.** Il Tesoro compare se ci sono bilancio,
 *    debito o cassa in tensione; i Lavori se c'è un cantiere o un'opera. Chi non
 *    ha nulla da dire non occupa una sedia: non si riempie il silenzio con
 *    frasi di circostanza. Un paese senza problemi ha una seduta **vuota**.
 *  - **Ogni cifra porta la sua provenienza.** Le cifre vengono dalle voci
 *    dell'agenda, che già distinguono `measured`, `estimated` e `unknown`: qui
 *    non si aggiungono numeri, si distribuiscono per competenza.
 *  - **Nessuno impegna nulla.** Il gabinetto produce una **seduta**, cioè testo
 *    e riferimenti: nessuna funzione di questo modulo spende, prenota o
 *    costruisce. È l'invariante MG-I1, e la differenza fra «proposta» e
 *    «decisione».
 *
 * Modulo **puro**: riceve l'agenda e la fotografia del governo, restituisce la
 * seduta. Chi legge i conti e il ledger lo fa fuori, come per `GovernmentAgenda`.
 */

import type { Figure, GovernmentAgenda, GovernmentVoice, GovernmentPath } from './GovernmentAgenda';

/** Le cinque sedie del gabinetto, e la competenza di ciascuna. */
export const CABINET_SEATS = ['tesoro', 'lavori', 'esteri', 'interno', 'guerra'] as const;
export type CabinetSeat = typeof CABINET_SEATS[number];

export const SEAT_LABEL: Record<CabinetSeat, string> = {
  tesoro: 'Ministro del Tesoro',
  lavori: 'Ministro dei Lavori',
  esteri: 'Ministro degli Esteri',
  interno: 'Ministro dell’Interno',
  guerra: 'Ministro della Guerra',
};

/** Che cosa legge ogni sedia: dichiarato, non implicito. */
export const SEAT_READS: Record<CabinetSeat, string> = {
  tesoro: 'bilancio, debito, cassa e crediti del paese',
  lavori: 'cantieri, deficit misurati, opere del catalogo',
  esteri: 'relazioni, contratti, deficit che una controparte può coprire',
  interno: 'fazioni, pressione politica, coesione',
  guerra: 'potenza e arsenale del paese, minacce al confine',
};

/**
 * Da dove viene la voce di una sedia: le voci dell'agenda che le competono.
 *
 * La mappa è il cuore della regola «un ministro senza dati tace»: se per una
 * sedia non c'è alcuna voce, la sedia resta **vuota** e non compare nella seduta.
 */
export function voicesForSeat(seat: CabinetSeat, agenda: GovernmentAgenda): readonly GovernmentVoice[] {
  return agenda.voices.filter(voice => seatOfVoice(voice) === seat);
}

/** La competenza di una voce dell'agenda, decisa dal suo tipo — non dal testo. */
export function seatOfVoice(voice: GovernmentVoice): CabinetSeat {
  // Un deficit materiale o monetario è dei Lavori: è il cantiere che si ferma.
  if (voice.id.startsWith('deficit_')) return voice.id.includes('INSUFFICIENT_CASH') ? 'tesoro' : 'lavori';
  if (voice.id === 'debt_service') return 'tesoro';
  // Una fazione interna è dell'Interno; un'opera è dei Lavori.
  if (voice.id.startsWith('faction_')) return 'interno';
  if (voice.id.startsWith('build_')) return 'lavori';
  // Tutto ciò che non ha una sedia propria è dei Lavori: è il ministro che
  // presiede le cose materiali. Se in futuro nascono voci nuove, questa riga è
  // il punto in cui decidere — non un silenzio.
  return 'lavori';
}

/** L'intervento di un ministro: la sua sedia, i suoi bisogni, le sue cifre. */
export interface CabinetAddress {
  readonly seat: CabinetSeat;
  readonly label: string;
  /** Che cosa legge questa sedia, in una riga. Dichiararlo è parte dell'onestà. */
  readonly reads: string;
  /** I bisogni che porta, ciascuno con le sue cifre e le sue strade. */
  readonly items: readonly CabinetItem[];
  /** La frase di apertura, composta dai fatti — non una personalità inventata. */
  readonly opening: string;
}

export interface CabinetItem {
  readonly voiceId: string;
  readonly need: string;
  readonly because: string;
  readonly urgency: GovernmentVoice['urgency'];
  readonly figures: readonly Figure[];
  readonly paths: readonly GovernmentPath[];
}

/** La seduta: chi parla, in che ordine, e la sintesi di chi presiede. */
export interface CabinetSession {
  readonly addresses: readonly CabinetAddress[];
  /** Il presidente: apre e chiude. Non è una sesta competenza. */
  readonly president: {
    readonly opening: string;
    readonly closing: string;
  };
  /** Quante questioni, e quante bloccanti: la sintesi che apre la seduta. */
  readonly summary: { readonly total: number; readonly critical: number };
  /** Nessuna di queste voci è stata impegnata: la bozza passa per la coda. */
  readonly canonicalMutation: false;
}

/** L'ordine delle sedie in seduta: prima i fatti, poi le opinioni. */
const SEAT_ORDER: readonly CabinetSeat[] = ['tesoro', 'lavori', 'esteri', 'interno', 'guerra'];

/**
 * Compone la seduta del gabinetto dall'agenda del Governo.
 *
 * Le sedie senza voce **non compaiono**: è la regola, non una svista. L'ordine
 * delle sedie è dichiarato (`SEAT_ORDER`) e mette i fatti materiali prima delle
 * opinioni politiche, perché è l'ordine in cui il paese li sente.
 */
export function composeCabinet(agenda: GovernmentAgenda): CabinetSession {
  const addresses: CabinetAddress[] = [];

  for (const seat of SEAT_ORDER) {
    const voices = voicesForSeat(seat, agenda);
    // La regola: senza dati, il ministro tace.
    if (voices.length === 0) continue;
    addresses.push({
      seat,
      label: SEAT_LABEL[seat],
      reads: SEAT_READS[seat],
      items: voices.map(voice => ({
        voiceId: voice.id,
        need: voice.need,
        because: voice.because,
        urgency: voice.urgency,
        figures: voice.figures,
        paths: voice.paths,
      })),
      opening: openingFor(seat, voices),
    });
  }

  const critical = agenda.voices.filter(voice => voice.urgency === 'critica').length;
  const total = agenda.voices.length;

  return {
    addresses,
    president: {
      opening: total === 0
        ? 'Il consiglio è riunito. Non c’è nulla sul tavolo che il motore sappia documentare.'
        : `Il consiglio è riunito. ${total} ${total === 1 ? 'questione' : 'questioni'} sul tavolo${critical > 0 ? `, ${critical} ${critical === 1 ? 'bloccante' : 'bloccanti'}` : ''}.`,
      closing: total === 0
        ? 'Seduta chiusa senza delibere.'
        : 'Nessuna di queste proposte impegna il paese. Scegliete una strada, e l’ordine che ne nasce passerà per la verifica prima di essere registrato.',
    },
    summary: { total, critical },
    canonicalMutation: false,
  };
}

/** La frase di apertura di una sedia, composta dai fatti che porta. */
function openingFor(seat: CabinetSeat, voices: readonly GovernmentVoice[]): string {
  const critical = voices.filter(voice => voice.urgency === 'critica').length;
  const count = voices.length;
  const things = `${count} ${count === 1 ? 'cosa da portare' : 'cose da portare'} al consiglio`;
  const urgent = critical > 0 ? `, ${critical} ${critical === 1 ? 'urgente' : 'urgenti'}` : '';
  return `Ho ${things}${urgent}.`;
}
