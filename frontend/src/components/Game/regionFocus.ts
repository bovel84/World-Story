/**
 * WS-MINISTER-UX-04 — La geometria delle zone, senza inventarla
 * ============================================================
 * La tavola di UX-01 disegnava le zone con un `viewBox` fisso `0 0 100 100`.
 * Non è una svista innocua: la geometria pubblicata dal motore (`Region.svgPath`)
 * vive su una tela **2000×1500** (le mappe SVG del progetto), quindi un viewBox
 * fisso ritagliava le regioni in modo arbitrario — o le tagliava fuori.
 *
 * Qui la geometria si **misura**: si estraggono le coordinate dal path e si
 * costruisce il viewBox dai limiti reali, con un margine. Lo stesso calcolo
 * approssimato che il progetto usa altrove (`MapView.getCentroid`): i path sono
 * generati dalla stessa pipeline, quindi la lettura numerica è coerente. Se la
 * geometria manca o non è leggibile, non si inventa nulla: si torna all'elenco
 * territoriale esplicito.
 *
 * Modulo **puro**: nessun I/O, nessuno stato.
 */

/** Un rettangolo di coordinate nel sistema della mappa. */
export interface Bounds {
  readonly minX: number;
  readonly minY: number;
  readonly maxX: number;
  readonly maxY: number;
}

/**
 * I limiti di un `d` SVG. Si leggono le coppie numeriche del path: è la stessa
 * approssimazione di `MapView.getCentroid`, sufficiente per un viewBox di
 * inquadratura (non per un hit-test).
 */
export function svgPathBounds(path: string | undefined | null): Bounds | null {
  if (!path) return null;
  const nums = path.match(/-?\d+\.?\d*/g);
  if (!nums || nums.length < 4) return null;
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (let i = 0; i + 1 < nums.length; i += 2) {
    const x = Number(nums[i]);
    const y = Number(nums[i + 1]);
    if (!Number.isFinite(x) || !Number.isFinite(y)) continue;
    if (x < minX) minX = x;
    if (y < minY) minY = y;
    if (x > maxX) maxX = x;
    if (y > maxY) maxY = y;
  }
  if (!Number.isFinite(minX) || !Number.isFinite(minY) || maxX < minX || maxY < minY) return null;
  return { minX, minY, maxX, maxY };
}

/** L'unione dei limiti; `null` se nessuno è leggibile. */
export function unionBounds(list: ReadonlyArray<Bounds | null | undefined>): Bounds | null {
  const valid = list.filter((bounds): bounds is Bounds => bounds != null);
  if (valid.length === 0) return null;
  return valid.reduce<Bounds>((acc, bounds) => ({
    minX: Math.min(acc.minX, bounds.minX),
    minY: Math.min(acc.minY, bounds.minY),
    maxX: Math.max(acc.maxX, bounds.maxX),
    maxY: Math.max(acc.maxY, bounds.maxY),
  }), { minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity });
}

/** La stringa `viewBox` dai limiti, con margine. Fallback: la tela del progetto. */
export function viewBoxFor(bounds: Bounds | null, padding = 4): string {
  if (!bounds) return '0 0 2000 1500';
  const width = Math.max(1, bounds.maxX - bounds.minX);
  const height = Math.max(1, bounds.maxY - bounds.minY);
  return `${bounds.minX - padding} ${bounds.minY - padding} ${width + padding * 2} ${height + padding * 2}`;
}

/** Il minimo indispensabile per inquadrare una zona. */
export interface FocusableZone {
  readonly id: string;
  readonly svgPath?: string;
}

/**
 * Il viewBox della mappa: se c'è una **selezione** con geometria valida, si
 * inquadra quella; altrimenti si inquadra l'insieme. Mai un viewBox fisso.
 */
export function focusViewBox(
  zones: readonly FocusableZone[],
  focusIds: readonly string[] = [],
  padding = 4,
): string {
  const ids = new Set(focusIds);
  const focused = zones.filter(zone => ids.has(zone.id) && zone.svgPath);
  const source = focused.length > 0 ? focused : zones;
  return viewBoxFor(unionBounds(source.map(zone => svgPathBounds(zone.svgPath))), padding);
}

/** Quali zone sono in evidenza, e se c'è una selezione attiva. */
export function partitionZones(
  zones: readonly FocusableZone[],
  focusIds: readonly string[] = [],
): { readonly focused: ReadonlySet<string>; readonly hasFocus: boolean } {
  const available = new Set(zones.map(zone => zone.id));
  const focused = new Set(focusIds.filter(id => available.has(id)));
  return { focused, hasFocus: focused.size > 0 };
}

/** Il centroide approssimato di un path: per le etichette, non per la logica. */
export function zoneCentroid(path: string | undefined | null): { x: number; y: number } | null {
  if (!path) return null;
  const bounds = svgPathBounds(path);
  if (!bounds) return null;
  return { x: (bounds.minX + bounds.maxX) / 2, y: (bounds.minY + bounds.maxY) / 2 };
}
