/**
 * WS-GOV-SEAT-BOARDS — La Tavola è infrastruttura del Governo, non del Tesoro
 * ==========================================================================
 * Il difetto osservato: la Tavola decisionale era nata per il Tesoro e la sua
 * struttura (sezioni, catalogo di evidenze, titolo) valeva per **tutte** le
 * sedie. Un ministro dei Lavori vedeva il grafico del bilancio, una sedia senza
 * competenza finanziaria mostrava l'ammortamento del debito.
 *
 * Qui la lettura diventa **seat-aware**: per ogni sedia una configurazione
 * dichiara
 *  - come si chiama la sua Tavola e il suo obiettivo;
 *  - in quali **sezioni** si compongono le misure della proposta (mappa
 *    `DecisionMeasureKind` → etichetta di competenza);
 *  - quali **evidenze** può presentare (`availableEvidence`): la stessa chiave
 *    del catalogo `presentation.ts`, non un dato nuovo;
 *  - quali sezioni nascono chiuse.
 *
 * Regole, le stesse del progetto:
 *  - **nessun dato nuovo**: la configurazione decide solo **come leggere e
 *    presentare** i read model esistenti;
 *  - il catalogo delle evidenze è **la stessa** `EvidenceKey` di
 *    `presentation.ts` (mappa `BLOCK_ID_BY_KEY`), non una tassonomia parallela;
 *  - la mappa sedia → competenza è la **trascrizione** di `SEAT_READS` del
 *    motore (come `seatDomains.ts`), tenuta vicina per non divergere.
 *
 * Modulo **puro**: nessun I/O, nessuno stato, nessuna chiamata al modello.
 */
import type { CabinetAddressView } from '../../services/api';
import type { DecisionMeasure, DecisionMeasureKind, NegotiatedProposal } from './decisionWorkspace';
import type { EvidenceKey } from './presentation';

/** La sedia del gabinetto: la stessa unione di `CabinetAddressView`. */
export type CabinetSeat = CabinetAddressView['seat'];

/**
 * La chiave di una sezione della Tavola: l'obiettivo, oppure il `kind` di una
 * misura. Non è un tipo nuovo di misura — è la stessa tassonomia di
 * `DecisionMeasureKind`, usata come **indice di presentazione**.
 */
export type BoardSectionKey = 'objective' | DecisionMeasureKind;

/** Una sezione della Tavola: l'etichetta di competenza di un gruppo di misure. */
export interface SeatBoardSection {
  readonly key: BoardSectionKey;
  readonly label: string;
  readonly hint?: string;
}

/** La configurazione della Tavola di una sedia. Decide come **leggere**, non il dato. */
export interface SeatDecisionBoardConfig {
  readonly seat: CabinetSeat;
  /** Il titolo della Tavola («La tavola dei Lavori»). */
  readonly title: string;
  /** La competenza dichiarata, dalla trascrizione di `SEAT_READS`. */
  readonly competence: string;
  /** Come si chiama l'obiettivo per questa sedia. */
  readonly objectiveLabel: string;
  /** Le sezioni primarie, in ordine di competenza. */
  readonly primarySections: readonly SeatBoardSection[];
  /** Le sezioni secondarie (tipicamente chiuse). */
  readonly secondarySections: readonly SeatBoardSection[];
  /** Le evidenze che questa sedia può presentare sulla tavola. */
  readonly availableEvidence: readonly EvidenceKey[];
  /** Le sezioni che nascono chiuse. */
  readonly defaultCollapsedSections: readonly BoardSectionKey[];
}

const section = (key: BoardSectionKey, label: string, hint?: string): SeatBoardSection =>
  (hint ? { key, label, hint } : { key, label });

/**
 * Le sette Tavole. Le sezioni sono la trascrizione della competenza dichiarata
 * dal motore (`SEAT_READS`, in `backend-nest/src/core/government/Cabinet.ts`);
 * il catalogo delle evidenze limita ciò che la sedia può **mostrare** senza
 * inventare blocchi di un'altra sedia.
 */
export const SEAT_DECISION_BOARDS: Record<CabinetSeat, SeatDecisionBoardConfig> = {
  // «bilancio, debito, cassa e crediti»
  tesoro: {
    seat: 'tesoro',
    title: 'La tavola del Tesoro',
    competence: 'Bilancio, debito, cassa e copertura',
    objectiveLabel: 'Obiettivo di bilancio',
    primarySections: [
      section('allocation', 'Allocazioni'),
      section('target', 'Copertura e obiettivi'),
      section('constraint', 'Vincoli di bilancio'),
      section('priority', 'Priorità di spesa'),
    ],
    secondarySections: [
      section('region', 'Distribuzione territoriale'),
      section('work', 'Opere finanziate'),
      section('other', 'Altre misure'),
    ],
    // Il Tesoro è l'unica sedia che può mostrare il bilancio per voci: è la sua
    // materia. Le altre vedono l'andamento del tempo, non la ripartizione.
    availableEvidence: ['spesa', 'trend', 'cifre', 'piano', 'mappa', 'idee'],
    defaultCollapsedSections: ['region', 'work', 'other'],
  },
  // «cantieri, deficit misurati, opere»
  lavori: {
    seat: 'lavori',
    title: 'La tavola dei Lavori',
    competence: 'Opere, cantieri, materiali e localizzazione',
    objectiveLabel: 'Obiettivo dell’opera',
    primarySections: [
      section('work', 'Opera'),
      section('region', 'Regione', 'Dove si costruisce: si decide prima di partire.'),
      section('constraint', 'Materiali e vincoli'),
      section('target', 'Tempi'),
    ],
    secondarySections: [
      section('allocation', 'Risorse'),
      section('priority', 'Priorità di cantiere'),
      section('other', 'Altre misure'),
    ],
    availableEvidence: ['trend', 'cifre', 'piano', 'mappa', 'idee'],
    defaultCollapsedSections: ['priority', 'other'],
  },
  // «scuole e atenei, spesa, tensione»
  istruzione: {
    seat: 'istruzione',
    title: 'La tavola dell’Istruzione',
    competence: 'Scuole, atenei, personale e formazione',
    objectiveLabel: 'Obiettivo formativo',
    primarySections: [
      section('target', 'Scuole e atenei'),
      section('region', 'Territori'),
      section('allocation', 'Investimenti'),
      section('priority', 'Priorità formative'),
    ],
    secondarySections: [
      section('work', 'Strutture'),
      section('constraint', 'Vincoli'),
      section('other', 'Altre misure'),
    ],
    availableEvidence: ['trend', 'cifre', 'piano', 'mappa', 'idee'],
    defaultCollapsedSections: ['work', 'other'],
  },
  // «spesa sociale (sanità e sostegno), popolazione»
  sanita: {
    seat: 'sanita',
    title: 'La tavola della Sanità',
    competence: 'Bisogni sanitari, copertura e strutture',
    objectiveLabel: 'Obiettivo sanitario',
    primarySections: [
      section('target', 'Bisogno sanitario'),
      section('region', 'Popolazione e strutture'),
      section('allocation', 'Copertura'),
      section('constraint', 'Vincoli'),
    ],
    secondarySections: [
      section('priority', 'Priorità di cura'),
      section('work', 'Strutture'),
      section('other', 'Altre misure'),
    ],
    availableEvidence: ['trend', 'cifre', 'piano', 'mappa', 'idee'],
    defaultCollapsedSections: ['work', 'other'],
  },
  // «relazioni, contratti, deficit copribile»
  esteri: {
    seat: 'esteri',
    title: 'La tavola degli Esteri',
    competence: 'Relazioni, trattati e rischi diplomatici',
    objectiveLabel: 'Obiettivo diplomatico',
    primarySections: [
      section('target', 'Interlocutori e trattati'),
      section('priority', 'Relazioni'),
      section('constraint', 'Rischi diplomatici'),
    ],
    secondarySections: [
      section('allocation', 'Impegni'),
      section('work', 'Missioni'),
      section('region', 'Teatri'),
      section('other', 'Altre misure'),
    ],
    // La diplomazia non ha una mappa del paese: nessun blocco territoriale.
    availableEvidence: ['cifre', 'piano', 'idee'],
    defaultCollapsedSections: ['work', 'region', 'other'],
  },
  // «fazioni, pressione politica, coesione»
  interno: {
    seat: 'interno',
    title: 'La tavola dell’Interno',
    competence: 'Consenso, fazioni e ordine pubblico',
    objectiveLabel: 'Obiettivo di coesione',
    primarySections: [
      section('target', 'Consenso e stabilità'),
      section('priority', 'Fazioni'),
      section('constraint', 'Ordine pubblico'),
    ],
    secondarySections: [
      section('allocation', 'Risorse'),
      section('region', 'Territori'),
      section('work', 'Interventi'),
      section('other', 'Altre misure'),
    ],
    availableEvidence: ['trend', 'cifre', 'piano', 'mappa', 'idee'],
    defaultCollapsedSections: ['work', 'other'],
  },
  // «potenza e arsenale, minacce al confine»
  guerra: {
    seat: 'guerra',
    title: 'La tavola della Guerra',
    competence: 'Forze, arsenali, fronti e logistica',
    objectiveLabel: 'Obiettivo militare',
    primarySections: [
      section('work', 'Forze e unità'),
      section('target', 'Fronti e minacce'),
      section('allocation', 'Arsenali e scorte'),
      section('constraint', 'Logistica'),
    ],
    secondarySections: [
      section('priority', 'Priorità operative'),
      section('region', 'Teatri'),
      section('other', 'Altre misure'),
    ],
    availableEvidence: ['trend', 'cifre', 'piano', 'mappa', 'idee'],
    defaultCollapsedSections: ['region', 'other'],
  },
};

/** La configurazione della Tavola di una sedia. */
export function seatBoardConfig(seat: CabinetSeat): SeatDecisionBoardConfig {
  return SEAT_DECISION_BOARDS[seat] ?? SEAT_DECISION_BOARDS.tesoro;
}

/** Tutte le sedie in ordine dichiarato: serve ai test e alle riunioni. */
export const CABINET_SEATS: readonly CabinetSeat[] = [
  'tesoro', 'lavori', 'istruzione', 'sanita', 'esteri', 'interno', 'guerra',
];

/** Questa sedia può presentare questa evidenza? */
export function seatAllowsEvidence(seat: CabinetSeat, evidence: EvidenceKey): boolean {
  return seatBoardConfig(seat).availableEvidence.includes(evidence);
}

/** La sezione che accoglie una misura, primaria o secondaria, o `null`. */
export function sectionForKind(config: SeatDecisionBoardConfig, kind: BoardSectionKey): SeatBoardSection | null {
  return config.primarySections.find(entry => entry.key === kind)
    ?? config.secondarySections.find(entry => entry.key === kind)
    ?? null;
}

/** Questa sezione nasce chiusa? */
export function isCollapsedSection(config: SeatDecisionBoardConfig, kind: BoardSectionKey): boolean {
  return config.defaultCollapsedSections.includes(kind);
}

/** Un gruppo di misure sotto la sua sezione di competenza. */
export interface MeasureSection {
  readonly section: SeatBoardSection;
  readonly measures: readonly DecisionMeasure[];
  readonly collapsed: boolean;
}

/**
 * Compone le misure della proposta nelle sezioni della sedia, nell'ordine della
 * configurazione. Le sezioni senza misure **non compaiono**: la Tavola non
 * mostra una sezione vuota solo perché esiste nella configurazione.
 */
export function groupProposalMeasures(
  proposal: NegotiatedProposal | null,
  config: SeatDecisionBoardConfig,
): MeasureSection[] {
  if (!proposal || proposal.measures.length === 0) return [];
  const buckets = new Map<BoardSectionKey, DecisionMeasure[]>();
  for (const measure of proposal.measures) {
    const list = buckets.get(measure.kind) ?? [];
    list.push(measure);
    buckets.set(measure.kind, list);
  }
  return [...config.primarySections, ...config.secondarySections]
    .map(entry => ({
      section: entry,
      measures: buckets.get(entry.key) ?? [],
      collapsed: config.defaultCollapsedSections.includes(entry.key),
    }))
    .filter(group => group.measures.length > 0);
}
