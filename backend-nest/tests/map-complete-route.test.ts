/**
 * MAP-COMPLETE — integrazione della generazione mondo
 * ===================================================
 * Il test chiama il VERO handler `POST /worlds/generate` (router Express invocato
 * direttamente, nessun server HTTP) con un provider LLM stub. Un preset
 * sintetico ha 3 feature: due province del paese `AAA` (l'unico nei
 * `country_codes`) e una nazione `BBB` che NON compare in `country_codes`.
 * Prima della correzione `BBB` non sarebbe esistita: la mappa aveva un buco.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';

const TEST_DB = path.join(os.tmpdir(), `world-story-map-complete-route-${process.pid}-${Date.now()}.db`);
process.env.OPEN_PAX_DB_PATH = TEST_DB;

const PRESET_ID = `mapcomplete${process.pid}${Date.now().toString(36)}`;
const PRESET_DIR = path.join(process.cwd(), 'data', 'presets', PRESET_ID);

/** Router LLM finto: risponde a ogni batch con stati fissi. */
const llmCalls = { count: 0 };
const stubRouter = {
  generate: (_mechanic: string, _system: string, user: string) => {
    llmCalls.count += 1;
    const codes = [...user.matchAll(/^([A-Z]{3}):/gm)].map(m => m[1]);
    const countries: Record<string, unknown> = {};
    for (const code of codes) {
      countries[code] = { population: 5_000_000, gdp: 20, military: 20, ideology: 'repubblica', allies: [], enemies: [], status: 'regional' };
    }
    return Promise.resolve({ content: JSON.stringify({ countries }) });
  },
  clearCache: () => undefined,
};

vi.mock('../src/llm', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../src/llm')>();
  return { ...actual, getLLMRouter: () => stubRouter };
});

const square = (x: number, y: number) => ({
  type: 'Polygon',
  coordinates: [[[x, y], [x + 2, y], [x + 2, y + 2], [x, y + 2], [x, y]]],
});

function writePreset(): void {
  fs.mkdirSync(PRESET_DIR, { recursive: true });
  fs.writeFileSync(path.join(PRESET_DIR, 'preset.json'), JSON.stringify({
    id: PRESET_ID,
    name: 'Mappa completa (prova)',
    description: 'Preset sintetico: una sola nazione consigliata, due politie sulla mappa.',
    country_codes: ['AAA'],
    countries: [{ code: 'AAA', name: 'Alfa', color: '#112233' }],
    base_prompt: 'Preset sintetico per la mappa completa.',
    start_date: '1951-01-01',
    historical_accuracy: 0.8,
  }, null, 2));
  fs.writeFileSync(path.join(PRESET_DIR, 'map.geojson'), JSON.stringify({
    type: 'FeatureCollection',
    features: [
      { type: 'Feature', properties: { code: 'p1', country: 'AAA' }, geometry: square(0, 40) },
      { type: 'Feature', properties: { code: 'p2', country: 'AAA' }, geometry: square(2, 40) },
      { type: 'Feature', properties: { code: 'BBB', name: 'Beta' }, geometry: square(4, 40) },
    ],
  }, null, 2));
}

function removePreset(): void {
  try { fs.rmSync(PRESET_DIR, { force: true, recursive: true }); } catch { /* best effort */ }
}

interface FakeResponse {
  statusCode: number;
  body: any;
  status(code: number): FakeResponse;
  json(payload: any): FakeResponse;
}

function fakeRes(): FakeResponse {
  return {
    statusCode: 200,
    body: undefined,
    status(code: number) { this.statusCode = code; return this; },
    json(payload: any) { this.body = payload; return this; },
  };
}

/** Invoca il router Express come middleware: nessun server, nessuna rete. */
async function postGenerate(body: Record<string, unknown>): Promise<FakeResponse> {
  const { worldsRouter } = await import('../src/routes/worlds.routes');
  const res = fakeRes();
  const req: any = { method: 'POST', url: '/generate', originalUrl: '/generate', body, headers: {} };
  await new Promise<void>((resolve) => {
    (worldsRouter as any)(req, res, () => resolve());
    // Il handler con `sync: true` risponde in modo asincrono: attesa breve.
    const timer = setInterval(() => { if (res.body !== undefined) { clearInterval(timer); resolve(); } }, 5);
    setTimeout(() => { clearInterval(timer); resolve(); }, 60_000);
  });
  return res;
}

let db: any;

beforeAll(async () => {
  writePreset();
  const database = await import('../src/database');
  database.initDatabase();
  db = database.default;
});

afterAll(() => {
  removePreset();
  try { fs.rmSync(TEST_DB, { force: true }); } catch { /* best effort */ }
});

describe('MAP-COMPLETE — la route genera una regione per OGNI polity della mappa', () => {
  it('una nazione fuori dai country_codes esiste, ed è giocabile', async () => {
    const res = await postGenerate({ templateId: PRESET_ID, playerCountryCode: 'BBB', sync: true });

    expect(res.statusCode).toBe(200);
    expect(res.body.error).toBeUndefined();
    const worldId = res.body.worldId as string;
    expect(worldId).toBeTruthy();

    const rows = db.prepare(
      'SELECT DISTINCT COALESCE(NULLIF(flag, \'\'), owner) AS code FROM world_regions WHERE world_id = ?',
    ).all(worldId) as { code: string }[];
    const owners = rows.map(row => row.code).sort();
    // `BBB` non è nei country_codes: esiste solo perché sta sulla mappa.
    expect(owners).toEqual(['AAA', 'BBB']);

    const total = db.prepare('SELECT COUNT(*) AS n FROM world_regions WHERE world_id = ?')
      .get(worldId) as { n: number };
    // 2 province di AAA + 1 regione di BBB: nessuna provincia orfana.
    expect(total.n).toBe(3);

    // La nazione scelta ha la sua regione iniziale (partita avviabile).
    expect(res.body.playerCountryCode).toBe('BBB');
    expect(String(res.body.regionIds.BBB)).toContain('BBB');

    // Il modello è interrogato solo per la nazione curata (un batch da 16).
    expect(llmCalls.count).toBe(1);
  });

  it('rigenerare lo stesso mondo non costa altre chiamate LLM (cache/riuso)', async () => {
    const callsAfterFirst = llmCalls.count;
    const res = await postGenerate({ templateId: PRESET_ID, playerCountryCode: 'AAA', sync: true });
    expect(res.statusCode).toBe(200);
    expect(res.body.error).toBeUndefined();
    expect(llmCalls.count).toBe(callsAfterFirst);
  });

  it('una nazione assente dalla mappa viene rifiutata con un errore chiaro', async () => {
    const res = await postGenerate({ templateId: PRESET_ID, playerCountryCode: 'ZZZ', sync: true });
    expect(res.statusCode).toBe(500);
    expect(String(res.body.error)).toContain('non è presente nella mappa');
  });
});
