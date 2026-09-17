/**
 * PRESETS-REBUILD — i quattro preset di contenuto nuovi.
 * ======================================================
 * Verifica che i preset sostituiscano davvero quelli rimossi, che siano
 * caricabili/validi (validatePresetJson passa dal loader) e soprattutto che
 * la mappa nativa scelta COPRIA tutti i `country_codes` (allineamento
 * territoriale, fix #35). La copertura è calcolata con i moduli reali
 * (`nativeMapInfo`) e con `resolveMapSource`/`resolveMapDetail`/`deriveGroups`,
 * così il conteggio regioni è quello che la generazione mondo produrrebbe.
 */
import { describe, expect, it } from 'vitest';
import fs from 'fs';
import path from 'path';
import { loadPreset, PRESETS_DIR } from '../src/utils/preset-loader';
import { nativeMapInfo, normalizeMapBase, resolveMapSource, isNativeMapId } from '../src/utils/native-maps';
import { deriveGroups, groupingKeysFor, resolveMapDetail, type MapFeature } from '../src/utils/map-detail';

const NEW_PRESETS = ['europa_1815', 'europa_1914', 'mondo_1936', 'mondo_1989'] as const;
const REMOVED = [
  'cold_war_1951',
  'cold_war_1951_v2',
  'modern_world',
  'pax_arena',
  'world-modern-nato-warsaw-1951',
  'world_war_ii',
];
const PROTECTED = ['realism_test_world', 'modern_world_provinces', 'pax_modern_provinces', 'paxh_ww2_provinces'];
const DATE_BY_ID: Record<string, string> = {
  europa_1815: '1815-06-09',
  europa_1914: '1914-06-28',
  mondo_1936: '1936-01-01',
  mondo_1989: '1989-06-04',
};

function mapFileFor(id: string): string {
  return id === 'standard'
    ? path.join(process.cwd(), 'data', 'geojson', 'countries.geojson')
    : path.join(process.cwd(), 'data', 'presets', id, 'map.geojson');
}

describe('PRESETS-REBUILD — rimozione dei preset di contenuto', () => {
  it('i sei preset di contenuto non sono più caricabili', () => {
    for (const id of REMOVED) {
      expect(loadPreset(id), `${id} è ancora presente`).toBeNull();
      expect(fs.existsSync(path.join(PRESETS_DIR, id)), `cartella ${id} ancora su disco`).toBe(false);
    }
  });

  it('fixture di test e mappe native restano intatte', () => {
    for (const id of PROTECTED) {
      expect(loadPreset(id), `${id} mancante`).not.toBeNull();
    }
    // Le cartelle mappa conservano il loro map.geojson.
    for (const id of ['modern_world_provinces', 'pax_modern_provinces', 'paxh_ww2_provinces']) {
      expect(fs.existsSync(path.join(PRESETS_DIR, id, 'map.geojson'))).toBe(true);
    }
  });

  it('i template legacy omonimi sono rimossi (nessun duplicato fantasma)', () => {
    for (const id of ['cold_war_1951', 'modern_world']) {
      expect(fs.existsSync(path.join(process.cwd(), 'data', 'templates', `${id}.json`))).toBe(false);
    }
  });
});

describe('PRESETS-REBUILD — i quattro preset nuovi', () => {
  for (const id of NEW_PRESETS) {
    it(`${id}: valido, completo nelle regole/storia e senza catalogo`, () => {
      const preset = loadPreset(id);
      expect(preset, `${id} non caricabile`).not.toBeNull();
      expect(preset!.source).toBe('preset');
      expect(preset!.start_date).toBe(DATE_BY_ID[id]);
      expect(preset!.has_custom_map).toBe(false);

      // 25–45 nazioni ISO-A3 reali, uniche.
      expect(preset!.country_codes.length).toBeGreaterThanOrEqual(25);
      expect(preset!.country_codes.length).toBeLessThanOrEqual(45);
      expect(new Set(preset!.country_codes).size).toBe(preset!.country_codes.length);
      for (const code of preset!.country_codes) expect(code).toMatch(/^[A-Z]{3}$/);

      // Mappa nativa in whitelist e livello coerente.
      expect(isNativeMapId(preset!.map_base)).toBe(true);
      expect(['nations', 'grouped', 'full']).toContain(preset!.map_detail);

      // Storia e regole sostanziose.
      expect((preset!.lore ?? '').length).toBeGreaterThan(1200);
      expect((preset!.simulation_rules ?? '').length).toBeGreaterThan(800);
      expect((preset!.base_prompt ?? '').split(/\s+/).length).toBeGreaterThanOrEqual(80);
      expect((preset!.description ?? '').length).toBeGreaterThan(80);

      // Nessun catalogo simulation/ (non richiesto dal task).
      expect(fs.existsSync(path.join(PRESETS_DIR, id, 'simulation'))).toBe(false);
    });

    it(`${id}: copertura territoriale completa dei country_codes`, () => {
      const preset = loadPreset(id)!;
      const mapBase = normalizeMapBase(preset.map_base)!;
      const info = nativeMapInfo(mapBase);
      const missing = preset.country_codes.filter(code => !info.codes.includes(code));
      expect(missing, `codici non coperti da ${mapBase}: ${missing.join(', ')}`).toEqual([]);

      // La sorgente geometrica risolta è la mappa nativa dichiarata.
      const source = resolveMapSource({ hasCustomMap: preset.has_custom_map, mapBase: preset.map_base });
      expect(source).toEqual({ kind: 'native', id: mapBase });

      // Il livello è applicabile: grouped/full solo se la mappa ha province.
      const level = resolveMapDetail(preset.map_detail, info.hasProvinces);
      if (preset.map_detail === 'nations') expect(level).toBe('nations');
      if (preset.map_detail === 'full' || preset.map_detail === 'grouped') expect(info.hasProvinces).toBe(true);

      // Proiezione reale: regioni risultanti per i paesi del preset.
      const geo = JSON.parse(fs.readFileSync(mapFileFor(mapBase), 'utf-8')) as { features?: MapFeature[] };
      const features = (geo.features ?? []).filter(f => {
        const p = f.properties ?? {};
        const owner = (p.country as string) || (p.code as string);
        return preset.country_codes.includes(owner);
      });
      const byCountry = new Map<string, MapFeature[]>();
      for (const f of features) {
        const p = f.properties ?? {};
        const owner = (p.country as string) || (p.code as string);
        (byCountry.get(owner) ?? byCountry.set(owner, []).get(owner)!).push(f);
      }
      let regions = 0;
      for (const [owner, feats] of byCountry) {
        regions += deriveGroups(feats, level, {
          owner,
          countryName: owner,
          hierarchyKeys: groupingKeysFor(preset.map_grouping),
        }).length;
      }
      // Ogni nazione del preset deve avere almeno una regione.
      expect(byCountry.size).toBe(preset.country_codes.length);
      expect(regions).toBeGreaterThanOrEqual(preset.country_codes.length);
      // Diagnostica leggibile nel report/CI.
      console.log(
        `[PRESETS-REBUILD] ${id}: ${preset.country_codes.length} nazioni · ` +
        `map=${mapBase} (${info.features} feature, ${info.codes.length} paesi) · ` +
        `detail=${preset.map_detail} → ${level} · province coinvolte=${features.length} · regioni=${regions} · copertura=OK`,
      );
    });
  }
});
