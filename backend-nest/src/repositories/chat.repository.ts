/**
 * Open-Pax — Chat Repository
 * ==========================
 * Chat diplomatiche del giocatore con le politie.
 * Supporta chat uno-a-uno e di GRUPPO: `participants` contiene l'elenco
 * completo degli interlocutori [{id, name, color}]; `polity_id` resta il
 * partecipante principale (compatibilità con UNIQUE(game_id, polity_id)).
 */

import db from '../database';
import { shortId } from '../utils/short-id';

export type ChatRole = 'player' | 'polity';

/** Partecipante a una chat (nazione interlocutrice) */
export interface ChatParticipant {
  id: string;
  name: string;
  color: string;
  role: 'player' | 'polity';
}

export interface ChatRecord {
  id: string;
  gameId: string;
  polityId: string;
  polityName: string;
  polityColor: string;
  /** Tutti gli interlocutori della chat (per chat di gruppo può essere > 1) */
  participants: ChatParticipant[];
  createdAt: string;
  lastMessageAt: string | null;
}

/** Riga dell'elenco: con ultimo messaggio e contatore unread */
export interface ChatSummary extends ChatRecord {
  lastMessage: string | null;
  unread: number;
}

export interface ChatMessageRecord {
  id: string;
  chatId: string;
  role: ChatRole;
  content: string;
  turn: number;
  read: boolean;
  createdAt: string;
  /** Chi ha parlato ('player' → nome del giocatore; 'polity' → nome della nazione) */
  senderName?: string;
  /** Data del mondo, non il timestamp reale. */
  gameDate?: string;
}

function participantKey(ids: string[]): string {
  return [...new Set(ids.filter(Boolean))].sort().join('|');
}

function parseParticipants(raw: any, fallbackId: string, fallbackName: string, fallbackColor: string): ChatParticipant[] {
  try {
    if (typeof raw === 'string' && raw.trim()) {
      const arr = JSON.parse(raw);
      if (Array.isArray(arr) && arr.length > 0) {
        return arr
          .filter((p: any) => p && typeof p.id === 'string')
          .map((p: any) => ({
            id: String(p.id),
            name: String(p.name || p.id),
            color: String(p.color || fallbackColor),
            role: p.role === 'player' ? 'player' : 'polity',
          }));
      }
    }
  } catch { /* participants corrotti → fallback */ }
  return [{ id: fallbackId, name: fallbackName, color: fallbackColor, role: 'polity' }];
}

function rowToChat(row: any): ChatRecord {
  const color = row.polity_color || '#888888';
  return {
    id: row.id,
    gameId: row.game_id,
    polityId: row.polity_id,
    polityName: row.polity_name,
    polityColor: color,
    participants: parseParticipants(row.participants, row.polity_id, row.polity_name, color),
    createdAt: row.created_at,
    lastMessageAt: row.last_message_at || null,
  };
}

export interface GameChatSnapshot {
  chat: ChatRecord;
  messages: ChatMessageRecord[];
}

function rowToMessage(row: any): ChatMessageRecord {
  return {
    id: row.id,
    chatId: row.chat_id,
    role: row.role as ChatRole,
    content: row.content,
    turn: row.turn ?? 0,
    read: !!row.read,
    createdAt: row.created_at,
    senderName: row.sender_name || undefined,
    gameDate: row.game_date || undefined,
  };
}

export const chatRepository = {
  /** Crea una chat idempotente sull'insieme canonico dei partecipanti. */
  createChat(chat: {
    id: string;
    gameId: string;
    polityId: string;
    polityName: string;
    polityColor?: string;
    participants?: ChatParticipant[];
  }): ChatRecord {
    const now = new Date().toISOString();
    const participants = chat.participants && chat.participants.length > 0
      ? chat.participants
      : [{ id: chat.polityId, name: chat.polityName, color: chat.polityColor || '#888888', role: 'polity' as const }];
    const key = participantKey(participants.map(p => p.id));
    db.prepare(`
      INSERT INTO chats
        (id, game_id, polity_id, polity_name, polity_color, participants, participant_key, created_at, last_message_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, NULL)
      ON CONFLICT(game_id, participant_key) DO NOTHING
    `).run(
      chat.id,
      chat.gameId,
      chat.polityId,
      chat.polityName,
      chat.polityColor || '#888888',
      JSON.stringify(participants),
      key,
      now,
    );

    const row = db.prepare('SELECT * FROM chats WHERE game_id = ? AND participant_key = ?')
      .get(chat.gameId, key) as any;
    return rowToChat(row);
  },

  /** Trova una chat del gioco i cui partecipanti coincidono esattamente. */
  getChatByParticipantIds(gameId: string, ids: string[]): ChatRecord | null {
    const row = db.prepare('SELECT * FROM chats WHERE game_id = ? AND participant_key = ?')
      .get(gameId, participantKey(ids)) as any;
    return row ? rowToChat(row) : null;
  },

  /** Список чатов игры, свежие сверху, с последним сообщением и unread. */
  getChatsByGame(gameId: string): ChatSummary[] {
    const rows = db.prepare(`
      SELECT
        c.*,
        (SELECT m.content FROM chat_messages m
          WHERE m.chat_id = c.id
          ORDER BY m.created_at DESC, m.rowid DESC LIMIT 1) AS last_message,
        (SELECT COUNT(*) FROM chat_messages m
          WHERE m.chat_id = c.id AND m.role = 'polity' AND m.read = 0) AS unread
      FROM chats c
      WHERE c.game_id = ?
      ORDER BY COALESCE(c.last_message_at, c.created_at) DESC
    `).all(gameId) as any[];

    return rows.map(row => ({
      ...rowToChat(row),
      lastMessage: row.last_message || null,
      unread: Number(row.unread) || 0,
    }));
  },

  getChatById(chatId: string): ChatRecord | null {
    const row = db.prepare('SELECT * FROM chats WHERE id = ?').get(chatId) as any;
    return row ? rowToChat(row) : null;
  },

  getChatByGameAndPolity(gameId: string, polityId: string): ChatRecord | null {
    const row = db.prepare('SELECT * FROM chats WHERE game_id = ? AND polity_id = ?').get(gameId, polityId) as any;
    return row ? rowToChat(row) : null;
  },

  /** Messaggi della chat in ordine cronologico. */
  getMessages(chatId: string): ChatMessageRecord[] {
    const rows = db.prepare(
      'SELECT * FROM chat_messages WHERE chat_id = ? ORDER BY created_at ASC, rowid ASC'
    ).all(chatId) as any[];
    return rows.map(rowToMessage);
  },

  /** Aggiunge un messaggio e aggiorna last_message_at della chat. */
  addMessage(
    chatId: string,
    role: ChatRole,
    content: string,
    turn: number = 0,
    senderName?: string,
    gameDate?: string,
  ): ChatMessageRecord {
    const id = shortId();
    const now = new Date().toISOString();
    db.prepare(`
      INSERT INTO chat_messages (id, chat_id, role, content, turn, read, sender_name, game_date, created_at)
      VALUES (?, ?, ?, ?, ?, 0, ?, ?, ?)
    `).run(id, chatId, role, content, turn, senderName || null, gameDate || null, now);
    db.prepare('UPDATE chats SET last_message_at = ? WHERE id = ?').run(now, chatId);

    return { id, chatId, role, content, turn, read: false, createdAt: now, senderName, gameDate };
  },

  /** Snapshot completo per Save/Rewind: chat e messaggi appartengono al ramo. */
  snapshotGameChats(gameId: string): GameChatSnapshot[] {
    return this.getChatsByGame(gameId).map(chat => ({
      chat: {
        id: chat.id,
        gameId: chat.gameId,
        polityId: chat.polityId,
        polityName: chat.polityName,
        polityColor: chat.polityColor,
        participants: chat.participants,
        createdAt: chat.createdAt,
        lastMessageAt: chat.lastMessageAt,
      },
      messages: this.getMessages(chat.id),
    }));
  },

  /** Ripristina la conversazione esatta del checkpoint, eliminando il futuro. */
  replaceGameChats(gameId: string, snapshots: GameChatSnapshot[]): void {
    db.transaction(() => {
      db.prepare('DELETE FROM chat_messages WHERE chat_id IN (SELECT id FROM chats WHERE game_id = ?)').run(gameId);
      db.prepare('DELETE FROM chats WHERE game_id = ?').run(gameId);
      const insertChat = db.prepare(`
        INSERT INTO chats (id, game_id, polity_id, polity_name, polity_color, participants, participant_key, created_at, last_message_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      `);
      const insertMessage = db.prepare(`
        INSERT INTO chat_messages (id, chat_id, role, content, turn, read, sender_name, game_date, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      `);
      snapshots.forEach(({ chat, messages }) => {
        insertChat.run(
          chat.id, gameId, chat.polityId, chat.polityName, chat.polityColor,
          JSON.stringify(chat.participants), participantKey(chat.participants.map(p => p.id)),
          chat.createdAt, chat.lastMessageAt,
        );
        messages.forEach(message => insertMessage.run(
          message.id, chat.id, message.role, message.content, message.turn,
          message.read ? 1 : 0, message.senderName || null, message.gameDate || null, message.createdAt,
        ));
      });
    })();
  },

  /** Segna tutti i messaggi delle politie nella chat come letti. */
  markRead(chatId: string): void {
    db.prepare("UPDATE chat_messages SET read = 1 WHERE chat_id = ? AND role = 'polity' AND read = 0").run(chatId);
  },
};
