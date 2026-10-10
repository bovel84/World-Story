import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import type { Region } from '../../types';
import { buildMapContextIndex } from '../Map/mapContext';
import { GovernmentVisualCard } from './GovernmentVisualCard';
import { buildGovernmentVisualSnapshot, governmentVisualModel, mapLayerForVisual, resolveGovernmentVisuals } from './governmentVisual';
import { parsePresentation } from './presentation';
import { borderRegionIds, resolveRegionZones } from './regionRelevance';
import { mapLayerForMetric } from './regionMetrics';
import { THEMATIC_NO_DATA_COLOR } from '../Map/thematicMapModel';

const SCOPE = 'game:M:branch:1';

const regions = (): Region[] => [
  { id: 'k1', name: 'Amman', owner: 'A', polityName: 'Paese A', color: '#007A3D', gdp: 40, population: 900, militaryPower: 30, svgPath: 'M0 0L60 0L60 60L0 60Z', objects: [], borders: ['k2', 'fuori'], metadata: {} },
  { id: 'k2', name: 'Zarqa', owner: 'A', polityName: 'Paese A', color: '#007A3D', gdp: 10, population: 100, militaryPower: 5, svgPath: 'M60 0L120 0L120 60L60 60Z', objects: [], borders: ['k1', 'k3'], metadata: {} },
  { id: 'k3', name: 'Al Karak', owner: 'A', polityName: 'Paese A', color: '#007A3D', gdp: 5, population: 50, militaryPower: 2, svgPath: 'M0 60L60 60L60 120L0 120Z', objects: [], borders: ['k2', 'k4'], metadata: {} },
  { id: 'k4', name: 'Maan', owner: 'A', polityName: 'Paese A', color: '#007A3D', gdp: 1, population: 20, militaryPower: 1, svgPath: 'M60 60L120 60L120 120L60 120Z', objects: [], borders: [], metadata: {} },
] as Region[];

const snapshot = () => buildGovernmentVisualSnapshot({
  scopeKey: SCOPE, canonicalSnapshotKey: SCOPE, militarySnapshotKey: SCOPE,
  index: buildMapContextIndex({ regions: regions(), units: [], fronts: [] }), unavailable: false, playerPolityId: 'A',
})!;

const request = { requested: true as const, scopeKey: SCOPE, intent: 'generic' as const, signalKeys: [] as string[] };
const card = (content: string, evidence = [] as never[]) =>
  resolveGovernmentVisuals({ role: 'assistant', content, visualRequest: request, evidence }, snapshot())[0];

describe('MAP05 — la grandezza la dichiara il modello o il testo, mai i numeri', () => {
  it('una direttiva con `metric` valida sceglie la scala; i colori vengono dal motore', () => {
    const parsed = parsePresentation('Ecco dove produciamo.\n```tavola\n{"op":"focus","evidence":"mappa","metric":"pil"}\n```');
    expect(parsed.directives[0].metric).toBe('pil');
    const model = governmentVisualModel(card('Ecco dove produciamo.', parsed.directives), snapshot())!;
    // Il colore di «Amman» (PIL 40) è quello della fascia alta, non il colore politico.
    expect(model.metricColors?.get('k1')).not.toBe('#007A3D');
    expect(model.metricColors?.get('k4')).not.toBe(model.metricColors?.get('k1'));
  });

  it('una metrica ignota è ignorata: la scheda resta politica', () => {
    const parsed = parsePresentation('```tavola\n{"op":"focus","evidence":"mappa","metric":"inventata"}\n```');
    expect(parsed.directives[0].metric).toBeUndefined();
  });

  it('il testo del Presidente può scegliere la metrica anche senza direttiva', () => {
    const model = governmentVisualModel(card('Mostra dove vive la popolazione.'), snapshot())!;
    expect(model.metric).toBe('popolazione');
    expect(model.metricLabel).toMatch(/Popolazione/);
  });

  it('senza metrica la scheda resta quella di sempre (colore politico, legenda dei proprietari)', () => {
    const model = governmentVisualModel(card('Il bilancio regge.'), snapshot())!;
    expect(model.metric).toBeUndefined();
    expect(model.legend.map(entry => entry.label)).toEqual(['Paese A']);
    expect(renderToStaticMarkup(<GovernmentVisualCard card={card('Il bilancio regge.')} snapshot={snapshot()} />)).not.toContain('province con dato');
  });

  it('la legenda dichiara la scala a intervalli e il dato assente resta dichiarato', () => {
    const holes = regions().map((region, index) => index === 3 ? { ...region, gdp: 0 } : region);
    const snap = buildGovernmentVisualSnapshot({
      scopeKey: SCOPE, canonicalSnapshotKey: SCOPE, militarySnapshotKey: SCOPE,
      index: buildMapContextIndex({ regions: holes, units: [], fronts: [] }), unavailable: false, playerPolityId: 'A',
    })!;
    const withMetric = resolveGovernmentVisuals({ role: 'assistant', content: 'Dove sta il prodotto delle province?', visualRequest: request }, snap)[0];
    const model = governmentVisualModel(withMetric, snap)!;
    expect(model.metricColors?.get('k4')).toBe(THEMATIC_NO_DATA_COLOR);
    expect(model.legend.at(-1)!.label).toMatch(/^≥/);
    const html = renderToStaticMarkup(<GovernmentVisualCard card={withMetric} snapshot={snap} />);
    expect(html).toContain('3 province con dato');
    expect(html).toContain('Scala:');
  });
});

describe('MAP06 — annotazioni da fatti canonici', () => {
  it('la frontiera di un insieme si legge dai confini canonici, non dai nomi', () => {
    expect(borderRegionIds(regions(), ['k1', 'k2'])).toEqual(['k1', 'k2']);
    expect(borderRegionIds(regions(), ['k2'])).toEqual(['k2']);
    // «Maan» non confina con nessuno: non è di frontiera.
    expect(borderRegionIds(regions(), ['k4'])).toEqual([]);
  });

  it('le zone portano il contorno dell\'insieme, e non crescono di nascosto', () => {
    const zones = resolveRegionZones({ regions: regions(), text: 'La crisi di Amman.' });
    expect(zones.border).toEqual(['k1']);
  });

  it('la quota delle zone in evidenza è calcolata dal resolver, per la metrica mostrata', () => {
    // Con il PIL: Amman (40) su un totale di 56 = 71%.
    const model = governmentVisualModel(card('Il prodotto di Amman e Zarqa.'), snapshot())!;
    expect(model.metric).toBe('pil');
    expect(model.metricShare).toBe(89); // 40 + 10 su 56
    const html = renderToStaticMarkup(<GovernmentVisualCard card={card('Il prodotto di Amman e Zarqa.')} snapshot={snapshot()} />);
    expect(html).toContain('4 province con dato');
    expect(html).toContain('In evidenza: Amman · Zarqa');
  });

  it('senza metrica non si dichiara nessuna quota', () => {
    const model = governmentVisualModel(card('La crisi di Amman.'), snapshot())!;
    expect(model.metricShare).toBeUndefined();
  });
});

describe('MAP11 — la mappa grande si apre sulla stessa lettura della scheda', () => {
  it('una scheda col prodotto apre il layer del prodotto, e lo dichiara sul pulsante', () => {
    const withPil = card('Dove il prodotto delle province?');
    expect(mapLayerForVisual(withPil)).toBe('economy');
    const html = renderToStaticMarkup(<GovernmentVisualCard card={withPil} snapshot={snapshot()} />);
    expect(html).toContain('Apri la mappa del prodotto');
  });

  it('le altre grandezze NON forzano un layer: la mappa resta politica', () => {
    // `military` mostra fronti e reparti, che è un'altra cosa dalla popolazione o
    // dal presidio: aprire quella mappa direbbe qualcosa di diverso.
    expect(mapLayerForVisual(card('Dove vive la popolazione?'))).toBeUndefined();
    expect(mapLayerForVisual(card('Dove sono i presidi militari?'))).toBeUndefined();
  });

  it('senza metrica il pulsante è quello di sempre', () => {
    const plain = card('La crisi di Amman.');
    expect(mapLayerForVisual(plain)).toBeUndefined();
    const html = renderToStaticMarkup(<GovernmentVisualCard card={plain} snapshot={snapshot()} />);
    expect(html).toContain('Mostra sulla mappa principale');
    expect(html).not.toContain('Apri la mappa del prodotto');
  });

  it('il layer viene scelto dal tipo di metrica, mai dal testo o dal modello', () => {
    expect(mapLayerForMetric('pil')).toBe('economy');
    expect(mapLayerForMetric('popolazione')).toBeUndefined();
    expect(mapLayerForMetric('difesa')).toBeUndefined();
  });
});
