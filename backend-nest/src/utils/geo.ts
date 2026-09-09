/**
 * World Story — Geo Utils
 * ====================
 * Helper geometrici condivisi (senza dipendenze extra): aree in gradi²,
 * centroide del poligono più grande. Usati dalla generazione del mondo
 * (worlds.routes) e dalla creazione degli oggetti in partita (game-session).
 */

/** Area di un anello in gradi² (formula del laccio). */
export function ringAreaDeg2(ring: number[][]): number {
  let a = 0;
  for (let i = 0; i < ring.length - 1; i++) {
    a += ring[i][0] * ring[i + 1][1] - ring[i + 1][0] * ring[i][1];
  }
  return Math.abs(a / 2);
}

/** Area del poligono più grande della geometria (gradi²). */
export function geometryAreaDeg2(geometry: any): number {
  try {
    const polys: number[][][][] =
      geometry?.type === 'MultiPolygon' ? geometry.coordinates
        : geometry?.type === 'Polygon' ? [geometry.coordinates] : [];
    return polys.reduce((max, poly) => Math.max(max, ringAreaDeg2(poly[0] || [])), 0);
  } catch {
    return 0;
  }
}

/** Centroide del poligono più grande (punto interno affidabile per marker). */
export function largestRingCentroid(geometry: any): { lat: number; lng: number } | null {
  try {
    const polys: number[][][][] =
      geometry?.type === 'MultiPolygon' ? geometry.coordinates
        : geometry?.type === 'Polygon' ? [geometry.coordinates] : [];
    let best: number[][] | null = null;
    let bestArea = -1;
    for (const poly of polys) {
      const a = ringAreaDeg2(poly[0] || []);
      if (a > bestArea) { bestArea = a; best = poly[0]; }
    }
    if (!best) return null;
    const ring = best;
    let twice = 0, cx = 0, cy = 0;
    for (let i = 0; i < ring.length - 1; i++) {
      const [x0, y0] = ring[i];
      const [x1, y1] = ring[i + 1];
      const f = x0 * y1 - x1 * y0;
      twice += f;
      cx += (x0 + x1) * f;
      cy += (y0 + y1) * f;
    }
    if (Math.abs(twice) < 1e-12) {
      let sx = 0, sy = 0;
      for (const p of ring) { sx += p[0]; sy += p[1]; }
      return { lng: sx / ring.length, lat: sy / ring.length };
    }
    return { lng: cx / (3 * twice), lat: cy / (3 * twice) };
  } catch {
    return null;
  }
}

function pointInRing(pt: [number, number], ring: number[][]): boolean {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i];
    const [xj, yj] = ring[j];
    if (((yi > pt[1]) !== (yj > pt[1])) &&
        (pt[0] < (xj - xi) * (pt[1] - yi) / ((yj - yi) || 1e-12) + xi)) {
      inside = !inside;
    }
  }
  return inside;
}

/** Punto dentro la geometria (rispetta i buchi dei poligoni). */
export function pointInGeometry(pt: [number, number], geometry: any): boolean {
  try {
    const polys: number[][][][] =
      geometry?.type === 'MultiPolygon' ? geometry.coordinates
        : geometry?.type === 'Polygon' ? [geometry.coordinates] : [];
    for (const poly of polys) {
      if (pointInRing(pt, poly[0] || []) && !(poly.slice(1) || []).some(h => pointInRing(pt, h))) {
        return true;
      }
    }
  } catch { /* geometria corrotta — fuori */ }
  return false;
}