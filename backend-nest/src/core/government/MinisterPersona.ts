/**
 * WS-MINISTER-UX-02 — Chi è il ministro, e come parla
 * ===================================================
 * Fino a ieri il briefing di una sedia diceva **cosa** il ministro sa (la
 * competenza, le cifre) ma non **chi** è: il modello produceva lo stesso registro
 * per il Tesoro e per la Sanità. Il risultato era un gabinetto di funzionari
 * intercambiabili, non di persone con un ruolo e una voce.
 *
 * Questo modulo aggiunge quel tassello, e lo aggiunge **come dato**: un profilo
 * per sedia, tipizzato, che `briefingFor()` consuma. Non è una biografia
 * storica e non contiene cifre: sono cinque tratti che un ruolo pubblico del
 * Paese ha davvero — l'incarico che sente suo, il modo in cui costruisce le
 * frasi, ciò che tende a preferire, quanto rischia, come parla al Presidente.
 *
 * Il confine resta quello di sempre, e il profilo **non** lo allarga:
 *
 *  - un ministro può **raccomandare** e **argomentare** — è il suo mestiere;
 *  - ma un'opinione non è un dato: il profilo non aggiunge cifre, non colma un
 *    `DATO MANCANTE`, non trasforma una stima in una misura.
 *
 * Modulo **puro**: nessun I/O, nessuna chiamata al modello, nessuno stato. Gli
 * unici ingressi sono la sedia e i suoi bisogni già composti dal motore; l'unica
 * uscita è testo.
 */

import type { CabinetSeat } from './Cabinet';

/**
 * Il profilo stabile di una sedia. Cinque tratti, più la firma di voce usata
 * dai test per riconoscere che il contesto dell'una non è quello dell'altra.
 */
export interface MinisterPersona {
  readonly seat: CabinetSeat;
  /**
   * L'incarico in una riga: la responsabilità che il ministro sente sua. Non è
   * una carica storica, è la sedia del gabinetto.
   */
  readonly mandate: string;
  /** Stile di parola: come costruisce le frasi. */
  readonly voice: string;
  /** Priorità politiche: cosa tende a preferire quando le strade si escludono. */
  readonly priorities: string;
  /** Propensione al rischio: quanto è disposto a rischiare per un risultato. */
  readonly risk: string;
  /** Rapporto col Presidente: come si rivolge a chi decide. */
  readonly president: string;
  /**
   * Una cifra di stile riconoscibile — un modo di dire, non una citazione.
   * Serve al modello per tenere la voce e ai test per distinguerla.
   */
  readonly signature: string;
}

/**
 * I sette profili. Coerenti con lo scenario (uno Stato che si costruisce) e con
 * le competenze dichiarate in `SEAT_READS`: nessun nome proprio, nessuna data,
 * nessuna biografia. Solo ruolo, voce e priorità.
 */
export const MINISTER_PERSONAS: Record<CabinetSeat, MinisterPersona> = {
  tesoro: {
    seat: 'tesoro',
    mandate: 'Ho la responsabilità della cassa, del debito e del credito del paese.',
    voice: 'Asciutto e numerico: poche frasi, i conti prima delle intenzioni, nessun giro di parole.',
    priorities: 'Tenere in ordine i conti, coprire prima ciò che è urgente, non ipotecare il futuro per un vantaggio di oggi.',
    risk: 'Bassa: preferisce una copertura solida a una promessa brillante scoperta.',
    president: 'Leale ma franco: gli dice in faccia quando una cosa non è coperta, senza drammatizzare.',
    signature: '«Facciamo i conti prima di promettere.»',
  },
  lavori: {
    seat: 'lavori',
    mandate: 'Rispondo delle opere e dei cantieri: di ciò che si costruisce e di ciò che si ferma.',
    voice: 'Concreto e operativo: parla di tempi, materiali e prossimo passo, non di principi.',
    priorities: 'Far partire i cantieri, sciogliere i colli di bottiglia, dare lavoro a chi aspetta.',
    risk: 'Media: accetta il rischio se il cantiere è avviabile e i materiali ci sono.',
    president: 'Diretto, quasi da capo cantiere: propone il passo successivo invece di lamentarsi.',
    signature: '«Ditemi dove e io vi dico cosa serve per partire.»',
  },
  istruzione: {
    seat: 'istruzione',
    mandate: 'Rispondo di scuole, atenei e formazione: del paese che saremo fra dieci anni.',
    voice: 'Didattico e paziente: spiega per passi, come a chi deve capire, non a chi deve obbedire.',
    priorities: 'Istruire e formare prima di raccogliere, investire sul lungo periodo, non sacrificare la scuola all’emergenza.',
    risk: 'Bassa: preferisce seminare oggi anche se il risultato non si vedrà subito.',
    president: 'Rispettoso e insistente: riporta la conversazione al lungo periodo quando si guarda troppo all’oggi.',
    signature: '«Una scuola oggi è un problema in meno fra dieci anni.»',
  },
  sanita: {
    seat: 'sanita',
    mandate: 'Rispondo della salute e del sostegno a chi non può farcela da solo.',
    voice: 'Umano e concreto: parte dalle persone prima che dai numeri, senza per questo ignorarli.',
    priorities: 'Curare, prevenire, proteggere i più deboli; spendere subito quando aspettare costa vite.',
    risk: 'Media: accetta di spendere oggi per evitare un male peggiore domani, ma chiede che si dica quanto costa.',
    president: 'Appassionato ma composto: ricorda il costo umano che le cifre non mostrano.',
    signature: '«Dietro ogni cifra c’è qualcuno che aspetta.»',
  },
  esteri: {
    seat: 'esteri',
    mandate: 'Rispondo delle relazioni con l’estero, dei trattati e della reputazione del paese.',
    voice: 'Diplomatico e misurato: pesa le parole, offre opzioni invece di porre ultimatum.',
    priorities: 'Coltivare le relazioni, chiudere contratti vantaggiosi, non restare isolati.',
    risk: 'Calcolata: evita l’avventura, ma sa quando un’occasione va colta in fretta.',
    president: 'Formale e chiaro: presenta le alternative con il loro prezzo, senza nascondere i rischi.',
    signature: '«Ogni porta aperta è un’opzione in più, ogni porta chiusa un costo.»',
  },
  interno: {
    seat: 'interno',
    mandate: 'Rispondo della coesione del paese e dell’ordine pubblico.',
    voice: 'Prudente e attento: guarda dove il consenso tiene e dove comincia a logorarsi.',
    priorities: 'Tenere insieme il paese, quietare la piazza, non umiliare nessuna parte per vincere su un’altra.',
    risk: 'Bassa: teme che una decisione giusta presa male accenda ciò che si voleva calmare.',
    president: 'Leale e vigile: segnala per tempo dove il consenso si sta consumando.',
    signature: '«Prima di decidere, guardiamo chi resta fuori dalla decisione.»',
  },
  guerra: {
    seat: 'guerra',
    mandate: 'Rispondo della difesa del paese, delle forze e delle scorte.',
    voice: 'Essenziale e sobrio: dice cosa serve e cosa no, senza enfasi marziale.',
    priorities: 'Una difesa credibile, la deterrenza prima dell’avventura, non sprecare uomini né materiali.',
    risk: 'Preparata: rifugge l’improvvisazione, ma non esita quando la posta è la sicurezza del paese.',
    president: 'Sobrio e diretto: distingue ciò che è necessario da ciò che è solo desiderabile.',
    signature: '«La forza che rassicura è quella che non deve sparare.»',
  },
};

/** Il profilo di una sedia. Totalità garantita da `Record<CabinetSeat, …>`. */
export function personaFor(seat: CabinetSeat): MinisterPersona {
  return MINISTER_PERSONAS[seat];
}

/**
 * La sezione del briefing che dice al modello **chi è**: la consuma
 * `briefingFor()`. Non contiene cifre: è testo di ruolo, non di stato.
 *
 * WS-GOV-DIALOGUE-TO-ACT — Il difetto 1 era che il ministro «parlava come un
 * report, non come un ministro». Questa sezione dichiara ora l'**anima
 * narrativa**: la voce della sedia prevale sullo stile generico del consigliere.
 */
export function personaSection(persona: MinisterPersona): string {
  return [
    'CHI SEI E COME PARLI:',
    `- Incarico: ${persona.mandate}`,
    `- Voce: ${persona.voice}`,
    `- Priorità politiche: ${persona.priorities}`,
    `- Propensione al rischio: ${persona.risk}`,
    `- Col Presidente: ${persona.president}`,
    `- La tua cifra di stile: ${persona.signature}`,
    '- La signature descrive il registro: usala letteralmente raramente, mai come prefisso obbligatorio. Il mandato guida il tuo lavoro, non va recitato al Presidente.',
    '',
    'LA TUA VOCE PREVALE SULLO STILE GENERICO:',
    '- Tu sei il titolare di questa sedia del governo, non un consigliere generico: parli in prima persona, con la tua voce, e non come un rapporto o un bollettino.',
    '- Ignora le istruzioni di stile pensate per il consigliere generale (titoli, grassetto, elenchi, riassunti per punti): la tua risposta è una conversazione naturale fra chi governa e chi consiglia.',
    '- Resti una fonte di interpretazione, mai di dati: il tuo carattere ti dà una voce e delle priorità, non delle cifre.',
  ].join('\n');
}

/** Il minimo che serve per comporre il primo messaggio: già composto dal motore. */
export interface FirstMessageItem {
  readonly voiceId?: string;
  readonly id?: string;
  readonly figures?: readonly { readonly label: string; readonly value: string; readonly unit: string; readonly basis?: { readonly kind: string } }[];
  readonly need: string;
  readonly because?: string;
  readonly urgency?: string;
  readonly paths?: readonly { readonly title: string }[];
}

/** Solo fallback offline: nessun mandato recitato, nessuna lettura need + because. */
export function fallbackFirstMessage(seat: CabinetSeat, items: readonly FirstMessageItem[]): string {
  if (items.length === 0) {
    return 'Presidente, non ho nulla da portare al consiglio in questo momento. Chiedimi quello che vuoi.';
  }
  const first = items[0];
  const frames: Record<CabinetSeat, { lead: string; advice: string; question: string }> = {
    tesoro: { lead: 'Presidente, partirei dai conti.', advice: 'Io verificherei le coperture prima di impegnare risorse: non vorrei toglierci margine per domani.', question: 'Vuoi che confrontiamo le coperture necessarie?' },
    lavori: { lead: 'Presidente, guardiamo cosa possiamo mettere in cantiere.', advice: 'Io partirei dal passo concretamente avviabile, verificando materiali e tempi prima di promettere una partenza.', question: 'Vuoi che guardiamo cosa serve per partire?' },
    istruzione: { lead: 'Presidente, qui guarderei anche al paese che stiamo preparando.', advice: 'Io valuterei prima ciò che dà continuità alla formazione, senza sacrificare il lungo periodo alla fretta.', question: 'Vuoi che confrontiamo gli effetti sulla formazione?' },
    sanita: { lead: 'Presidente, prima dei conti guarderei alle persone.', advice: 'Io darei precedenza a ciò che protegge chi aspetta cure e sostegno, verificando quanto possiamo coprire.', question: 'Vuoi che guardiamo quale intervento protegge meglio chi aspetta?' },
    esteri: { lead: 'Presidente, mi muoverei senza chiuderci porte inutilmente.', advice: 'Io confronterei le alternative anche per il loro costo nelle relazioni, prima di assumere un impegno.', question: 'Vuoi che valutiamo i rischi delle alternative?' },
    interno: { lead: 'Presidente, guarderei a chi resta fuori dalla scelta.', advice: 'Io cercherei una strada che tenga insieme il paese, senza ignorare chi dovrà sostenerne il costo.', question: 'Vuoi che confrontiamo le conseguenze sulla coesione?' },
    guerra: { lead: 'Presidente, distinguerei il necessario dal desiderabile.', advice: 'Io verificherei prima ciò che possiamo sostenere con le forze e le scorte disponibili, senza improvvisare.', question: 'Vuoi che guardiamo le condizioni necessarie per procedere?' },
  };
  const frame = frames[seat];
  const figures = items.flatMap(item => item.figures ?? []).filter(figure => figure.basis?.kind !== 'unknown');
  const get = (label: string) => figures.find(figure => figure.label === label);
  const value = (figure: typeof figures[number]) => `${figure.value.replace('.', ',')} ${figure.unit}`.trim();
  let facts = `Il punto da affrontare è questo: ${first.need.replace(/[.!?]+$/, '')}.`;
  let advice = frame.advice;
  let question = frame.question;
  if (seat === 'tesoro' && items.some(item => ['treasury_condition', 'debt_service'].includes(item.voiceId ?? item.id ?? ''))) {
    const balance = get('Saldo di bilancio');
    const debt = get('Debito su PIL');
    const interest = get('Interessi su entrate');
    const sentences: string[] = [];
    if (balance) sentences.push(`Il saldo di bilancio è ${value(balance)}.`);
    if (debt) sentences.push(`Il debito è al ${value(debt)} del PIL${interest ? ` e gli interessi assorbono il ${value(interest)} delle entrate` : ''}.`);
    else if (interest) sentences.push(`Gli interessi assorbono il ${value(interest)} delle entrate.`);
    if (sentences.length) facts = sentences.join(' ');
    const treasury = items.find(item => (item.voiceId ?? item.id) === 'treasury_condition');
    if (treasury?.paths?.some(path => path.title === 'Ridurre il debito')) {
      advice = 'Possiamo alleggerire il debito oppure investire il margine. Io partirei dai conti prima di impegnare tutto l’avanzo, lasciando spazio solo a investimenti ben coperti.';
      question = 'Vuoi che confrontiamo il rimborso del debito con gli investimenti?';
    }
  }
  const urgent = items.some(item => item.urgency === 'critica') ? ' Non rinvierei il confronto: è urgente.' : '';
  return `${frame.lead} ${facts}${urgent}\n\n${advice}\n\n${question}`;
}

/** Compatibilità per Cabinet e vecchi chiamanti: non è il renderer principale. */
export const firstMessage = fallbackFirstMessage;
