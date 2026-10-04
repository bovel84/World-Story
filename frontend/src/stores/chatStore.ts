/**
 * World Story — Chat Store (Zustand)
 * ================================
 * Fase 3: chat diplomatiche + Consulente live.
* Contiene l'elenco delle chat, i messaggi per chatId, i contatori unread
* e il flusso di messaggi del consulente (incluse le sintesi proattive da SSE).
 */

import { create } from 'zustand';
import { chatsApi, type ChatSummaryData, type ChatMessageData, type CouncilIssue } from '../services/api';
import { archiveSiblingThreads, lastChatMessage, orderChatMessages } from '../components/Game/chatTimeline';
import { tagLegacyTurns } from '../components/Game/advisorTurns';

export type ChatSummary = ChatSummaryData;
export type ChatMessage = ChatMessageData;

/** Messaggio nel flusso del consulente */
export interface AdvisorMessage {
  role: 'user' | 'assistant';
  content: string;
  /** Server-validated proposals remain attached to their actual contribution. */
  issues?: CouncilIssue[];
/** Commento proattivo del consulente dopo il turno (SSE advisor_proactive) */
  proactive?: boolean;
  /**
   * WS-GOV-TURN-SESSIONS (A5) — Il turno della seduta a cui appartiene il
   * messaggio. La chat visibile e la cronologia inviata al ministro sono quelle
   * del turno corrente; i turni precedenti restano storia nello store.
   */
  turn?: number;
  /**
   * WS-GOV-COUNCIL-MEETINGS (B12/B19) — Chi parla, quando non è la sedia aperta:
   * nella riunione ogni intervento è attribuito («Ministro dei Lavori», …).
   */
  speaker?: string;
}

/** Schede del pannello flottante */
export type FloatingPanelTab = 'suggestions' | 'advisor' | 'chats' | 'news' | 'nation';

interface ChatState {
  // Partita a cui sono legate le chat (al cambio partita lo stato si azzera)
  gameId: string | null;

  // Chat diplomatiche
  chats: ChatSummary[];
  activeChatId: string | null;
  messagesByChat: Record<string, ChatMessage[]>;

  // Consulente live
  advisorMessages: AdvisorMessage[];
  advisorStreaming: boolean;

  // P02-bis — la cronaca dei ministri, PER SEDIA.
  //
  // L'autore: «adesso è tutto mischiato». Prima il dialogo viveva nello stato
  // locale del componente, quindi cambiare ministro lo cancellava e due sedie
  // non si distinguevano. Qui ogni sedia ha il suo filo, e le conversazioni
  // sopravvivono alla chiusura del pannello — come per il Consulente.
  ministerChats: Record<string, AdvisorMessage[]>;
  /** La sedia che sta scrivendo adesso, se ce n'è una. */
  ministerStreamingSeat: string | null;

  // Scheda attiva e visibilità effettiva del pannello flottante
  panelTab: FloatingPanelTab;
  chatPanelVisible: boolean;

  // Actions
  setGameId: (gameId: string | null) => void;
  setPanelTab: (tab: FloatingPanelTab) => void;
  setChatPanelVisible: (visible: boolean) => void;
  refreshChats: () => Promise<void>;
  upsertChat: (chat: ChatSummary) => void;
  /** Archivia una discussione (esce dall'elenco attivo, resta consultabile). */
  archiveChat: (chatId: string) => Promise<void>;
  /** Riapre una discussione archiviata. */
  unarchiveChat: (chatId: string) => Promise<void>;
  setActiveChat: (chatId: string | null) => void;
  setMessages: (chatId: string, messages: ChatMessage[]) => void;
  appendMessage: (chatId: string, message: ChatMessage) => void;
  markRead: (chatId: string) => void;
  handleIncomingChatMessage: (payload: {
    chatId: string;
    polityId: string;
    polityName: string;
    participants?: ChatSummary['participants'];
    message: ChatMessage;
  }) => void;
  addAdvisorMessage: (msg: AdvisorMessage) => void;
  /** WS-GOV-TURN-AWARENESS — Marca i messaggi legacy con il turno corrente. */
  tagAdvisorTurns: (turn: number) => void;
  appendToLastAdvisorMessage: (token: string) => void;
  setAdvisorStreaming: (streaming: boolean) => void;
  addMinisterMessage: (seat: string, msg: AdvisorMessage) => void;
  appendToLastMinisterMessage: (seat: string, token: string) => void;
  setMinisterStreaming: (seat: string | null) => void;
  clearMinisterChat: (seat: string) => void;
  reset: () => void;
}

const initialState = {
  gameId: null as string | null,
  chats: [] as ChatSummary[],
  activeChatId: null as string | null,
  messagesByChat: {} as Record<string, ChatMessage[]>,
  advisorMessages: [] as AdvisorMessage[],
  advisorStreaming: false,
  ministerChats: {} as Record<string, AdvisorMessage[]>,
  ministerStreamingSeat: null as string | null,
  panelTab: 'suggestions' as FloatingPanelTab,
  chatPanelVisible: false,
};

export const useChatStore = create<ChatState>((set, get) => ({
  ...initialState,

  // Al cambio partita azzeriamo chat e flusso del consulente
  setGameId: (gameId) => set((state) => (
    state.gameId === gameId ? {} : { ...initialState, gameId, panelTab: state.panelTab }
  )),

  setPanelTab: (tab) => set({ panelTab: tab }),
  setChatPanelVisible: (visible) => set({ chatPanelVisible: visible }),

  // Ricarica l'elenco chat dal server (gli errori vengono ignorati — le chat non sono critiche)
  refreshChats: async () => {
    const { gameId } = get();
    if (!gameId || gameId.startsWith('local_')) return;
    try {
      // Anche le archiviate: la UI le mostra in una sezione separata e il
      // totale non letti deve escluderle, non ignorarle del tutto.
      const data = await chatsApi.list(gameId, true);
      if (get().gameId === gameId) set({ chats: data.chats || [] });
    } catch (e) {
      console.warn('[ChatStore] Impossibile caricare le chat:', e);
    }
  },

  // Aggiungi una chat o aggiorna l'esistente (dopo chatsApi.create)
  upsertChat: (chat) => set((state) => {
    const exists = state.chats.some(c => c.id === chat.id);
    return {
      chats: exists
        ? state.chats.map(c => (c.id === chat.id ? { ...c, ...chat } : c))
        : [chat, ...state.chats],
    };
  }),

  setActiveChat: (chatId) => set({ activeChatId: chatId }),

  archiveChat: async (chatId) => {
    const { gameId } = get();
    // Ottimistico: l'archivio è reversibile e non deve attendere il server.
    set((state) => ({
      chats: state.chats.map(c => (c.id === chatId ? { ...c, archived: true, unread: 0 } : c)),
    }));
    if (!gameId || gameId.startsWith('local_')) return;
    try {
      const { chat } = await chatsApi.archive(gameId, chatId);
      if (chat) set((state) => ({ chats: state.chats.map(c => (c.id === chatId ? { ...c, ...chat } : c)) }));
    } catch (e) {
      console.warn('[ChatStore] Impossibile archiviare la discussione:', e);
      set((state) => ({ chats: state.chats.map(c => (c.id === chatId ? { ...c, archived: false } : c)) }));
    }
  },

  unarchiveChat: async (chatId) => {
    const { gameId } = get();
    set((state) => ({
      chats: state.chats.map(c => (c.id === chatId ? { ...c, archived: false, archivedAt: null } : c)),
    }));
    if (!gameId || gameId.startsWith('local_')) return;
    try {
      const { chat } = await chatsApi.unarchive(gameId, chatId);
      if (chat) set((state) => ({ chats: state.chats.map(c => (c.id === chatId ? { ...c, ...chat } : c)) }));
    } catch (e) {
      console.warn('[ChatStore] Impossibile riaprire la discussione:', e);
      set((state) => ({ chats: state.chats.map(c => (c.id === chatId ? { ...c, archived: true } : c)) }));
    }
  },

  // I messaggi si mostrano nell'ordine della timeline del MONDO, non in quello
  // di arrivo: il fetch dal server, l'invio locale e il messaggio in arrivo via
  // SSE possono consegnare gli stessi messaggi in ordini diversi. L'ordinatore
  // è puro e deterministico (`orderChatMessages`).
  setMessages: (chatId, messages) => set((state) => ({
    messagesByChat: { ...state.messagesByChat, [chatId]: orderChatMessages(messages) },
  })),

  // Aggiungi un messaggio al thread (protezione dai duplicati per id — risposta POST e SSE possono arrivare insieme)
  appendMessage: (chatId, message) => set((state) => {
    const existing = state.messagesByChat[chatId] || [];
    if (message.id && existing.some(m => m.id === message.id)) return {};
    const thread = orderChatMessages([...existing, message]);
    // Un messaggio vecchio arrivato in ritardo va nella sua posizione: l'elenco
    // chat mostra l'ultimo messaggio **della timeline**, non l'ultimo arrivato.
    const latest = lastChatMessage(thread) || message;
    const chats = state.chats.map(c => (c.id === chatId ? {
      ...c,
      lastMessage: latest.content,
      lastMessageAt: latest.createdAt || c.lastMessageAt || new Date().toISOString(),
      lastMessageGameDate: latest.gameDate || c.lastMessageGameDate,
    } : c));
    return {
      messagesByChat: { ...state.messagesByChat, [chatId]: thread },
      chats,
    };
  }),

  // Azzera unread della chat (dopo il caricamento dei messaggi — il backend li segna come letti)
  markRead: (chatId) => set((state) => ({
    chats: state.chats.map(c => (c.id === chatId ? { ...c, unread: 0 } : c)),
  })),

  // Messaggio in arrivo da una politia (SSE chat_message)
  handleIncomingChatMessage: (payload) => set((state) => {
    const { chatId, message } = payload;
    const existing = state.messagesByChat[chatId] || [];
    const isDup = !!(message.id && existing.some(m => m.id === message.id));
    if (isDup) return {};
    // Anche il percorso SSE passa dall'ordinatore: un messaggio consegnato in
    // ritardo (o appartenente a un turno precedente) va nella sua posizione
    // della timeline, non in coda.
    const thread = orderChatMessages([...existing, message]);
    const latest = lastChatMessage(thread) || message;
    const messagesByChat = {
      ...state.messagesByChat,
      [chatId]: thread,
    };

    // Solo una chat realmente visibile non accumula non letti.
    const isOpen = state.chatPanelVisible && state.activeChatId === chatId;
    const known = state.chats.find(c => c.id === chatId);
    const updated: ChatSummary = {
      ...(known || {
        id: chatId,
        polityId: payload.polityId,
        polityName: payload.polityName,
        polityColor: payload.participants?.find(p => p.role !== 'player')?.color || '#888888',
        participants: payload.participants,
        unread: 0,
      }),
      lastMessage: latest.content,
      lastMessageAt: latest.createdAt || known?.lastMessageAt || new Date().toISOString(),
      lastMessageGameDate: latest.gameDate || known?.lastMessageGameDate,
      unread: isOpen ? 0 : (known?.unread || 0) + 1,
    };
    const chats = known
      ? [updated, ...state.chats.filter(c => c.id !== chatId)]
      : [updated, ...state.chats];

    return { messagesByChat, chats: archiveSiblingThreads(chats, chatId) };
  }),

  addAdvisorMessage: (msg) => set((state) => ({
    advisorMessages: [...state.advisorMessages, msg],
  })),

  tagAdvisorTurns: (turn) => set((state) => ({
    advisorMessages: tagLegacyTurns(state.advisorMessages, turn),
  })),

  // Aggiunge il token dello stream all'ultimo messaggio dell'assistente
  appendToLastAdvisorMessage: (token) => set((state) => {
    const msgs = state.advisorMessages;
    if (msgs.length === 0) return {};
    const last = msgs[msgs.length - 1];
    if (last.role !== 'assistant') return {};
    const updated = [...msgs];
    updated[updated.length - 1] = { ...last, content: last.content + token };
    return { advisorMessages: updated };
  }),

  setAdvisorStreaming: (streaming) => set({ advisorStreaming: streaming }),

  addMinisterMessage: (seat, msg) => set((state) => ({
    ministerChats: { ...state.ministerChats, [seat]: [...(state.ministerChats[seat] ?? []), msg] },
  })),

  appendToLastMinisterMessage: (seat, token) => set((state) => {
    const messages = state.ministerChats[seat] ?? [];
    if (!messages.length) return {};
    const updated = messages.slice();
    const last = updated[updated.length - 1];
    updated[updated.length - 1] = { ...last, content: last.content + token };
    return { ministerChats: { ...state.ministerChats, [seat]: updated } };
  }),

  setMinisterStreaming: (seat) => set({ ministerStreamingSeat: seat }),

  clearMinisterChat: (seat) => set((state) => {
    const next = { ...state.ministerChats };
    delete next[seat];
    return { ministerChats: next };
  }),

  reset: () => set(initialState),
}));

/** Totale unread sulle discussioni ATTIVE (le archiviate non pesano sui badge) */
export const selectTotalUnread = (state: ChatState): number =>
  state.chats.reduce((sum, c) => sum + (c.archived ? 0 : (c.unread || 0)), 0);
