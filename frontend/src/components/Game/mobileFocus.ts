/**
 * WS-GOV-MOBILE-FOCUS — La vista mobile del Governo (PARTE H)
 * ==========================================================
 * Sul desktop il Governo è una **stanza di lavoro**: dialogo a sinistra, tavola
 * a destra, contesto completo. Sul mobile è una **sequenza di decisioni**: in
 * ogni momento una sola cosa principale e una sola prossima azione. Non è CSS
 * compresso: è una macchina a stati di presentazione.
 *
 * Questo modulo è **puro** e non possiede gioco: deriva dalla stessa fonte del
 * desktop (`CouncilMeeting`, `DecisionWorkspace`, atto preparato) ciò che serve
 * alla vista mobile. Nessuna cifra nuova, nessuno stato persistito: se un dato
 * non è nel motore, la vista dichiara l'assenza.
 */
import type { CouncilMeeting, MeetingRequirement } from './councilMeeting';
import { seatSpeaker } from './councilMeeting';
import { CABINET_SEATS, type CabinetSeat } from './seatDecisionBoards';
import type { DecisionWorkspace } from './decisionWorkspace';
import { activeProposal } from './decisionWorkspace';

/** H1 — la vista mobile è stato di **presentazione**, non dominio. */
export type GovernmentMobileView = 'dialogue' | 'board' | 'act' | 'evidence';

/** H8 — la prossima azione possibile, una sola. */
export type MobilePrimaryAction =
  | 'continue' | 'convene' | 'prepare-act' | 'regenerate-act' | 'sign' | null;

/** H8 — un blocco visibile in cima alla Tavola mobile. */
export interface MobileBlocker {
  readonly label: string;
  readonly owner: string;
  readonly kind: string;
}

/** H8/H11 — il view model della decisione in corso. */
export interface MobileDecisionSummary {
  readonly title: string;
  /** H11 — etichetta leggibile, mai l'identificatore tecnico. */
  readonly status: string;
  readonly confirmed: readonly string[];
  readonly unresolved: readonly MobileBlocker[];
  readonly primaryAction: MobilePrimaryAction;
  /** La CTA associata, in chiaro. */
  readonly primaryLabel: string | null;
}

/**
 * WS-GOV-MOBILE-CLEANUP (M15) — la Tavola mobile raggruppa il **risultato della
 * riunione** per ministero, letto dal piano condiviso (`meeting.workspace.lines`),
 * non dal transcript narrativo dei contributi. Il Dialogo contiene le parole; la
 * Tavola contiene soltanto la decisione che ne risulta.
 */
export interface MobileMinisterSection {
  readonly seat: CabinetSeat;
  readonly label: string;
  readonly lines: readonly {
    readonly label: string;
    readonly value: string;
    readonly status: 'ok' | 'missing' | 'unknown';
  }[];
}

/** M15 — il piano condiviso, raggruppato per sedia e nell'ordine del gabinetto. */
export function ministerSectionsFromMeeting(meeting: CouncilMeeting | null): MobileMinisterSection[] {
  if (!meeting) return [];
  const grouped = new Map<CabinetSeat, { label: string; value: string; status: 'ok' | 'missing' | 'unknown' }[]>();
  for (const line of meeting.workspace.lines) {
    const bucket = grouped.get(line.owner) ?? [];
    bucket.push({ label: line.label, value: line.value, status: line.status });
    grouped.set(line.owner, bucket);
  }
  // L'ordine: il capofila per primo, poi gli altri nell'ordine del gabinetto.
  const order = [meeting.leadSeat, ...CABINET_SEATS.filter(seat => seat !== meeting.leadSeat)];
  return order
    .filter(seat => grouped.has(seat))
    .map(seat => ({ seat, label: seatSpeaker(seat), lines: grouped.get(seat) ?? [] }));
}

/**
 * M8 — le fonti si mostrano **una sola volta**: l'id tecnico del motore diventa
 * un'etichetta leggibile e i duplicati spariscono. L'id resta nel DOM solo dove
 * serve al debug, mai come testo principale.
 */
export function sourceLabel(source: string): string {
  const labels: Record<string, string> = {
    'check-feasibility': 'Motore di fattibilità',
    ledger: 'Ledger',
    'work-catalog': 'Catalogo opere',
    catalog: 'Catalogo opere',
    availability: 'Disponibilità',
    preflight: 'Preflight',
  };
  return labels[source] ?? source;
}

/** M8 — le etichette uniche delle fonti, nell'ordine in cui compaiono. */
export function uniqueSourceLabels(sources: readonly string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const source of sources) {
    const label = sourceLabel(source);
    if (seen.has(label)) continue;
    seen.add(label);
    out.push(label);
  }
  return out;
}

/** H10 — i blocchi prioritari: la ragione del blocco, subito. */
export function mobileBlockers(meeting: CouncilMeeting | null): MobileBlocker[] {
  if (!meeting) return [];
  return meeting.unresolved
    .filter((requirement: MeetingRequirement) => requirement.blocker)
    .map(requirement => ({ label: requirement.label, owner: seatSpeaker(requirement.owner), kind: requirement.kind }));
}

/** H11 — la traduzione leggibile dello stato, senza gergo tecnico. */
export function readableMeetingStatus(status: CouncilMeeting['status']): string {
  const labels: Record<CouncilMeeting['status'], string> = {
    opening: 'In apertura',
    'gathering-inputs': 'In definizione',
    negotiating: 'Da completare',
    'ready-for-act': 'Pronta per l’atto',
    closed: 'Chiusa',
  };
  return labels[status];
}

/** Le righe «confermate» (senza i blocchi) della Tavola mobile. */
function confirmedLines(meeting: CouncilMeeting): string[] {
  return meeting.workspace.lines
    .filter(line => line.status === 'ok')
    .map(line => `${line.label}: ${line.value}`)
    .slice(0, 6);
}

/** I blocchi della decisione quando non c'è ancora una riunione. */
function workspaceBlockers(workspace: DecisionWorkspace | null): MobileBlocker[] {
  if (!workspace) return [];
  const proposal = activeProposal(workspace);
  if (!proposal) return [];
  const blockers: MobileBlocker[] = [];
  for (const measure of proposal.measures) {
    if (measure.status === 'unresolved') blockers.push({ label: measure.label, owner: '', kind: measure.kind });
  }
  // H24 — le domande aperte sono il motivo per cui non si può ancora procedere:
  // vanno in cima, tradotte in una frase chiara (mai il gergo interno).
  for (const question of proposal.unresolvedQuestions) {
    const lower = question.toLowerCase();
    const label = lower.includes('localizz') ? 'Dove deve sorgere l’opera?' : question;
    const kind = lower.includes('localizz') ? 'location' : 'prerequisite';
    if (!blockers.some(blocker => blocker.label === label)) blockers.push({ label, owner: '', kind });
  }
  return blockers;
}

export interface MobileDecisionInput {
  readonly meeting: CouncilMeeting | null;
  readonly workspace: DecisionWorkspace | null;
  readonly actPrepared: boolean;
  readonly actStale: boolean;
  readonly signed: boolean;
  /** Il soggetto di una richiesta che meriterebbe una riunione non ancora convocata. */
  readonly pendingMeetingPrompt: string | null;
}

/**
 * H8/H11 — il view model della decisione corrente. L'ordine di priorità è
 * quello del gioco: prima ciò che è già firmato, poi l'atto pronto, poi la
 * riunione, poi la decisione in corso.
 */
export function mobileDecisionSummary(input: MobileDecisionInput): MobileDecisionSummary {
  const { meeting, workspace, actPrepared, actStale, signed, pendingMeetingPrompt } = input;
  // M17 — il titolo è la **descrizione della decisione** (objective), non la
  // frase con cui il Presidente ha convocato. La localizzazione resta a parte.
  const title = meeting?.objective || meeting?.workspace.work
    || (workspace ? activeProposal(workspace)?.objective : null) || workspace?.objective || 'Decisione in corso';

  if (signed) {
    return { title, status: 'Firmata', confirmed: [], unresolved: [], primaryAction: null, primaryLabel: null };
  }
  if (actPrepared) {
    return {
      title,
      status: actStale ? 'Da aggiornare' : 'Atto preparato',
      confirmed: meeting ? confirmedLines(meeting) : [],
      unresolved: meeting ? mobileBlockers(meeting) : [],
      primaryAction: actStale ? 'regenerate-act' : 'sign',
      primaryLabel: actStale ? 'Rigenera l’atto' : 'Vai all’atto e firma',
    };
  }
  if (meeting) {
    // M27 — una **nuova convocazione** esplicita (messaggio diverso dalla
    // riunione attiva) prevale: apre una nuova identità, non la aggiorna.
    if (pendingMeetingPrompt) {
      return {
        title: pendingMeetingPrompt,
        status: 'Nuova riunione',
        confirmed: confirmedLines(meeting),
        unresolved: [],
        primaryAction: 'convene',
        primaryLabel: 'Convoca la riunione',
      };
    }
    const blockers = mobileBlockers(meeting);
    const ready = meeting.status === 'ready-for-act' && blockers.length === 0;
    return {
      title,
      status: readableMeetingStatus(meeting.status),
      confirmed: confirmedLines(meeting),
      unresolved: blockers,
      primaryAction: ready ? 'prepare-act' : 'continue',
      primaryLabel: ready ? 'Prepara l’atto' : 'Continua la riunione',
    };
  }
  const blockers = workspaceBlockers(workspace);
  const proposal = workspace ? activeProposal(workspace) : null;
  const acceptedLabels = proposal?.measures.filter(measure => measure.status === 'accepted').map(measure => measure.label).slice(0, 6) ?? [];
  // H24 — un blocco in chiaro viene PRIMA della convocazione: il Presidente
  // deve sapere «dove?» o «mancano i soldi» prima di riunire il gabinetto.
  if (blockers.length > 0) {
    return {
      title,
      status: 'Da completare',
      confirmed: acceptedLabels,
      unresolved: blockers,
      primaryAction: 'continue',
      primaryLabel: 'Continua il dialogo',
    };
  }
  if (pendingMeetingPrompt) {
    return {
      title: pendingMeetingPrompt,
      status: 'Serve una riunione',
      confirmed: acceptedLabels,
      unresolved: [],
      primaryAction: 'convene',
      primaryLabel: 'Convoca la riunione',
    };
  }
  const hasAccepted = Boolean(proposal?.measures.some(measure => measure.status === 'accepted'));
  return {
    title,
    status: proposal ? 'In definizione' : 'In esplorazione',
    confirmed: acceptedLabels,
    unresolved: [],
    primaryAction: hasAccepted ? 'prepare-act' : 'continue',
    primaryLabel: hasAccepted ? 'Prepara l’atto' : 'Continua il dialogo',
  };
}

/**
 * H6 — il pallino sulla scheda «Tavola» compare solo quando qualcosa di
 * **decisionale** è cambiato mentre si guarda il Dialogo: revisione della
 * proposta, revisione della riunione, un blocco, l'atto pronto. Mai a ogni token.
 */
export function shouldShowBoardDot(input: {
  readonly view: GovernmentMobileView;
  readonly seenRevision: number;
  readonly currentRevision: number;
  readonly seenMeetingRevision: number;
  readonly currentMeetingRevision: number;
  readonly seenBlockerKey: string;
  readonly currentBlockerKey: string;
}): boolean {
  if (input.view !== 'dialogue') return false;
  return input.seenRevision !== input.currentRevision
    || input.seenMeetingRevision !== input.currentMeetingRevision
    || input.seenBlockerKey !== input.currentBlockerKey;
}

/** La chiave stabile dei blocchi: cambia solo se cambia la ragione esposta. */
export function blockerKey(meeting: CouncilMeeting | null): string {
  return mobileBlockers(meeting).map(blocker => `${blocker.kind}:${blocker.label}`).sort().join('|');
}

/** H12 — la cronologia mobile: una riga per revisione, mai il dump del workspace. */
export function mobileHistory(workspace: DecisionWorkspace | null): { readonly revision: number; readonly summary: string }[] {
  if (!workspace) return [];
  return workspace.history.map(entry => ({ revision: entry.revision, summary: entry.summary })).slice(-8).reverse();
}

/** H16 — i partecipanti come chip: i primi tre, poi «+N». */
export function participantChips(meeting: CouncilMeeting | null, visible = 3): {
  readonly shown: { readonly seat: string; readonly label: string; readonly lead: boolean }[];
  readonly hidden: number;
} {
  if (!meeting) return { shown: [], hidden: 0 };
  const chips = meeting.participants.map(seat => ({ seat, label: seatSpeaker(seat), lead: seat === meeting.leadSeat }));
  return { shown: chips.slice(0, visible), hidden: Math.max(0, chips.length - visible) };
}

/** H17 — i ministri ancora convocabili (esclude i presenti), nell'ordine del gabinetto. */
export function convenableMinisters<T extends { readonly seat: string }>(
  all: readonly T[],
  meeting: CouncilMeeting | null,
): T[] {
  const present = new Set<string>(meeting?.participants ?? []);
  return all.filter(minister => !present.has(minister.seat));
}
