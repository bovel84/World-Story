/**
 * World Story — Percorso territoriale fra province (MILITARY/WARFRONT INTEGRITY P1-3)
 * ==================================================================================
 *
 * Funzione **pura** e deterministica: cerca il percorso più corto fra due
 * province attraversando **solo** territorio controllato dallo stesso
 * proprietario. Riusa la geografia che il mondo ha già (`region.borders`,
 * calcolato una volta alla generazione della mappa): nessun secondo grafo,
 * nessuna geometria ricalcolata qui.
 *
 * La usano i movimenti dei reparti: un reparto non «salta» in un'altra
 * provincia, ci arriva passando per le province del proprio paese. Il costo del
 * movimento è proporzionale al numero di tratte (`regionHops`).
 */

export interface PathRegion {
  id: string;
  owner?: string;
  borders?: string[];
}

export interface FriendlyRegionPathInput {
  fromRegionId: string;
  toRegionId: string;
  /** Proprietario che deve controllare **tutte** le province del percorso. */
  owner: string;
  regions: readonly PathRegion[];
}

/**
 * Percorso più corto (in tratte) fra `fromRegionId` e `toRegionId` passando solo
 * per province con `owner`. BFS con coda ordinata dagli id: a parità di
 * distanza il risultato è lo stesso a ogni chiamata (determinismo).
 *
 * @returns la sequenza di id **da partenza ad arrivo** (compresi), oppure
 *          `null` se non esiste un percorso controllato.
 */
export function friendlyRegionPath(input: FriendlyRegionPathInput): string[] | null {
  const owner = String(input.owner || '');
  const from = String(input.fromRegionId || '');
  const to = String(input.toRegionId || '');
  if (!owner || !from || !to) return null;
  if (from === to) return [from];

  const byId = new Map<string, PathRegion>();
  for (const region of input.regions) byId.set(String(region.id), region);
  const start = byId.get(from);
  const goal = byId.get(to);
  // La destinazione deve essere del proprietario; la partenza può essere una
  // provincia perduta (si esce, non si entra: il percorso resta controllato).
  if (!goal || String(goal.owner || '') !== owner) return null;
  if (!start) return null;

  const controlled = (id: string): boolean => {
    const region = byId.get(id);
    return Boolean(region) && String(region?.owner || '') === owner;
  };

  const previous = new Map<string, string>();
  const seen = new Set<string>([from]);
  let frontier = [from];
  while (frontier.length > 0) {
    const next: string[] = [];
    for (const current of [...frontier].sort()) {
      const region = byId.get(current);
      for (const neighbour of [...(region?.borders || [])].map(String).sort()) {
        if (seen.has(neighbour) || !controlled(neighbour)) continue;
        seen.add(neighbour);
        previous.set(neighbour, current);
        if (neighbour === to) {
          const path = [to];
          let step = to;
          while (previous.has(step)) {
            step = previous.get(step)!;
            path.unshift(step);
          }
          return path;
        }
        next.push(neighbour);
      }
    }
    frontier = next;
  }
  // Geografia **assente** (mappe legacy senza `borders`): il mondo non dichiara
  // alcun confine e non se ne inventa uno — il movimento resta diretto, come
  // prima di questa PR. Se invece almeno una delle due province dichiara i suoi
  // confini, l'assenza di percorso è un fatto e il trasferimento si blocca.
  if ((start.borders || []).length === 0 && (goal.borders || []).length === 0) return [from, to];
  return null;
}

/** Numero di tratte di un percorso (`A→B = 1`, `A→B→C = 2`). */
export function regionHops(path: readonly string[]): number {
  return Math.max(0, path.length - 1);
}

export default friendlyRegionPath;
