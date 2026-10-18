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
import type { ChatSummary } from '../../stores/chatStore';
import { useSimulationStore } from '../../stores/simulationRuntime';
import type { Region } from '../../types';
import { publicNarrativeText } from '../../services/publicNarrative';
import { formatGameDate, formatChatStamp, orderChatsByLatest, groupChatsByGameDate } from './chatTimeline';
import { isNewDiplomaticMessagePersisted, pickDiplomaticTargetIds } from './diplomaticChatNavigation';
import { isNearBottom } from './chatScroll';
import { diplomaticMessageForDisplay } from './diplomaticOpeningView';

interface ChatsPanelProps {
  gameId: string;
  regions: Region[];
  /** polityId del giocatore — lo escludiamo dall'elenco degli interlocutori */
  playerPolityId: string;
  /** Modalità riunione: una sola chat di gruppo con tutte le nazioni, niente elenco */
  uniqueMeeting?: boolean;
}

/** Politia interlocutrice, dedotta dalle regioni (owner = polityId) */
interface PolityOption {
  id: string;
  name: string;
  color: string;
}

const ISO3_TO_ISO2: Record<string, string> = {
  USA: 'us', RUS: 'ru', CHN: 'cn', GBR: 'gb', FRA: 'fr', DEU: 'de', ITA: 'it',
  ESP: 'es', PRT: 'pt', JPN: 'jp', IND: 'in', BRA: 'br', CAN: 'ca', MEX: 'mx',
  ARG: 'ar', AUS: 'au', KOR: 'kr', PRK: 'kp', TUR: 'tr', IRN: 'ir', IRQ: 'iq',
  SAU: 'sa', ISR: 'il', PSE: 'ps', JOR: 'jo', LBN: 'lb', EGY: 'eg', UKR: 'ua',
  POL: 'pl', SWE: 'se', NOR: 'no', FIN: 'fi', DNK: 'dk', NLD: 'nl', BEL: 'be',
  CHE: 'ch', AUT: 'at', GRC: 'gr', PAK: 'pk', IDN: 'id', VNM: 'vn', THA: 'th',
  UGA: 'ug', RWA: 'rw', BDI: 'bi', TZA: 'tz', COD: 'cd', COG: 'cg', SSD: 'ss', SDN: 'sd',
  KHM: 'kh', LAO: 'la', MMR: 'mm', ERI: 'er', CZE: 'cz', SVK: 'sk', HUN: 'hu', ROU: 'ro',
  ZAF: 'za', NGA: 'ng', ETH: 'et', KEN: 'ke', MAR: 'ma', DZA: 'dz', TUN: 'tn',
};

function flagEmoji(code?: string): string {
  const alpha2 = ISO3_TO_ISO2[(code || '').toUpperCase()] || (code || '').toLowerCase();
  if (!/^[a-z]{2}$/.test(alpha2)) return '🏳️';
  return alpha2.toUpperCase().split('').map(char => String.fromCodePoint(127397 + char.charCodeAt(0))).join('');
}

export const ChatsPanel: React.FC<ChatsPanelProps> = ({ gameId, regions, playerPolityId, uniqueMeeting }) => {
  const {
    chats, activeChatId, messagesByChat, chatLoadError,
    refreshChats, upsertChat, setActiveChat, setMessages, appendMessage, markRead,
    archiveChat, unarchiveChat,
  } = useChatStore();

  const [showNewChat, setShowNewChat] = useState(false);
  const [showArchive, setShowArchive] = useState(false);
  const [inputText, setInputText] = useState('');
  const [sending, setSending] = useState(false);
  const [loadingMessages, setLoadingMessages] = useState(false);
  /** Selezione multipla per le chat di gruppo (stile Pax Historia) */
  const [selectedPolityIds, setSelectedPolityIds] = useState<Set<string>>(new Set());
  /** «Lascia che parlino» in corso */
  const [autoRunning, setAutoRunning] = useState(false);
  const [error, setError] = useState('');
  const [subject, setSubject] = useState('');
  const [countrySearch, setCountrySearch] = useState('');
  const [creating, setCreating] = useState(false);
  const messagesRef = useRef<HTMLDivElement>(null);
  const followMessages = useRef(true);
  const openingRequest = useRef(0);
  const currentContext = () => {
    const generation = useSimulationStore.getState().commandGeneration;
    return () => useSimulationStore.getState().commandGeneration === generation
      && useChatStore.getState().gameId === gameId;
  };

  const messagesEndRef = useRef<HTMLDivElement>(null);
  const playerRegion = regions.find(region => region.owner === playerPolityId);
  const playerPolityName = playerRegion?.polityName || playerRegion?.name || playerPolityId;

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
    if (followMessages.current) messagesEndRef.current?.scrollIntoView({ block: 'end' });
  }, [activeMessages.length, activeChatId, loadingMessages]);

  useEffect(() => {
    followMessages.current = true;
    setInputText('');
    setError('');
  }, [activeChatId, gameId]);

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
    return [...byId.values()].sort((a, b) => a.name.localeCompare(b.name, 'it'));
  }, [regions, playerPolityId]);

  // Riunione unica: una sola chat di gruppo con tutte le nazioni (create è
  // idempotente sul backend, quindi riapre sempre la stessa riunione).
  const meetingStarted = useRef(false);
  useEffect(() => {
    if (!uniqueMeeting || isLocal || meetingStarted.current) return;
    if (polities.length === 0) return;
    meetingStarted.current = true;
    (async () => {
      try {
        // Il backend risolve le politie via resolver sui nomi REGIONE: nei
        // mondi provinciali il nome nazione («China») non è una regione e la
        // riunione resta bloccata su «Apertura…». Il codice polity (p.id,
        // es. «CHN») è invece sempre un alias valido nel PolityResolver.
        const names = polities.map(p => p.id);
        const { chat } = await chatsApi.create(gameId, names, {
          subject: 'Riunione plenaria',
          dedupeKey: `meeting:${[...names].sort().join('|')}`,
        });
        upsertChat(chat);
        setActiveChat(chat.id);
        const data = await chatsApi.messages(gameId, chat.id);
        setMessages(chat.id, data.messages || []);
        markRead(chat.id);
      } catch (e) {
        setError(e instanceof Error ? e.message : 'Impossibile aprire la riunione.');
      }
    })();
  }, [uniqueMeeting, isLocal, polities, gameId]);

  // Apri la chat: carica i messaggi (il backend li segna letti) e azzera unread
  const openChat = async (chatId: string) => {
    const request = ++openingRequest.current;
    const isCurrent = currentContext();
    followMessages.current = true;
    setActiveChat(chatId);
    setShowNewChat(false);
    if (isLocal) return;
    setLoadingMessages(true);
    try {
      const data = await chatsApi.messages(gameId, chatId);
      if (!isCurrent() || request !== openingRequest.current) return;
      setMessages(chatId, data.messages || []);
      markRead(chatId);
      setError('');
    } catch (e) {
      if (!isCurrent() || request !== openingRequest.current) return;
      console.error('[ChatsPanel] Impossibile caricare i messaggi:', e);
      setError(e instanceof Error ? e.message : 'Impossibile caricare i messaggi.');
    } finally {
      if (isCurrent() && request === openingRequest.current) setLoadingMessages(false);
    }
  };

  // A new topic coexists with other negotiations involving the same governments.
  const handleCreateChat = async (names: string[]) => {
    if (names.length === 0 || !subject.trim() || creating) return;
    const isCurrent = currentContext();
    setCreating(true);
    try {
      setError('');
      const { chat } = await chatsApi.create(gameId, names, { subject: subject.trim() });
      if (!isCurrent()) return;
      setSubject('');
      setCountrySearch('');
      upsertChat(chat);
      setSelectedPolityIds(new Set());
      setShowNewChat(false);
      await openChat(chat.id);
      void refreshChats();
    } catch (e) {
      if (!isCurrent()) return;
      console.error('[ChatsPanel] Impossibile creare la chat:', e);
      setError(e instanceof Error ? e.message : 'Impossibile creare la chat.');
    } finally {
      setCreating(false);
    }
  };

  // Select one or more delegations, then explicitly open the named discussion.
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
    const chatId = activeChatId;
    const isCurrent = currentContext();
    setError('');
    setAutoRunning(true);
    try {
      const { replies } = await chatsApi.auto(gameId, chatId, 2);
      if (!isCurrent()) return;
      for (const r of replies || []) {
        appendMessage(chatId, r);
      }
      await chatsApi.markRead(gameId, chatId);
      if (!isCurrent()) return;
      markRead(chatId);
      refreshChats();
    } catch (e) {
      if (!isCurrent()) return;
      // Earlier replies may already be persisted when a later delegate fails.
      try {
        const data = await chatsApi.messages(gameId, chatId);
        if (isCurrent()) setMessages(chatId, data.messages || []);
      } catch { /* preserve the messages already delivered via SSE */ }
      if (!isCurrent()) return;
      console.error('[ChatsPanel] Impossibile far parlare le nazioni:', e);
      setError(e instanceof Error ? e.message : 'Le nazioni non riescono a proseguire la trattativa.');
    } finally {
      setAutoRunning(false);
    }
  };

  // The backend persists the player note BEFORE requesting the LLM answer.
  // If the provider fails, reconcile the thread instead of resending the same note.
  const handleSend = async () => {
    const text = inputText.trim();
    const chatId = activeChatId;
    if (!text || !chatId || sending || autoRunning) return;
    const previousIds = new Set((useChatStore.getState().messagesByChat[chatId] ?? [])
      .map(message => message.id).filter(Boolean));
    followMessages.current = true;
    setInputText('');
    setSending(true);
    const commandGeneration = useSimulationStore.getState().commandGeneration;
    const isCurrent = () => useSimulationStore.getState().commandGeneration === commandGeneration
      && useChatStore.getState().gameId === gameId;
    try {
      const { message, reply } = await chatsApi.send(gameId, chatId, text);
      if (!isCurrent()) return;
      appendMessage(chatId, message);
      if (reply) appendMessage(chatId, reply);
      setError('');
      try {
        await chatsApi.markRead(gameId, chatId);
        if (isCurrent()) markRead(chatId);
      } catch (readError) {
        console.warn('[ChatsPanel] Messaggio inviato, lettura non sincronizzata:', readError);
      }
      void refreshChats();
    } catch (e) {
      if (!isCurrent()) return;
      console.error('[ChatsPanel] Impossibile completare la risposta diplomatica:', e);
      const details = e instanceof Error ? e.message : 'Risposta diplomatica non disponibile.';
      try {
        const data = await chatsApi.messages(gameId, chatId);
        if (!isCurrent()) return;
        const messages = data.messages ?? [];
        const persisted = isNewDiplomaticMessagePersisted(previousIds, messages, text);
        setMessages(chatId, messages);
        markRead(chatId);
        if (persisted) {
          setError(`La tua nota è stata registrata, ma la controparte non ha risposto: ${details}`);
          void refreshChats();
        } else {
          setInputText(text);
          setError(`Messaggio non inviato: ${details}`);
        }
      } catch {
        if (!isCurrent()) return;
        setInputText(text);
        setError('Esito non verificabile. Controlla la cronologia prima di riprovare per evitare doppioni.');
      }
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
  const participantTitle = activeInterlocutors.length > 0
    ? activeInterlocutors.map(p => p.name).join(' · ')
    : activeChat?.polityName || 'Trattativa diplomatica';
  const activeTitle = activeChat?.subject?.trim() || participantTitle;

  const flagForPolity = (polityId?: string, name?: string) => {
    const region = regions.find(r => r.owner === polityId || r.polityName === name || r.name === name);
    return flagEmoji(region?.flag || polityId);
  };
  const messageMeta = (message: { turn?: number; gameDate?: string }) =>
    formatGameDate(message.gameDate) || 'Data non registrata';

  // Elenco sempre dal più recente: una chat appena aggiornata sale in cima,
  // così si vede subito quale conversazione è l'ultima. Le discussioni chiuse
  // finiscono nell'archivio, non nell'elenco attivo.
  const orderedChats = orderChatsByLatest(chats);
  const activeChats = orderedChats.filter(c => !c.archived);
  const archivedChats = orderedChats.filter(c => c.archived);

  // Colore del mittente dai partecipanti della chat attiva
  const senderColor = (name: string): string => {
    const p = activeChat?.participants?.find(pp => pp.name === name);
    return p?.color || activeChat?.polityColor || '#888';
  };

  const renderChatItem = (c: ChatSummary) => {
    const interlocutors = c.participants?.filter(p => p.role !== 'player') || [];
    const names = interlocutors.map(p => p.name).join(' · ') || c.polityName;
    const title = c.subject?.trim() || names || 'Trattativa diplomatica';
    return (
      <button type="button" key={c.id} className={`chat-item${c.unread ? ' unread' : ''}${c.archived ? ' archived' : ''}`}
        onClick={() => void openChat(c.id)} aria-label={`${title}${c.unread ? `, ${c.unread} messaggi non letti` : ''}`}>
        <span className="chat-list-flags" aria-label={names}>
          {(interlocutors.length ? interlocutors : [{ id: c.polityId, name: c.polityName }]).slice(0, 3).map((p, i) => (
            <span key={p.id || i} className="chat-flag" title={p.name}>{flagForPolity(p.id, p.name)}</span>
          ))}
          {interlocutors.length > 3 && <span className="chat-flags-more">+{interlocutors.length - 3}</span>}
        </span>
        <span className="chat-item-main">
          <span className="chat-item-name">{title}</span>
          <span className="chat-item-last">{c.lastMessage
            ? publicNarrativeText(diplomaticMessageForDisplay(c.lastMessage, c.subject, 'polity'), playerPolityName)
            : 'La trattativa è aperta. Scrivi il primo messaggio.'}</span>
          <span className="chat-item-participants">{names}</span>
        </span>
        <span className="chat-item-end">
          <time className="chat-item-time" dateTime={c.lastMessageGameDate || undefined}>
            {formatChatStamp(c.lastMessageGameDate, c.lastMessageAt || c.createdAt)}
          </time>
          {!!c.unread && <span className="chat-unread-badge">{c.unread}</span>}
          <span aria-hidden="true" className="chat-item-chevron">›</span>
        </span>
      </button>
    );
  };
  const renderChatGroups = (items: ChatSummary[]) => groupChatsByGameDate(items).map(group => (
    <section key={group.date || 'undated'} className="chat-date-group" aria-label={formatGameDate(group.date) || 'Data non registrata'}>
      <div className="chat-date-divider"><time dateTime={group.date || undefined}>{formatGameDate(group.date) || 'Data non registrata'}</time></div>
      {group.chats.map(renderChatItem)}
    </section>
  ));

  // --- Thread dei messaggi ---
  if (activeChatId) {
    return (
      <div className="chats-panel">
        <div className="chat-thread-header">
          <div className="chat-thread-heading">
            {!uniqueMeeting && (
              <button type="button" className="btn-chat-back" onClick={() => setActiveChat(null)} aria-label="Torna alle conversazioni" title="Alle chat">←</button>
            )}
            <div className="chat-thread-identity">
              <strong className="chat-thread-title" title={activeTitle}>{activeTitle}</strong>
              <time className="chat-thread-stamp" title="Ultimo messaggio nel calendario di gioco">
                {formatChatStamp(
                  activeMessages.length ? activeMessages[activeMessages.length - 1].gameDate : activeChat?.lastMessageGameDate,
                  activeChat?.lastMessageAt || activeChat?.createdAt,
                )}
              </time>
            </div>
            <details className="chat-thread-details">
              <summary title="Partecipanti e opzioni">
                <span className="chat-details-accessible">Partecipanti e opzioni</span>
                <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                  <path d="M12 3.5l1.4 1 2-.1.9 1.8 1.9.8v2l1.3 1.5-1.3 1.5v2l-1.9.8-.9 1.8-2-.1-1.4 1-1.4-1-2 .1-.9-1.8-1.9-.8v-2L4.5 10.5 5.8 9v-2l1.9-.8.9-1.8 2 .1L12 3.5Z" transform="translate(0 1.5)"/>
                  <circle cx="12" cy="12" r="2.5"/>
                </svg>
              </summary>
              <div className="chat-thread-details-popover">
                <h3>Partecipanti · {activeInterlocutors.length + 1}</h3>
                <div className="chat-participants">{activeChat?.participants?.map(p => (
                  <span key={p.id}><span className="chat-flag">{flagForPolity(p.id, p.name)}</span> {p.name}{p.role === 'player' ? ' (tu)' : ''}</span>
                ))}</div>
                <div className="chat-thread-actions">
                  <button type="button" className="btn-chat-auto" onClick={handleAutoChat}
                    disabled={autoRunning || sending || !!activeChat?.archived}
                    title="Lascia che la delegazione prosegua la trattativa">
                    {autoRunning ? 'In corso…' : 'Prosegui dialogo'}
                  </button>
                  {activeChat?.archived ? (
                    <button type="button" className="btn-chat-archive reopen"
                      onClick={() => { if (activeChat) unarchiveChat(activeChat.id); }}
                      title="Riapri la discussione archiviata">↩ Riapri</button>
                  ) : (
                    <button type="button" className="btn-chat-archive"
                      onClick={() => { if (activeChatId) archiveChat(activeChatId); }}
                      title="Sposta la discussione nell'archivio">Archivia</button>
                  )}
                </div>
              </div>
            </details>
          </div>
        </div>

        {activeChat?.archived && (
          <div className="chat-archived-banner" role="status">
            Discussione archiviata · riaprila per continuare
          </div>
        )}

        <div className="chat-messages" ref={messagesRef} onScroll={() => { if (messagesRef.current) followMessages.current = isNearBottom(messagesRef.current); }}>
          {loadingMessages && activeMessages.length === 0 ? (
            <div className="chats-empty">Caricamento messaggi...</div>
          ) : activeMessages.length === 0 ? (
            <div className="chats-empty">Nessun messaggio — inizia le negoziazioni</div>
          ) : (
            activeMessages.map((m, index) => (
              <React.Fragment key={m.id || `${m.role}-${m.createdAt}`}>
                {(index === 0 || m.gameDate !== activeMessages[index - 1].gameDate) && (
                  <div className="chat-date-divider"><time dateTime={m.gameDate}>{messageMeta(m)}</time></div>
                )}
                <article className={`chat-msg-wrap ${m.role}`}
                  style={{ '--nation-color': m.role === 'player' ? '#32644e' : senderColor(m.senderName || '') } as React.CSSProperties}>
                  <div className="chat-sender">
                    <span className="chat-sender-name">{m.role === 'player' ? `${playerPolityName} (tu)` : m.senderName || activeChat?.polityName}</span>
                  </div>
                  <div className={`chat-bubble ${m.role}`}>
                    {publicNarrativeText(diplomaticMessageForDisplay(m.content, activeChat?.subject, m.role), playerPolityName)}
                  </div>
                </article>
              </React.Fragment>
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
        <form className="chat-input-row" onSubmit={(event) => { event.preventDefault(); void handleSend(); }}>
          <textarea
            value={inputText}
            onChange={(e) => setInputText(e.target.value)}
            placeholder={activeChat?.archived ? 'Discussione archiviata — riaprila per scrivere' : 'Scrivi il tuo messaggio…'}
            aria-label="Messaggio diplomatico"
            rows={2}
            disabled={sending || autoRunning || !!activeChat?.archived}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
                e.preventDefault();
                void handleSend();
              }
            }}
          />
          <button
            className="btn-chat-send"
            type="submit"
            disabled={!inputText.trim() || sending || autoRunning || !!activeChat?.archived}
            title="Invia" aria-label="Invia messaggio"
          >
            {sending ? '…' : <svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" strokeWidth="1.7" aria-hidden="true"><path d="m21 3-7 18-4-7-7-4 18-7Z M10 14 21 3" /></svg>}
          </button>
        </form>
      </div>
    );
  }

  // --- Elenco chat ---
  if (uniqueMeeting && !activeChatId) {
    return (
      <div className="chats-panel">
        <div className="chats-empty">Apertura della riunione…</div>
      </div>
    );
  }
  return (
    <div className="chats-panel">
      <header className="chat-list-header"><h2>{showNewChat ? 'Nuova chat diplomatica' : 'Chat diplomatiche'}</h2></header>
      {error && <div className="chat-error" role="alert">{error}</div>}
      {chatLoadError && <div className="chat-error" role="alert">Impossibile aggiornare le chat: {chatLoadError}</div>}
      <div className="chats-list">
        {showNewChat ? (
          <form className="new-chat-picker" onSubmit={event => { event.preventDefault(); void handleCreateChat(pickDiplomaticTargetIds(polities, selectedPolityIds)); }}>
            <label htmlFor="diplomatic-subject">Argomento della trattativa</label>
            <input id="diplomatic-subject" value={subject} onChange={event => setSubject(event.target.value)} maxLength={120}
              placeholder="Es. Accordo sui transiti commerciali" required disabled={creating} />
            <p className="picker-hint">Invita una o più nazioni. Puoi tenere aperte trattative su argomenti diversi con gli stessi governi.</p>
            <label htmlFor="diplomatic-country-search">Nazioni da invitare · {selectedPolityIds.size} selezionate</label>
            <input id="diplomatic-country-search" type="search" value={countrySearch} onChange={event => setCountrySearch(event.target.value)} placeholder="Cerca una nazione…" />
            <div className="polity-pick-list">
              {polities.filter(p => p.name.toLocaleLowerCase('it').includes(countrySearch.toLocaleLowerCase('it'))).map(p => (
                <label key={p.id} className={`polity-pick-item${selectedPolityIds.has(p.id) ? ' selected' : ''}`}>
                  <input type="checkbox" checked={selectedPolityIds.has(p.id)} onChange={() => togglePolitySelection(p.id)} disabled={creating} />
                  <span className="chat-flag">{flagForPolity(p.id, p.name)}</span><span>{p.name}</span>
                </label>
              ))}
              {!polities.length && <p className="chats-empty">Nessun paese disponibile per le negoziazioni</p>}
            </div>
            <button className="btn-create-group-chat" type="submit" disabled={!subject.trim() || !selectedPolityIds.size || creating}>
              {creating ? 'Apertura…' : `Apri trattativa · ${selectedPolityIds.size} ${selectedPolityIds.size === 1 ? 'nazione' : 'nazioni'}`}
            </button>
          </form>
        ) : <>
          {!activeChats.length && <div className="chats-empty">Nessuna discussione aperta.<br />Inizia una nuova chat per invitare le delegazioni.</div>}
          {renderChatGroups(activeChats)}
          {archivedChats.length > 0 && <div className="chats-archive">
            <button type="button" className="btn-toggle-archive" onClick={() => setShowArchive(v => !v)} aria-expanded={showArchive}>
              {showArchive ? '▾' : '▸'} Archivio ({archivedChats.length})
            </button>
            {showArchive && renderChatGroups(archivedChats)}
          </div>}
        </>}
      </div>
      <div className="chat-list-footer">
        <button type="button" className="btn-new-chat" disabled={creating} onClick={() => { setShowNewChat(v => !v); setSelectedPolityIds(new Set()); setCountrySearch(''); setError(''); }}>
          {showNewChat ? 'Annulla' : 'Inizia una nuova chat'}
        </button>
      </div>
    </div>
  );
};

export default ChatsPanel;
