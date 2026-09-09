/**
 * World Story — Advisor Chat Component
 * ==================================
 * Fase 3: Consulente live — chat multi-turno con streaming della risposta.
 * La cronaca è salvata in chatStore e inviata a ogni richiesta.
* Le sintesi proattive (SSE advisor_proactive) compaiono nella stessa chat
 * con badge «Sintesi».
 */

import React, { useEffect, useRef, useState } from 'react';
import { advisorApi, type AdvisorHistoryItem } from '../../services/api';
import { useSimulationStore } from '../../stores/simulationRuntime';
import { useChatStore } from '../../stores';

interface AdvisorChatProps {
  gameId: string;
}

/** Quanti ultimi messaggi del dialogo inviamo come contesto */
const HISTORY_LIMIT = 20;

export const AdvisorChat: React.FC<AdvisorChatProps> = ({ gameId }) => {
  const {
    advisorMessages, advisorStreaming,
    addAdvisorMessage, appendToLastAdvisorMessage, setAdvisorStreaming,
  } = useChatStore();

  const [inputText, setInputText] = useState('');
  const messagesEndRef = useRef<HTMLDivElement>(null);

  // Partita locale senza backend — consulente non disponibile
  const isLocal = gameId.startsWith('local_');

  // Scroll del flusso in basso con nuovi messaggi e token dello stream
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [advisorMessages]);

  // Invia la domanda al consulente con streaming della risposta
  const handleSend = async () => {
    const text = inputText.trim();
    if (!text || advisorStreaming || isLocal) return;
    setInputText('');

    // Cronaca: senza sintesi proattive e messaggi vuoti (in streaming)
    const history: AdvisorHistoryItem[] = advisorMessages
      .filter(m => !m.proactive && m.content.trim())
      .slice(-HISTORY_LIMIT)
      .map(m => ({ role: m.role, content: m.content }));

    addAdvisorMessage({ role: 'user', content: text });
    addAdvisorMessage({ role: 'assistant', content: '' });
    setAdvisorStreaming(true);
    // F06 passo 3: game switch e restore invalidano la richiesta in volo —
    // i token di una risposta vecchia non toccano la chat del ramo nuovo.
    const commandGeneration = useSimulationStore.getState().commandGeneration;
    const isCommandStale = () => useSimulationStore.getState().commandGeneration !== commandGeneration;

    try {
      await advisorApi.askStream(gameId, text, history, (token) => {
        if (isCommandStale()) return;
        appendToLastAdvisorMessage(token);
      });
      if (isCommandStale()) return;
    } catch (e) {
      console.error('[AdvisorChat] Errore richiesta al consigliere:', e);
      appendToLastAdvisorMessage('Il consulente non è raggiungibile ora. Riprova più tardi.');
    } finally {
      setAdvisorStreaming(false);
    }
  };

  if (isLocal) {
    return (
      <div className="advisor-chat">
        <div className="chats-empty">Il consigliere è disponibile solo nella partita server</div>
      </div>
    );
  }

  return (
    <div className="advisor-chat">
      {/* Intestazione «documento»: il consiglio riservato del leader */}
      <div className="advisor-banner">
        <div className="advisor-banner-text">
          <div className="advisor-banner-title">Il Consulente</div>
          <div className="advisor-banner-sub">Consiglio riservato · risposte in stesura</div>
        </div>
      </div>

      <div className="advisor-messages">
        {advisorMessages.length === 0 ? (
          <div className="chats-empty">
            Chiedi al consigliere della situazione mondiale, della strategia o
            delle conseguenze delle decisioni. Il dialogo resta riservato
            al tuo governo.
          </div>
        ) : (
          advisorMessages.map((m, i) => {
            const isLast = i === advisorMessages.length - 1;
            const isStreamingThis = isLast && advisorStreaming && m.role === 'assistant';
            const isEmptyStreaming = isStreamingThis && !m.content;
            return (
              <div key={i} className={`advisor-entry ${m.role}`}>
                <div className="entry-meta">
                  {m.role === 'user' ? (
                    <span>Governo</span>
                  ) : m.proactive ? (
                    <span className="proactive-badge">Bollettino</span>
                  ) : (
                    <span>Consulente</span>
                  )}
                </div>
                <div className="entry-text">
                  {isEmptyStreaming ? (
                    <span className="advisor-typing"><i></i><i></i><i></i></span>
                  ) : (
                    <>
                      {m.content}
                      {isStreamingThis && <span className="stream-cursor">▌</span>}
                    </>
                  )}
                </div>
              </div>
            );
          })
        )}
        <div ref={messagesEndRef} />
      </div>

      <div className="chat-input-row">
        <textarea
          value={inputText}
          onChange={(e) => setInputText(e.target.value)}
          placeholder="Interroga il consulente…"
          rows={2}
          disabled={advisorStreaming}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault();
              handleSend();
            }
          }}
        />
        <button
          className="btn-chat-send"
          onClick={handleSend}
          disabled={!inputText.trim() || advisorStreaming}
          title="Invia"
        >
          {advisorStreaming ? '…' : 'Invia'}
        </button>
      </div>
    </div>
  );
};

export default AdvisorChat;
