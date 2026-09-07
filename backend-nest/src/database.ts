/**
 * Open-Pax — Database
 * ====================
 * SQLite database initialization.
 */

import Database from 'better-sqlite3';
import path from 'path';
import fs from 'fs';

// DB path can be overridden for tests (vitest sets OPEN_PAX_DB_PATH to a temp file)
const DB_PATH = process.env.OPEN_PAX_DB_PATH || path.join(process.cwd(), 'data', 'open-pax.db');

// Ensure data directory exists
const dataDir = path.dirname(DB_PATH);
if (!fs.existsSync(dataDir)) {
  fs.mkdirSync(dataDir, { recursive: true });
}

const db = new Database(DB_PATH);

// Enable foreign keys
db.pragma('foreign_keys = ON');

// ==============================================================================
// Schema
// ==============================================================================

export function initDatabase() {
  // Maps table
  db.exec(`
    CREATE TABLE IF NOT EXISTS maps (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      width INTEGER DEFAULT 800,
      height INTEGER DEFAULT 600,
      regions TEXT NOT NULL DEFAULT '[]',
      objects TEXT DEFAULT '[]',
      created_at TEXT DEFAULT CURRENT_TIMESTAMP
    )
  `);

  // Worlds table
  db.exec(`
    CREATE TABLE IF NOT EXISTS worlds (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      description TEXT DEFAULT '',
      start_date TEXT DEFAULT '1951-01-01',
      base_prompt TEXT DEFAULT 'Storia alternativa',
      historical_accuracy REAL DEFAULT 0.8,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT DEFAULT CURRENT_TIMESTAMP
    )
  `);

  // Migration (Этап 5): кастомные правила симуляции пресета (rules.md),
  // сохранённые с миром при генерации из пресет-пакета
  try {
    db.exec("ALTER TABLE worlds ADD COLUMN simulation_rules TEXT DEFAULT NULL");
    console.log('[Migration] Added simulation_rules to worlds');
  } catch (e: any) {
    if (!e.message.includes('duplicate column name')) { /* уже есть */ }
  }

  // Migration: переопределённые промпты ИИ мира (секция "prompts" пресета,
  // JSON-объект {"<механика>": "<текст>"}); NULL — дефолтные промпты
  try {
    db.exec("ALTER TABLE worlds ADD COLUMN prompts TEXT DEFAULT NULL");
    console.log('[Migration] Added prompts to worlds');
  } catch (e: any) {
    if (!e.message.includes('duplicate column name')) { /* уже есть */ }
  }

  // Regions table (world regions)
  db.exec(`
    CREATE TABLE IF NOT EXISTS world_regions (
      id TEXT PRIMARY KEY,
      world_id TEXT NOT NULL,
      name TEXT NOT NULL,
      svg_path TEXT,
      geojson TEXT,
      color TEXT DEFAULT '#888888',
      owner TEXT DEFAULT 'neutral',
      population INTEGER DEFAULT 1000000,
      gdp INTEGER DEFAULT 100,
      military_power INTEGER DEFAULT 100,
      borders TEXT DEFAULT '[]',
      objects TEXT DEFAULT '[]',
      status TEXT DEFAULT 'active',
      FOREIGN KEY (world_id) REFERENCES worlds(id) ON DELETE CASCADE
    )
  `);

  // Migration: Add geojson column to world_regions if it doesn't exist
  try {
    db.exec("ALTER TABLE world_regions ADD COLUMN geojson TEXT");
    console.log('[Migration] Added geojson column to world_regions');
  } catch (e: any) {
    if (!e.message.includes('duplicate column name') && !e.message.includes('no such column')) {
      // Ignore "duplicate column" errors or "no such column" - column already exists
      console.log('[Migration] geojson column check:', e.message);
    }
  }

  // Migration: Add metadata column to world_regions if it doesn't exist
  try {
    db.exec("ALTER TABLE world_regions ADD COLUMN metadata TEXT");
    console.log('[Migration] Added metadata column to world_regions');
  } catch (e: any) {
    if (!e.message.includes('duplicate column name') && !e.message.includes('no such column')) {
      // Ignore duplicate / no-such-column errors
    }
  }

  // Migration: Add flag column to world_regions if it doesn't exist
  try {
    db.exec("ALTER TABLE world_regions ADD COLUMN flag TEXT");
    console.log('[Migration] Added flag column to world_regions');
  } catch (e: any) {
    if (!e.message.includes('duplicate column name') && !e.message.includes('no such column')) {
      // Ignore duplicate / no-such-column errors
    }
  }

  // Country relationships table (allies/enemies per world)
  db.exec(`
    CREATE TABLE IF NOT EXISTS country_relationships (
      id TEXT PRIMARY KEY,
      world_id TEXT NOT NULL,
      from_region_id TEXT NOT NULL,
      to_region_id TEXT NOT NULL,
      relationship TEXT DEFAULT 'neutral',
      FOREIGN KEY (world_id) REFERENCES worlds(id) ON DELETE CASCADE
    )
  `);

  // Migration: dedupe relationships, then add the UNIQUE index that
  // relationshipRepository.bulkUpsert's ON CONFLICT(world_id, from_region_id, to_region_id)
  // requires (without it every upsert threw "ON CONFLICT clause does not match...").
  db.exec(`
    DELETE FROM country_relationships
    WHERE id NOT IN (
      SELECT MIN(id) FROM country_relationships
      GROUP BY world_id, from_region_id, to_region_id
    )
  `);
  db.exec(`
    CREATE UNIQUE INDEX IF NOT EXISTS ux_country_relationships_pair
    ON country_relationships(world_id, from_region_id, to_region_id)
  `);

  // Migration: unified polity-id convention. Region owner is the polity id
  // itself (template worlds: country code like 'USA', stored in `flag`;
  // custom-map worlds keep their 'player' / 'ai-N' ids, which are valid
  // polity ids as-is). Previously owners were 'player' / 'ai-USA' while
  // relationships were seeded with bare codes, so seeded diplomacy never
  // matched engine keys.
  db.exec(`
    UPDATE world_regions SET owner = flag
    WHERE flag IS NOT NULL AND flag != '' AND (owner = 'player' OR owner LIKE 'ai-%')
  `);

  // Games table
  db.exec(`
    CREATE TABLE IF NOT EXISTS games (
      id TEXT PRIMARY KEY,
      world_id TEXT NOT NULL,
      current_turn INTEGER DEFAULT 1,
      current_date TEXT DEFAULT '1951-01-01',
      max_turns INTEGER DEFAULT 100,
      status TEXT DEFAULT 'playing',
      created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (world_id) REFERENCES worlds(id) ON DELETE CASCADE
    )
  `);

  // Migration: Add current_date to games table if it doesn't exist
  try {
    db.exec("ALTER TABLE games ADD COLUMN current_date TEXT DEFAULT '1951-01-01'");
    console.log('[Migration] Added current_date to games');
  } catch (e: any) {
    if (!e.message.includes('duplicate column name') && !e.message.includes('no such column')) {
      console.log('[Migration] current_date column check:', e.message);
    }
  }

  // Migration (Этап 2): сложность игры (story/easy/normal/hard/very_hard)
  try {
    db.exec("ALTER TABLE games ADD COLUMN difficulty TEXT DEFAULT 'normal'");
    console.log('[Migration] Added difficulty to games');
  } catch (e: any) {
    if (!e.message.includes('duplicate column name')) { /* уже есть */ }
  }

  // Migration (Этап 2): консолидированная история + до какого раунда она покрывает
  try {
    db.exec("ALTER TABLE games ADD COLUMN consolidated_history TEXT DEFAULT ''");
    db.exec("ALTER TABLE games ADD COLUMN consolidated_up_to INTEGER DEFAULT 0");
    console.log('[Migration] Added consolidation columns to games');
  } catch (e: any) {
    if (!e.message.includes('duplicate column name')) { /* уже есть */ }
  }

  // Players table
  db.exec(`
    CREATE TABLE IF NOT EXISTS players (
      id TEXT PRIMARY KEY,
      game_id TEXT NOT NULL,
      name TEXT NOT NULL,
      region_id TEXT NOT NULL,
      color TEXT DEFAULT '#FF0000',
      FOREIGN KEY (game_id) REFERENCES games(id) ON DELETE CASCADE
    )
  `);

  // Migration: players.polity_id — the polity the player controls.
  // Needed because region owners change hands (conquest), so the player's
  // polity cannot be derived from region ownership after the fact.
  try {
    db.exec("ALTER TABLE players ADD COLUMN polity_id TEXT");
    console.log('[Migration] Added polity_id to players');
  } catch (e: any) {
    if (!e.message.includes('duplicate column name') && !e.message.includes('no such column')) {
      // Column already exists
    }
  }
  // Backfill polity_id for existing players from their home region's owner.
  db.exec(`
    UPDATE players SET polity_id = (
      SELECT wr.owner FROM world_regions wr
      JOIN games g ON g.world_id = wr.world_id
      WHERE wr.id = players.region_id AND g.id = players.game_id
    )
    WHERE polity_id IS NULL
  `);

  // Actions table
  db.exec(`
    CREATE TABLE IF NOT EXISTS actions (
      id TEXT PRIMARY KEY,
      game_id TEXT NOT NULL,
      player_id TEXT NOT NULL,
      turn INTEGER NOT NULL,
      text TEXT NOT NULL,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (game_id) REFERENCES games(id) ON DELETE CASCADE
    )
  `);

  // Run di simulazione: audit persistente di un salto, anche quando il lotto
  // è vuoto oppure si arresta senza eventi.
  db.exec(`
    CREATE TABLE IF NOT EXISTS simulation_runs (
      id TEXT PRIMARY KEY,
      game_id TEXT NOT NULL,
      mode TEXT NOT NULL,
      idempotency_key TEXT,
      status TEXT NOT NULL,
      start_date TEXT NOT NULL,
      target_date TEXT,
      checkpoint_date TEXT,
      checkpoint_id TEXT,
      turn INTEGER,
      error TEXT,
      created_at TEXT NOT NULL,
      completed_at TEXT,
      FOREIGN KEY (game_id) REFERENCES games(id) ON DELETE CASCADE
    )
  `);
  db.exec('CREATE INDEX IF NOT EXISTS idx_simulation_runs_game_created ON simulation_runs(game_id, created_at DESC)');
  try { db.exec('ALTER TABLE simulation_runs ADD COLUMN checkpoint_id TEXT'); } catch (e: any) {
    if (!e.message.includes('duplicate column')) throw e;
  }
  try { db.exec('ALTER TABLE simulation_runs ADD COLUMN idempotency_key TEXT'); } catch (e: any) {
    if (!e.message.includes('duplicate column')) throw e;
  }
  // §9.3: playback «un evento alla volta» per i salti fissi. Le proposte
  // future non applicate restano nel run (non nel checkpoint) finché il
  // giocatore non le autorizza con «Continua».
  try { db.exec('ALTER TABLE simulation_runs ADD COLUMN pending_state TEXT'); } catch (e: any) {
    if (!e.message.includes('duplicate column')) throw e;
  }
  db.exec('CREATE UNIQUE INDEX IF NOT EXISTS idx_simulation_runs_idempotency ON simulation_runs(game_id, idempotency_key) WHERE idempotency_key IS NOT NULL');
  db.exec(`
    CREATE TABLE IF NOT EXISTS simulation_checkpoints (
      id TEXT PRIMARY KEY,
      run_id TEXT NOT NULL,
      game_id TEXT NOT NULL,
      revision INTEGER NOT NULL,
      turn INTEGER NOT NULL,
      game_date TEXT NOT NULL,
      data TEXT NOT NULL,
      created_at TEXT NOT NULL,
      FOREIGN KEY (run_id) REFERENCES simulation_runs(id) ON DELETE CASCADE,
      FOREIGN KEY (game_id) REFERENCES games(id) ON DELETE CASCADE
    )
  `);
  db.exec('CREATE INDEX IF NOT EXISTS idx_simulation_checkpoints_run ON simulation_checkpoints(run_id, revision DESC)');
  db.exec(`
    CREATE TABLE IF NOT EXISTS simulation_events (
      id TEXT PRIMARY KEY,
      run_id TEXT NOT NULL,
      checkpoint_id TEXT NOT NULL,
      game_id TEXT NOT NULL,
      game_date TEXT NOT NULL,
      headline TEXT NOT NULL,
      detail TEXT NOT NULL,
      source TEXT NOT NULL,
      source_action_ids TEXT NOT NULL DEFAULT '[]',
      FOREIGN KEY (run_id) REFERENCES simulation_runs(id) ON DELETE CASCADE,
      FOREIGN KEY (checkpoint_id) REFERENCES simulation_checkpoints(id) ON DELETE CASCADE,
      FOREIGN KEY (game_id) REFERENCES games(id) ON DELETE CASCADE
    )
  `);
  db.exec('CREATE INDEX IF NOT EXISTS idx_simulation_events_run_date ON simulation_events(run_id, game_date, id)');
  db.exec(`
    CREATE TABLE IF NOT EXISTS simulation_action_outcomes (
      id TEXT PRIMARY KEY,
      run_id TEXT NOT NULL,
      game_id TEXT NOT NULL,
      action_id TEXT NOT NULL,
      status TEXT NOT NULL,
      summary TEXT NOT NULL,
      event_headlines TEXT NOT NULL DEFAULT '[]',
      FOREIGN KEY (run_id) REFERENCES simulation_runs(id) ON DELETE CASCADE,
      FOREIGN KEY (game_id) REFERENCES games(id) ON DELETE CASCADE
    )
  `);
  db.exec('CREATE UNIQUE INDEX IF NOT EXISTS idx_simulation_action_outcomes_run_action ON simulation_action_outcomes(run_id, action_id)');
  db.exec(`
    CREATE TABLE IF NOT EXISTS ongoing_processes (
      id TEXT PRIMARY KEY,
      game_id TEXT NOT NULL,
      source_action_id TEXT NOT NULL,
      source_run_id TEXT NOT NULL,
      title TEXT NOT NULL,
      summary TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'ongoing',
      started_date TEXT NOT NULL,
      expected_date TEXT,
      updated_at TEXT NOT NULL,
      FOREIGN KEY (game_id) REFERENCES games(id) ON DELETE CASCADE,
      FOREIGN KEY (source_run_id) REFERENCES simulation_runs(id) ON DELETE CASCADE
    )
  `);
  db.exec('CREATE UNIQUE INDEX IF NOT EXISTS idx_ongoing_processes_action ON ongoing_processes(game_id, source_action_id)');

  // Stato dinamico delle regioni di una singola partita. Geometria e metadati
  // restano nel world, ma proprietario/economia/oggetti non sono condivisi.
  db.exec(`
    CREATE TABLE IF NOT EXISTS game_regions (
      game_id TEXT NOT NULL,
      region_id TEXT NOT NULL,
      owner TEXT NOT NULL,
      color TEXT NOT NULL,
      population REAL NOT NULL,
      gdp REAL NOT NULL,
      military_power REAL NOT NULL,
      objects TEXT NOT NULL DEFAULT '[]',
      PRIMARY KEY (game_id, region_id),
      FOREIGN KEY (game_id) REFERENCES games(id) ON DELETE CASCADE
    )
  `);

  // Relazioni diplomatiche di una singola partita. Le relazioni del world
  // restano il baseline del preset e non possono essere mutate da un game.
  db.exec(`
    CREATE TABLE IF NOT EXISTS game_relationships (
      game_id TEXT NOT NULL,
      from_polity_id TEXT NOT NULL,
      to_polity_id TEXT NOT NULL,
      relationship TEXT NOT NULL,
      PRIMARY KEY (game_id, from_polity_id, to_polity_id),
      FOREIGN KEY (game_id) REFERENCES games(id) ON DELETE CASCADE
    )
  `);

  // Ordini non ancora risolti: devono sopravvivere al riavvio del backend e
  // non possono vivere soltanto nella memoria della GameSession.
  db.exec(`
    CREATE TABLE IF NOT EXISTS pending_actions (
      id TEXT PRIMARY KEY,
      game_id TEXT NOT NULL,
      text TEXT NOT NULL,
      created_at TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'pending',
      FOREIGN KEY (game_id) REFERENCES games(id) ON DELETE CASCADE
    )
  `);
  db.exec('CREATE INDEX IF NOT EXISTS idx_pending_actions_game_status ON pending_actions(game_id, status, created_at)');

  // Turn results table
  db.exec(`
    CREATE TABLE IF NOT EXISTS turn_results (
      id TEXT PRIMARY KEY,
      game_id TEXT NOT NULL,
      turn INTEGER NOT NULL,
      narration TEXT,
      country_response TEXT,
      events TEXT DEFAULT '[]',
      timeline_events TEXT DEFAULT '[]',
      date TEXT,
      FOREIGN KEY (game_id) REFERENCES games(id) ON DELETE CASCADE
    )
  `);

  db.exec(`
    CREATE TABLE IF NOT EXISTS saves (
      id TEXT PRIMARY KEY,
      game_id TEXT NOT NULL,
      name TEXT NOT NULL,
      current_turn INTEGER DEFAULT 1,
      current_date TEXT DEFAULT '1951-01-01',
      data TEXT,
      saved_at TEXT NOT NULL,
      FOREIGN KEY (game_id) REFERENCES games(id) ON DELETE CASCADE
    )
  `);

  // Migration: Add current_turn and current_date if they don't exist
  try {
    db.exec("ALTER TABLE saves ADD COLUMN current_turn INTEGER DEFAULT 1");
    console.log('[Migration] Added current_turn to saves');
  } catch (e: any) {
    if (!e.message.includes('duplicate column')) {
      // Column might already exist or SQLite version doesn't support this
    }
  }
  try {
    db.exec("ALTER TABLE saves ADD COLUMN current_date TEXT DEFAULT '1951-01-01'");
    console.log('[Migration] Added current_date to saves');
  } catch (e: any) {
    if (!e.message.includes('duplicate column')) {
      // Column might already exist
    }
  }

  // Timeline: data di gioco e dettagli degli eventi raggiunti a fine turno.
  for (const sql of [
    "ALTER TABLE turn_results ADD COLUMN date TEXT",
    "ALTER TABLE turn_results ADD COLUMN timeline_events TEXT DEFAULT '[]'",
  ]) {
    try {
      db.exec(sql);
    } catch (e: any) {
      if (!e.message.includes('duplicate column')) throw e;
    }
  }

  // Chat diplomatiche. participant_key è l'insieme canonico dei partecipanti
  // (giocatore compreso): consente più gruppi che condividono una nazione.
  db.exec(`
    CREATE TABLE IF NOT EXISTS chats (
      id TEXT PRIMARY KEY,
      game_id TEXT NOT NULL,
      polity_id TEXT NOT NULL,
      polity_name TEXT NOT NULL,
      polity_color TEXT DEFAULT '#888888',
      participants TEXT NOT NULL DEFAULT '[]',
      participant_key TEXT NOT NULL DEFAULT '',
      created_at TEXT,
      last_message_at TEXT,
      FOREIGN KEY(game_id) REFERENCES games(id) ON DELETE CASCADE
    )
  `);

  db.exec(`
    CREATE TABLE IF NOT EXISTS chat_messages (
      id TEXT PRIMARY KEY,
      chat_id TEXT NOT NULL,
      role TEXT NOT NULL,
      content TEXT NOT NULL,
      turn INTEGER DEFAULT 0,
      read INTEGER DEFAULT 0,
      sender_name TEXT,
      game_date TEXT,
      created_at TEXT,
      FOREIGN KEY(chat_id) REFERENCES chats(id) ON DELETE CASCADE
    )
  `);

  // Upgrade di database creati dalla vecchia chat uno-a-uno.
  for (const sql of [
    "ALTER TABLE chats ADD COLUMN participants TEXT NOT NULL DEFAULT '[]'",
    "ALTER TABLE chats ADD COLUMN participant_key TEXT NOT NULL DEFAULT ''",
    "ALTER TABLE chat_messages ADD COLUMN sender_name TEXT",
    "ALTER TABLE chat_messages ADD COLUMN game_date TEXT",
  ]) {
    try {
      db.exec(sql);
    } catch (e: any) {
      if (!e.message.includes('duplicate column')) throw e;
    }
  }

  // La vecchia tabella aveva UNIQUE(game_id, polity_id), che impediva chat
  // [A,B] e [A,C]. SQLite non può rimuovere il vincolo: ricreiamo la tabella.
  const chatSchema = (db.prepare(
    "SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'chats'"
  ).get() as { sql?: string } | undefined)?.sql || '';
  if (/UNIQUE\s*\(\s*game_id\s*,\s*polity_id\s*\)/i.test(chatSchema)) {
    db.pragma('foreign_keys = OFF');
    try {
      db.exec(`
        BEGIN;
        CREATE TABLE chats_v2 (
          id TEXT PRIMARY KEY,
          game_id TEXT NOT NULL,
          polity_id TEXT NOT NULL,
          polity_name TEXT NOT NULL,
          polity_color TEXT DEFAULT '#888888',
          participants TEXT NOT NULL DEFAULT '[]',
          participant_key TEXT NOT NULL DEFAULT '',
          created_at TEXT,
          last_message_at TEXT,
          FOREIGN KEY(game_id) REFERENCES games(id) ON DELETE CASCADE
        );
        INSERT INTO chats_v2
          (id, game_id, polity_id, polity_name, polity_color, participants, participant_key, created_at, last_message_at)
        SELECT id, game_id, polity_id, polity_name, polity_color,
          COALESCE(participants, '[]'), COALESCE(participant_key, ''), created_at, last_message_at
        FROM chats;
        DROP TABLE chats;
        ALTER TABLE chats_v2 RENAME TO chats;
        COMMIT;
      `);
      console.log('[Migration] Removed legacy chats(game_id, polity_id) uniqueness');
    } catch (e) {
      if (db.inTransaction) db.exec('ROLLBACK');
      throw e;
    } finally {
      db.pragma('foreign_keys = ON');
    }
  }

  // Normalizza participants includendo sempre il giocatore e calcola la chiave
  // canonica. Questo backfill rende utilizzabili anche le chat già esistenti.
  const chatRows = db.prepare('SELECT * FROM chats ORDER BY rowid ASC').all() as any[];
  const canonicalByGameAndKey = new Map<string, string>();
  for (const row of chatRows) {
    let participants: any[] = [];
    try {
      const parsed = JSON.parse(row.participants || '[]');
      if (Array.isArray(parsed)) participants = parsed;
    } catch { /* fallback sotto */ }

    const player = db.prepare(
      'SELECT name, color, polity_id FROM players WHERE game_id = ? ORDER BY rowid ASC LIMIT 1'
    ).get(row.game_id) as any;
    const playerId = String(player?.polity_id || 'player');
    const normalized = [
      { id: playerId, name: String(player?.name || playerId), color: String(player?.color || '#667eea'), role: 'player' },
      ...participants.map(p => ({
        id: String(p?.id || ''),
        name: String(p?.name || p?.id || ''),
        color: String(p?.color || row.polity_color || '#888888'),
        role: p?.role === 'player' || String(p?.id || '') === playerId ? 'player' : 'polity',
      })),
      { id: String(row.polity_id), name: String(row.polity_name), color: String(row.polity_color || '#888888'), role: 'polity' },
    ].filter(p => p.id);
    const deduped = [...new Map(normalized.map(p => [p.id, p])).values()];
    const participantKey = deduped.map(p => p.id).sort().join('|');
    const duplicateKey = `${row.game_id}\u0000${participantKey}`;
    const canonicalId = canonicalByGameAndKey.get(duplicateKey);

    if (canonicalId) {
      db.prepare('UPDATE chat_messages SET chat_id = ? WHERE chat_id = ?').run(canonicalId, row.id);
      db.prepare(`
        UPDATE chats SET last_message_at = MAX(COALESCE(last_message_at, ''), COALESCE(?, '')) WHERE id = ?
      `).run(row.last_message_at, canonicalId);
      db.prepare('DELETE FROM chats WHERE id = ?').run(row.id);
      continue;
    }

    canonicalByGameAndKey.set(duplicateKey, row.id);
    db.prepare('UPDATE chats SET participants = ?, participant_key = ? WHERE id = ?')
      .run(JSON.stringify(deduped), participantKey, row.id);
  }

  db.exec(`
    CREATE UNIQUE INDEX IF NOT EXISTS ux_chats_participants
    ON chats(game_id, participant_key)
  `);

  console.log('✅ Database initialized');
}

export default db;
