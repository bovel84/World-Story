/** The shared presidential conversation. Facts come from dedicated server context,
 * never from forged user messages. Only complete validated replies are published. */
import { useEffect, useMemo, useRef, useState } from 'react';
import { advisorApi, type AdvisorSituation, type CouncilIssue } from '../../services/api';
import { useSimulationStore } from '../../stores/simulationRuntime';
import { useChatStore } from '../../stores';
import { RichText } from './RichText';
import { CouncilIssueInline } from './CouncilIssueInline';
import { AdvisorSituationsPanel, buildSituationFocusMessage, buildSituationFocusPayload } from './AdvisorSituationsPanel';
import { archivedTurns, currentTurnMessages } from './advisorTurns';
import { advisorBucketKey, advisorOpeningKey, loadAdvisorArchive, loadAdvisorMessages, loadAdvisorOpening, saveAdvisorMessages, saveAdvisorOpening, type AdvisorOpening } from './advisorMemory';
import { fetchAdvisorOpening } from './advisorOpening';
import type { ChartDataInput } from './advisorCharts';
import { GovernmentMessageVisuals } from './GovernmentMessageVisuals';
import type { GovernmentVisualSnapshot, MapFocusVisual } from './governmentVisual';

interface AdvisorChatProps {
  gameId: string;
  chartData?: ChartDataInput | null;
  scopeKey?: string;
  onOpenIssue?: (issue: CouncilIssue) => void;
  visualSnapshot?: GovernmentVisualSnapshot;
  onFocusMap?: (card: MapFocusVisual) => void;
  /** WS-GOV-TURN-AWARENESS — Il turno corrente: la chat attiva è solo questo. */
  currentTurn?: number;
}

/** WS-GOV-ADVISOR-STATUS — Lo stato del Consulente è anche testo visibile, non solo aria-label. */
export const ADVISOR_LOADING_TEXT = 'Il Consulente sta preparando la prima valutazione…';
export const ADVISOR_THINKING_TEXT = 'Il Consulente sta pensando…';

/** Una sola card per questione: la situazione prevale sulla issue collegata.
 * Le issue integre restano disponibili per l'apertura, anche tra messaggi. */
export function AdvisorQuestionCards({ situations, issues, allSituations = situations, allIssues = issues, onDeepen, onDeepenIssue, onOpenIssue, activeId, disabled = false }: {
  situations: AdvisorSituation[];
  issues: CouncilIssue[];
  allSituations?: AdvisorSituation[];
  allIssues?: CouncilIssue[];
  onDeepen: (situation: AdvisorSituation) => void;
  onDeepenIssue?: (issue: CouncilIssue) => void;
  onOpenIssue?: (issue: CouncilIssue) => void;
  activeId?: string;
  disabled?: boolean;
}) {
  const shownIds = new Set(allSituations.map(situation => situation.id));
  const standalone = issues.filter(issue => !issue.situationId || !shownIds.has(issue.situationId));
  return <>
    <AdvisorSituationsPanel situations={situations} issues={allIssues} onDeepen={onDeepen} onOpenIssue={onOpenIssue} activeId={activeId} disabled={disabled} />
    {standalone.length > 0 && <div className="advisor-proposals">
      <p className="advisor-proposals-label">Questioni da discutere</p>
      {standalone.map(issue => <CouncilIssueInline key={issue.id} issue={issue} compact onDeepen={onDeepenIssue} onOpenIssue={onOpenIssue} disabled={disabled} />)}
    </div>}
  </>;
}

export function AdvisorChat({ gameId, chartData, scopeKey = gameId, onOpenIssue, currentTurn = 0, visualSnapshot, onFocusMap }: AdvisorChatProps) {
  const { advisorMessages, advisorStreaming, addAdvisorMessage, setAdvisorStreaming, tagAdvisorTurns, setAdvisorMessages } = useChatStore();
  const branchId = useSimulationStore(state => state.state?.branchId ?? null);
  const [input, setInput] = useState('');
  const [opening, setOpening] = useState<AdvisorOpening | null>(null);
  // Hide attachments until messages belong to this game/branch/turn bucket.
  const [visualBucket, setVisualBucket] = useState<string | null>(null);
  const [focus, setFocus] = useState<CouncilIssue | undefined>();
  const [situationFocus, setSituationFocus] = useState<AdvisorSituation | undefined>();
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const requestRef = useRef<AbortController | null>(null);
  const scopeRef = useRef(scopeKey);
  scopeRef.current = scopeKey;
  const isLocal = gameId.startsWith('local_');
  // La chat attiva e la history sono SOLO del turno corrente; i messaggi legacy
  // senza turno vengono marcati una volta e poi restano archiviati.
  const activeMessages = useMemo(() => currentTurnMessages(advisorMessages, currentTurn), [advisorMessages, currentTurn]);
  const previousTurns = archivedTurns(advisorMessages, currentTurn);
  useEffect(() => { tagAdvisorTurns(currentTurn); }, [currentTurn, tagAdvisorTurns]);
  // Persistenza per turno: la conversazione sopravvive al reload senza mescolare
  // i turni (un bucket per `gameId`+`scopeKey`, che contiene ramo e turno).
  const bucket = advisorBucketKey(gameId, branchId, scopeKey);
  useEffect(() => {
    if (isLocal) { setAdvisorMessages([]); return; }
    // Archiviо dello STESSO ramo (turni precedenti) + turno corrente: la chat
    // attiva è sostituita, mai mergiata con lo scope precedente.
    const archived = loadAdvisorArchive(gameId, branchId, currentTurn);
    setAdvisorMessages([...archived, ...loadAdvisorMessages(bucket)]);
    setVisualBucket(bucket);
  }, [bucket, branchId, gameId, currentTurn, isLocal, setAdvisorMessages]);
  useEffect(() => {
    if (isLocal) return;
    saveAdvisorMessages(bucket, activeMessages);
  }, [bucket, isLocal, activeMessages]);

  useEffect(() => {
    setOpening(null); setFocus(undefined); setSituationFocus(undefined); setError('');
    if (isLocal) return;
    // WS-GOV-ADVISOR-HISTORICAL-BASELINE — La prima apertura è una generazione
    // LLM (storia del paese + presente + direzioni). Se è già stata prodotta per
    // questo bucket si riusa: nessuna nuova chiamata al provider.
    const cached = loadAdvisorOpening(advisorOpeningKey(gameId, branchId, scopeKey));
    if (cached) { setOpening(cached); return; }
    const controller = new AbortController();
    setLoading(true);
    // Primary LLM opening, deterministic verified context as non-blocking fallback.
    fetchAdvisorOpening(gameId, controller.signal).then(next => {
      if (controller.signal.aborted) return;
      setOpening(next);
      saveAdvisorOpening(advisorOpeningKey(gameId, branchId, scopeKey), next);
    }).catch(() => {
      if (!controller.signal.aborted) setError('Il Consulente non è raggiungibile. Puoi riprovare aprendo il Governo.');
    }).finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => {
      controller.abort();
      if (requestRef.current) {
        requestRef.current.abort(); requestRef.current = null;
        useChatStore.getState().setAdvisorStreaming(false);
      }
    };
  }, [gameId, branchId, scopeKey, isLocal]);

  const sendText = async (raw?: string, explicitSituation?: AdvisorSituation, explicitIssue?: CouncilIssue) => {
    const text = (raw ?? input).trim();
    if (!text || advisorStreaming || isLocal || requestRef.current) return;
    const controller = new AbortController();
    requestRef.current = controller;
    const scope = scopeKey;
    const generation = useSimulationStore.getState().commandGeneration;
    const owns = () => requestRef.current === controller && !controller.signal.aborted && scopeRef.current === scope
      && useSimulationStore.getState().commandGeneration === generation;
    const history = currentTurnMessages(advisorMessages, currentTurn)
      .filter(message => !message.proactive && message.content.trim()).slice(-20)
      .map(message => ({ role: message.role, content: message.content }));
    // WS-CONSULENTE-SITUAZIONI — Focus canonico: al server vanno TUTTI i
    // riferimenti (signalKeys + evidenceKeys), mai titolo o sintesi.
    const activeSituation = explicitIssue ? undefined : explicitSituation ?? situationFocus;
    const focusPayload = activeSituation ? buildSituationFocusPayload(activeSituation) : undefined;
    addAdvisorMessage({ role: 'user', content: text, turn: currentTurn });
    if (raw === undefined) setInput('');
    setError(''); setAdvisorStreaming(true);
    try {
      const result = await advisorApi.reality(gameId, text, history, explicitSituation ? undefined : explicitIssue ?? focus, controller.signal, focusPayload);
      if (!owns()) return;
      if (result.advisorContext.mode === 'briefing') {
        // Replace the current agenda, not the conversation or previous turns.
        setAdvisorMessages(useChatStore.getState().advisorMessages.map(message =>
          message.turn === currentTurn ? { ...message, situations: [], issues: [] } : message));
        if (opening) {
          const cleared = { ...opening, situations: [], issues: [] };
          setOpening(cleared);
          saveAdvisorOpening(advisorOpeningKey(gameId, branchId, scopeKey), cleared);
        }
        setSituationFocus(undefined); setFocus(undefined);
      }
      addAdvisorMessage({ role: 'assistant', content: result.reply, issues: result.issues, situations: result.situations ?? [], turn: currentTurn });
    } catch {
      if (owns()) setError('Il Consulente non è raggiungibile. La domanda è conservata; riprova esplicitamente.');
    } finally {
      if (requestRef.current === controller) { requestRef.current = null; setAdvisorStreaming(false); }
    }
  };
  /** WS-CONSULENTE-SITUAZIONI — «Approfondisci» porta la situazione al Consulente, mai al Consiglio. */
  const deepen = (situation: AdvisorSituation) => {
    setFocus(undefined); setSituationFocus(situation);
    void sendText(buildSituationFocusMessage(situation), situation);
  };
  const deepenIssue = (issue: CouncilIssue) => {
    setSituationFocus(undefined); setFocus(issue);
    void sendText(`Approfondiamo la questione «${issue.title}».`, undefined, issue);
  };
  const closeFocus = () => { setSituationFocus(undefined); setFocus(undefined); };
  const allSituations = [...(opening?.situations ?? []), ...activeMessages.flatMap(message => message.situations ?? [])];
  const allIssues = [...(opening?.issues ?? []), ...activeMessages.flatMap(message => message.issues ?? [])];
  const activeFocus = situationFocus?.title ?? focus?.title;
  const activeFocusKind = situationFocus ? 'Situazione in esame' : 'Tema in esame';

  if (isLocal) return <div className="advisor-chat"><p>Il Consulente è disponibile solo nella partita server.</p></div>;
  return <div className="advisor-chat">
    {activeFocus && <div className="advisor-focus advisor-focus-situation" role="status">
      <span className="advisor-focus-kind">{activeFocusKind}</span>
      <span className="advisor-focus-title">{activeFocus}</span>
      <button type="button" className="advisor-focus-close" aria-label="Chiudi il focus" onClick={closeFocus}>✕</button>
    </div>}
    <div className="advisor-messages">
      {loading && <p className="advisor-loading" role="status">{ADVISOR_LOADING_TEXT}</p>}
      {opening && <article className="advisor-entry assistant advisor-opening">
        <div className="entry-meta">Consulente · {opening.date}</div>
        <div className="entry-text"><RichText text={opening.reply} chartData={chartData} /></div>
        <GovernmentMessageVisuals message={{ role: 'assistant', situations: opening.situations, issues: opening.issues }} snapshot={visualBucket === bucket ? visualSnapshot : undefined} onFocusMap={onFocusMap} />
        <AdvisorQuestionCards situations={opening.situations ?? []} issues={opening.issues ?? []} allSituations={allSituations} allIssues={allIssues}
          onDeepen={deepen} onDeepenIssue={deepenIssue} onOpenIssue={onOpenIssue} activeId={situationFocus?.id} disabled={advisorStreaming || loading} />
      </article>}
      {activeMessages.map((message, index) => <article key={index} className={`advisor-entry ${message.role}`}>
        <div className="entry-meta">{message.role === 'user' ? 'Presidente' : message.proactive ? 'Bollettino' : 'Consulente'}</div>
        <div className="entry-text">{message.role === 'assistant' ? <RichText text={message.content} chartData={chartData} /> : message.content}</div>
        <GovernmentMessageVisuals message={message} snapshot={visualBucket === bucket ? visualSnapshot : undefined} onFocusMap={onFocusMap} />
        <AdvisorQuestionCards situations={message.situations ?? []} issues={message.issues ?? []} allSituations={allSituations} allIssues={allIssues}
          onDeepen={deepen} onDeepenIssue={deepenIssue} onOpenIssue={onOpenIssue} activeId={situationFocus?.id} disabled={advisorStreaming} />
      </article>)}
      {advisorStreaming && <p className="advisor-typing" role="status" aria-label={ADVISOR_THINKING_TEXT}>
        <span className="advisor-thinking-text">{ADVISOR_THINKING_TEXT}</span><i /><i /><i />
      </p>}
      {error && <p role="alert">{error}</p>}
      {previousTurns.length > 0 && <details className="advisor-archive">
        <summary>Discussioni precedenti</summary>
        {previousTurns.map(group => <section key={group.turn} data-turn={group.turn}>
          <h4>Turno {group.turn}</h4>
          {group.messages.map((message, index) => <article key={index} className={`advisor-entry ${message.role}`}>
            <div className="entry-meta">{message.role === 'user' ? 'Presidente' : 'Consulente'}</div>
            <div className="entry-text">{message.role === 'assistant' ? <RichText text={message.content} chartData={chartData} /> : message.content}</div>
          </article>)}
        </section>)}
      </details>}
    </div>
    <div className="chat-input-row">
      <textarea value={input} onChange={event => setInput(event.target.value)} placeholder="Interroga il consulente…" rows={2}
        disabled={advisorStreaming} onKeyDown={event => { if (event.key === 'Enter' && !event.shiftKey) { event.preventDefault(); void sendText(); } }} />
      <button type="button" className="btn-chat-send" onClick={() => void sendText()} disabled={!input.trim() || advisorStreaming}>Invia</button>
    </div>
  </div>;
}
export default AdvisorChat;
