/**
 * World Story — Saves Routes
 * =======================
 */

import { Router } from 'express';
import db from '../database';
import { getSessionRegistry } from '../session-registry';
import { isReservedSaveName } from '../game/SaveReservations';

export const savesRouter = Router();

/**
 * Regola dei salvataggi riservati: `game/SaveReservations.ts` (fonte unica).
 * Qui la protezione è **fail-closed** in cancellazione: la UI non mostra gli
 * snapshot interni, e nemmeno una richiesta costruita a mano li può cancellare.
 */
export { isReservedSaveName, RESERVED_SAVE_NAMES, RESERVED_SAVE_NAME_PATTERN } from '../game/SaveReservations';

savesRouter.get('/', (_req, res) => {
  // NB: [current_date] в квадратных скобках — голое имя колонки current_date
  // в select-списке SQLite вычисляется как ключевое слово CURRENT_DATE
  // (сегодняшняя дата), а не как колонка!
  const stmt = db.prepare('SELECT id, game_id, name, current_turn, [current_date], saved_at FROM saves ORDER BY saved_at DESC');
  const saves = stmt.all();
  res.json({ saves });
});

/**
 * DELETE /api/saves/:id — cancella un salvataggio dell'utente.
 *
 *  - 200 `{ ok: true, deleted }` se esiste ed è cancellabile;
 *  - 404 `{ error: 'Save not found' }` se non esiste;
 *  - 403 `{ error, code: 'reserved_save' }` se è uno snapshot interno
 *    (`__rewind__`, `__n__`, qualunque `__…__`). Fail-closed: nessuna
 *    richiesta, per quanto esplicita, cancella un record riservato.
 *
 * Cancellare un salvataggio NON tocca la partita: nessun cascade su `games`,
 * `game_regions`, `game_operational_objects`, nessuna scrittura di stato.
 * Una sola istruzione di scrittura; `changes` distingue il 404.
 */
savesRouter.delete('/:id', (req, res) => {
  const saveId = req.params.id;

  const row = db.prepare('SELECT id, name FROM saves WHERE id = ?').get(saveId) as
    | { id: string; name: string }
    | undefined;
  if (!row) {
    res.status(404).json({ error: 'Save not found' });
    return;
  }
  if (isReservedSaveName(row.name)) {
    console.warn('[DELETE] Salvataggio riservato: cancellazione rifiutata', saveId, row.name);
    res.status(403).json({ error: 'Salvataggio riservato: non cancellabile', code: 'reserved_save' });
    return;
  }

  const result = db.prepare('DELETE FROM saves WHERE id = ?').run(saveId);
  if (result.changes === 0) {
    res.status(404).json({ error: 'Save not found' });
    return;
  }

  console.log('[DELETE] Salvataggio cancellato:', saveId);
  res.json({ ok: true, deleted: saveId });
});

savesRouter.post('/:id/load', async (req, res) => {
  const saveId = req.params.id;

  try {
    const save = db.prepare('SELECT game_id FROM saves WHERE id = ?').get(saveId) as { game_id: string } | undefined;
    if (!save) {
      res.status(404).json({ error: 'Save not found' });
      return;
    }
    const registry = getSessionRegistry();
    const activeSession = registry.getSession(save.game_id);
    if (activeSession?.isSimulationInProgress()) {
      res.status(409).json({ error: 'Simulazione in corso: caricamento non disponibile', code: 'simulation_in_progress' });
      return;
    }
    const session = registry.loadSavedGame(saveId);
    if (!session) {
      res.status(404).json({ error: 'Save not found' });
      return;
    }

    // Un caricamento deve aggiornare anche la sorgente persistente letta da
    // GET /games e dalla Timeline, non soltanto la GameSession in memoria.
    await session.persistLoadedState();

    console.log('[LOAD] Game loaded e persistito:', saveId);
    res.json({
      game_id: session.id,
      currentTurn: session.getCurrentTurn(),
      currentDate: session.getCurrentDate(),
    });
  } catch (e) {
    console.error('[LOAD] Error:', e);
    res.status(404).json({ error: 'Failed to load game' });
  }
});
