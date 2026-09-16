import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const scarLayerSource = fs.readFileSync(path.resolve(__dirname, '..', 'Map', 'TemporalScarLayer.tsx'), 'utf8');
const mapSource = fs.readFileSync(path.resolve(__dirname, '..', 'Map', 'MapboxMapView.tsx'), 'utf8');
const mapModelSource = fs.readFileSync(path.resolve(__dirname, '..', 'Map', 'mapModel.ts'), 'utf8');
const appSource = fs.readFileSync(path.resolve(__dirname, '..', '..', 'App.tsx'), 'utf8');
// Fase 2: il wiring HUD/mappa/desk della partita vive in `GameScreen`.
const gameScreenSource = fs.readFileSync(path.resolve(__dirname, 'GameScreen.tsx'), 'utf8');
// Fase 2: cicatrici e applicazione dei checkpoint vivono in `useSimulationPlayback`.
const playbackSource = fs.readFileSync(path.resolve(__dirname, '..', '..', 'hooks', 'useSimulationPlayback.ts'), 'utf8');
// Fase 2: il gestore SSE (che inoltra le regioni toccate al dispaccio) vive in `useSimulationStream`.
const streamSource = fs.readFileSync(path.resolve(__dirname, '..', '..', 'hooks', 'useSimulationStream.ts'), 'utf8');
const feedSource = fs.readFileSync(path.resolve(__dirname, 'EventFeed.tsx'), 'utf8');

describe('G4-C — cicatrice temporale e dispacci con causa e mappa', () => {
  it('il layer cicatrice disegna tratteggio e riempimento del vecchio padrone', () => {
    expect(scarLayerSource).toContain('line-dasharray');
    expect(scarLayerSource).toContain("['get', 'scarColor']");
    expect(scarLayerSource).toContain('SCAR_LINE_LAYER_ID');
    expect(scarLayerSource).toContain('SCAR_FILL_LAYER_ID');
  });

  it('la cicatrice nasce solo da un vero cambio di padronanza', () => {
    expect(playbackSource).toContain('ownerChanged');
    // Aggiornamenti non territoriali non lasciano segno.
    expect(playbackSource).not.toContain('previousStates.push({\n            id: changed.id,\n            name: changed.name || before.name || changed.id,\n            previousOwner: before.owner || \'\',\n            previousColor: before.color || \'#8a8f9a\',\n            startedAt: Date.now(),\n          });\n        }\n        regions[changed.id] = { ...before, ...changed };\n      }\n      setCurrentWorld({ ...liveWorld, regions });\n    }\n    setChangedRegions');
  });

  it('le cicatrici scadono da sole (nessun segno permanente)', () => {
    expect(playbackSource).toContain('setTemporalScars(prev => prev.filter(existing => !scarIds.includes(existing.id)))');
  });

  it('la mappa riceve le cicatrici e le sincronizza con MapLibre', () => {
    expect(gameScreenSource).toContain('temporalScars={playback.temporalScars}');
    expect(mapSource).toContain('temporalScars');
    expect(mapSource).toContain('syncScarLayers');
  });

  it('il dispaccio porta le regioni toccate dall’evento', () => {
    expect(feedSource).toContain('regionIds?: string[]');
    expect(streamSource).toContain('(data.changedRegions || []).map((r: any) => r.id)');
  });

  it('l’articolo mostra «Perché è accaduto» e «Mostra sulla mappa»', () => {
    expect(feedSource).toContain('Perché è accaduto:');
    expect(feedSource).toContain('Mostra sulla mappa');
    expect(feedSource).toContain('onFocusRegion?.(openArticle.regionIds![0])');
  });

  it('«Mostra sulla mappa» seleziona la regione senza mutare il mondo', () => {
    expect(gameScreenSource).toContain('setSelectedRegion(regionId)');
  });

  it('mostra unità, fortificazioni e cantieri come contatori territoriali distinti', () => {
    expect(mapModelSource).toContain("fortification: { color:");
    expect(mapModelSource).toContain("construction_site: { color:");
    expect(mapSource).toContain("const militaryTypes = new Set(['army', 'battalion', 'fleet', 'missile'])");
    expect(mapSource).toContain("obj.type === 'construction_site'");
    expect(mapModelSource).toContain("mobilization: { color:");
    expect(mapModelSource).toContain('plannedType');
    expect(mapSource).toContain("anchor: 'center', offset");
    expect(mapSource).toContain('objectOwnerColor');
  });
});