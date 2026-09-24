/**
 * Mappa statica dal GeoJSON — il ripiego quando WebGL non c'è.
 *
 * Il difetto che questi test proteggono: senza WebGL la mappa interattiva
 * sollevava un errore non gestito e **abbatteva la partita**
 * (`Failed to initialize WebGL`). Il ripiego SVG non poteva salvarla, perché i
 * mondi reali portano solo `geojson` e nessun `svgPath`: 117.096 regioni su
 * 117.096 nel database di sviluppo. Questi test verificano che dal GeoJSON si
 * ottenga comunque una mappa — e che una geometria rotta non diventi un disegno
 * arbitrario.
 */
import { describe, it, expect } from 'vitest';
import { buildStaticMap, boundsOf, projectPoint, type GeoBounds } from './staticMapModel';
import type { Region } from '../../types';

/** Un quadrato attorno a una coppia di coordinate, come GeoJSON reale. */
function square(west: number, south: number, size = 1): string {
  const e = west + size;
  const n = south + size;
  return JSON.stringify({
    type: 'Feature',
    geometry: {
      type: 'Polygon',
      coordinates: [[[west, south], [e, south], [e, n], [west, n], [west, south]]],
    },
  });
}

function region(overrides: Partial<Region> & { id: string }): Region {
  return {
    name: overrides.id,
    owner: 'ITA',
    color: '#4f7cff',
    population: 1_000_000,
    gdp: 100,
    militaryPower: 10,
    objects: [],
    borders: [],
    ...overrides,
  } as Region;
}

describe('riquadro geografico', () => {
  it('contiene tutte le geometrie, con margine', () => {
    const bounds = boundsOf([
      JSON.parse(square(0, 40)).geometry,
      JSON.parse(square(10, 45)).geometry,
    ])!;
    expect(bounds.west).toBeLessThan(0);
    expect(bounds.south).toBeLessThan(40);
    expect(bounds.east).toBeGreaterThan(11);
    expect(bounds.north).toBeGreaterThan(45);
  });

  it('è null quando non c\'è nessuna geometria valida', () => {
    expect(boundsOf([])).toBeNull();
  });
});

describe('proiezione', () => {
  const bounds: GeoBounds = { west: 0, south: 40, east: 10, north: 50 };

  it('mette il nord in alto e l\'ovest a sinistra', () => {
    const [xWest, yNorth] = projectPoint(0, 50, bounds, 1000, 600);
    const [xEast, ySouth] = projectPoint(10, 40, bounds, 1000, 600);
    expect(xWest).toBeLessThan(xEast);
    // La latitudine cresce verso nord, la coordinata SVG verso il basso.
    expect(yNorth).toBeLessThan(ySouth);
  });

  it('resta dentro il riquadro dichiarato', () => {
    for (const [lng, lat] of [[0, 40], [10, 50], [5, 45], [10, 40], [0, 50]]) {
      const [x, y] = projectPoint(lng, lat, bounds, 1000, 600);
      expect(x).toBeGreaterThanOrEqual(0);
      expect(x).toBeLessThanOrEqual(1000);
      expect(y).toBeGreaterThanOrEqual(0);
      expect(y).toBeLessThanOrEqual(600);
    }
  });

  it('corregge la longitudine per la latitudine: alle latitudini europee non schiaccia', () => {
    // Lo stesso intervallo in gradi vale meno in longitudine che in latitudine:
    // senza correzione una mappa europea apparirebbe stirata in orizzontale.
    const [x0] = projectPoint(0, 45, bounds, 1000, 600);
    const [x1] = projectPoint(1, 45, bounds, 1000, 600);
    const [, y0] = projectPoint(5, 45, bounds, 1000, 600);
    const [, y1] = projectPoint(5, 46, bounds, 1000, 600);
    const oneDegreeLng = x1 - x0;
    const oneDegreeLat = Math.abs(y1 - y0);
    expect(oneDegreeLng).toBeLessThan(oneDegreeLat);
    expect(oneDegreeLng).toBeGreaterThan(oneDegreeLat * 0.5);
  });

  it('la scala è unica sui due assi: la geografia non si deforma', () => {
    // Un quadrato geografico corretto dal coseno resta un quadrato.
    const squareBounds: GeoBounds = { west: 0, south: 0, east: 10, north: 10 };
    const [x0, y0] = projectPoint(0, 0, squareBounds, 1000, 1000);
    const [x1] = projectPoint(1, 0, squareBounds, 1000, 1000);
    const [, y1] = projectPoint(0, 1, squareBounds, 1000, 1000);
    const ratio = Math.abs(x1 - x0) / Math.abs(y1 - y0);
    const expected = Math.cos(5 * Math.PI / 180);
    expect(ratio).toBeCloseTo(expected, 2);
  });
});

describe('modello della mappa', () => {
  it('disegna le regioni che hanno GeoJSON valido', () => {
    const model = buildStaticMap([
      region({ id: 'r1', geojson: square(0, 40) }),
      region({ id: 'r2', color: '#ff0000', geojson: square(5, 42) }),
    ]);
    expect(model.paths).toHaveLength(2);
    expect(model.skipped).toBe(0);
    expect(model.bounds).not.toBeNull();
    for (const path of model.paths) {
      expect(path.path.startsWith('M')).toBe(true);
      expect(path.path.endsWith('Z')).toBe(true);
    }
    // Il colore è quello del motore, non uno scelto dal renderer.
    expect(model.paths.find(p => p.id === 'r2')!.color).toBe('#ff0000');
  });

  it('conta le geometrie illeggibili invece di disegnarle a caso', () => {
    const model = buildStaticMap([
      region({ id: 'ok', geojson: square(0, 40) }),
      region({ id: 'rotta', geojson: '{non-json' }),
      region({ id: 'senza-geometria', geojson: JSON.stringify({ geometry: { type: 'Point', coordinates: [0, 0] } }) }),
    ]);
    expect(model.paths).toHaveLength(1);
    expect(model.paths[0].id).toBe('ok');
    expect(model.skipped).toBe(2);
  });

  it('senza geometrie disegnabili non inventa un riquadro', () => {
    const model = buildStaticMap([region({ id: 'niente' })]);
    expect(model.paths).toHaveLength(0);
    expect(model.bounds).toBeNull();
  });

  it('usa un grigio neutro se il motore non ha dato un colore', () => {
    const model = buildStaticMap([region({ id: 'r1', color: '', geojson: square(0, 40) })]);
    expect(model.paths[0].color).toBe('#3a3f4b');
  });

  it('è deterministico: stessi ingressi, stesso disegno', () => {
    const regions = [region({ id: 'a', geojson: square(0, 40) }), region({ id: 'b', geojson: square(3, 44) })];
    expect(buildStaticMap(regions)).toEqual(buildStaticMap(regions));
  });

  it('disegna un MultiPolygon (arcipelaghi, territori d\'oltremare)', () => {
    const multi = JSON.stringify({
      type: 'Feature',
      geometry: {
        type: 'MultiPolygon',
        coordinates: [
          [[[0, 40], [1, 40], [1, 41], [0, 41], [0, 40]]],
          [[[5, 45], [6, 45], [6, 46], [5, 46], [5, 45]]],
        ],
      },
    });
    const model = buildStaticMap([region({ id: 'arcipelago', geojson: multi })]);
    expect(model.paths).toHaveLength(1);
    // Due anelli ⇒ due sottotracciati chiusi nello stesso path.
    expect(model.paths[0].path.match(/Z/g)).toHaveLength(2);
  });
});
