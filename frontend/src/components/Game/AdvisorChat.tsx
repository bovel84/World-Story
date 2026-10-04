/** The shared presidential conversation. Facts come from dedicated server context,
 * never from forged user messages. Only complete validated replies are published. */
import { useEffect, useRef, useState } from 'react';
import { advisorApi, type CouncilIssue, type RealityAdvisorResponse } from '../../services/api';
import { useSimulationStore } from '../../stores/simulationRuntime';
import { useChatStore } from '../../stores';
import { RichText } from './RichText';
import { CouncilIssueInline } from './CouncilIssueInline';
import type { ChartDataInput } from './advisorCharts';

interface AdvisorChatProps {
  gameId: string;
  chartData?: ChartDataInput | null;
  scopeKey?: string;
  onOpenIssue?: (issue: CouncilIssue) => void;
}

export function AdvisorChat({ gameId, chartData, scopeKey = gameId, onOpenIssue }: AdvisorChatProps) {
  const { advisorMessages, advisorStreaming, addAdvisorMessage, setAdvisorStreaming } = useChatStore();
  const [input, setInput] = useState('');
  const [context, setContext] = useState<RealityAdvisorResponse | null>(null);
  const [focus, setFocus] = useState<CouncilIssue | undefined>();
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const requestRef = useRef<AbortController | null>(null);
  const scopeRef = useRef(scopeKey);
  scopeRef.current = scopeKey;
  const isLocal = gameId.startsWith('local_');

  useEffect(() => {
    setContext(null); setFocus(undefined); setError('');
    if (isLocal) return;
    const controller = new AbortController();
    setLoading(true);
    advisorApi.context(gameId, controller.signal).then(result => {
      if (!controller.signal.aborted) setContext(result);
    }).catch(() => {
      if (!controller.signal.aborted) setError('Il quadro verificato non è disponibile. Puoi riprovare aprendo il Governo.');
    }).finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => {
      controller.abort();
      if (requestRef.current) {
        requestRef.current.abort(); requestRef.current = null;
        useChatStore.getState().setAdvisorStreaming(false);
      }
    };
  }, [gameId, scopeKey, isLocal]);

  const send = async () => {
    const text = input.trim();
    if (!text || advisorStreaming || isLocal || requestRef.current) return;
    const controller = new AbortController();
    requestRef.current = controller;
    const scope = scopeKey;
    const generation = useSimulationStore.getState().commandGeneration;
    const owns = () => requestRef.current === controller && !controller.signal.aborted && scopeRef.current === scope
      && useSimulationStore.getState().commandGeneration === generation;
    const history = advisorMessages.filter(message => !message.proactive && message.content.trim()).slice(-20)
      .map(message => ({ role: message.role, content: message.content }));
    addAdvisorMessage({ role: 'user', content: text });
    setInput(''); setError(''); setAdvisorStreaming(true);
    try {
      const result = await advisorApi.reality(gameId, text, history, focus, controller.signal);
      if (!owns()) return;
      addAdvisorMessage({ role: 'assistant', content: result.reply, issues: result.issues });
      setContext(previous => previous ? { ...previous, advisorContext: result.advisorContext } : result);
    } catch {
      if (owns()) setError('Il Consulente non è raggiungibile. La domanda è conservata; riprova esplicitamente.');
    } finally {
      if (requestRef.current === controller) { requestRef.current = null; setAdvisorStreaming(false); }
    }
  };
  const callout = (issue: CouncilIssue) => <div key={issue.id}>
    <button type="button" className="advisor-deepen" disabled={advisorStreaming} onClick={() => setFocus(issue)}>Approfondisci {issue.title}</button>
    <CouncilIssueInline issue={issue} onOpenIssue={onOpenIssue} disabled={advisorStreaming} />
  </div>;

  if (isLocal) return <div className="advisor-chat"><p>Il Consulente è disponibile solo nella partita server.</p></div>;
  return <div className="advisor-chat">
    {focus && <p className="advisor-focus" role="status">In esame: <strong>{focus.title}</strong> <button type="button" onClick={() => setFocus(undefined)}>Termina esame</button></p>}
    <div className="advisor-messages">
      {loading && <p role="status">Lettura del quadro verificato…</p>}
      {context && <article className="advisor-entry assistant advisor-opening">
        <div className="entry-meta">Consulente · {context.advisorContext.verifiedWorldSnapshot.date}</div>
        <div className="entry-text"><RichText text={context.reply} chartData={chartData} /></div>
        {context.issues.map(callout)}
      </article>}
      {advisorMessages.map((message, index) => <article key={index} className={`advisor-entry ${message.role}`}>
        <div className="entry-meta">{message.role === 'user' ? 'Presidente' : message.proactive ? 'Bollettino' : 'Consulente'}</div>
        <div className="entry-text">{message.role === 'assistant' ? <RichText text={message.content} chartData={chartData} /> : message.content}</div>
        {message.issues?.map(callout)}
      </article>)}
      {advisorStreaming && <p className="advisor-typing" role="status" aria-label="Il Consulente sta preparando la risposta"><i /><i /><i /></p>}
      {error && <p role="alert">{error}</p>}
    </div>
    <div className="chat-input-row">
      <textarea value={input} onChange={event => setInput(event.target.value)} placeholder="Interroga il consulente…" rows={2}
        disabled={advisorStreaming} onKeyDown={event => { if (event.key === 'Enter' && !event.shiftKey) { event.preventDefault(); void send(); } }} />
      <button type="button" className="btn-chat-send" onClick={() => void send()} disabled={!input.trim() || advisorStreaming}>Invia</button>
    </div>
  </div>;
}
export default AdvisorChat;
