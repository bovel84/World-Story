/**
 * World Story — Chat Repository
 * ==========================
 * Chat diplomatiche del giocatore con le politie.
 * Supporta chat uno-a-uno e di GRUPPO: `participants` contiene l'elenco
 * completo degli interlocutori [{id, name, color}]; `polity_id` resta il
 * partecipante principale (compatibilità con UNIQUE(game_id, polity_id)).
 */

import db from '../database';
import { shortId } from '../utils/short-id';
import { canonicalParticipantKey } from '../core/chat/threads';

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
  /** Chiave canonica dell'insieme di interlocutori (colonna participant_key) */
  participantKey: string;
  /** Titolo breve della discussione (es. il tema dell'evento che l'ha aperta) */
  subject: string | null;
  /** Una discussione è archiviata quando ne nasce una nuova con gli stessi interlocutori */
  archived: boolean;
  archivedAt: string | null;
  createdAt: string;
  lastMessageAt: string | null;
}

/** Riga dell'elenco: con ultimo messaggio e contatore unread */
export interface ChatSummary extends ChatRecord {
  lastMessage: string | null;
  /** Data del mondo dell'ultimo messaggio — per ordinare e datare l'elenco. */
  lastMessageGameDate: string | null;
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
  /**
   * Sequenza monotona di **inserimento** (SQLite `rowid` della riga): è la
   * stessa chiave con cui il server rompe i pareggi
   * (`ORDER BY created_at ASC, rowid ASC`). Serve al client come tie-breaker
   * **stabile e deterministico** fra messaggi dello stesso istante del mondo
   * (stessa `gameDate` e stesso `turn`), senza dipendere dall'ordine di arrivo.
   * Non richiede alcuna migrazione: `rowid` esiste già.
   */
  seq?: number;
}

function participantKey(ids: string[]): string {
  return canonicalParticipantKey(ids);
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
    participantKey: row.participant_key || '',
    subject: row.subject || null,
    archived: !!row.archived,
    archivedAt: row.archived_at || null,
    createdAt: row.created_at,
    lastMessageAt: row.last_message_at || null,
  };
}

export interface GameChatSnapshot {
  chat: ChatRecord;
  messages: ChatMessageRecord[];
}

function rowToMessage(row: any): ChatMessageRecord {
  const seq = Number(row.seq);
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
    ...(Number.isFinite(seq) ? { seq } : {}),
  };
}

export const chatRepository = {
  /**
   * Crea una NUOVA discussione. Ogni discussione è una chat distinta: con gli
   * stessi interlocutori le precedenti vanno in archivio (vedi
   * `archiveChatsForParticipants`). Se `dedupeKey` è indicata, un secondo
   * tentativo per lo stesso evento/turno restituisce la chat già creata invece
   * di duplicarla.
   */
  createChat(chat: {
    id: string;
    gameId: string;
    polityId: string;
    polityName: string;
    polityColor?: string;
    participants?: ChatParticipant[];
    subject?: string;
    dedupeKey?: string;
  }): ChatRecord {
    const now = new Date().toISOString();
    const participants = chat.participants && chat.participants.length > 0
      ? chat.participants
      : [{ id: chat.polityId, name: chat.polityName, color: chat.polityColor || '#888888', role: 'polity' as const }];
    const key = participantKey(participants.map(p => p.id));
    const subject = (chat.subject || '').trim() || null;
    db.prepare(`
      INSERT OR IGNORE INTO chats
        (id, game_id, polity_id, polity_name, polity_color, participants, participant_key,
         subject, dedupe_key, archived, archived_at, created_at, last_message_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 0, NULL, ?, NULL)
    `).run(
      chat.id,
      chat.gameId,
      chat.polityId,
      chat.polityName,
      chat.polityColor || '#888888',
      JSON.stringify(participants),
      key,
      subject,
      chat.dedupeKey || null,
      now,
    );

    const row = chat.dedupeKey
      ? db.prepare('SELECT * FROM chats WHERE game_id = ? AND dedupe_key = ?').get(chat.gameId, chat.dedupeKey) as any
      : db.prepare('SELECT * FROM chats WHERE id = ?').get(chat.id) as any;
    return rowToChat(row);
  },

  /** Chat già creata per lo stesso evento/turno (idempotenza dei ritentativi). */
  getChatByDedupeKey(gameId: string, dedupeKey: string): ChatRecord | null {
    const row = db.prepare('SELECT * FROM chats WHERE game_id = ? AND dedupe_key = ?')
      .get(gameId, dedupeKey) as any;
    return row ? rowToChat(row) : null;
  },

  /**
   * Bozza ancora vuota con lo stesso insieme di interlocutori (nessun messaggio).
   * Serve a non moltiplicare i canali quando il giocatore apre due volte la
   * stessa trattativa prima di scrivere.
   */
  getEmptyChatByParticipants(gameId: string, ids: string[]): ChatRecord | null {
    const row = db.prepare(`
      SELECT c.* FROM chats c
      WHERE c.game_id = ? AND c.participant_key = ? AND c.archived = 0
        AND NOT EXISTS (SELECT 1 FROM chat_messages m WHERE m.chat_id = c.id)
      ORDER BY c.created_at DESC LIMIT 1
    `).get(gameId, participantKey(ids)) as any;
    return row ? rowToChat(row) : null;
  },

  /** Archivia le discussioni precedenti con lo stesso insieme di interlocutori. */
  archiveChatsForParticipants(gameId: string, ids: string[], exceptChatId?: string): string[] {
    const now = new Date().toISOString();
    const rows = db.prepare(`
      SELECT id FROM chats
      WHERE game_id = ? AND participant_key = ? AND archived = 0 AND id != ?
    `).all(gameId, participantKey(ids), exceptChatId || '') as any[];
    const idsToArchive = rows.map(row => String(row.id));
    if (idsToArchive.length > 0) {
      const placeholders = idsToArchive.map(() => '?').join(', ');
      db.prepare(`UPDATE chats SET archived = 1, archived_at = ? WHERE id IN (${placeholders})`)
        .run(now, ...idsToArchive);
    }
    return idsToArchive;
  },

  /** Archivia una singola discussione (comando esplicito del giocatore). */
  archiveChat(chatId: string): void {
    db.prepare('UPDATE chats SET archived = 1, archived_at = ? WHERE id = ?')
      .run(new Date().toISOString(), chatId);
  },

  /** Riapre una discussione archiviata (torna nell'elenco attivo). */
  unarchiveChat(chatId: string): void {
    db.prepare('UPDATE chats SET archived = 0, archived_at = NULL WHERE id = ?').run(chatId);
  },

  /** Trova una chat del gioco i cui partecipanti coincidono esattamente. */
  getChatByParticipantIds(gameId: string, ids: string[]): ChatRecord | null {
    const row = db.prepare('SELECT * FROM chats WHERE game_id = ? AND participant_key = ?')
      .get(gameId, participantKey(ids)) as any;
    return row ? rowToChat(row) : null;
  },

  /** Список чатов игры, свежие сверху, с последним сообщением и unread. */
  getChatsByGame(gameId: string, includeArchived = false): ChatSummary[] {
    const rows = db.prepare(`
      SELECT
        c.*,
        (SELECT m.content FROM chat_messages m
          WHERE m.chat_id = c.id
          ORDER BY m.created_at DESC, m.rowid DESC LIMIT 1) AS last_message,
        (SELECT m.game_date FROM chat_messages m
          WHERE m.chat_id = c.id
          ORDER BY m.created_at DESC, m.rowid DESC LIMIT 1) AS last_message_game_date,
        (SELECT COUNT(*) FROM chat_messages m
          WHERE m.chat_id = c.id AND m.role = 'polity' AND m.read = 0) AS unread
      FROM chats c
      WHERE c.game_id = ?${includeArchived ? '' : ' AND c.archived = 0'}
      ORDER BY COALESCE(c.last_message_at, c.created_at) DESC
    `).all(gameId) as any[];

    return rows.map(row => ({
      ...rowToChat(row),
      lastMessage: row.last_message || null,
      lastMessageGameDate: row.last_message_game_date || null,
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

  /**
   * Messaggi della chat in ordine cronologico di **inserimento**: `created_at`
   * con `rowid` come tie-breaker stabile. `seq` esposto al client è lo stesso
   * `rowid`, così l'ordinamento del client può essere identico a quello del
   * server anche quando più messaggi condividono la data del mondo.
   */
  getMessages(chatId: string): ChatMessageRecord[] {
    const rows = db.prepare(
      'SELECT *, rowid AS seq FROM chat_messages WHERE chat_id = ? ORDER BY created_at ASC, rowid ASC'
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
    const info = db.prepare(`
      INSERT INTO chat_messages (id, chat_id, role, content, turn, read, sender_name, game_date, created_at)
      VALUES (?, ?, ?, ?, ?, 0, ?, ?, ?)
    `).run(id, chatId, role, content, turn, senderName || null, gameDate || null, now);
    db.prepare('UPDATE chats SET last_message_at = ? WHERE id = ?').run(now, chatId);

    // `seq` = rowid appena assegnato: la stessa sequenza che ordina il thread
    // sul server, esposta al client (nessuna colonna nuova, nessuna migrazione).
    const seq = Number(info.lastInsertRowid);
    return {
      id, chatId, role, content, turn, read: false, createdAt: now, senderName, gameDate,
      ...(Number.isFinite(seq) ? { seq } : {}),
    };
  },

  /** Snapshot completo per Save/Rewind: chat e messaggi appartengono al ramo. */
  snapshotGameChats(gameId: string): GameChatSnapshot[] {
    return this.getChatsByGame(gameId, true).map(chat => ({
      chat: {
        id: chat.id,
        gameId: chat.gameId,
        polityId: chat.polityId,
        polityName: chat.polityName,
        polityColor: chat.polityColor,
        participants: chat.participants,
        participantKey: chat.participantKey,
        subject: chat.subject,
        archived: chat.archived,
        archivedAt: chat.archivedAt,
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
        INSERT INTO chats (id, game_id, polity_id, polity_name, polity_color, participants, participant_key,
                           subject, dedupe_key, archived, archived_at, created_at, last_message_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, NULL, ?, ?, ?, ?)
      `);
      const insertMessage = db.prepare(`
        INSERT INTO chat_messages (id, chat_id, role, content, turn, read, sender_name, game_date, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      `);
      snapshots.forEach(({ chat, messages }) => {
        insertChat.run(
          chat.id, gameId, chat.polityId, chat.polityName, chat.polityColor,
          JSON.stringify(chat.participants), participantKey(chat.participants.map(p => p.id)),
          chat.subject || null, chat.archived ? 1 : 0, chat.archivedAt || null,
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
