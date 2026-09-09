/**
 * M01 µ1 — Catalogo di scenario: loader, validatore e fixture sintetica.
 * =====================================================================
 * Test di contratto locale (piano M01 passi 1–3): import strict con
 * percorso e motivo (MAT01), `unknown` dichiarato senza fabbricare dati
 * (MAT02), DAG conoscenze, ricette amplificatrici e cicli a tempo zero
 * rifiutati, chiusura transitiva delle filiere (§4.4), hash di contenuto
 * come base cache (MAT18). La fixture `realism_test_world` è dichiarata-
 * mente non storica: valuta TEST, quantità inventate verificabili.
 */
import { describe, expect, it } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { catalogHash, loadSimulationCatalog, validateCatalog, type CatalogFiles } from '../src/scenario/loader';
import { isIntString } from '../src/scenario/types';

const FIXTURE_DIR = path.join(process.cwd(), 'data', 'presets', 'realism_test_world');

/** Base valida della fixture, con patch applicate (per i casi rotti). */
function baseFiles(): CatalogFiles {
  const read = (name: string) => JSON.parse(fs.readFileSync(path.join(FIXTURE_DIR, 'simulation', name), 'utf-8'));
  return {
    manifest: read('manifest.json'),
    polities: read('polities.json'),
    resources: read('resources.json'),
    technologies: read('technologies.json'),
    recipes: read('recipes.json'),
    facilities: read('facilities.json'),
    actors: read('actors.json'),
    authorities: read('authorities.json'),
    'initial-state': read('initial-state.json'),
  };
}

function writeTmpCatalog(files: CatalogFiles): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'world-story-scenario-'));
  const simDir = path.join(dir, 'simulation');
  fs.mkdirSync(simDir);
  const names: Array<[keyof CatalogFiles, string]> = [
    ['manifest', 'manifest.json'], ['polities', 'polities.json'], ['resources', 'resources.json'],
    ['technologies', 'technologies.json'], ['recipes', 'recipes.json'], ['facilities', 'facilities.json'],
    ['actors', 'actors.json'], ['authorities', 'authorities.json'], ['initial-state', 'initial-state.json'],
  ];
  for (const [key, fileName] of names) {
    if (files[key] !== undefined) fs.writeFileSync(path.join(simDir, fileName), JSON.stringify(files[key], null, 2));
  }
  return dir;
}

describe('M01 µ1 — codec numerico §4.1', () => {
  it('IntString accetta solo stringhe decimali canoniche', () => {
    expect(isIntString('0')).toBe(true);
    expect(isIntString('123')).toBe(true);
    expect(isIntString('-42')).toBe(true);
    expect(isIntString('-0')).toBe(false);
    expect(isIntString('01')).toBe(false);
    expect(isIntString('1.5')).toBe(false);
    expect(isIntString('0x10')).toBe(false);
    expect(isIntString(' 1')).toBe(false);
    expect(isIntString(12)).toBe(false);
    expect(isIntString(NaN)).toBe(false);
    expect(isIntString(Infinity)).toBe(false);
  });
});

describe('M01 µ1 — fixture realism_test_world valida', () => {
  it('la fixture sintetica sul disco carica senza errori bloccanti', () => {
    const { catalog, report } = loadSimulationCatalog(FIXTURE_DIR);
    expect(report.errors).toEqual([]);
    expect(catalog).not.toBeNull();
    expect(catalog!.manifest.declaration).toBe('synthetic');
    expect(catalog!.manifest.currency.id).toBe('TEST');
    expect(catalog!.polities).toHaveLength(2);
    expect(catalog!.recipes.length).toBeGreaterThanOrEqual(4);
    // filiera chiusa: acciaio giustificato da miniera + altoforno
    expect(catalog!.resources.map(r => r.id)).toContain('steel');
  });

  it('ogni file di catalogo ha un hash di contenuto (basis cache MAT18)', () => {
    const files = baseFiles();
    const hashes = catalogHash(files);
    expect(Object.keys(hashes).sort()).toEqual(['actors', 'authorities', 'facilities', 'initial-state', 'manifest', 'polities', 'recipes', 'resources', 'technologies'].sort());
    // contenuto diverso → hash diverso
    const patched = { ...files, manifest: { ...(files.manifest as any), version: 2 } };
    expect(catalogHash(patched).manifest).not.toBe(hashes.manifest);
    // stesso contenuto → stesso hash
    expect(catalogHash(baseFiles()).manifest).toBe(hashes.manifest);
  });
});

describe('M01 µ1 — MAT01: import strict rifiutato con percorso e motivo', () => {
  it('riferimento a risorsa non definita', () => {
    const files = baseFiles();
    (files.recipes as any[])[2].inputs[0].resourceId = 'unobtanium';
    const report = validateCatalog(files);
    expect(report.ok).toBe(false);
    expect(report.errors.some(e => e.code === 'unknown_ref' && e.path === 'recipes[2].inputs[0].resourceId')).toBe(true);
  });

  it('ciclo nel grafo delle conoscenze rifiutato', () => {
    const files = baseFiles();
    (files.technologies as any[])[0].requires = ['toolmaking'];
    const report = validateCatalog(files);
    expect(report.errors.some(e => e.code === 'dag_cycle')).toBe(true);
  });

  it('quantità non canonica (float, zero pilota, -0) rifiutata', () => {
    const files = baseFiles();
    (files.recipes as any[])[2].outputs[0].baseUnits = '50.5';
    const files2 = baseFiles();
    (files2.recipes as any[])[2].outputs[0].baseUnits = '-0';
    expect(validateCatalog(files).errors.some(e => e.code === 'bad_int' && e.path.includes('recipes[2].outputs[0].baseUnits'))).toBe(true);
    expect(validateCatalog(files2).errors.some(e => e.code === 'bad_int')).toBe(true);
  });

  it('conto in valuta diversa dalla valuta del manifest rifiutato', () => {
    const files = baseFiles();
    (files['initial-state'] as any).treasuries[0].currencyId = 'USD';
    const report = validateCatalog(files);
    expect(report.errors.some(e => e.code === 'currency_mismatch')).toBe(true);
  });

  it('file di catalogo mancante produce errore con percorso', () => {
    const dir = writeTmpCatalog(baseFiles());
    fs.rmSync(path.join(dir, 'simulation', 'recipes.json'));
    const { report } = loadSimulationCatalog(dir);
    expect(report.ok).toBe(false);
    expect(report.errors.some(e => e.code === 'missing_file' && e.path === 'recipes')).toBe(true);
  });
});

describe('M01 µ1 — amplificazione e chiusura transitiva (§4.4, MAT34 parziale)', () => {
  it('ricetta amplificatrice sulla stessa risorsa rifiutata senza allowsRecycle', () => {
    const files = baseFiles();
    (files.recipes as any[])[2].inputs = [{ resourceId: 'steel', baseUnits: '10' }];
    (files.recipes as any[])[2].outputs = [{ resourceId: 'steel', baseUnits: '20' }];
    const report = validateCatalog(files);
    expect(report.errors.some(e => e.code === 'amplifying_recipe')).toBe(true);
  });

  it('ciclo a tempo zero rifiutato: durata 0 non è una ricetta', () => {
    const files = baseFiles();
    (files.recipes as any[])[2].durationDays = 0;
    const report = validateCatalog(files);
    expect(report.errors.some(e => e.code === 'bad_duration')).toBe(true);
  });

  it('input senza stock, giacimento o filiera: errore di chiusura', () => {
    const files = baseFiles();
    (files.recipes as any[]).push({
      id: 'r_jet', name: 'Aerei da caccia', facilityTypeId: 'ft_works',
      inputs: [{ resourceId: 'titanium', baseUnits: '30' }],
      outputs: [{ resourceId: 'fighter', baseUnits: '1' }],
      durationDays: 10,
    });
    const report = validateCatalog(files);
    expect(report.errors.some(e => e.code === 'unknown_ref')).toBe(true);
    // la chiusura segnala l'input senza fonte una volta definita la risorsa
    (files.resources as any[]).push({ id: 'titanium', name: 'Titanio', unit: { kind: 'mass', symbol: 'kg' }, transportable: true, conserved: true });
    (files.resources as any[]).push({ id: 'fighter', name: 'Caccia', unit: { kind: 'count', symbol: 'pz' }, transportable: true, conserved: true, discrete: true });
    const report2 = validateCatalog(files);
    expect(report2.errors.some(e => e.code === 'unjustified_input' && e.path === 'recipes[r_jet].inputs')).toBe(true);
  });

  it('filiera giustificata a punto fisso: catena ricorsiva accettata', () => {
    // tools ← steel ← iron_ore+coal ← miniere: tutta la catena è chiusa
    const report = validateCatalog(baseFiles());
    expect(report.ok).toBe(true);
  });

  it('giacimento senza quantità nota né stima: warning unknown, non errore (MAT02)', () => {
    const files = baseFiles();
    (files['initial-state'] as any).deposits[0].known = null;
    const report = validateCatalog(files);
    expect(report.errors.filter(e => e.path.includes('deposits[0]'))).toEqual([]);
    expect(report.warnings.some(w => w.code === 'unknown_quantity' && w.path === 'initial-state.deposits[0].known')).toBe(true);
  });
});

describe('M01 µ1 — preset legacy senza simulation/', () => {
  it('dichiarato legacy con warning, mai migrato silenziosamente', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'world-story-legacy-'));
    const { catalog, report } = loadSimulationCatalog(dir);
    expect(catalog).toBeNull();
    expect(report.ok).toBe(true);
    expect(report.warnings.some(w => w.code === 'no_catalog')).toBe(true);
  });
});