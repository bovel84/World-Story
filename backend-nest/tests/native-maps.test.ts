/**
 * MAP-NATIVE — mappe native scegliibili dai preset (funzioni pure + dati reali).
 * ==========================================================================
 * Verifica: whitelist rigida, precedenza (file proprio > map_base > standard),
 * metadati (province) e proiezione attesa nei tre livelli `nations`/`grouped`/
 * `full`. Nessun LLM, nessuna scrittura: solo lettura delle mappe di repo.
 */
import { describe, expect, it } from 'vitest';
import os from 'os';
import path from 'path';

process.env.OPEN_PAX_DB_PATH = path.join(os.tmpdir(), `world-story-mapnative-${process.pid}-${Date.now()}.db`);

import {
  DEFAULT_NATIVE_MAP_ID,
  NATIVE_MAPS,
  isNativeMapId,
  listNativeMaps,
  loadNativeMap,
  nativeMapPath,
  normalizeMapBase,
  resolveMapSource,
  type NativeMapId,
} from '../src/utils/native-maps';
import { deriveGroups, resolveMapDetail, type MapFeature } from '../src/utils/map-detail';
import { validatePresetJson } from '../src/utils/preset-loader';

const ALL_IDS: NativeMapId[] = [
  'standard', 'modern_world_provinces', 'pax_modern_provinces', 'paxh_ww2_provinces',
];

/**
 * Riproduce la proiezione della generazione mondo (worlds.routes): raggruppa le
 * feature per `properties.country`, sceglie il livello effettivo e conta le
 * regioni. Serve a verificare che una mappa provinciale nativa produca il
 * numero atteso per `nations`/`grouped`/`full`.
 */
function projectRegions(features: MapFeature[], level: 'nations' | 'grouped' | 'full') {
  const countryLevel: Record<string, MapFeature> = {};
  const provinceByCountry: Record<string, MapFeature[]> = {};
  for (const feature of features) {
    const code = (feature.properties as any)?.code;
    if (!code) continue;
    const parent = (feature.properties as any)?.country;
    if (parent && parent !== code) (provinceByCountry[parent] ??= []).push(feature);
    else countryLevel[code] = feature;
  }
  const hasProvinceMap = Object.values(provinceByCountry).some(list => list.length > 0);
  const detail = resolveMapDetail(level, hasProvinceMap);
  let regions = Object.keys(countryLevel).length;
  for (const [code, provinces] of Object.entries(provinceByCountry)) {
    regions += deriveGroups(provinces, detail, { owner: code, countryName: code }).length;
  }
  return { detail, regions };
}

const validMinimal = (extra: Record<string, unknown> = {}) => ({
  id: 'ok_id', name: 'X', country_codes: ['USA'], base_prompt: 'p', ...extra,
});

describe('MAP-NATIVE — catalogo e whitelist', () => {
  it('espone standard + le 3 provinciali e NON la fixture', () => {
    expect(NATIVE_MAPS.map(m => m.id)).toEqual(ALL_IDS);
    expect(NATIVE_MAPS.some(m => m.id === 'realism_test_world')).toBe(false);
    expect(isNativeMapId('realism_test_world')).toBe(false);
  });

  it('accetta solo gli id in whitelist', () => {
    for (const id of ALL_IDS) expect(isNativeMapId(id)).toBe(true);
    for (const bad of ['', ' ', 'foo', '../../etc/passwd', 'countries.geojson', 'standard/../pax_modern_provinces']) {
      expect(isNativeMapId(bad)).toBe(false);
      expect(normalizeMapBase(bad)).toBeUndefined();
    }
    expect(normalizeMapBase('  pax_modern_provinces ')).toBe('pax_modern_provinces');
    expect(normalizeMapBase(undefined)).toBeUndefined();
  });

  it('il percorso è risolto solo per id in whitelist (nessun path traversal)', () => {
    expect(nativeMapPath('standard')).toContain('countries.geojson');
    expect(nativeMapPath('../../etc/passwd')).toBeNull();
    expect(loadNativeMap('../../etc/passwd')).toBeNull();
    expect(loadNativeMap('realism_test_world')).toBeNull();
  });

  it('l\'elenco con metadati non contiene la fixture e marca le province', () => {
    const maps = listNativeMaps();
    expect(maps.map(m => m.id)).toEqual(ALL_IDS);
    const byId = Object.fromEntries(maps.map(m => [m.id, m]));
    expect(byId['standard'].hasProvinces).toBe(false);
    expect(byId['modern_world_provinces'].hasProvinces).toBe(true);
    expect(byId['pax_modern_provinces'].hasProvinces).toBe(true);
    expect(byId['paxh_ww2_provinces'].hasProvinces).toBe(false);
    expect(maps.every(m => m.features > 0)).toBe(true);
  });

  it('espone i codici paese coperti (compatibilità mappa/paesi)', () => {
    const byId = Object.fromEntries(listNativeMaps().map(m => [m.id, m]));
    expect(byId['standard'].codes).toHaveLength(243);
    expect(byId['standard'].codes).toContain('KAZ');
    expect(byId['modern_world_provinces'].codes).toHaveLength(112);
    expect(byId['modern_world_provinces'].codes).toContain('USA');
    expect(byId['modern_world_provinces'].codes).not.toContain('KAZ');
    expect(byId['pax_modern_provinces'].codes).toContain('KAZ');
    expect(byId['paxh_ww2_provinces'].codes).toContain('KAZ');
  });
});

describe('MAP-NATIVE — precedenza della sorgente', () => {
  it('senza mappa propria né map_base usa standard', () => {
    expect(resolveMapSource({ hasCustomMap: false })).toEqual({ kind: 'native', id: DEFAULT_NATIVE_MAP_ID });
    expect(DEFAULT_NATIVE_MAP_ID).toBe('standard');
  });

  it('map_base dichiara la mappa nativa', () => {
    expect(resolveMapSource({ hasCustomMap: false, mapBase: 'pax_modern_provinces' }))
      .toEqual({ kind: 'native', id: 'pax_modern_provinces' });
  });

  it('il map.geojson proprio vince su map_base', () => {
    expect(resolveMapSource({ hasCustomMap: true, mapBase: 'pax_modern_provinces' }))
      .toEqual({ kind: 'preset' });
  });

  it('map_base non valido ricade su standard', () => {
    expect(resolveMapSource({ hasCustomMap: false, mapBase: 'nope' }))
      .toEqual({ kind: 'native', id: 'standard' });
  });
});

describe('MAP-NATIVE — validazione di map_base nel preset', () => {
  it('assente = retrocompatibile; id validi passano', () => {
    expect(validatePresetJson(validMinimal()).map_base).toBeUndefined();
    expect(validatePresetJson(validMinimal({ map_base: 'modern_world_provinces' })).map_base)
      .toBe('modern_world_provinces');
    expect(validatePresetJson(validMinimal({ map_base: '  standard ' })).map_base).toBe('standard');
  });

  it('id non in whitelist sono rifiutati con errore chiaro', () => {
    expect(() => validatePresetJson(validMinimal({ map_base: '../../etc/passwd' }))).toThrow(/map_base/);
    expect(() => validatePresetJson(validMinimal({ map_base: 'realism_test_world' }))).toThrow(/map_base/);
  });
});

describe('MAP-NATIVE — proiezione reale per livello', () => {
  it('standard e paxh_ww2 restano mappe-nazioni (nessuna provincia)', () => {
    for (const id of ['standard', 'paxh_ww2_provinces'] as const) {
      const features = loadNativeMap(id)!.features!;
      const nations = projectRegions(features, 'nations');
      expect(nations.detail).toBe('nations');
      expect(projectRegions(features, 'grouped').detail).toBe('nations');
      expect(projectRegions(features, 'full').detail).toBe('nations');
      expect(projectRegions(features, 'full').regions).toBe(nations.regions);
    }
    expect(projectRegions(loadNativeMap('standard')!.features!, 'nations').regions).toBe(243);
    expect(projectRegions(loadNativeMap('paxh_ww2_provinces')!.features!, 'nations').regions).toBe(223);
  });

  it('modern_world_provinces: nations 116 · grouped 360 · full 946', () => {
    const features = loadNativeMap('modern_world_provinces')!.features!;
    expect(features).toHaveLength(946);
    expect(projectRegions(features, 'nations')).toEqual({ detail: 'nations', regions: 116 });
    expect(projectRegions(features, 'grouped')).toEqual({ detail: 'grouped', regions: 360 });
    expect(projectRegions(features, 'full')).toEqual({ detail: 'full', regions: 946 });
  });

  it('pax_modern_provinces: nations 224 · grouped 1591 · full 4475', () => {
    const features = loadNativeMap('pax_modern_provinces')!.features!;
    expect(features).toHaveLength(4475);
    expect(projectRegions(features, 'nations')).toEqual({ detail: 'nations', regions: 224 });
    expect(projectRegions(features, 'grouped')).toEqual({ detail: 'grouped', regions: 1591 });
    expect(projectRegions(features, 'full')).toEqual({ detail: 'full', regions: 4475 });
  });
});
