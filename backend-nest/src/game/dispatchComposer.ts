/**
 * World Story — composizione dei dispacci contabili
 * =================================================
 * Il salto temporale produce, oltre alla narrativa del modello, **righe di
 * contabilità** del motore: tecnologia sbloccata, debito rifinanziato,
 * magazzino, spreco, estrazione, governo. Prima finivano in cronaca sotto un
 * unico titolo ripetuto — `Conti nazionali del periodo` — che non è una
 * notizia: la stessa formula era scritta a mano in tre punti diversi
 * (`game-session.ts`, `PlaybackService.ts` due volte), ed è la ragione per cui
 * una partita reale risultava fatta al 90% di bollettini.
 *
 * Qui vive l'**unica** funzione di composizione. Tre scelte, dichiarate:
 *
 *  1. **Il titolo dice cosa è successo**, con soggetto e luogo: mai una cifra
 *     di bilancio, mai `Conti nazionali del periodo` (§5.11 della SPEC e la
 *     regola già scritta in `prompts/simulation/prompt.ts`).
 *  2. **Il corpo breve è la notizia**, con le cifre **dentro una frase** e solo
 *     dove servono alla storia: è la stessa regola di `prompts/government.ts`.
 *     Il dettaglio contabile esteso resta nel Dossier Nazione, che ha già i suoi
 *     read model e non dipende da queste righe.
 *  3. **La contabilità ordinaria non è una notizia.** Estrazione di routine,
 *     stato del magazzino e bilancio materiale restano fuori dalla cronaca:
 *     §5.11 li vieta esplicitamente. Restano però in `events` (il riepilogo del
 *     turno che il Dossier e la narrazione già mostrano) — non vengono persi.
 *
 * Il modulo è **puro**: nessun accesso al database, nessuna chiamata al modello.
 * Riceve le righe che `NationStateService` ha già composto e le interpreta.
 */

/** Un dispaccio pronto per `timelineEvents`: titolo concreto e corpo breve. */
export interface ComposedDispatch {
  /** Titolo con soggetto e luogo, senza cifre di bilancio. */
  title: string;
  /** Corpo breve: la notizia, con le cifre dentro una frase. */
  body: string;
}

/** Riga di contabilità che resta nel riepilogo del turno ma **non** è una notizia. */
export interface LedgerOnlyLine {
  /** Riga originale del motore, immutata. */
  line: string;
  /** Perché non è una notizia: dichiarato, non nascosto. */
  reason: 'routine' | 'dettaglio-contabile';
}

/**
 * Emoji con cui `NationStateService` e `game-session` marcano le famiglie di
 * riga. Servono solo a riconoscerle: il titolo non ne porta nessuna, perché la
 * distinzione per categoria è compito del badge del dispaccio
 * (`dispatchCategory.ts`), non di un simbolo nel titolo.
 */
const RE_BULLETIN = /^📊\s*(.+)$/s;
const RE_TECH = /^🔬\s*Nuova tecnologia sbloccata:\s*(.+?)\s*—\s*(.+?)\.?$/;
const RE_DEBT = /^📜\s*Scadenza del debito\s*—\s*(.+?):\s*rifinanziato al nuovo tasso\.?$/;
const RE_STOCK = /^🏭\s*Magazzino nazionale:\s*(.+?)\.?$/;
const RE_SPOILED = /^📦\s*Magazzino al tetto:\s*perduto\s*(.+?)\s*\(capacità di stoccaggio superata\)\.?$/;
const RE_EXTRACT = /^⛏️\s*Estrazione risorse:\s*(.+?)\.?$/;
const RE_GOVERNMENT = /^🏛️\s*Governo\s*—\s*(.+?)\.?$/;
const RE_SHORTAGE = /^⚠️\s*Carenza materiale\s*—\s*(.+?)\.?$/;
const RE_FLOW = /^⚙️\s*Bilancio materiale degli oggetti\s*—\s*(.+?)\.?$/;
const RE_PERIOD = /^🔁\s*Nel periodo\b/;
const RE_DEPLETED = /^🪫\s*Risorsa esaurita:\s*(.+?)\.?$/;

/** «963,1 mld al 8% (scadenza 2029-01-20)» → le parti che servono al titolo. */
function readDebtTranche(detail: string): { years: string | null; year: string | null } {
  const maturity = /scadenza\s+(\d{4})-\d{2}-\d{2}/.exec(detail);
  const years = /Debito ereditato\s+(\d+)\s+anni/i.exec(detail);
  return { years: years ? years[1] : null, year: maturity ? maturity[1] : null };
}

/**
 * Scrive un numero all'italiana. Il motore usa il punto come separatore
 * decimale (`963.1`), ma in prosa italiana si scrive `963,1`: lasciarlo com'è
 * produrrebbe un testo che sembra sbagliato pur avendo il numero giusto. Non
 * inventa cifre: converte soltanto i separatori.
 */
function formatNumIt(raw: string | undefined): string {
  if (!raw) return '';
  const t = raw.trim();
  if (!/^[\d.,]+$/.test(t)) return t;
  return t.replace(/\./g, ',');
}

/**
 * Compone il dispaccio di uno **scadenza di debito**. Il titolo nomina la
 * scadenza e l'anno; il corpo dice perché conta (l'onere degli interessi).
 */
function composeDebt(detail: string): ComposedDispatch {
  const { years, year } = readDebtTranche(detail);
  const when = year ? ` del ${year}` : years ? ` a ${years} anni` : '';
  const interest = formatNumIt(/al\s*([\d.,]+)\s*%/.exec(detail)?.[1]);
  const principal = formatNumIt(/:\s*([\d.,]+)\s*mld/.exec(detail)?.[1]);
  const body = [
    `Il titolo${when} giunge a scadenza e viene rifinanziato al tasso corrente di mercato`,
    interest ? `, oggi al ${interest}%` : '',
    principal ? `, su un capitale di ${principal} miliardi` : '',
    '. L\'onere resta nel bilancio degli anni successivi: è debito che si sposta, non che si estingue.',
  ].join('');
  const title = year
    ? `Il Tesoro rifinanzia il debito in scadenza nel ${year}`
    : `Il Tesoro rifinanzia una tranche di debito in scadenza`;
  return { title, body };
}

/** Compone il dispaccio di una **tecnologia sbloccata**. */
function composeTechnology(name: string, effects: string): ComposedDispatch {
  // Il nome della tecnologia si conserva **come l'ha scritto il motore**: non si
  // minuscolizza («agricoltura meccanizzata» legge male) e non si antepone un
  // articolo, che richiederebbe di conoscerne il genere.
  return {
    title: `Le imprese adottano ${name}`,
    body: `Il nuovo processo entra nella produzione corrente: ${effects.replace(/\.$/, '')}. `
      + `La voce è ormai disponibile nei piani del governo, non più solo nei programmi di ricerca.`,
  };
}

/** Compone il dispaccio di una **carestia di materiale**. */
function composeShortage(detail: string): ComposedDispatch {
  const label = /^(.+?):\s*deficit/.exec(detail);
  const subject = label ? label[1].trim() : detail.replace(/\.$/, '');
  return {
    title: `Carenza di ${subject.toLowerCase()}: la produzione rallenta`,
    body: `Il fabbisogno del periodo supera la disponibilità e la lavorazione non tiene il ritmo. `
      + `Finché il deficit non rientra, gli impianti che dipendono da questa voce restano sotto le attese.`,
  };
}

/** Compone il dispaccio di una **risorsa esaurita**. */
function composeDepleted(detail: string): ComposedDispatch {
  const label = /^(.+?)\s*—/.exec(detail);
  const subject = label ? label[1].trim() : detail.replace(/\.$/, '');
  return {
    title: `Si esaurisce il giacimento di ${subject.toLowerCase()}`,
    body: `La vena non rende più e le produzioni che vi si appoggiavano perdono il vantaggio del sito. `
      + `Restano l'impianto e la manodopera, ma la materia prima va cercata altrove.`,
  };
}

/**
 * Compone il **quadro nazionale** in una notizia: non ripete le cifre del
 * bollettino, ne trae il fatto politico che conta (saldo, pressione, sforzo).
 * Il bollettino integrale resta nel Dossier.
 */
function composeBulletin(bulletin: string): ComposedDispatch {
  const balance = /saldo\s*([+−-])\s*([\d.,]+)/.exec(bulletin);
  const military = /spesa militare\s*([\d.,]+)%/.exec(bulletin);
  const tension = /tensione sociale\s*([\d.,]+)/.exec(bulletin);
  const government = /Quadro nazionale:\s*([^;]+);/.exec(bulletin);
  const surplus = balance ? balance[1] === '+' : null;
  const title = surplus === null
    ? 'Il quadro dei conti del periodo'
    : surplus
      ? 'Il bilancio del periodo chiude in avanzo'
      : 'Il bilancio del periodo chiude in disavanzo';
  const parts = [
    government ? `Il paese è retto da ${government[1].trim().toLowerCase()}` : 'Il paese resta retto dal suo governo',
    balance ? `, e il saldo mensile del periodo si chiude ${surplus ? 'in avanzo' : 'in disavanzo'} di ${balance[2]} miliardi` : '',
    military ? `. La spesa militare assorbe il ${military[1]}% del prodotto` : '',
    tension ? `; la tensione sociale si attesta su ${tension[1]} su cento` : '',
    '. Il dettaglio contabile resta nel dossier del governo; qui conta la direzione che i conti prendono.',
  ].join('');
  return { title, body: parts };
}

/**
 * Compone il **governo**: le anime che premono e la richiesta della più
 * influente sono un fatto politico, quindi un dispaccio a pieno titolo.
 */
function composeGovernment(headline: string): ComposedDispatch {
  const dominant = /^(.+?)\s+ha la maggiore influenza;\s*(.+?)\s+preme di più:\s*(.+?)\.?$/i.exec(headline);
  if (dominant) {
    const pressing = dominant[2].trim();
    // La richiesta può contenere una cifra di bilancio («portare la spesa
    // militare al 4% del pil»): nel **titolo** non entra mai, perché un titolo
    // con una percentuale è un bollettino. Il motivo resta nel corpo, in prosa.
    const demand = simplifyDemand(dominant[3].trim());
    return {
      title: `${pressing} preme sul governo`,
      body: `${dominant[1].trim()} ha la maggiore influenza nel consiglio, mentre la pressione più forte `
        + `viene da ${pressing}: la richiesta è ${demand.toLowerCase()}. `
        + `Il dossier entra nelle decisioni del prossimo periodo.`,
    };
  }
  const single = /^(.+?)\s+domina il consiglio e chiede:\s*(.+?)\.?$/i.exec(headline);
  if (single) {
    const demand = simplifyDemand(single[2].trim());
    return {
      title: `${single[1].trim()} domina il consiglio`,
      body: `La compagine di governo si stringe intorno a ${single[1].trim().toLowerCase()}, `
        + `che chiede ${demand.toLowerCase()}. Le altre anime restano in ascolto.`,
    };
  }
  return {
    title: 'Il governo non ha anime registrate per questo scenario',
    body: headline.replace(/\.$/, '') + '.',
  };
}

/**
 * Riduce la richiesta di una fazione alla sua sostanza politica, senza le cifre
 * di bilancio che il motore vi ha incluso. «riarmo: portare la spesa militare al
 * 4% del pil» → «il riarmo». Una soglia numerica in un titolo è esattamente ciò
 * che §5.11 vieta; la cifra resta disponibile nel dossier.
 */
function simplifyDemand(demand: string): string {
  const clean = demand.replace(/\s*[:.]\s*$/, '');
  const colon = /^(.+?):\s*(.+)$/.exec(clean);
  if (colon && /\d/.test(colon[2])) return colon[1].trim();
  if (/\d/.test(clean)) {
    const short = clean.split(/[,;]/)[0].replace(/\s+al\s+[\d.,]+%.*$/i, '').trim();
    if (short && !/\d/.test(short)) return short;
    // Nessuna riduzione pulita: si ripiega sul tono politico, senza inventare.
    return 'una revisione delle priorità di spesa';
  }
  return clean;
}

/**
 * Interpreta **una** riga del motore.
 *
 * @returns un `ComposedDispatch` se la riga è una notizia; un `LedgerOnlyLine`
 *          se è contabilità ordinaria che va tenuta fuori dalla cronaca.
 */
export function composeDispatch(line: string): ComposedDispatch | LedgerOnlyLine {
  const text = (line || '').trim();
  if (!text) return { line: text, reason: 'routine' };

  // Il quadro nazionale arriva dal motore con l'emoji 📊 davanti: è una notizia
  // sulla direzione dei conti, non un bollettino da incollare in cronaca.
  let m = RE_BULLETIN.exec(text);
  if (m) return composeBulletin(m[1]);

  m = RE_TECH.exec(text);
  if (m) return composeTechnology(m[1], m[2]);

  m = RE_DEBT.exec(text);
  if (m) return composeDebt(m[1]);

  m = RE_GOVERNMENT.exec(text);
  if (m) return composeGovernment(m[1]);

  m = RE_SHORTAGE.exec(text);
  if (m) return composeShortage(m[1]);

  m = RE_DEPLETED.exec(text);
  if (m) return composeDepleted(m[1]);

  // Contabilità ordinaria: vietata in cronaca da §5.11. Resta nel riepilogo.
  if (RE_EXTRACT.test(text)) return { line: text, reason: 'routine' };
  if (RE_STOCK.test(text)) return { line: text, reason: 'dettaglio-contabile' };
  if (RE_FLOW.test(text)) return { line: text, reason: 'dettaglio-contabile' };
  if (RE_PERIOD.test(text)) return { line: text, reason: 'dettaglio-contabile' };
  if (RE_SPOILED.test(text)) return { line: text, reason: 'dettaglio-contabile' };

  // Riga non riconosciuta: non la si promuove a notizia, e non la si perde.
  return { line: text, reason: 'routine' };
}

/** Il dispaccio è una notizia? (type guard) */
export function isComposedDispatch(value: ComposedDispatch | LedgerOnlyLine): value is ComposedDispatch {
  return (value as ComposedDispatch).title !== undefined;
}

export interface ComposedLines {
  /** Notizie pronte per `timelineEvents`: titolo + corpo breve. */
  dispatches: ComposedDispatch[];
  /** Riepilogo del turno: la narrativa **seguita** dalle righe di contabilità. */
  events: string[];
  /** Contabilità tenuta fuori dalla cronaca, dichiarata con il motivo. */
  ledgerOnly: LedgerOnlyLine[];
  /** Tutte le righe non narrative, nell'ordine di sempre (per il Dossier). */
  ledgerLines: string[];
}

/**
 * Compone **tutte** le righe di un salto: le notizie diventano dispacci, la
 * contabilità resta nel riepilogo senza diventare cronaca.
 *
 * @param narrative eventi narrativi già composti dal motore o dal modello
 *                  (es. «Lunga deriva»): restano in testa, immutati.
 * @param ledgerLines righe contabili prodotte da `NationStateService`.
 */
export function composeDispatchLines(narrative: string[], ledgerLines: string[]): ComposedLines {
  const dispatches: ComposedDispatch[] = [];
  const events: string[] = [...narrative];
  const ledgerOnly: LedgerOnlyLine[] = [];
  const ledger: string[] = [];

  for (const line of ledgerLines) {
    const composed = composeDispatch(line);
    ledger.push(line);
    if (isComposedDispatch(composed)) {
      dispatches.push(composed);
    } else {
      ledgerOnly.push(composed);
    }
  }

  // Il riepilogo del turno conserva la contabilità: è il Dossier che la mostra,
  // e la narrazione non deve perdere nulla di ciò che il motore ha calcolato.
  events.push(...ledger);
  return { dispatches, events, ledgerOnly, ledgerLines: ledger };
}
