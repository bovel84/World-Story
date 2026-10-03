/** A council room belongs to a question, never to one minister. UI discussion only;
 * verified figures and execution remain the engine's responsibility. */
import type { AdvisorHistoryItem, GovernmentSituationView, MinisterCouncilContext } from '../../services/api';
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
}
export interface CouncilInvitation { id: string; from: CabinetSeat; minister: CabinetSeat; question: string }
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
   * WS-GOV-SITUATIONS-LOOP — La situazione reale da cui nasce la seduta. Presente
   * solo per le sedute aperte dal Governo su una `GovernmentSituation`: le sedute
   * manuali restano identiche. Sopravvive a indietro/riprendi perché vive nella stanza.
   */
  sourceSituation?: GovernmentSituationView;
  /** Le opzioni canoniche già scelte sulla Tavola (id verificati dal motore). */
  selectedPressureOptions: string[];
}

/** Un'opzione della situazione è selezionabile solo se il motore la conosce. */
export function situationOption(room: CouncilRoomState, optionId: string) {
  return room.sourceSituation?.options.find(option => option.id === optionId);
}

/** Il Presidente conferma o esclude una strada canonica sulla Tavola. */
export function togglePressureOption(room: CouncilRoomState, optionId: string): CouncilRoomState {
  if (!situationOption(room, optionId)) return room;
  const selected = room.selectedPressureOptions.includes(optionId)
    ? room.selectedPressureOptions.filter(id => id !== optionId)
    : [...room.selectedPressureOptions, optionId];
  return { ...room, selectedPressureOptions: selected };
}

export function createCouncilRoom(input: { id: string; scopeKey: string; initiatorMinister: CabinetSeat; sourceSituation?: GovernmentSituationView }): CouncilRoomState {
  const sourceSituation = input.sourceSituation;
  return {
    id: input.id, scopeKey: input.scopeKey, initiatorMinister: input.initiatorMinister,
    // L'oggetto della seduta è il TITOLO della situazione, non la domanda: la
    // domanda vive nella Tavola, sotto «DECISIONE DA PRENDERE».
    topic: sourceSituation?.title ?? '',
    participants: [input.initiatorMinister], messages: [], sharedBoard: emptyWorkspace('council'),
    invitations: [], positions: {}, assessments: {}, phase: 'discussion',
    selectedPressureOptions: [],
    ...(sourceSituation ? { sourceSituation } : {}),
  };
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
  return parsePresentation(raw.replace(/```consiglio\b[\s\S]*?(?:```|$)/gi, '')).text.trim();
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
  const parsed = parsePresentation(raw);
  const sharedBoard = applyDecisionBatch(room.sharedBoard, ministerActions(parsed.decisions, room.sharedBoard), { messageId });
  const protocol = councilProtocol(raw);
  // WS-GOV-SITUATIONS-LOOP P1.1 — Il modello può proporre le strade canoniche,
  // ma SOLO id che esistono nella situazione. Un id inventato viene scartato.
  const allowedOptions = new Set((room.sourceSituation?.options ?? []).map(option => option.id));
  const proposedOptions = Array.isArray(protocol?.pressureOptions)
    ? protocol.pressureOptions.filter((id): id is string => typeof id === 'string' && allowedOptions.has(id))
    : [];
  const selectedPressureOptions = [...new Set([...room.selectedPressureOptions, ...proposedOptions])];
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
  return appendCouncilMessage({ ...room, sharedBoard, invitations, positions, assessments, selectedPressureOptions,
    topic: sharedBoard.objective ?? room.topic }, { id: messageId, role: 'assistant', kind: 'speech', seat, speaker: seatSpeaker(seat), content: councilText(raw), ...(parsed.directives.length ? { evidence: parsed.directives } : {}) });
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
/** Other ministers are user-role contributions, not synthetic turns in this minister's voice. */
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
    ...(room.sourceSituation ? { sourceSituation: room.sourceSituation } : {}),
    ...(room.selectedPressureOptions.length ? { selectedPressureOptions: room.selectedPressureOptions } : {}),
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
  return { id: `${room.id}:draft:${room.sharedBoard.revision}`, seat: 'council', roadId: proposal?.id ?? room.id, title,
    text: [title, ...lines, `Proponenti: ${room.participants.filter(seat => room.messages.some(message => message.seat === seat && message.kind === 'speech')).map(seatSpeaker).join(', ')}`].join('\n\n'),
    capability: 'text-order', note: 'Bozza comune dalla discussione. Solo la firma del Presidente inserisce l’atto nel registro; il motore ne valuta gli effetti all’avanzamento del tempo.',
    sourceSessionId: room.id, sourceRevision: room.sharedBoard.revision, sourceTurn: turn, sourceSeat: room.initiatorMinister,
    ...(room.sourceSituation ? { sourcePressureId: room.sourceSituation.pressureId, sourceSituationId: room.sourceSituation.id } : {}) };
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
