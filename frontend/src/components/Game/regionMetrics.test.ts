import { describe, expect, it } from 'vitest';
import type { Region } from '../../types';
import { economyBucketEdges, THEMATIC_NO_DATA_COLOR } from '../Map/thematicMapModel';
import { metricFromText, metricValue, shadeRegions, METRIC_LABEL, REGION_METRICS } from './regionMetrics';

const region = (id: string, gdp: number | undefined, population = 100, militaryPower = 10): Region =>
  ({ id, name: id, owner: 'A', color: '#315f87', gdp, population, militaryPower, objects: [], borders: [], metadata: {} } as unknown as Region);

describe('MAP04 — la metrica la sceglie il testo, non il modello', () => {
  it('riconosce le tre metriche dalle parole della conversazione', () => {
    expect(metricFromText('Dove va il nostro PIL?')).toBe('pil');
    expect(metricFromText('Dove vive la popolazione?')).toBe('popolazione');
    expect(metricFromText('Dove sono i nostri presidi militari?')).toBe('difesa');
  });

  it('le radici si riconoscono anche con la desinenza: economia, produzione, popolazioni', () => {
    // Difetto trovato dalla verifica: un `\b` finale dopo la radice non matcha
    // mai, perché dopo «economi» c'è una lettera.
    expect(metricFromText("l'economia del paese")).toBe('pil');
    expect(metricFromText('la produzione industriale')).toBe('pil');
    expect(metricFromText('le popolazioni del sud')).toBe('popolazione');
    expect(metricFromText('il presidio militare')).toBe('difesa');
  });

  it('senza una richiesta esplicita non colora da un dato (colore politico)', () => {
    expect(metricFromText('Parliamo della riforma agraria.')).toBeUndefined();
    expect(metricFromText(undefined)).toBeUndefined();
    expect(metricFromText('')).toBeUndefined();
  });

  it('la difesa ha la precedenza sull\'economia in una frase che le nomina entrambe', () => {
    // «militare» è più specifico di «economia»: l'ordine delle regole è dichiarato.
    expect(metricFromText('La spesa militare pesa sull\'economia.')).toBe('difesa');
  });

  it('ogni metrica ha la sua etichetta, e sono tutte e tre', () => {
    expect(REGION_METRICS).toEqual(['pil', 'popolazione', 'difesa']);
    for (const metric of REGION_METRICS) expect(METRIC_LABEL[metric]).toBeTruthy();
  });
});

describe('MAP04 — i valori vengono solo dalle regioni canoniche', () => {
  it('legge il campo giusto per ogni metrica', () => {
    const r = region('r', 42, 500, 7);
    expect(metricValue(r, 'pil')).toBe(42);
    expect(metricValue(r, 'popolazione')).toBe(500);
    expect(metricValue(r, 'difesa')).toBe(7);
  });

  it('un dato assente o non positivo non è un dato', () => {
    for (const bad of [0, -3, Number.NaN, undefined]) {
      expect(metricValue(region('r', bad as number), 'pil')).toBeNull();
    }
  });
});

describe('MAP04 — colori e legenda riusano la scala della mappa grande', () => {
  const regions = [region('a', 1), region('b', 3), region('c', 7), region('d', 20), region('e', 100)];

  it('usa le stesse soglie a quantili di thematicMapModel', () => {
    const shading = shadeRegions(regions, 'pil')!;
    const expected = economyBucketEdges([1, 3, 7, 20, 100]);
    // La legenda ha una fascia per intervallo: soglie distinte + 1.
    expect(shading.legend).toHaveLength(expected.length + 1);
  });

  it('la legenda dichiara gli intervalli, non i proprietari', () => {
    const shading = shadeRegions(regions, 'pil')!;
    expect(shading.colors.get('e')).not.toBe(shading.colors.get('a'));
    expect(shading.legend.at(-1)!.label).toMatch(/^≥/);
    expect(shading.legend[0].label).toMatch(/^</);
  });

  it('una regione senza dato prende il colore dichiarato per il dato assente, mai una fascia', () => {
    const withHole = [...regions, region('hole', 0)];
    const shading = shadeRegions(withHole, 'pil')!;
    expect(shading.colors.get('hole')).toBe(THEMATIC_NO_DATA_COLOR);
    expect(shading.measured).toBe(5);
  });

  it('se nessuna regione ha il dato non si colora nulla: la scheda resta quella di prima', () => {
    const none = [region('a', undefined), region('b', 0)];
    expect(shadeRegions(none, 'pil')).toBeNull();
    expect(shadeRegions([], 'popolazione')).toBeNull();
  });

  it('la metrica decide il campo, e la popolazione non usa il PIL', () => {
    const mixed = [region('a', 1, 900), region('b', 500, 10)];
    const byPop = shadeRegions(mixed, 'popolazione')!;
    // Con la popolazione, «a» (900) è il massimo e «b» (10) il minimo: l'opposto del PIL.
    expect(byPop.colors.get('a')).not.toBe(byPop.colors.get('b'));
    const byGdp = shadeRegions(mixed, 'pil')!;
    expect(byPop.colors.get('a')).toBe(byGdp.colors.get('b'));
  });
});
