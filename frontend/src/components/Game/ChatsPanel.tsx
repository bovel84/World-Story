/**
 * World Story — Chats Panel Component
 * =================================
 * Pannello delle chat diplomatiche (stile Pax Historia).
 * Elenco chat (cerchio colorato, ultimo messaggio, badge unread), thread dei
 * messaggi con nome del mittente e turno, «Nuova chat» = scelta di UNA o PIÙ
 * nazioni (chat di gruppo), «Lascia che parlino» = le nazioni proseguono
 * tra loro.
 */

import React, { useEffect, useMemo, useRef, useState } from 'react';
import { chatsApi } from '../../services/api';
import { useChatStore } from '../../stores';
import { useSimulationStore } from '../../stores/simulationRuntime';
import type { Region } from '../../types';

interface ChatsPanelProps {
  gameId: string;
  regions: Region[];
  /** polityId del giocatore — lo escludiamo dall'elenco degli interlocutori */
  playerPolityId: string;
}

/** Politia interlocutrice, dedotta dalle regioni (owner = polityId) */
interface PolityOption {
  id: string;
  name: string;
  color: string;
}

function formatGameDate(value?: string): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(value || '');
  if (!match) return '';
  const months = ['gen', 'feb', 'mar', 'apr', 'mag', 'giu', 'lug', 'ago', 'set', 'ott', 'nov', 'dic'];
  // Leggiamo la data di simulazione come calendario, mai come timestamp locale:
  // così una chat non mostra date di sistema o scostamenti di fuso orario.
  return `${Number(match[3])} ${months[Number(match[2]) - 1]} ${match[1]}`;
}

const ISO3_TO_ISO2: Record<string, string> = {
  USA: 'us', RUS: 'ru', CHN: 'cn', GBR: 'gb', FRA: 'fr', DEU: 'de', ITA: 'it',
  ESP: 'es', PRT: 'pt', JPN: 'jp', IND: 'in', BRA: 'br', CAN: 'ca', MEX: 'mx',
  ARG: 'ar', AUS: 'au', KOR: 'kr', PRK: 'kp', TUR: 'tr', IRN: 'ir', IRQ: 'iq',
  SAU: 'sa', ISR: 'il', PSE: 'ps', JOR: 'jo', LBN: 'lb', EGY: 'eg', UKR: 'ua',
  POL: 'pl', SWE: 'se', NOR: 'no', FIN: 'fi', DNK: 'dk', NLD: 'nl', BEL: 'be',
  CHE: 'ch', AUT: 'at', GRC: 'gr', PAK: 'pk', IDN: 'id', VNM: 'vn', THA: 'th',
  ZAF: 'za', NGA: 'ng', ETH: 'et', KEN: 'ke', MAR: 'ma', DZA: 'dz', TUN: 'tn',
};

function flagEmoji(code?: string): string {
  const alpha2 = ISO3_TO_ISO2[(code || '').toUpperCase()] || (code || '').toLowerCase();
  if (!/^[a-z]{2}$/.test(alpha2)) return '🏳️';
  return alpha2.toUpperCase().split('').map(char => String.fromCodePoint(127397 + char.charCodeAt(0))).join('');
}

function reactionForMessage(content?: string): { icon: string; label: string } {
  const text = (content || '').toLocaleLowerCase('it');
  if (/(condann|rifiut|minacc|ostil|inaccett|ritorsion|aggress|violazion|attacc)/.test(text)) return { icon: '😠', label: 'Reazione ostile' };
  if (/(accogli|sostegn|collabor|accord|intesa|ringrazi|favorevol|concord)/.test(text)) return { icon: '🤝', label: 'Reazione favorevole' };
  if (/(preoccup|riserv|valuter|verifich|chiariment|condizion|cautel)/.test(text)) return { icon: '🤔', label: 'Reazione cauta' };
  return { icon: '💬', label: 'Comunicazione diplomatica' };
}

export const ChatsPanel: React.FC<ChatsPanelProps> = ({ gameId, regions, playerPolityId }) => {
  const {
    chats, activeChatId, messagesByChat,
    refreshChats, upsertChat, setActiveChat, setMessages, appendMessage, markRead,
  } = useChatStore();

  const [showNewChat, setShowNewChat] = useState(false);
  const [inputText, setInputText] = useState('');
  const [sending, setSending] = useState(false);
  const [loadingMessages, setLoadingMessages] = useState(false);
  /** Selezione multipla per le chat di gruppo (stile Pax Historia) */
  const [selectedPolityIds, setSelectedPolityIds] = useState<Set<string>>(new Set());
  /** «Lascia che parlino» in corso */
  const [autoRunning, setAutoRunning] = useState(false);
  const [error, setError] = useState('');

  const messagesEndRef = useRef<HTMLDivElement>(null);

  // Partita locale senza backend — chat non disponibili
  const isLocal = gameId.startsWith('local_');

  // Caricamento dell'elenco chat al mount
  useEffect(() => {
    if (!isLocal) {
      refreshChats();
    }
  }, [gameId, isLocal, refreshChats]);

  // Scroll del thread in basso con nuovi messaggi
  const activeMessages = activeChatId ? (messagesByChat[activeChatId] || []) : [];
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [activeMessages.length, activeChatId]);

  // Politie dalle regioni: owner unici, esclusi giocatore e neutri
  const polities = useMemo<PolityOption[]>(() => {
    const byId = new Map<string, PolityOption>();
    for (const r of regions) {
      if (!r.owner || r.owner === 'neutral' || r.owner === playerPolityId) continue;
      if (!byId.has(r.owner)) {
        // In una mappa provinciale `r.name` è il nome della provincia; il
        // backend fornisce polityName per mostrare la nazione corretta.
        byId.set(r.owner, { id: r.owner, name: r.polityName || r.owner, color: r.color });
      }
    }
    return [...byId.values()].sort((a, b) => a.name.localeCompare(b.name, 'ru'));
  }, [regions, playerPolityId]);

  // Apri la chat: carica i messaggi (il backend li segna letti) e azzera unread
  const openChat = async (chatId: string) => {
    setActiveChat(chatId);
    setShowNewChat(false);
    if (isLocal) return;
    setLoadingMessages(true);
    try {
      const data = await chatsApi.messages(gameId, chatId);
      setMessages(chatId, data.messages || []);
      markRead(chatId);
      setError('');
    } catch (e) {
      console.error('[ChatsPanel] Impossibile caricare i messaggi:', e);
      setError(e instanceof Error ? e.message : 'Impossibile caricare i messaggi.');
    } finally {
      setLoadingMessages(false);
    }
  };

  // Crea una nuova chat con una o più nazioni (idempotente sul backend)
  const handleCreateChat = async (names: string[]) => {
    if (names.length === 0) return;
    try {
      setError('');
      const { chat } = await chatsApi.create(gameId, names);
      upsertChat(chat);
      setSelectedPolityIds(new Set());
      setShowNewChat(false);
      await openChat(chat.id);
    } catch (e) {
      console.error('[ChatsPanel] Impossibile creare la chat:', e);
      setError(e instanceof Error ? e.message : 'Impossibile creare la chat.');
    }
  };

  // Clic su una nazione nel picker: singola → crea/apri subito; con la modalità
  // gruppo (deselezionabile) accumula la selezione e confermi col pulsante.
  const togglePolitySelection = (id: string) => {
    setSelectedPolityIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  // «Lascia che parlino»: le nazioni proseguono la trattativa tra loro
  const handleAutoChat = async () => {
    if (!activeChatId || autoRunning || sending) return;
    setAutoRunning(true);
    try {
      const { replies } = await chatsApi.auto(gameId, activeChatId, 2);
      for (const r of replies || []) {
        appendMessage(activeChatId, r);
      }
      await chatsApi.markRead(gameId, activeChatId);
      markRead(activeChatId);
      refreshChats();
    } catch (e) {
      console.error('[ChatsPanel] Impossibile far parlare le nazioni:', e);
      setError(e instanceof Error ? e.message : 'Le nazioni non riescono a proseguire la trattativa.');
    } finally {
      setAutoRunning(false);
    }
  };

  // Invia il messaggio; la risposta della politia arriva in reply
  const handleSend = async () => {
    const text = inputText.trim();
    if (!text || !activeChatId || sending || autoRunning) return;
    setInputText('');
    setSending(true);
    // F06 passo 3: game switch e restore invalidano la risposta in volo.
    const commandGeneration = useSimulationStore.getState().commandGeneration;
    try {
      const { message, reply } = await chatsApi.send(gameId, activeChatId, text);
      if (useSimulationStore.getState().commandGeneration !== commandGeneration) return;
      appendMessage(activeChatId, message);
      if (reply) {
        appendMessage(activeChatId, reply);
      }
      await chatsApi.markRead(gameId, activeChatId);
      markRead(activeChatId);
      setError('');
      // Aggiorna l'«ultimo messaggio» nell'elenco chat
      refreshChats();
    } catch (e) {
      console.error('[ChatsPanel] Impossibile inviare il messaggio:', e);
      setError(e instanceof Error ? e.message : 'Messaggio non inviato. Riprova.');
      setInputText(text); // riporta il testo nel campo di input
    } finally {
      setSending(false);
    }
  };

  if (isLocal) {
    return (
      <div className="chats-panel">
        <div className="chats-empty">Le chat diplomatiche sono disponibili solo nella partita server</div>
      </div>
    );
  }

  const activeChat = chats.find(c => c.id === activeChatId);
  const activeInterlocutors = activeChat?.participants?.filter(p => p.role !== 'player') || [];
  const activeTitle = activeInterlocutors.length > 0
    ? activeInterlocutors.map(p => p.name).join(' · ')
    : activeChat?.polityName || 'Chat';

  const flagForPolity = (polityId?: string, name?: string) => {
    const region = regions.find(r => r.owner === polityId || r.polityName === name || r.name === name);
    return flagEmoji(region?.flag || polityId);
  };
  const messageMeta = (message: { turn?: number; gameDate?: string }) => {
    const parts = [message.turn ? `T${message.turn}` : '', formatGameDate(message.gameDate)].filter(Boolean);
    return parts.join(' · ') || 'Data di simulazione non registrata';
  };

  // Colore del mittente dai partecipanti della chat attiva
  const senderColor = (name: string): string => {
    const p = activeChat?.participants?.find(pp => pp.name === name);
    return p?.color || activeChat?.polityColor || '#888';
  };

  // --- Thread dei messaggi ---
  if (activeChatId) {
    return (
      <div className="chats-panel">
        <div className="chat-thread-header">
          <button className="btn-chat-back" onClick={() => setActiveChat(null)} title="Alle chat">
            ←
          </button>
          <span className="chat-thread-flags" aria-label={`${activeInterlocutors.length} partecipanti`}>
            {(activeInterlocutors.length ? activeInterlocutors : [{ id: activeChat?.polityId, name: activeChat?.polityName }]).slice(0, 4).map((p: any, i) => (
              <span key={p.id || i} className="chat-flag" title={p.name}>{flagForPolity(p.id, p.name)}</span>
            ))}
          </span>
          <span className="chat-thread-title">{activeTitle}</span>
          {activeInterlocutors.length > 1 && <span className="group-chat-badge">Gruppo · {activeInterlocutors.length}</span>}
          <button
            className="btn-chat-auto"
            onClick={handleAutoChat}
            disabled={autoRunning || sending}
            title="Lascia che le nazioni proseguano la trattativa tra loro"
          >
            {autoRunning ? 'In corso' : 'Prosegui dialogo'}
          </button>
        </div>

        <div className="chat-messages">
          {loadingMessages && activeMessages.length === 0 ? (
            <div className="chats-empty">Caricamento messaggi...</div>
          ) : activeMessages.length === 0 ? (
            <div className="chats-empty">Nessun messaggio — inizia le negoziazioni</div>
          ) : (
            activeMessages.map(m => (
              <div key={m.id || `${m.role}-${m.createdAt}`} className={`chat-msg-wrap ${m.role}`}>
                {m.role !== 'player' && m.senderName && (
                  <div className="chat-sender">
                    <span className="chat-flag" title={`Bandiera di ${m.senderName}`}>{flagForPolity(activeInterlocutors.find(p => p.name === m.senderName)?.id, m.senderName)}</span>
                    <span className="chat-sender-dot" style={{ background: senderColor(m.senderName) }} />
                    <span className="chat-sender-name">{m.senderName}</span>
                    <span className="chat-reaction" title={reactionForMessage(m.content).label}>{reactionForMessage(m.content).icon}</span>
                    <span className="chat-message-date">{messageMeta(m)}</span>
                  </div>
                )}
                {m.role === 'player' && (
                  <div className="chat-message-meta player-meta">
                    <span className="chat-flag" title="La tua nazione">{flagForPolity(activeChat?.participants?.find(p => p.role === 'player')?.id)}</span>
                    <span>Tu · {messageMeta(m)}</span>
                  </div>
                )}
                <div
                  className={`chat-bubble ${m.role}`}
                  style={m.role === 'polity' ? { '--nation-color': senderColor(m.senderName || '') } as React.CSSProperties : undefined}
                >
                  {m.content}
                </div>
              </div>
            ))
          )}
          {(sending || autoRunning) && (
            <div className="chat-typing" role="status" aria-live="polite">
              <span className="typing-dot" /><span className="typing-dot" /><span className="typing-dot" />
              <span>{autoRunning ? 'Le nazioni stanno dialogando' : 'La delegazione sta scrivendo'}</span>
            </div>
          )}
          <div ref={messagesEndRef} />
        </div>

        {error && <div className="chat-error" role="alert">{error}</div>}
        <div className="chat-input-row">
          <textarea
            value={inputText}
            onChange={(e) => setInputText(e.target.value)}
            placeholder="Messaggio alla politia..."
            rows={2}
            disabled={sending || autoRunning}
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
            disabled={!inputText.trim() || sending || autoRunning}
            title="Invia"
          >
            {sending ? '…' : 'Invia'}
          </button>
        </div>
      </div>
    );
  }

  // --- Elenco chat ---
  return (
    <div className="chats-panel">
      <button className="btn-new-chat" onClick={() => { setShowNewChat(v => !v); setSelectedPolityIds(new Set()); }}>
        {showNewChat ? '✕ Annulla' : '＋ Nuova chat'}
      </button>

      {showNewChat && (
        <div className="new-chat-picker">
          <div className="picker-hint">
            Seleziona una nazione per una chat diretta, oppure più nazioni per una trattativa di gruppo.
          </div>
          {polities.length === 0 ? (
            <div className="chats-empty">Nessun paese disponibile per le negoziazioni</div>
          ) : (
            polities.map(p => (
              <div
                key={p.id}
                className={`polity-pick-item${selectedPolityIds.has(p.id) ? ' selected' : ''}`}
                onClick={() => togglePolitySelection(p.id)}
              >
                <span className="chat-color-dot" style={{ background: p.color }} />
                <span>{p.name}</span>
                {selectedPolityIds.has(p.id) && <span className="pick-check">✓</span>}
              </div>
            ))
          )}
          {selectedPolityIds.size >= 1 && (
            <button
              className="btn-create-group-chat"
              onClick={() => handleCreateChat(
                polities.filter(p => selectedPolityIds.has(p.id)).map(p => p.name)
              )}
            >
              {selectedPolityIds.size === 1
                ? 'Apri chat diretta →'
                : `Crea trattativa (${selectedPolityIds.size} nazioni) →`}
            </button>
          )}
        </div>
      )}

      {error && <div className="chat-error" role="alert">{error}</div>}
      <div className="chats-list">
        {chats.length === 0 ? (
          <div className="chats-empty">
            Nessuna chat.
            <br />
            Premi «Nuova chat» per aprire un canale diplomatico.
          </div>
        ) : (
          chats.map(c => {
            const interlocutors = c.participants?.filter(p => p.role !== 'player') || [];
            const title = interlocutors.length > 0 ? interlocutors.map(p => p.name).join(' · ') : c.polityName;
            return (
            <div key={c.id} className="chat-item" onClick={() => openChat(c.id)}>
              <span className="chat-list-flags">
                {(interlocutors.length ? interlocutors : [{ id: c.polityId, name: c.polityName }]).slice(0, 3).map((p: any, i) => (
                  <span key={p.id || i} className="chat-flag" title={p.name}>{flagForPolity(p.id, p.name)}</span>
                ))}
              </span>
              <div className="chat-item-main">
                <div className="chat-item-name">{title}</div>
                {interlocutors.length > 1 && <span className="group-chat-badge compact">Gruppo · {interlocutors.length}</span>}
                {c.lastMessage && <div className="chat-item-last">{c.lastMessage}</div>}
              </div>
              {c.lastMessage && <span className="chat-list-reaction" title={reactionForMessage(c.lastMessage).label}>{reactionForMessage(c.lastMessage).icon}</span>}
              {c.unread > 0 && <span className="chat-unread-badge">{c.unread}</span>}
            </div>
            );
          })
        )}
      </div>
    </div>
  );
};

export default ChatsPanel;
