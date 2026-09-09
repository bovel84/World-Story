/**
 * World Story — Chats Routes
 * =======================
 * Chat diplomatiche del giocatore con le politie (stile Pax Historia).
 *  - GET  /:id/chats                     — elenco chat
 *  - POST /:id/chats                     — crea chat (polityNames[] anche gruppi)
 *  - GET  /:id/chats/:chatId/messages    — messaggi (+ segna letti)
 *  - POST /:id/chats/:chatId/messages    — invia messaggio (risposta LLM)
 *  - POST /:id/chats/:chatId/auto        — «Lascia che parlino»: le nazioni
 *                                          proseguono tra loro
 * Montato sotto lo stesso prefisso /api/games di gamesRouter.
 */

import { Router } from 'express';
import { getSessionRegistry } from '../session-registry';
import { LLMError } from '../llm';
import { ContextChangedError, SimulationInProgressError } from '../game-session';

export const chatsRouter = Router();

/**
 * Gestore errori unificato (stesso pattern di games.routes):
 * LLMError → 502, run attivo / contesto cambiato → 409, "not found" → 404,
 * tutto il resto → 500.
 */
function respondRouteError(res: any, e: any, fallback: string): void {
  if (e instanceof LLMError) {
    res.status(502).json({ error: `LLM (${e.provider}): ${e.message}` });
  } else if (e instanceof SimulationInProgressError) {
    // F04 passo 3: politica esplicita durante un run — 409.
    res.status(409).json({ error: e.message, code: 'simulation_in_progress' });
  } else if (e instanceof ContextChangedError) {
    // F04 passo 3: risposta tardiva — la replica non è stata scritta sul
    // ramo nuovo; il client la mostra come bozza locale se vuole.
    res.status(409).json({ error: e.message, code: 'context_changed' });
  } else if (typeof e?.message === 'string' && e.message.includes('not found')) {
    res.status(404).json({ error: e.message });
  } else if (typeof e?.message === 'string' && e.message.includes('Polity not found')) {
    res.status(404).json({ error: e.message });
  } else {
    console.error('[Chats] Error:', e);
    res.status(500).json({ error: fallback });
  }
}

function chatPayload(chat: any) {
  return {
    id: chat.id,
    polityId: chat.polityId,
    polityName: chat.polityName,
    polityColor: chat.polityColor,
    participants: chat.participants,
    createdAt: chat.createdAt,
    lastMessageAt: chat.lastMessageAt,
    lastMessage: chat.lastMessage ?? null,
    unread: Number(chat.unread) || 0,
  };
}

function messagePayload(m: any) {
  return {
    id: m.id,
    role: m.role,
    content: m.content,
    turn: m.turn,
    senderName: m.senderName,
    gameDate: m.gameDate,
    createdAt: m.createdAt,
  };
}

// Elenco chat della partita
chatsRouter.get('/:id/chats', (req, res) => {
  try {
    const session = getSessionRegistry().getSessionOrThrow(req.params.id);
    res.json({ chats: session.getChats().map(chatPayload) });
  } catch (e: any) {
    respondRouteError(res, e, 'Failed to get chats');
  }
});

// Crea (o restituisce l'esistente) chat con una o più politie — idempotente
chatsRouter.post('/:id/chats', (req, res) => {
  const body = req.body || {};
  // Nuovo formato: polityNames[] (gruppo). Retrocompatibilità: polityName singolo.
  const names: string[] = Array.isArray(body.polityNames) && body.polityNames.length > 0
    ? body.polityNames
    : (typeof body.polityName === 'string' ? [body.polityName] : []);

  if (names.length === 0) {
    res.status(400).json({ error: 'polityNames is required (array of polity names)' });
    return;
  }

  try {
    const session = getSessionRegistry().getSessionOrThrow(req.params.id);
    const chat = session.ensureChat(names);
    res.json({ chat: chatPayload(chat) });
  } catch (e: any) {
    respondRouteError(res, e, 'Failed to create chat');
  }
});

// Messaggi della chat (+ segna letti)
chatsRouter.get('/:id/chats/:chatId/messages', (req, res) => {
  try {
    const session = getSessionRegistry().getSessionOrThrow(req.params.id);
    const messages = session.getChatMessages(req.params.chatId);
    session.markChatRead(req.params.chatId);
    res.json({ messages: messages.map(messagePayload) });
  } catch (e: any) {
    respondRouteError(res, e, 'Failed to get chat messages');
  }
});

// Segna esplicitamente la chat come letta (utile per i messaggi SSE).
chatsRouter.post('/:id/chats/:chatId/read', (req, res) => {
  try {
    const session = getSessionRegistry().getSessionOrThrow(req.params.id);
    session.markChatRead(req.params.chatId);
    res.json({ ok: true });
  } catch (e: any) {
    respondRouteError(res, e, 'Failed to mark chat as read');
  }
});

// Invia un messaggio del giocatore (la replica arriva dall'LLM)
chatsRouter.post('/:id/chats/:chatId/messages', async (req, res) => {
  const { content } = req.body || {};
  if (typeof content !== 'string' || !content.trim()) {
    res.status(400).json({ error: 'content is required' });
    return;
  }

  try {
    const session = getSessionRegistry().getSessionOrThrow(req.params.id);
    const { message, reply } = await session.sendChatMessage(req.params.chatId, content);
    res.json({ message: messagePayload(message), reply: messagePayload(reply) });
  } catch (e: any) {
    respondRouteError(res, e, 'Failed to send chat message');
  }
});

// «Lascia che parlino»: le nazioni proseguono la trattativa tra loro
chatsRouter.post('/:id/chats/:chatId/auto', async (req, res) => {
  const exchanges = Number(req.body?.exchanges);
  try {
    const session = getSessionRegistry().getSessionOrThrow(req.params.id);
    const { replies } = await session.continueChat(req.params.chatId, Number.isFinite(exchanges) ? exchanges : 2);
    res.json({ replies: replies.map(messagePayload) });
  } catch (e: any) {
    respondRouteError(res, e, 'Failed to continue chat');
  }
});

