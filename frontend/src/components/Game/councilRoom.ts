/** A council room belongs to a question, never to one minister. UI discussion only;
 * verified figures and execution remain the engine's responsibility. */
import type { AdvisorHistoryItem, CouncilIssue, GovernmentSituationView, MinisterCouncilContext } from '../../services/api';
import { activeProposal, applyDecisionBatch, emptyWorkspace, type DecisionAction, type DecisionMeasure, type DecisionWorkspace } from './decisionWorkspace';
import type { ProposalActDraft } from './actDraft';
import { parsePresentation, type PresentationDirective } from './presentation';
import { CABINET_SEATS, type CabinetSeat } from './seatDecisionBoards';
import { seatSpeaker } from './councilMeeting';
import { discussedProposal, openQuestion, type MinisterMemoryRef, type MinisterMemoryRecord } from './ministerMemory';

export interface CouncilMessage extends AdvisorHistoryItem {
  id: string;
  seat?: CabinetSeat;
  kind: 'speech' | 'event' | 'error';
  evidence?: readonly PresentationDirective[];
  /** Canonical proposals from the backend; never admitted or opened automatically. */
  proposedIssues?: readonly CouncilIssue[];
}
export interface CouncilInvitation { id: string; from: CabinetSeat; minister: CabinetSeat; question: string }
/** P0.3 — Una strada suggerita da un ministro: chi l'ha proposta e in quale intervento. */
export interface CouncilProposedOption { optionId: string; proposedBy: CabinetSeat; messageId: string }

/**
 * P3 — Il contesto di un VERO follow-up: la seduta non ripropone strade, riferisce
 * gli outcome reali di una decisione chiusa (owner, scadenza, verifiche, esito).
 */
export interface CouncilSourceFollowUp {
  pressureId: string;
  label: string;
  owner: CabinetSeat;
  dueDate: string;
  checks: string[];
  outcome: string[];
  originDecision: string;
}
export interface CouncilPosition {
  status: 'support' | 'conditional' | 'oppose' | 'pending';
  reason: string;
  revision: number;
}
export interface CouncilAssessment { agreements: string[]; disagreements: string[] }
export interface CouncilRoomState {
  id: string;
  scopeKey: string;
  topic: string;
  initiatorMinister: CabinetSeat;
  participants: CabinetSeat[];
  messages: CouncilMessage[];
  sharedBoard: DecisionWorkspace;
  invitations: CouncilInvitation[];
  positions: Partial<Record<CabinetSeat, CouncilPosition>>;
  assessments: Partial<Record<CabinetSeat, CouncilAssessment>>;
  phase: 'discussion' | 'drafting';
  /**
   * Legacy rooms retain their original situation for reading/resuming.
   * New rooms originate from sourceIssue; neither path resolves engine state here.
   */
  sourceSituation?: GovernmentSituationView;
  /** Preferred origin of new rooms: complete, server-verified issue provenance. */
  sourceIssue?: CouncilIssue;
  /** P3 — Presente quando la seduta è un RAPPORTO di follow-up, non una situazione. */
  sourceFollowUp?: CouncilSourceFollowUp;
  /**
   * Legacy minister suggestions, retained for older rooms only.
   * They are not part of sourceIssue context or execution.
   */
  proposedPressureOptions: CouncilProposedOption[];
  /** Legacy selections for reading old rooms; never resolve a Pressure in the UI. */
  selectedPressureOptions: string[];
}

/** Un'opzione della situazione è selezionabile solo se il motore la conosce. */
export function situationOption(room: CouncilRoomState, optionId: string) {
  return room.sourceIssue ? undefined : room.sourceSituation?.options.find(option => option.id === optionId);
}

/** Il Presidente conferma o esclude una strada canonica sulla Tavola. */
export function togglePressureOption(room: CouncilRoomState, optionId: string): CouncilRoomState {
  if (!situationOption(room, optionId)) return room;
  const selected = room.selectedPressureOptions.includes(optionId)
    ? room.selectedPressureOptions.filter(id => id !== optionId)
    : [...room.selectedPressureOptions, optionId];
  return { ...room, selectedPressureOptions: selected };
}

/** P0.2 — Il Presidente CONFERMA una strada (proposta o conosciuta dal motore). */
export function confirmPressureOption(room: CouncilRoomState, optionId: string): CouncilRoomState {
  if (!situationOption(room, optionId) || room.selectedPressureOptions.includes(optionId)) return room;
  return { ...room, selectedPressureOptions: [...room.selectedPressureOptions, optionId] };
}

/** P0.2 — Il Presidente ESCLUDE una strada dalla risposta. */
export function excludePressureOption(room: CouncilRoomState, optionId: string): CouncilRoomState {
  if (!room.selectedPressureOptions.includes(optionId)) return room;
  return { ...room, selectedPressureOptions: room.selectedPressureOptions.filter(id => id !== optionId) };
}

export function createCouncilRoom(input: { id: string; scopeKey: string; initiatorMinister: CabinetSeat; sourceIssue?: CouncilIssue; sourceSituation?: GovernmentSituationView; sourceFollowUp?: CouncilSourceFollowUp }): CouncilRoomState {
  const sourceIssue = input.sourceIssue;
  const sourceSituation = input.sourceSituation;
  const sourceFollowUp = input.sourceFollowUp;
  return {
    id: input.id, scopeKey: input.scopeKey, initiatorMinister: input.initiatorMinister,
    // L'oggetto della seduta è il TITOLO della situazione (o del rapporto), non la domanda: la
    // domanda vive nella Tavola, sotto «DECISIONE DA PRENDERE».
    topic: sourceIssue?.title ?? (sourceFollowUp ? `Rapporto: ${sourceFollowUp.label}` : sourceSituation?.title ?? ''),
    participants: [input.initiatorMinister], messages: [], sharedBoard: emptyWorkspace('council'),
    invitations: [], positions: {}, assessments: {}, phase: 'discussion',
    proposedPressureOptions: [],
    selectedPressureOptions: [],
    ...(sourceIssue ? { sourceIssue } : {}),
    ...(sourceSituation ? { sourceSituation } : {}),
    ...(sourceFollowUp ? { sourceFollowUp } : {}),
  };
}
/**
 * WS-GOV-TURN-AWARENESS — Dopo una firma RIUSCITA la stanza riceve l'evento
 * narrativo dell'atto, così `councilHistory()` lo vede subito. Con una firma
 * fallita la stanza non cambia.
 */
/**
 * T-B1 — La strada scelta dal Presidente entra **nella stanza**, non solo nel
 * testo della bozza.
 *
 * Il difetto, misurato il 2026-10-08: `projectCurrentDecision` proietta ai
 * ministri la **Tavola della discussione** (`room.sharedBoard`), mai la strada
 * scelta. Portando una mossa in Consiglio, la scelta esisteva nel testo della
 * bozza ma non nella Tavola: i ministri discutevano di una Tavola vuota e
 * rispondevano «non ho nulla da portare», mentre il Presidente aveva già scelto
 * una direzione.
 *
 * Qui la scelta diventa una **misura** della Tavola, con `source: 'president'`:
 * la provenienza resta quella vera (è il Presidente che ha scelto) e i ministri
 * la vedono in `currentDecision` come qualunque altra misura discussa.
 *
 * Non firma e non accoda (T-I1): scrive nella stanza, che è discussione.
 */
export function seedChosenRoad(
  room: CouncilRoomState, chosenOption: { title: string; content: string }, messageId: string,
): CouncilRoomState {
  const label = chosenOption.title.trim().slice(0, 120);
  const text = chosenOption.content.trim().slice(0, 400);
  if (!label || !text) return room;
  // L'obiettivo diventa il titolo della questione, non la mossa: la Tavola dice
  // DI COSA si parla; la misura dice cosa il Presidente ha scelto.
  const objective = (room.sourceIssue?.title ?? room.topic ?? label).slice(0, 240);
  const measures = activeProposal(room.sharedBoard)?.measures ?? [];
  const nextBoard = applyDecisionBatch(room.sharedBoard, [
    // Rimpiazza la strada scelta in precedenza: una sola direzione del Presidente.
    ...measures.filter(measure => measure.source === 'president').map(measure => ({ op: 'reject-measure' as const, label: measure.label })),
    { op: 'set-objective', objective, source: 'president' },
    { op: 'update-proposal', objective, changes: [{ label, value: text, kind: 'other', source: 'president' }] },
  ], { messageId });
  return {
    ...room,
    sharedBoard: nextBoard,
    topic: nextBoard.objective ?? room.topic,
    // La scelta è un atto del Presidente, non un intervento di un ministro: la
    // cronologia la riceve come evento, così i ministri la leggono come scelta e
    // non come una propria battuta.
    messages: [...room.messages, {
      id: messageId, role: 'assistant', kind: 'event',
      content: `[Strada scelta dal Presidente] «${label}». La seduta la discute prima di preparare l'atto; solo la firma la inserisce nel registro.`,
    }],
  };
}

export function appendSignedActEvent(room: CouncilRoomState, queued: boolean, text: string, messageId: string): CouncilRoomState {
  if (!queued) return room;
  const act = text.trim();
  if (!act) return room;
  return appendCouncilMessage(room, {
    id: messageId, role: 'assistant', kind: 'event',
    content: `[Atto firmato] Il Presidente ha firmato «${act}». L'atto è registrato ed è in attesa di esecuzione al prossimo avanzamento.`,
  });
}

export function appendCouncilMessage(room: CouncilRoomState, message: CouncilMessage): CouncilRoomState {
  return { ...room, messages: [...room.messages, message] };
}
export function enterCouncil(room: CouncilRoomState, seat: CabinetSeat, messageId: string): CouncilRoomState {
  if (!CABINET_SEATS.includes(seat) || room.participants.includes(seat)) return room;
  return appendCouncilMessage({ ...room, participants: [...room.participants, seat], invitations: room.invitations.filter(invitation => invitation.minister !== seat) },
    { id: messageId, role: 'assistant', kind: 'event', seat, content: `${seatSpeaker(seat)} entra nella seduta` });
}

function cleanText(raw: unknown, max = 240): string | null {
  if (typeof raw !== 'string') return null;
  const value = raw.trim();
  return value && value.length <= max && !/[<>\n]/.test(value) ? value : null;
}
function textList(raw: unknown): string[] {
  return Array.isArray(raw) ? [...new Set(raw.slice(0, 12).flatMap(value => cleanText(value) ?? []))] : [];
}
/** Hide complete and in-flight control blocks, including malformed JSON. */
export function councilText(raw: string): string {
  return parsePresentation(raw.replace(/```(?:consiglio|council_issue)\b[\s\S]*?(?:```|$)/gi, '')).text.trim();
}

/** Validate the fully hydrated server shape, never turn model fact keys into facts.
 * Canonical-key verification is performed by the backend, not by the client. */
function canonicalIssue(raw: unknown): CouncilIssue | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const issue = raw as Record<string, unknown>;
  const text = (value: unknown, max = 4000): value is string => typeof value === 'string' && Boolean(value.trim()) && value.length <= max;
  if (!text(issue.id, 160) || !text(issue.title, 240) || !text(issue.question, 600) || !text(issue.createdDate, 80)
    || !['advisor', 'president', 'minister', 'event', 'follow-up'].includes(String(issue.origin))) return null;
  if (!Array.isArray(issue.suggestedMinisters) || !issue.suggestedMinisters.length || issue.suggestedMinisters.length > CABINET_SEATS.length
    || !issue.suggestedMinisters.every(seat => CABINET_SEATS.includes(seat as CabinetSeat))) return null;
  if (!Array.isArray(issue.sourceRefs) || !issue.sourceRefs.length || issue.sourceRefs.length > 24 || !issue.sourceRefs.every(ref => text(ref))) return null;
  if (!Array.isArray(issue.verifiedFacts) || !issue.verifiedFacts.length || issue.verifiedFacts.length > 24) return null;
  const verifiedFacts: CouncilIssue['verifiedFacts'] = [];
  for (const rawFact of issue.verifiedFacts) {
    if (!rawFact || typeof rawFact !== 'object' || Array.isArray(rawFact)) return null;
    const fact = rawFact as Record<string, unknown>;
    if (!text(fact.key, 240) || !text(fact.label) || !text(fact.value) || !text(fact.source) || !text(fact.sourceRef)
      || !issue.sourceRefs.includes(fact.sourceRef) || verifiedFacts.some(previous => previous.key === fact.key)) return null;
    verifiedFacts.push({ key: fact.key, label: fact.label, value: fact.value, source: fact.source, sourceRef: fact.sourceRef });
  }
  return { id: issue.id, title: issue.title, question: issue.question, verifiedFacts,
    suggestedMinisters: [...new Set(issue.suggestedMinisters)] as CabinetSeat[], origin: issue.origin as CouncilIssue['origin'],
    sourceRefs: [...new Set(issue.sourceRefs)] as string[], createdDate: issue.createdDate };
}

/** At most three completed, distinct server-validated proposals per speech. */
export function councilProposedIssues(raw: string): CouncilIssue[] {
  const issues: CouncilIssue[] = [];
  for (const match of raw.matchAll(/```council_issue\b\s*([\s\S]*?)```/gi)) {
    if (issues.length === 3) break;
    if (match[1].length > 32000) continue;
    try {
      const issue = canonicalIssue(JSON.parse(match[1]));
      if (issue && !issues.some(previous => previous.id === issue.id)) issues.push(issue);
    } catch { /* Malformed/unfinished proposals are not evidence. */ }
  }
  return issues;
}
function councilProtocol(raw: string): Record<string, unknown> | null {
  const json = /```consiglio\s*\n([\s\S]*?)```/i.exec(raw)?.[1];
  if (!json || json.length > 12000) return null;
  try { const value = JSON.parse(json); return value && typeof value === 'object' && !Array.isArray(value) ? value : null; } catch { return null; }
}

/** A model cannot claim it is the President or an authoritative engine read. */
function ministerActions(actions: readonly DecisionAction[], board: DecisionWorkspace): DecisionAction[] {
  return actions.flatMap(action => {
    if (action.op === 'accept-proposal' || action.op === 'reject-measure') return [];
    if (action.op === 'set-objective') return [{ ...action, source: 'minister' } as DecisionAction];
    if (action.op !== 'update-proposal') return [action];
    return [{ ...action, changes: action.changes?.map(change => {
      const existing = activeProposal(board)?.measures.find(measure => measure.label.toLowerCase() === change.label.toLowerCase());
      // Restating a confirmed measure does not revoke the President's choice.
      const unchanged = existing && ['value', 'amount', 'unit', 'sharePct'].every(key => {
        const field = key as 'value' | 'amount' | 'unit' | 'sharePct';
        return change[field] === undefined || change[field] === existing[field];
      });
      return { ...change, source: 'minister' as const, status: unchanged && existing.status === 'accepted' ? 'accepted' as const : change.status === 'unresolved' ? 'unresolved' as const : 'proposed' as const };
    }) } as DecisionAction];
  });
}
export function receiveCouncilReply(room: CouncilRoomState, seat: CabinetSeat, raw: string, messageId: string): CouncilRoomState {
  if (!room.participants.includes(seat)) return room;
  // Remove issue blocks before parsing decision directives: an issue is not a measure.
  const parsed = parsePresentation(raw.replace(/```council_issue\b[\s\S]*?(?:```|$)/gi, ''));
  const proposedIssues = councilProposedIssues(raw);
  const sharedBoard = applyDecisionBatch(room.sharedBoard, ministerActions(parsed.decisions, room.sharedBoard), { messageId });
  const protocol = councilProtocol(raw);
  // P0 — Il modello PUO' suggerire strade, ma non confermarle. Ogni id viene
  // validato contro la situazione (id inventati scartati) e registrato come
  // PROPOSTA con la sua provenienza. `selectedPressureOptions` resta intatto:
  // lo tocca solo il Presidente.
  const allowedOptions = new Set((room.sourceIssue ? [] : room.sourceSituation?.options ?? []).map(option => option.id));
  const incoming = Array.isArray(protocol?.pressureOptions)
    ? protocol.pressureOptions.filter((id): id is string => typeof id === 'string' && allowedOptions.has(id))
    : [];
  const proposedPressureOptions = [...room.proposedPressureOptions];
  for (const optionId of incoming) {
    if (proposedPressureOptions.some(item => item.optionId === optionId)) continue;
    proposedPressureOptions.push({ optionId, proposedBy: seat, messageId });
  }
  const invitations = [...room.invitations];
  if (Array.isArray(protocol?.needs_input_from)) {
    for (const request of protocol.needs_input_from.slice(0, 7)) {
      if (!request || typeof request !== 'object') continue;
      const minister = request.minister as CabinetSeat;
      const question = cleanText(request.question);
      if (!question || !CABINET_SEATS.includes(minister) || room.participants.includes(minister) || invitations.some(item => item.minister === minister)) continue;
      invitations.push({ id: `${messageId}:${minister}`, from: seat, minister, question });
    }
  }
  const positions = { ...room.positions };
  const position = protocol?.position as Record<string, unknown> | undefined;
  if (position && ['support', 'conditional', 'oppose', 'pending'].includes(String(position.status))) {
    const reason = cleanText(position.reason);
    if (reason) positions[seat] = { status: position.status as CouncilPosition['status'], reason, revision: sharedBoard.revision };
  }
  const assessments = protocol ? { ...room.assessments, [seat]: { agreements: textList(protocol.agreements), disagreements: textList(protocol.disagreements) } } : room.assessments;
  return appendCouncilMessage({ ...room, sharedBoard, invitations, positions, assessments, proposedPressureOptions,
    topic: room.sourceIssue?.title ?? sharedBoard.objective ?? room.topic }, { id: messageId, role: 'assistant', kind: 'speech', seat, speaker: seatSpeaker(seat), content: councilText(raw),
      ...(parsed.directives.length ? { evidence: parsed.directives } : {}), ...(proposedIssues.length ? { proposedIssues } : {}) });
}
export function confirmCouncilProposal(room: CouncilRoomState, messageId: string): CouncilRoomState {
  const proposal = activeProposal(room.sharedBoard);
  if (!proposal) return room;
  const changes = proposal.measures.filter(measure => measure.status === 'proposed').map(measure => ({ ...measure, source: 'president' as const, status: 'accepted' as const }));
  if (!changes.length) return room;
  return { ...room, sharedBoard: applyDecisionBatch(room.sharedBoard, [{ op: 'update-proposal', changes }], { messageId }) };
}
export function excludeCouncilMeasure(room: CouncilRoomState, label: string, messageId: string): CouncilRoomState {
  return { ...room, sharedBoard: applyDecisionBatch(room.sharedBoard, [{ op: 'reject-measure', label }], { messageId }) };
}
export function councilMeasureValue(measure: DecisionMeasure): string {
  const withUnit = (value: string | number) => `${value}${measure.unit ? ` ${measure.unit}` : ''}`;
  return [measure.sharePct !== undefined ? `${measure.sharePct}%` : null,
    measure.value !== undefined ? withUnit(measure.value) : null,
    measure.amount !== undefined ? withUnit(measure.amount) : null].filter(value => value !== null).join(' · ');
}
/** Unsigned discussion is memory, never an execution or queued decision. */
export function councilRoomMemory(room: CouncilRoomState, ref: MinisterMemoryRef, signed = false): { seat: CabinetSeat; record: MinisterMemoryRecord }[] {
  const proposal = activeProposal(room.sharedBoard);
  const summary = proposal?.measures.filter(measure => measure.status !== 'rejected').map(measure => `${measure.label}: ${councilMeasureValue(measure)}`).join('; ');
  const questions = [...councilOpenQuestions(room), ...room.invitations.map(invitation => `${seatSpeaker(invitation.minister)}: ${invitation.question}`)];
  return room.participants.flatMap(seat => [
    ...(!signed && summary ? [{ seat, record: discussedProposal(seat, { id: room.id, title: summary }, ref) }] : []),
    ...questions.map(question => ({ seat, record: openQuestion(seat, question, ref) })),
  ]);
}
/**
 * P2 — Firma tecnica dei contenuti CONGELATI del draft. Non va al motore: serve
 * a legare lo snapshot della selezione all'atto preparato.
 */
export function councilDraftSignature(draft: Pick<ProposalActDraft, 'text' | 'sourceIssueId' | 'sourcePressureId' | 'sourceSituationId' | 'selectedPressureOptions'>): string {
  const payload = [draft.text, draft.sourceIssueId ?? '', draft.sourcePressureId ?? '', draft.sourceSituationId ?? '', [...(draft.selectedPressureOptions ?? [])].sort().join(',')].join('|');
  let hash = 2166136261 >>> 0;
  for (let index = 0; index < payload.length; index += 1) {
    hash ^= payload.charCodeAt(index);
    hash = Math.imul(hash, 16777619) >>> 0;
  }
  return `draft:${hash.toString(16)}`;
}

/**
 * Legacy draft snapshot accessor. Retained for compatibility with old room data;
 * not used for signing or for resolving a Pressure from the frontend.
 */
export function councilDraftPressureOptions(draft: ProposalActDraft | null | undefined): string[] {
  return draft ? [...(draft.selectedPressureOptions ?? [])] : [];
}
export function councilHistory(room: CouncilRoomState, respondingSeat: CabinetSeat): AdvisorHistoryItem[] {
  return room.messages.filter(message => message.kind !== 'error' && message.content.trim()).slice(-20).map(message => ({
    role: message.role === 'assistant' && message.kind === 'speech' && message.seat === respondingSeat ? 'assistant' : 'user',
    content: message.kind === 'event' ? `[Seduta] ${message.content}` : `${message.role === 'user' ? 'Presidente' : message.seat ? seatSpeaker(message.seat) : 'Consiglio'}: ${councilText(message.content)}`,
  }));
}
export function councilContext(room: CouncilRoomState, respondingTo?: string): MinisterCouncilContext {
  return { sessionId: room.id, topic: (room.topic || 'Questione da definire con il Presidente').slice(0, 600), initiatorMinister: room.initiatorMinister,
    participants: room.participants, phase: room.phase,
    // P0.5 — Ogni ministro convocato riceve la SITUAZIONE, non solo la chat.
    ...(room.sourceIssue ? { sourceIssue: room.sourceIssue } : {
      ...(room.sourceSituation ? { sourceSituation: room.sourceSituation } : {}),
      ...(room.sourceFollowUp ? { sourceFollowUp: room.sourceFollowUp } : {}),
      ...(room.proposedPressureOptions.length ? { proposedPressureOptions: room.proposedPressureOptions.map(item => ({ optionId: item.optionId, proposedBy: item.proposedBy })) } : {}),
      ...(room.selectedPressureOptions.length ? { selectedPressureOptions: room.selectedPressureOptions } : {}),
    }),
    ...(respondingTo ? { respondingTo: respondingTo.slice(0, 2000) } : {}) };
}
export function councilOpenQuestions(room: CouncilRoomState): string[] {
  const questions = activeProposal(room.sharedBoard)?.unresolvedQuestions ?? [];
  const disagreements = room.participants.flatMap(seat => room.assessments[seat]?.disagreements ?? []);
  return [...new Set([...questions, ...disagreements])];
}
export function councilDraft(room: CouncilRoomState, turn?: number): ProposalActDraft {
  const proposal = activeProposal(room.sharedBoard);
  const measures = proposal?.measures.filter(measure => measure.status !== 'rejected' && measure.status !== 'unresolved') ?? [];
  const title = proposal?.objective || room.topic || 'Delibera del Consiglio';
  const lines = measures.map((measure, index) => {
    const value = councilMeasureValue(measure);
    return `Art. ${index + 1}\n${measure.label}${value ? `: ${value}` : ''}.`;
  });
  if (proposal?.constraints.length) lines.push(`Vincoli\n${proposal.constraints.join('; ')}.`);
  // T-I3 — Una bozza nata da una questione non è mai vuota. Senza misure porta
  // la domanda da cui la seduta nasce e dichiara che il testo si definirà
  // discutendo: i ministri hanno sempre qualcosa da leggere e da cui partire.
  if (!measures.length) {
    const question = room.sourceIssue?.question?.trim();
    if (question) lines.push(`Questione\n${question.replace(/[.!?]+$/, '')}.`);
    lines.push('Testo dell’atto\nsi definirà in seduta, dalle proposte dei ministri e dalle decisioni del Presidente.');
  }
  const text = [title, ...lines, `Proponenti: ${room.participants.filter(seat => room.messages.some(message => message.seat === seat && message.kind === 'speech')).map(seatSpeaker).join(', ')}`].join('\n\n');
  const base: ProposalActDraft = { id: `${room.id}:draft:${room.sharedBoard.revision}`, seat: 'council', roadId: proposal?.id ?? room.id, title,
    text, capability: 'text-order', note: 'Bozza comune dalla discussione. Solo la firma del Presidente inserisce l’atto nel registro; il motore ne valuta gli effetti all’avanzamento del tempo.',
    sourceSessionId: room.id, sourceRevision: room.sharedBoard.revision, sourceTurn: turn, sourceSeat: room.initiatorMinister,
    ...(room.sourceIssue ? { sourceIssueId: room.sourceIssue.id } : {
      ...(room.sourceSituation ? { sourcePressureId: room.sourceSituation.pressureId, sourceSituationId: room.sourceSituation.id } : {}),
      // Legacy metadata remains readable, never used to resolve a Pressure from the UI.
      selectedPressureOptions: [...room.selectedPressureOptions],
    }) };
  return { ...base, draftSignature: councilDraftSignature(base) };
}

/** One bounded round; each minister sees the completed interventions before theirs. */
export async function councilRound(
  room: CouncilRoomState, seats: readonly CabinetSeat[],
  respond: (seat: CabinetSeat, current: CouncilRoomState) => Promise<{ text: string; id: string }>,
  signal?: AbortSignal, onUpdate?: (room: CouncilRoomState) => void,
): Promise<CouncilRoomState> {
  let current = room;
  const speakers = [...new Set(seats)].filter(seat => room.participants.includes(seat)).slice(0, CABINET_SEATS.length);
  for (const seat of speakers) {
    signal?.throwIfAborted();
    const reply = await respond(seat, current);
    signal?.throwIfAborted();
    current = receiveCouncilReply(current, seat, reply.text, reply.id);
    onUpdate?.(current);
  }
  return current;
}
