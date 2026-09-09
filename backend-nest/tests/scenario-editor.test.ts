/**
 * M01 µ4 — editor del catalogo: route di rapporto, guardia import strict
 * =====================================================================
 * Piano M01 passo 5: checklist con errori per campo (percorsi JSON precisi),
 * anteprima di copertura (chiusura delle filiere §4.4) e nessuna
 * importazione strict con dati bloccanti irrisolti (MAT01).
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import AdmZip from 'adm-zip';

const TEST_DB = path.join(os.tmpdir(), `world-story-scenario-editor-${process.pid}-${Date.now()}.db`);
process.env.OPEN_PAX_DB_PATH = TEST_DB;

let presetsRouter: any;

function callRoute(method: string, url: string, body?: any) {
  return new Promise<any>((resolve, reject) => {
    const cleanUrl = url.split('?')[0];
    const pathPart = (cleanUrl.replace(/^\/templates/, '') || '/');
    const req: any = { method, url: cleanUrl, params: {}, body: body || {}, get: () => undefined, query: {} };
    const res: any = {
      status(code: number) { this.statusCode = code; return this; },
      set(_name: string, _value: string) { return this; },
      json(payload: any) { resolve({ statusCode: this.statusCode, payload }); },
      send(payload: any) { resolve({ statusCode: this.statusCode, payload }); },
      setHeader(_k: string, _v: string) { /* ignore */ },
    };
    try {
      const router = presetsRouter;
      const segments = pathPart.split('/').filter(Boolean);
      let matched = false;
      for (const layer of (router as any).stack) {
        if (layer.route) {
          const routePath = layer.route.path;
          const routeSegments = String(routePath).split('/').filter(Boolean);
          if (layer.route.methods[method.toLowerCase()] && routeSegments.length === segments.length) {
            const params: Record<string, string> = {};
            let ok = true;
            for (let i = 0; i < routeSegments.length; i++) {
              if (routeSegments[i].startsWith(':')) params[routeSegments[i].slice(1)] = segments[i];
              else if (routeSegments[i] !== segments[i]) { ok = false; break; }
            }
            if (ok) {
              req.params = params;
              matched = true;
              // l'ultimo layer della route è il handler (i primi sono middleware
              // come express.raw su /import — il corpo arriva già parsed dal test)
              const handler = layer.route.stack[layer.route.stack.length - 1].handle;
              void handler(req, res);
              break;
            }
          }
        }
      }
      if (!matched) reject(new Error(`route non trovata: ${method} ${url}`));
    } catch (e) { reject(e); }
  });
}

/** Costruisce un zip di preset con un catalogo simulation/ dato. */
function buildZip(id: string, simulationFiles: Record<string, string>): Buffer {
  const zip = new AdmZip();
  zip.addFile('preset.json', Buffer.from(JSON.stringify({
    id, name: `Test ${id}`, description: 'Preset di test', start_date: '1951-01-01',
    country_codes: ['USA'], base_prompt: 'Scenario di test.',
  }), 'utf-8'));
  for (const [name, content] of Object.entries(simulationFiles)) {
    zip.addFile(`simulation/${name}`, Buffer.from(name.endsWith('.json') ? JSON.stringify(content) : 'fonti', 'utf-8'));
  }
  return zip.toBuffer();
}

function readFixtureFile(name: string): Buffer {
  return fs.readFileSync(path.join(process.cwd(), 'data', 'presets', 'realism_test_world', 'simulation', name));
}

beforeAll(async () => {
  process.env.OPEN_PAX_DB_PATH = TEST_DB;
  await import('../src/database');
  ({ presetsRouter } = await import('../src/routes/presets.routes'));
});

afterAll(() => {
  try { fs.rmSync(TEST_DB, { force: true }); } catch { /* best effort */ }
});

describe('M01 µ4 — GET /templates/:id/scenario (rapporto per l’editor)', () => {
  it('fixture valida: hasCatalog, zero errori, copertura con filiera chiusa', async () => {
    const { statusCode, payload } = await callRoute('GET', '/templates/realism_test_world/scenario');
    expect(statusCode ?? 200).toBe(200);
    expect(payload.hasCatalog).toBe(true);
    expect(payload.report.ok).toBe(true);
    expect(payload.report.errors).toEqual([]);
    expect(payload.report.coverage.justified).toEqual(expect.arrayContaining(['coal', 'iron_ore', 'steel', 'tools', 'grain']));
    expect(payload.report.coverage.missing).toEqual([]);
    expect(payload.report.catalogHashes.manifest).toMatch(/^[0-9a-f]{64}$/);
  });

  it('preset legacy: hasCatalog false, report null (nessun finto rapporto)', async () => {
    const { payload } = await callRoute('GET', '/templates/cold_war_1951/scenario');
    expect(payload.hasCatalog).toBe(false);
    expect(payload.report).toBeNull();
  });

  it('preset inesistente → 404', async () => {
    const { statusCode } = await callRoute('GET', '/templates/inesistente/scenario');
    expect(statusCode).toBe(404);
  });
});

describe('M01 µ4 — import strict: nessuna importazione con dati bloccanti (MAT01)', () => {
  it('zip con catalogo valido → 201 e catalogo estratto', async () => {
    const zip = new AdmZip();
    zip.addFile('preset.json', Buffer.from(JSON.stringify({
      id: 'import_ok_m01', name: 'Import OK', description: 'x', start_date: '1951-01-01',
      country_codes: ['ALP'], base_prompt: 'test',
    })));
    for (const name of ['manifest.json', 'polities.json', 'resources.json', 'technologies.json',
      'recipes.json', 'facilities.json', 'actors.json', 'authorities.json', 'initial-state.json', 'sources.md']) {
      zip.addFile(`simulation/${name}`, readFixtureFile(name));
    }
    const { statusCode, payload } = await callRoute('POST', '/templates/import?overwrite=1', zip.toBuffer());
    expect(statusCode).toBe(201);
    expect(payload.template.id).toBe('import_ok_m01');
    // il catalogo è arrivato su disco
    expect(fs.existsSync(path.join(process.cwd(), 'data', 'presets', 'import_ok_m01', 'simulation', 'recipes.json'))).toBe(true);
    const { report } = await import('../src/scenario/loader').then(m => m.loadSimulationCatalog(
      path.join(process.cwd(), 'data', 'presets', 'import_ok_m01')));
    expect(report.ok).toBe(true);
    // pulizia
    fs.rmSync(path.join(process.cwd(), 'data', 'presets', 'import_ok_m01'), { recursive: true, force: true });
  });

  it('zip con catalogo ROTTO → 400 con percorso e motivo, NIENTE scrittura su disco', async () => {
    const brokenResources = JSON.parse(readFixtureFile('resources.json').toString('utf-8'));
    brokenResources.push({ id: 'steel', name: 'Acciaio duplicato', unit: { kind: 'mass', symbol: 'kg' } });
    const zip = new AdmZip();
    zip.addFile('preset.json', Buffer.from(JSON.stringify({
      id: 'import_broken_m01', name: 'Import rotto', description: 'x', start_date: '1951-01-01',
      country_codes: ['ALP'], base_prompt: 'test',
    })));
    zip.addFile('simulation/manifest.json', readFixtureFile('manifest.json'));
    zip.addFile('simulation/resources.json', Buffer.from(JSON.stringify(brokenResources)));
    zip.addFile('simulation/technologies.json', readFixtureFile('technologies.json'));
    zip.addFile('simulation/recipes.json', readFixtureFile('recipes.json'));
    zip.addFile('simulation/facilities.json', readFixtureFile('facilities.json'));
    zip.addFile('simulation/polities.json', readFixtureFile('polities.json'));
    zip.addFile('simulation/actors.json', readFixtureFile('actors.json'));
    zip.addFile('simulation/authorities.json', readFixtureFile('authorities.json'));
    zip.addFile('simulation/initial-state.json', readFixtureFile('initial-state.json'));
    zip.addFile('simulation/sources.md', Buffer.from('# fonti'));
    const { statusCode, payload } = await callRoute('POST', '/templates/import?overwrite=1', zip.toBuffer());
    expect(statusCode).toBe(400);
    expect(payload.error).toContain('Import strict rifiutato');
    expect(payload.error).toContain('duplicate_id');
    // nessun dato scritto su disco: la directory del preset non esiste
    expect(fs.existsSync(path.join(process.cwd(), 'data', 'presets', 'import_rotto_m01'))).toBe(false);
  });
});

describe('M01 µ4 — coverage nel validatore', () => {
  it('input senza fonte finisce in coverage.missing e nel rapporto', async () => {
    const { validateCatalog } = await import('../src/scenario/loader');
    const read = (n: string) => JSON.parse(fs.readFileSync(path.join(process.cwd(), 'data', 'presets', 'realism_test_world', 'simulation', n), 'utf-8'));
    const files: any = {
      manifest: read('manifest.json'), polities: read('polities.json'), resources: read('resources.json'),
      technologies: read('technologies.json'), recipes: read('recipes.json'), facilities: read('facilities.json'),
      actors: read('actors.json'), authorities: read('authorities.json'), 'initial-state': read('initial-state.json'),
    };
    files.recipes.push({
      id: 'r_jet', name: 'Caccia', facilityTypeId: 'ft_works',
      inputs: [{ resourceId: 'titanium', baseUnits: '30' }],
      outputs: [{ resourceId: 'fighter', baseUnits: '1' }],
      durationDays: 10,
    });
    files.resources.push({ id: 'titanium', name: 'Titanio', unit: { kind: 'mass', symbol: 'kg' }, transportable: true, conserved: true });
    files.resources.push({ id: 'fighter', name: 'Caccia', unit: { kind: 'count', symbol: 'pz' }, transportable: true, conserved: true, discrete: true });
    const report = validateCatalog(files);
    expect(report.coverage.missing).toEqual(['titanium']);
    expect(report.coverage.justified).toContain('steel');
    expect(report.ok).toBe(false);
  });
});