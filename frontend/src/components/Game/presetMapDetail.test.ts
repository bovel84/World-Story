/**
 * MAP-DETAIL — selettore del livello nel preset editor.
 * =====================================================
 * Il preset può dichiarare il dettaglio della mappa (`nations` | `grouped` |
 * `full`) e, per preset storici, la proprietà di raggruppamento
 * (`map_grouping`). Senza una mappa provinciale (`properties.country` ≠ `code`)
 * solo `nations` è disponibile; la scelta viene salvata in `preset.json`.
 *
 * Il comportamento di generazione è verificato dalle funzioni pure lato
 * backend (`backend-nest/tests/map-detail.test.ts`).
 */
import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { detectGroupingKeys, effectiveProvinceMap, hasProvinceFeatures, mapDetailOptionDisabled } from './mapGrouping';

const editor = fs.readFileSync(path.resolve(__dirname, 'PresetEditorModal.tsx'), 'utf8');
const css = fs.readFileSync(path.resolve(__dirname, '../../index.css'), 'utf8');

describe('MAP-DETAIL — preset editor', () => {
  it('offre i tre livelli con etichette chiare', () => {
    expect(editor).toContain("value: 'nations', label: 'Solo nazioni'");
    expect(editor).toContain("value: 'grouped', label: 'Regioni raggruppate'");
    expect(editor).toContain("value: 'full', label: 'Massimo dettaglio'");
  });

  it('disabilita full/grouped quando la mappa non è provinciale', () => {
    expect(editor).toContain("disabled={mapDetailOptionDisabled(provinceMap, option.value)}");
    expect(editor).toContain("map_detail: provinceMap ? effectiveDetail : 'nations'");
  });

  it('il fieldset del livello NON è disabilitato (non blocca «Solo nazioni»)', () => {
    // Regressione: `<fieldset disabled>` disabiliterebbe anche il radio disponibile.
    expect(editor).not.toMatch(/<fieldset className="preset-map-detail" disabled/);
    expect(editor).toContain('<fieldset className="preset-map-detail">');
  });

  it('il fieldset del raggruppamento resta disabilitato solo fuori da grouped', () => {
    expect(editor).toContain("disabled={effectiveDetail !== 'grouped'}");
  });

  it('il grigio delle opzioni deriva dallo stato del radio, non dal fieldset', () => {
    expect(css).toContain('.preset-map-detail input:disabled + span');
  });

  it('offre un selettore di mappa nativa, non solo il caricamento file', () => {
    expect(editor).toContain('preset-map-base');
    expect(editor).toContain('templatesApi.getNativeMaps()');
    expect(editor).toContain('name="preset-map-base"');
    // Salva la mappa nativa scelta.
    expect(editor).toContain('map_base: selectedBase');
  });

  it('il selettore nativo è toccabile su mobile (target ≥44px, cursore)', () => {
    expect(css).toContain('.preset-map-base-option');
    expect(css).toMatch(/\.preset-map-base-option\s*\{[^}]*min-height:\s*44px/);
    expect(css).toMatch(/\.preset-map-base-option\s*\{[^}]*cursor:\s*pointer/);
  });

  it('permette di scegliere/modificare la proprietà di raggruppamento', () => {
    // Campo editabile con suggerimenti: serve a creare preset storici.
    expect(editor).toContain('preset-map-grouping');
    expect(editor).toContain('list="preset-map-grouping-keys"');
    expect(editor).toContain('placeholder="Automatico (criterio geografico)"');
    expect(editor).toContain("map_grouping: provinceMap && grouping ? grouping : ''");
  });
});

describe('MAP-NATIVE — abilitazione con mappa nativa (funzioni pure)', () => {
  it('il file proprio vince sulla mappa nativa', () => {
    // hasOwnMap=true → conta la mappa propria, non quella nativa.
    expect(effectiveProvinceMap(true, false, true)).toBe(false);
    expect(effectiveProvinceMap(true, true, false)).toBe(true);
  });

  it('senza file proprio conta la mappa nativa scelta', () => {
    expect(effectiveProvinceMap(false, false, true)).toBe(true);   // es. pax_modern_provinces
    expect(effectiveProvinceMap(false, false, false)).toBe(false); // es. standard / paxh_ww2
  });

  it('una mappa nativa provinciale abilita i tre livelli', () => {
    const provinceMap = effectiveProvinceMap(false, false, true);
    for (const value of ['nations', 'grouped', 'full'] as const) {
      expect(mapDetailOptionDisabled(provinceMap, value)).toBe(false);
    }
  });

  it('una mappa nativa senza province lascia solo «Solo nazioni»', () => {
    const provinceMap = effectiveProvinceMap(false, false, false);
    expect(mapDetailOptionDisabled(provinceMap, 'nations')).toBe(false);
    expect(mapDetailOptionDisabled(provinceMap, 'grouped')).toBe(true);
    expect(mapDetailOptionDisabled(provinceMap, 'full')).toBe(true);
  });
});

describe('MAP-DETAIL — abilitazione delle opzioni (funzione pura)', () => {
  it('senza mappa provinciale solo «Solo nazioni» è abilitata', () => {
    expect(mapDetailOptionDisabled(false, 'nations')).toBe(false); // abilitato
    expect(mapDetailOptionDisabled(false, 'grouped')).toBe(true);
    expect(mapDetailOptionDisabled(false, 'full')).toBe(true);
  });

  it('con mappa provinciale tutte e tre le opzioni sono abilitate', () => {
    for (const value of ['nations', 'grouped', 'full'] as const) {
      expect(mapDetailOptionDisabled(true, value)).toBe(false);
    }
  });
});

describe('MAP-DETAIL — mapGrouping (funzioni pure)', () => {
  const feature = (code: string, props: Record<string, unknown> = {}) => ({
    type: 'Feature',
    properties: { code, country: 'AAA', name: code, ...props },
    geometry: { type: 'Polygon', coordinates: [] },
  });

  it('riconosce una mappa provinciale solo con country ≠ code', () => {
    expect(hasProvinceFeatures({ features: [feature('A1')] })).toBe(true);
    expect(hasProvinceFeatures({ features: [{ properties: { code: 'ITA' } }] })).toBe(false);
    expect(hasProvinceFeatures(null)).toBe(false);
  });

  it('rileva una gerarchia storica personalizzata, ordinata per numero di gruppi', () => {
    const map = { features: [
      feature('A1', { region: 'Nord', era: '1914' }),
      feature('A2', { region: 'Nord', era: '1914' }),
      feature('A3', { region: 'Sud', era: '1920' }),
      feature('A4', { region: 'Sud', era: '1920' }),
    ] };
    // region → 2 gruppi, era → 2 gruppi: entrambe candidate (stabile per nome).
    expect(detectGroupingKeys(map)).toEqual(['era', 'region']);
  });

  it('ignora identificatori univoci, valori costanti e proprietà non scalari', () => {
    const map = { features: [
      feature('A1', { zone: 'X', note: ['a'], same: 1 }),
      feature('A2', { zone: 'Y', note: ['b'], same: 1 }),
      feature('A3', { zone: 'X', note: ['c'], same: 1 }),
    ] };
    const keys = detectGroupingKeys(map);
    expect(keys).toContain('zone');
    expect(keys).not.toContain('code');   // univoco
    expect(keys).not.toContain('name');   // escluso
    expect(keys).not.toContain('country');
    expect(keys).not.toContain('same');   // costante
    expect(keys).not.toContain('note');   // non scalare
  });

  it('non propone nulla su mappe troppo piccole', () => {
    expect(detectGroupingKeys({ features: [feature('A1'), feature('A2')] })).toEqual([]);
    expect(detectGroupingKeys({})).toEqual([]);
  });
});
