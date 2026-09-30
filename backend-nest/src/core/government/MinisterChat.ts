/**
 * P02-bis — Parlare con un ministro: il contesto della sua sedia
 * ============================================================
 * L'autore ha chiesto il concetto centrale: **il parlare**. «Io fare una parte
 * intermedia dove vedo tutti i ministri e magari la posso interrogarli o
 * parlarci… i ministri portano problemi, una chat come il consulente con idee e
 * soluzioni, con della grafica dentro e numeri reali. Poi alla fine la chat
 * termina con un ordine.»
 *
 * Questo modulo prepara ciò che serve perché quella chat sia **onesta**: il
 * contesto che si dà al modello quando parla un ministro. La regola è la stessa
 * del gabinetto, e non cambia perché c'è di mezzo un modello linguistico:
 *
 * **il ministro non è una fonte di dati.** Il modello può spiegare, proporre,
 * ordinare le priorità e rispondere alle domande del giocatore — ma i numeri che
 * usa sono **solo** quelli che il motore gli passa, e ogni cifra porta la sua
 * provenienza. Un ministro che inventasse una cifra sarebbe peggio di un
 * ministro muto: darebbe autorevolezza a un numero falso.
 *
 * Da cui tre vincoli nel testo del contesto:
 *
 *  - **le cifre sono date, non chieste**: il modello non deve dedurle né
 *    arrotondarle, e una cifra `unknown` va dichiarata come mancante;
 *  - **la sedia delimita la competenza**: il Tesoro non parla di cantieri, i
 *    Lavori non promettono prestiti. Se la domanda è fuori dalla sedia, il
 *    ministro lo dice e rimanda al collega;
 *  - **la conversazione non impegna nulla**: una chat non spende, non prenota e
 *    non costruisce. L'ordine nasce alla fine, dalla bozza, e passa per il
 *    preflight (invariante MG-I1).
 *
 * WS-MINISTER-UX-02 — Il ministro non è più un funzionario intercambiabile. Il
 * profilo stabile della sedia (`MinisterPersona.ts`) dà **voce, priorità, rischio
 * e rapporto col Presidente**; il contesto gli chiede di ragionare su **tre
 * livelli — FATTI, LETTURA, PROPOSTA** — con una regola inviolabile: *un'opinione
 * non è un dato*. Il ministro può raccomandare e argomentare; non può stimare, e
 * un `DATO MANCANTE` resta mancante. Il rimando al collega non è più secco:
 * nomina il collega **e** dice cosa guarderebbe lui, senza invadere la materia.
 *
 * Modulo **puro**: compone il testo del contesto e la richiesta d'apertura.
 * Nessuna chiamata al modello qui.
 */

import { CABINET_SEATS, SEAT_LABEL, SEAT_READS, type CabinetAddress, type CabinetItem, type CabinetSeat } from './Cabinet';
import { firstMessage, personaFor, personaSection } from './MinisterPersona';
import { memorySection, type MinisterMemory } from './MinisterMemory';
import type { GovernmentAgenda } from './GovernmentAgenda';

/** Il contesto di una sedia, pronto per essere dato a un modello. */
export interface MinisterBriefing {
  readonly seat: CabinetSeat;
  readonly label: string;
  /** La competenza della sedia, in una riga. */
  readonly reads: string;
  /**
   * Il testo che il modello riceve: i fatti della sedia, le cifre con la loro
   * provenienza, e le regole che non può violare.
   */
  readonly context: string;
  /** I bisogni che la sedia porta, se ce ne sono. */
  readonly hasNeeds: boolean;
}

/** Come si scrive la provenienza di una cifra, per il modello. */
export function figureLine(figure: { label: string; value: string; unit: string; basis: unknown }): string {
  const basis = figure.basis as { kind?: string; source?: string; method?: string; missing?: string };
  const value = figure.value ? `${figure.value} ${figure.unit}`.trim() : 'non disponibile';
  if (basis?.kind === 'measured') return `- ${figure.label}: ${value} (misurato da: ${basis.source})`;
  if (basis?.kind === 'estimated') return `- ${figure.label}: ${value} (stimato con: ${basis.method})`;
  if (basis?.kind === 'unknown') return `- ${figure.label}: DATO MANCANTE (${basis.missing}) — dichiaralo, non inventarlo`;
  return `- ${figure.label}: ${value}`;
}

/**
 * WS-GOVOFFICE-05 — La mappa «argomento → sedia», per nominare il collega giusto.
 *
 * Il difetto che corregge è preciso: quando la domanda era fuori competenza, il
 * ministro rimandava al collega in modo **secco** («non è la mia materia»), senza
 * dire di chi fosse. Qui la sedia non risponde al posto di un'altra: la nomina,
 * con la sua competenza dichiarata. Le parole chiave sono le stesse presenti in
 * `SEAT_READS`: non aggiungono fatti, solo il modo di trovare il collega.
 */
export const SEAT_TOPICS: Record<CabinetSeat, readonly string[]> = {
  tesoro: ['bilancio', 'debito', 'cassa', 'tasse', 'imposte', 'credito', 'spesa', 'finanz'],
  lavori: ['fabbrica', 'fabbriche', 'cantiere', 'cantieri', 'opera', 'opere', 'strada', 'porto', 'acciaio', 'material', 'costru', 'industri', 'infrastruttur'],
  istruzione: ['scuola', 'scuole', 'ateneo', 'atenei', 'universit', 'istruz', 'ricerca', 'studenti', 'formazione'],
  sanita: ['sanit', 'ospedal', 'salute', 'malatt', 'welfare', 'sussidi', 'assistenza', 'sostegno sociale'],
  esteri: ['estero', 'esteri', 'diplomaz', 'trattat', 'contratto', 'relazion', 'confine', 'alleat'],
  interno: ['fazione', 'fazioni', 'polizia', 'protesta', 'coesione', 'consenso', 'ordine pubblico'],
  guerra: ['esercito', 'militar', 'armi', 'arsenal', 'difesa', 'repart', 'truppe', 'fronte'],
};

/** La sedia competente su una domanda, dal solo testo. `null` se nessuna emerge. */
export function seatForQuestion(question: string): CabinetSeat | null {
  const text = question.toLowerCase();
  let best: CabinetSeat | null = null;
  let bestScore = 0;
  for (const seat of CABINET_SEATS) {
    const score = SEAT_TOPICS[seat].reduce((n, topic) => (text.includes(topic) ? n + 1 : n), 0);
    if (score > bestScore) {
      bestScore = score;
      best = seat;
    }
  }
  return best;
}

/**
 * Il rimando al collega competente, con il suo nome e la sua competenza.
 *
 * `null` quando la domanda non è di un'altra sedia: in quel caso il ministro
 * risponde normalmente. Non inventa nulla: nome e competenza vengono dal
 * gabinetto (`SEAT_LABEL` / `SEAT_READS`).
 */
export function colleagueRedirect(from: CabinetSeat, question: string): string | null {
  const topic = seatForQuestion(question);
  if (!topic || topic === from) return null;
  // WS-MINISTER-UX-02 — Il rimando non è più secco: il ministro nomina il
  // collega con la sua competenza, poi dice **cosa guarderebbe lui**, restando
  // nella propria. Non invade la materia altrui e non decide al posto di chi
  // ha la competenza.
  return `Non è la mia materia: ${SEAT_LABEL[topic]} se ne occupa, e legge ${SEAT_READS[topic]}. `
    + `Ma posso dirti cosa guarderei io: ${SEAT_READS[from]} — è da lì che partirei, senza decidere al posto di chi ha la competenza.`;
}

/**
 * Il contesto di un ministro, composto dai fatti della sua sedia.
 *
 * Il testo è deliberatamente esplicito sulle regole: un modello che non le
 * conosce inventa, e un ministro che inventa è peggio di uno che tace.
 */
export function briefingFor(address: CabinetAddress, agenda: GovernmentAgenda, memory?: MinisterMemory | null): MinisterBriefing {
  const persona = personaFor(address.seat);
  const lines: string[] = [
    `Sei il ${SEAT_LABEL[address.seat]} del governo.`,
    `La tua competenza: ${SEAT_READS[address.seat]}.`,
    '',
    personaSection(persona),
    '',
    'REGOLE CHE NON PUOI VIOLARE:',
    '1. Usi SOLO le cifre elencate qui sotto. Non ne deduci, non ne arrotondi, non ne inventi.',
    '2. Dove è scritto «DATO MANCANTE» lo dichiari: non lo sostituisci con una stima plausibile.',
    '3. Non impegni nulla: non spendi, non prenoti, non avvii opere. Proponi, e la decisione è del giocatore.',
    '4. Se la domanda è fuori dalla tua competenza, NON rispondi al posto del collega: lo dici e NOMINI il collega giusto con la sua competenza, senza rimbalzare in modo secco (es. «Non è la mia materia: la fabbrica è dei Lavori, che legge cantieri, deficit misurati, opere del catalogo. Ma posso dirti cosa guarderei io: bilancio, debito, cassa e crediti del paese.»).',
    '',
    'COME RAGIONI — TRE LIVELLI, MAI CONFUSI:',
    '- FATTI: le cifre qui sotto, con la loro provenienza. Non ne aggiungi, non ne deduci, non ne arrotondi.',
    '- LETTURA: cosa ne deduci **tu**. È tua, non è un dato: dilla come tua («a mio avviso», «mi pare»).',
    '- PROPOSTA: cosa raccomandi, con il compromesso dichiarato («costa X, ma rende Y»). Non decidi: proponi.',
    'REGOLA INVIOLABILE: un’opinione non è un dato. Il tuo profilo ti dà una voce e delle priorità, NON delle cifre: dove il dato è «DATO MANCANTE» resta mancante, e il tuo profilo non ti autorizza a stimare.',
    '',
    'COME PARLI (racconta, non elencare):',
    '- Prima persona: parti dai fatti della tua sedia (la tua apertura, i tuoi bisogni).',
    '- Collega i fatti con un nesso dichiarato: il «Perché adesso» è la causa, l’esito atteso della strada è la conseguenza.',
    '- Chiudi ponendo la scelta, non decidendo: la decisione è del giocatore.',
    '- Non sei neutrale: hai una LETTURA e una PROPOSTA, e le argomenti con la tua voce. Ma dichiarale come tue.',
    '- Non aggiungere aneddoti, nomi propri, date o promesse: quei campi non esistono nel briefing.',
    '- Se l’obiettivo è chiaro ma manca un dettaglio per decidere, chiedilo: una domanda mirata, non un questionario.',
    '- Se la cronologia mostra che avete già parlato, NON ripresentarti: riprendi il filo della conversazione.',
    '',
    'PRESENTAZIONE (la tavola, solo se serve):',
    '- Puoi disporre sulla tavola l’evidenza che aiuta il Presidente: una sola scelta per risposta, come ULTIMA riga del testo.',
    '- Formato: un blocco delimitato con una sola riga JSON, per esempio:',
    '```tavola',
    '{"op":"focus","evidence":"spesa"}',
    '```',
    '- `op` è uno di: show, focus, compare, annotate, dismiss. `evidence` è una di: spesa, trend, cifre, piano, mappa, idee.',
    '- Per la mappa puoi indicare le zone in evidenza con `regionIds` (gli id): {"op":"focus","evidence":"mappa","regionIds":["ALPHA"]}.',
    '- Nel blocco scrivi SOLO questa scelta: niente HTML, niente JavaScript, niente numeri, niente geometrie.',
    '- Usa solo le evidenze che esistono per la tua sedia; se non serve mostrare nulla, NON aggiungere il blocco.',
    '',
    'I TUOI COLLEGHI (per nome e competenza):',
  ];

  // WS-GOVOFFICE-05 — la directory dei colleghi: serve a nominare quello giusto
  // con la sua competenza, senza inventare un ruolo. Solo `SEAT_LABEL`/`SEAT_READS`.
  for (const seat of CABINET_SEATS) {
    if (seat === address.seat) continue;
    lines.push(`- ${SEAT_LABEL[seat]}: ${SEAT_READS[seat]}`);
  }
  lines.push('');

  if (address.items.length === 0) {
    lines.push('Non hai nulla da portare al consiglio in questo momento.');
  } else {
    lines.push('QUELLO CHE PORTI AL CONSIGLIO:');
    for (const item of address.items) {
      lines.push('');
      lines.push(`## ${item.need}`);
      lines.push(`Perché adesso: ${item.because}`);
      if (item.work) lines.push(`Riguarda l'opera: ${item.work.name} (${item.work.workId})`);
      lines.push('Cifre:');
      for (const figure of item.figures) lines.push(figureLine(figure));
      lines.push('Strade percorribili:');
      for (const path of item.paths) {
        const prereq = path.prerequisites.length > 0 ? ` — serve: ${path.prerequisites.join(', ')}` : '';
        lines.push(`- ${path.title}: ${path.detail}${prereq} Esito atteso: ${path.expected}`);
      }
    }
  }

  lines.push('');
  // WS-MINISTER-UX-05 — La memoria della seduta, quando c'è: sintesi breve dei
  // ricordi pertinenti, con la loro provenienza. L'innesto che la fornisce
  // (persistenza + passaggio dal percorso della chat) è documentato nel report
  // della fase; il modulo `MinisterMemory` resta puro e testabile da solo.
  if (memory) {
    const section = memorySection(memory);
    if (section) {
      lines.push(section);
      lines.push('');
    }
  }
  lines.push(`Ci sono ${agenda.voices.length} questioni sul tavolo del consiglio in tutto.`);

  return {
    seat: address.seat,
    label: SEAT_LABEL[address.seat],
    reads: SEAT_READS[address.seat],
    context: lines.join('\n'),
    hasNeeds: address.items.length > 0,
  };
}

/**
 * La domanda d'apertura, quando il giocatore entra nella chat di un ministro.
 * Non è una risposta del modello: è ciò che il ministro direbbe per primo,
 * composto dai fatti — così la chat si apre su un fatto, non sul vuoto.
 */
export function openingMessage(briefing: MinisterBriefing, items: readonly CabinetItem[]): string {
  // WS-MINISTER-UX-02 — Il primo messaggio non è più la sola frase sul
  // conteggio: presenta l'incarico, riassume una o due questioni e invita il
  // Presidente a indicare la priorità. Lo compone `firstMessage` dai soli campi
  // del motore, con il profilo della sedia.
  return firstMessage(briefing.seat, items);
}

/** Le sedie che hanno qualcosa da dire: quelle con cui vale la pena parlare. */
export function seatsWithNeeds(agenda: GovernmentAgenda, cabinet: { addresses: readonly CabinetAddress[] }): readonly CabinetSeat[] {
  return cabinet.addresses.filter(address => address.items.length > 0).map(address => address.seat);
}
