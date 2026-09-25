/**
 * World Story — P01: i mondi giocabili sono a province complete
 * ============================================================
 * La richiesta: «riduci i mondi, i preset devono essere a province complete».
 *
 * La misura che ha guidato l'eliminazione: `europa_1815` e `mondo_1989` usavano
 * la mappa `standard` (Natural Earth: **una regione per nazione**), e
 * `paxh_ww2_provinces` era una mappa **nazionale** — 223 Stati, **0 province** —
 * pur avendo «provinces» nel nome.
 *
 * Questi test difendono tre cose: che ogni mondo offerto al giocatore sia a
 * province, che le fixture tecniche non compaiano fra i mondi, e che i preset
 * eliminati restino eliminati.
 */
import { describe, expect, it } from 'vitest';
import fs from 'fs';
import path from 'path';
import { listPlayablePresets, listPresets, loadPreset, PRESETS_DIR } from '../src/utils/preset-loader';
import { loadNativeMap, normalizeMapBase, DEFAULT_NATIVE_MAP_ID, listNativeMaps } from '../src/utils/native-maps';

/** Un preset è «a province» se ha più province per almeno una nazione. */
function provinceCount(presetId: string): { features: number; provinces: number } {
  const preset = loadPreset(presetId)!;
  const nativeId = normalizeMapBase(preset.map_base) ?? DEFAULT_NATIVE_MAP_ID;
  const features = preset.has_custom_map
    ? (JSON.parse(fs.readFileSync(path.join(PRESETS_DIR, presetId, 'map.geojson'), 'utf8')).features ?? [])
    : (loadNativeMap(nativeId)?.features ?? []);
  const provinces = features.filter((f: any) => {
    const p = f?.properties ?? {};
    return p.country && p.country !== p.code;
  }).length;
  return { features: features.length, provinces };
}

describe('P01 — ogni mondo giocabile è a province complete', () => {
  it('l\'elenco del giocatore non contiene mondi a nazioni', () => {
    const playable = listPlayablePresets();
    // Guardia contro il falso verde: l'elenco non è vuoto.
    expect(playable.length).toBeGreaterThan(0);

    const offenders: string[] = [];
    for (const preset of playable) {
      const { provinces } = provinceCount(preset.id);
      if (provinces === 0) offenders.push(`${preset.id}: 0 province`);
    }
    expect(offenders).toEqual([]);
  });

  it('le fixture tecniche non sono offerte al giocatore, ma restano caricabili', () => {
    const playable = listPlayablePresets().map(p => p.id);
    const all = listPresets().map(p => p.id);

    // La fixture non è fra i mondi…
    expect(playable).not.toContain('realism_test_world');
    // …ma esiste ancora per i test, che la caricano direttamente.
    expect(all).toContain('realism_test_world');
    expect(loadPreset('realism_test_world')).not.toBeNull();
    expect(loadPreset('realism_test_world')!.fixture).toBe(true);
  });

  it('i preset non provinciali sono eliminati, non solo nascosti', () => {
    for (const gone of ['europa_1815', 'mondo_1989', 'paxh_ww2_provinces']) {
      expect(loadPreset(gone), `${gone} non deve più esistere`).toBeNull();
      expect(fs.existsSync(path.join(PRESETS_DIR, gone)), `${gone} non deve avere una cartella`).toBe(false);
    }
  });

  it('l\'elenco del giocatore è quello atteso, e ogni voce dichiara una mappa', () => {
    const playable = listPlayablePresets();
    expect(playable.map(p => p.id).sort()).toEqual([
      'europa_1914', 'millennium_dawn', 'modern_world_provinces', 'mondo_1936', 'pax_modern_provinces',
    ]);
    // Ogni mondo ha una mappa propria o una mappa nativa provinciale.
    for (const preset of playable) {
      const nativeId = normalizeMapBase(preset.map_base) ?? DEFAULT_NATIVE_MAP_ID;
      const info = listNativeMaps().find(m => m.id === nativeId);
      if (preset.has_custom_map) continue;
      expect(info, `${preset.id}: mappa nativa ${nativeId} non trovata`).toBeDefined();
      expect(info!.hasProvinces, `${preset.id}: mappa ${nativeId} non è provinciale`).toBe(true);
    }
  });
});

describe('P01 — le mappe native selezionabili sono provinciali', () => {
  it('l\'elenco delle mappe non offre più la mappa a nazioni ww2', () => {
    const ids = listNativeMaps().map(m => m.id);
    expect(ids).toEqual(['standard', 'modern_world_provinces', 'pax_modern_provinces']);
    // `standard` resta perché è il ripiego geografico, non una mappa di mondi.
    expect(ids).toContain('standard');
    expect(ids).not.toContain('paxh_ww2_provinces');
  });

  it('la mappa ww2 non è più caricabile dal motore', () => {
    // Toglierla dall'elenco non basta: il caricamento deve rifiutarla, altrimenti
    // resta una porta per generare un mondo non provinciale.
    expect(loadNativeMap('paxh_ww2_provinces')).toBeNull();
    expect(normalizeMapBase('paxh_ww2_provinces')).toBeUndefined();
  });

  it('il GeoJSON della mappa ww2 è conservato come archivio', () => {
    // Non si butta un dato: il file resta fuori dai preset, non selezionabile.
    const archive = path.join(process.cwd(), 'data', 'geojson', 'ww2_nations.geojson');
    expect(fs.existsSync(archive)).toBe(true);
  });
});
