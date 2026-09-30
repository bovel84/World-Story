/**
 * WS-MINISTER-UX-04 — La geometria delle zone (modulo puro)
 * =========================================================
 * La mappa di UX-01 usava un viewBox fisso `0 0 100 100`: la geometria del
 * motore vive su una tela 2000×1500, quindi il ritaglio era arbitrario. Questi
 * test difendono il calcolo — limiti dal path, unione, viewBox con margine,
 * selezione — e il fallback: niente geometria ⇒ niente disegno inventato.
 */
import { describe, expect, it } from 'vitest';
import {
  focusViewBox, partitionZones, svgPathBounds, unionBounds, viewBoxFor, zoneCentroid,
} from './regionFocus';

const SQUARE = 'M0,0 L100,0 L100,100 L0,100 Z';
const OFFSET = 'M100,0 L200,0 L200,100 L100,100 Z';

describe('regionFocus — limiti e viewBox', () => {
  it('legge i limiti dal path', () => {
    expect(svgPathBounds(SQUARE)).toEqual({ minX: 0, minY: 0, maxX: 100, maxY: 100 });
    expect(svgPathBounds(OFFSET)).toEqual({ minX: 100, minY: 0, maxX: 200, maxY: 100 });
  });

  it('un path senza coordinate non produce limiti inventati', () => {
    expect(svgPathBounds('')).toBeNull();
    expect(svgPathBounds(undefined)).toBeNull();
    expect(svgPathBounds('Z')).toBeNull();
  });

  it('unisce i limiti di più geometrie', () => {
    expect(unionBounds([svgPathBounds(SQUARE), svgPathBounds(OFFSET)]))
      .toEqual({ minX: 0, minY: 0, maxX: 200, maxY: 100 });
    expect(unionBounds([null, undefined])).toBeNull();
  });

  it('costruisce il viewBox con margine, o la tela del progetto senza geometria', () => {
    expect(viewBoxFor({ minX: 0, minY: 0, maxX: 100, maxY: 100 }, 4)).toBe('-4 -4 108 108');
    expect(viewBoxFor(null)).toBe('0 0 2000 1500');
  });

  it('con una selezione inquadra le zone scelte, altrimenti l’insieme', () => {
    const zones = [
      { id: 'a', svgPath: SQUARE },
      { id: 'b', svgPath: OFFSET },
    ];
    expect(focusViewBox(zones, [])).toBe('-4 -4 208 108');
    expect(focusViewBox(zones, ['b'])).toBe('96 -4 108 108');
    // Una selezione senza geometria non cambia l'inquadratura.
    expect(focusViewBox(zones, ['nope'])).toBe('-4 -4 208 108');
  });

  it('le zone in evidenza sono solo quelle esistenti', () => {
    const zones = [{ id: 'a' }, { id: 'b' }];
    expect(partitionZones(zones, ['b', 'ghost'])).toEqual({ focused: new Set(['b']), hasFocus: true });
    expect(partitionZones(zones, [])).toEqual({ focused: new Set(), hasFocus: false });
  });

  it('il centroide serve alle etichette, non alla logica', () => {
    expect(zoneCentroid(SQUARE)).toEqual({ x: 50, y: 50 });
    expect(zoneCentroid(null)).toBeNull();
  });
});
