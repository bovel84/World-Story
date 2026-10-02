/**
 * WS-GOVUX-P7 — La plancia delle conseguenze (Consequence board)
 * =============================================================
 * Prima della firma il Presidente deve vedere **cosa succederà**, distinto e
 * etichettato:
 *  - **effetti diretti calcolati** — quello che il motore applica davvero
 *    all'esecuzione (costi dalla verifica di fattibilità, distinta, cantiere);
 *  - **previsioni del motore** — benefici e copertura dichiarati dal catalogo;
 *  - **rischi** — distinta scoperta, vincoli, blocchi della verifica;
 *  - **incertezze** — voci stimate o mancanti, effetti non simulati.
 *
 * Quattro regole, le stesse del progetto:
 *  - la plancia è un **read model puro**: legge bozza, strada e verifica del
 *    motore; **non** tocca salvataggi, risorse, turno, code eventi o RNG;
 *  - **i costi della preview sono gli stessi che il motore applica**: la stima
 *    arriva dalla verifica di fattibilità (`checkFeasibility`), che usa la
 *    stessa funzione di costo dell'esecuzione; qui non si ricalcola niente;
 *  - **modificare la bozza invalida la stima**: la firma del preventivo cambia
 *    con il testo e con lo snapshot, e la stima vecchia è dichiarata `stale`;
 *  - **ciò che non è simulato è dichiarato non stimabile**, mai una percentuale
 *    inventata.
 *
 * Modulo **puro**: nessun I/O, nessuno stato, nessuna chiamata.
 */
import type { CabinetItemView } from '../../services/api';
import { orderKey, type ProposalActDraft } from './actDraft';
import { compareRoads, SOCIAL_EFFECTS_NOTE, type ConsequenceBasis } from './consequences';
import type { TreasuryRoad } from './treasuryAct';

export type ConsequenceGroupId = 'direct' | 'predicted' | 'risks' | 'uncertainties';
export type ConsequenceTone = 'neutral' | 'positive' | 'warning' | 'critical';

export interface ConsequenceEntry {
  readonly label: string;
  readonly detail: string;
  /** Provenienza del dato (riusa la grammatica del confronto delle proposte). */
  readonly basis: ConsequenceBasis;
  readonly tone: ConsequenceTone;
  /** `true` quando il motore lo applica esattamente così: non è una previsione. */
  readonly applied: boolean;
}

export interface ConsequenceGroup {
  readonly id: ConsequenceGroupId;
  readonly label: string;
  readonly entries: readonly ConsequenceEntry[];
}

export const CONSEQUENCE_GROUP_LABEL: Record<ConsequenceGroupId, string> = {
  direct: 'Effetti diretti calcolati',
  predicted: 'Previsioni del motore',
  risks: 'Rischi',
  uncertainties: 'Incertezze',
};

/** La verifica di fattibilità del motore, come la restituisce la rotta. */
export interface EnginePreview {
  readonly feasible: boolean;
  readonly costs: {
    readonly timeDays: number;
    readonly inputs: readonly { resourceId: string; name: string; quantity: string; unit: string }[];
    readonly upkeep: readonly {
      line: { resourceId: string; name: string; quantity: string; unit: string };
      periodDays: number;
    }[];
    readonly basis: 'recipe' | 'upkeep' | 'request' | 'none';
    readonly note?: string;
    readonly category?: string;
  };
  readonly prerequisites: readonly string[];
  readonly risks: readonly string[];
  readonly warnings: readonly string[];
  readonly summary: string;
}

export type PreviewStatus = 'engine-preview' | 'declared' | 'not-estimable';

export interface ConsequenceBoard {
  /** Firma del preventivo: cambia con testo della bozza e snapshot del mondo. */
  readonly signature: string;
  readonly status: PreviewStatus;
  readonly statusNote: string;
  readonly groups: readonly ConsequenceGroup[];
  /** Effetti che il motore non simula: dichiarati non stimabili. */
  readonly notEstimable: readonly string[];
  /** La stima del motore è più vecchia della bozza corrente. */
  readonly stale: boolean;
  /** Perché la preview è sicura: non modifica niente, è una lettura. */
  readonly note: string;
}

const PREVIEW_NOTE =
  'La plancia è una lettura: non modifica salvataggi, risorse, turno, code eventi o RNG. '
  + 'I costi sono quelli che il motore applica all’esecuzione, nelle stesse condizioni.';

/**
 * La firma del preventivo: snapshot canonico del mondo + capacità + opera + testo
 * della bozza. Lo stesso evento non cambia firma; modificarne uno la cambia, e la
 * stima precedente diventa `stale` invece di restare a rappresentare un’altra bozza.
 */
export function consequenceBoardSignature(input: { snapshotKey: string; draft: ProposalActDraft }): string {
  const { snapshotKey, draft } = input;
  return [snapshotKey, draft.capability, draft.work?.workId ?? 'text', orderKey(draft.text)].join('|');
}

function entry(
  label: string,
  detail: string,
  basis: ConsequenceBasis,
  tone: ConsequenceTone,
  applied: boolean,
): ConsequenceEntry {
  return { label, detail, basis, tone, applied };
}

function costBasis(preview: EnginePreview): ConsequenceBasis {
  if (preview.costs.basis === 'request') return 'declared';
  if (preview.costs.basis === 'none') return 'unavailable';
  return 'measured';
}

export interface ConsequenceBoardInput {
  readonly draft: ProposalActDraft;
  /** La strada d'origine, quando c'è (costi e benefici dichiarati). */
  readonly road?: TreasuryRoad | null;
  /** L'opera, quando la strada è una costruzione (dichiarazione e cifre). */
  readonly item?: CabinetItemView | null;
  /** Lo snapshot canonico del mondo (`actionSnapshotKey`). */
  readonly snapshotKey: string;
  /** La verifica del motore, se presente. */
  readonly preview?: EnginePreview | null;
  /** La firma con cui la verifica è stata prodotta (per riconoscere lo stallo). */
  readonly previewSignature?: string | null;
}

export function buildConsequenceBoard(input: ConsequenceBoardInput): ConsequenceBoard {
  const { draft, road, item, snapshotKey, preview, previewSignature } = input;
  const signature = consequenceBoardSignature({ snapshotKey, draft });
  const stale = Boolean(preview && previewSignature && previewSignature !== signature);
  const engine = stale ? null : (preview ?? null);
  const comparison = road ? compareRoads([road])[0] : null;

  const direct: ConsequenceEntry[] = [];
  const predicted: ConsequenceEntry[] = [];
  const risks: ConsequenceEntry[] = [];
  const uncertainties: ConsequenceEntry[] = [];
  const notEstimable: string[] = [];

  // ── Effetti diretti: il costo che il motore applica ───────────────────────
  if (engine && engine.costs.basis !== 'none') {
    const basis = costBasis(engine);
    if (engine.costs.timeDays > 0) {
      direct.push(entry(
        'Durata',
        `${engine.costs.timeDays} ${engine.costs.timeDays === 1 ? 'giorno' : 'giorni'} per ciclo`,
        'declared', 'neutral', true,
      ));
    }
    for (const line of engine.costs.inputs) {
      direct.push(entry(line.name, `${line.quantity} ${line.unit}`, basis, 'neutral', true));
    }
    for (const { line, periodDays } of engine.costs.upkeep) {
      direct.push(entry(
        `Mantenimento ${line.name}`,
        `${line.quantity} ${line.unit} ogni ${periodDays} giorni`,
        basis, 'warning', true,
      ));
    }
  } else if (draft.capability === 'engine-order') {
    direct.push(entry('Costo immediato', comparison?.cells.initial.value ?? road?.declaredCost ?? '—', 'declared', 'neutral', true));
    if (item?.declaration?.funded) {
      direct.push(entry('Distinta', 'coperta: il motore apre il cantiere e addebita la cassa all’esecuzione', 'declared', 'positive', true));
    }
  } else if (road) {
    // Ordine in prosa: il costo è dichiarato dall'atto, non garantito da un comando.
    direct.push(entry('Impegno di cassa', road.declaredCost, 'declared', 'neutral', false));
  }
  if (direct.length === 0) {
    direct.push(entry('Effetti diretti', 'il motore non dichiara un costo per questo atto', 'unavailable', 'neutral', false));
  }

  // ── Previsioni del motore ─────────────────────────────────────────────────
  if (road) predicted.push(entry('Beneficio atteso', road.expectedGain, 'declared', 'positive', false));
  if (comparison) {
    predicted.push(entry('Copertura', comparison.cells.coverage.value, comparison.cells.coverage.basis, 'neutral', false));
  }
  if (engine) {
    predicted.push(entry('Esito della verifica', engine.summary, engine.feasible ? 'declared' : 'unavailable', engine.feasible ? 'positive' : 'warning', false));
  } else if (draft.capability === 'text-order') {
    predicted.push(entry('Interpretazione del testo', 'il motore interpreta la prosa all’avanzamento del tempo: nessun comando dedicato', 'declared', 'warning', false));
  }

  // ── Rischi ────────────────────────────────────────────────────────────────
  if (draft.capability === 'unsupported') {
    risks.push(entry('Funzione assente', draft.note, 'declared', 'critical', false));
  }
  for (const material of item?.declaration?.missingMaterials ?? []) {
    risks.push(entry('Distinta scoperta', `${material.resourceId} (manca ${material.missing})`, 'declared', 'critical', false));
  }
  if (comparison && comparison.cells.constraints.basis !== 'unavailable' && comparison.cells.constraints.value !== 'nessun prerequisito dichiarato') {
    risks.push(entry('Vincoli', comparison.cells.constraints.value, comparison.cells.constraints.basis, 'warning', false));
  }
  for (const risk of engine?.risks ?? []) {
    risks.push(entry('Blocco del motore', risk, 'declared', 'warning', false));
  }
  for (const prerequisite of engine?.prerequisites ?? []) {
    risks.push(entry('Prerequisito', prerequisite, 'declared', 'warning', false));
  }
  if (risks.length === 0) {
    risks.push(entry('Rischi', 'il motore non segnala rischi per questo atto', 'declared', 'neutral', false));
  }

  // ── Incertezze ────────────────────────────────────────────────────────────
  for (const figure of item?.figures ?? []) {
    if (figure.basis.kind === 'unknown') {
      uncertainties.push(entry(figure.label, `dato mancante: ${figure.basis.missing}`, 'unavailable', 'warning', false));
    } else if (figure.basis.kind === 'estimated') {
      uncertainties.push(entry(figure.label, `stimato: ${figure.basis.method}`, 'estimated', 'neutral', false));
    }
  }
  if (comparison) {
    const recurring = comparison.cells.recurring;
    const timing = comparison.cells.timing;
    if (recurring.basis === 'unavailable') {
      uncertainties.push(entry('Spesa ricorrente', recurring.value, 'unavailable', 'warning', false));
      notEstimable.push('La spesa ricorrente non è dichiarata dal motore: non è stimata.');
    }
    if (timing.basis === 'unavailable') {
      uncertainties.push(entry('Tempi', timing.value, 'unavailable', 'warning', false));
      notEstimable.push('I tempi non sono dichiarati dal motore: non sono stimati.');
    }
  }
  uncertainties.push(entry('Effetti sociali', SOCIAL_EFFECTS_NOTE, 'unavailable', 'neutral', false));
  for (const notice of [engine?.costs.note, ...(engine?.warnings ?? [])]) {
    if (notice) uncertainties.push(entry('Avviso del motore', notice, 'declared', 'warning', false));
  }
  if (draft.capability === 'text-order' && !engine) {
    uncertainties.push(entry('Costo applicato', 'non verificato dal motore: la stima resta dichiarata', 'unavailable', 'warning', false));
  }

  notEstimable.push('Effetti sociali (consenso, occupazione): non simulati dal motore.');
  if (draft.capability === 'unsupported') {
    notEstimable.push('Nessun comando supportato: l’atto non applicherebbe l’effetto dichiarato.');
  }
  if (draft.capability === 'text-order') {
    notEstimable.push('L’effetto di un ordine in prosa dipende dall’interpretazione del motore, non da un comando dedicato.');
  }

  const status: PreviewStatus = draft.capability === 'unsupported'
    ? 'not-estimable'
    : engine ? 'engine-preview' : 'declared';
  const statusNote = status === 'engine-preview'
    ? 'Costi e vincoli dalla verifica di fattibilità del motore: sono gli stessi che il motore applica all’esecuzione.'
    : status === 'declared'
      ? (draft.capability === 'engine-order'
        ? 'Stima dichiarata dalla distinta: il motore la applica all’esecuzione.'
        : 'Stima dichiarata dall’atto: il motore interpreterà la prosa all’esecuzione.')
      : 'Nessun comando supportato: l’atto non produrrebbe l’effetto dichiarato. Nessuna stima.';

  return {
    signature,
    status,
    statusNote,
    groups: [
      { id: 'direct', label: CONSEQUENCE_GROUP_LABEL.direct, entries: direct },
      { id: 'predicted', label: CONSEQUENCE_GROUP_LABEL.predicted, entries: predicted },
      { id: 'risks', label: CONSEQUENCE_GROUP_LABEL.risks, entries: risks },
      { id: 'uncertainties', label: CONSEQUENCE_GROUP_LABEL.uncertainties, entries: uncertainties },
    ],
    notEstimable,
    stale,
    note: PREVIEW_NOTE,
  };
}
