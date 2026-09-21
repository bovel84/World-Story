/**
 * MAP P4.1 — identità dello snapshot canonico (una sola nozione)
 * =============================================================
 * La preview PRIMA → DOPO di un reparto vale solo dentro lo snapshot che l'ha
 * prodotta. Serve quindi **una** stringa condivisa da ogni punto d'uso di
 * `UnitActionPanel`: il context inspector della mappa (MAP P4) e la sala di
 * governo del dossier nazionale (Nazione → Armamenti).
 *
 * La stringa è composta solo da fatti canonici già pubblicati dal motore:
 * partita, turno, data, revisione del mondo, ramo. Nessun timestamp locale,
 * nessun contatore, nessuna revisione parallela della UI: due render dello
 * stesso snapshot devono produrre la stessa chiave, e un cambio di uno qualsiasi
 * dei cinque campi deve produrre una chiave diversa (rewind, restore, cambio
 * turno/data, cambio ramo).
 */

/** Campi canonici che identificano lo snapshot di gioco. */
export interface ActionSnapshotSource {
  id?: string | null;
  currentTurn?: number | null;
  currentDate?: string | null;
  worldRevision?: number | null;
  headBranchId?: string | null;
}

export function actionSnapshotKey(game: ActionSnapshotSource | null | undefined): string {
  return [
    game?.id ?? '',
    game?.currentTurn ?? 0,
    game?.currentDate ?? '',
    game?.worldRevision ?? 0,
    game?.headBranchId ?? '',
  ].join(':');
}
