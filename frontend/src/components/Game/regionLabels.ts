/**
 * MAP03 — Le etichette dentro il riquadro
 * ======================================
 * La scheda mappa sa disegnare i poligoni; i **nomi** li butta fuori, in una riga
 * lunga sotto l'anteprima, «Irbid · Sakib · Al Salt · …». Dentro il riquadro
 * l'etichetta compare solo se le regioni sono ≤ 4 — cioè mai, nei casi reali.
 * Questo modulo decide **dove** un nome può stare senza coprirne un altro.
 *
 * Il problema è geometrico e piccolo, e si risolve con quello che il progetto ha
 * già: la scatola di un testo si stima dalla sua lunghezza (`0.6 × fontSize` per
 * carattere, la convenzione di tutte le mappe SVG), si prova a posare l'etichetta
 * sul centroide della zona, e se tocca un'altra scatola già posata si **scivola**
 * in basso finché trova posto. Se non trova posto **non si disegna**: un nome
 * sovrapposto è peggio di un nome assente, e sotto l'anteprima c'è già l'elenco.
 *
 * Modulo **puro**: nessun DOM, nessuna misurazione reale (che richiederebbe un
 * canvas) — solo aritmetica su scatole, così la funzione resta testabile e la
 * scheda non dipende da un layout.
 */

/** Quanto è larga una lettera rispetto al corpo del testo (convenzione SVG). */
const GLYPH_WIDTH = 0.6;

/** Sotto questo corpo (in unità del `viewBox`) un nome non si legge: non si disegna. */
export const MIN_LABEL_FONT = 7;

/** Una zona etichettabile: il nome e il punto dove vorrebbe stare. */
export interface LabelCandidate {
  readonly id: string;
  readonly name: string;
  /** Il centro approssimato della zona, nello stesso sistema del `viewBox`. */
  readonly x: number;
  readonly y: number;
  /** Quanto è grande la zona: il testo non può superarla, o sembrerebbe il suo nome. */
  readonly width: number;
  readonly height: number;
}

/** Un'etichetta posata: id, testo, posizione e corpo. */
export interface PlacedLabel {
  readonly id: string;
  readonly text: string;
  readonly x: number;
  readonly y: number;
  readonly fontSize: number;
}

interface Box { minX: number; minY: number; maxX: number; maxY: number }

const overlaps = (a: Box, b: Box): boolean =>
  a.minX < b.maxX && a.maxX > b.minX && a.minY < b.maxY && a.maxY > b.minY;

/**
 * Quante etichette si tentano. Non è un tetto di contenuto: è un tetto di **resa**,
 * perché ogni etichetta in più è una scatola in più dove le altre non possono
 * stare. Oltre, la scheda torna all'elenco sotto l'anteprima.
 */
export const MAX_PREVIEW_LABELS = 6;

/**
 * Il corpo del testo che **entra** nella zona, o `null` se non ci sta.
 *
 * Due limiti, entrambi necessari: in altezza il testo non può coprire più del 40%
 * della zona, in larghezza non può eccederne il 90% — un nome più largo della
 * zona nominerebbe la vicina. Se il più piccolo dei due è sotto il minimo
 * leggibile, l'etichetta **non si disegna**: sotto l'anteprima c'è l'elenco.
 */
function fontSizeFor(candidate: LabelCandidate, minFont: number, maxFont: number): number | null {
  const byHeight = candidate.height * 0.4;
  const byWidth = (candidate.width * 0.9) / Math.max(1, candidate.name.length * GLYPH_WIDTH);
  const fit = Math.min(byHeight, byWidth);
  if (fit < minFont) return null;
  return Math.min(fit, maxFont);
}

/**
 * Posiziona le etichette, nell'ordine dato (le primarie prima: sono loro che
 * devono avere il posto migliore). Restituisce solo quelle che **entrano** senza
 * toccare le precedenti.
 *
 * `fontSize` è in unità del `viewBox`: il chiamante passa il corpo che vuole
 * rispettare, e la zona può chiederne uno più piccolo — mai più grande.
 */
export function placeLabels(
  candidates: readonly LabelCandidate[],
  options: { fontSize: number; padding?: number; maxLabels?: number } = { fontSize: 12 },
): PlacedLabel[] {
  const padding = options.padding ?? 2;
  const maxLabels = options.maxLabels ?? MAX_PREVIEW_LABELS;
  const placed: PlacedLabel[] = [];
  const boxes: Box[] = [];
  for (const candidate of candidates) {
    if (placed.length >= maxLabels) break;
    const text = candidate.name;
    if (!text) continue;
    const size = fontSizeFor(candidate, MIN_LABEL_FONT, options.fontSize);
    if (size === null) continue;
    const width = text.length * size * GLYPH_WIDTH;
    const height = size * 1.1;
    const box = (cx: number, cy: number): Box => ({
      minX: cx - width / 2 - padding, maxX: cx + width / 2 + padding,
      minY: cy - height / 2 - padding, maxY: cy + height / 2 + padding,
    });
    // Si prova il centro, poi si scivola in basso di poco per volta, **dentro la
    // zona**: un'etichetta che ne esce nominerebbe la vicina. Il limite non è
    // l'altezza della zona divisa per il passo — quello lascerebbe uscire
    // l'etichetta di mezza altezza — ma la **scatola** dell'etichetta: la sua
    // metà inferiore non può superare il centro più metà zona (e simmetricamente
    // in alto, quando si scivola).
    const halfZone = candidate.height / 2;
    const boxRadius = height / 2 + padding;
    const maxDown = halfZone - boxRadius;
    const maxSlides = maxDown > 0 ? Math.floor(maxDown / (height * 0.8)) : 0;
    for (let slide = 0; slide <= maxSlides; slide += 1) {
      const cy = candidate.y + slide * height * 0.8;
      if (cy + boxRadius > candidate.y + halfZone) break; // uscirebbe dalla zona
      const box0 = box(candidate.x, cy);
      if (boxes.some(other => overlaps(box0, other))) continue;
      placed.push({ id: candidate.id, text, x: candidate.x, y: cy, fontSize: size });
      boxes.push(box0);
      break;
    }
  }
  return placed;
}
