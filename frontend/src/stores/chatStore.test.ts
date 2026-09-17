/**
 * World Story — CHAT-ORDER: i tre percorsi di scrittura del thread
 * ==============================================================
 * Il thread è riempito da tre percorsi diversi:
 *   1. `setMessages` — fetch dal server;
 *   2. `appendMessage` — invio del giocatore e risposta della politia;
 *   3. `handleIncomingChatMessage` — messaggio in arrivo via SSE (anche in
 *      ritardo, quando l'app torna in primo piano).
 *
 * Tutti e tre devono produrre **lo stesso ordine** (la timeline del mondo),
 * indipendentemente dall'ordine di arrivo. Questi test riproducono il caso della
 * segnalazione: la nota austriaca (turno 3) consegnata dopo lo scambio del
 * turno 4 finiva in fondo al thread.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { useChatStore, type ChatMessage } from './chatStore';

const CHAT = 'chat-austria';

/** Messaggio con la sequenza di inserimento del server (`seq` = rowid). */
const message = (over: Partial<ChatMessage> & { id: string }): ChatMessage => ({
  role: 'polity', content: `testo ${over.id}`, turn: 4, gameDate: '1815-09-08',
  senderName: 'Impero d’Austria', createdAt: '2026-09-17T19:14:00.000Z', seq: 1, ...over,
});

/** I tre messaggi reali della segnalazione (chat con l'Impero d'Austria). */
const notaTurno3 = message({
  id: 'nota-3', content: 'Avete aggredito la presidenza che vi ha…', turn: 3, seq: 230,
  createdAt: '2026-09-17T19:14:01.834Z',
});
const ordineGiocatore = message({
  id: 'ordine-4', role: 'player', content: 'Arrendetevi', turn: 4, seq: 231,
  senderName: 'Confederazione Germanica', createdAt: '2026-09-17T19:14:50.270Z',
});
const rispostaTurno4 = message({
  id: 'risposta-4', content: 'Alla voce ufficiale della Confederazione…', turn: 4, seq: 232,
  createdAt: '2026-09-17T19:14:54.511Z',
});

const ids = (chatId = CHAT) => (useChatStore.getState().messagesByChat[chatId] || []).map(m => m.id);

beforeEach(() => {
  useChatStore.getState().reset();
  useChatStore.getState().setGameId('game-1');
  useChatStore.getState().upsertChat({
    id: CHAT, polityId: 'AUS', polityName: 'Impero d’Austria', unread: 0,
    participants: [{ id: 'DEU', name: 'Confederazione Germanica', role: 'player' }, { id: 'AUS', name: 'Impero d’Austria', role: 'polity' }],
  } as never);
});

describe('chatStore — ordine dei messaggi (fetch)', () => {
  it('setMessages ordina la timeline del mondo anche se il server manda un elenco disordinato', () => {
    useChatStore.getState().setMessages(CHAT, [rispostaTurno4, notaTurno3, ordineGiocatore]);
    expect(ids()).toEqual(['nota-3', 'ordine-4', 'risposta-4']);
  });

  it('setMessages sostituisce l’elenco (nessuna regressione)', () => {
    useChatStore.getState().setMessages(CHAT, [notaTurno3]);
    useChatStore.getState().setMessages(CHAT, [ordineGiocatore]);
    expect(ids()).toEqual(['ordine-4']);
  });
});

describe('chatStore — ordine dei messaggi (invio locale e risposta)', () => {
  it('la sequenza di invio arriva al thread nell’ordine della timeline', () => {
    useChatStore.getState().setMessages(CHAT, [notaTurno3]);
    useChatStore.getState().appendMessage(CHAT, ordineGiocatore);
    useChatStore.getState().appendMessage(CHAT, rispostaTurno4);
    expect(ids()).toEqual(['nota-3', 'ordine-4', 'risposta-4']);
  });

  it('un messaggio VECCHIO arrivato in ritardo va nella sua posizione, non in coda', () => {
    useChatStore.getState().setMessages(CHAT, [ordineGiocatore, rispostaTurno4]);
    // È il caso della segnalazione: la nota del turno 3 consegnata dopo.
    useChatStore.getState().appendMessage(CHAT, notaTurno3);
    expect(ids()).toEqual(['nota-3', 'ordine-4', 'risposta-4']);
  });

  it('l’elenco chat resta sull’ultimo messaggio della timeline, non sull’ultimo arrivato', () => {
    useChatStore.getState().setMessages(CHAT, [notaTurno3, ordineGiocatore, rispostaTurno4]);
    useChatStore.getState().appendMessage(CHAT, notaTurno3 && { ...notaTurno3, id: 'nota-vecchia', seq: 229, gameDate: '1815-08-30' });
    const chat = useChatStore.getState().chats.find(c => c.id === CHAT);
    // L'ultimo messaggio dell'elenco è quello della timeline (turno 4), non la nota vecchia appena arrivata.
    expect(chat?.lastMessage).toBe(rispostaTurno4.content);
    expect(chat?.lastMessageGameDate).toBe('1815-09-08');
  });

  it('lo stesso messaggio non entra due volte (POST + SSE possono arrivare insieme)', () => {
    useChatStore.getState().appendMessage(CHAT, ordineGiocatore);
    useChatStore.getState().appendMessage(CHAT, ordineGiocatore);
    expect(ids()).toEqual(['ordine-4']);
  });
});

describe('chatStore — ordine dei messaggi (SSE)', () => {
  const incoming = (msg: ChatMessage, open = false) => {
    if (open) {
      useChatStore.getState().setChatPanelVisible(true);
      useChatStore.getState().setActiveChat(CHAT);
    }
    useChatStore.getState().handleIncomingChatMessage({
      chatId: CHAT, polityId: 'AUS', polityName: 'Impero d’Austria', message: msg,
    });
  };

  it('il percorso SSE produce lo stesso ordine del fetch', () => {
    // Fetch in un ordine (già quello del server), SSE in un ordine diverso.
    useChatStore.getState().setMessages(CHAT, [notaTurno3, ordineGiocatore, rispostaTurno4]);
    const fromFetch = ids();
    useChatStore.getState().reset();
    useChatStore.getState().setGameId('game-1');
    incoming(rispostaTurno4);
    incoming(notaTurno3);   // in ritardo: appartiene al turno 3
    incoming(ordineGiocatore);
    expect(ids()).toEqual(fromFetch);
    expect(ids()).toEqual(['nota-3', 'ordine-4', 'risposta-4']);
  });

  it('il duplicato via SSE non entra e non tocca i non letti', () => {
    incoming(rispostaTurno4);
    const unread = useChatStore.getState().chats.find(c => c.id === CHAT)?.unread;
    incoming(rispostaTurno4);
    expect(ids()).toEqual(['risposta-4']);
    expect(useChatStore.getState().chats.find(c => c.id === CHAT)?.unread).toBe(unread);
  });

  it('chat aperta: nessun non letto; chat chiusa: il contatore sale', () => {
    incoming(rispostaTurno4, true);
    expect(useChatStore.getState().chats.find(c => c.id === CHAT)?.unread).toBe(0);
    useChatStore.getState().setChatPanelVisible(false);
    incoming(ordineGiocatore);
    expect(useChatStore.getState().chats.find(c => c.id === CHAT)?.unread).toBe(1);
    // L'ordine resta quello della timeline.
    expect(ids()).toEqual(['ordine-4', 'risposta-4']);
  });
});
