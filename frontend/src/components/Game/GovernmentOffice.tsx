/** Sala del Consiglio: the minister picker selects the initial rapporteur.
 * Rooms own a shared transcript and board; only the President can admit a
 * colleague, prepare a common draft or sign through the existing order queue. */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AccessibleDialog } from '../ui/AccessibleDialog';
import { CabinetSession } from './CabinetSession';
import { OrderRegister } from './OrderRegister';
import { CouncilRoomView } from './CouncilRoomView';
import { CouncilRoomBoard } from './CouncilRoomBoard';
import { ActDraftPanel } from './ActDraftPanel';
import { SeatCanvas } from './SeatCanvas';
import { deriveSeatCanvasBlocks } from './seatCanvasModel';
import { seatCanvasAuthoring } from './seatCanvasConfig';
import { treasuryAct } from './treasuryAct';
import { activeProposal } from './decisionWorkspace';
import { actStatus, type ProposalActDraft } from './actDraft';
import { buildConsequenceBoard, consequenceBoardSignature, type EnginePreview } from './consequenceBoard';
import { actionSnapshotKey } from './actionSnapshot';
import { projectCurrentDecision } from './ministerDialogueContext';
import { governmentSessionId } from './governmentSession';
import { deriveCouncilAgenda } from './councilAgenda';
import { nationalOperatingPicture } from './nationalOperatingPicture';
import { nationOperatingPictureInput, type NationOperatingPictureSources } from './nationOperatingPictureInput';
import { clientMandate, loadMemory, saveMemory, seatRecords, withSeatRecords, recordMemory, queuedDecision, openQuestion, type MinisterMemoryStore } from './ministerMemory';
import { appendCouncilMessage, confirmCouncilProposal, councilContext, councilDraft, councilHistory, councilOpenQuestions, councilRound, createCouncilRoom, enterCouncil, type CouncilRoomState } from './councilRoom';
import { seatSpeaker } from './councilMeeting';
import type { CabinetSeat } from './seatDecisionBoards';
import { useChatStore, useGameStore } from '../../stores';
import { useSimulationStore } from '../../stores/simulationRuntime';
import { useGovernmentCompactLayout } from '../../hooks/useIsMobile';
import { gameApi, ministerApi, type CabinetSessionView } from '../../services/api';
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
}
interface RoomDraft extends ProposalActDraft {
  signatureKey: string;
  signatureAttempted?: boolean;
  signatureNotice?: string;
}

export function GovernmentOffice({ open, onClose, gameId, session, sessionLoading = false, sessionError = null,
  onQueueOrder, pendingActions, nationalName, currentDate = null, currentTurn = null, onWithdrawOrder, pictureSources }: GovernmentOfficeProps) {
  const branchId = useSimulationStore(state => state.state?.branchId ?? null);
  const history = useGameStore(state => state.history);
  const legacyThreads = useChatStore(state => state.ministerChats);
  const isMobile = useGovernmentCompactLayout();
  const scopeKey = governmentSessionId({ gameId, branchId, turn: currentTurn ?? 0, kind: 'council' });
  const memoryScope = useMemo(() => ({ gameId, branchId, mandate: clientMandate(pictureSources.government, pictureSources.account?.polityId ?? null) }), [gameId, branchId, pictureSources.government, pictureSources.account?.polityId]);
  const [memory, setMemory] = useState<MinisterMemoryStore>(() => loadMemory(memoryScope));
  useEffect(() => { setMemory(loadMemory(memoryScope)); }, [memoryScope]);
  useEffect(() => { saveMemory(memoryScope, memory); }, [memoryScope, memory]);
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
  const [sheetOpen, setSheetOpen] = useState(false);
  const operationRef = useRef<{ controller: AbortController; roomId: string } | null>(null);
  const signatureRef = useRef<string | null>(null);
  const openingRef = useRef<AbortController | null>(null);
  const currentRef = useRef({ open, activeId, scopeKey });
  currentRef.current = { open, activeId, scopeKey };
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
  useEffect(() => { interrupt(); setSheetOpen(false); setError(''); setNotice(''); }, [open, activeId, scopeKey, interrupt]);
  useEffect(() => () => { operationRef.current?.controller.abort(); openingRef.current?.abort(); }, []);
  useEffect(() => {
    const kept = Object.fromEntries(Object.entries(roomsRef.current).filter(([, candidate]) => candidate.scopeKey === scopeKey));
    roomsRef.current = kept;
    setRooms(kept);
    setDrafts({});
    setInputs({});
    setActiveId(null);
  }, [scopeKey]);

  const picture = useMemo(() => nationalOperatingPicture(nationOperatingPictureInput(pictureSources)), [pictureSources]);
  const treasury = useMemo(() => treasuryAct({ session, picture, sources: pictureSources }), [session, picture, pictureSources]);
  const agenda = useMemo(() => deriveCouncilAgenda({ session, threads: legacyThreads, memory }), [session, legacyThreads, memory]);
  const remember = useCallback((seats: readonly CabinetSeat[], summary: string, signed: boolean): void => {
    setMemory(previous => seats.reduce((next, seat) => withSeatRecords(next, seat, recordMemory(next[seat] ?? [],
      signed ? queuedDecision(seat, summary, { gameDate: currentDate ?? '', turn: currentTurn ?? undefined })
        : openQuestion(seat, summary, { gameDate: currentDate ?? '', turn: currentTurn ?? undefined }))), previous));
  }, [currentDate, currentTurn]);

  const startRoom = (seat: CabinetSeat): void => {
    interrupt();
    const next = createCouncilRoom({ id: crypto.randomUUID(), scopeKey, initiatorMinister: seat });
    updateRoom(next);
    setActiveId(next.id);
    setTarget('council');
  };
  // The initial greeting is part of the shared transcript, not a hidden 1:1 history.
  useEffect(() => {
    if (!open || !activeRoom || activeRoom.messages.length > 0) return;
    const initial = session?.addresses.find(address => address.seat === activeRoom.initiatorMinister);
    if (!initial) return;
    const controller = new AbortController();
    openingRef.current = controller;
    const id = activeRoom.id;
    const owns = () => !controller.signal.aborted && currentRef.current.open && currentRef.current.activeId === id;
    const addOpening = (text: string): void => {
      const current = roomsRef.current[id];
      if (!owns() || !current || current.messages.length > 0) return;
      updateRoom(appendCouncilMessage(current, { id: crypto.randomUUID(), role: 'assistant', seat: initial.seat, kind: 'speech', speaker: initial.label, content: text }));
    };
    Promise.resolve().then(() => ministerApi.opening(gameId, initial.seat, controller.signal))
      .then(result => addOpening(result.reply)).catch(() => { if (owns()) addOpening(initial.opening); });
    return () => { controller.abort(); if (openingRef.current === controller) openingRef.current = null; };
  }, [open, activeRoom?.id, session, gameId, updateRoom]);

  const runRound = async (start: CouncilRoomState, seats: CabinetSeat[], message: string): Promise<CouncilRoomState | null> => {
    if (operationRef.current || signatureRef.current) return null;
    openingRef.current?.abort();
    const operation = { controller: new AbortController(), roomId: start.id };
    operationRef.current = operation;
    const owns = () => operationRef.current === operation && !operation.controller.signal.aborted && currentRef.current.open
      && currentRef.current.activeId === start.id && currentRef.current.scopeKey === start.scopeKey;
    setBusy(true); setError(''); setNotice('');
    let currentSpeaker: CabinetSeat | null = null;
    try {
      return await councilRound(start, seats, async (seat, current) => {
        if (!owns()) throw new DOMException('Session changed', 'AbortError');
        currentSpeaker = seat;
        setSpeaking(seat); setStreamText('');
        const reply = await ministerApi.askStream(gameId, seat, message, councilHistory(current, seat), token => {
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
        const who = currentSpeaker ? seatSpeaker(currentSpeaker) : 'Il Consiglio';
        setError(`${who} non risponde ora. Gli interventi già conclusi sono conservati; riprendi il confronto con un nuovo messaggio.`);
      }
      return null;
    } finally {
      if (operationRef.current === operation) { operationRef.current = null; setBusy(false); setSpeaking(null); setStreamText(''); }
    }
  };

  const send = (): void => {
    if (!activeRoom || busy || signatureRef.current) return;
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
    void runRound(next, [seat, ...activeRoom.participants], message);
  };
  const confirm = (): void => {
    if (!activeRoom || busy || signatureRef.current) return;
    let next = confirmCouncilProposal(activeRoom, crypto.randomUUID());
    next = appendCouncilMessage(next, { id: crypto.randomUUID(), role: 'user', kind: 'speech', content: 'Confermo le misure proposte sulla Tavola. Le questioni aperte restano da risolvere.' });
    updateRoom(next);
  };
  const prepare = async (): Promise<void> => {
    if (!activeRoom || busy || signatureRef.current) return;
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

  const [preview, setPreview] = useState<{ signature: string; result: EnginePreview } | null>(null);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [previewError, setPreviewError] = useState<string | null>(null);
  const previewRequestRef = useRef<AbortController | null>(null);
  const snapshotKey = actionSnapshotKey({ id: gameId, currentTurn, currentDate, headBranchId: branchId ?? undefined });
  const refreshPreview = useCallback((): void => {
    if (!draft) return;
    previewRequestRef.current?.abort();
    const controller = new AbortController();
    previewRequestRef.current = controller;
    const signature = consequenceBoardSignature({ snapshotKey, draft });
    setPreviewLoading(true); setPreviewError(null);
    gameApi.checkFeasibility(gameId, draft.text).then(result => {
      if (!controller.signal.aborted) setPreview({ signature, result });
    }).catch(() => {
      if (!controller.signal.aborted) { setPreview(null); setPreviewError('La verifica del motore non è disponibile. Riprova prima di firmare.'); }
    }).finally(() => { if (!controller.signal.aborted) setPreviewLoading(false); });
  }, [draft, snapshotKey, gameId]);
  useEffect(() => {
    if (draft && open) refreshPreview();
    else { previewRequestRef.current?.abort(); setPreview(null); setPreviewLoading(false); }
    return () => previewRequestRef.current?.abort();
    // Edits deliberately invalidate the preview instead of sending on every keystroke.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [draft?.id, open, scopeKey]);
  const consequenceBoard = draft ? buildConsequenceBoard({ draft, snapshotKey, preview: preview?.result, previewSignature: preview?.signature }) : null;
  const stale = Boolean(draft && activeRoom && draft.sourceRevision !== activeRoom.sharedBoard.revision);
  const signDraft = async (candidate: ProposalActDraft): Promise<boolean> => {
    if (!activeRoom || !draft || !onQueueOrder || stale || busy || signatureRef.current || !candidate.text.trim()) return false;
    const current = draftsRef.current[activeRoom.id];
    if (!current || current.signatureKey !== draft.signatureKey || current.text !== candidate.text) return false;
    const roomId = activeRoom.id;
    signatureRef.current = draft.signatureKey;
    setBusy(true);
    setDrafts(previous => ({ ...previous, [roomId]: { ...draft, signatureAttempted: true, signatureNotice: undefined } }));
    try {
      const queued = await onQueueOrder(candidate.text, candidate.work, draft.signatureKey);
      if (queued) {
        remember(activeRoom.participants, candidate.title, true);
        setNotice('Atto firmato e inserito nel registro. Sarà valutato dal motore quando avanzerai il tempo.');
      } else {
        setDrafts(previous => previous[roomId]?.signatureKey === draft.signatureKey ? { ...previous, [roomId]: { ...previous[roomId], signatureNotice: 'Firma non confermata. Riprova questa stessa bozza; per modificarla annulla la preparazione.' } } : previous);
      }
      return queued;
    } catch {
      setDrafts(previous => previous[roomId]?.signatureKey === draft.signatureKey ? { ...previous, [roomId]: { ...previous[roomId], signatureNotice: 'Il registro non conferma la firma. Riprova senza modificare la bozza.' } } : previous);
      return false;
    } finally { signatureRef.current = null; setBusy(false); }
  };

  const board = activeRoom && <CouncilRoomBoard room={activeRoom} busy={busy} canPrepare={Boolean(activeProposal(activeRoom.sharedBoard)?.measures.some(measure => measure.status === 'accepted' || measure.status === 'proposed'))}
    onConfirm={confirm} onPrepare={() => void prepare()} onConvene={convene}>
    {draft && <>
      {stale && <p className="council-board-warning" role="status">La discussione ha modificato la proposta: prepara una nuova bozza comune prima di firmare.</p>}
      {councilOpenQuestions(activeRoom).length > 0 && <p className="council-board-warning">Restano questioni aperte. Questa bozza non implica un accordo unanime del Consiglio.</p>}
      <ActDraftPanel draft={draft} status={actStatus(draft, pendingActions, history)} busy={busy || stale || !onQueueOrder}
        editable={!draft.signatureAttempted && !stale} signatureNotice={draft.signatureNotice} mobile={isMobile}
        board={consequenceBoard} boardLoading={previewLoading} boardError={previewError} onRefreshBoard={refreshPreview}
        onEdit={text => { if (!draft.signatureAttempted && !busy) setDrafts(previous => ({ ...previous, [activeRoom.id]: { ...draft, text } })); }}
        onSign={signDraft} onCancel={() => setDrafts(previous => { const next = { ...previous }; delete next[activeRoom.id]; return next; })} />
    </>}
    <details className="council-board-evidence"><summary>Dati e fascicoli dei partecipanti</summary>
      {activeRoom.participants.map(seat => {
        const address = session?.addresses.find(candidate => candidate.seat === seat);
        if (!address) return null;
        const blocks = deriveSeatCanvasBlocks({ seat, picture, sources: pictureSources, address,
          authored: seatCanvasAuthoring({ seat, picture, sources: pictureSources, act: treasury, address }) });
        return <section key={seat} className="council-board-dossier"><h3>{seatSpeaker(seat)}</h3><p>{address.reads}</p><SeatCanvas blocks={blocks} /></section>;
      })}
    </details>
  </CouncilRoomBoard>;

  return <AccessibleDialog open={open} onClose={onClose} closeOnEscape={!sheetOpen} closeOnBackdrop={!sheetOpen}
    className="suggestions-content government-office council-office" overlayClassName="government-office-overlay" ariaLabelledBy="government-office-title">
    {activeRoom ? <CouncilRoomView key={activeRoom.id} room={activeRoom} addresses={session?.addresses ?? []} nationalName={nationalName}
      currentDate={currentDate} isMobile={isMobile} busy={busy} speaking={speaking} streamText={streamText} input={inputs[activeRoom.id] ?? ''}
      target={target} onInput={text => setInputs(previous => ({ ...previous, [activeRoom.id]: text }))} onTarget={setTarget} onSend={send}
      onInterrupt={() => { interrupt(); setNotice('Intervento interrotto. La Tavola conserva solo le risposte concluse.'); }} onConvene={convene}
      onBack={() => { interrupt(); setActiveId(null); }} onClose={onClose} onConclude={() => {
        const questions = councilOpenQuestions(activeRoom);
        if (questions.length) remember(activeRoom.participants, questions.join('; '), false);
        else if (!draft || actStatus(draft, pendingActions, history).state === 'prepared') remember(activeRoom.participants, `Seduta chiusa senza firma: ${activeRoom.topic || 'questione da definire'}`, false);
        setRooms(previous => { const next = { ...previous }; delete next[activeRoom.id]; roomsRef.current = next; return next; });
        setActiveId(null);
      }} onSheetChange={setSheetOpen} board={board} draftPrepared={Boolean(draft)} notice={notice} error={error} /> : <>
      <button type="button" className="desk-close-x" onClick={onClose} aria-label="Chiudi il Governo">✕</button>
      <div className="council-head"><h2 className="council-title" id="government-office-title">Sala del Consiglio</h2>
        <p className="council-sub">Scegli il relatore iniziale per aprire una seduta. Convoca i colleghi, confronta le proposte e costruisci un atto comune.</p></div>
      <OrderRegister orders={pendingActions} nationalName={nationalName} date={currentDate} onWithdraw={onWithdrawOrder} />
      {Object.values(rooms).filter(candidate => candidate.scopeKey === scopeKey).map(candidate => <button type="button" key={candidate.id} className="council-room-resume" onClick={() => { setTarget('council'); setActiveId(candidate.id); }}>
        Riprendi seduta · {candidate.topic || seatSpeaker(candidate.initiatorMinister)} · {candidate.participants.length} ministri
      </button>)}
      <CabinetSession variant="pick" session={session} agenda={agenda} loading={sessionLoading} error={sessionError} onOpenSeat={address => startRoom(address.seat)} />
    </>}
  </AccessibleDialog>;
}
export default GovernmentOffice;
