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
import { detectGroupingKeys, hasProvinceFeatures } from './mapGrouping';

const editor = fs.readFileSync(path.resolve(__dirname, 'PresetEditorModal.tsx'), 'utf8');

describe('MAP-DETAIL — preset editor', () => {
  it('offre i tre livelli con etichette chiare', () => {
    expect(editor).toContain("value: 'nations', label: 'Solo nazioni'");
    expect(editor).toContain("value: 'grouped', label: 'Regioni raggruppate'");
    expect(editor).toContain("value: 'full', label: 'Massimo dettaglio'");
  });

  it('disabilita full/grouped quando la mappa non è provinciale', () => {
    expect(editor).toContain("disabled={!provinceMap && option.value !== 'nations'}");
    expect(editor).toContain("map_detail: provinceMap ? effectiveDetail : 'nations'");
  });

  it('permette di scegliere/modificare la proprietà di raggruppamento', () => {
    // Campo editabile con suggerimenti: serve a creare preset storici.
    expect(editor).toContain('preset-map-grouping');
    expect(editor).toContain('list="preset-map-grouping-keys"');
    expect(editor).toContain('placeholder="Automatico (criterio geografico)"');
    expect(editor).toContain("map_grouping: provinceMap && grouping ? grouping : ''");
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
