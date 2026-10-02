/**
 * WS-GOV-COUNCIL-MEETINGS — La riunione di Governo è uno stato condiviso (B1–B6)
 * ============================================================================
 * Il difetto osservato: una decisione multi-competenza non aveva una sede. Il
 * Presidente parlava a un ministro alla volta, oppure si lasciavano sette
 * ministri «parlare a caso». Manca il **Consiglio operativo**: una riunione con
 * una sola conversazione, un solo piano condiviso, contributi **attribuiti** per
 * sedia e un capofila.
 *
 * Regole, le stesse del progetto:
 *  - il motore resta l'unica autorità sui numeri: qui si **legge e si spiega**
 *    (`MeetingEngineRead`), non si calcola. Nessun valore è inventato;
 *  - selettore e capofila sono **deterministici** (parole chiave, non LLM);
 *  - un solo workspace condiviso: i ministri contribuiscono allo **stesso** piano;
 *  - preview ≠ commit: la riunione non prenota nulla; solo la firma accoda.
 *
 * Modulo **puro**: nessun I/O, nessuno stato, nessuna chiamata al modello.
 */
import type { ProposalActDraft } from './actDraft';
import type { WorkDeclarationInput } from './cabinetOrder';
import { CABINET_SEATS, type CabinetSeat } from './seatDecisionBoards';

/** Lo stato della riunione (B1). */
export type MeetingStatus = 'opening' | 'gathering-inputs' | 'negotiating' | 'ready-for-act' | 'closed';

/** Un intervento, sempre attribuito alla sedia (B3). */
export interface MinisterContribution {
  readonly id: string;
  readonly seat: CabinetSeat;
  readonly kind: 'proposal' | 'fact' | 'warning' | 'requirement' | 'objection' | 'support';
  readonly text: string;
  readonly refs: readonly string[];
  readonly turn: number;
}

/**
 * Una cosa da risolvere. `blocker` distingue il **blocco del motore**
 * (impossibile / requisito mancante) dall'**obiezione del ministro** (giudizio
 * politico o prudenziale): il dissenso del Tesoro non diventa un blocco tecnico
 * se il motore dice che l'opera è fattibile (B14).
 */
export interface MeetingRequirement {
  readonly id: string;
  readonly kind: 'coverage' | 'material' | 'prerequisite' | 'workforce' | 'cash' | 'policy';
  readonly label: string;
  readonly blocker: boolean;
  readonly owner: CabinetSeat;
}

/** Una riga del piano condiviso, con la sua provenienza (B2). */
export interface MeetingPlanLine {
  readonly owner: CabinetSeat;
  readonly label: string;
  readonly value: string;
  readonly status: 'ok' | 'missing' | 'unknown';
  /** La provenienza del dato: sempre un read model del motore, mai il modello. */
  readonly source: string;
}

/** Il piano condiviso della riunione: **uno**, non uno per ministro (B2). */
export interface MeetingWorkspace {
  readonly objective: string;
  readonly work: string | null;
  readonly region: string | null;
  readonly lines: readonly MeetingPlanLine[];
  /** I rischi letti dal motore: non sono obiezioni inventate. */
  readonly risks: readonly string[];
}

/** La dichiarazione d'opera **risolta dal server**, così com'è: può essere scoperta. */
export interface MeetingWorkDeclaration {
  readonly workId: string;
  readonly payerActorId: string;
  readonly materialActorId: string | null;
  readonly funded: boolean;
  readonly missingMaterials: readonly { resourceId: string; missing: string }[];
  readonly note?: string;
}

/** Il piano d'esecuzione verificato, che l'atto non deve perdere (B16). */
export interface MeetingExecutionPlan {
  readonly workId?: string;
  readonly regionId?: string;
  readonly feasibilityRef?: string;
  readonly workDeclaration?: MeetingWorkDeclaration;
}

/** La riunione: stato della **seduta corrente** (B1). */
export interface CouncilMeeting {
  readonly id: string;
  readonly gameId: string;
  readonly branchId: string | null;
  readonly turn: number;
  readonly subject: string;
  readonly objective: string;
  readonly participants: readonly CabinetSeat[];
  readonly leadSeat: CabinetSeat;
  readonly status: MeetingStatus;
  readonly workspace: MeetingWorkspace;
  readonly contributions: readonly MinisterContribution[];
  readonly unresolved: readonly MeetingRequirement[];
  readonly execution: MeetingExecutionPlan;
  readonly revision: number;
}

/** Il dato letto dai motori: la riunione lo **spiega**, non lo ricalcola. */
export interface MeetingEngineRead {
  readonly workLabel: string | null;
  readonly regionLabel: string | null;
  readonly durationDays: number | null;
  readonly materials: readonly { readonly name: string; readonly ok: boolean; readonly missing?: string }[];
  readonly costLabel: string | null;
  readonly costNote: string | null;
  readonly coverage: 'covered' | 'short' | 'unknown';
  readonly availableLabel: string | null;
  readonly risks: readonly string[];
  readonly prerequisites: readonly string[];
  readonly summary: string;
  readonly workId?: string | null;
  readonly regionId?: string | null;
  readonly workDeclaration?: {
    workId: string;
    payerActorId: string;
    materialActorId: string | null;
    funded: boolean;
    missingMaterials: readonly { resourceId: string; missing: string }[];
    note?: string;
  } | null;
  /** La provenienza complessiva (es. «check-feasibility»). */
  readonly source: string;
}

// ── Selettore deterministico dei partecipanti (B4) e capofila (B5) ──────────

interface ParticipantRule {
  readonly seats: readonly CabinetSeat[];
  readonly keywords: readonly string[];
}

/**
 * Le regole del selettore. Una riunione convoca **solo** le competenze
 * necessarie: per una fabbrica, minimo `Lavori + Tesoro`. L'ordine delle regole
 * non decide la priorità (i partecipanti si ordinano poi come il gabinetto).
 */
export const PARTICIPANT_RULES: readonly ParticipantRule[] = [
  { seats: ['lavori'], keywords: ['costru', 'fabbrica', 'infrastruttur', 'opera', 'cantiere', 'strada', 'ferrovia', 'porto', 'diga', 'acquedotto', 'edific', 'acciaieria', 'siderurg'] },
  { seats: ['tesoro'], keywords: ['costo', 'costi', 'finanzi', 'disponibil', 'cassa', 'budget', 'copertur', 'debito', 'spesa', 'gettito', 'imposte', 'fiscale'] },
  { seats: ['esteri'], keywords: ['estero', 'estera', 'import', 'accordo', 'trattat', 'diploma', 'confine', 'commercio'] },
  { seats: ['interno'], keywords: ['ordine pubblico', 'intern', 'sicurezza', 'consenso', 'scioper', 'protesta', 'coesione', 'fazioni'] },
  { seats: ['guerra'], keywords: ['difesa', 'militar', 'guerra', 'fortificaz', 'esercito', 'arsenal', 'fronte'] },
  { seats: ['sanita'], keywords: ['sanit', 'ospedale', 'salute', 'epidem', 'medic', 'ambulator'] },
  { seats: ['istruzione'], keywords: ['universit', 'scuol', 'istruzion', 'ricerca', 'atene', 'student'] },
];

function matches(text: string, keywords: readonly string[]): boolean {
  const haystack = text.toLowerCase();
  return keywords.some(keyword => haystack.includes(keyword));
}

/**
 * Le sedie convocate, nell'ordine del gabinetto. Una costruzione porta sempre
 * con sé il Tesoro: nessun'opera si promette senza copertura (B7/B8).
 */
export function selectParticipants(subject: string): CabinetSeat[] {
  const selected = new Set<CabinetSeat>();
  for (const rule of PARTICIPANT_RULES) {
    if (matches(subject, rule.keywords)) for (const seat of rule.seats) selected.add(seat);
  }
  if (selected.has('lavori')) selected.add('tesoro');
  return CABINET_SEATS.filter(seat => selected.has(seat));
}

/** Le regole del capofila: chi porta la proposta (B5). */
const LEAD_RULES: readonly { readonly seat: CabinetSeat; readonly keywords: readonly string[] }[] = [
  { seat: 'sanita', keywords: ['ospedale', 'sanit', 'epidem', 'salute'] },
  { seat: 'istruzione', keywords: ['universit', 'scuol', 'atene', 'istruzion'] },
  { seat: 'guerra', keywords: ['fortificaz', 'difesa', 'militar', 'arsenal'] },
  { seat: 'esteri', keywords: ['import', 'trattat', 'accordo', 'diploma'] },
  { seat: 'interno', keywords: ['ordine pubblico', 'coesione', 'sicurezza'] },
  { seat: 'tesoro', keywords: ['riforma fiscale', 'imposte', 'debito', 'bilancio'] },
  { seat: 'lavori', keywords: ['fabbrica', 'costru', 'infrastruttur', 'opera', 'cantiere', 'siderurg'] },
];

/** Il capofila della riunione: il primo che corrisponde, altrimenti il primo partecipante. */
export function selectLeadSeat(subject: string, participants: readonly CabinetSeat[]): CabinetSeat {
  for (const rule of LEAD_RULES) {
    if (participants.includes(rule.seat) && matches(subject, rule.keywords)) return rule.seat;
  }
  return participants[0] ?? 'tesoro';
}

/** Questa richiesta merita una riunione? Servono almeno due competenze. */
export function shouldConveneMeeting(subject: string): boolean {
  return selectParticipants(subject).length >= 2;
}

/** L'oggetto leggibile della riunione: la frase del Presidente, ripulita. */
export function meetingSubject(text: string): string {
  const clean = String(text ?? '').trim().replace(/\s+/g, ' ');
  return clean.length > 140 ? `${clean.slice(0, 137)}…` : clean;
}

/** Apre una riunione nel turno corrente: il passato non si trascina (Fase A). */
export function openMeeting(input: {
  readonly gameId: string;
  readonly branchId: string | null;
  readonly turn: number;
  readonly subject: string;
  readonly objective?: string;
}): CouncilMeeting | null {
  const participants = selectParticipants(input.subject);
  if (participants.length < 2) return null;
  const leadSeat = selectLeadSeat(input.subject, participants);
  return {
    id: `${input.gameId}|${input.branchId ?? 'main'}|${input.turn}|${participants.join('+')}`,
    gameId: input.gameId,
    branchId: input.branchId,
    turn: input.turn,
    subject: meetingSubject(input.subject),
    objective: input.objective?.trim() || meetingSubject(input.subject),
    participants,
    leadSeat,
    status: 'opening',
    workspace: { objective: input.objective?.trim() || meetingSubject(input.subject), work: null, region: null, lines: [], risks: [] },
    contributions: [],
    unresolved: [],
    execution: {},
    revision: 0,
  };
}

/** Aggiunge un contributo: la riunione avanza di una revisione. */
export function addContribution(meeting: CouncilMeeting, contribution: MinisterContribution): CouncilMeeting {
  if (meeting.contributions.some(item => item.id === contribution.id)) return meeting;
  return { ...meeting, contributions: [...meeting.contributions, contribution], revision: meeting.revision + 1 };
}

/** L'intervento di una sedia, con id stabile **sul contenuto** (non sulla revisione):
 *  riapplicare la stessa lettura non gonfia la riunione. */
export function makeContribution(
  meeting: CouncilMeeting,
  seat: CabinetSeat,
  kind: MinisterContribution['kind'],
  text: string,
  refs: readonly string[] = [],
): MinisterContribution {
  const normalized = text.trim().replace(/\s+/g, ' ');
  return { id: `${meeting.id}|${seat}|${kind}|${normalized}`, seat, kind, text, refs, turn: meeting.turn };
}

/** Il nome leggibile della sedia, dal suo titolo di Tavola. */
export function seatSpeaker(seat: CabinetSeat): string {
  const label: Record<CabinetSeat, string> = {
    tesoro: 'Ministro del Tesoro',
    lavori: 'Ministro dei Lavori',
    istruzione: 'Ministro dell’Istruzione',
    sanita: 'Ministro della Sanità',
    esteri: 'Ministro degli Esteri',
    interno: 'Ministro dell’Interno',
    guerra: 'Ministro della Guerra',
  };
  return label[seat];
}

// ── Lettura del motore → piano condiviso, requisiti e contributi (B7–B10) ───

/**
 * Le righe del piano: la competenza di ciascuna sedia, dal read model.
 * Una sedia che non ha portato nulla **non compare** (nessuna riga vuota).
 */
export function meetingWorkspaceFromRead(meeting: CouncilMeeting, read: MeetingEngineRead): MeetingWorkspace {
  const lines: MeetingPlanLine[] = [];
  if (meeting.participants.includes('lavori') && (read.workLabel || read.durationDays !== null || read.materials.length > 0)) {
    lines.push({
      owner: 'lavori',
      label: 'Opera',
      value: read.workLabel ?? 'da definire',
      status: read.workLabel ? 'ok' : 'unknown',
      source: read.source,
    });
    if (read.regionLabel) lines.push({ owner: 'lavori', label: 'Luogo', value: read.regionLabel, status: 'ok', source: read.source });
    if (read.durationDays !== null) lines.push({ owner: 'lavori', label: 'Durata', value: `${read.durationDays} giorni`, status: 'ok', source: read.source });
    for (const material of read.materials) {
      lines.push({
        owner: 'lavori',
        label: material.name,
        value: material.ok ? 'disponibile' : (material.missing ? `manca ${material.missing}` : 'mancante'),
        status: material.ok ? 'ok' : 'missing',
        source: read.source,
      });
    }
  }
  if (meeting.participants.includes('tesoro') && (read.costLabel || read.availableLabel)) {
    if (read.costLabel) lines.push({ owner: 'tesoro', label: 'Costo opera', value: read.costLabel, status: 'ok', source: read.source });
    if (read.availableLabel) lines.push({ owner: 'tesoro', label: 'Disponibile', value: read.availableLabel, status: 'ok', source: read.source });
    lines.push({
      owner: 'tesoro',
      label: 'Copertura',
      value: read.coverage === 'covered' ? 'coperta' : read.coverage === 'short' ? 'scoperta' : 'da verificare',
      status: read.coverage === 'covered' ? 'ok' : read.coverage === 'short' ? 'missing' : 'unknown',
      source: read.source,
    });
  }
  return {
    objective: meeting.objective,
    work: read.workLabel ?? meeting.workspace.work,
    region: read.regionLabel ?? meeting.workspace.region,
    lines,
    risks: read.risks,
  };
}

/** I requisiti: i blocchi del motore diventano cose da risolvere, con un owner. */
export function meetingRequirementsFromRead(meeting: CouncilMeeting, read: MeetingEngineRead): MeetingRequirement[] {
  const requirements: MeetingRequirement[] = [];
  const push = (kind: MeetingRequirement['kind'], label: string, owner: CabinetSeat, blocker: boolean): void => {
    const id = `req|${kind}|${label}`;
    if (requirements.some(item => item.id === id)) return;
    requirements.push({ id, kind, label, owner, blocker });
  };
  for (const risk of read.risks) {
    const lower = risk.toLowerCase();
    if (lower.includes('cass') || lower.includes('cash') || lower.includes('fondi') || lower.includes('copertur')) push('cash', risk, 'tesoro', true);
    else if (lower.includes('material') || lower.includes('acciaio') || lower.includes('risors')) push('material', risk, 'lavori', true);
    else if (lower.includes('manodopera') || lower.includes('workforce') || lower.includes('operai')) push('workforce', risk, 'lavori', true);
    else push('coverage', risk, meeting.leadSeat, true);
  }
  for (const prerequisite of read.prerequisites) push('prerequisite', prerequisite, meeting.leadSeat, true);
  if (read.coverage === 'short' && !requirements.some(item => item.kind === 'cash')) {
    push('cash', read.summary || 'Copertura finanziaria insufficiente', 'tesoro', true);
  }
  return requirements;
}

/** L'intervento del capofila d'opera: legge il catalogo e la distinta, non inventa. */
export function lavoriContribution(meeting: CouncilMeeting, read: MeetingEngineRead): MinisterContribution | null {
  if (!meeting.participants.includes('lavori')) return null;
  const parts: string[] = [];
  if (read.workLabel) parts.push(`L’opera è «${read.workLabel}»${read.regionLabel ? ` a ${read.regionLabel}` : ''}.`);
  if (read.durationDays !== null) parts.push(`Il piano dichiara ${read.durationDays} giorni.`);
  const missing = read.materials.filter(material => !material.ok);
  if (read.materials.length > 0) {
    parts.push(missing.length > 0
      ? `Della distinta mancano: ${missing.map(material => `${material.name}${material.missing ? ` (${material.missing})` : ''}`).join(', ')}.`
      : 'La distinta è coperta: materiali disponibili.');
  }
  if (read.prerequisites.length > 0) parts.push(`Prerequisiti: ${read.prerequisites.join(', ')}.`);
  if (parts.length === 0) parts.push('Nessun dato d’opera disponibile dal catalogo per questa richiesta.');
  const kind: MinisterContribution['kind'] = missing.length > 0 || read.prerequisites.length > 0 ? 'requirement' : 'proposal';
  return makeContribution(meeting, 'lavori', kind, parts.join(' '), ['check-feasibility']);
}

/** L'intervento del Tesoro: costo, copertura e margine **dal motore**. */
export function tesoroContribution(meeting: CouncilMeeting, read: MeetingEngineRead): MinisterContribution | null {
  if (!meeting.participants.includes('tesoro')) return null;
  const parts: string[] = [];
  if (read.costLabel) parts.push(`Il progetto costa ${read.costLabel}${read.costNote ? ` (${read.costNote})` : ''}.`);
  if (read.availableLabel) parts.push(`Abbiamo ${read.availableLabel} realmente impegnabili.`);
  if (read.coverage === 'covered') parts.push('La copertura c’è.');
  else if (read.coverage === 'short') parts.push('Non c’è la copertura necessaria.');
  else parts.push('La copertura va ancora verificata.');
  if (parts.length === 0) parts.push('Nessun dato finanziario disponibile per questa richiesta.');
  const kind: MinisterContribution['kind'] = read.coverage === 'short' ? 'objection' : 'fact';
  return makeContribution(meeting, 'tesoro', kind, parts.join(' '), ['check-feasibility', 'national-accounts']);
}

/**
 * Applica un intervento esterno (il Presidente, o una sedia interpellata) e,
 * quando arriva una lettura del motore, aggiorna piano, requisiti e contributi
 * delle sedie competenti. **Deterministico**: chi parla dipende dai dati, non da
 * un'autonomia casuale (B6/B13).
 */
export function applyEngineRead(meeting: CouncilMeeting, read: MeetingEngineRead): CouncilMeeting {
  let next = meeting;
  const workspace = meetingWorkspaceFromRead(next, read);
  const unresolved = meetingRequirementsFromRead(next, read);
  const contributions: MinisterContribution[] = [];
  const lavori = lavoriContribution(next, read);
  if (lavori) contributions.push(lavori);
  const tesoro = tesoroContribution(next, read);
  if (tesoro) contributions.push(tesoro);
  for (const contribution of contributions) next = addContribution(next, contribution);
  const execution: MeetingExecutionPlan = {
    ...(read.workId ? { workId: read.workId } : {}),
    ...(read.regionId ? { regionId: read.regionId } : {}),
    ...(read.workDeclaration ? { workDeclaration: read.workDeclaration } : {}),
    feasibilityRef: read.source,
  };
  return { ...next, workspace, unresolved, execution, status: meetingStatus({ ...next, workspace, unresolved }) };
}

/** Lo stato derivato: pronto solo con un piano e nessun blocco del motore. */
export function meetingStatus(meeting: CouncilMeeting): MeetingStatus {
  if (meeting.contributions.length === 0) return 'opening';
  const hasLead = meeting.contributions.some(contribution => contribution.seat === meeting.leadSeat);
  const blockers = meeting.unresolved.filter(item => item.blocker);
  if (blockers.length > 0) return 'negotiating';
  if (hasLead && meeting.workspace.lines.length > 0) return meeting.status === 'closed' ? 'closed' : 'ready-for-act';
  return 'gathering-inputs';
}

/** La riunione può diventare atto? Un piano, nessun blocco, e un capofila che ha parlato. */
export function isMeetingReadyForAct(meeting: CouncilMeeting): boolean {
  return meeting.unresolved.every(item => !item.blocker)
    && meeting.workspace.lines.length > 0
    && meeting.contributions.some(contribution => contribution.seat === meeting.leadSeat);
}

/** Il piano d'esecuzione verificato, che l'atto deve conservare (B16). */
export function meetingExecutionPlan(meeting: CouncilMeeting): MeetingExecutionPlan {
  return meeting.execution;
}

/**
 * Dalla riunione all'atto: **un** piano concordato. Se il motore ha risolto una
 * dichiarazione d'opera con i detentori, l'atto la porta con sé e resta un
 * ordine d'opera; altrimenti lo dichiara, invece di spacciare la prosa per una
 * costruzione (B15/B16).
 */
export function meetingActDraft(meeting: CouncilMeeting, context: { readonly seat?: CabinetSeat } = {}): ProposalActDraft {
  const seat = context.seat ?? meeting.leadSeat;
  const title = meeting.workspace.work ?? meeting.objective;
  const lines: string[] = [title];
  if (meeting.workspace.region) lines.push(`— Luogo: ${meeting.workspace.region}`);
  for (const line of meeting.workspace.lines) {
    if (line.label === 'Opera' || line.label === 'Luogo') continue;
    lines.push(`— ${seatSpeaker(line.owner)} · ${line.label}: ${line.value}`);
  }
  const outstanding = meeting.unresolved.filter(item => !item.blocker).map(item => item.label);
  if (outstanding.length > 0) lines.push(`Questioni politiche: ${outstanding.join('; ')}`);
  const blocked = meeting.unresolved.filter(item => item.blocker).map(item => item.label);
  if (blocked.length > 0) lines.push(`Da sciogliere prima dell’esecuzione: ${blocked.join('; ')}`);
  const text = lines.join('\n');

  const declaration = meeting.execution.workDeclaration ?? null;
  const hasWork = Boolean(declaration && declaration.materialActorId);
  const capability = hasWork ? 'engine-order' : (declaration ? 'unsupported' : 'text-order');
  const note = hasWork
    ? 'La distinta è coperta: il motore apre il cantiere e addebita la cassa all’esecuzione.'
    : declaration
      ? 'Distinta non coperta: mancano i materiali. Registrare non aprirebbe il cantiere.'
      : 'Nessuna dichiarazione d’opera risolta dal motore: l’atto resterebbe prosa.';
  const work: WorkDeclarationInput | null = hasWork && declaration && declaration.materialActorId
    ? { workId: declaration.workId, payerActorId: declaration.payerActorId, materialActorId: declaration.materialActorId, funded: declaration.funded }
    : null;

  return {
    id: `meeting:${meeting.id}`,
    seat,
    roadId: meeting.id,
    title,
    text,
    capability,
    note,
    ...(work ? { work } : {}),
  };
}

/** Un nuovo turno apre una nuova riunione: la vecchia è memoria (Fase A). */
export function isFreshMeeting(meeting: CouncilMeeting | null, turn: number): boolean {
  return meeting === null || meeting.turn !== turn;
}
