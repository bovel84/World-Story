import { describe, expect, it } from 'vitest';
import {
  buildScarGeoJson,
  syncScarLayers,
  SCAR_SOURCE_ID,
  SCAR_FILL_LAYER_ID,
  SCAR_LINE_LAYER_ID,
  type TemporalScar,
} from './TemporalScarLayer';

const scar: TemporalScar = {
  id: 'REG-1',
  name: 'Regione Uno',
  previousOwner: 'ALP',
  previousColor: '#aa3333',
  startedAt: 1_000,
};

const region = {
  id: 'REG-1',
  name: 'Regione Uno',
  geojson: JSON.stringify({ type: 'Feature', properties: {}, geometry: { type: 'Polygon', coordinates: [[[0, 0], [1, 0], [1, 1], [0, 0]]] } }),
};

describe('TemporalScarLayer (G4-C — documentazione del mutamento territoriale)', () => {
  it('senza cicatrici produce una collezione vuota', () => {
    const collection = buildScarGeoJson([], [region]);
    expect(collection.type).toBe('FeatureCollection');
    expect(collection.features).toHaveLength(0);
  });

  it('accoppia geometria della regione e colore del vecchio padrone', () => {
    const collection = buildScarGeoJson([scar], [region]);
    expect(collection.features).toHaveLength(1);
    const feature = collection.features[0];
    expect(feature.properties.scarId).toBe('REG-1');
    expect(feature.properties.scarOwner).toBe('ALP');
    expect(feature.properties.scarColor).toBe('#aa3333');
    expect(feature.geometry.type).toBe('Polygon');
  });

  it('salta le regioni senza geometria o con geojson corrotto', () => {
    const broken = { id: 'REG-2', name: 'Corrotta', geojson: '{non-json' };
    const missing = { id: 'REG-3', name: 'Assente' };
    const collection = buildScarGeoJson(
      [scar, { ...scar, id: 'REG-2' }, { ...scar, id: 'REG-3' }],
      [region, broken, missing],
    );
    expect(collection.features).toHaveLength(1);
    expect(collection.features[0].properties.scarId).toBe('REG-1');
  });

  it('syncScarLayers crea una sola volta sorgente e layer, poi aggiorna i dati', () => {
    const existingSources = new Map<string, any>();
    const existingLayers = new Set<string>();
    const dataUpdates: any[] = [];
    const map = {
      getSource: (id: string) => existingSources.get(id),
      addSource: (id: string, spec: any) => {
        existingSources.set(id, { ...spec, setData: (data: any) => dataUpdates.push(data) });
      },
      getLayer: (id: string) => (existingLayers.has(id) ? {} : undefined),
      addLayer: (layer: any) => {
        existingLayers.add(layer.id);
      },
    };

    syncScarLayers(map as any, [scar], [region]);
    syncScarLayers(map as any, [], [region]);

    expect(existingLayers.has(SCAR_FILL_LAYER_ID)).toBe(true);
    expect(existingLayers.has(SCAR_LINE_LAYER_ID)).toBe(true);
    // Prima chiamata: una feature; seconda chiamata: collezione vuota (svanita).
    expect(dataUpdates).toHaveLength(2);
    expect(dataUpdates[0].features).toHaveLength(1);
    expect(dataUpdates[1].features).toHaveLength(0);
    expect(existingSources.get(SCAR_SOURCE_ID)).toBeDefined();
  });
});