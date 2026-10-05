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
import { formatGovernmentNumber, governmentFigureValue, type GovernmentNumberKind } from './GovernmentNumberFormat';
import { evaluateGovernmentSalience, type GovernmentSalienceContext } from './GovernmentSalience';
export type { GovernmentSalienceContext } from './GovernmentSalience';

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
  /** Optional measured context: missing/null facts are never replaced with zero. */
  readonly salience?: GovernmentSalienceContext;
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
  /** Catalogo leggibile fuori agenda. `missing: []` significa distinta (cassa inclusa) coperta, non autorizzazione a costruire. */
  readonly buildable: readonly { readonly workId: string; readonly name: string; readonly missing: readonly string[] }[];
  /** La valuta di conto, per le cifre monetarie. */
  readonly currencyId: string;
  /**
   * Conto militare leggibile: spesa e forze permanenti da sole non sono bisogni.
   * La mobilitazione o i fatti operativi di `salience` possono giustificare una
   * richiesta. Se il conto manca, si mostrano soltanto i fatti davvero noti.
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
   * Conti leggibili nel dossier; una condizione normale non è una richiesta.
   * Il Tesoro porta in agenda solo una questione fiscalmente significativa.
   */
  readonly cashFlow?: {
    /** Saldo MENSILE / PIL nominale ANNUO * 100: non è annualizzato qui. */
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
    readonly burdenPct?: number;
    /** Gli atenei del paese, dal conto nazionale, se noti. */
    readonly universities?: number;
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
    readonly socialBurdenPct?: number;
    /** La popolazione del paese, dal conto nazionale, se nota. */
    readonly population?: number;
    /** Stabilità (0-100), per collegare il sostegno alla tenuta del paese. */
    readonly stability: number;
  };
}

const measured = (source: string): FigureBasis => ({ kind: 'measured', source });
const finite = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value);

/** Supporting numbers may be absent even when the need is verified. */
function knownFigure(label: string, value: number | undefined, kind: GovernmentNumberKind, unit: string, basis: FigureBasis): Figure[] {
  return finite(value) ? [{ label, value: governmentFigureValue(value, kind), unit, basis }] : [];
}
function debtDetail(debt: GovernmentAgendaInput['debt']): string {
  return [
    finite(debt.ratioPct) ? ` Il debito è al ${formatGovernmentNumber(debt.ratioPct, 'percent')}% del PIL.` : '',
    finite(debt.servicePct) ? ` Gli interessi assorbono il ${formatGovernmentNumber(debt.servicePct, 'percent')}% delle entrate.` : '',
  ].join('');
}

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
  const salient = evaluateGovernmentSalience(input);

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
          expected: 'Il divario potrebbe chiudersi se capacità e produzione sono confermate nei tempi necessari.',
          recommended: true,
        },
        {
          id: 'procure',
          title: `Cercare ${deficit.id} fuori`,
          detail: 'Trattare con una controparte che ha davvero quella merce: prezzo, rotta e tempi dichiarati.',
          prerequisites: ['una controparte con scorte libere', 'cassa per il prezzo', 'una rotta percorribile'],
          expected: 'La merce potrebbe arrivare se accordo e rotta sono confermati; il cantiere resta bloccato finché manca copertura.',
          recommended: false,
        },
        {
          id: 'reduce',
          title: 'Ridimensionare l’opera',
          detail: 'Riconfigurare il progetto su una scala che il paese può coprire adesso.',
          prerequisites: [],
          expected: 'L’opera potrebbe partire su scala minore se il nuovo preflight è coperto; l’effetto va verificato.',
          recommended: false,
        },
      ],
    });
  }

  // ── 2. Un’unica scelta fiscale, solo se i fatti la rendono significativa ──
  if (input.cashFlow && salient.treasury) {
    const flow = input.cashFlow;
    const deficit = flow.balancePct < 0;
    voices.push({
      id: 'treasury_condition',
      need: input.debt.servicePct >= 15
        ? 'Il servizio del debito richiede una scelta fiscale'
        : deficit
          ? 'Il bilancio chiude in disavanzo e va finanziato'
          : salient.investmentCandidates.length > 0
            ? 'Il bilancio chiude in avanzo: valutare un investimento coperto'
            : 'I conti sono cambiati significativamente: rivedere la scelta fiscale',
      because: `${salient.treasury.because} Il saldo mensile di bilancio è ${formatGovernmentNumber(flow.balance, 'money')} ${flow.unit} (${formatGovernmentNumber(flow.balancePct, 'percent')}% del PIL nominale annuo, non annualizzato).${finite(input.budget.effectiveTaxRatePct) ? ` Il carico fiscale effettivo è il ${formatGovernmentNumber(input.budget.effectiveTaxRatePct, 'percent')}%.` : ''}${debtDetail(input.debt)}`,
      urgency: salient.treasury.urgency,
      factionId: null,
      figures: [
        { label: 'Saldo di bilancio', value: governmentFigureValue(flow.balance, 'money'), unit: `${flow.unit}`, basis: measured('conti nazionali') },
        { label: 'Saldo su PIL', value: governmentFigureValue(flow.balancePct, 'percent'), unit: '% mensile/PIL annuo', basis: measured('conti nazionali: saldo mensile / PIL nominale annuo * 100') },
        ...knownFigure('Debito su PIL', input.debt.ratioPct, 'percent', '%', measured('conti nazionali')),
        ...knownFigure('Interessi su entrate', input.debt.servicePct, 'percent', '%', measured('conti nazionali')),
        ...knownFigure('Prelievo effettivo', input.budget.effectiveTaxRatePct, 'percent', '%', measured('conti nazionali')),
        ...salient.treasury.figures,
      ],
      paths: deficit
        ? [
            {
              id: 'consolidate',
              title: 'Consolidare i conti',
              detail: 'Ridurre una voce di spesa o alzare il prelievo per chiudere il disavanzo.',
              prerequisites: [],
              expected: 'Proposta: il saldo potrebbe avvicinarsi al pareggio se la misura è approvata e coperta; meno risorse civili.',
              recommended: input.debt.servicePct >= 15,
            },
            {
              id: 'invest',
              title: 'Finanziare la crescita',
              detail: 'Accettare il disavanzo e spenderlo in ciò che aumenta il PIL.',
              prerequisites: ['capacità produttiva', 'tempo'],
              expected: 'Il rapporto debito/PIL potrebbe migliorare se l’investimento verificato rende; non è un effetto garantito.',
              recommended: input.debt.servicePct < 15,
            },
          ]
        : [
            {
              id: 'repay',
              title: 'Ridurre il debito',
              detail: 'Valutare un rimborso solo con risorse effettivamente disponibili, senza presumere un avanzo investibile.',
              prerequisites: ['cassa libera verificata', 'titoli rimborsabili'],
              expected: 'Proposta: meno interessi in futuro se il rimborso è fattibile; meno cassa per altro adesso.',
              recommended: input.debt.servicePct >= 10,
            },
            {
              id: salient.investmentCandidates.length > 0 ? 'invest' : 'hold',
              title: salient.investmentCandidates.length > 0 ? 'Investire l’avanzo' : 'Mantenere il margine e verificare i conti',
              detail: salient.investmentCandidates.length > 0
                ? 'Valutare l’avanzo nelle opere con distinta coperta, prima del preflight.'
                : 'Non impegnare nuove risorse; verificare la sostenibilità dei conti e i progetti prima di proporre spesa.',
              prerequisites: salient.investmentCandidates.length > 0
                ? ['progetto verificato', 'preflight e copertura confermata al momento della firma'] : [],
              expected: salient.investmentCandidates.length > 0
                ? 'PIL e gettito potrebbero crescere se l’investimento rende; nessun effetto o impegno è garantito.'
                : 'Proposta: nessun nuovo impegno; il saldo potrebbe cambiare comunque e richiede monitoraggio.',
              recommended: input.debt.servicePct < 10,
            },
          ],
    });
  }

  // ── 2-ter. Il debito: quando gli interessi mangiano le entrate ──────────
  if (!input.cashFlow && salient.treasury) {
    voices.push({
      id: 'debt_service',
      need: input.debt.servicePct >= 15
        ? 'Gli interessi sul debito assorbono una quota rilevante delle entrate'
        : salient.treasury.cashRunwayOnly
          ? 'La cassa non copre tre mesi di disavanzo: rivedere i conti'
          : 'Il servizio del debito è cambiato significativamente: rivedere i conti',
      because: `${salient.treasury.because}${debtDetail(input.debt)}`,
      urgency: salient.treasury.urgency,
      factionId: null,
      figures: [
        ...knownFigure('Debito su PIL', input.debt.ratioPct, 'percent', '%', measured('conti nazionali')),
        ...knownFigure('Interessi su entrate', input.debt.servicePct, 'percent', '%', measured('conti nazionali')),
        ...salient.treasury.figures,
      ],
      paths: [
        {
          id: 'austerity',
          title: 'Ridurre la spesa',
          detail: 'Tagliare una voce di spesa per liberare risorse per gli interessi.',
          prerequisites: [],
          expected: 'Proposta: più margine sul bilancio se il taglio è attuabile, con possibili costi per la cittadinanza.',
          recommended: false,
        },
        {
          id: 'grow',
          title: 'Far crescere il gettito',
          detail: 'Investire in ciò che aumenta il PIL: il rapporto scende anche senza tagliare.',
          prerequisites: ['capacità produttiva', 'tempo'],
          expected: 'Il rapporto potrebbe migliorare se l’investimento rende; crescita e gettito non sono garantiti.',
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
          expected: 'La fazione potrebbe ricomporsi se la richiesta è attuabile; altre potrebbero risentirne.',
          recommended: false,
        },
        {
          id: 'explain',
          title: 'Spiegare e rimandare',
          detail: 'Portare in consiglio i numeri che rendono la richiesta insostenibile adesso.',
          prerequisites: [],
          expected: 'Proposta: documentare il rinvio; la fazione potrebbe restare critica, non si presume un effetto sul consenso.',
          recommended: true,
        },
      ],
    });
  }

  // ── 4. Catalogo ≠ agenda: solo avanzo significativo + distinta coperta ──
  for (const work of salient.investmentCandidates) {
    voices.push({
      id: `build_${work.workId}`,
      work: { workId: work.workId, name: work.name },
      need: `Costruire: ${work.name}`,
      because: `L’avanzo mensile su PIL annuo è almeno l’1% e la distinta di ${work.name} è coperta: una proposta di investimento, soggetta a preflight.`,
      urgency: 'ordinaria',
      factionId: null,
      figures: [
        { label: 'Copertura', value: '1', unit: 'opera', basis: measured('distinta del catalogo e disponibilità del ledger') },
        { label: 'Saldo su PIL', value: governmentFigureValue(input.cashFlow!.balancePct, 'percent'), unit: '% mensile/PIL annuo', basis: measured('conti nazionali: saldo mensile / PIL nominale annuo * 100') },
      ],
      paths: [
        {
          id: 'build_now',
          title: 'Avviare il cantiere',
          detail: 'Impegnare cassa e materiali e aprire il cantiere adesso.',
          prerequisites: ['preflight e copertura confermata al momento della firma'],
          expected: 'L’opera potrebbe essere consegnata se firma, copertura e lavorazione sono confermate; nessun impegno adesso.',
          recommended: true,
        },
        {
          id: 'build_later',
          title: 'Preparare e rimandare',
          detail: 'Chiudere prima il divario, poi aprire il cantiere con la distinta completa.',
          prerequisites: [],
          expected: 'Proposta: nessun impegno adesso; il cantiere potrebbe partire dopo una nuova verifica di copertura.',
          recommended: false,
        },
      ],
    });
  }

  // ── 5. Postura militare: fatti operativi, mai bilancio o truppe da soli ──
  if (salient.defence) {
    const defence = input.defence;
    const condition = salient.defence;
    const readiness = condition.priority === 'readiness';
    const threat = condition.priority === 'threat';
    voices.push({
      id: 'defence_condition',
      need: condition.need,
      because: `${condition.because}${finite(defence?.burdenPct) ? ` La difesa vale il ${formatGovernmentNumber(defence.burdenPct, 'percent')}% del PIL.` : ''}${finite(defence?.forces) ? ` Reparti in forza: ${formatGovernmentNumber(defence.forces, 'integer')}.` : ''}${finite(defence?.mobilized) ? ` Mobilitati: ${formatGovernmentNumber(defence.mobilized, 'integer')}.` : ''}${finite(defence?.factionSatisfaction) ? ` I comandi esprimono una soddisfazione di ${formatGovernmentNumber(defence.factionSatisfaction, 'ratio')}/100.` : ''}`,
      urgency: condition.urgency,
      factionId: null,
      figures: [
        ...knownFigure('Spesa di difesa', defence?.burdenPct, 'percent', '% del PIL', measured('conto nazionale')),
        ...knownFigure('Reparti in forza', defence?.forces, 'integer', 'reparti', measured('conto nazionale')),
        ...knownFigure('Mobilitati', defence?.mobilized, 'integer', 'uomini', measured('conto nazionale')),
        ...knownFigure('Soddisfazione dei comandi', defence?.factionSatisfaction ?? undefined, 'ratio', '/100', measured('fotografia del governo')),
        ...condition.figures,
      ],
      paths: [
        {
          id: readiness ? 'restore_readiness' : threat ? 'review_posture' : 'review_operations',
          title: readiness ? 'Verificare e ripristinare la prontezza' : threat ? 'Rivedere la postura difensiva' : 'Rivedere operazioni e mobilitazione',
          detail: readiness
            ? 'Verificare addestramento, manutenzione e rifornimenti prima di proporre impieghi aggiuntivi.'
            : threat
              ? 'Valutare protezione e canali diplomatici sulla minaccia registrata, senza presumere un nuovo conflitto.'
              : 'Verificare obiettivi, tempi e copertura delle operazioni effettive e della mobilitazione.',
          prerequisites: ['verifica operativa', 'copertura di bilancio e materiali', 'preflight degli eventuali ordini'],
          expected: 'La capacità potrebbe migliorare se le carenze verificate sono colmate; nessun esito militare è garantito.',
          recommended: true,
        },
        {
          id: 'hold',
          title: 'Limitare nuovi impegni e monitorare',
          detail: 'Non aggiungere operazioni adesso; riesaminare i fatti disponibili e il rischio prima della firma.',
          prerequisites: [],
          expected: 'Proposta: nessun nuovo impegno adesso; il rischio potrebbe persistere e va rivalutato.',
          recommended: false,
        },
      ],
    });
  }

  // ── 6. Disagio civile o variazioni misurate, non contabilità ordinaria ──
  if (input.education && salient.education) {
    const education = input.education;
    voices.push({
      id: 'education_condition',
      need: 'Valutare l’istruzione e la ricerca alla luce della tensione sociale osservata',
      because: `${salient.education.because}${finite(education.burdenPct) ? ` La spesa stimata per istruzione e ricerca è il ${formatGovernmentNumber(education.burdenPct, 'percent')}% del PIL.` : ''}${finite(education.universities) ? ` Atenei: ${formatGovernmentNumber(education.universities, 'integer')}.` : ''}`,
      urgency: salient.education.urgency,
      factionId: null,
      figures: [
        ...knownFigure('Spesa per istruzione e ricerca', education.burdenPct, 'percent', '% del PIL', estimated('conti nazionali', 'ripartizione delle uscite civili su atenei e ricerca')),
        ...knownFigure('Atenei', education.universities, 'integer', 'atenei', measured('conto nazionale')),
        { label: 'Tensione sociale', value: governmentFigureValue(education.socialTension, 'ratio'), unit: '/100', basis: measured('conto nazionale') },
        ...salient.education.figures,
      ],
      paths: [
        {
          id: 'invest',
          title: 'Investire in istruzione e ricerca',
          detail: 'Aumentare la quota per scuole e atenei.',
          prerequisites: ['copertura di bilancio'],
          expected: 'Il capitale umano potrebbe crescere se l’intervento è coperto e funziona; non è una cura garantita della tensione.',
          recommended: false,
        },
        {
          id: 'hold',
          title: 'Mantenere la spesa attuale',
          detail: 'Tenere la quota dichiarata e verificare le cause della tensione osservata.',
          prerequisites: [],
          expected: 'Proposta: nessun nuovo impegno; la tensione potrebbe persistere e va monitorata.',
          recommended: true,
        },
      ],
    });
  }

  if (input.health && salient.health) {
    const health = input.health;
    voices.push({
      id: 'health_condition',
      need: 'Valutare sanità e sostegno nel quadro della stabilità osservata',
      because: `${salient.health.because}${finite(health.socialBurdenPct) ? ` La spesa sociale stimata è il ${formatGovernmentNumber(health.socialBurdenPct, 'percent')}% del PIL — sanità e sostegno insieme, non la sola sanità.` : ''}${finite(health.population) ? ` Popolazione: ${formatGovernmentNumber(health.population, 'integer')}.` : ''}`,
      urgency: salient.health.urgency,
      factionId: null,
      figures: [
        ...knownFigure('Spesa sociale (sanità e sostegno)', health.socialBurdenPct, 'percent', '% del PIL', estimated('conti nazionali', 'ripartizione delle uscite civili su sanità, popolazione e sostegno')),
        ...knownFigure('Popolazione', health.population, 'integer', 'abitanti', measured('conto nazionale')),
        { label: 'Stabilità', value: governmentFigureValue(health.stability, 'ratio'), unit: '/100', basis: measured('conto nazionale') },
        ...salient.health.figures,
      ],
      paths: [
        {
          id: 'expand',
          title: 'Allargare la spesa sociale',
          detail: 'Aumentare la quota per sanità e sostegno.',
          prerequisites: ['copertura di bilancio'],
          expected: 'Il sostegno potrebbe aumentare se la misura è coperta e raggiunge la popolazione; la stabilità non è garantita.',
          recommended: false,
        },
        {
          id: 'hold',
          title: 'Mantenere la spesa attuale',
          detail: 'Tenere la quota e verificare altre cause della stabilità osservata.',
          prerequisites: [],
          expected: 'Proposta: nessun nuovo impegno; la stabilità potrebbe cambiare comunque e va monitorata.',
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
