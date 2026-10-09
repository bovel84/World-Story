/** Government: the reality advisor or the single roster selects the rapporteur.
 * Rooms own a shared transcript and board; only the President can admit a
 * colleague, prepare a common draft or sign through the existing order queue. */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AccessibleDialog } from '../ui/AccessibleDialog';
import { OrderRegister } from './OrderRegister';
import { CouncilRoomView } from './CouncilRoomView';
import { AdvisorChat } from './AdvisorChat';
import type { ChartDataInput } from './advisorCharts';
import type { GovernmentVisualSnapshot, MapFocusVisual } from './governmentVisual';
import { CouncilRoomBoard } from './CouncilRoomBoard';
import { ActDraftPanel } from './ActDraftPanel';
import { SeatCanvas } from './SeatCanvas';
import { ProposalComparison } from './ProposalComparison';
import { seatRoads } from './seatProposals';
import { applyCanvasBatch, availableEvidence, blockForEvidence, emptyCanvas, resolveCanvas } from './presentation';
import type { EvidenceCardIndex, InlineEvidenceCard } from './inlineEvidence';
import { deriveSeatCanvasBlocks } from './seatCanvasModel';
import { seatCanvasAuthoring } from './seatCanvasConfig';
import { treasuryAct } from './treasuryAct';
import { activeProposal } from './decisionWorkspace';
import { actStatus, type ProposalActDraft } from './actDraft';
import { buildConsequenceBoard, consequenceBoardSignature, type EnginePreview } from './consequenceBoard';
import { actionSnapshotKey } from './actionSnapshot';
import { projectCurrentDecision } from './ministerDialogueContext';
import { governmentSessionId } from './governmentSession';
import { nationalOperatingPicture } from './nationalOperatingPicture';
import { nationOperatingPictureInput, type NationOperatingPictureSources } from './nationOperatingPictureInput';
import { clientMandate, loadMemory, saveMemory, memoryScopeKey, seatRecords, withSeatRecords, recordMemory, queuedDecision, openQuestion, type MinisterMemoryStore } from './ministerMemory';
import { appendCouncilMessage, appendSignedActEvent, confirmCouncilProposal, councilContext, councilDiscussionIssue, councilDraft, councilHistory, councilOpenQuestions, councilRound, councilRoomMemory, excludeCouncilMeasure, createCouncilRoom, enterCouncil, type CouncilRoomState } from './councilRoom';
import { seatSpeaker } from './councilMeeting';
import { resolveCouncilExecution } from './councilExecution';
import { resolveCurrentRegionRef } from './meetingLocalization';
import type { MeetingFeasibilityInput } from './meetingEngineRead';
import { CABINET_SEATS, type CabinetSeat } from './seatDecisionBoards';
import { useGameStore } from '../../stores';
import { useSimulationStore } from '../../stores/simulationRuntime';
import { useGovernmentCompactLayout } from '../../hooks/useIsMobile';
import { gameApi, ministerApi, type CabinetSessionView, type CouncilIssue, type GovernmentFollowUpView, type GovernmentSituationView } from '../../services/api';
import type { WorkDeclarationInput } from './cabinetOrder';
import './councilRoom.css';

export interface GovernmentOfficeProps {
  open: boolean;
  onClose: () => void;
  gameId: string;
  session: CabinetSessionView | null;
  sessionLoading?: boolean;
  sessionError?: string | null;
  onQueueOrder?: (text: string, work?: WorkDeclarationInput, signatureKey?: string) => Promise<boolean>;
  pendingActions: Array<{ id: string; text: string }>;
  nationalName: string;
  currentDate?: string | null;
  currentTurn?: number | null;
  onWithdrawOrder: (id: string) => void;
  pictureSources: NationOperatingPictureSources;
  worldMapAssets?: import('../../services/api').WorldMapAssetsPayload | null;
  visualSnapshot?: GovernmentVisualSnapshot;
  onFocusMap?: (card: MapFocusVisual) => void;
}
interface RoomDraft extends ProposalActDraft {
  signatureKey: string;
  signatureAttempted?: boolean;
  signatureNotice?: string;
  signaturePayload?: ProposalActDraft;
}

export function GovernmentOffice({ open, onClose, gameId, session,
  onQueueOrder, pendingActions, nationalName, currentDate = null, currentTurn = null, onWithdrawOrder, pictureSources, worldMapAssets, visualSnapshot, onFocusMap }: GovernmentOfficeProps) {
  const branchId = useSimulationStore(state => state.state?.branchId ?? null);
  const history = useGameStore(state => state.history);
  const isMobile = useGovernmentCompactLayout();
  const mandate = clientMandate(pictureSources.government, pictureSources.account?.polityId ?? null);
  const scopeKey = `${governmentSessionId({ gameId, branchId, turn: currentTurn ?? 0, kind: 'council' })}|${mandate}`;
  const memoryScope = useMemo(() => ({ gameId, branchId, mandate: clientMandate(pictureSources.government, pictureSources.account?.polityId ?? null) }), [gameId, branchId, pictureSources.government, pictureSources.account?.polityId]);
  const memoryKey = memoryScopeKey(memoryScope);
  const loadedMemory = useMemo(() => loadMemory(memoryScope), [memoryKey]);
  const [memoryCache, setMemoryCache] = useState<{ key: string; records: MinisterMemoryStore }>(() => ({ key: memoryKey, records: loadedMemory }));
  const memory = memoryCache.key === memoryKey ? memoryCache.records : loadedMemory;
  useEffect(() => { setMemoryCache(previous => previous.key === memoryKey ? previous : { key: memoryKey, records: loadedMemory }); }, [memoryKey, loadedMemory]);
  useEffect(() => { if (memoryCache.key === memoryKey) saveMemory(memoryScope, memoryCache.records); }, [memoryKey, memoryCache, memoryScope]);
  const [rooms, setRooms] = useState<Record<string, CouncilRoomState>>({});
  const roomsRef = useRef(rooms);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [drafts, setDrafts] = useState<Record<string, RoomDraft>>({});
  const draftsRef = useRef(drafts);
  draftsRef.current = drafts;
  const [inputs, setInputs] = useState<Record<string, string>>({});
  const [target, setTarget] = useState<CabinetSeat | 'council'>('council');
  const [busy, setBusy] = useState(false);
  const [speaking, setSpeaking] = useState<CabinetSeat | null>(null);
  const [streamText, setStreamText] = useState('');
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  // P0.4 — Il ministro che non ha risposto: si può riprovare SOLO lui, con lo
  // stato ATTUALE della stanza, senza rimandare il messaggio del Presidente.
  const [failedTurn, setFailedTurn] = useState<{ roomId: string; seat: CabinetSeat; message: string } | null>(null);
  const [sheetOpen, setSheetOpen] = useState(false);
  const [focusedEvidence, setFocusedEvidence] = useState<{ seat: CabinetSeat; card: InlineEvidenceCard } | null>(null);
  const focusedEvidenceRef = useRef<HTMLElement>(null);
  const operationRef = useRef<{ controller: AbortController; roomId: string } | null>(null);
  const signatureRef = useRef<string | null>(null);
  const openingRef = useRef<AbortController | null>(null);
  const currentRef = useRef({ open, activeId, scopeKey, memoryKey });
  currentRef.current = { open, activeId, scopeKey, memoryKey };
  const originRef = useRef({ scopeKey, memoryScope, memoryKey, date: currentDate, turn: currentTurn });
  const room = activeId ? rooms[activeId] : null;
  const activeRoom = room?.scopeKey === scopeKey ? room : null;
  const draft = activeRoom ? drafts[activeRoom.id] ?? null : null;

  const updateRoom = useCallback((next: CouncilRoomState): void => {
    if (next.scopeKey !== currentRef.current.scopeKey) return;
    roomsRef.current = { ...roomsRef.current, [next.id]: next };
    setRooms(roomsRef.current);
  }, []);
  const interrupt = useCallback((): void => {
    operationRef.current?.controller.abort();
    operationRef.current = null;
    openingRef.current?.abort();
    openingRef.current = null;
    setBusy(false);
    setSpeaking(null);
    setStreamText('');
  }, []);
  // Close/back/turn changes cancel pending work, not the retained transcript.
  useEffect(() => { interrupt(); setSheetOpen(false); setError(''); setNotice(''); setFailedTurn(null); }, [open, activeId, scopeKey, interrupt]);
  useEffect(() => () => { operationRef.current?.controller.abort(); openingRef.current?.abort(); }, []);
  useEffect(() => {
    const origin = originRef.current;
    if (origin.scopeKey === scopeKey) return;
    let archived = loadMemory(origin.memoryScope);
    for (const previous of Object.values(roomsRef.current)) {
      if (previous.scopeKey !== origin.scopeKey) continue;
      for (const { seat, record } of councilRoomMemory(previous, { gameDate: origin.date ?? '', turn: origin.turn ?? undefined }, Boolean(draftsRef.current[previous.id] && actStatus(draftsRef.current[previous.id], pendingActions, history).state !== 'prepared'))) {
        archived = withSeatRecords(archived, seat, recordMemory(archived[seat] ?? [], record));
      }
    }
    saveMemory(origin.memoryScope, archived);
    if (origin.memoryKey === memoryKey) setMemoryCache({ key: memoryKey, records: archived });
    roomsRef.current = {};
    setRooms({}); setDrafts({}); setInputs({}); setActiveId(null);
  }, [scopeKey, memoryKey]);
  useEffect(() => { originRef.current = { scopeKey, memoryScope, memoryKey, date: currentDate, turn: currentTurn }; }, [scopeKey, memoryScope, memoryKey, currentDate, currentTurn]);

  const picture = useMemo(() => nationalOperatingPicture(nationOperatingPictureInput(pictureSources)), [pictureSources]);
  // WS-GOV-ADVISOR-HUB P11 — Le stesse fonti del dossier per le figure del Consulente:
  // nessuna chiamata in più, nessuna cifra dal modello.
  const advisorChartData = useMemo<ChartDataInput>(() => ({
    regions: Object.values(pictureSources.regions ?? {}),
    account: pictureSources.account,
    resources: pictureSources.resources,
    budget: pictureSources.government?.budget ?? null,
    history: pictureSources.accountHistory ?? [],
    facilities: worldMapAssets?.facilities ?? [],
    resourceSites: worldMapAssets?.resources ?? [],
    playerPolityId: pictureSources.account?.polityId ?? '',
  }), [pictureSources, worldMapAssets]);
  const treasury = useMemo(() => treasuryAct({ session, picture, sources: pictureSources }), [session, picture, pictureSources]);
  const catalogs = useMemo(() => {
    const result: Partial<Record<CabinetSeat, ReturnType<typeof deriveSeatCanvasBlocks>>> = {};
    for (const seat of activeRoom?.participants ?? []) {
      const address = session?.addresses.find(candidate => candidate.seat === seat);
      if (address) result[seat] = deriveSeatCanvasBlocks({ seat, picture, sources: pictureSources, address,
        authored: seatCanvasAuthoring({ seat, picture, sources: pictureSources, act: treasury, address }) });
    }
    return result;
  }, [activeRoom?.participants, session, picture, pictureSources, treasury]);
  const evidenceIndex = useMemo(() => {
    const result: Partial<Record<CabinetSeat, EvidenceCardIndex>> = {};
    for (const seat of activeRoom?.participants ?? []) {
      const blocks = catalogs[seat] ?? [];
      const index: EvidenceCardIndex = {};
      for (const evidence of availableEvidence(blocks)) {
        const block = blockForEvidence(evidence, blocks);
        if (block) index[evidence] = { id: block.id, title: block.title, kind: block.kind };
      }
      result[seat] = index;
    }
    return result;
  }, [catalogs, activeRoom?.participants]);
  const evidenceCanvas = useMemo(() => {
    const message = activeRoom?.messages.find(candidate => candidate.id === focusedEvidence?.card.messageId && candidate.seat === focusedEvidence.seat);
    if (!message || !focusedEvidence) return null;
    const address = session?.addresses.find(candidate => candidate.seat === focusedEvidence.seat) ?? null;
    const messageIndex = activeRoom!.messages.indexOf(message);
    const discussion = activeRoom!.messages.slice(0, messageIndex).reverse().find(candidate => candidate.role === 'user')?.content;
    const canvas = applyCanvasBatch(emptyCanvas(), message.evidence ?? [], { messageId: message.id, quote: message.content, discussion });
    return resolveCanvas(canvas, catalogs[focusedEvidence.seat] ?? [], seatRoads(address, treasury));
  }, [activeRoom?.messages, focusedEvidence, catalogs, session, treasury]);
  useEffect(() => { setFocusedEvidence(null); }, [activeId, scopeKey]);
  useEffect(() => {
    if (!focusedEvidence) return;
    const frame = window.requestAnimationFrame(() => { focusedEvidenceRef.current?.scrollIntoView({ block: 'start' }); focusedEvidenceRef.current?.focus({ preventScroll: true }); });
    return () => window.cancelAnimationFrame(frame);
  }, [focusedEvidence]);
  const remember = useCallback((seats: readonly CabinetSeat[], summary: string, signed: boolean): void => {
    const starting = loadMemory(memoryScope);
    const records = seats.reduce((next, seat) => withSeatRecords(next, seat, recordMemory(next[seat] ?? [],
      signed ? queuedDecision(seat, summary, { gameDate: currentDate ?? '', turn: currentTurn ?? undefined })
        : openQuestion(seat, summary, { gameDate: currentDate ?? '', turn: currentTurn ?? undefined }))), starting);
    saveMemory(memoryScope, records);
    if (currentRef.current.memoryKey === memoryKey) setMemoryCache({ key: memoryKey, records });
  }, [currentDate, currentTurn, memoryScope, memoryKey]);

  const startRoom = (seat: CabinetSeat, sourceIssue?: CouncilIssue): CouncilRoomState | null => {
    if (operationRef.current || signatureRef.current) return null;
    interrupt();
    const next = createCouncilRoom({ id: crypto.randomUUID(), scopeKey, initiatorMinister: seat, ...(sourceIssue ? { sourceIssue } : {}) });
    updateRoom(next);
    setActiveId(next.id);
    setTarget('council');
    return next;
  };
  /** Dal Consulente entra la questione verificata, non una soluzione.
   * Tavola vuota: le misure emergono nella discussione; decide il Presidente. */
  const openIssue = (issue: CouncilIssue): void => {
    // Suggested seats are not admitted automatically: only the rapporteur starts.
    const discussionIssue = councilDiscussionIssue(issue);
    const rapporteur = discussionIssue.suggestedMinisters.find(seat => CABINET_SEATS.includes(seat)) ?? 'interno';
    const room = startRoom(rapporteur, discussionIssue);
    if (!room) return;
    const prepared: RoomDraft = {
      ...councilDraft(room, currentTurn ?? 0),
      signatureKey: crypto.randomUUID(),
    };
    setDrafts(previous => ({ ...previous, [room.id]: prepared }));
  };
  // P3 — Un VERO follow-up: la seduta riferisce gli outcome reali, non ripropone strade.
  const startRoomFollowUp = (followUp: GovernmentFollowUpView): void => {
    interrupt();
    const owner = CABINET_SEATS.find(seat => seat === followUp.owner) ?? 'interno';
    const next = createCouncilRoom({ id: crypto.randomUUID(), scopeKey, initiatorMinister: owner,
      sourceFollowUp: { pressureId: followUp.pressureId, label: followUp.label, owner, dueDate: followUp.dueDate, checks: followUp.checks, outcome: followUp.outcome, originDecision: followUp.origin.sourceId ?? '' } });
    updateRoom(next);
    setActiveId(next.id);
    setTarget('council');
  };
  // The initial greeting is part of the shared transcript, not a hidden 1:1 history.
  useEffect(() => {
    if (!open || !activeRoom || activeRoom.messages.length > 0) return;
    const initial = session?.addresses.find(address => address.seat === activeRoom.initiatorMinister) ?? {
      seat: activeRoom.initiatorMinister, label: seatSpeaker(activeRoom.initiatorMinister),
      opening: 'Presidente, quale questione vuole discutere? Verificheremo dati e vincoli prima di preparare un atto.',
    };
    const controller = new AbortController();
    openingRef.current = controller;
    const id = activeRoom.id;
    const owns = () => !controller.signal.aborted && currentRef.current.open && currentRef.current.activeId === id && currentRef.current.scopeKey === activeRoom.scopeKey;
    const addOpening = (text: string): void => {
      const current = roomsRef.current[id];
      if (!owns() || !current || current.messages.length > 0) return;
      updateRoom(appendCouncilMessage(current, { id: crypto.randomUUID(), role: 'assistant', seat: initial.seat, kind: 'speech', speaker: initial.label, content: text }));
    };
    // P3 — Se è un rapporto, l'apertura riceve un brief di follow-up (fatti di oggi,
    // nessuna decisione richiesta), così il ministro riferisce invece di riproporre.
    const followUp = activeRoom.sourceFollowUp;
    const openingBrief: GovernmentSituationView | null = activeRoom.sourceIssue ? null : activeRoom.sourceSituation ?? (followUp ? {
      id: `follow-up:${followUp.pressureId}`, pressureId: followUp.pressureId,
      title: `Rapporto: ${followUp.label}`, briefing: [followUp.label, ...followUp.outcome].filter(Boolean).join('. '),
      source: 'Registro del Governo', severity: 1, priority: 'rilevante', openedDate: followUp.dueDate, deadline: null, daysLeft: 0,
      leadMinister: followUp.owner, suggestedMinisters: [], verifiedFacts: followUp.outcome,
      decisionQuestion: '', options: [], inaction: { note: '' }, affectedDomains: [],
      origin: { type: 'previous-decision', sourceId: followUp.pressureId },
    } : null);
    Promise.resolve().then(() => ministerApi.opening(gameId, initial.seat, openingBrief, controller.signal, activeRoom.sourceIssue))
      .then(result => addOpening(result.reply)).catch(() => { if (owns()) addOpening(initial.opening); });
    return () => { controller.abort(); if (openingRef.current === controller) openingRef.current = null; };
  }, [open, activeRoom?.id, session, gameId, updateRoom]);

  const runRound = async (start: CouncilRoomState, seats: CabinetSeat[], message: string | ((seat: CabinetSeat) => string)): Promise<CouncilRoomState | null> => {
    if (operationRef.current || signatureRef.current) return null;
    openingRef.current?.abort();
    const operation = { controller: new AbortController(), roomId: start.id };
    operationRef.current = operation;
    const owns = () => operationRef.current === operation && !operation.controller.signal.aborted && currentRef.current.open
      && currentRef.current.activeId === start.id && currentRef.current.scopeKey === start.scopeKey;
    setBusy(true); setError(''); setNotice(''); setFailedTurn(null);
    let currentSpeaker: CabinetSeat | null = null;
    let lastOutbound: string | null = null;
    try {
      return await councilRound(start, seats, async (seat, current) => {
        if (!owns()) throw new DOMException('Session changed', 'AbortError');
        currentSpeaker = seat;
        setSpeaking(seat); setStreamText('');
        const outbound = typeof message === 'function' ? message(seat) : message;
        lastOutbound = outbound;
        const reply = await ministerApi.askStream(gameId, seat, outbound, councilHistory(current, seat), token => {
          if (owns()) setStreamText(text => text + token);
        }, seatRecords(memory, seat, currentDate), operation.controller.signal, projectCurrentDecision(current.sharedBoard),
        councilContext(current, current.messages[current.messages.length - 1]?.content));
        operation.controller.signal.throwIfAborted();
        if (!owns()) throw new DOMException('Session changed', 'AbortError');
        return { id: crypto.randomUUID(), text: reply };
      }, operation.controller.signal, next => {
        if (owns()) { updateRoom(next); setStreamText(''); }
      });
    } catch (failure) {
      if (owns()) {
        if (currentSpeaker && lastOutbound) {
          // P0.2 — Un guasto tecnico NON è una posizione politica: nessun
          // intervento viene aggiunto; si offre il retry del solo ministro.
          setFailedTurn({ roomId: start.id, seat: currentSpeaker, message: lastOutbound });
          setError('');
        } else {
          setError('Il Consiglio non riesce a rispondere ora. Gli interventi già conclusi sono conservati.');
        }
      }
      return null;
    } finally {
      if (operationRef.current === operation) { operationRef.current = null; setBusy(false); setSpeaking(null); setStreamText(''); }
    }
  };

  const send = (): void => {
    if (!activeRoom || busy || operationRef.current || signatureRef.current) return;
    const text = (inputs[activeRoom.id] ?? '').trim();
    if (!text) return;
    let next = appendCouncilMessage(activeRoom, { id: crypto.randomUUID(), role: 'user', kind: 'speech', content: text });
    if (!next.topic) next = { ...next, topic: text.slice(0, 240) };
    updateRoom(next);
    setInputs(previous => ({ ...previous, [next.id]: '' }));
    const first = target === 'council' ? next.initiatorMinister : target;
    void runRound(next, [first, ...next.participants.filter(seat => seat !== first)], text);
  };
  const convene = (seat: CabinetSeat): void => {
    if (!activeRoom || busy || operationRef.current || signatureRef.current || activeRoom.participants.includes(seat)) return;
    const request = activeRoom.invitations.find(invitation => invitation.minister === seat);
    const next = enterCouncil(activeRoom, seat, crypto.randomUUID());
    updateRoom(next);
    const message = request ? `Il Presidente ti convoca per rispondere a ${seatSpeaker(request.from)}: ${request.question}`
      : `Il Presidente convoca ${seatSpeaker(seat)} sulla questione in discussione. Confronta il tuo parere con gli interventi dei colleghi.`;
    void runRound(next, [seat, ...activeRoom.participants], participant => participant === seat ? message
      : `Il Presidente chiede il tuo riscontro all’intervento di ${seatSpeaker(seat)} e ai successivi interventi dei colleghi nella seduta condivisa. Valuta se modificano la tua proposta o i tuoi vincoli, senza attribuire loro un accordo non dichiarato.`);
  };
  const confirm = (): void => {
    if (!activeRoom || busy || operationRef.current || signatureRef.current) return;
    let next = confirmCouncilProposal(activeRoom, crypto.randomUUID());
    next = appendCouncilMessage(next, { id: crypto.randomUUID(), role: 'user', kind: 'speech', content: 'Confermo le misure proposte sulla Tavola. Le questioni aperte restano da risolvere.' });
    updateRoom(next);
  };
  const prepare = async (): Promise<void> => {
    if (!activeRoom || busy || operationRef.current || signatureRef.current || draftsRef.current[activeRoom.id]?.signatureAttempted) return;
    const proposal = activeProposal(activeRoom.sharedBoard);
    if (!proposal?.measures.some(measure => measure.status === 'proposed' || measure.status === 'accepted')) return;
    const next = appendCouncilMessage({ ...activeRoom, phase: 'drafting' }, { id: crypto.randomUUID(), role: 'user', kind: 'speech', content: 'Prepariamo una bozza comune: proponete clausole concrete, tenendo conto dei pareri e dei vincoli discussi.' });
    updateRoom(next);
    const completed = await runRound(next, next.participants, 'Il Presidente apre la redazione comune. Proponi o aggiorna nella decisione una clausola concreta, rispondendo alle condizioni dei colleghi. Non firmare e non inventare consenso.');
    if (!completed || currentRef.current.activeId !== completed.id || currentRef.current.scopeKey !== completed.scopeKey || !currentRef.current.open) return;
    const prepared: RoomDraft = { ...councilDraft(completed, currentTurn ?? 0), signatureKey: crypto.randomUUID() };
    setDrafts(previous => ({ ...previous, [completed.id]: prepared }));
    setNotice('Bozza comune preparata sulla Tavola. Leggila e correggila prima della firma.');
  };

  const [preview, setPreview] = useState<{ candidateKey: string; signature: string; result: EnginePreview & MeetingFeasibilityInput; resolved: ProposalActDraft } | null>(null);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [previewError, setPreviewError] = useState<string | null>(null);
  const previewRequestRef = useRef<AbortController | null>(null);
  const snapshotKey = actionSnapshotKey({ id: gameId, currentTurn, currentDate, headBranchId: branchId ?? undefined });
  const candidateKey = draft ? `${draft.signatureKey}|${snapshotKey}|${draft.text}` : '';
  const currentRegion = useMemo(() => resolveCurrentRegionRef(pictureSources.regions ?? [], pictureSources.account?.polityId), [pictureSources.regions, pictureSources.account?.polityId]);
  const refreshPreview = useCallback((): void => {
    if (!draft) return;
    previewRequestRef.current?.abort();
    const controller = new AbortController();
    previewRequestRef.current = controller;
    const key = candidateKey;
    setPreviewLoading(true); setPreviewError(null);
    gameApi.checkFeasibility(gameId, draft.text).then(result => {
      if (controller.signal.aborted) return;
      const resolved = resolveCouncilExecution(draft, result, pictureSources.regions ?? [], currentRegion);
      setPreview({ candidateKey: key, signature: consequenceBoardSignature({ snapshotKey, draft: resolved }), result, resolved });
    }).catch(() => {
      if (!controller.signal.aborted) { setPreview(null); setPreviewError('La verifica del motore non è disponibile. Riprova prima di firmare.'); }
    }).finally(() => { if (!controller.signal.aborted) setPreviewLoading(false); });
  }, [draft, candidateKey, snapshotKey, gameId, pictureSources.regions, currentRegion]);
  useEffect(() => {
    if (draft && open) refreshPreview();
    else { previewRequestRef.current?.abort(); setPreview(null); setPreviewLoading(false); }
    return () => previewRequestRef.current?.abort();
    // Edits deliberately invalidate the preview instead of sending on every keystroke.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [draft?.id, open, scopeKey]);
  const previewMatches = Boolean(preview && preview.candidateKey === candidateKey);
  const resolvedDraft = draft?.signaturePayload ?? (previewMatches ? preview!.resolved : draft);
  const consequenceBoard = resolvedDraft ? buildConsequenceBoard({ draft: resolvedDraft, snapshotKey, preview: preview?.result, previewSignature: preview?.signature }) : null;
  const stale = Boolean(draft && activeRoom && draft.sourceRevision !== activeRoom.sharedBoard.revision);
  const signDraft = async (candidate: ProposalActDraft): Promise<boolean> => {
    if (!activeRoom || !draft || !onQueueOrder || (stale && !draft.signatureAttempted) || busy || operationRef.current || signatureRef.current || !candidate.text.trim()) return false;
    const payload = draft.signaturePayload ?? (previewMatches && !previewLoading ? resolvedDraft : null);
    if (!payload || payload.capability === 'unsupported') return false;
    const current = draftsRef.current[activeRoom.id];
    if (!current || current.signatureKey !== draft.signatureKey || current.text !== candidate.text) return false;
    const roomId = activeRoom.id;
    signatureRef.current = draft.signatureKey;
    setBusy(true);
    const attempted = { ...draft, signatureAttempted: true, signaturePayload: payload, signatureNotice: undefined };
    draftsRef.current = { ...draftsRef.current, [roomId]: attempted };
    setDrafts(previous => ({ ...previous, [roomId]: attempted }));
    try {
      const queued = await onQueueOrder(payload.text, payload.work, draft.signatureKey);
      if (queued) {
        // WS-GOV-TURN-AWARENESS — La seduta vede subito l'atto firmato: il
        // ministro non ripropone una misura già decisa. Solo su firma riuscita.
        const live = roomsRef.current[roomId];
        if (live) updateRoom(appendSignedActEvent(live, true, payload.text, crypto.randomUUID()));
        remember(activeRoom.participants, payload.title, true);
        if (currentRef.current.activeId === roomId && currentRef.current.scopeKey === activeRoom.scopeKey) setNotice('Atto firmato e inserito nel registro. Sarà valutato dal motore quando avanzerai il tempo.');
      } else {
        setDrafts(previous => previous[roomId]?.signatureKey === draft.signatureKey ? { ...previous, [roomId]: { ...previous[roomId], signatureNotice: 'Firma non confermata. Riprova questa stessa bozza; per modificarla annulla la preparazione.' } } : previous);
      }
      return queued;
    } catch {
      setDrafts(previous => previous[roomId]?.signatureKey === draft.signatureKey ? { ...previous, [roomId]: { ...previous[roomId], signatureNotice: 'Il registro non conferma la firma. Riprova senza modificare la bozza.' } } : previous);
      return false;
    } finally { signatureRef.current = null; setBusy(false); }
  };

  // P0.4 — Riprova SOLO la sedia fallita, sullo stato ATTUALE della stanza: nessun
  // nuovo messaggio del Presidente, nessun evento di ingresso duplicato.
  const retryFailed = useCallback((): void => {
    if (!activeRoom || !failedTurn || failedTurn.roomId !== activeRoom.id || busy || operationRef.current) return;
    const seat = failedTurn.seat;
    const message = failedTurn.message;
    setFailedTurn(null);
    void runRound(activeRoom, [seat], message);
  }, [activeRoom, failedTurn, busy, runRound]);

  const locked = busy || Boolean(signatureRef.current);
  const board = activeRoom && <CouncilRoomBoard room={activeRoom} busy={locked} canPrepare={!draft?.signatureAttempted && Boolean(activeProposal(activeRoom.sharedBoard)?.measures.some(measure => measure.status === 'accepted' || measure.status === 'proposed'))}
    onConfirm={confirm} onExclude={label => {
      if (locked || operationRef.current) return;
      updateRoom(appendCouncilMessage(excludeCouncilMeasure(activeRoom, label, crypto.randomUUID()), { id: crypto.randomUUID(), role: 'user', kind: 'speech', content: `Escludo dalla proposta la misura «${label}».` }));
    }} onPrepare={() => void prepare()} onConvene={convene}>
    {evidenceCanvas && <section className="council-board-focus-evidence" ref={focusedEvidenceRef} tabIndex={-1} aria-label="Evidenza dalla discussione">
      <h3>{focusedEvidence?.card.title}</h3>
      {evidenceCanvas.mains.map(main => main.block && <SeatCanvas key={main.block.id} blocks={[main.block]} focusLabel={main.focusLabel} focusRegionIds={main.regionIds} />)}
      {evidenceCanvas.comparison && <ProposalComparison roads={evidenceCanvas.comparison.roads} />}
    </section>}
    <details className="council-board-evidence"><summary>Dati e fascicoli dei partecipanti</summary>
      {activeRoom.participants.map(seat => {
        const address = session?.addresses.find(candidate => candidate.seat === seat);
        if (!address) return null;
        const blocks = catalogs[seat] ?? [];
        return <section key={seat} className="council-board-dossier"><h3>{seatSpeaker(seat)}</h3><p>{address.reads}</p><SeatCanvas blocks={blocks} /></section>;
      })}
    </details>
    {draft && <>
      {stale && <p className="council-board-warning" role="status">La discussione ha modificato la proposta. {draft.signatureAttempted ? 'La firma già tentata conserva il testo originale per la verifica e i retry.' : 'Prepara una nuova bozza comune prima di firmare.'}</p>}
      {draft.signatureAttempted && <p className="council-board-warning">Firma già tentata: la bozza e la chiave restano immutabili. Per una nuova preparazione annulla esplicitamente questa bozza; un atto già registrato va ritirato dal registro.</p>}
      {councilOpenQuestions(activeRoom).length > 0 && <p className="council-board-warning">Restano questioni aperte. Questa bozza non implica un accordo unanime del Consiglio.</p>}
      <ActDraftPanel draft={resolvedDraft ?? draft} status={actStatus(draft, pendingActions, history)} busy={locked}
        signDisabled={!onQueueOrder || (!draft.signatureAttempted && (stale || !previewMatches || previewLoading || resolvedDraft?.capability === 'unsupported'))}
        editable={!draft.signatureAttempted && !stale} signatureNotice={draft.signatureNotice} mobile={isMobile}
        board={consequenceBoard} boardLoading={previewLoading} boardError={previewError} onRefreshBoard={refreshPreview}
        onEdit={text => { if (!draft.signatureAttempted && !busy) setDrafts(previous => ({ ...previous, [activeRoom.id]: { ...draft, text } })); }}
        onSign={signDraft} onCancel={() => setDrafts(previous => { const next = { ...previous }; delete next[activeRoom.id]; return next; })} />
    </>}
  </CouncilRoomBoard>;

  return <AccessibleDialog open={open} onClose={onClose} closeOnEscape={!sheetOpen} closeOnBackdrop={!sheetOpen}
    className={`suggestions-content government-office council-office ${activeRoom ? 'government-room-active' : 'government-home'}`} overlayClassName="government-office-overlay" ariaLabelledBy="government-office-title">
    {activeRoom ? <CouncilRoomView key={activeRoom.id} room={activeRoom} evidenceIndex={evidenceIndex} onFocusEvidence={(seat, card) => setFocusedEvidence({ seat, card })} nationalName={nationalName}
      currentDate={currentDate} isMobile={isMobile} busy={locked} speaking={speaking} streamText={streamText} input={inputs[activeRoom.id] ?? ''}
      target={target} onInput={text => setInputs(previous => ({ ...previous, [activeRoom.id]: text }))} onTarget={setTarget} onSend={send}
      onInterrupt={() => { interrupt(); setNotice('Intervento interrotto. La Tavola conserva solo le risposte concluse.'); }} onConvene={convene}
      onOpenIssue={openIssue} onBack={() => { interrupt(); setActiveId(null); }} onClose={onClose} onConclude={() => {
        if (locked) return;
        const status = draft ? actStatus(draft, pendingActions, history) : null;
        if (draft?.signatureAttempted && status?.state === 'prepared') { setNotice('La firma non è confermata: riprova la stessa bozza oppure annulla esplicitamente la preparazione prima di chiudere la seduta.'); return; }
        let records = loadMemory(memoryScope);
        for (const entry of councilRoomMemory(activeRoom, { gameDate: currentDate ?? '', turn: currentTurn ?? undefined }, Boolean(status && status.state !== 'prepared'))) records = withSeatRecords(records, entry.seat, recordMemory(records[entry.seat] ?? [], entry.record));
        saveMemory(memoryScope, records);
        setMemoryCache({ key: memoryKey, records });
        setRooms(previous => { const next = { ...previous }; delete next[activeRoom.id]; roomsRef.current = next; return next; });
        setActiveId(null);
      }} onSheetChange={setSheetOpen} board={board} draftPrepared={Boolean(draft)} notice={notice} error={error}
      failure={failedTurn && failedTurn.roomId === activeRoom.id ? { seat: failedTurn.seat } : null} onRetry={retryFailed} /> : <>
      <div className="government-office-bar">
        <button type="button" className="desk-close-x" onClick={onClose} aria-label="Chiudi il Governo">✕</button>
        <div className="council-head"><h2 className="council-title" id="government-office-title">Governo</h2>
          <p className="council-sub">Il Primo Consulente ti dice cosa richiede attenzione; da qui porti la questione al Consiglio.</p></div>
      </div>
      <section className="government-advisor" aria-label="Il Primo Consulente">
        <h3 className="government-advisor-heading">IL PRIMO CONSULENTE</h3>
        <AdvisorChat gameId={gameId} chartData={advisorChartData} scopeKey={scopeKey} onOpenIssue={openIssue} currentTurn={currentTurn ?? 0} visualSnapshot={visualSnapshot} onFocusMap={onFocusMap} />
      </section>
      <OrderRegister orders={pendingActions} nationalName={nationalName} date={currentDate} onWithdraw={onWithdrawOrder} />
      {Object.values(rooms).filter(candidate => candidate.scopeKey === scopeKey).map(candidate => <button type="button" key={candidate.id} className="council-room-resume" onClick={() => { setTarget('council'); setActiveId(candidate.id); }}>
        Riprendi seduta · {candidate.topic || seatSpeaker(candidate.initiatorMinister)} · {candidate.participants.length} ministri
      </button>)}
      <section className="government-roster" aria-label="Ministri">
        <h3 className="government-roster-heading">MINISTRI</h3>
        <ul className="government-roster-list">
          {CABINET_SEATS.map(seat => {
            const state = pictureSources.brief?.cabinet.find(entry => entry.seat === seat)?.state ?? 'available';
            const label = seatSpeaker(seat);
            return <li key={seat}>
              <button type="button" className="cabinet-pick government-roster-seat" data-seat={seat} data-state={state} title={`Apri la seduta con il ${label}`} onClick={() => startRoom(seat)}>
                <span className="government-roster-name">{label}</span>
                <span className={`government-roster-state council-state-${state}`}>{state === 'engaged' ? 'sul tavolo' : 'disponibile'}</span>
              </button>
            </li>;
          })}
        </ul>
      </section>
      {Boolean(pictureSources.followUps?.length) && <details className="government-reports">
        <summary>Rapporti verificati · {pictureSources.followUps!.length}</summary>
        <ul>{pictureSources.followUps!.map(followUp => <li key={followUp.id}>
          <span>{followUp.label}</span>
          <button type="button" onClick={() => startRoomFollowUp(followUp)}>Apri rapporto</button>
        </li>)}</ul>
      </details>}
    </>}
  </AccessibleDialog>;
}
export default GovernmentOffice;
