/**
 * WS-MINISTER-UX-06 — Dalla proposta alla decisione del Presidente
 * ===============================================================
 * La strada discussa non è ancora un atto: lo diventa quando il Presidente la
 * **prepara** e la **firma**. Questo modulo è la parte **pura** di quel
 * passaggio: trasforma una `TreasuryRoad` in una bozza correggibile, dichiara
 * che cosa il motore sa davvero fare di quella strada, e ricostruisce lo stato
 * reale dell'atto **dai dati disponibili** (coda e cronologia), non da un flag
 * locale «accolta».
 *
 * Confini, gli stessi della seduta:
 *  - preparare e confrontare **non** accodano e **non** spendono: solo la firma
 *    esplicita del Presidente entra nel registro;
 *  - non si inventano comandi: una strada senza comando supportato lo dichiara e
 *    non sembra eseguita;
 *  - lo stato `eseguito`/`fallito` viene dall'esito del motore
 *    (`HistoryItem.outcomeStatus`), mai da un'ipotesi della UI.
 *
 * Modulo puro: nessun I/O, nessuno stato, nessuna chiamata al modello.
 */
import type { HistoryItem, PendingAction } from '../../stores/gameStore';
import { cabinetDeclarationFor, composeCabinetOrderText, type WorkDeclarationInput } from './cabinetOrder';
import type { TreasuryRoad } from './treasuryAct';
import type { DecisionMeasure, NegotiatedProposal } from './decisionWorkspace';

/** Che cosa il motore sa fare della strada. */
export type ActCapability =
  /** La distinta è coperta: il motore apre il cantiere e addebita la cassa. */
  | 'engine-order'
  /** Nessun comando dedicato: il motore interpreterà la prosa al salto. */
  | 'text-order'
  /** Nessun comando supportato: registrare non produrrebbe l'effetto. */
  | 'unsupported';

/** Il percorso dell'atto, dal tavolo al mondo. */
export type ActState = 'proposed' | 'prepared' | 'queued' | 'executed' | 'failed';

/** La bozza d'atto sul tavolo: testo correggibile + dichiarazione, quando c'è. */
export interface ProposalActDraft {
  readonly id: string;
  readonly seat: string;
  readonly roadId: string;
  readonly title: string;
  readonly text: string;
  readonly capability: ActCapability;
  /** Perché quella capacità: la frase che il Presidente legge. */
  readonly note: string;
  /** La dichiarazione d'opera, solo quando il motore la accetta. */
  readonly work?: WorkDeclarationInput;
}

/** Lo stato dell'atto e la sua spiegazione, già pronti per la UI. */
export interface ActStatus {
  readonly state: ActState;
  readonly label: string;
  readonly note: string;
}

const CAPABILITY_LABEL: Record<ActCapability, string> = {
  'engine-order': 'ordine d’opera supportato',
  'text-order': 'bozza testuale da valutare',
  unsupported: 'funzione assente',
};

const CAPABILITY_NOTE: Record<ActCapability, string> = {
  'engine-order': 'La distinta è coperta: il motore apre il cantiere e addebita la cassa all’esecuzione.',
  'text-order': 'Il motore interpreterà la prosa all’avanzamento del tempo: per questa operazione non esiste un comando dedicato.',
  unsupported: 'Nessun comando supportato: registrare l’atto non produrrebbe l’effetto dichiarato.',
};

const STATE_LABEL: Record<ActState, string> = {
  proposed: 'proposto',
  prepared: 'preparato',
  queued: 'accodato',
  executed: 'eseguito',
  failed: 'fallito',
};

const STATE_NOTE: Record<ActState, string> = {
  proposed: 'La strada è sul tavolo: preparala per farne una bozza d’atto.',
  prepared: 'Bozza pronta sul tavolo: firmala per inserirla nel registro.',
  queued: 'Nel registro, in attesa dell’avanzamento del tempo.',
  executed: 'Eseguito dal motore all’avanzamento del tempo.',
  failed: 'Il motore non l’ha accolto: resta agli atti, senza effetto applicato.',
};

/** La forma normale con cui si riconosce lo stesso ordine in coda o in cronologia. */
export function orderKey(text: string): string {
  return String(text ?? '').trim().replace(/\s+/g, ' ');
}

/** Il titolo concreto dell'atto: la prima riga del testo, o il titolo della strada. */
export function actHeadline(draft: Pick<ProposalActDraft, 'text' | 'title'>): string {
  return draft.text.split('\n').map(line => line.trim()).find(Boolean) ?? draft.title;
}

/** Che cosa il motore sa fare della strada: dalla dichiarazione, non dalla voce. */
export function capabilityFor(road: TreasuryRoad): ActCapability {
  if (road.order.kind !== 'work') return 'text-order';
  return cabinetDeclarationFor(road.order.item) ? 'engine-order' : 'unsupported';
}

export function capabilityLabel(capability: ActCapability): string {
  return CAPABILITY_LABEL[capability];
}

/** La frase onesta sulla capacità: il dettaglio della distinta quando manca. */
export function capabilityNote(road: TreasuryRoad, capability: ActCapability): string {
  if (capability !== 'unsupported' || road.order.kind !== 'work') {
    return CAPABILITY_NOTE[capability];
  }
  const missing = road.order.item.declaration?.missingMaterials
    ?.map(material => `${material.resourceId} (${material.missing})`) ?? [];
  return missing.length > 0
    ? `Distinta scoperta: mancano ${missing.join(', ')}. Registrare non aprirebbe il cantiere.`
    : CAPABILITY_NOTE.unsupported;
}

/**
 * La strada diventa bozza. Il testo d'opera lo compone lo stesso modulo della
 * seduta (`composeCabinetOrderText`); la dichiarazione viaggia **solo** quando il
 * motore la accetta — altrimenti l'atto resta prosa.
 */
export function actDraftFor(road: TreasuryRoad, seat: string): ProposalActDraft {
  const capability = capabilityFor(road);
  const text = road.order.kind === 'work'
    ? composeCabinetOrderText(road.order.item, road.order.path)
    : road.order.text;
  const declaration = road.order.kind === 'work' ? cabinetDeclarationFor(road.order.item) : null;
  return {
    id: `${seat}:${road.id}`,
    seat,
    roadId: road.id,
    title: road.title,
    text,
    capability,
    note: capabilityNote(road, capability),
    ...(capability === 'engine-order' && declaration ? { work: declaration } : {}),
  };
}

/**
 * Il testo di una misura negoziata, dentro l'atto: «Infrastrutture: 80%».
 * Nessun numero nuovo: si formatta solo ciò che la proposta dichiara.
 */
function measureLine(measure: DecisionMeasure): string {
  if (measure.sharePct !== undefined) return `${measure.label}: ${measure.sharePct}%`;
  if (measure.value !== undefined) return `${measure.label}: ${measure.value}${measure.unit ? ` ${measure.unit}` : ''}`;
  if (measure.amount !== undefined) return `${measure.label}: ${measure.amount}${measure.unit ? ` ${measure.unit}` : ''}`;
  return measure.label;
}

/** Il contesto dell'atto che nasce da una proposta negoziata. */
export interface ProposalActContext {
  readonly seat: string;
  /** La strada d'origine, quando la proposta nasce da una strada del motore. */
  readonly road?: TreasuryRoad | null;
  /** Il titolo leggibile dell'atto (di norma l'obiettivo). */
  readonly title?: string;
}

/**
 * WS-GOV-DIALOGUE-TO-ACT — La proposta negoziata diventa atto.
 *
 * È il requisito centrale: quando il dialogo ha prodotto una `NegotiatedProposal`,
 * **quella** è la sorgente dell'atto, non la strada iniziale. Il testo porta i
 * valori della revisione corrente (misure accettate, vincoli), e la capacità
 * d'opera viene dalla strada d'origine quando c'è — così una proposta che poggia
 * su una distinta coperta resta un ordine d'opera, e la prosa resta prosa.
 *
 * `actDraftFor(road)` **non sparisce**: resta il fallback per le proposte semplici
 * non negoziate, ed è il comportamento di chi non ha ancora discusso.
 */
export function actDraftFromProposal(proposal: NegotiatedProposal, context: ProposalActContext): ProposalActDraft {
  const title = context.title ?? proposal.objective ?? 'Proposta negoziata';
  const lines: string[] = [title];
  for (const measure of proposal.measures) {
    if (measure.status === 'rejected') continue;
    lines.push(`— ${measureLine(measure)}`);
  }
  if (proposal.constraints.length > 0) lines.push(`Vincoli: ${proposal.constraints.join('; ')}`);
  const text = lines.join('\n');

  const road = context.road ?? null;
  const capability = road ? capabilityFor(road) : 'text-order';
  const declaration = road && road.order.kind === 'work' ? cabinetDeclarationFor(road.order.item) : null;
  const note = road
    ? capabilityNote(road, capability)
    : 'Bozza dalla proposta negoziata: il motore interpreterà la prosa all’avanzamento del tempo.';

  return {
    id: `${context.seat}:${proposal.id}`,
    seat: context.seat,
    roadId: road?.id ?? proposal.id,
    title,
    text,
    capability,
    note,
    ...(capability === 'engine-order' && declaration ? { work: declaration } : {}),
  };
}

/**
 * «Modifica proposta»: il Presidente corregge il testo. La dichiarazione d'opera
 * non cambia — è legata all'opera, non alla prosa.
 */
export function editActDraft(draft: ProposalActDraft, text: string): ProposalActDraft {
  return { ...draft, text };
}

/**
 * Lo stato **reale** dell'atto, dai dati disponibili.
 *
 * Precedenza: se la bozza è ancora in coda è `queued` (anche se una versione
 * precedente è già stata eseguita); altrimenti l'esito del motore in cronologia
 * (`rejected` → `failed`, altrimenti `executed`); altrimenti `prepared`.
 */
export function deriveActState(
  draft: Pick<ProposalActDraft, 'text'>,
  pendingActions: readonly PendingAction[],
  history: readonly HistoryItem[],
): ActState {
  const key = orderKey(draft.text);
  if (!key) return 'prepared';
  if (pendingActions.some(action => orderKey(action.text) === key)) return 'queued';
  const executed = [...history].reverse().find(item => orderKey(item.action) === key);
  if (executed) return executed.outcomeStatus === 'rejected' ? 'failed' : 'executed';
  return 'prepared';
}

/** Lo stato con la sua etichetta e la sua spiegazione. */
export function actStatus(
  draft: Pick<ProposalActDraft, 'text'>,
  pendingActions: readonly PendingAction[],
  history: readonly HistoryItem[],
): ActStatus {
  const state = deriveActState(draft, pendingActions, history);
  return { state, label: STATE_LABEL[state], note: STATE_NOTE[state] };
}

export function actStateLabel(state: ActState): string {
  return STATE_LABEL[state];
}

/** Lo stato di una strada che non è ancora diventata bozza. */
export function proposedStatus(): ActStatus {
  return { state: 'proposed', label: STATE_LABEL.proposed, note: STATE_NOTE.proposed };
}
