/**
 * World Story — Mock API per gli E2E mock (Q01 µ1)
 * ==============================================
 *
 * Installa su una pagina Playwright un set di handler `page.route` che
 * intercettano TUTTE le chiamate `/api/**` e restituiscono risposte fittizie
 * deterministiche. Nessun backend reale, nessun provider LLM, nessuna rete
 * esterna: il test gira interamente offline nel browser.
 *
 * Ogni endpoint è documentato con la forma della risposta attesa dal
 * frontend (vedi frontend/src/services/api.ts). Le risposte sono volutamente
 * minimali ma coerenti con i tipi TypeScript, così il flusso
 * landing → template → paese → generazione mondo → HUD di gioco funziona.
 */

import { API_BASE } from './mock-constants.mjs';

// ---------------------------------------------------------------------------
// Dati fittizi condivisi (deterministici, dichiaratamente non storici)
// ---------------------------------------------------------------------------

export const MOCK_TEMPLATE = {
  id: 'realism_test_world',
  name: 'Mondo di prova (mock)',
  description: 'Fixture sintetica per gli E2E mock — non storica.',
  start_date: '1951-01-01',
  country_codes: ['ALPHA', 'BETA'],
  base_prompt: 'Fixture di test.',
  countries: [
    { code: 'ALPHA', name: 'Alfa', color: '#ff0000' },
    { code: 'BETA', name: 'Beta', color: '#0000ff' },
  ],
};

export const MOCK_WORLD_ID = 'mock-world-1';
export const MOCK_GAME_ID = 'mock-game-1';
export const MOCK_PLAYER_ID = 'mock-player-1';
export const MOCK_REGION_ID = 'ALPHA';

/** Regioni SVG (senza geojson) per evitare il caricamento di tile Mapbox. */
function mockRegions() {
  return {
    ALPHA: {
      id: 'ALPHA',
      name: 'Alfa',
      svgPath: 'M0,0 L100,0 L100,100 L0,100 Z',
      color: '#ff0000',
      owner: 'ALPHA',
      population: 1000000,
      gdp: 100,
      militaryPower: 100,
      objects: [{ id: 'o1', type: 'capital', name: 'Capitale Alfa', x: 50, y: 50 }],
      borders: ['BETA'],
      status: 'active',
      metadata: {},
      polityName: 'Alfa',
    },
    BETA: {
      id: 'BETA',
      name: 'Beta',
      svgPath: 'M100,0 L200,0 L200,100 L100,100 Z',
      color: '#0000ff',
      owner: 'BETA',
      population: 800000,
      gdp: 80,
      militaryPower: 80,
      objects: [],
      borders: ['ALPHA'],
      status: 'active',
      metadata: {},
      polityName: 'Beta',
    },
  };
}

export const MOCK_GAME = {
  id: MOCK_GAME_ID,
  world: {
    id: MOCK_WORLD_ID,
    name: 'Mondo di prova (mock)',
    description: 'Fixture sintetica.',
    startDate: '1951-01-01',
    basePrompt: 'Fixture di test.',
    historicalAccuracy: 0.5,
    regions: mockRegions(),
    blocs: {},
  },
  players: [
    { id: MOCK_PLAYER_ID, name: 'Player', regionId: MOCK_REGION_ID, color: '#ff0000', polityId: 'ALPHA' },
  ],
  currentTurn: 1,
  currentDate: '1951-01-01',
  maxTurns: 100,
  status: 'playing',
  headBranchId: 'branch-1',
  worldRevision: 1,
  queueVersion: 0,
};

// ---------------------------------------------------------------------------
// Helper di risposta
// ---------------------------------------------------------------------------

function json(route, body, status = 200) {
  return route.fulfill({
    status,
    contentType: 'application/json',
    body: JSON.stringify(body),
  });
}

function notFound(route) {
  return json(route, { error: 'Not found' }, 404);
}

// ---------------------------------------------------------------------------
// Installazione degli handler
// ---------------------------------------------------------------------------

/**
 * Installa gli handler mock su una pagina. `opts` può contenere:
 *  - `failWorldGen`: se true, il job di generazione mondo fallisce (per testare
 *    lo stato di errore della UI).
 */
export function installMockApi(page, opts = {}) {
  const { failWorldGen = false } = opts;

  // Blocca TUTTA la rete esterna: nessun tile, nessun font, nessun provider.
  // Solo le richieste verso l'app (localhost) e le API mock passano.
  page.route('**/*', (route) => {
    const url = route.request().url();
    const isLocal = url.startsWith('http://localhost') || url.startsWith('http://127.0.0.1');
    if (!isLocal) {
      return route.abort('blockedbyclient');
    }
    return route.continue();
  });

  // NOTA: Playwright risolve le route in ORDINE INVERSO di registrazione
  // (l'ultima registrata è controllata per prima). Il fallback generico va
  // quindi registrato PRIMA delle route specifiche, così viene controllato
  // per ultimo e non intercetta gli endpoint mappati.
  page.route(`${API_BASE}/**`, (route) => notFound(route));

  // ── Landing / menu ──────────────────────────────────────────────────────
  page.route(`${API_BASE}/health`, (route) => json(route, { status: 'ok', timestamp: '2026-01-01T00:00:00Z' }));
  page.route(`${API_BASE}/saves`, (route) => json(route, { saves: [] }));
  page.route(`${API_BASE}/countries`, (route) => json(route, { countries: MOCK_TEMPLATE.countries }));

  // ── Geo (mappa di selezione paese) ───────────────────────────────────────
  // WorldSelectMap carica /api/geo/countries: senza questo mock il componente
  // cade nel fallback a griglia (.country-card) e il layout a elenco
  // (.country-list-item) non viene mai renderizzato. Forniamo un FeatureCollection
  // minimale con i due paesi della fixture.
  page.route(`${API_BASE}/geo/countries`, (route) =>
    json(route, {
      type: 'FeatureCollection',
      features: [
        {
          type: 'Feature',
          properties: { code: 'ALPHA', name: 'Alfa' },
          geometry: { type: 'Polygon', coordinates: [[[0, 0], [10, 0], [10, 10], [0, 10], [0, 0]]] },
        },
        {
          type: 'Feature',
          properties: { code: 'BETA', name: 'Beta' },
          geometry: { type: 'Polygon', coordinates: [[[10, 0], [20, 0], [20, 10], [10, 10], [10, 0]]] },
        },
      ],
    }));
  page.route(`${API_BASE}/geo/capitals`, (route) =>
    json(route, { ALPHA: { capital: 'Capitale Alfa', lat: 5, lng: 5 }, BETA: { capital: 'Capitale Beta', lat: 15, lng: 5 } }));

  // ── Template ─────────────────────────────────────────────────────────────
  page.route(`${API_BASE}/templates`, (route) => json(route, { templates: [MOCK_TEMPLATE] }));
  page.route(`${API_BASE}/templates/${MOCK_TEMPLATE.id}`, (route) => json(route, MOCK_TEMPLATE));

  // ── Generazione mondo (flusso asincrono job) ─────────────────────────────
  page.route(`${API_BASE}/worlds/generate`, (route) => {
    if (route.request().method() !== 'POST') return notFound(route);
    return json(route, { jobId: 'mock-job-1', status: 'queued' });
  });

  page.route(`${API_BASE}/worlds/jobs/mock-job-1`, (route) => {
    if (failWorldGen) {
      return json(route, { status: 'failed', error: 'Mock: generazione mondo fallita' });
    }
    return json(route, {
      status: 'completed',
      result: {
        templateId: MOCK_TEMPLATE.id,
        worldId: MOCK_WORLD_ID,
        date: '1951-01-01',
        countries: MOCK_TEMPLATE.countries,
        regions: mockRegions(),
        regionIds: { ALPHA: 'ALPHA', BETA: 'BETA' },
        playerCountryCode: 'ALPHA',
      },
    });
  });

  // ── Creazione partita ────────────────────────────────────────────────────
  page.route(`${API_BASE}/games`, (route) => {
    if (route.request().method() !== 'POST') return notFound(route);
    return json(route, {
      game_id: MOCK_GAME_ID,
      player_id: MOCK_PLAYER_ID,
      region: { id: MOCK_REGION_ID, name: 'Alfa' },
    });
  });

  page.route(`${API_BASE}/games/${MOCK_GAME_ID}`, (route) => json(route, MOCK_GAME));

  // ── Stato di gioco (chiamate fatte all'apertura dell'HUD) ────────────────
  page.route(`${API_BASE}/games/${MOCK_GAME_ID}/timeline`, (route) =>
    json(route, { timeline: [], currentDate: '1951-01-01', hasMore: false, nextAfter: 0 }));
  page.route(`${API_BASE}/games/${MOCK_GAME_ID}/ongoing-processes`, (route) =>
    json(route, { processes: [] }));
  page.route(`${API_BASE}/games/${MOCK_GAME_ID}/national-state`, (route) =>
    json(route, { accounts: {} }));
  page.route(`${API_BASE}/games/${MOCK_GAME_ID}/chats`, (route) => json(route, { chats: [] }));
  // Coda ordini: GET restituisce la coda, POST accoda un ordine deterministico.
  // (U02 µ1: «Registra ordine» accoda senza avanzare tempo né spendere risorse.)
  page.route(`${API_BASE}/games/${MOCK_GAME_ID}/actions/queue`, (route) => {
    if (route.request().method() === 'POST') {
      let text = 'Ordine di prova';
      try {
        const body = JSON.parse(route.request().postData() || '{}');
        if (body && typeof body.text === 'string') text = body.text;
      } catch { /* body non JSON → testo di default */ }
      return json(route, { id: 'mock-action-1', text, status: 'queued', createdAt: '2026-01-01T00:00:00Z' });
    }
    return json(route, { pendingActions: [] });
  });
  page.route(`${API_BASE}/games/${MOCK_GAME_ID}/actions/queue/mock-action-1`, (route) =>
    json(route, { removed: true }));
  page.route(`${API_BASE}/games/${MOCK_GAME_ID}/actions/enhance`, (route) => {
    let text = 'Ordine di prova';
    try {
      const body = JSON.parse(route.request().postData() || '{}');
      if (body && typeof body.text === 'string') text = body.text;
    } catch { /* body non JSON → testo di default */ }
    return json(route, { original: text, enhanced: `[Riformulato] ${text}` });
  });
  page.route(`${API_BASE}/games/${MOCK_GAME_ID}/relationships`, (route) => json(route, {}));
  page.route(`${API_BASE}/games/${MOCK_GAME_ID}/suggestions`, (route) =>
    json(route, { suggestions: [] }));

  // ── SSE: risposta valida che invia `connected` e resta aperta ────────────
  page.route(`${API_BASE}/games/${MOCK_GAME_ID}/events`, (route) => {
    const body = [
      'event: connected',
      'data: {"ok":true}',
      '',
      'event: ping',
      'data: {}',
      '',
    ].join('\n');
    return route.fulfill({
      status: 200,
      contentType: 'text/event-stream',
      headers: { 'Cache-Control': 'no-cache' },
      body,
    });
  });

  // ── Fallback: qualsiasi altra API non mappata → 404 (mai rete reale) ─────
  // (registrato in cima: vedi nota sull'ordine inverso di risoluzione)
  return;
}
