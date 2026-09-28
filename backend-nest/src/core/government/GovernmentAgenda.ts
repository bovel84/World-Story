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
}

const measured = (source: string): FigureBasis => ({ kind: 'measured', source });

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

  // ── 2. Il debito: quando gli interessi mangiano le entrate ──────────────
  if (input.debt.servicePct >= 15) {
    voices.push({
      id: 'debt_service',
      need: 'Gli interessi sul debito assorbono una quota rilevante delle entrate',
      because: `Il rapporto debito/PIL è al ${input.debt.ratioPct}% e il servizio del debito pesa il ${input.debt.servicePct}% delle entrate.`,
      urgency: input.debt.servicePct >= 25 ? 'critica' : 'urgente',
      factionId: null,
      figures: [
        { label: 'Debito su PIL', value: String(input.debt.ratioPct), unit: '%', basis: measured('conti nazionali') },
        { label: 'Interessi su entrate', value: String(input.debt.servicePct), unit: '%', basis: measured('conti nazionali') },
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
  for (const faction of [...input.factions]
    .filter(f => f.satisfaction < 45 && f.powerPct >= 10)
    .sort((a, b) => (a.satisfaction * a.powerPct) - (b.satisfaction * b.powerPct))) {
    voices.push({
      id: `faction_${faction.id}`,
      need: `${faction.name}: ${faction.demandTitle}`,
      because: `${faction.name} ha il ${faction.powerPct}% dell'influenza e una soddisfazione di ${faction.satisfaction}/100 (${faction.stance}). ${faction.demandDetail}`,
      urgency: faction.satisfaction < 28 ? 'critica' : 'urgente',
      factionId: faction.id,
      figures: [
        { label: 'Influenza', value: String(faction.powerPct), unit: '%', basis: measured('fotografia del governo') },
        { label: 'Soddisfazione', value: String(faction.satisfaction), unit: '/100', basis: measured('fotografia del governo') },
        { label: 'Urgenza della richiesta', value: String(faction.urgency), unit: '/100', basis: measured('fotografia del governo') },
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
