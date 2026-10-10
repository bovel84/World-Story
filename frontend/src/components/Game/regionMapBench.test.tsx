/**
 * MAP07 — Il banco che assomiglia a una partita vera
 * ==================================================
 * Il banco precedente iniettava **sempre** un fronte o una relazione ostile:
 * presupponeva le condizioni che in partita mancano, ed è per questo che i
 * difetti a monte erano passati. Qui i numeri vengono dal database reale, con la
 * geometria reale delle province (equirettangolare, correzione `cos(midLat)`,
 * `PAD = 2°`, canvas 640×260 — la stessa proiezione di `staticMapModel.ts`).
 *
 * Le fixture sono **ridotte** per restare leggibili, ma conservano la proprietà
 * che conta: la scala e i rapporti fra le province sono quelli misurati.
 *
 * MAP08 — Il caso antimeridiano (la Russia, 334 province, span 364°; la Nuova
 * Zelanda, 355°) è qui, perché è la ragione per cui la fase esiste.
 */
import { describe, expect, it } from 'vitest';
import type { Region } from '../../types';
import { buildMapContextIndex } from '../Map/mapContext';
import { svgPathBounds } from './regionFocus';
import { buildGovernmentVisualSnapshot, governmentVisualModel, resolveGovernmentVisuals } from './governmentVisual';

const SCOPE = 'game:bench:branch:1';

const polygon = (x: number, y: number, w: number, h: number): string => JSON.stringify({
  type: 'Feature', geometry: { type: 'Polygon', coordinates: [[[x, y], [x + w, y], [x + w, y + h], [x, y + h], [x, y]]] },
});

const region = (id: string, name: string, over: Partial<Region> = {}): Region =>
  ({ id, name, owner: 'A', polityName: 'Paese A', color: '#007A3D', geojson: polygon(0, 0, 1, 1), objects: [], borders: [], metadata: {}, gdp: 1, population: 100, militaryPower: 1, ...over } as unknown as Region);

const snapshotFor = (regions: Region[], owner = 'A') => buildGovernmentVisualSnapshot({
  scopeKey: SCOPE, canonicalSnapshotKey: SCOPE, militarySnapshotKey: SCOPE,
  index: buildMapContextIndex({ regions, units: [], fronts: [] }), unavailable: false, playerPolityId: owner,
})!;

const request = { requested: true as const, scopeKey: SCOPE, intent: 'generic' as const, signalKeys: [] as string[] };
const card = (regions: Region[], content: string) =>
  resolveGovernmentVisuals({ role: 'assistant', content, visualRequest: request }, snapshotFor(regions))[0];

/** Il caso reale: 11 province contigue (come la Giordania), una nominata. */
const contiguous = (): Region[] => Array.from({ length: 11 }, (_, i) =>
  region(`p${i}`, `Provincia${i}`, { geojson: polygon(i * 0.7, 0, 0.7, 0.7), gdp: (i + 1) * 3 }));

describe('MAP07 — un banco nudo, con i rapporti di scala reali', () => {
  it('senza fronti e senza richiesta di geografia, una menzione non produce nulla', () => {
    expect(resolveGovernmentVisuals({ role: 'assistant', content: 'Il bilancio regge.' }, snapshotFor(contiguous()))).toEqual([]);
  });

  it('una richiesta esplicita produce una scheda con geometria disegnata (non un riepilogo)', () => {
    const model = governmentVisualModel(card(contiguous(), 'Nessun nome qui.'), snapshotFor(contiguous()))!;
    expect(model.preview).not.toBeNull();
    expect(model.preview!.paths).toHaveLength(11);
    // L'inquadratura **contiene** tutte le 11 province: ogni path cade dentro il
    // riquadro. (`width > 0` era un falso verde: `viewBoxFor` la clampa a ≥1.)
    const [minX, minY, width, height] = model.preview!.viewBox.split(/\s+/).map(Number);
    for (const path of model.preview!.paths) {
      const bounds = svgPathBounds(path.path)!;
      expect(bounds.minX).toBeGreaterThanOrEqual(minX - 0.001);
      expect(bounds.maxX).toBeLessThanOrEqual(minX + width + 0.001);
      expect(bounds.minY).toBeGreaterThanOrEqual(minY - 0.001);
      expect(bounds.maxY).toBeLessThanOrEqual(minY + height + 0.001);
    }
  });

  it('lo stesso caso con un nome di provincia: le zone si stringono, il disegno resta intero', () => {
    // «Provincia5» è il nome canonico: il resolver lo riconosce e inquadra quella.
    const withName = card(contiguous(), 'La crisi di Provincia5 richiede attenzione.');
    const wide = card(contiguous(), 'Nessun nome qui.');
    const focused = governmentVisualModel(withName, snapshotFor(contiguous()))!;
    const whole = governmentVisualModel(wide, snapshotFor(contiguous()))!;
    const width = (viewBox: string) => Number(viewBox.split(/\s+/)[2]);
    expect(withName.zones?.primary).toEqual(['p5']);
    expect(width(focused.preview!.viewBox)).toBeLessThan(width(whole.preview!.viewBox));
    // Tutte le 11 restano disegnate: il contesto colloca il soggetto.
    expect(focused.preview!.paths).toHaveLength(11);
  });

  it('una provincia larga su tela legacy NON viene rifiutata per il tetto dei gradi', () => {
    // Difetto trovato dalla verifica: la guardia del fuso confrontava i **pixel**
    // del riquadro con una soglia in **gradi**. Una provincia larga 600 unità
    // sulla tela del progetto veniva scartata pur non attraversando nessun fuso.
    const legacy: Region[] = [
      region('wide', 'Provincia Larga', { geojson: undefined, svgPath: 'M0 0L600 0L600 400L0 400Z' }),
      region('next', 'Provincia Vicina', { geojson: undefined, svgPath: 'M600 0L900 0L900 400L600 400Z' }),
    ];
    const model = governmentVisualModel(card(legacy, 'La crisi di Provincia Larga.'), snapshotFor(legacy))!;
    expect(model.preview).not.toBeNull();
    expect(model.preview!.paths).toHaveLength(2);
  });
});

describe('MAP08 — l\'antimeridiano e i grandi imperi', () => {
  /** Due province a cavallo dell'antimeridiano, come la Nuova Zelanda reale. */
  const across = (): Region[] => [
    region('east', 'Isola Est', { geojson: polygon(178, -40, 2, 2) }),
    region('west', 'Isola Ovest', { geojson: polygon(-179, -42, 2, 2) }),
    region('home', 'Casa', { geojson: polygon(-177, -45, 1, 1) }),
  ];

  it('un insieme che attraversa l\'antimeridiano, senza zone in evidenza, degrada al riepilogo dichiarato', () => {
    const model = governmentVisualModel(card(across(), 'Nessun nome qui.'), snapshotFor(across()))!;
    expect(model.preview).toBeNull();
    expect(model.regions).toHaveLength(3);
  });

  it('con una zona in evidenza NON oltre l\'antimeridiano, la scheda si disegna', () => {
    // «Casa» sta tutta dal lato ovest: il riquadro su di essa è una proiezione onesta.
    const withName = card(across(), 'La situazione di Casa è critica.');
    expect(withName.zones?.primary).toEqual(['home']);
    const model = governmentVisualModel(withName, snapshotFor(across()))!;
    expect(model.preview).not.toBeNull();
    expect(Number(model.preview!.viewBox.split(/\s+/)[2])).toBeLessThan(10);
  });

  it('le zone in evidenza che stesse attraversano l\'antimeridiano non ingannano: si dichiara', () => {
    const model = governmentVisualModel(card(across(), 'La crisi di Isola Est e Isola Ovest.'), snapshotFor(across()))!;
    expect(model.preview).toBeNull();
  });
});
