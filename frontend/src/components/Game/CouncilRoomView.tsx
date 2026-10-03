import { useEffect, useRef, useState, type ReactNode } from 'react';
import { GovernmentBottomSheet } from '../ui/GovernmentBottomSheet';
import { RichText } from './RichText';
import { seatSpeaker } from './councilMeeting';
import { councilOpenQuestions, councilText, type CouncilRoomState } from './councilRoom';
import { activeProposal } from './decisionWorkspace';
import { inlineEvidenceCards, type EvidenceCardIndex, type InlineEvidenceCard } from './inlineEvidence';
import { isNearBottom } from './chatScroll';
import { CABINET_SEATS, type CabinetSeat } from './seatDecisionBoards';

export interface CouncilRoomViewProps {
  room: CouncilRoomState;
  evidenceIndex: Partial<Record<CabinetSeat, EvidenceCardIndex>>;
  onFocusEvidence: (seat: CabinetSeat, card: InlineEvidenceCard) => void;
  nationalName: string;
  currentDate?: string | null;
  isMobile: boolean;
  busy: boolean;
  speaking: CabinetSeat | null;
  streamText: string;
  input: string;
  target: CabinetSeat | 'council';
  onInput: (text: string) => void;
  onTarget: (target: CabinetSeat | 'council') => void;
  onSend: () => void;
  onInterrupt: () => void;
  onConvene: (seat: CabinetSeat) => void;
  onBack: () => void;
  onClose: () => void;
  onConclude: () => void;
  onSheetChange: (open: boolean) => void;
  board: ReactNode;
  draftPrepared: boolean;
  notice?: string;
  error?: string;
  /** Un ministro non ha risposto: errore operativo con retry del solo ministro. */
  failure?: { seat: CabinetSeat } | null;
  onRetry?: () => void;
}

/** «Ministro della Guerra» → «Guerra»: etichetta compatta per il retry. */
function shortSeat(label: string): string {
  return label.replace(/^Ministro (?:del |della |degli |dell’|dell'|dei )/, '');
}

function prefersReducedMotion(): boolean {
  return typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches === true;
}

export function CouncilRoomView({ room, evidenceIndex, onFocusEvidence, nationalName, currentDate, isMobile, busy, speaking, streamText, input, target,
  onInput, onTarget, onSend, onInterrupt, onConvene, onBack, onClose, onConclude, onSheetChange, board, draftPrepared, notice, error, failure, onRetry }: CouncilRoomViewProps) {
  const [boardOpen, setBoardOpen] = useState(false);
  const [conveneOpen, setConveneOpen] = useState(false);
  const [unread, setUnread] = useState(false);
  const threadRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const boardButtonRef = useRef<HTMLButtonElement>(null);
  const followRef = useRef(true);
  const previousCountRef = useRef(room.messages.length);
  useEffect(() => { onSheetChange(conveneOpen || (isMobile && boardOpen)); }, [conveneOpen, isMobile, boardOpen, onSheetChange]);
  // Composer: una riga, cresce fino a ~4 righe, poi scroll interno.
  useEffect(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = 'auto';
    const maxHeight = 4 * 24 + 26;
    el.style.height = `${Math.min(el.scrollHeight, maxHeight)}px`;
    el.style.overflowY = el.scrollHeight > maxHeight ? 'auto' : 'hidden';
  }, [input]);
  // P1.5 — Un nuovo intervento si allinea all'INIZIO, non al fondo: lo speaker e
  // il primo paragrafo restano visibili. Nessuno scroll ad ogni token.
  useEffect(() => {
    const previous = previousCountRef.current;
    previousCountRef.current = room.messages.length;
    if (room.messages.length <= previous) return;
    const newest = room.messages[room.messages.length - 1];
    if (!newest) return;
    if (!followRef.current) { setUnread(true); return; }
    const target = threadRef.current?.querySelector(`[data-message-id="${newest.id}"]`);
    target?.scrollIntoView({ block: 'start', behavior: prefersReducedMotion() ? 'auto' : 'smooth' });
  }, [room.messages]);
  // Lo streaming allinea UNA volta l'inizio dell'intervento, non ad ogni token.
  useEffect(() => {
    if (!speaking || !followRef.current) return;
    const target = threadRef.current?.querySelector('.council-room-stream');
    target?.scrollIntoView({ block: 'start', behavior: prefersReducedMotion() ? 'auto' : 'smooth' });
  }, [speaking]);
  useEffect(() => {
    if (!failure) return;
    const target = threadRef.current?.querySelector('.council-room-failure');
    target?.scrollIntoView({ block: 'start', behavior: prefersReducedMotion() ? 'auto' : 'smooth' });
  }, [failure]);
  const proposalCount = activeProposal(room.sharedBoard)?.measures.filter(measure => measure.status !== 'rejected').length ?? 0;
  const openCount = councilOpenQuestions(room).length + room.invitations.length;
  const convenable = CABINET_SEATS.filter(seat => !room.participants.includes(seat));
  const replies = room.messages.filter(message => message.kind === 'speech' && message.role === 'assistant');
  const lastReply = replies[replies.length - 1];
  const closeBoard = (): void => { setBoardOpen(false); boardButtonRef.current?.focus(); };

  return (
    <div className="council-room" data-board-open={boardOpen} data-room-id={room.id}>
      <header className="council-room-head">
        <button type="button" className="council-room-back" onClick={onBack}>← Governo</button>
        <div className="council-room-heading">
          <h2 id="government-office-title">Seduta del Consiglio</h2>
          <p className="council-room-topic">{room.topic || 'Quale questione portiamo al Consiglio?'}</p>
          <p className="council-room-rapporteur">Relatore: {seatSpeaker(room.initiatorMinister)}</p>
        </div>
        <div className="council-room-context"><span>{nationalName}</span>{currentDate && <span>{currentDate}</span>}</div>
        <button type="button" className="council-room-close" onClick={onClose} aria-label="Chiudi il Governo">✕</button>
      </header>
      <nav className="council-room-participants" aria-label="Partecipanti alla seduta">
        {room.participants.map(seat => <span key={seat} className="council-room-chip" data-seat={seat} data-initiator={seat === room.initiatorMinister}>
          <span className="council-room-presence" aria-hidden="true" />{seatSpeaker(seat).replace(/^Ministro (?:del |della |degli |dell’|dell'|dei )/, '')}
        </span>)}
        {convenable.length > 0 && <button type="button" className="council-room-convene" disabled={busy} onClick={() => setConveneOpen(true)}>+ Convoca</button>}
      </nav>
      {/* P0.4 — I ministri suggeriti dalla situazione sono VISIBILI subito, ma il
          Presidente decide se convocarli: non entrano da soli. */}
      {room.sourceSituation && room.sourceSituation.suggestedMinisters.filter(seat => !room.participants.includes(seat as CabinetSeat)).length > 0 && (
        <div className="council-room-suggested" aria-label="Ministri da sentire">
          <span className="council-room-suggested-label">Ministri da sentire</span>
          {room.sourceSituation.suggestedMinisters.filter(seat => !room.participants.includes(seat as CabinetSeat)).map(seat => (
            <button type="button" key={seat} className="council-room-suggested-seat" disabled={busy} onClick={() => onConvene(seat as CabinetSeat)}>
              {seatSpeaker(seat as CabinetSeat)} +
            </button>
          ))}
        </div>
      )}
      <div className="council-room-workspace">
        <section className="council-room-dialogue" aria-label="Conversazione del Consiglio">
          <div className="council-room-thread" ref={threadRef} onScroll={() => {
            const thread = threadRef.current;
            if (!thread) return;
            followRef.current = isNearBottom({ scrollTop: thread.scrollTop, scrollHeight: thread.scrollHeight, clientHeight: thread.clientHeight });
            if (followRef.current) setUnread(false);
          }}>
            {room.messages.map(message => message.kind === 'event' ? (
              <p key={message.id} className="council-room-event">{message.content}</p>
            ) : (
              <article key={message.id} data-message-id={message.id} className={`council-room-message ${message.role}${message.kind === 'error' ? ' error' : ''}`} data-seat={message.seat}>
                <p className="council-room-speaker">{message.role === 'user' ? 'Presidente' : message.seat ? seatSpeaker(message.seat) : 'Consiglio'}</p>
                <div className="council-room-prose"><RichText text={message.content} /></div>
                {message.seat && inlineEvidenceCards({ directives: message.evidence ?? [], messageId: message.id, index: evidenceIndex[message.seat] ?? {} }).map(card => <button type="button" key={card.key} className="council-room-evidence-link" onClick={() => { setBoardOpen(true); onFocusEvidence(message.seat!, card); }}>Apri {card.title} sulla Tavola ↗</button>)}
                {room.invitations.filter(invitation => invitation.id.startsWith(`${message.id}:`)).map(invitation => (
                  <div key={invitation.id} className="council-room-invitation">
                    <span>{seatSpeaker(invitation.from)} suggerisce di convocare {seatSpeaker(invitation.minister)}</span>
                    <p>{invitation.question}</p>
                    <button type="button" disabled={busy} onClick={() => onConvene(invitation.minister)}>Convoca {seatSpeaker(invitation.minister)}</button>
                  </div>
                ))}
              </article>
            ))}
            {failure && (
              <article className="council-room-message council-room-failure" role="alert" data-seat={failure.seat}>
                <p className="council-room-speaker">Consiglio</p>
                <p className="council-room-failure-text">Il {seatSpeaker(failure.seat)} non riesce a intervenire in questo momento.</p>
                <button type="button" className="council-room-retry" disabled={busy} onClick={onRetry}>Riprova {shortSeat(seatSpeaker(failure.seat))}</button>
              </article>
            )}
            {busy && speaking && <article className="council-room-message assistant council-room-stream" data-seat={speaking}>
              <p className="council-room-speaker">{seatSpeaker(speaking)}</p>
              <div className="council-room-prose">{streamText ? <RichText text={councilText(streamText)} /> : <span className="advisor-typing" role="status" aria-label="Il ministro sta preparando il suo intervento"><i /><i /><i /></span>}</div>
            </article>}
            {error && <p className="council-room-error" role="alert">{error}</p>}
            {notice && <p className="council-room-notice" role="status">{notice}</p>}
          </div>
          <p className="sr-only" role="status" aria-live="polite">{!busy ? lastReply?.content.slice(0, 600) : ''}</p>
          {unread && <button type="button" className="council-room-unread" onClick={() => {
            const thread = threadRef.current;
            if (thread) thread.scrollTop = thread.scrollHeight;
            followRef.current = true;
            setUnread(false);
          }}>↓ Nuovo messaggio</button>}
          <form className="council-room-compose" onSubmit={event => { event.preventDefault(); onSend(); }}>
            <div className="council-room-compose-meta"><label htmlFor="council-recipient">Presidente →</label>
              <select id="council-recipient" value={target} onChange={event => onTarget(event.target.value as CabinetSeat | 'council')} disabled={busy}>
                <option value="council">Consiglio</option>
                {room.participants.map(seat => <option key={seat} value={seat}>{seatSpeaker(seat)}</option>)}
              </select>
              {room.phase === 'drafting' && <span>Redazione comune</span>}
            </div>
            <div className="council-room-compose-row">
              <textarea ref={textareaRef} rows={1} aria-label="Messaggio del Presidente" placeholder="Scrivi al Consiglio…" value={input} disabled={busy} onChange={event => onInput(event.target.value)} onKeyDown={event => {
                if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) { event.preventDefault(); onSend(); }
              }} />
              {busy ? <button type="button" onClick={onInterrupt}>Interrompi</button> : <button type="submit" disabled={!input.trim()}>Invia</button>}
            </div>
          </form>
        </section>
        {boardOpen && !isMobile && <aside className="council-room-drawer" id="council-board" aria-label="Tavola del Consiglio">
          <button type="button" className="council-room-drawer-close" onClick={closeBoard} aria-label="Chiudi la Tavola">✕</button>{board}
        </aside>}
      </div>
      <footer className="council-room-toolbar">
        <span className="council-room-summary">{draftPrepared ? 'Atto in preparazione' : 'Discussione in corso'} · {proposalCount} {proposalCount === 1 ? 'misura' : 'misure'}{openCount > 0 ? ` · ${openCount} ${openCount === 1 ? 'punto aperto' : 'punti aperti'}` : ''}</span>
        <button type="button" className="council-room-board-toggle" ref={boardButtonRef} aria-expanded={boardOpen} aria-controls={boardOpen ? (isMobile ? 'council-board-sheet-title' : 'council-board') : undefined} onClick={() => setBoardOpen(value => !value)}>Tavola {boardOpen ? '↓' : '↑'}</button>
        <button type="button" className="council-room-conclude" disabled={busy} onClick={onConclude}>Chiudi seduta</button>
      </footer>
      {isMobile && boardOpen && <GovernmentBottomSheet open title="Tavola del Consiglio" labelledBy="council-board-sheet-title" onClose={closeBoard}
        leadingAction={<button type="button" className="council-room-sheet-exit council-room-sheet-back" aria-label="Torna al Consiglio" onClick={closeBoard}>← Consiglio</button>}
        trailingAction={<button type="button" className="council-room-sheet-exit council-room-sheet-close" aria-label="Chiudi Governo" onClick={onClose}>✕ Governo</button>}>{board}</GovernmentBottomSheet>}
      {conveneOpen && <GovernmentBottomSheet open title="Convoca un ministro" labelledBy="council-convene-title" onClose={() => setConveneOpen(false)}>
        <p className="council-room-convene-note">Il ministro entra in questa seduta e riceve tutta la discussione recente.</p>
        <ul className="gov-sheet-list">{convenable.map(seat => <li key={seat}><button type="button" className="gov-sheet-item" disabled={busy} onClick={() => { setConveneOpen(false); onConvene(seat); }}><span>{seatSpeaker(seat)}</span><span aria-hidden="true">+</span></button></li>)}</ul>
      </GovernmentBottomSheet>}
    </div>
  );
}
