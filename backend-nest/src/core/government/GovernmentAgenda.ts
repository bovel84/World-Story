/**
 * MG05 — Il Governo come regia di decisioni fondate sullo stato
 * ===========================================================
 * Il Governo esiste già come **fotografia**: `GovernmentFactions.ts` legge i
 * conti, le fazioni e la memoria politica e ne trae uno snapshot. Ma una
 * fotografia non è una scelta: il piano chiede una **scheda** che proietti i
 * bisogni verificabili in almeno due strade, ciascuna con i suoi prerequisiti e
 * le sue conseguenze attese, e con ogni cifra collegata alla sua provenienza.
 *
 * Questo modulo fa quel passaggio, e lo fa con tre regole che sono il punto:
 *
 *  - **Ogni voce nasce da un fatto misurato.** Una richiesta c'è perché un
 *    deficit, una fazione, un debito o un'opportunità la giustificano — e la
 *    scheda porta con sé **da dove viene il numero** (`basis`), perché il
 *    giocatore possa contestarlo. Una raccomandazione che usasse dati ignoti è
 *    etichettata come ipotesi, non come fatto.
 *  - **Almeno due strade, mai una sola.** Una via sola non è una scelta: è un
 *    ordine travestito. Ogni voce offre la via diretta e almeno un'alternativa
 *    con un costo diverso (ridimensionare, rimandare, cercare fuori).
 *  - **Il Governo propone, non impegna.** Nessuna funzione di questo modulo
 *    spende, prenota o costruisce: produce una **bozza** con il suo preflight,
 *    che passa per la coda e per il salto come qualunque altro ordine. È
 *    l'invariante MG-I1, e la separazione fra «proposta» e «decisione».
 *
 * Modulo **puro**: riceve lo stato già letto e restituisce l'agenda. Chi legge i
 * conti, il ledger e le fazioni lo fa fuori, come per `Availability`.
 */

import { IntString, parseInteger, intToString } from '../../domain/quantities';
import { formatGovernmentNumber, governmentFigureValue } from './GovernmentNumberFormat';

/** Da dove viene un numero mostrato al giocatore. */
export type FigureBasis =
  /** Misurato ora: conti, ledger, stato della partita. */
  | { readonly kind: 'measured'; readonly source: string }
  /** Stima dichiarata del motore, con il suo metodo. */
  | { readonly kind: 'estimated'; readonly source: string; readonly method: string }
  /** Il dato non c'è: si dice, non si inventa. */
  | { readonly kind: 'unknown'; readonly missing: string };

/** Una cifra con la sua provenienza: mai un numero senza origine. */
export interface Figure {
  readonly label: string;
  readonly value: IntString;
  readonly unit: string;
  readonly basis: FigureBasis;
}

export type VoiceUrgency = 'ordinaria' | 'urgente' | 'critica';

/** Un problema o un'opportunità che il Governo porta in consiglio. */
export interface GovernmentVoice {
  readonly id: string;
  /** Cosa chiede il paese, in una riga. */
  readonly need: string;
  /** Perché adesso: la condizione che l'ha fatta emergere. */
  readonly because: string;
  readonly urgency: VoiceUrgency;
  /** Chi lo chiede: una fazione, o `null` se è un bisogno del paese. */
  readonly factionId: string | null;
  /** Le cifre che sostengono la richiesta, ciascuna con la sua provenienza. */
  readonly figures: readonly Figure[];
  /** Le strade percorribili: almeno due, con prerequisiti e conseguenze. */
  readonly paths: readonly GovernmentPath[];
  /**
   * P03 — Per una voce di costruzione, l'opera del catalogo a cui si riferisce.
   *
   * Serve a un fatto preciso: un ordine nato da questa voce deve portare la
   * **dichiarazione strutturata** che il motore pretende per un cantiere
   * (`workId` e detentori). Senza, la bozza è prosa e il motore non ne ricava
   * una costruzione — misurato: l'ordine del Governo non passava i requisiti.
   */
  readonly work?: { readonly workId: string; readonly name: string };
}

/** Una strada percorribile, con i suoi prerequisiti e le sue conseguenze. */
export interface GovernmentPath {
  readonly id: string;
  readonly title: string;
  /** Cosa comporta, in una riga. */
  readonly detail: string;
  /** Che cosa serve perché sia percorribile. Vuoto = nulla di bloccante. */
  readonly prerequisites: readonly string[];
  /** Cosa ci si aspetta che cambi, in una riga. Etichettato come atteso. */
  readonly expected: string;
  /** Il costo dichiarato della strada, se il motore lo conosce. */
  readonly cost?: Figure;
  /** La via consigliata dal Governo: **non** vincolante, e dichiarata come consiglio. */
  readonly recommended: boolean;
}

export interface GovernmentAgenda {
  readonly voices: readonly GovernmentVoice[];
  /** Frase di sintesi, per l'intestazione della scheda. */
  readonly headline: string;
  /**
   * Il Governo propone: nessuna di queste voci è stata impegnata. La bozza che
   * ne nasce passa per il preflight e per la coda come qualunque ordine.
   */
  readonly canonicalMutation: false;
}

// ─── Lo stato che il Governo legge ──────────────────────────────────────────

/** Un deficit materiale o monetario, come lo misura `Availability.ts`. */
export interface AgendaDeficit {
  readonly code: 'INSUFFICIENT_CASH' | 'MATERIAL_SHORTAGE' | 'WORKFORCE_SHORTAGE';
  readonly id: string;
  readonly required: IntString;
  readonly available: IntString;
  readonly missing: IntString;
  readonly unit: string;
}

export interface AgendaFaction {
  readonly id: string;
  readonly name: string;
  readonly powerPct: number;
  readonly satisfaction: number;
  readonly stance: string;
  readonly demandTitle: string;
  readonly demandDetail: string;
  readonly urgency: number;
}

export interface GovernmentAgendaInput {
  /** I deficit misurati sui cantieri e sugli ordini in corso. */
  readonly deficits: readonly AgendaDeficit[];
  /** Le fazioni, dalla fotografia del governo. */
  readonly factions: readonly AgendaFaction[];
  /** Bilancio: saldo e aliquota effettiva, in percentuale del PIL. */
  readonly budget: { readonly balance: IntString; readonly unit: string; readonly effectiveTaxRatePct: number };
  /** Debito: rapporto sul PIL e peso degli interessi sulle entrate. */
  readonly debt: { readonly ratioPct: number; readonly servicePct: number };
  /** Le risorse su cui il paese può contare, per le vie alternative. */
  readonly reserves: readonly { readonly resourceId: string; readonly available: IntString; readonly unit: string }[];
  /** Le opere disponibili nel catalogo, per proporre cosa costruire. */
  readonly buildable: readonly { readonly workId: string; readonly name: string; readonly missing: readonly string[] }[];
  /** La valuta di conto, per le cifre monetarie. */
  readonly currencyId: string;
  /**
   * P04 — Lo stato dei militari, che il Ministro della Guerra riferisce.
   *
   * Prima di P04 la Guerra non esisteva nel codice: la spesa di difesa compariva
   * solo come *politica* dentro la fazione «Forze armate», cioè come opinione di
   * qualcuno che chiede più soldi. Ma la difesa del paese è un fatto della sedia,
   * non una corrente di opinione: un ministro della Guerra che non riferisce mai
   * la propria condizione non è prudente, è assente.
   *
   * `undefined` quando il motore non pubblica questi numeri: la sedia tace, come
   * deve, invece di inventare una condizione.
   */
  readonly defence?: {
    /** Spesa di difesa in percentuale del PIL, dal conto nazionale. */
    readonly burdenPct: number;
    readonly forces: number;
    readonly mobilized: number;
    /** La fazione che incarna i militari, se la fotografia ne ha una. */
    readonly factionSatisfaction: number | null;
  };
  /**
   * P04 — La condizione dei conti, perché il Tesoro possa riferirla sempre.
   *
   * Il Tesoro è l'unica sedia che ha **sempre** numeri: un paese senza bilancio
   * non è un paese. Tacerla finché il servizio del debito non supera il 15%
   * significa che in una partita normale il ministro più importante non parla
   * mai — misurato: servizio 14,1%, soglia 15%, sala vuota.
   */
  readonly cashFlow?: {
    /** Il saldo di bilancio in percentuale del PIL. */
    readonly balancePct: number;
    /** Il saldo in cifre, nell'unità del bilancio. */
    readonly balance: IntString;
    readonly unit: string;
    /** Le entrate, per mostrare su cosa poggia il gettito. */
    readonly revenuePct: number;
  };
  /**
   * WS-GOVOFFICE-05 — La condizione dell'istruzione e della ricerca.
   *
   * `undefined` quando il conto nazionale non è pubblicato: la sedia **tace**,
   * esattamente come il Tesoro e la Guerra senza il loro conto. Il peso della
   * spesa è una quota ripartita, perciò le cifre lo dichiarano come stima.
   */
  readonly education?: {
    /** Spesa per istruzione e ricerca, in percentuale del PIL. */
    readonly burdenPct: number;
    /** Gli atenei del paese, dal conto nazionale. */
    readonly universities: number;
    /** Tensione sociale (0-100), per collegare la scuola al disagio. */
    readonly socialTension: number;
  };
  /**
   * WS-GOVOFFICE-05 — La condizione della spesa sociale.
   *
   * Il dato è `socialBurdenPct`, che è **sanità + sostegno**: la voce lo dichiara
   * e non lo spaccia per la sola sanità. `undefined` quando il conto manca: la
   * sedia tace.
   */
  readonly health?: {
    /** Spesa sociale (sanità + sostegno), in percentuale del PIL. */
    readonly socialBurdenPct: number;
    /** La popolazione del paese, dal conto nazionale. */
    readonly population: number;
    /** Stabilità (0-100), per collegare il sostegno alla tenuta del paese. */
    readonly stability: number;
  };
}

const measured = (source: string): FigureBasis => ({ kind: 'measured', source });

/**
 * Una cifra che il motore **ripartisce**, non misura direttamente.
 *
 * WS-GOVOFFICE-05 — La difesa è l'unica voce esatta del bilancio (il conto
 * dichiara `defenceBurdenPct`); istruzione e spesa sociale sono una quota delle
 * uscite civili ripartita sui pesi reali (atenei, popolazione, sostegno).
 * Etichettarle `estimated` con il metodo è parte dell'onestà: il giocatore deve
 * poterle contestare come stime, non scambiarle per misure.
 */
const estimated = (source: string, method: string): FigureBasis => ({ kind: 'estimated', source, method });

/**
 * L'agenda del Governo: dai fatti dello stato alle scelte.
 *
 * L'ordine delle voci è quello dell'urgenza, non quello dell'invenzione: un
 * deficit materiale che blocca un cantiere viene prima di una fazione scontenta,
 * perché il primo è un fatto e la seconda un'opinione — e il Governo deve dire
 * entrambe, ma nell'ordine giusto.
 */
export function buildAgenda(input: GovernmentAgendaInput): GovernmentAgenda {
  const voices: GovernmentVoice[] = [];

  // ── 1. I deficit: un cantiere fermo è il fatto più duro che esista ───────
  for (const deficit of input.deficits) {
    const isMaterial = deficit.code === 'MATERIAL_SHORTAGE';
    const isWorkforce = deficit.code === 'WORKFORCE_SHORTAGE';
    voices.push({
      id: `deficit_${deficit.code}_${deficit.id}`,
      need: isMaterial
        ? `Manca ${deficit.id}: ${deficit.missing} ${deficit.unit} per una costruzione in corso`
        : isWorkforce
          ? `Manca manodopera qualificata: ${deficit.id}`
          : `Mancano fondi: ${deficit.missing} ${deficit.unit}`,
      because: `Il fabbisogno misurato è ${deficit.required} ${deficit.unit} e il disponibile è ${deficit.available}: il cantiere non parte finché il divario non si chiude.`,
      urgency: 'critica',
      factionId: null,
      figures: [
        { label: 'Fabbisogno', value: deficit.required, unit: deficit.unit, basis: measured('distinta dell’opera e stato del cantiere') },
        { label: 'Disponibile', value: deficit.available, unit: deficit.unit, basis: measured('ledger del ramo, al netto delle riserve attive') },
        { label: 'Mancante', value: deficit.missing, unit: deficit.unit, basis: measured('differenza fra fabbisogno e disponibile') },
      ],
      paths: [
        {
          id: 'produce',
          title: 'Produrre in casa',
          detail: 'Impiegare capacità e manodopera per coprire il divario con la filiera interna.',
          prerequisites: ['capacità produttiva disponibile', 'tempo di lavorazione'],
          expected: 'Il divario si chiude nei tempi della produzione, senza dipendere da altri.',
          recommended: true,
        },
        {
          id: 'procure',
          title: `Cercare ${deficit.id} fuori`,
          detail: 'Trattare con una controparte che ha davvero quella merce: prezzo, rotta e tempi dichiarati.',
          prerequisites: ['una controparte con scorte libere', 'cassa per il prezzo', 'una rotta percorribile'],
          expected: 'La merce arriva dopo il viaggio: il cantiere resta fermo nel frattempo.',
          recommended: false,
        },
        {
          id: 'reduce',
          title: 'Ridimensionare l’opera',
          detail: 'Riconfigurare il progetto su una scala che il paese può coprire adesso.',
          prerequisites: [],
          expected: 'L’opera parte subito, più piccola: l’effetto finale sarà minore.',
          recommended: false,
        },
      ],
    });
  }

  // ── 2-bis. P04 — Il Tesoro riferisce la condizione, non solo la crisi ───
  //
  // Il difetto misurato: con il servizio del debito al 14,1% e la soglia al 15%
  // il Tesoro taceva del tutto, e con lui l'intera seduta — perché è l'unica
  // sedia che ha sempre numeri. Un ministro che parla solo quando il paese è
  // già rotto non è prudente: è assente. La condizione dei conti è un fatto che
  // il paese ha in ogni caso, e riferirla non riempie il silenzio — lo occupa
  // con ciò che il motore misura davvero.
  if (input.cashFlow) {
    const flow = input.cashFlow;
    const deficit = flow.balancePct < 0;
    voices.push({
      id: 'treasury_condition',
      need: deficit
        ? 'Il bilancio chiude in disavanzo e va finanziato'
        : 'Il bilancio chiude in avanzo: decidere che farne',
      because: `Il saldo di bilancio è ${formatGovernmentNumber(flow.balance, 'money')} ${flow.unit} (${formatGovernmentNumber(flow.balancePct, 'percent')}% del PIL), con un carico fiscale effettivo del ${formatGovernmentNumber(input.budget.effectiveTaxRatePct, 'percent')}%. Il debito è al ${formatGovernmentNumber(input.debt.ratioPct, 'percent')}% del PIL e gli interessi assorbono il ${formatGovernmentNumber(input.debt.servicePct, 'percent')}% delle entrate.`,
      urgency: input.debt.servicePct >= 15 || Math.abs(flow.balancePct) >= 5 ? 'urgente' : 'ordinaria',
      factionId: null,
      figures: [
        { label: 'Saldo di bilancio', value: governmentFigureValue(flow.balance, 'money'), unit: `${flow.unit}`, basis: measured('conti nazionali') },
        { label: 'Saldo su PIL', value: governmentFigureValue(flow.balancePct, 'percent'), unit: '%', basis: measured('conti nazionali') },
        { label: 'Debito su PIL', value: governmentFigureValue(input.debt.ratioPct, 'percent'), unit: '%', basis: measured('conti nazionali') },
        { label: 'Interessi su entrate', value: governmentFigureValue(input.debt.servicePct, 'percent'), unit: '%', basis: measured('conti nazionali') },
        { label: 'Prelievo effettivo', value: governmentFigureValue(input.budget.effectiveTaxRatePct, 'percent'), unit: '%', basis: measured('conti nazionali') },
      ],
      paths: deficit
        ? [
            {
              id: 'consolidate',
              title: 'Consolidare i conti',
              detail: 'Ridurre una voce di spesa o alzare il prelievo per chiudere il disavanzo.',
              prerequisites: [],
              expected: 'Il saldo si avvicina al pareggio; meno risorse per la spesa civile.',
              recommended: input.debt.servicePct >= 15,
            },
            {
              id: 'invest',
              title: 'Finanziare la crescita',
              detail: 'Accettare il disavanzo e spenderlo in ciò che aumenta il PIL.',
              prerequisites: ['capacità produttiva', 'tempo'],
              expected: 'Il rapporto debito/PIL migliora lentamente, se l’investimento rende.',
              recommended: input.debt.servicePct < 15,
            },
          ]
        : [
            {
              id: 'repay',
              title: 'Ridurre il debito',
              detail: 'Usare l’avanzo per rimborsare titoli e alleggerire gli interessi.',
              prerequisites: [],
              expected: 'Meno interessi in futuro; meno cassa per altro adesso.',
              recommended: input.debt.servicePct >= 10,
            },
            {
              id: 'invest',
              title: 'Investire l’avanzo',
              detail: 'Impiegare l’avanzo in opere e capacità produttiva.',
              prerequisites: [],
              expected: 'Più PIL e più gettito in futuro; il debito resta dov’è.',
              recommended: input.debt.servicePct < 10,
            },
          ],
    });
  }

  // ── 2-ter. Il debito: quando gli interessi mangiano le entrate ──────────
  if (input.debt.servicePct >= 15) {
    voices.push({
      id: 'debt_service',
      need: 'Gli interessi sul debito assorbono una quota rilevante delle entrate',
      because: `Il rapporto debito/PIL è al ${formatGovernmentNumber(input.debt.ratioPct, 'percent')}% e il servizio del debito pesa il ${formatGovernmentNumber(input.debt.servicePct, 'percent')}% delle entrate.`,
      urgency: input.debt.servicePct >= 25 ? 'critica' : 'urgente',
      factionId: null,
      figures: [
        { label: 'Debito su PIL', value: governmentFigureValue(input.debt.ratioPct, 'percent'), unit: '%', basis: measured('conti nazionali') },
        { label: 'Interessi su entrate', value: governmentFigureValue(input.debt.servicePct, 'percent'), unit: '%', basis: measured('conti nazionali') },
      ],
      paths: [
        {
          id: 'austerity',
          title: 'Ridurre la spesa',
          detail: 'Tagliare una voce di spesa per liberare risorse per gli interessi.',
          prerequisites: [],
          expected: 'Più margine sul bilancio, meno servizio alla cittadinanza.',
          recommended: false,
        },
        {
          id: 'grow',
          title: 'Far crescere il gettito',
          detail: 'Investire in ciò che aumenta il PIL: il rapporto scende anche senza tagliare.',
          prerequisites: ['capacità produttiva', 'tempo'],
          expected: 'Il rapporto migliora lentamente, senza sacrificare la spesa.',
          recommended: true,
        },
      ],
    });
  }

  // ── 3. Le fazioni: una richiesta politica è un fatto politico ───────────
  // Si portano in consiglio le fazioni che pesano E sono scontente: una fazione
  // marginale e serena non merita una scheda, e dirlo è parte dell'onestà della
  // proposta.
  //
  // P04 — La soglia di potere era 10 e i comandi dell'esercito ne avevano 9,2:
  // la fazione più scontenta del paese (34,9/100) restava fuori per meno di un
  // punto, e con lei l'intera seduta. Una fazione con quasi un decimo
  // dell'influenza non è marginale: è la seconda o terza del consiglio. La soglia
  // scende a 5, dove «marginale» comincia davvero.
  for (const faction of [...input.factions]
    .filter(f => f.satisfaction < 45 && f.powerPct >= 5)
    .sort((a, b) => (a.satisfaction * a.powerPct) - (b.satisfaction * b.powerPct))) {
    voices.push({
      id: `faction_${faction.id}`,
      need: `${faction.name}: ${faction.demandTitle}`,
      because: `${faction.name} ha il ${formatGovernmentNumber(faction.powerPct, 'ratio')}% dell'influenza e una soddisfazione di ${formatGovernmentNumber(faction.satisfaction, 'ratio')}/100 (${faction.stance}). ${faction.demandDetail}`,
      urgency: faction.satisfaction < 28 ? 'critica' : 'urgente',
      factionId: faction.id,
      figures: [
        { label: 'Influenza', value: governmentFigureValue(faction.powerPct, 'ratio'), unit: '%', basis: measured('fotografia del governo') },
        { label: 'Soddisfazione', value: governmentFigureValue(faction.satisfaction, 'ratio'), unit: '/100', basis: measured('fotografia del governo') },
        { label: 'Urgenza della richiesta', value: governmentFigureValue(faction.urgency, 'ratio'), unit: '/100', basis: measured('fotografia del governo') },
      ],
      paths: [
        {
          id: 'concede',
          title: 'Accogliere la richiesta',
          detail: faction.demandDetail,
          prerequisites: [],
          expected: 'La fazione si ricompone; un’altra potrebbe risentirne.',
          recommended: false,
        },
        {
          id: 'explain',
          title: 'Spiegare e rimandare',
          detail: 'Portare in consiglio i numeri che rendono la richiesta insostenibile adesso.',
          prerequisites: [],
          expected: 'La fazione resta critica, ma il motivo è documentato e non arbitrario.',
          recommended: true,
        },
      ],
    });
  }

  // ── 4. Cosa si può costruire, e cosa manca per farlo ────────────────────
  for (const work of input.buildable) {
    voices.push({
      id: `build_${work.workId}`,
      work: { workId: work.workId, name: work.name },
      need: `Costruire: ${work.name}`,
      because: work.missing.length === 0
        ? 'La distinta è coperta: l’opera può partire.'
        : `Manca ancora: ${work.missing.join(', ')}.`,
      urgency: 'ordinaria',
      factionId: null,
      figures: work.missing.length === 0
        ? [{ label: 'Copertura', value: '1', unit: 'opera', basis: measured('distinta del catalogo e disponibilità del ledger') }]
        : [{ label: 'Voci scoperte', value: String(work.missing.length), unit: 'voci', basis: measured('distinta del catalogo e disponibilità del ledger') }],
      paths: [
        {
          id: 'build_now',
          title: 'Avviare il cantiere',
          detail: 'Impegnare cassa e materiali e aprire il cantiere adesso.',
          prerequisites: work.missing.length === 0 ? [] : work.missing.map(m => `coprire ${m}`),
          expected: 'Il cantiere avanza e alla fine consegna l’opera con il suo effetto.',
          recommended: work.missing.length === 0,
        },
        {
          id: 'build_later',
          title: 'Preparare e rimandare',
          detail: 'Chiudere prima il divario, poi aprire il cantiere con la distinta completa.',
          prerequisites: [],
          expected: 'Nessun impegno adesso: il cantiere parte quando i materiali ci sono.',
          recommended: work.missing.length > 0,
        },
      ],
    });
  }

  // ── 5. P04 — La Guerra: la condizione delle forze, non l'opinione dei generali
  //
  // Prima di P04 il Ministro della Guerra non esisteva nel codice: la difesa
  // compariva solo come *politica* dentro la fazione «Forze armate» — cioè come
  // qualcuno che chiede più soldi. Ma quanto il paese spende per difendersi è un
  // fatto della sedia, non una corrente di opinione: il ministro lo riferisce in
  // ogni caso, e la tensione dei comandi è una nota dentro la sua relazione.
  if (input.defence) {
    const defence = input.defence;
    const light = defence.burdenPct < 2.6;
    const heavy = defence.burdenPct > 8;
    voices.push({
      id: 'defence_condition',
      need: light
        ? 'La spesa militare è sotto la soglia che i comandi ritengono minima'
        : heavy
          ? 'La spesa militare pesa sul bilancio più di quanto il paese regga'
          : 'Lo strumento militare è finanziato: decidere se basta',
      because: `La difesa vale il ${formatGovernmentNumber(defence.burdenPct, 'percent')}% del PIL, con ${formatGovernmentNumber(defence.forces, 'integer')} reparti in forza e ${formatGovernmentNumber(defence.mobilized, 'integer')} mobilitati.${
        defence.factionSatisfaction !== null
          ? ` I comandi esprimono una soddisfazione di ${formatGovernmentNumber(defence.factionSatisfaction, 'ratio')}/100.`
          : ''
      }`,
      urgency: light && defence.burdenPct < 1.5 ? 'urgente' : 'ordinaria',
      factionId: null,
      figures: [
        { label: 'Spesa di difesa', value: governmentFigureValue(defence.burdenPct, 'percent'), unit: '% del PIL', basis: measured('conto nazionale') },
        { label: 'Reparti in forza', value: governmentFigureValue(defence.forces, 'integer'), unit: 'reparti', basis: measured('conto nazionale') },
        { label: 'Mobilitati', value: governmentFigureValue(defence.mobilized, 'integer'), unit: 'uomini', basis: measured('conto nazionale') },
        ...(defence.factionSatisfaction !== null
          ? [{ label: 'Soddisfazione dei comandi', value: governmentFigureValue(defence.factionSatisfaction, 'ratio'), unit: '/100', basis: measured('fotografia del governo') }]
          : []),
      ],
      paths: light
        ? [
            {
              id: 'rearm',
              title: 'Rinforzare lo strumento militare',
              detail: 'Aumentare la quota di bilancio della difesa e le riserve addestrate.',
              prerequisites: ['copertura di bilancio'],
              expected: 'Più capacità di difesa; meno risorse per la spesa civile.',
              recommended: true,
            },
            {
              id: 'hold',
              title: 'Mantenere la postura attuale',
              detail: 'Accettare il livello di spesa e l’insoddisfazione dei comandi.',
              prerequisites: [],
              expected: 'Nessun costo aggiuntivo; i comandi restano critici.',
              recommended: false,
            },
          ]
        : heavy
          ? [
              {
                id: 'trim',
                title: 'Ridimensionare la spesa',
                detail: 'Rientrare su una quota di difesa che il bilancio sostiene.',
                prerequisites: [],
                expected: 'Più margine civile; meno capacità militare.',
                recommended: input.debt.servicePct >= 15,
              },
              {
                id: 'hold',
                title: 'Difendere il bilancio militare',
                detail: 'Tenere la quota: i comandi chiedono continuità.',
                prerequisites: [],
                expected: 'Capacità invariata; il costo resta sul bilancio.',
                recommended: input.debt.servicePct < 15,
              },
            ]
          : [
              {
                id: 'hold',
                title: 'Mantenere la postura',
                detail: 'Nessun cambio di spesa: la difesa resta dov’è.',
                prerequisites: [],
                expected: 'Continuità dello strumento militare.',
                recommended: true,
              },
              {
                id: 'rearm',
                title: 'Rafforzare ulteriormente',
                detail: 'Alzare la quota per superare i competitor regionali.',
                prerequisites: ['copertura di bilancio'],
                expected: 'Più potenza; più spesa.',
                recommended: false,
              },
            ],
    });
  }

  // ── 6. WS-GOVOFFICE-05 — Istruzione e sanità: la condizione, non la crisi ─
  //
  // Le due sedie nuove riferiscono una voce di spesa che il conto nazionale
  // pubblica in quota di PIL. `education` / `health` sono `undefined` quando il
  // conto non c'è: la sedia **tace**, come il Tesoro e la Guerra — il silenzio
  // non si riempie con una voce inventata.
  if (input.education) {
    const education = input.education;
    voices.push({
      id: 'education_condition',
      need: `L’istruzione e la ricerca valgono il ${formatGovernmentNumber(education.burdenPct, 'percent')}% del PIL: decidere se basta`,
      because: `La spesa per istruzione e ricerca è il ${formatGovernmentNumber(education.burdenPct, 'percent')}% del PIL, con ${formatGovernmentNumber(education.universities, 'integer')} atenei e una tensione sociale di ${formatGovernmentNumber(education.socialTension, 'ratio')}/100.`,
      urgency: 'ordinaria',
      factionId: null,
      figures: [
        { label: 'Spesa per istruzione e ricerca', value: governmentFigureValue(education.burdenPct, 'percent'), unit: '% del PIL', basis: estimated('conti nazionali', 'ripartizione delle uscite civili su atenei e ricerca') },
        { label: 'Atenei', value: governmentFigureValue(education.universities, 'integer'), unit: 'atenei', basis: measured('conto nazionale') },
        { label: 'Tensione sociale', value: governmentFigureValue(education.socialTension, 'ratio'), unit: '/100', basis: measured('conto nazionale') },
      ],
      paths: [
        {
          id: 'invest',
          title: 'Investire in istruzione e ricerca',
          detail: 'Aumentare la quota per scuole e atenei.',
          prerequisites: ['copertura di bilancio'],
          expected: 'Più capitale umano nel tempo; meno risorse altrove adesso.',
          recommended: false,
        },
        {
          id: 'hold',
          title: 'Mantenere la spesa attuale',
          detail: 'Tenere la quota dichiarata e convivere con la tensione.',
          prerequisites: [],
          expected: 'Nessun costo aggiuntivo; la tensione sociale resta.',
          recommended: true,
        },
      ],
    });
  }

  if (input.health) {
    const health = input.health;
    voices.push({
      id: 'health_condition',
      need: `La spesa sociale (sanità e sostegno) vale il ${formatGovernmentNumber(health.socialBurdenPct, 'percent')}% del PIL: decidere come sostenerla`,
      because: `La spesa sociale è il ${formatGovernmentNumber(health.socialBurdenPct, 'percent')}% del PIL — sanità e sostegno insieme, non la sola sanità — con una popolazione di ${formatGovernmentNumber(health.population, 'integer')} e una stabilità di ${formatGovernmentNumber(health.stability, 'ratio')}/100.`,
      urgency: 'ordinaria',
      factionId: null,
      figures: [
        { label: 'Spesa sociale (sanità e sostegno)', value: governmentFigureValue(health.socialBurdenPct, 'percent'), unit: '% del PIL', basis: estimated('conti nazionali', 'ripartizione delle uscite civili su sanità, popolazione e sostegno') },
        { label: 'Popolazione', value: governmentFigureValue(health.population, 'integer'), unit: 'abitanti', basis: measured('conto nazionale') },
        { label: 'Stabilità', value: governmentFigureValue(health.stability, 'ratio'), unit: '/100', basis: measured('conto nazionale') },
      ],
      paths: [
        {
          id: 'expand',
          title: 'Allargare la spesa sociale',
          detail: 'Aumentare la quota per sanità e sostegno.',
          prerequisites: ['copertura di bilancio'],
          expected: 'Più sostegno alla popolazione; più spesa.',
          recommended: false,
        },
        {
          id: 'hold',
          title: 'Mantenere la spesa attuale',
          detail: 'Tenere la quota: la stabilità resta dov’è.',
          prerequisites: [],
          expected: 'Nessun costo aggiuntivo, nessun miglioramento.',
          recommended: true,
        },
      ],
    });
  }

  return {
    voices,
    headline: headlineFor(voices.length, input),
    canonicalMutation: false,
  };
}

function headlineFor(count: number, input: GovernmentAgendaInput): string {
  if (count === 0) return 'Nessuna questione aperta: il consiglio non ha nulla sul tavolo.';
  const critical = input.deficits.length;
  if (critical > 0) return `${count} questioni sul tavolo, di cui ${critical} bloccanti per un cantiere.`;
  return `${count} questioni sul tavolo.`;
}

/** Ripartizione del carico fiscale in unità minime. */
export function fiscalShares(total: IntString, weights: readonly number[]): readonly IntString[] {
  const sum = weights.reduce((acc, w) => acc + w, 0);
  if (sum <= 0) throw new Error('pesi non positivi');
  const amount = parseInteger(total, 'total');
  return weights.map(weight => intToString((amount * BigInt(Math.round(weight * 1000))) / BigInt(Math.round(sum * 1000))));
}
