/**
 * Open-Pax — Chat Store (Zustand)
 * ================================
 * Fase 3: chat diplomatiche + Consulente live.
* Contiene l'elenco delle chat, i messaggi per chatId, i contatori unread
* e il flusso di messaggi del consulente (incluse le sintesi proattive da SSE).
 */

import { create } from 'zustand';
import { chatsApi, type ChatSummaryData, type ChatMessageData } from '../services/api';

export type ChatSummary = ChatSummaryData;
export type ChatMessage = ChatMessageData;

/** Messaggio nel flusso del consulente */
export interface AdvisorMessage {
  role: 'user' | 'assistant';
  content: string;
/** Commento proattivo del consulente dopo il turno (SSE advisor_proactive) */
  proactive?: boolean;
}

/** Schede del pannello flottante */
export type FloatingPanelTab = 'suggestions' | 'advisor' | 'chats';

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

  // Scheda attiva e visibilità effettiva del pannello flottante
  panelTab: FloatingPanelTab;
  chatPanelVisible: boolean;

  // Actions
  setGameId: (gameId: string | null) => void;
  setPanelTab: (tab: FloatingPanelTab) => void;
  setChatPanelVisible: (visible: boolean) => void;
  refreshChats: () => Promise<void>;
  upsertChat: (chat: ChatSummary) => void;
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
  appendToLastAdvisorMessage: (token: string) => void;
  setAdvisorStreaming: (streaming: boolean) => void;
  reset: () => void;
}

const initialState = {
  gameId: null as string | null,
  chats: [] as ChatSummary[],
  activeChatId: null as string | null,
  messagesByChat: {} as Record<string, ChatMessage[]>,
  advisorMessages: [] as AdvisorMessage[],
  advisorStreaming: false,
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
      const data = await chatsApi.list(gameId);
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

  setMessages: (chatId, messages) => set((state) => ({
    messagesByChat: { ...state.messagesByChat, [chatId]: messages },
  })),

  // Aggiungi un messaggio al thread (protezione dai duplicati per id — risposta POST e SSE possono arrivare insieme)
  appendMessage: (chatId, message) => set((state) => {
    const existing = state.messagesByChat[chatId] || [];
    if (message.id && existing.some(m => m.id === message.id)) return {};
    return {
      messagesByChat: { ...state.messagesByChat, [chatId]: [...existing, message] },
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
    const messagesByChat = {
      ...state.messagesByChat,
      [chatId]: [...existing, message],
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
      lastMessage: message.content,
      lastMessageAt: message.createdAt || new Date().toISOString(),
      unread: isOpen ? 0 : (known?.unread || 0) + 1,
    };
    const chats = known
      ? [updated, ...state.chats.filter(c => c.id !== chatId)]
      : [updated, ...state.chats];

    return { messagesByChat, chats };
  }),

  addAdvisorMessage: (msg) => set((state) => ({
    advisorMessages: [...state.advisorMessages, msg],
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

  reset: () => set(initialState),
}));

/** Totale unread su tutte le chat (per i badge) */
export const selectTotalUnread = (state: ChatState): number =>
  state.chats.reduce((sum, c) => sum + (c.unread || 0), 0);
