/**
 * MAP-DETAIL — selettore del livello nel preset editor.
 * =====================================================
 * Il preset può dichiarare il dettaglio della mappa (`nations` | `grouped` |
 * `full`). Senza una mappa provinciale (`properties.country` ≠ `code`) solo
 * `nations` è disponibile; la scelta viene salvata in `preset.json`.
 *
 * Il comportamento di generazione è verificato dalle funzioni pure lato
 * backend (`backend-nest/tests/map-detail.test.ts`).
 */
import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const editor = fs.readFileSync(path.resolve(__dirname, 'PresetEditorModal.tsx'), 'utf8');

describe('MAP-DETAIL — preset editor', () => {
  it('offre i tre livelli con etichette chiare', () => {
    expect(editor).toContain("value: 'nations', label: 'Solo nazioni'");
    expect(editor).toContain("value: 'grouped', label: 'Regioni raggruppate'");
    expect(editor).toContain("value: 'full', label: 'Massimo dettaglio'");
  });

  it('riconosce una mappa provinciale da properties.country', () => {
    expect(editor).toContain('function hasProvinceFeatures');
    expect(editor).toContain('props.country !== props.code');
  });

  it('disabilita full/grouped quando la mappa non è provinciale', () => {
    expect(editor).toContain("disabled={!provinceMap && option.value !== 'nations'}");
    expect(editor).toContain("map_detail: provinceMap ? effectiveDetail : 'nations'");
  });
});
