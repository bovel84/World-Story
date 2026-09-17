/**
 * MAP-COMPLETE — politie della mappa
 * ==================================
 * Il mondo non nasce più da `country_codes` (le «nazioni giocabili»): nasce da
 * TUTTE le entità della sorgente geometrica. Questi test fissano le regole di
 * risoluzione di nome/colore e la separazione fra politie curate (dati dal
 * modello) e politie a baseline deterministico.
 */
import { describe, expect, it } from 'vitest';
import path from 'path';
import {
  buildMapPolities,
  curatedPolityCodes,
  hasPolity,
  mapPolitiesForPreset,
  mapPolitiesFromFeatures,
  partitionMapFeatures,
  polityEntriesFromFeatures,
} from '../src/utils/map-polities';
import { loadPreset, loadPresetMap } from '../src/utils/preset-loader';
import { loadNativeMap, normalizeMapBase, DEFAULT_NATIVE_MAP_ID } from '../src/utils/native-maps';

const feature = (properties: Record<string, unknown>) => ({ type: 'Feature', properties, geometry: null });

describe('MAP-COMPLETE — polityEntriesFromFeatures', () => {
  it('mappa nazionale: il codice polity è `code`', () => {
    const entries = polityEntriesFromFeatures([
      feature({ code: 'USA', nameEn: 'United States' }),
      feature({ code: 'FRA', nameEn: 'France' }),
    ]);
    expect(entries).toEqual([
      { code: 'USA', featureName: 'United States' },
      { code: 'FRA', featureName: 'France' },
    ]);
  });

  it('mappa provinciale: il codice polity è `country` (la nazione-madre)', () => {
    const entries = polityEntriesFromFeatures([
      feature({ code: 'pax-1', country: 'USA', name: 'Nana in Alaska' }),
      feature({ code: 'pax-2', country: 'USA', name: 'Nuova Inghilterra' }),
      feature({ code: 'pax-3', country: 'CAN', name: 'Quebec' }),
    ]);
    expect(entries.map(entry => entry.code)).toEqual(['USA', 'CAN']);
  });

  it('ignora le feature senza codice e mantiene un nome quando il primo è vuoto', () => {
    const entries = polityEntriesFromFeatures([
      feature({ name: 'senza codice' }),
      feature({ code: 'AND' }),
      feature({ code: 'AND', nameEn: 'Andorra' }),
    ]);
    expect(entries).toEqual([{ code: 'AND', featureName: 'Andorra' }]);
  });
});

describe('MAP-COMPLETE — buildMapPolities', () => {
  const entries = [
    { code: 'POL', featureName: 'Poland' },
    { code: 'SMR', featureName: 'San Marino' },
    { code: 'ZZZ', featureName: 'Territorio senza registro' },
  ];

  it('nome e colore storici del preset vincono su registro e feature', () => {
    const polities = buildMapPolities(entries, {
      curated: [{ code: 'POL', name: 'Regno di Polonia (Congresso)', color: '#123456' }],
    });
    const pol = polities.find(p => p.code === 'POL')!;
    expect(pol.name).toBe('Regno di Polonia (Congresso)');
    expect(pol.color).toBe('#123456');
  });

  it('codice senza override: nome italiano curato, poi registro, poi feature', () => {
    const polities = buildMapPolities([
      { code: 'USA', featureName: 'United States' },
      { code: 'SMR', featureName: 'San Marino' },
      { code: 'ZZZ', featureName: 'Territorio senza registro' },
    ]);
    expect(polities.find(p => p.code === 'USA')!.name).toBe('Stati Uniti');
    expect(polities.find(p => p.code === 'SMR')!.name).toBe('San Marino');
    expect(polities.find(p => p.code === 'ZZZ')!.name).toBe('Territorio senza registro');
  });

  it('colore curato della palette del preset, altrimenti deterministico e mai vuoto', () => {
    const polities = buildMapPolities(entries, { countryColors: { SMR: '#00ff00' } });
    expect(polities.find(p => p.code === 'SMR')!.color).toBe('#00ff00');
    const zzz = polities.find(p => p.code === 'ZZZ')!.color;
    expect(zzz).toMatch(/^#[0-9A-F]{6}$/);
    // Deterministico: due costruzioni identiche danno lo stesso colore.
    expect(buildMapPolities(entries).find(p => p.code === 'ZZZ')!.color).toBe(zzz);
  });

  it('elenco ordinato per codice e senza duplicati', () => {
    const polities = buildMapPolities([...entries, { code: 'POL', featureName: 'Poland' }]);
    expect(polities.map(p => p.code)).toEqual(['POL', 'SMR', 'ZZZ']);
  });
});

describe('MAP-COMPLETE — curatedPolityCodes e hasPolity', () => {
  it('usa `countries` quando presente, altrimenti i `country_codes` legacy', () => {
    expect(curatedPolityCodes({ countries: [{ code: 'ITA' }, { code: 'FRA' }], country_codes: ['DEU'] }))
      .toEqual(['ITA', 'FRA']);
    expect(curatedPolityCodes({ country_codes: ['DEU', 'deu', 'ITA'] })).toEqual(['DEU', 'ITA']);
  });

  it('hasPolity riconosce solo i codici presenti sulla mappa', () => {
    const polities = buildMapPolities([{ code: 'USA' }]);
    expect(hasPolity(polities, 'USA')).toBe(true);
    expect(hasPolity(polities, 'POL')).toBe(false);
    expect(hasPolity(polities, undefined)).toBe(false);
  });
});

describe('MAP-COMPLETE — politie reali di un preset (mappa completa)', () => {
  it('europa_1815 (mappa standard): molte più entità delle 15 consigliate', () => {
    const preset = loadPreset('europa_1815')!;
    const polities = mapPolitiesForPreset(preset);
    expect(polities.length).toBeGreaterThan(200);
    expect(curatedPolityCodes(preset).length).toBe(15);
    // Le nazioni consigliate hanno nome storico; le altre esistono comunque.
    expect(polities.find(p => p.code === 'RUS')!.name).toBe('Impero Russo');
    expect(hasPolity(polities, 'LUX')).toBe(true);
    expect(hasPolity(polities, 'ATA')).toBe(true);
    // Ogni polity ha nome e colore non vuoti (nessun «buco» nel selettore).
    for (const polity of polities) {
      expect(polity.name.trim().length, polity.code).toBeGreaterThan(0);
      expect(polity.color, polity.code).toMatch(/^#[0-9A-Fa-f]{6}$/);
    }
  });

  it('europa_1914 (mappa provinciale): politie = nazioni della mappa, non i country_codes', () => {
    const preset = loadPreset('europa_1914')!;
    const polities = mapPolitiesForPreset(preset);
    // europa_1914 non ha un map.geojson proprio: usa la mappa nativa `map_base`.
    const nativeId = normalizeMapBase(preset.map_base) ?? DEFAULT_NATIVE_MAP_ID;
    const mapCountries = new Set(
      (loadPresetMap('europa_1914')?.features ?? loadNativeMap(nativeId)?.features ?? [])
        .map((f: any) => f?.properties?.country).filter(Boolean),
    );
    expect(polities.length).toBe(mapCountries.size);
    expect(polities.length).toBeGreaterThan(200);
    // Ogni nazione della mappa esiste come polity: nessuna provincia orfana.
    for (const code of mapCountries) expect(hasPolity(polities, code as string), code as string).toBe(true);
  });

  it('OGNI polity ha una geometria: la guardia «mappa incompleta» non può scattare', () => {
    for (const id of ['europa_1815', 'europa_1914', 'mondo_1936', 'mondo_1989', 'realism_test_world']) {
      const preset = loadPreset(id)!;
      const nativeId = normalizeMapBase(preset.map_base) ?? DEFAULT_NATIVE_MAP_ID;
      const features = preset.has_custom_map
        ? loadPresetMap(id)?.features
        : loadNativeMap(nativeId)?.features;
      const { countryFeatures, provinceFeaturesByCountry } = partitionMapFeatures(features);
      const polities = mapPolitiesFromFeatures(preset, features);
      expect(polities.length, id).toBeGreaterThan(0);
      for (const polity of polities) {
        const hasGeometry = !!countryFeatures[polity.code]
          || (provinceFeaturesByCountry[polity.code] ?? []).length > 0;
        expect(hasGeometry, `${id}: ${polity.code}`).toBe(true);
      }
    }
  });
});
