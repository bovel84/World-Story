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

/**
 * Conti nazionali fittizi (shape di `WorldStateEngine.accounts`) per il Dossier
 * Nazione: rendono leggibili bilancio, capacità, sforzo bellico e coesione
 * anche nel percorso E2E offline.
 */
export const MOCK_ACCOUNTS = {
  ALPHA: {
    polityId: 'ALPHA', provinces: 1, population: 1000000, gdp: 100, militaryPower: 100,
    factories: 4, ports: 2, universities: 2, forces: 3, mobilized: 2,
    monthlyRevenue: 3.4, monthlyExpenses: 2.6, monthlyBalance: 0.8, annualGrowthRate: 0.024,
    stability: 62, defenceBurdenPct: 4.1, warEffort: 22, socialTension: 38,
    nominalGdpUsdBillions: 100, gdpPerCapitaUsd: 100000, government: 'Repubblica presidenziale',
    capacityBase: { factories: 2, ports: 1, universities: 1, forces: 2 },
    capacitySources: 'PIL 100 mld, 1,0 milioni di abitanti, 100000 USD pro capite (reddito alto), 1 provincia costiera',
  },
  BETA: {
    polityId: 'BETA', provinces: 1, population: 800000, gdp: 80, militaryPower: 80,
    factories: 2, ports: 1, universities: 1, forces: 4, mobilized: 5,
    monthlyRevenue: 1.9, monthlyExpenses: 2.4, monthlyBalance: -0.5, annualGrowthRate: 0.008,
    stability: 38, defenceBurdenPct: 9.2, warEffort: 68, socialTension: 64,
    nominalGdpUsdBillions: 80, gdpPerCapitaUsd: 100000, government: 'Repubblica presidenziale',
  },
};

/** Magazzino materiale del paese giocatore: stessa forma annidata dell'API
 *  reale (`stock`), così l'E2E copre la normalizzazione lato client. */
export const MOCK_RESOURCES = {
  stock: {
    money: 185.85, food: 20.87, clothing: 12, weapons: 160, fuel: 90, research: 40,
    technologies: ['ferrovie'],
  },
  natural: [{
    kind: 'diamonds', label: 'Diamanti', endowment: 5, reserve: 120, maxReserve: 120,
    depletionPct: 0, renewable: false, extractionPerMonth: 2.5, stockpile: 4, depleted: false,
  }],
  market: [{ kind: 'diamonds', label: 'Diamanti', bid: 1.196, ask: 1.534, mid: 1.365, scarcityPct: 0 }],
  capacity: { food: 24, clothing: 16, weapons: 200, fuel: 120 },
  needs: { food: 3.2, clothing: 1.4, weapons: 0.8, fuel: 1.1 },
  debt: 12.4,
  debts: [
    { id: 'debt-1951-1', label: 'Titolo 10 anni', principal: 8.4, annualRatePct: 3.1, issuedDate: '1951-01-01', maturityDate: '1961-01-01', termYears: 10 },
    { id: 'debt-1951-2', label: 'Titolo 5 anni', principal: 4, annualRatePct: 2.8, issuedDate: '1951-01-01', maturityDate: '1956-01-01', termYears: 5 },
  ],
  overdraft: 0,
  annualInterest: 0.37,
  averageMaturityYears: 8.4,
  debtRatioPct: 18.6,
  marketRatePct: 3.1,
  creditLimit: 49.92, creditHeadroom: 37.52,
  modifiers: { stability: 0, socialTension: 0, warEffort: 0, revenueMultiplier: 1, growthModifier: 0 },
};

/** Storico dei conti del paese giocatore (ALPHA): tre rilevazioni mensili
 *  con una tendenza reale, così il dossier mostra sparkline e variazioni. */
export const MOCK_ACCOUNT_HISTORY = [
  { date: '1951-01-01', turn: 1, account: { ...MOCK_ACCOUNTS.ALPHA, monthlyBalance: 0.2, stability: 56, socialTension: 44, monthlyRevenue: 3.1, monthlyExpenses: 2.9, defenceBurdenPct: 3.6, mobilized: 1, warEffort: 16, annualGrowthRate: 0.021, money: 150.2, debt: 4.5 } },
  { date: '1951-02-01', turn: 2, account: { ...MOCK_ACCOUNTS.ALPHA, monthlyBalance: 0.5, stability: 59, socialTension: 41, monthlyRevenue: 3.3, monthlyExpenses: 2.8, defenceBurdenPct: 3.9, mobilized: 2, warEffort: 19, annualGrowthRate: 0.023, money: 172.4, debt: 2.1 } },
  { date: '1951-03-01', turn: 3, account: { ...MOCK_ACCOUNTS.ALPHA, money: 185.85, debt: 0 } },
];

/** Anime del governo e dettaglio del bilancio: stessa forma dello snapshot
 *  reale, così l'E2E copre la pagina Governo senza backend. */
export const MOCK_GOVERNMENT = {
  factions: [
    {
      id: 'militari', name: 'Forze armate', interest: 'Difesa, ordine e prestigio',
      powerPct: 18, satisfaction: 58, stance: 'neutrale', pressure: 31,
      demand: { lever: 'difesa', title: 'Più fondi ai comandi', detail: 'La difesa vale il 4,1% del PIL: i comandi chiedono un rafforzamento moderato.', direction: 'alza', urgency: 40 },
      footprint: 'Spinge la spesa militare e le riserve richiamate.',
    },
    {
      id: 'industriali', name: 'Industria e padronato', interest: 'Meno tasse, più infrastrutture e mercati',
      powerPct: 16, satisfaction: 62, stance: 'favorevole', pressure: 24,
      demand: { lever: 'infrastrutture', title: 'Più infrastrutture per l’industria', detail: 'Porti, ferrovie e energia assorbono il 18,4% delle uscite.', direction: 'alza', urgency: 45 },
      footprint: 'Vuole alleggerire il prelievo e costruire capacità produttiva.',
    },
    {
      id: 'lavoratori', name: 'Lavoro e sindacati', interest: 'Salari, welfare e diritti',
      powerPct: 15, satisfaction: 52, stance: 'neutrale', pressure: 28,
      demand: { lever: 'welfare', title: 'Welfare: più sanità e sostegno sociale', detail: 'Sanità e sostegno valgono il 6,2% del PIL.', direction: 'alza', urgency: 48 },
      footprint: 'Premia sanità, sostegno sociale e tenuta dei salari.',
    },
    {
      id: 'tecnocrati', name: 'Università e tecnici', interest: 'Istruzione, ricerca e competenza',
      powerPct: 11, satisfaction: 66, stance: 'favorevole', pressure: 20,
      demand: { lever: 'istruzione', title: 'Istruzione e ricerca: più atenei e laboratori', detail: 'Scuola e ricerca assorbono il 14,1% delle uscite.', direction: 'alza', urgency: 34 },
      footprint: 'Collega la spesa per istruzione alla crescita futura.',
    },
    {
      id: 'finanza', name: 'Finanza e creditori', interest: 'Conti in ordine e moneta stabile',
      powerPct: 13, satisfaction: 74, stance: 'favorevole', pressure: 18,
      demand: { lever: 'debito', title: 'Mantenere il pareggio', detail: 'Il bilancio è in attivo: la finanza chiede prudenza.', direction: 'mantieni', urgency: 30 },
      footprint: 'Vigila su disavanzo, debito e credito residuo.',
    },
    {
      id: 'province', name: 'Province e prefetti', interest: 'Strade, ordine locale e autonomia',
      powerPct: 12, satisfaction: 57, stance: 'neutrale', pressure: 26,
      demand: { lever: 'infrastrutture', title: 'Strade, acquedotti e presidi locali', detail: 'Le province governano 1 territorio.', direction: 'alza', urgency: 43 },
      footprint: 'Porta sul tavolo del consiglio il territorio e i servizi locali.',
    },
    {
      id: 'opinione', name: 'Opinione pubblica', interest: 'Consenso, quiete e benessere diffuso',
      powerPct: 15, satisfaction: 43, stance: 'critico', pressure: 38,
      demand: { lever: 'ordine', title: 'Distensione: calmare la piazza', detail: 'La tensione sociale è al 38/100.', direction: 'alza', urgency: 38 },
      footprint: 'Misura il consenso e la pressione della piazza.',
    },
  ],
  dominantId: 'militari',
  angriestId: 'opinione',
  cohesion: 59,
  pressureIndex: 27,
  headline: 'Forze armate ha la maggiore influenza; Opinione pubblica preme di più: distensione: calmare la piazza.',
  budget: {
    currency: 'mld',
    revenue: [
      { id: 'incomeTax', label: 'Imposta sul reddito', amount: 1.36, sharePct: 40 },
      { id: 'corporateTax', label: 'Imposte su imprese e produzione', amount: 0.82, sharePct: 24.1 },
      { id: 'tradeDuties', label: 'Dazi e commercio estero', amount: 0.48, sharePct: 14.1 },
      { id: 'resourceRoyalties', label: 'Royalties e concessioni', amount: 0.4, sharePct: 11.8 },
      { id: 'otherRevenue', label: 'Altre entrate', amount: 0.34, sharePct: 10 },
    ],
    expense: [
      { id: 'defence', label: 'Difesa', amount: 0.34, sharePct: 13.1 },
      { id: 'administration', label: 'Amministrazione pubblica', amount: 0.6, sharePct: 23.1 },
      { id: 'education', label: 'Istruzione e ricerca', amount: 0.37, sharePct: 14.1 },
      { id: 'health', label: 'Sanità e assistenza', amount: 0.45, sharePct: 17.3 },
      { id: 'infrastructure', label: 'Infrastrutture e trasporti', amount: 0.48, sharePct: 18.4 },
      { id: 'social', label: 'Sostegno sociale e lavoro', amount: 0.22, sharePct: 8.5 },
      { id: 'otherExpense', label: 'Altre uscite', amount: 0.14, sharePct: 5.4 },
    ],
    revenueTotal: 3.4,
    expenseTotal: 2.6,
    balance: 0.8,
    effectiveTaxRatePct: 10.2,
    defenceBurdenPct: 4.1,
    socialBurdenPct: 10.8,
    educationBurdenPct: 4.4,
  },
};

/** Voci del consiglio generate dall'LLM (mock): petizioni brevi per fazione. */
export const MOCK_GOVERNMENT_VOICES = {
  council: 'Il consiglio si stringe attorno al bilancio: le forze armate chiedono mezzi, il lavoro chiede tutele.',
  voices: {
    militari: 'I confini non si difendono con i proclami: servono mezzi e riserve addestrate, e li chiediamo ora.',
    industriali: 'Le imprese non possono attendere: alleggerite il prelievo e aprite i cantieri.',
    lavoratori: 'I salari non bastano più: sanità e sostegno sociale non sono un lusso.',
    tecnocrati: 'Senza ricerca non c’è futuro: gli atenei chiedono fondi e laboratori.',
    finanza: 'I conti sono in ordine: manteniamo il pareggio senza avventure.',
    province: 'Le strade e i presidi locali attendono da troppo tempo.',
    opinione: 'La piazza è stanca: date risposte su prezzi e lavoro, o la fiducia si spegne.',
  },
  generated: true,
};

// ---------------------------------------------------------------------------
// Arsenale: forma esatta dell'API reale (schede descrittive + contributo).
// ---------------------------------------------------------------------------

export const MOCK_ARSENAL = {
  polityId: 'ALPHA',
  units: { fucili: 37, carri_3: 6 },
  strength: 16.7,
  qualityIndex: 42,
  combatFactor: 1.02,
  baseMilitaryPower: 120,
  effectiveMilitaryPower: 122.4,
  lines: [
    {
      id: 'fucili', name: 'Fucili d’assalto', domain: 'terra', domainLabel: 'Forze di terra',
      category: 'Fanteria', quality: 35, tier: 'datato', quantity: 37,
      role: 'Arma individuale della fanteria di linea',
      description: 'Fucile automatico d’ordinanza: equipaggia il singolo soldato ed è la base di ogni reparto appiedato.',
      specs: [{ label: 'Calibro', value: '5,56 / 7,62 mm' }, { label: 'Gittata utile', value: '300–400 m' }],
      strength: 13, sharePct: 77.8,
    },
    {
      id: 'carri_3', name: 'Carri armati di 3ª generazione', domain: 'terra', domainLabel: 'Forze di terra',
      category: 'Corazzati', quality: 62, tier: 'moderno', quantity: 6,
      role: 'Manovra corazzata di rottura',
      description: 'Carro armato di generazione precedente ma ancora efficace: è il mezzo che sfonda le linee e occupa il terreno.',
      specs: [{ label: 'Equipaggio', value: '4' }, { label: 'Cannone', value: '105–120 mm' }],
      strength: 3.7, sharePct: 22.2,
    },
  ],
  catalog: [
    {
      id: 'fucili', name: 'Fucili d’assalto', domain: 'terra', category: 'Fanteria',
      quality: 35, tier: 'datato', costMln: 800, weaponsCost: 4,
      role: 'Arma individuale della fanteria di linea',
      description: 'Fucile automatico d’ordinanza: equipaggia il singolo soldato ed è la base di ogni reparto appiedato.',
      specs: [{ label: 'Calibro', value: '5,56 / 7,62 mm' }, { label: 'Gittata utile', value: '300–400 m' }],
      canBuild: true, canBuy: true, buildCostMln: 800, buyCostMln: 1280, reasons: [],
    },
    {
      id: 'caccia_5', name: 'Caccia di 5ª generazione', domain: 'aria', category: 'Aerei da combattimento',
      quality: 94, tier: 'nuova_generazione', costMln: 180000, weaponsCost: 80,
      role: 'Superiorità aerea e penetrazione',
      description: 'Caccia di ultima generazione con traccia radar ridotta e fusione dei sensori.',
      specs: [{ label: 'Velocità', value: 'Mach 1,6–2' }, { label: 'Traccia radar', value: 'ridotta (stealth)' }],
      canBuild: false, canBuy: true, buildCostMln: 180000, buyCostMln: 288000,
      reasons: ['manca la tecnologia Aeronautica avanzata', 'servono 5 fabbriche (ne hai 2)'],
    },
  ],
  naturalResources: { diamonds: 5 },
  naturalResourcesText: 'Diamanti 5/5',
  debt: 0, creditLimit: 49.92,
  production: {
    orders: [{
      id: 'ord-mock-1', equipmentId: 'fucili', name: 'Fucili d’assalto', domain: 'terra',
      quantity: 40, progress: 42, spentMln: 32, startedTurn: 2, startedDate: '1951-01-15',
      status: 'in_progress', note: 'imprevisto: −9% (linea rallentata)', qualityLoss: 1.4,
      updatedDate: '1951-03-01', expectedDate: '1951-06-20',
    }],
    inProgress: 1,
  },
  capacity: { factories: 2, ports: 1, universities: 1, money: 185.85, weapons: 160, credit: 49.92, technologies: ['ferrovie'] },
  domains: [
    { domain: 'terra', label: 'Forze di terra', weight: 1, description: 'Fanteria, corazzati, artiglieria e difesa aerea: tengono il terreno e lo conquistano.' },
    { domain: 'aria', label: 'Aeronautica', weight: 2.2, description: 'Caccia, bombardieri, trasporti e radar volanti: conquistano il cielo.' },
    { domain: 'mare', label: 'Marina', weight: 2.4, description: 'Pattugliatori, fregate, sommergibili e portaerei: controllano le rotte.' },
    { domain: 'missili', label: 'Missili', weight: 3, description: 'Balistici, da crociera, antinave e ipersonici: colpiscono a distanza.' },
    { domain: 'droni', label: 'Droni', weight: 1.6, description: 'Ricognizione, attacco, munizioni vaganti e sciami: pressione continua.' },
  ],
};

/**
 * Processi in corso: il contratto reale dell'API include la percentuale di
 * completamento calcolata dal motore e la nota di rischio. Un processo senza
 * scadenza dichiarata resta «in corso».
 */
export const MOCK_ONGOING_PROCESSES = [
  {
    id: 'proc-1', source_action_id: 'mock-action-1', source_run_id: 'run-1',
    title: 'Ferrovia transnazionale', summary: 'Collegamento ferroviario verso il confine orientale.',
    status: 'ongoing', started_date: '1951-01-10', expected_date: '1951-09-30',
    progress: 38, progress_note: null, updated_at: '1951-03-01T00:00:00Z',
  },
  {
    id: 'proc-2', source_action_id: 'mock-action-2', source_run_id: 'run-2',
    title: 'Riforma agraria', summary: 'Ridistribuzione delle terre coltivabili.',
    status: 'ongoing', started_date: '1951-02-01', expected_date: null,
    progress: 35, progress_note: 'senza scadenza dichiarata: resta in corso', updated_at: '1951-03-01T00:00:00Z',
  },
];

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
  page.route(`${API_BASE}/templates/maps/native`, (route) => json(route, {
    maps: [
      { id: 'standard', label: 'Mappa mondiale standard', hasProvinces: false, features: 2, codes: ['ALPHA', 'BETA'] },
      { id: 'modern_world_provinces', label: 'Mondo Provinciale Moderno', hasProvinces: true, features: 4, codes: ['ALPHA'] },
    ],
  }));
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
    json(route, { processes: MOCK_ONGOING_PROCESSES }));
  page.route(`${API_BASE}/games/${MOCK_GAME_ID}/national-state`, (route) =>
    json(route, { accounts: MOCK_ACCOUNTS, history: MOCK_ACCOUNT_HISTORY, resources: MOCK_RESOURCES, government: MOCK_GOVERNMENT }));
  // La nazione fa debito: il mock risponde con un titolo deterministico.
  page.route(`${API_BASE}/games/${MOCK_GAME_ID}/finance/borrow`, (route) => {
    if (route.request().method() !== 'POST') return notFound(route);
    let amountMld = 5;
    let termYears = 10;
    try {
      const body = JSON.parse(route.request().postData() || '{}');
      if (Number.isFinite(Number(body?.amountMld))) amountMld = Number(body.amountMld);
      if (Number.isFinite(Number(body?.termYears))) termYears = Number(body.termYears);
    } catch { /* body non JSON → valori di default */ }
    return json(route, {
      ok: true,
      tranche: {
        id: 'debt-mock-1', label: `Titolo ${termYears} anni`, principal: amountMld,
        annualRatePct: 3.4, issuedDate: '1951-01-01', maturityDate: `19${51 + termYears}-01-01`, termYears,
      },
      debt: 12.4 + amountMld, annualInterest: 0.54, debtRatioPct: 20.1, creditHeadroom: 37.52 - amountMld,
    });
  });
  page.route(`${API_BASE}/games/${MOCK_GAME_ID}/government/voices`, (route) =>
    json(route, MOCK_GOVERNMENT_VOICES));
  page.route(`${API_BASE}/games/${MOCK_GAME_ID}/arsenal`, (route) => json(route, MOCK_ARSENAL));
  page.route(`${API_BASE}/games/${MOCK_GAME_ID}/chats*`, (route) => {
    if (route.request().method() === 'POST' && /\/chats$/.test(new URL(route.request().url()).pathname)) {
      return json(route, { chat: { id: 'mock-chat-1', polityId: 'POL', polityName: 'Polonia', polityColor: '#888888', participants: [], unread: 0, archived: false } });
    }
    return json(route, { chats: [] });
  });
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
  // Verifica fattibilità: il compositore d'ordine la richiede prima di accodare.
  page.route(`${API_BASE}/games/${MOCK_GAME_ID}/actions/check-feasibility`, (route) => {
    let text = 'Ordine di prova';
    try {
      const body = JSON.parse(route.request().postData() || '{}');
      if (body && typeof body.text === 'string') text = body.text;
    } catch { /* body non JSON → testo di default */ }
    return json(route, {
      feasible: true,
      costs: {
        timeDays: 45,
        inputs: [{ resourceId: 'money', name: 'Tesoreria', quantity: '12,40', unit: 'mld' }],
        upkeep: [],
        basis: 'request',
        note: '25% del gettito annuo (Infrastrutture)',
        category: 'Infrastrutture',
      },
      prerequisites: [],
      risks: [],
      warnings: [],
      summary: `Fattibile: ${text}`,
    });
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
