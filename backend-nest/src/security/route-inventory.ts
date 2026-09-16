/**
 * Q02 µ2 — Inventario degli endpoint mutanti.
 * =========================================
 * Estrae gli endpoint dichiarati dai file router (metodo + percorso) per
 * tenere un inventario verificabile: nessun endpoint mutante può comparire
 * senza essere censito (il test `tests/endpoint-inventory.test.ts` rigenera
 * l'inventario dal sorgente e lo confronta con lo snapshot committato).
 *
 * L'autorizzazione non è per-endpoint: `ownerGuard` (Q02 µ2) è installato a
 * livello applicativo in `index.ts` prima di `registerRoutes`, quindi copre
 * ogni `/api/*` quando `WORLD_STORY_OWNER_TOKEN` è configurato.
 */
export const MUTATING_METHODS = ['post', 'put', 'patch', 'delete'] as const;
export const READ_METHODS = ['get'] as const;
export type HttpMethod = (typeof MUTATING_METHODS)[number] | (typeof READ_METHODS)[number];

export interface RouteEntry {
  /** Metodo HTTP minuscolo: get/post/put/patch/delete. */
  method: HttpMethod;
  /** Percorso dichiarato sul router (senza prefisso di mount). */
  path: string;
  /** true per POST/PUT/PATCH/DELETE. */
  mutating: boolean;
  /** File router di origine, relativo a `src/routes`. */
  file: string;
}

const ROUTE_CALL = /\.(get|post|put|patch|delete)\(\s*(['"`])([^'"`]+)\2/g;

/** Estrae le route dichiarate in un singolo file router. */
export function extractRoutes(source: string, file: string): RouteEntry[] {
  const entries: RouteEntry[] = [];
  for (const match of source.matchAll(ROUTE_CALL)) {
    const method = match[1] as HttpMethod;
    entries.push({
      method,
      path: match[3],
      mutating: (MUTATING_METHODS as readonly string[]).includes(method),
      file,
    });
  }
  return entries;
}

export function sortRoutes(entries: RouteEntry[]): RouteEntry[] {
  return [...entries].sort(
    (a, b) =>
      a.file.localeCompare(b.file) ||
      a.path.localeCompare(b.path) ||
      a.method.localeCompare(b.method),
  );
}

/** Rendiconto leggibile: conteggio e ripartizione per file/metodo. */
export function inventorySummary(entries: RouteEntry[]): {
  total: number;
  mutating: number;
  reading: number;
  byFile: Record<string, number>;
} {
  const byFile: Record<string, number> = {};
  for (const entry of entries) byFile[entry.file] = (byFile[entry.file] || 0) + 1;
  return {
    total: entries.length,
    mutating: entries.filter((entry) => entry.mutating).length,
    reading: entries.filter((entry) => !entry.mutating).length,
    byFile,
  };
}
