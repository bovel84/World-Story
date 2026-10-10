import { describe, expect, it } from 'vitest';
import { MAX_PREVIEW_LABELS, placeLabels, type LabelCandidate } from './regionLabels';

const at = (id: string, name: string, x: number, y: number, width = 100, height = 100): LabelCandidate =>
  ({ id, name, x, y, width, height });

describe('MAP03 — le etichette entrano nel riquadro, o non si disegnano', () => {
  it('un\'etichetta sola si posa sul centro della sua zona', () => {
    const placed = placeLabels([at('a', 'Irbid', 50, 50)], { fontSize: 10 });
    expect(placed).toHaveLength(1);
    expect(placed[0]).toMatchObject({ id: 'a', text: 'Irbid', x: 50, y: 50 });
  });

  it('due etichette che si toccherebbero: la seconda scivola, senza sovrapporsi', () => {
    // Due zone con lo stesso centro: la seconda non può stare dove la prima è.
    const placed = placeLabels([at('a', 'Amman', 50, 50), at('b', 'Zarqa', 50, 50)], { fontSize: 10 });
    expect(placed).toHaveLength(2);
    const [first, second] = placed;
    expect(first.y).not.toBe(second.y);
    expect(second.y).toBeGreaterThan(first.y);
  });

  it('un\'etichetta che non trova posto in una zona minuscola non si disegna', () => {
    // Zona strettissima: il testo (lungo) non ci sta, e non deve uscire dalla zona
    // per nominare la vicina.
    const placed = placeLabels([at('a', 'Provincia Molto Lunga', 50, 50, 4, 4)], { fontSize: 10 });
    expect(placed).toEqual([]);
  });

  it('un corpo di testo enorme non sfonda la zona: si riduce, e se non basta non si disegna', () => {
    const wide = placeLabels([at('a', 'Amman', 50, 50, 200, 200)], { fontSize: 100 });
    expect(wide).toHaveLength(1);
    // Ridotto per stare nella zona, non il corpo richiesto.
    expect(wide[0].fontSize).toBeLessThan(100);
    const impossible = placeLabels([at('a', 'Una Provincia Con Un Nome Lunghissimo', 50, 50, 6, 6)], { fontSize: 100 });
    expect(impossible).toEqual([]);
  });

  it('onora il tetto delle etichette', () => {
    const many = Array.from({ length: MAX_PREVIEW_LABELS + 4 }, (_, i) => at(`l${i}`, `Paese${i}`, i * 300, 0, 100, 100));
    expect(placeLabels(many, { fontSize: 8 })).toHaveLength(MAX_PREVIEW_LABELS);
    expect(placeLabels(many, { fontSize: 8, maxLabels: 2 })).toHaveLength(2);
  });

  it('un nome vuoto non produce un\'etichetta', () => {
    expect(placeLabels([at('a', '', 50, 50)], { fontSize: 10 })).toEqual([]);
  });

  it('un\'etichetta non esce dalla sua zona, nemmeno scivolando', () => {
    // Difetto trovato dalla verifica: una zona **bassa** (60×30) con due etichette
    // sullo stesso centro lasciava la seconda scivolare oltre il bordo.
    const zone = (id: string) => at(id, 'Amman', 50, 50, 60, 30);
    const placed = placeLabels([zone('a'), zone('b')], { fontSize: 10 });
    for (const label of placed) {
      // Il centro della zona è 50, l'altezza è 30: la scatola non può superare 65.
      const half = (label.text.length * label.fontSize * 0.6) / 2 + 2;
      expect(label.y - half).toBeGreaterThanOrEqual(50 - 30 / 2 - 2);
      expect(label.y + label.fontSize * 1.1 / 2 + 2).toBeLessThanOrEqual(50 + 30 / 2 + 2);
    }
  });

  it('in una zona che contiene una sola etichetta, la seconda non si disegna', () => {
    // Alta 20: una etichetta ci sta (col corpo ridotto a 8), non due sullo stesso centro.
    const placed = placeLabels([at('a', 'Amman', 50, 50, 80, 20), at('b', 'Zarqa', 50, 50, 80, 20)], { fontSize: 10 });
    expect(placed).toHaveLength(1);
    expect(placed[0].y).toBe(50);
  });

  it('una zona così bassa da non contenere nemmeno il corpo minimo non produce etichette', () => {
    // Il corpo minimo leggibile è 7 unità; una zona alta 12 ne concede meno di 5.
    expect(placeLabels([at('a', 'Amman', 50, 50, 80, 12)], { fontSize: 10 })).toEqual([]);
  });

  it('è deterministico e non muta l\'input', () => {
    const input = [at('a', 'Amman', 10, 10), at('b', 'Zarqa', 12, 12)];
    const snapshot = JSON.stringify(input);
    expect(JSON.stringify(placeLabels(input, { fontSize: 9 }))).toBe(JSON.stringify(placeLabels(input, { fontSize: 9 })));
    expect(JSON.stringify(input)).toBe(snapshot);
  });
});
