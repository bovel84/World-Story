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
import { ambiguousLocationQuestion, type MeetingLocation } from './meetingLocalization';

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
  readonly kind: 'coverage' | 'material' | 'prerequisite' | 'workforce' | 'cash' | 'policy' | 'location';
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

/**
 * WS-GOV-COUNCIL-HARDENING — la copertura monetaria **autorevole**: gli stessi
 * numeri che il motore usa per `funded`, non un ricalcolo del client. `required`
 * e `available` sono le cifre del motore; `margin` è la loro differenza, usata
 * solo per la visualizzazione della Tavola.
 */
export interface MeetingMoneyCoverage {
  readonly required: string | null;
  readonly available: string | null;
  readonly missing: string | null;
  readonly margin: string | null;
  readonly holder: string | null;
  readonly unit: string | null;
  readonly coverage: 'covered' | 'short' | 'unknown';
}

/** La riunione: stato della **seduta corrente** (B1). */
export interface CouncilMeeting {
  readonly id: string;
  /**
   * WS-GOV-MOBILE-FOCUS (M1/A1) — l'identità separa la **seduta** (game+branch+
   * turn) dalla **convocazione** (questa riunione specifica). Due riunioni nello
   * stesso turno con le stesse competenze NON sono la stessa riunione.
   */
  readonly sessionId: string;
  readonly meetingId: string;
  readonly sourceMessageId?: string;
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

/**
 * WS-GOV-MOBILE-FOCUS (A1) — l'identità di una convocazione: la seduta
 * (`sessionId`) e la convocazione (`meetingId`) sono due cose diverse. Il
 * `meetingId` identifica **quella specifica** riunione; derivarlo dai soli
 * partecipanti renderebbe uguali due decisioni diverse dello stesso turno.
 */
export interface CouncilMeetingIdentity {
  readonly sessionId: string;
  readonly meetingId: string;
  readonly sourceMessageId?: string;
}

/**
 * WS-GOV-MOBILE-CLEANUP (M1) — la richiesta che convoca una riunione. Non è una
 * `string`: porta con sé l'**identità del messaggio** del Presidente che l'ha
 * originata, così due richieste identiche nel testo restano due convocazioni
 * diverse. `objective` è la descrizione migliore già nota dal Decision
 * Workspace: diventa il titolo della Tavola mobile, senza inventare un nome.
 */
export interface MeetingPrompt {
  readonly text: string;
  readonly sourceMessageId: string;
  readonly objective?: string;
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
  /**
   * WS-GOV-COUNCIL-HARDENING — la copertura monetaria strutturata dal motore
   * (`deficits` + `availability`). Presente quando il preflight legge il
   * ledger; assente in legacy. La Tavola del Tesoro la mostra così com'è.
   */
  readonly money?: MeetingMoneyCoverage | null;
  /** La localizzazione canonica risolta dalla geografia della partita. */
  readonly location?: MeetingLocation | null;
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
  /**
   * WS-GOV-MOBILE-FOCUS (A3) — il soggetto a cui questa lettura appartiene.
   * `applyEngineRead` rifiuta una lettura che non nomina la stessa riunione:
   * mai una fattibilità per la ferrovia su una riunione che parla della
   * fabbrica. Opzionale per retro-compatibilità.
   */
  readonly subject?: string;
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

/**
 * WS-GOV-MOBILE-FOCUS (A1) — un identificatore stabile dal testo, per la
 * convocazione senza un `sourceMessageId`. Non usa `participants`: due
 * riunioni diverse con le stesse competenze restano distinte. djb2, niente
 * dipendenze e niente casualità: lo stesso testo dà sempre lo stesso id.
 */
function stableMeetingKey(value: string): string {
  let hash = 5381;
  for (let i = 0; i < value.length; i += 1) hash = ((hash << 5) + hash ^ value.charCodeAt(i)) >>> 0;
  return hash.toString(36);
}

/** L'identità della seduta (game+branch+turn): due turni sono due sedute. */
export function councilSessionId(gameId: string, branchId: string | null, turn: number): string {
  return `${gameId}|${branchId ?? 'main'}|${turn}`;
}

/**
 * WS-GOV-MOBILE-FOCUS (A1) — l'identità di una convocazione. La seduta è
 * `sessionId`; la **convocazione** è `meetingId` e nasce dal messaggio del
 * Presidente (o, in mancanza, dal testo). Mai dai partecipanti.
 */
export function councilMeetingIdentity(input: {
  readonly gameId: string;
  readonly branchId: string | null;
  readonly turn: number;
  readonly subject: string;
  readonly sourceMessageId?: string;
  readonly meetingSeq?: number;
}): CouncilMeetingIdentity {
  const sessionId = councilSessionId(input.gameId, input.branchId, input.turn);
  const meetingId = input.sourceMessageId
    ? `msg-${input.sourceMessageId}`
    : (input.meetingSeq != null ? `seq-${input.meetingSeq}` : `subj-${stableMeetingKey(meetingSubject(input.subject))}`);
  return { sessionId, meetingId, ...(input.sourceMessageId ? { sourceMessageId: input.sourceMessageId } : {}) };
}

/** Il soggetto della riunione è quello della richiesta? Guardia A3. */
export function meetsSubject(meeting: CouncilMeeting, subject: string): boolean {
  return meeting.subject === meetingSubject(subject);
}

/** Apre una riunione nel turno corrente: il passato non si trascina (Fase A). */
export function openMeeting(input: {
  readonly gameId: string;
  readonly branchId: string | null;
  readonly turn: number;
  readonly subject: string;
  readonly objective?: string;
  /** WS-GOV-MOBILE-FOCUS (A1) — il messaggio del Presidente che convoca. */
  readonly sourceMessageId?: string;
  /** WS-GOV-MOBILE-FOCUS (A1) — sequenza stabile quando manca il messaggio. */
  readonly meetingSeq?: number;
}): CouncilMeeting | null {
  const participants = selectParticipants(input.subject);
  if (participants.length < 2) return null;
  const leadSeat = selectLeadSeat(input.subject, participants);
  const identity = councilMeetingIdentity(input);
  const subject = meetingSubject(input.subject);
  return {
    id: `${identity.sessionId}#${identity.meetingId}`,
    sessionId: identity.sessionId,
    meetingId: identity.meetingId,
    ...(identity.sourceMessageId ? { sourceMessageId: identity.sourceMessageId } : {}),
    gameId: input.gameId,
    branchId: input.branchId,
    turn: input.turn,
    subject,
    objective: input.objective?.trim() || subject,
    participants,
    leadSeat,
    status: 'opening',
    workspace: { objective: input.objective?.trim() || subject, work: null, region: null, lines: [], risks: [] },
    contributions: [],
    unresolved: [],
    execution: {},
    revision: 0,
  };
}

/**
 * WS-GOV-MOBILE-FOCUS (A2) — aggiornare una riunione è un'azione dichiarata,
 * distinta dall'aprirne una nuova. `continueMeeting` applica una lettura alla
 * riunione **attiva** solo se la lettura appartiene alla stessa convocazione.
 */
export function continueMeeting(meeting: CouncilMeeting, read: MeetingEngineRead): CouncilMeeting {
  return applyEngineRead(meeting, read);
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
  if (meeting.participants.includes('tesoro') && (read.money || read.costLabel || read.availableLabel)) {
    const money = read.money ?? null;
    const withUnit = (value: string | null): string | null => (value ? `${value}${money?.unit ? ` ${money.unit}` : ''}` : null);
    const required = money ? withUnit(money.required) : read.costLabel;
    const available = money ? withUnit(money.available) : read.availableLabel;
    const coverage = money?.coverage ?? read.coverage;
    if (required) lines.push({ owner: 'tesoro', label: 'Costo opera', value: required, status: 'ok', source: read.source });
    if (available) lines.push({ owner: 'tesoro', label: 'Disponibile', value: available, status: 'ok', source: read.source });
    if (money?.missing) lines.push({ owner: 'tesoro', label: 'Mancano', value: withUnit(money.missing)!, status: 'missing', source: read.source });
    if (money?.margin) lines.push({ owner: 'tesoro', label: 'Margine', value: withUnit(money.margin)!, status: 'ok', source: read.source });
    lines.push({
      owner: 'tesoro',
      label: 'Copertura',
      value: coverage === 'covered' ? 'coperta' : coverage === 'short' ? 'scoperta' : 'da verificare',
      status: coverage === 'covered' ? 'ok' : coverage === 'short' ? 'missing' : 'unknown',
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
  // Quando il motore dichiara l'opera NON coperta, ogni materiale scoperto è un
  // blocco: è la ragione per cui `funded` può essere false anche a cassa piena.
  // A opera coperta non si aggiunge un blocco da una riga incoerente.
  if (read.coverage === 'short') {
    for (const material of read.materials) {
      if (!material.ok) push('material', `${material.name}${material.missing ? `: manca ${material.missing}` : ': mancante'}`, 'lavori', true);
    }
  }
  // WS-GOV-COUNCIL-HARDENING — la localizzazione ambigua è un blocco dichiarato:
  // la riunione non è pronta finché il Presidente non chiarisce quale regione.
  // Non si sceglie arbitrariamente fra più candidati canonici.
  if (read.location?.status === 'ambiguous') {
    push('location', ambiguousLocationQuestion(read.location.candidates), meeting.leadSeat, true);
  }
  // WS-GOV-MOBILE-FOCUS (A4) — un’opera **fisica** senza localizzazione non è
  // pronta: il cantiere non può sorgere «ovunque». Il blocco nasce solo quando
  // il motore ha risolto un’opera (distinta/materiali/tempi), non per una
  // richiesta generica senza opera.
  if (read.location?.status === 'missing' && (read.workDeclaration || (read.materials.length > 0 && read.durationDays !== null))) {
    push('location', 'Dove deve sorgere l’opera?', meeting.leadSeat, true);
  }
  if ((read.money?.coverage ?? read.coverage) === 'short' && !requirements.some(item => item.kind === 'cash')) {
    push('cash', read.summary || 'Copertura finanziaria insufficiente', 'tesoro', true);
  }
  // Invariante: se il motore non dichiara l'opera coperta, ci deve essere un
  // blocco visibile. Mai «coperta» con `funded=false` senza spiegazione.
  if (read.coverage === 'short' && !requirements.some(item => item.blocker)) {
    push('coverage', read.summary || 'Copertura dell’opera non verificata', 'tesoro', true);
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
  const money = read.money ?? null;
  const unit = money?.unit ? ` ${money.unit}` : '';
  const coverage = money?.coverage ?? read.coverage;
  const parts: string[] = [];
  const cost = money?.required ? `${money.required}${unit}` : read.costLabel;
  const available = money?.available ? `${money.available}${unit}` : read.availableLabel;
  if (cost) parts.push(`Il progetto costa ${cost}${read.costNote ? ` (${read.costNote})` : ''}.`);
  if (available) parts.push(`Abbiamo ${available} realmente impegnabili.`);
  if (money?.missing) parts.push(`Mancano ${money.missing}${unit}.`);
  if (money?.margin) parts.push(`Il margine dopo l’opera è ${money.margin}${unit}.`);
  if (coverage === 'covered') parts.push('La copertura c’è.');
  else if (coverage === 'short') parts.push('Non c’è la copertura necessaria.');
  else parts.push('La copertura va ancora verificata.');
  if (parts.length === 0) parts.push('Nessun dato finanziario disponibile per questa richiesta.');
  const kind: MinisterContribution['kind'] = coverage === 'short' ? 'objection' : 'fact';
  return makeContribution(meeting, 'tesoro', kind, parts.join(' '), ['check-feasibility', 'national-accounts']);
}

/**
 * Applica un intervento esterno (il Presidente, o una sedia interpellata) e,
 * quando arriva una lettura del motore, aggiorna piano, requisiti e contributi
 * delle sedie competenti. **Deterministico**: chi parla dipende dai dati, non da
 * un'autonomia casuale (B6/B13).
 */
export function applyEngineRead(meeting: CouncilMeeting, read: MeetingEngineRead): CouncilMeeting {
  // WS-GOV-MOBILE-FOCUS (A3) — la lettura appartiene alla stessa riunione? Una
  // fattibilità per la ferrovia non tocca la riunione che parla della fabbrica.
  // Le letture legacy (senza `subject`) restano accettate.
  if (read.subject != null && read.subject !== meeting.subject) return meeting;
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
    // Un `regionId` entra nell'esecuzione solo se la localizzazione è risolta:
    // con più candidati canonici la scelta resta al Presidente, non al client.
    ...(read.location?.status !== 'ambiguous' && read.regionId ? { regionId: read.regionId } : {}),
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
    ? {
        workId: declaration.workId,
        payerActorId: declaration.payerActorId,
        materialActorId: declaration.materialActorId,
        funded: declaration.funded,
        // WS-GOV-COUNCIL-HARDENING — la localizzazione canonica verificata
        // viaggia con l'atto fino all'ordine e al cantiere. Assente se la
        // riunione non ha risolto una regione (nessun ID inventato).
        ...(meeting.execution.regionId ? { regionId: meeting.execution.regionId } : {}),
      }
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
