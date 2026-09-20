/**
 * World Story — Military Persistence (azioni multi-authority)
 * ==========================================================
 *
 * Una azione militare può toccare **tre** authority canoniche in un colpo solo:
 *
 * | authority | dove vive |
 * |---|---|
 * | riserva addestrata | `game_operational_objects` (`kind = 'personnel'`, `object_id = polityId`) |
 * | reparti | `game_operational_objects` (`kind = 'unit'`) |
 * | arsenale/deposito | `game_arsenals` (`game_id`, `polity_id`) |
 *
 * Scriverle con tre chiamate separate non è una transazione: se la seconda
 * fallisce resta uno stato **parziale** (riserva calata, reparto invariato,
 * deposito calato) che rompe le invarianti di conservazione. Questo modulo
 * espone l'unico punto in cui quelle tre scritture avvengono **insieme**, in
 * una sola transazione better-sqlite3.
 *
 * Regole di progetto
 * ------------------
 * 1. **Solo persistenza**: qui non si ricalcola nessun numero. Validazione e
 *    contabilità restano di `MilitaryService` (`transferMenToArmy`,
 *    `transferEquipment`, `refreshUnit`): il repository scrive ciò che riceve.
 * 2. **Strict path**: nessun `try/catch` con `warn`-and-continue (a differenza
 *    dei salvataggi opportunistici dello store). Un errore **rilancia** e la
 *    transazione fa rollback: il chiamante non può credere riuscita una
 *    scrittura parziale.
 * 3. **Nessuna transazione annidata**: la transazione è una sola e gli
 *    statement sono semplici (nessun `replaceKind`, che ne aprirebbe una
 *    propria). Il `replace` dei reparti è quindi riprodotto qui con statement
 *    condivisi, con la **stessa** semantica (upsert dei presenti + rimozione
 *    dei mancanti per quel `kind`).
 * 4. `recorded_at` è un timbro di scrittura: non entra in nessun hash semantico.
 */

import db from '../database';

/** Richiesta di ricostituzione atomica di un reparto. */
export interface MilitaryReconstitutionWrite {
  gameId: string;
  /** Polity che possiede riserva, reparti e arsenale (chiave delle tre righe). */
  polityId: string;
  /**
   * Stato **completo** della riserva addestrata (formato attuale, nessuna
   * migrazione). Se **assente** la riserva non viene toccata da questa azione
   * (es. ricostituzione dei soli pezzi): l'atomità vale per ciò che si scrive.
   */
  personnel?: Record<string, unknown>;
  /** Reparti **completi** dopo l'azione: replace del `kind`, non UPDATE singolo. */
  units: Array<{ id: string; data: Record<string, unknown> }>;
  /** Deposito/arsenale completo dopo l'azione. */
  arsenal: Record<string, number>;
  turn: number;
  date: string | null;
}

export const militaryPersistenceRepository = {
  /**
   * Persiste in **una sola transazione** la riserva, i reparti e l'arsenale.
   *
   * Se una qualunque delle scritture fallisce (vincolo, disco, trigger) la
   * transazione viene annullata: nessuna delle tre authority cambia. Il
   * chiamante deve aggiornare le proprie cache **solo dopo** il ritorno.
   */
  reconstitute: (input: MilitaryReconstitutionWrite): void => {
    const now = new Date().toISOString();
    const upsertObject = db.prepare(`
      INSERT INTO game_operational_objects (game_id, object_id, kind, data, recorded_at)
      VALUES (?, ?, ?, ?, ?)
      ON CONFLICT(game_id, object_id) DO UPDATE SET
        kind = excluded.kind, data = excluded.data, recorded_at = excluded.recorded_at
    `);
    const removeObject = db.prepare('DELETE FROM game_operational_objects WHERE game_id = ? AND object_id = ?');
    const listUnitIds = db.prepare("SELECT object_id FROM game_operational_objects WHERE game_id = ? AND kind = 'unit'");
    const upsertArsenal = db.prepare(`
      INSERT INTO game_arsenals (game_id, polity_id, units, updated_turn, updated_date, recorded_at)
      VALUES (?, ?, ?, ?, ?, ?)
      ON CONFLICT(game_id, polity_id) DO UPDATE SET
        units = excluded.units, updated_turn = excluded.updated_turn,
        updated_date = excluded.updated_date, recorded_at = excluded.recorded_at
    `);
    const ids = new Set(input.units.map(row => String(row.id)));
    const commit = db.transaction(() => {
      // 1) riserva addestrata (solo se l'azione la cambia).
      if (input.personnel !== undefined) {
        upsertObject.run(input.gameId, input.polityId, 'personnel', JSON.stringify(input.personnel), now);
      }
      // 2) reparti: replace del kind (upsert dei presenti, rimozione dei mancanti).
      for (const row of input.units) {
        upsertObject.run(input.gameId, String(row.id), 'unit', JSON.stringify(row.data ?? {}), now);
      }
      for (const existing of listUnitIds.all(input.gameId) as Array<{ object_id: string }>) {
        if (!ids.has(String(existing.object_id))) removeObject.run(input.gameId, String(existing.object_id));
      }
      // 3) arsenale/deposito.
      upsertArsenal.run(
        input.gameId, input.polityId, JSON.stringify(input.arsenal ?? {}),
        input.turn, input.date, now,
      );
    });
    // Nessun catch: un errore qui è un errore del chiamante, con rollback già fatto.
    commit();
  },
  /**
   * P6 — ordine/progresso di movimento. Il set globale dei reparti viene
   * persistito in modalità strict; all'emissione dell'ordine anche il pagamento
   * del costo entra nella stessa transazione. Durante gli hop `resource` è
   * assente, quindi nessun costo può essere riapplicato.
   */
  persistMovement: (input: {
    gameId: string;
    units: Array<{ id: string; data: Record<string, unknown> }>;
    resource?: {
      polityId: string;
      stock: Record<string, unknown>;
      turn: number;
      date: string | null;
    };
  }): void => {
    const now = new Date().toISOString();
    const upsertObject = db.prepare(`
      INSERT INTO game_operational_objects (game_id, object_id, kind, data, recorded_at)
      VALUES (?, ?, 'unit', ?, ?)
      ON CONFLICT(game_id, object_id) DO UPDATE SET
        kind = excluded.kind, data = excluded.data, recorded_at = excluded.recorded_at
    `);
    const removeObject = db.prepare('DELETE FROM game_operational_objects WHERE game_id = ? AND object_id = ?');
    const listUnitIds = db.prepare("SELECT object_id FROM game_operational_objects WHERE game_id = ? AND kind = 'unit'");
    const upsertResource = db.prepare(`
      INSERT INTO game_resource_stocks (game_id, polity_id, stock, updated_turn, updated_date, recorded_at)
      VALUES (?, ?, ?, ?, ?, ?)
      ON CONFLICT(game_id, polity_id) DO UPDATE SET
        stock = excluded.stock, updated_turn = excluded.updated_turn,
        updated_date = excluded.updated_date, recorded_at = excluded.recorded_at
    `);
    const ids = new Set(input.units.map(row => String(row.id)));
    const commit = db.transaction(() => {
      if (input.resource) {
        upsertResource.run(
          input.gameId, input.resource.polityId, JSON.stringify(input.resource.stock),
          input.resource.turn, input.resource.date, now,
        );
      }
      for (const row of input.units) {
        upsertObject.run(input.gameId, String(row.id), JSON.stringify(row.data ?? {}), now);
      }
      for (const existing of listUnitIds.all(input.gameId) as Array<{ object_id: string }>) {
        if (!ids.has(String(existing.object_id))) removeObject.run(input.gameId, String(existing.object_id));
      }
    });
    commit();
  },

  /**
   * P5.1 — esito del combattimento: fronti, reparti globali e personale NPC
   * riallineato vengono committati insieme. Nessun arsenale o altra risorsa è
   * coinvolto in questo passaggio.
   */
  persistCombatOutcome: (input: {
    gameId: string;
    units: Array<{ id: string; data: Record<string, unknown> }>;
    fronts: Array<{ id: string; data: Record<string, unknown> }>;
    personnel: Array<{ polityId: string; state: Record<string, unknown> }>;
  }): void => {
    const now = new Date().toISOString();
    const upsertObject = db.prepare(`
      INSERT INTO game_operational_objects (game_id, object_id, kind, data, recorded_at)
      VALUES (?, ?, ?, ?, ?)
      ON CONFLICT(game_id, object_id) DO UPDATE SET
        kind = excluded.kind, data = excluded.data, recorded_at = excluded.recorded_at
    `);
    const removeObject = db.prepare('DELETE FROM game_operational_objects WHERE game_id = ? AND object_id = ?');
    const listIds = db.prepare('SELECT object_id FROM game_operational_objects WHERE game_id = ? AND kind = ?');
    const unitIds = new Set(input.units.map(row => String(row.id)));
    const frontIds = new Set(input.fronts.map(row => String(row.id)));
    const commit = db.transaction(() => {
      for (const row of input.personnel) {
        upsertObject.run(input.gameId, String(row.polityId), 'personnel', JSON.stringify(row.state ?? {}), now);
      }
      for (const row of input.units) {
        upsertObject.run(input.gameId, String(row.id), 'unit', JSON.stringify(row.data ?? {}), now);
      }
      for (const existing of listIds.all(input.gameId, 'unit') as Array<{ object_id: string }>) {
        if (!unitIds.has(String(existing.object_id))) removeObject.run(input.gameId, String(existing.object_id));
      }
      for (const row of input.fronts) {
        upsertObject.run(input.gameId, String(row.id), 'front', JSON.stringify(row.data ?? {}), now);
      }
      for (const existing of listIds.all(input.gameId, 'front') as Array<{ object_id: string }>) {
        if (!frontIds.has(String(existing.object_id))) removeObject.run(input.gameId, String(existing.object_id));
      }
    });
    commit();
  },

  /**
   * P4 — scrittura **atomica** del seed di reparti (unità NPC) e, se serve, dei
   * depositi coinvolti. Stessa transazione unica del percorso `reconstitute`:
   * `units` è l'insieme **globale** (il `kind` è un replace completo).
   */
  materializeUnits: (input: {
    gameId: string;
    /** Insieme **completo** dei reparti (tutte le polity). */
    units: Array<{ id: string; data: Record<string, unknown> }>;
    /** Depositi aggiornati (conservazione: `depot + assegnato` invariato). */
    arsenals?: Array<{ polityId: string; units: Record<string, number>; turn: number; date: string | null }>;
  }): void => {
    const now = new Date().toISOString();
    const upsertObject = db.prepare(`
      INSERT INTO game_operational_objects (game_id, object_id, kind, data, recorded_at)
      VALUES (?, ?, ?, ?, ?)
      ON CONFLICT(game_id, object_id) DO UPDATE SET
        kind = excluded.kind, data = excluded.data, recorded_at = excluded.recorded_at
    `);
    const removeObject = db.prepare('DELETE FROM game_operational_objects WHERE game_id = ? AND object_id = ?');
    const listUnitIds = db.prepare("SELECT object_id FROM game_operational_objects WHERE game_id = ? AND kind = 'unit'");
    const upsertArsenal = db.prepare(`
      INSERT INTO game_arsenals (game_id, polity_id, units, updated_turn, updated_date, recorded_at)
      VALUES (?, ?, ?, ?, ?, ?)
      ON CONFLICT(game_id, polity_id) DO UPDATE SET
        units = excluded.units, updated_turn = excluded.updated_turn,
        updated_date = excluded.updated_date, recorded_at = excluded.recorded_at
    `);
    const ids = new Set(input.units.map(row => String(row.id)));
    const commit = db.transaction(() => {
      for (const row of input.units) {
        upsertObject.run(input.gameId, String(row.id), 'unit', JSON.stringify(row.data ?? {}), now);
      }
      for (const existing of listUnitIds.all(input.gameId) as Array<{ object_id: string }>) {
        if (!ids.has(String(existing.object_id))) removeObject.run(input.gameId, String(existing.object_id));
      }
      for (const arsenal of input.arsenals || []) {
        upsertArsenal.run(input.gameId, arsenal.polityId, JSON.stringify(arsenal.units ?? {}), arsenal.turn, arsenal.date, now);
      }
    });
    commit();
  },

};

export default militaryPersistenceRepository;
