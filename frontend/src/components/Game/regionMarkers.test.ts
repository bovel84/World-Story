import { describe, expect, it } from 'vitest';
import type { Region } from '../../types';
import { MAX_CITY_MARKERS, projectMarkers } from './regionMarkers';

const region = (id: string, name: string, objects: unknown[] = []): Region =>
  ({ id, name, owner: 'A', color: '#315f87', objects, borders: [], metadata: {} } as unknown as Region);

const object = (type: string, name: string, lng?: number, lat?: number, id = `${type}-x`) =>
  ({ id, type, name, ...(lng !== undefined ? { lng } : {}), ...(lat !== undefined ? { lat } : {}) });

/** Un riquadro che copre 0..10 in longitudine e 40..50 in latitudine. */
const BOUNDS = { west: 0, south: 40, east: 10, north: 50 };
const base = { bounds: BOUNDS, width: 640, height: 260 };

describe('MAP09 — i segni si proiettano con la stessa proiezione dei poligoni', () => {
  it('una capitale con coordinate reali cade dentro la tela', () => {
    const markers = projectMarkers({ ...base, regions: [region('r', 'Provincia', [object('capital', 'Amman', 5, 45)])] });
    expect(markers).toHaveLength(1);
    expect(markers[0]).toMatchObject({ kind: 'capital', name: 'Amman' });
    expect(markers[0].x).toBeGreaterThan(0);
    expect(markers[0].x).toBeLessThan(640);
    expect(markers[0].y).toBeGreaterThan(0);
    expect(markers[0].y).toBeLessThan(260);
  });

  it('la posizione viene dalle coordinate reali, non dal centro della provincia', () => {
    // Due capitali nella stessa regione, in punti opposti: devono cadere in punti diversi.
    const markers = projectMarkers({ ...base, regions: [region('r', 'P', [object('capital', 'Ovest', 0.5, 45, 'a'), object('capital', 'Est', 9.5, 45, 'b')])] });
    expect(markers).toHaveLength(2);
    expect(markers[0].x).toBeLessThan(markers[1].x);
  });

  it('un oggetto senza coordinate reali non si disegna: i mondi legacy non hanno lat/lng', () => {
    const legacy = object('capital', 'Vecchia', undefined, undefined, 'l');
    (legacy as Record<string, unknown>).x = 900;
    (legacy as Record<string, unknown>).y = 700;
    expect(projectMarkers({ ...base, regions: [region('r', 'P', [legacy])] })).toEqual([]);
  });

  it('un tipo di oggetto che il modulo non conosce si ignora', () => {
    expect(projectMarkers({ ...base, regions: [region('r', 'P', [object('radar', 'Radar', 5, 45)])] })).toEqual([]);
  });

  it('porti e stabilimenti si disegnano, e sono fatti unici', () => {
    const markers = projectMarkers({ ...base, regions: [region('r', 'P', [object('port', 'Porto di P', 1, 41), object('factory', 'Stabilimento di P', 2, 42)])] });
    expect(markers.map(m => m.kind)).toEqual(['port', 'factory']);
  });
});

describe('MAP09 — le città saturerebbero il riquadro: solo dove si guarda', () => {
  const many = (n: number, id: string) => region(id, `P${id}`, Array.from({ length: n }, (_, i) => object('city', `Città${i}`, i % 10, 40 + (i % 10) * 0.5, `${id}-${i}`)));

  it('le città si disegnano solo nelle zone in evidenza', () => {
    const regions = [many(5, 'a'), many(5, 'b')];
    const noFocus = projectMarkers({ ...base, regions });
    expect(noFocus).toEqual([]); // nessuna zona in evidenza: nessuna città
    const focused = projectMarkers({ ...base, regions, primaryIds: ['a'] });
    expect(focused).toHaveLength(5);
    expect(focused.every(m => m.id.startsWith('a-'))).toBe(true);
  });

  it('le città hanno un tetto di resa, e i segni unici non ne sono toccati', () => {
    const regions = [many(30, 'a'), region('b', 'P', [object('capital', 'Cap', 5, 45, 'cap')])];
    const markers = projectMarkers({ ...base, regions, primaryIds: ['a'] });
    const cities = markers.filter(m => m.kind === 'city');
    expect(cities).toHaveLength(MAX_CITY_MARKERS);
    expect(markers.filter(m => m.kind === 'capital')).toHaveLength(1);
  });

  it('l\'ordine è deterministico: prima i fatti unici, poi le città', () => {
    const regions = [region('r', 'P', [object('city', 'C', 3, 43, 'c'), object('capital', 'Cap', 5, 45, 'cap')])];
    const first = projectMarkers({ ...base, regions, primaryIds: ['r'] });
    expect(first.map(m => m.kind)).toEqual(['capital', 'city']);
    expect(JSON.stringify(projectMarkers({ ...base, regions, primaryIds: ['r'] }))).toBe(JSON.stringify(first));
  });

  it('un oggetto malformato (lat presente, lng assente) non si disegna', () => {
    const half = object('capital', 'Mezzo', undefined, 45, 'h');
    expect(projectMarkers({ ...base, regions: [region('r', 'P', [half])] })).toEqual([]);
  });
});
