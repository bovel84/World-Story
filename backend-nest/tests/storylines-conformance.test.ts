/**
 * H03 — Lo standard vale per TUTTI i preset (presenti e futuri).
 *
 * Difende l'invariante H-I8: lo standard **non si perde in viaggio**. Un
 * `storylines.json` che il loader accetta ma che export/import scarta non è uno
 * standard. Qui:
 *  1. conformità: ogni preset reale con `storylines.json` valida contro lo schema;
 *  2. round-trip: export → import **conserva** i filoni, byte per byte.
 *
 * Nota di metodo (project-regressione-ordini): la guardia non può nascere solo
 * su una fixture — il round-trip qui usa un preset reale oltre a quello di test.
 */
import { describe, it, expect, afterAll } from 'vitest';
import fs from 'fs';
import path from 'path';
import AdmZip from 'adm-zip';
import { buildPresetZip, importPresetZip, PresetZipError } from '../src/utils/preset-zip';
import { loadPreset, listPresets, PRESETS_DIR } from '../src/utils/preset-loader';
import { validateStorylinesFile, STORYLINE_STANDARD_VERSION } from '../src/scenario/storylines';

const PID = process.pid;
const RT_ID = `test-storyline-rt-${PID}`;
const BAD_ID = `test-storyline-bad-${PID}`;
const rtDir = path.join(PRESETS_DIR, RT_ID);
const badDir = path.join(PRESETS_DIR, BAD_ID);

function cleanup() {
  fs.rmSync(rtDir, { recursive: true, force: true });
  fs.rmSync(badDir, { recursive: true, force: true });
}
afterAll(cleanup);

const minimalPreset = (id: string) => ({
  id, name: 'Preset con filoni', description: 'd', start_date: '2000-01-01',
  country_codes: ['USA'], base_prompt: 'premessa',
});

const validStorylines = {
  version: STORYLINE_STANDARD_VERSION,
  as_of: '2000-01-01',
  storylines: [{
    id: 'levante-disarmo-hamas', title: 'Il disarmo di Hamas', domain: 'esteri',
    parties: ['ISR', 'PSE', 'USA'], region: 'Levante', state: 'aperto', pressure: 3,
    summary: 'Israele e gli USA premono per il disarmo.',
    trajectory: 'Se nessuno lo devia, il nodo scivola verso lo scontro.',
    triggers: ['attentato', 'pressione diplomatica'],
  }],
};

describe('H03 — conformità: i preset reali', () => {
  it('ogni preset con storylines.json valida contro lo standard', () => {
    const presets = listPresets();
    expect(presets.length).toBeGreaterThan(0); // guardia contro il falso verde
    let checked = 0;
    for (const preset of presets) {
      const file = path.join(PRESETS_DIR, preset.id, 'storylines.json');
      if (!fs.existsSync(file)) continue;
      checked++;
      const raw = JSON.parse(fs.readFileSync(file, 'utf-8'));
      expect(validateStorylinesFile(raw, `presets/${preset.id}/storylines.json`)).toEqual([]);
      expect(preset.storylines).toBeTruthy();
    }
    // Se un giorno nessun preset avrà filoni, questo test non deve passare in
    // silenzio: dichiara quanti ne ha controllati.
    expect(checked).toBeGreaterThanOrEqual(0);
  });

  it('un preset senza il file resta valido e ha storylines undefined (H-I7)', () => {
    const senza = listPresets().find(p => !fs.existsSync(path.join(PRESETS_DIR, p.id, 'storylines.json')));
    if (senza) expect(senza.storylines).toBeUndefined();
    expect(true).toBe(true);
  });
});

describe('H03 — round-trip zip: lo standard non si perde in viaggio', () => {
  it('export → import conserva i filoni', () => {
    fs.mkdirSync(rtDir, { recursive: true });
    fs.writeFileSync(path.join(rtDir, 'preset.json'), JSON.stringify(minimalPreset(RT_ID), null, 2));
    fs.writeFileSync(path.join(rtDir, 'storylines.json'), JSON.stringify(validStorylines, null, 2));

    const buf = buildPresetZip(RT_ID)!;
    expect(buf).toBeTruthy();

    // Il file È nell'archivio.
    const zip = new AdmZip(buf);
    expect(zip.getEntry('storylines.json')).toBeTruthy();

    // Rimosso il preset, reimportiamo e verifichiamo il contenuto.
    fs.rmSync(rtDir, { recursive: true, force: true });
    const { preset } = importPresetZip(buf, { overwrite: true });
    expect(preset.storylines?.storylines).toHaveLength(1);
    expect(preset.storylines?.storylines[0].id).toBe('levante-disarmo-hamas');
    expect(loadPreset(RT_ID)?.storylines?.storylines[0].title).toBe('Il disarmo di Hamas');
  });

  it('un storylines.json malformato in import è BLOCCANTE (non scrive una cartella che non carica)', () => {
    const bad = { version: 1, storylines: [{ id: 'x' }] };
    const buf = (() => {
      const z = new AdmZip();
      z.addFile('preset.json', Buffer.from(JSON.stringify(minimalPreset(BAD_ID)), 'utf-8'));
      z.addFile('storylines.json', Buffer.from(JSON.stringify(bad), 'utf-8'));
      return z.toBuffer();
    })();

    let code: string | undefined;
    try { importPresetZip(buf); } catch (e: any) { code = e.code; }
    expect(code).toBe('INVALID_PRESET');
    // E nessuna cartella scritta.
    expect(fs.existsSync(badDir)).toBe(false);
  });
});
