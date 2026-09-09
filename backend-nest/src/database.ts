/**
 * World Story — Database
 * ====================
 * SQLite database initialization.
 */

import Database from 'better-sqlite3';
import path from 'path';
import fs from 'fs';

// DB path can be overridden for tests (vitest sets OPEN_PAX_DB_PATH to a temp file)
const DB_PATH = process.env.OPEN_PAX_DB_PATH || path.join(process.cwd(), 'data', 'world-story.db');

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

  // M03 µ4-bis: binding immutabile server-side al preset/catalogo. NULL per mondi legacy.
  try {
    db.exec("ALTER TABLE worlds ADD COLUMN template_id TEXT DEFAULT NULL");
    console.log('[Migration] Added template_id to worlds');
  } catch (e: any) {
    if (!e.message.includes('duplicate column name')) throw e;
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
      queue_version INTEGER NOT NULL DEFAULT 0,
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

  // Versione della sola coda: mutate della coda non avanzano il mondo.
  try {
    db.exec("ALTER TABLE games ADD COLUMN queue_version INTEGER NOT NULL DEFAULT 0");
    console.log('[Migration] Added queue_version to games');
  } catch (e: any) {
    if (!e.message.includes('duplicate column name')) throw e;
  }

  // M06 µ1: feature flag economico IMMUTABILE per partita. Il client non lo
  // invia: viene derivato dal catalogo server-side al create della partita.
  try {
    db.exec("ALTER TABLE games ADD COLUMN economy_mode TEXT NOT NULL DEFAULT 'legacy'");
    db.exec("ALTER TABLE games ADD COLUMN economy_model_version TEXT DEFAULT NULL");
    console.log('[Migration] Added economy mode/version to games');
  } catch (e: any) {
    if (!e.message.includes('duplicate column name')) throw e;
  }

  // F02 passo 1: contatore monotono di mutazioni canoniche del mondo. Ogni
  // checkpoint lo incrementa di una volta: la revisione non deriva più dal
  // turno (fonte di collisioni fra run multi-evento e percorso ordinario).
  try {
    db.exec("ALTER TABLE games ADD COLUMN world_revision INTEGER NOT NULL DEFAULT 0");
    console.log('[Migration] Added world_revision to games');
  } catch (e: any) {
    if (!e.message.includes('duplicate column name')) throw e;
  }

  // F02 passo 1: ramo corrente della partita (§9.4). L’id è quello del ramo
  // principale; rami alternativi e restore cronologico arrivano con F04.
  try {
    db.exec("ALTER TABLE games ADD COLUMN head_branch_id TEXT");
    console.log('[Migration] Added head_branch_id to games');
  } catch (e: any) {
    if (!e.message.includes('duplicate column name')) throw e;
  }

  // M01 passo 4 (MAT18): impronta di contenuto del catalogo simulation/ con
  // cui il mondo è stato generato. Mondi generati PRIMA di M01 hanno NULL:
  // sono riusabili solo da template senza catalogo (comportamento legacy).
  try {
    db.exec("ALTER TABLE worlds ADD COLUMN catalog_fingerprint TEXT DEFAULT NULL");
    console.log('[Migration] Added catalog_fingerprint to worlds');
  } catch (e: any) {
    if (!e.message.includes('duplicate column name')) throw e;
  }

  // M02 µ2 (MAT04): ledger append-only (maestro §6.2, §4.3). Una riga = un
  // movimento con chiave unica (branch_id, effect_id, entry_index): la
  // ripetizione è no-op verificata, NON un secondo pagamento. Denaro in
  // unità monetarie minime, materiali in unità base; delta > 0 passa da
  // from_ref a to_ref (entrambi NULL solo per creazione/uscita).
  db.exec(`
    CREATE TABLE IF NOT EXISTS ledger_entries (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      game_id TEXT NOT NULL,
      branch_id TEXT NOT NULL,
      effect_id TEXT NOT NULL,
      entry_index INTEGER NOT NULL,
      cause TEXT NOT NULL,
      kind TEXT NOT NULL CHECK (kind IN ('money', 'material')),
      unit_id TEXT NOT NULL,
      from_ref TEXT,
      to_ref TEXT,
      owner_ref TEXT,
      delta TEXT NOT NULL,
      at_date TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    )
  `);
  db.exec(
    'CREATE UNIQUE INDEX IF NOT EXISTS idx_ledger_scope_effect_entry ON ledger_entries (branch_id, effect_id, entry_index)',
  );
  db.exec(
    'CREATE INDEX IF NOT EXISTS idx_ledger_branch_unit ON ledger_entries (branch_id, kind, unit_id)',
  );
  // M07 µ4b: provenienza di proprietà dei materiali. Nessun backfill di
  // righe storiche: owner ignoto resta ignoto e non abilita una minStock.
  try { db.exec('ALTER TABLE ledger_entries ADD COLUMN owner_ref TEXT'); }
  catch (error) {
    if (!(error instanceof Error) || !error.message.includes('duplicate column name')) throw error;
  }

  // M06 µ5b: effetti strict generati dal server; la LLM può citare soltanto
  // un effectId staged sullo stesso ramo/revisione, consumabile una volta.
  db.exec(`CREATE TABLE IF NOT EXISTS strict_effect_staging (
    game_id TEXT NOT NULL, branch_id TEXT NOT NULL, anchor_revision INTEGER NOT NULL,
    effect_id TEXT NOT NULL, kind TEXT NOT NULL, payload_json TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'staged', consumed_at TEXT,
    PRIMARY KEY (branch_id, effect_id)
  )`);

  // M06 µ5c-2: stato progetto runtime per tick server-staged/versionati.
  db.exec(`CREATE TABLE IF NOT EXISTS project_runtime_states (
    game_id TEXT NOT NULL, branch_id TEXT NOT NULL, project_id TEXT NOT NULL,
    plan_json TEXT NOT NULL, state_json TEXT NOT NULL, version INTEGER NOT NULL DEFAULT 0,
    PRIMARY KEY (branch_id, project_id)
  )`);

  // M06 µ5d: input canonici server per i producer M04/M05.
  db.exec(`CREATE TABLE IF NOT EXISTS strict_ledger_schedule (
    game_id TEXT NOT NULL, branch_id TEXT NOT NULL, effect_id TEXT NOT NULL,
    entry_json TEXT NOT NULL, due_date TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'scheduled',
    PRIMARY KEY (branch_id, effect_id)
  )`);
  db.exec(`CREATE TABLE IF NOT EXISTS project_work_schedule (
    game_id TEXT NOT NULL, branch_id TEXT NOT NULL, effect_id TEXT NOT NULL,
    project_id TEXT NOT NULL, phase_id TEXT NOT NULL, work_done TEXT NOT NULL,
    due_date TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'scheduled',
    PRIMARY KEY (branch_id, effect_id)
  )`);
  db.exec(`CREATE TABLE IF NOT EXISTS shipment_runtime_states (
    game_id TEXT NOT NULL, branch_id TEXT NOT NULL, shipment_id TEXT NOT NULL,
    shipment_json TEXT NOT NULL, transport_authorized INTEGER NOT NULL,
    version INTEGER NOT NULL DEFAULT 0,
    PRIMARY KEY (branch_id, shipment_id)
  )`);

  // M02 µ3 (MAT05): prenotazioni. `reservations` conserva il residuo
  // committed; `reservation_operations` dà idempotenza a consume/release.
  // Il consume appende anche il ledger nella stessa transazione: nessuna
  // doppia sottrazione. Amount TEXT è sempre IntString, mai SUM() SQL.
  db.exec(`
    CREATE TABLE IF NOT EXISTS reservations (
      game_id TEXT NOT NULL,
      branch_id TEXT NOT NULL,
      reservation_id TEXT NOT NULL,
      kind TEXT NOT NULL CHECK (kind IN ('money', 'material')),
      unit_id TEXT NOT NULL,
      holder_ref TEXT NOT NULL,
      initial_amount TEXT NOT NULL,
      remaining_amount TEXT NOT NULL,
      status TEXT NOT NULL CHECK (status IN ('active', 'consumed', 'released')),
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (branch_id, reservation_id)
    )
  `);
  db.exec(`
    CREATE TABLE IF NOT EXISTS reservation_operations (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      branch_id TEXT NOT NULL,
      reservation_id TEXT NOT NULL,
      operation_id TEXT NOT NULL,
      operation_type TEXT NOT NULL CHECK (operation_type IN ('consume', 'release')),
      amount TEXT NOT NULL,
      ledger_effect_id TEXT,
      ledger_entry_index INTEGER,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      UNIQUE (branch_id, reservation_id, operation_id)
    )
  `);
  db.exec(
    "CREATE INDEX IF NOT EXISTS idx_reservations_available ON reservations (branch_id, kind, unit_id, holder_ref, status)",
  );

  // M02 µ4 (MAT36): finanza separata. Cassa/escrow restano conti money nel
  // ledger; qui vivono autorizzazioni, debiti, flussi datati e loro stato.
  db.exec(`
    CREATE TABLE IF NOT EXISTS finance_appropriations (
      game_id TEXT NOT NULL, branch_id TEXT NOT NULL, appropriation_id TEXT NOT NULL,
      account_ref TEXT NOT NULL, currency_id TEXT NOT NULL, authorized_amount TEXT NOT NULL,
      committed_amount TEXT NOT NULL DEFAULT '0', spent_amount TEXT NOT NULL DEFAULT '0',
      PRIMARY KEY (branch_id, appropriation_id)
    )
  `);
  db.exec(`
    CREATE TABLE IF NOT EXISTS finance_debts (
      game_id TEXT NOT NULL, branch_id TEXT NOT NULL, debt_id TEXT NOT NULL,
      lender_ref TEXT NOT NULL, borrower_ref TEXT NOT NULL, currency_id TEXT NOT NULL,
      limit_amount TEXT NOT NULL, rate_numerator TEXT NOT NULL, rate_denominator TEXT NOT NULL,
      maturity_date TEXT NOT NULL, drawn_amount TEXT NOT NULL DEFAULT '0',
      principal_outstanding TEXT NOT NULL DEFAULT '0', accrued_interest TEXT NOT NULL DEFAULT '0',
      carry_numerator TEXT NOT NULL DEFAULT '0', PRIMARY KEY (branch_id, debt_id)
    )
  `);
  db.exec(`
    CREATE TABLE IF NOT EXISTS finance_escrows (
      game_id TEXT NOT NULL, branch_id TEXT NOT NULL, escrow_id TEXT NOT NULL,
      buyer_ref TEXT NOT NULL, seller_ref TEXT NOT NULL, escrow_ref TEXT NOT NULL,
      currency_id TEXT NOT NULL, amount TEXT NOT NULL, status TEXT NOT NULL CHECK (status IN ('draft','funded','released','refunded')),
      PRIMARY KEY (branch_id, escrow_id)
    )
  `);
  db.exec(`
    CREATE TABLE IF NOT EXISTS finance_cashflows (
      game_id TEXT NOT NULL, branch_id TEXT NOT NULL, cashflow_id TEXT NOT NULL,
      debtor_ref TEXT NOT NULL, creditor_ref TEXT NOT NULL, currency_id TEXT NOT NULL,
      due_date TEXT NOT NULL, amount TEXT NOT NULL, outstanding_amount TEXT NOT NULL,
      legal_priority INTEGER NOT NULL, partial_allowed INTEGER NOT NULL,
      shortage_policy TEXT NOT NULL CHECK (shortage_policy IN ('arrears','default')),
      status TEXT NOT NULL CHECK (status IN ('scheduled','paid','arrears','default')),
      PRIMARY KEY (branch_id, cashflow_id)
    )
  `);
  db.exec(`
    CREATE TABLE IF NOT EXISTS finance_operations (
      id INTEGER PRIMARY KEY AUTOINCREMENT, branch_id TEXT NOT NULL,
      entity_kind TEXT NOT NULL, entity_id TEXT NOT NULL, operation_id TEXT NOT NULL,
      operation_type TEXT NOT NULL, amount TEXT NOT NULL, reference_id TEXT,
      ledger_effect_id TEXT, ledger_entry_index INTEGER, detail TEXT,
      UNIQUE (branch_id, entity_kind, entity_id, operation_id)
    )
  `);
  db.exec("CREATE INDEX IF NOT EXISTS idx_finance_cashflow_due ON finance_cashflows (branch_id, due_date, legal_priority, status)");

  // M07 µ1 (MAT31): mandati di delega (maestro §7.5). `mandates` conserva
  // tetto/periodo/whitelist/fornitori/prezzo e il plafond già consumato;
  // `mandate_executions` dà idempotenza: ogni esecuzione cita mandateId e
  // consuma il plafond UNA volta (chiave unica branch+mandate+execution).
  // Amount TEXT è sempre IntString, mai SUM() SQL.
  db.exec(`
    CREATE TABLE IF NOT EXISTS mandates (
      game_id TEXT NOT NULL,
      branch_id TEXT NOT NULL,
      mandate_id TEXT NOT NULL,
      title TEXT NOT NULL,
      currency_id TEXT NOT NULL,
      ceiling TEXT NOT NULL,
      start_date TEXT NOT NULL,
      end_date TEXT NOT NULL,
      whitelist TEXT NOT NULL,
      suppliers TEXT NOT NULL,
      price_limit TEXT,
      resource_id TEXT,
      min_stock TEXT,
      no_new_debt INTEGER NOT NULL DEFAULT 0,
      spent TEXT NOT NULL DEFAULT '0',
      status TEXT NOT NULL CHECK (status IN ('active', 'expired', 'cancelled')),
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (branch_id, mandate_id)
    )
  `);
  db.exec(`
    CREATE TABLE IF NOT EXISTS mandate_executions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      branch_id TEXT NOT NULL,
      mandate_id TEXT NOT NULL,
      execution_id TEXT NOT NULL,
      action_type TEXT NOT NULL,
      supplier TEXT NOT NULL,
      amount TEXT NOT NULL,
      price TEXT,
      quantity TEXT,
      at_date TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      UNIQUE (branch_id, mandate_id, execution_id)
    )
  `);
  db.exec("CREATE INDEX IF NOT EXISTS idx_mandates_active ON mandates (branch_id, status)");

  // M07 µ4: eccezioni/decisioni generate SOLO dal tick strict quando una
  // scorta minima è sotto soglia. Non sono ordini né autorizzazioni: nessun
  // acquisto automatico in assenza di quantità/prezzo verificati (§7.5).
  db.exec(`
    CREATE TABLE IF NOT EXISTS mandate_decisions (
      game_id TEXT NOT NULL,
      branch_id TEXT NOT NULL,
      mandate_id TEXT NOT NULL,
      decision_kind TEXT NOT NULL CHECK (decision_kind IN ('stock_shortfall_authorized','stock_shortfall_outside_authorization')),
      resource_id TEXT NOT NULL,
      min_stock TEXT NOT NULL,
      available_stock TEXT NOT NULL,
      shortfall TEXT NOT NULL,
      as_of_date TEXT NOT NULL,
      status TEXT NOT NULL CHECK (status IN ('open','acknowledged','resolved')),
      PRIMARY KEY (branch_id, mandate_id)
    )
  `);
  // Upgrade conservativo delle prime build µ4: non esistono due decisioni
  // valide per lo stesso mandato. Un duplicato storico viene riesaminato al
  // tick, senza eseguire azioni; teniamo l'ultima fotografia disponibile.
  db.exec(`DELETE FROM mandate_decisions WHERE rowid NOT IN (
    SELECT MAX(rowid) FROM mandate_decisions GROUP BY branch_id, mandate_id
  )`);
  db.exec('CREATE UNIQUE INDEX IF NOT EXISTS idx_mandate_decision_one_per_mandate ON mandate_decisions (branch_id, mandate_id)');
  db.exec('CREATE INDEX IF NOT EXISTS idx_mandate_decisions_open ON mandate_decisions (game_id, branch_id, status)');

  // F02 passo 1: rami canonici della partita (§9.4). Il checkpoint origine di
  // ogni ramo è immutabile; i rami figli nascono da un checkpoint esistente.
  db.exec(`
    CREATE TABLE IF NOT EXISTS game_branches (
      id TEXT PRIMARY KEY,
      game_id TEXT NOT NULL,
      name TEXT NOT NULL,
      parent_branch_id TEXT,
      origin_checkpoint_id TEXT,
      created_at TEXT NOT NULL,
      FOREIGN KEY (game_id) REFERENCES games(id) ON DELETE CASCADE
    )
  `);

  // F02 passo 1: outbox degli eventi (§9.3). La pubblicazione SSE legge solo
  // eventi prima committati qui con ID stabili: il publisher è separato,
  // ripetibile e non blocca la transazione canonica.
  db.exec(`
    CREATE TABLE IF NOT EXISTS simulation_outbox (
      id TEXT PRIMARY KEY,
      game_id TEXT NOT NULL,
      run_id TEXT NOT NULL,
      event_id TEXT NOT NULL,
      sequence INTEGER NOT NULL,
      payload TEXT NOT NULL,
      delivery_state TEXT NOT NULL DEFAULT 'pending',
      created_at TEXT NOT NULL,
      published_at TEXT,
      FOREIGN KEY (game_id) REFERENCES games(id) ON DELETE CASCADE
    )
  `);
  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_outbox_game_sequence
      ON simulation_outbox(game_id, sequence)
  `);

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
  // F05 µ1: job asincroni del salto — accettazione 202, claim/lease del
  // worker, idempotenza per (game_id, idempotency_key) con hash del payload.
  db.exec(`
    CREATE TABLE IF NOT EXISTS simulation_jobs (
      id TEXT PRIMARY KEY,
      game_id TEXT NOT NULL,
      type TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'queued',
      payload_json TEXT NOT NULL,
      payload_hash TEXT NOT NULL,
      idempotency_key TEXT,
      run_id TEXT,
      lease_owner TEXT,
      lease_expires_at TEXT,
      error TEXT,
      error_name TEXT,
      result_json TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      FOREIGN KEY (game_id) REFERENCES games(id) ON DELETE CASCADE
    )
  `);
  db.exec('CREATE INDEX IF NOT EXISTS idx_jobs_game_status ON simulation_jobs(game_id, status)');
  try { db.exec('CREATE UNIQUE INDEX IF NOT EXISTS idx_jobs_game_key ON simulation_jobs(game_id, idempotency_key)'); } catch (e: any) {
    if (!String(e?.message || '').includes('already exists')) console.warn('[DB] idx_jobs_game_key:', e?.message);
  }
  try { db.exec('ALTER TABLE simulation_jobs ADD COLUMN error_name TEXT'); } catch (e: any) {
    if (!e.message.includes('duplicate column')) throw e;
  }
  try { db.exec('ALTER TABLE simulation_jobs ADD COLUMN result_json TEXT'); } catch (e: any) {
    if (!e.message.includes('duplicate column')) throw e;
  }
  try { db.exec('ALTER TABLE simulation_runs ADD COLUMN checkpoint_id TEXT'); } catch (e: any) {
    if (!e.message.includes('duplicate column')) throw e;
  }
  try { db.exec('ALTER TABLE simulation_runs ADD COLUMN idempotency_key TEXT'); } catch (e: any) {
    if (!e.message.includes('duplicate column')) throw e;
  }
  // F02 passo 1: hash del payload associato a una chiave di idempotenza.
  // Stessa chiave con payload diverso = conflitto (C09), non riuso silenzioso.
  try { db.exec('ALTER TABLE simulation_runs ADD COLUMN idempotency_hash TEXT'); } catch (e: any) {
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
  // F04 §9.4.1: hash semantico del payload — validazione del restore prima
  // della mutazione; catalogo assente o hash incompatibile rifiuta il restore.
  try { db.exec('ALTER TABLE simulation_checkpoints ADD COLUMN content_hash TEXT'); } catch (e: any) {
    if (!e.message.includes('duplicate column')) throw e;
  }
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
      delivery_status TEXT NOT NULL DEFAULT 'queued',
      execution_status TEXT NOT NULL DEFAULT 'not_started',
      FOREIGN KEY (game_id) REFERENCES games(id) ON DELETE CASCADE
    )
  `);
  for (const sql of [
    "ALTER TABLE pending_actions ADD COLUMN delivery_status TEXT NOT NULL DEFAULT 'queued'",
    "ALTER TABLE pending_actions ADD COLUMN execution_status TEXT NOT NULL DEFAULT 'not_started'",
  ]) {
    try { db.exec(sql); } catch (e: any) {
      if (!e.message.includes('duplicate column name')) throw e;
    }
  }
  // Adapter legacy: lo stato unico resta leggibile, ma non è più l'unica
  // fonte della consegna/attuazione nel percorso F01.
  db.exec(`
    UPDATE pending_actions
    SET delivery_status = CASE WHEN status = 'processing' THEN 'issued' WHEN status = 'completed' THEN 'issued' ELSE 'queued' END,
        execution_status = CASE WHEN status = 'processing' THEN 'in_progress' WHEN status = 'completed' THEN 'completed' ELSE 'not_started' END
    WHERE (status = 'processing' AND delivery_status = 'queued' AND execution_status = 'not_started')
       OR (status = 'completed' AND delivery_status = 'queued' AND execution_status = 'not_started')
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
  // F04 §9.4.1: hash semantico del payload del salvataggio.
  try { db.exec('ALTER TABLE saves ADD COLUMN content_hash TEXT'); } catch (e: any) {
    if (!e.message.includes('duplicate column')) throw e;
  }

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

/**
 * F02 passo 2: transazione canonica breve. Tutte le scritture canoniche di un
 * checkpoint (regioni, turno/data, checkpoint, eventi, esiti, chiusura run)
 * devono compiersi nella callback: o tutte o nessuna. Vietato invocare
 * LLM, network o broadcast SSE nella callback: solo DB e mutazioni di RAM.
 * Le transazioni better-sqlite3 annidate (es. nextWorldRevision, bump della
 * coda) diventano savepoint: nessun conflitto.
 */
export function withCanonicalTransaction<T>(fn: () => T): T {
  return db.transaction(fn)();
}
