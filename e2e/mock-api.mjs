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

/**
 * Cronaca fittizia: una entry per il turno 1, così i pannelli della Timeline
 * (effetti del turno, decisioni) hanno qualcosa da mostrare negli E2E mock.
 * Deterministica e dichiaratamente non storica.
 */
export const MOCK_TIMELINE = [
  {
    turn: 1,
    date: '1951-02-01',
    narration: 'Il primo periodo di governo si chiude senza crisi.',
    events: [
      {
        id: 'mock-event-1',
        date: '1951-02-01',
        headline: 'Avviati i lavori sulla linea ferroviaria',
        detail: 'Il cantiere apre con i fondi stanziati dal governo.',
        source: 'world',
      },
    ],
  },
];

/** Effetto attribuito dal motore all'ordine di prova (DECISION-IMPACT). */
export const MOCK_SETTLEMENT = { kind: 'charged', requestedMld: 12.4, chargedMld: 12.4, label: 'Infrastrutture' };

/** Proposte strategiche fittizie (ARMY-MOVE P3): deterministiche, non storiche. */
export const MOCK_SUGGESTIONS = [
  {
    topic: 'Difesa federale',
    description: 'Rafforzare il confine meridionale prima della prossima stagione.',
    actions: [{ title: 'Richiamare le riserve', content: 'Richiamare due battaglioni di riserva al confine.' }],
  },
  {
    topic: 'Tesoreria',
    description: 'La cassa perde terreno: servono entrate o tagli espliciti.',
    actions: [{ title: 'Rivedere la spesa', content: 'Ridurre la spesa militare straordinaria del 5%.' }],
  },
];

/**
 * GAMEPLAY-LONG — impegni già firmati: un trattato in vigore con scadenza e un
 * ultimatum scaduto. Il mock **non** ricalcola date o stati: li riceve dal
 * payload, come farebbe il backend vero.
 */
export const MOCK_COMMITMENTS = {
  commitments: [
    {
      id: 'ITA|FRA|treaty|confine', type: 'treaty', actor: 'ITA', counterparty: 'FRA',
      description: 'Patto sui confini alpini', createdDate: '1951-01-01', createdTurn: 1,
      status: 'active', deadline: '1951-03-02', sourceEventId: null, importance: 3,
      updatedDate: '1951-01-01', updatedTurn: 1, note: 'Ratificato dal parlamento.',
    },
    {
      id: 'ITA|POL|ultimatum|corridoio', type: 'ultimatum', actor: 'ITA', counterparty: 'POL',
      description: 'Ultimatum sul corridoio baltico', createdDate: '1950-12-01', createdTurn: 0,
      status: 'expired', deadline: '1950-12-31', sourceEventId: null, importance: 2,
      updatedDate: '1951-01-01', updatedTurn: 1, note: '',
    },
  ],
  // Ciò che il motore segnala come meritevole di attenzione (briefing).
  attention: [
    {
      id: 'ITA|FRA|treaty|confine', type: 'treaty', actor: 'ITA', counterparty: 'FRA',
      description: 'Patto sui confini alpini', createdDate: '1951-01-01', createdTurn: 1,
      status: 'active', deadline: '1951-03-02', sourceEventId: null, importance: 3,
      updatedDate: '1951-01-01', updatedTurn: 1, note: 'Ratificato dal parlamento.',
    },
  ],
};

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
  // Bilancio materiale del mese (MATERIEL-CLARITY). Valori fittizi ma
  // coerenti con scorte e fabbisogno: due avanzi e un deficit reale, così la
  // sintesi mostra sia il verde sia il rosso.
  balance: [
    { kind: 'food', label: 'Cibo', stock: 20.87, capacity: 24, productionPerMonth: 3.6, consumptionPerMonth: 3.2, balancePerMonth: 0.4, spoiledPerMonth: 0 },
    { kind: 'clothing', label: 'Vestiario', stock: 12, capacity: 16, productionPerMonth: 1.5, consumptionPerMonth: 1.4, balancePerMonth: 0.1, spoiledPerMonth: 0 },
    { kind: 'weapons', label: 'Armamenti', stock: 160, capacity: 200, productionPerMonth: 1.1, consumptionPerMonth: 0.8, balancePerMonth: 0.3, spoiledPerMonth: 0 },
    { kind: 'fuel', label: 'Carburante', stock: 0.5, capacity: 120, productionPerMonth: 0.6, consumptionPerMonth: 1.1, balancePerMonth: -0.5, spoiledPerMonth: 0 },
  ],
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

// ---------------------------------------------------------------------------
// OP-OBJECTS — sala di governo: oggetti concreti e azione di formazione.
// Il mock espone il contratto di `/arsenal.objects` e le due rotte di
// `military/formation`. Per coprire la UI espone **entrambi** gli stati
// dell'azione (bloccata e disponibile): i numeri sono quelli del contratto, non
// una simulazione alternativa.
// ---------------------------------------------------------------------------

export const MOCK_OBJECTS = {
  counts: { force: 1, army: 2, unit: 2, front: 1, facility: 4, construction: 1, mine: 1 },
  conventions: [
    'Le armate derivano dagli oggetti `army` della mappa; i reparti senza nome sono raggruppati nello schieramento nazionale.',
    'Le linee di un impianto sono una quota della capacità industriale del motore; la somma degli impianti è il totale nazionale.',
    'Nave, equipaggio e manutenzione vengono dall\'arsenale navale: una unità esiste solo quando è in servizio.',
  ],
  chains: [
    {
      id: 'steel', label: 'Minerali e industria → armamenti',
      steps: [
        { label: 'Miniere', value: 5, unit: 'numero', tone: 'positive', detail: 'Giacimenti sfruttati dal paese.' },
        { label: 'Linee occupate', value: 8, unit: 'numero', tone: 'neutral', detail: 'Lavorazioni in corso.' },
        { label: 'Armamenti', value: 1.4, unit: 'per_mese', tone: 'warning', detail: 'Produzione mensile degli impianti.' },
        { label: 'Reparti equipaggiati', value: 0, unit: 'numero', tone: 'critical', detail: 'Copertura armi individuali 0,1%.' },
      ],
      broken: true,
      summary: 'La filiera si rompe a valle: mancano armi individuali per i reparti in armi.',
    },
  ],
  objects: [
    {
      id: 'force', kind: 'force', label: 'Forze armate', subtitle: '3 reparti · 55.000 uomini in armi',
      status: 'critical', statusLabel: 'Critico', parentId: null, regionId: null, regionName: null,
      facts: [
        { section: 'personale', label: 'Uomini in armi', value: 55000, unit: 'numero', tone: 'neutral' },
        { section: 'personale', label: 'Riserva addestrata', value: 39600, unit: 'numero', tone: 'neutral' },
        { section: 'personale', label: 'Riservisti richiamabili', value: 17600, unit: 'numero', tone: 'neutral' },
        { section: 'capacita', label: 'Prontezza', value: 15, unit: 'pct', tone: 'critical' },
        { section: 'input', label: 'Carburante', value: 1.04, unit: 'per_mese', tone: 'neutral' },
        { section: 'input', label: 'Armamenti', value: 0.42, unit: 'per_mese', tone: 'neutral' },
        { section: 'costi', label: 'Spesa militare', value: 4.8, unit: 'mld', tone: 'neutral' },
        { section: 'autonomia', label: 'Carburante (scorte)', value: 12.4, unit: 'mesi', tone: 'neutral' },
      ],
      problems: [
        { severity: 'critical', label: 'Copertura armi individuali 0,1%', detail: '37 in servizio su 44.000 della dotazione di riferimento.' },
        { severity: 'critical', label: 'Copertura artiglieria 0%', detail: '0 in servizio su 5 della dotazione di riferimento.' },
      ],
      actions: [{ id: 'raise_formation', label: 'Crea 1 reparto', enabled: true, blockedReason: null }],
      why: 'La dotazione di riferimento è quella dell\'epoca (guerra fredda): il piano dei reparti è calcolato dal motore sul personale effettivo.',
    },
    // MILITARY-UNITS PR2 — un fronte: due parti in contatto, pressione e obiettivo.
    {
      id: 'front-AUT-ITA', kind: 'front', label: 'Fronte Italia–Austria', subtitle: 'Italia contro Austria',
      status: 'stalemate', statusLabel: 'In stallo', parentId: 'force', regionId: 'ALPHA', regionName: 'Alpha',
      facts: [
        { section: 'stato', label: 'Stato del fronte', value: null, unit: 'testo', tone: 'warning', text: 'In stallo' },
        { section: 'stato', label: 'Obiettivo', value: null, unit: 'testo', tone: 'neutral', text: 'Tirolo' },
        { section: 'capacita', label: 'Pressione attaccante', value: 118, unit: 'pct', tone: 'neutral', text: 'Italia' },
        { section: 'capacita', label: 'Pressione difensore', value: 106, unit: 'pct', tone: 'neutral', text: 'Austria' },
        { section: 'costi', label: 'Perdite del periodo', value: 540, unit: 'numero', tone: 'warning' },
      ],
      problems: [{ severity: 'warning', label: 'Fronte in stallo da 2 periodi', detail: 'Nessuno sfondamento: la difesa tiene.' }],
      actions: [],
      why: 'Il fronte esiste solo con due polity ostili, un confine reale e reparti schierati: la mappa resta la fonte.',
    },
    {
      id: 'army-alpha-1', kind: 'army', label: 'I Corpo', subtitle: 'Dislocata in Alpha',
      status: 'critical', statusLabel: 'Critico', parentId: 'force', regionId: 'ALPHA', regionName: 'Alpha',
      facts: [
        { section: 'stato', label: 'Reparti', value: 2, unit: 'numero', tone: 'neutral' },
        { section: 'personale', label: 'Uomini', value: 22000, unit: 'numero', tone: 'neutral' },
        { section: 'capacita', label: 'Prontezza', value: 15, unit: 'pct', tone: 'critical' },
        { section: 'output', label: 'Copertura armi individuali', value: 0.1, unit: 'pct', tone: 'critical' },
        { section: 'costi', label: "Spesa dell\'armata", value: 1.92, unit: 'mld', tone: 'neutral' },
        { section: 'autonomia', label: 'Carburante', value: 12.4, unit: 'mesi', tone: 'neutral' },
      ],
      problems: [{ severity: 'critical', label: 'Copertura armi individuali 0,1%', detail: '37 in servizio su 44.000 della dotazione di riferimento.' }],
      actions: [{ id: 'raise_formation', label: 'Aggiungi 1 reparto a questa armata', enabled: true, blockedReason: null }],
      why: 'Armata reale del mondo: i reparti sono quelli dichiarati sulla mappa.',
    },
    // MILITARY-UNITS: i reparti vivono **sotto** la loro armata. Le azioni sono
    // quelle del motore; qui il mock copre lo stato eseguibile e quello bloccato.
    {
      id: 'army-alpha-1-unit-001', kind: 'unit', label: '1ª Brigata', subtitle: 'I Corpo · Alpha · 11.000 uomini',
      status: 'operational', statusLabel: 'Operativa', parentId: 'army-alpha-1', regionId: 'ALPHA', regionName: 'Alpha',
      facts: [
        { section: 'stato', label: 'Uomini', value: 11000, unit: 'numero', tone: 'positive', text: "Organico d'epoca: 11.000 uomini per reparto." },
        { section: 'stato', label: 'Equipaggiamento assegnato', value: 37, unit: 'numero', tone: 'neutral', text: "Fucili d'assalto ×37" },
        { section: 'capacita', label: 'Organico', value: 100, unit: 'pct', tone: 'positive' },
        { section: 'capacita', label: 'Copertura armi individuali', value: 0.4, unit: 'pct', tone: 'critical', text: '37 armi individuali assegnate su 8.800 richieste.' },
        { section: 'capacita', label: 'Prontezza', value: 50, unit: 'pct', tone: 'critical', text: 'Organico e dotazione, modulati dallo stato dichiarato.' },
        { section: 'input', label: 'Carburante', value: 0.03, unit: 'per_mese', tone: 'neutral' },
        { section: 'input', label: 'Armamenti', value: 0.2, unit: 'per_mese', tone: 'neutral' },
        { section: 'input', label: 'Cibo', value: 0.06, unit: 'per_mese', tone: 'neutral' },
        { section: 'costi', label: 'Spese del reparto', value: 0.96, unit: 'mld', tone: 'neutral', text: 'Quota delle spese militari mensili, in proporzione agli uomini del reparto.' },
        { section: 'autonomia', label: 'Carburante (scorte)', value: 12.4, unit: 'mesi', tone: 'neutral' },
      ],
      problems: [
        { severity: 'critical', label: 'Copertura armi individuali 0,4%', detail: "Mancano 8.763 armi individuali alla dotazione d'epoca del reparto." },
      ],
      actions: [
        { id: 'reinforce_unit', label: 'Rinforza', enabled: false, blockedReason: 'Organico già completo: 11.000 uomini per reparto.' },
        { id: 'reequip_unit', label: 'Riequipaggia (8.763 pezzi)', enabled: true, blockedReason: null },
        { id: 'transfer_unit', label: 'Trasferisci', enabled: true, blockedReason: null },
        { id: 'reassign_unit', label: 'Cambia armata', enabled: true, blockedReason: null },
        // PR2: le quattro mosse del fronte (stesso motore degli NPC).
        { id: 'order_attack', label: 'Attacca', enabled: true, blockedReason: null },
        { id: 'order_defend', label: 'Difendi', enabled: false, blockedReason: 'Il reparto ha già l\'ordine «Difendi».' },
        { id: 'order_reserve', label: 'Riserva', enabled: true, blockedReason: null },
        { id: 'order_withdraw', label: 'Ripiega', enabled: true, blockedReason: null },
      ],
      why: "Reparto dell'armata «I Corpo»: uomini, equipaggiamento e fabbisogni sono suoi. L'armata che lo contiene è la somma dei suoi reparti.",
    },
    {
      id: 'army-alpha-1-unit-002', kind: 'unit', label: '2ª Brigata', subtitle: 'I Corpo · Alpha · 0 uomini',
      status: 'under_construction', statusLabel: 'In formazione', parentId: 'army-alpha-1', regionId: 'ALPHA', regionName: 'Alpha',
      facts: [
        { section: 'stato', label: 'Uomini', value: 0, unit: 'numero', tone: 'critical', text: "Organico d'epoca: 11.000 uomini per reparto." },
        { section: 'capacita', label: 'Organico', value: 0, unit: 'pct', tone: 'critical' },
        { section: 'capacita', label: 'Prontezza', value: 0, unit: 'pct', tone: 'critical' },
      ],
      problems: [
        { severity: 'critical', label: 'Reparto senza uomini', detail: 'Nessun uomo assegnato: è un quadro organico, non una forza.' },
        { severity: 'critical', label: 'Nessuna arma individuale assegnata', detail: 'Servono 8.800 armi individuali: il deposito non è stato ancora assegnato a questo reparto.' },
      ],
      actions: [
        { id: 'reinforce_unit', label: 'Rinforza (11.000 uomini)', enabled: true, blockedReason: null },
        { id: 'reequip_unit', label: 'Riequipaggia (8.800 pezzi)', enabled: true, blockedReason: null },
        { id: 'transfer_unit', label: 'Trasferisci', enabled: true, blockedReason: null },
        { id: 'reassign_unit', label: 'Cambia armata', enabled: true, blockedReason: null },
        // Senza fronte le mosse sono dichiarate bloccate, non nascoste.
        { id: 'order_attack', label: 'Attacca', enabled: false, blockedReason: 'Il reparto non è assegnato a un fronte: non ci sono ordini da dare.' },
        { id: 'order_defend', label: 'Difendi', enabled: false, blockedReason: 'Il reparto non è assegnato a un fronte: non ci sono ordini da dare.' },
        { id: 'order_reserve', label: 'Riserva', enabled: false, blockedReason: 'Il reparto non è assegnato a un fronte: non ci sono ordini da dare.' },
        { id: 'order_withdraw', label: 'Ripiega', enabled: false, blockedReason: 'Il reparto non è assegnato a un fronte: non ci sono ordini da dare.' },
      ],
      why: "Il mondo dichiara un reparto in più: nasce **senza uomini** (in formazione), la riserva si muove solo con «Rinforza».",
    },
    {
      id: 'army-alpha-2', kind: 'army', label: 'II Corpo', subtitle: 'Reparti dello schieramento nazionale',
      status: 'critical', statusLabel: 'Critico', parentId: 'force', regionId: null, regionName: null,
      facts: [
        { section: 'stato', label: 'Reparti', value: 1, unit: 'numero', tone: 'neutral' },
        { section: 'personale', label: 'Uomini', value: 11000, unit: 'numero', tone: 'neutral' },
        { section: 'capacita', label: 'Prontezza', value: 15, unit: 'pct', tone: 'critical' },
        { section: 'costi', label: "Spesa dell\'armata", value: 0.96, unit: 'mld', tone: 'neutral' },
      ],
      problems: [],
      actions: [{
        id: 'raise_formation', label: 'Aggiungi 1 reparto a questa armata', enabled: false,
        blockedReason: 'Servono 8.763 fucili in più: il deposito non basta.',
      }],
      why: 'Reparti derivati dal profilo del paese (capacità di base): il quadro li raggruppa.',
    },
    {
      id: 'factory-ALPHA-1', kind: 'facility', label: 'Acciaierie Alpha', subtitle: 'Impianto industriale',
      status: 'degraded', statusLabel: 'Ridotto', parentId: null, regionId: 'ALPHA', regionName: 'Alpha',
      facts: [
        { section: 'stato', label: 'Linee di lavorazione', value: 10, unit: 'numero', tone: 'neutral' },
        { section: 'capacita', label: 'Utilizzo', value: 40, unit: 'pct', tone: 'neutral' },
        { section: 'capacita', label: 'Ritmo di lavoro', value: 40, unit: 'pct', tone: 'warning' },
        { section: 'output', label: 'Armamenti', value: 0.7, unit: 'per_mese', tone: 'neutral' },
        { section: 'input', label: 'Minerali ferrosi', value: 0.34, unit: 'per_mese', tone: 'neutral' },
        { section: 'input', label: 'Carbone', value: 0.52, unit: 'per_mese', tone: 'neutral' },
        { section: 'personale', label: 'Addetti', value: 110, unit: 'numero', tone: 'neutral' },
        { section: 'costi', label: 'Costo operativo', value: 0.44, unit: 'mld', tone: 'neutral' },
        { section: 'output', label: 'Ordine in lavorazione', value: null, unit: 'testo', tone: 'neutral', text: 'Fucili d’assalto ×40 · 42%' },
        { section: 'autonomia', label: 'Consegna prevista', value: null, unit: 'data', tone: 'neutral', text: '1951-06-20' },
      ],
      problems: [{ severity: 'warning', label: 'Capacità satura (96%)', detail: 'Un nuovo ordine su questo impianto slitta.' }],
      actions: [{ id: 'procure', label: 'Avvia una produzione militare', enabled: true, blockedReason: null }],
      why: 'Linee e utilizzo vengono dalla capacità industriale del motore; la produzione è il contributo marginale di un impianto.',
    },
    {
      id: 'factory-ALPHA-2', kind: 'facility', label: 'Officine Alpha', subtitle: 'Impianto industriale',
      status: 'idle', statusLabel: 'Fermo', parentId: null, regionId: 'ALPHA', regionName: 'Alpha',
      facts: [
        { section: 'stato', label: 'Linee di lavorazione', value: 10, unit: 'numero', tone: 'neutral' },
        { section: 'capacita', label: 'Utilizzo', value: 0, unit: 'pct', tone: 'neutral' },
        { section: 'output', label: 'Armamenti', value: 0, unit: 'per_mese', tone: 'critical' },
      ],
      problems: [{ severity: 'critical\', label: \'Impianto fermo: nessuna lavorazione\', detail: \'Le linee sono libere: la produzione dell\'impianto è zero finché non riceve un ordine.' }],
      actions: [{ id: 'procure', label: 'Avvia una produzione militare', enabled: true, blockedReason: null }],
      why: 'Un impianto senza ordini non produce: il motore non finge attività.',
    },
    {
      id: 'shipyard-ALPHA-1', kind: 'facility', label: 'Cantieri Alpha', subtitle: 'Cantiere navale e porto',
      status: 'idle', statusLabel: 'Fermo', parentId: null, regionId: 'ALPHA', regionName: 'Alpha',
      facts: [
        { section: 'stato', label: 'Linee di lavorazione', value: 4, unit: 'numero', tone: 'neutral' },
        { section: 'capacita', label: 'Utilizzo', value: 0, unit: 'pct', tone: 'neutral' },
        { section: 'output', label: 'Scafi in costruzione', value: 0, unit: 'numero', tone: 'neutral' },
        { section: 'autonomia', label: 'Unità in manutenzione', value: 0, unit: 'numero', tone: 'neutral' },
      ],
      problems: [],
      actions: [{ id: 'procure', label: 'Ordina una nave', enabled: true, blockedReason: null }],
      why: 'I cantieri sono i porti del paese: senza sbocco al mare non esistono.',
    },
    {
      id: 'university-ALPHA-1', kind: 'facility', label: 'Politecnico Alpha', subtitle: 'Ricerca e formazione tecnica',
      status: 'operational', statusLabel: 'Operativo', parentId: null, regionId: 'ALPHA', regionName: 'Alpha',
      facts: [
        { section: 'output', label: 'Punti ricerca', value: 2, unit: 'per_mese', tone: 'positive' },
        { section: 'input', label: 'Fondi', value: 0.3, unit: 'mld', tone: 'neutral' },
      ],
      problems: [], actions: [],
      why: 'Atenei derivati dal profilo del paese; i punti ricerca crescono con gli atenei.',
    },
    {
      id: 'construction-proc-1', kind: 'construction', label: 'Ferrovia transnazionale', subtitle: 'Cantiere in Alpha',
      status: 'under_construction', statusLabel: 'In costruzione', parentId: null, regionId: 'ALPHA', regionName: 'Alpha',
      facts: [
        { section: 'stato', label: 'Avanzamento', value: 38, unit: 'pct', tone: 'neutral' },
        { section: 'capacita', label: 'Linee occupate dai lavori', value: 4, unit: 'numero', tone: 'warning' },
        { section: 'autonomia', label: 'Mesi al completamento', value: 5.5, unit: 'mesi', tone: 'neutral' },
        { section: 'input', label: 'Materiali da costruzione', value: 6, unit: 'per_mese', tone: 'neutral' },
        { section: 'costi', label: 'Spesa in corso', value: 0.18, unit: 'mld', tone: 'neutral' },
        { section: 'output', label: 'Beneficio', value: 0, unit: 'numero', tone: 'neutral', text: 'Nessuno prima del completamento: l\'opera entra nei conti solo a lavori finiti.' },
      ],
      problems: [], actions: [],
      why: 'Un\'opera in costruzione occupa linee e materiali ma non produce nulla: il motore non la conta fra gli impianti finché non è completata.',
    },
    {
      id: 'mine-ALPHA-diamonds', kind: 'mine', label: 'Miniera di diamanti (Alpha)', subtitle: 'Giacimento 5/5 dal registro del paese',
      status: 'operational', statusLabel: 'Operativo', parentId: null, regionId: 'ALPHA', regionName: 'Alpha',
      facts: [
        { section: 'stato', label: 'Giacimento', value: 5, unit: 'numero', tone: 'neutral' },
        { section: 'output', label: 'Diamanti', value: 0.5, unit: 'per_mese', tone: 'positive' },
        { section: 'personale', label: 'Addetti', value: 40, unit: 'numero', tone: 'neutral' },
        { section: 'costi', label: 'Costo operativo', value: 0.04, unit: 'mld', tone: 'neutral' },
      ],
      problems: [],
      actions: [{ id: 'trade', label: 'Compra o vendi sul mercato', enabled: true, blockedReason: null }],
      why: 'Il contributo del giacimento è il delta di produzione che il motore calcola aggiungendo una unità di diamanti.',
    },
  ],
};

/** Anteprima PRIMA → DOPO: l'armata `army-alpha-2` è bloccata, le altre no. */
export function mockUnitImpact(action, body = {}) {
  const dryRun = body.dryRun === true;
  const subject = MOCK_OBJECTS.objects.find(object => object.id === body.unitId) || {};
  const unitName = subject.label || '1ª Brigata';
  const armyName = subject.subtitle ? String(subject.subtitle).split(' ·')[0] : 'I Corpo';
  const rows = action === 'reinforce'
    ? [
      { label: 'Uomini del reparto', before: 0, after: 11000, unit: 'numero', tone: 'neutral' },
      { label: 'Organico', before: 0, after: 100, unit: 'pct', tone: 'positive' },
      { label: 'Riserva addestrata', before: 86400, after: 75400, unit: 'numero', tone: 'neutral' },
      { label: 'Prontezza', before: 0, after: 50, unit: 'pct', tone: 'warning' },
    ]
    : action === 'reequip'
      ? [
        { label: 'Fucili d’assalto del reparto', before: 37, after: 8800, unit: 'numero', tone: 'neutral' },
        { label: 'Copertura armi individuali', before: 0.4, after: 100, unit: 'pct', tone: 'positive' },
        { label: 'Deposito · Fucili d’assalto', before: 20000, after: 11237, unit: 'numero', tone: 'neutral' },
        { label: 'Prontezza', before: 50, after: 100, unit: 'pct', tone: 'positive' },
      ]
      : action === 'transfer'
        ? [
          { label: 'Cibo (scorte)', before: 128.4, after: 128.25, unit: 'numero', tone: 'neutral' },
          { label: 'Carburante (scorte)', before: 44.2, after: 43.57, unit: 'numero', tone: 'neutral' },
          { label: 'Cassa', before: 96.4, after: 96.35, unit: 'mld', tone: 'neutral' },
        ]
        : [
          { label: 'Reparti · I Corpo', before: 2, after: 1, unit: 'numero', tone: 'neutral' },
          { label: 'Uomini · I Corpo', before: 22000, after: 11000, unit: 'numero', tone: 'neutral' },
          { label: 'Reparti · II Corpo', before: 1, after: 2, unit: 'numero', tone: 'neutral' },
          { label: 'Uomini · II Corpo', before: 11000, after: 22000, unit: 'numero', tone: 'neutral' },
        ];
  return {
    applied: !dryRun,
    action,
    unitId: body.unitId || 'army-alpha-1-unit-001',
    unitName,
    armyId: subject.parentId || 'army-alpha-1',
    armyName,
    blocked: false,
    blockedReason: null,
    rows,
    unit: {
      id: body.unitId || 'army-alpha-1-unit-001', armyId: subject.parentId || 'army-alpha-1', name: unitName, personnel: 11000,
      equipment: { fucili: 8800 }, monthlyNeeds: { fuel: 0.03, weapons: 0.2, food: 0.06 },
      readiness: 1, status: 'operational', regionId: 'ALPHA', regionName: 'Alpha',
      updatedDate: '1951-01-01', legacyDerived: false,
    },
    regionName: action === 'transfer' ? 'Beta' : 'Alpha',
    stock: action === 'transfer' ? { food: 128.25, fuel: 43.57, money: 96.35 } : undefined,
    note: action === 'transfer' ? '«1ª Brigata» trasferito in Beta.' : 'Azione applicata dal motore.',
    why: 'Gli uomini passano dalla riserva addestrata al reparto: nessuno viene creato dal nulla.',
  };
}

/**
 * MILITARY-UNITS PR2 — esito (o anteprima) di un ordine del fronte. I numeri sono
 * quelli del contratto del motore: pressione, perdite stimate, consumi.
 */
export function mockOrderImpact(order, unitId = 'army-alpha-1-unit-001') {
  const subject = MOCK_OBJECTS.objects.find(object => object.id === unitId) || {};
  const label = subject.label || '1ª Brigata';
  const orders = { attack: 'Attacca', defend: 'Difendi', reserve: 'Riserva', withdraw: 'Ripiega' };
  const rows = order === 'attack'
    ? [
      { label: 'Pressione dell’attacco', before: 100, after: 135, unit: 'pct', tone: 'neutral' },
      { label: 'Perdite stimate', before: 0, after: 540, unit: 'numero', tone: 'warning' },
      { label: 'Consumi di guerra', before: 0.3, after: 0.5, unit: 'per_mese', tone: 'neutral' },
    ]
    : order === 'withdraw'
      ? [
        { label: 'Pressione dell’attacco', before: 135, after: 0, unit: 'pct', tone: 'critical' },
        { label: 'Perdite stimate', before: 540, after: 120, unit: 'numero', tone: 'warning' },
      ]
      : [
        { label: 'Pressione dell’attacco', before: 135, after: 100, unit: 'pct', tone: 'neutral' },
        { label: 'Perdite stimate', before: 540, after: 300, unit: 'numero', tone: 'warning' },
      ];
  return {
    applied: false,
    unitId,
    unitName: label,
    order,
    previousOrder: 'defend',
    frontId: 'front-AUT-ITA',
    frontName: 'Fronte Italia–Austria',
    rows,
    unit: {
      id: unitId, armyId: subject.parentId || 'army-alpha-1', name: label, personnel: 11000,
      equipment: { fucili: 37 }, monthlyNeeds: { fuel: 0.03, weapons: 0.2, food: 0.06 },
      readiness: 0.5, status: 'operational', regionId: 'ALPHA', regionName: 'Alpha',
      updatedDate: '1951-01-01', legacyDerived: false, order,
      frontId: 'front-AUT-ITA',
    },
    note: `Ordine «${orders[order] || order}» registrato per «${label}».`,
    why: 'L’ordine è dello stesso motore per il giocatore e per gli NPC: cambia pressione, perdite e consumi.',
  };
}

export function mockFormationImpact(armyId, armyName = 'III Corpo') {
  const blocked = armyId === 'army-alpha-2';
  return {
    plan: {
      men: 11000,
      items: [
        { equipmentId: 'fucili', name: 'Fucili d’assalto', required: 8800, available: 20000, consumed: 8800, missing: 0, unitCostMln: 0.02 },
        { equipmentId: 'carri_3', name: 'Carri armati', required: 2, available: 6, consumed: 2, missing: 0, unitCostMln: 4000 },
      ],
      riflesRequired: 8800, riflesAvailable: 20000, riflesMissing: 0, riflesConsumed: blocked ? 37 : 8800,
      initialCostMln: 8176, blocked, blockedReason: blocked ? 'Servono 8.763 fucili in più: il deposito non basta.' : null,
      basis: 'La dotazione di riferimento è quella dell’epoca: 1 reparto = 11.000 uomini, 80% con arma individuale.',
    },
    armyId: armyId ?? null,
    armyName,
    targetRegionId: 'ALPHA',
    target: { regionId: 'ALPHA', regionName: 'Alpha', armyName, armyId: armyId ?? null },
    before: { formations: 3, activePersonnel: 55000, readinessPct: 15 },
    after: { formations: 4, activePersonnel: 66000, readinessPct: 18 },
    reserves: { required: 11000, available: 86400, missing: 0 },
    deltas: [
      { label: 'Reparti', unit: 'numero', before: 3, after: 4, tone: 'positive' },
      { label: 'Uomini in armi', unit: 'numero', before: 55000, after: 66000, tone: 'positive' },
      // OP-OBJECTS PERSISTENT: la riserva è uno stock che si consuma.
      { label: 'Riserva addestrata', unit: 'numero', before: 86400, after: 75400, tone: 'warning' },
      { label: 'Deposito armi individuali', unit: 'numero', before: 20000, after: 11200, tone: 'neutral' },
      { label: 'Armi individuali assegnate', unit: 'numero', before: 0, after: 8800, tone: 'neutral' },
      { label: 'Prontezza', unit: 'pct', before: 15, after: 18, tone: 'positive' },
      { label: 'Consumo carburante', unit: 'per_mese', before: 1.04, after: 1.12, tone: 'warning' },
      { label: 'Spesa militare', unit: 'mld', before: 4.8, after: 4.88, tone: 'neutral' },
    ],
    why: 'Il PRIMA → DOPO è calcolato dal motore sui conti della nazione: aggiungere un reparto consuma equipaggiamento dal deposito e alza spesa e fabbisogni.',
  };
}

export const MOCK_ARSENAL = {
  polityId: 'ALPHA',
  // OP-OBJECTS PERSISTENT: totale nazionale = deposito + assegnato agli oggetti.
  units: { fucili: 37, carri_3: 6 },
  stockpile: { fucili: 37, carri_3: 5 },
  assigned: { fucili: 0, carri_3: 1 },
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
      // Armi individuali: unità = singolo pezzo, non più «lotto» da 40.
      quality: 35, tier: 'datato', costMln: 4, weaponsCost: 0.02,
      role: 'Arma individuale della fanteria di linea',
      description: 'Fucile automatico d’ordinanza: equipaggia il singolo soldato ed è la base di ogni reparto appiedato.',
      specs: [{ label: 'Calibro', value: '5,56 / 7,62 mm' }, { label: 'Gittata utile', value: '300–400 m' }],
      canBuild: true, canBuy: true, buildCostMln: 4, buyCostMln: 6, reasons: [],
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
  // Dottrina militare e capacità industriale pubblicate dal motore
  // (COUNTRY-CLARITY ENGINE): ALPHA è un paese del 1951, quindi guerra fredda.
  // Uomini, dotazioni, copertura e prontezza sono coerenti fra loro: la UI li
  // mostra soltanto.
  epoch: 'guerra_fredda',
  epochLabel: 'Guerra fredda',
  establishment: [
    { category: 'individualWeapons', label: 'Armi individuali', perFormation: null, perMobilized: null, personnelSharePct: 80, demand: 'personnel_share', weight: 0.35, source: 'engine_seed', basis: 'Fanteria numerosa, con armi automatiche di ordinanza: la coda logistica si allarga.' },
    { category: 'armoredMobility', label: 'Mobilità corazzata', perFormation: 2, perMobilized: 2, personnelSharePct: null, demand: 'per_formation', weight: 0.2, source: 'doctrine', basis: 'Meccanizzazione di massa: la fanteria si muove protetta.' },
    { category: 'artillery', label: 'Artiglieria', perFormation: 1.5, perMobilized: 1.5, personnelSharePct: null, demand: 'per_formation', weight: 0.15, source: 'doctrine', basis: 'Artiglieria e lanciarazzi coprono il fronte.' },
    { category: 'supportWeapons', label: 'Armi di supporto', perFormation: 0.6, perMobilized: 0.6, personnelSharePct: null, demand: 'per_formation', weight: 0.1, source: 'doctrine', basis: 'Difesa aerea di punto per le colonne.' },
    { category: 'airSupport', label: 'Supporto aereo', perFormation: 0.3, perMobilized: 0.3, personnelSharePct: null, demand: 'per_formation', weight: 0.1, source: 'doctrine', basis: 'Il caccia da superiorità aerea è la misura del potere aereo.' },
    { category: 'navalSupport', label: 'Supporto navale', perFormation: 0.3, perMobilized: 0.3, personnelSharePct: null, demand: 'per_formation', weight: 0.1, source: 'doctrine', basis: 'Flotte di scorta per le rotte: solo per paesi con cantieri.' },
  ],
  manpower: {
    population: 1000000, eligiblePopulation: 170000, totalMilitaryPool: 170000,
    activePersonnel: 33000, reservePersonnel: 39600, mobilizedPersonnel: 22000,
    availableReserve: 17600, formations: 3, mobilizedFormations: 2, menPerFormation: 11000,
    mobilizationCap: 119000, mobilizationHeadroom: 97000, overMobilized: false,
  },
  coverage: [
    // 5 reparti (3 + 2 richiamati) × 11.000 uomini × 80% = 44.000 armi individuali.
    // Con 37 fucili in servizio la copertura è dello 0,1%: il motore non finge.
    { category: 'individualWeapons', label: 'Armi individuali', required: 44000, available: 37, coveragePct: 0.1, missing: 43963, items: ['Fucili d’assalto ×37'], weight: 0.35 },
    { category: 'armoredMobility', label: 'Mobilità corazzata', required: 6, available: 6, coveragePct: 100, missing: 0, items: ['Carri armati di 3ª generazione ×6'], weight: 0.2 },
    { category: 'artillery', label: 'Artiglieria', required: 5, available: 0, coveragePct: 0, missing: 5, items: [], weight: 0.15 },
    { category: 'supportWeapons', label: 'Armi di supporto', required: 2, available: 0, coveragePct: 0, missing: 2, items: [], weight: 0.1 },
    { category: 'airSupport', label: 'Supporto aereo', required: 1, available: 0, coveragePct: 0, missing: 1, items: [], weight: 0.1 },
    { category: 'navalSupport', label: 'Supporto navale', required: 1, available: 0, coveragePct: 0, missing: 1, items: [], weight: 0.1 },
  ],
  readiness: {
    readinessPct: 15,
    status: 'critical',
    drivers: [
      { tone: 'critical', label: 'Copertura armi individuali 0,1%', detail: '37 in servizio su 44.000 della dotazione di riferimento.' },
      { tone: 'critical', label: 'Copertura artiglieria 0%', detail: '0 in servizio su 5 della dotazione di riferimento.' },
      { tone: 'warning', label: '22.000 riservisti richiamati', detail: 'Le riserve consumano equipaggiamento per diventare operative.' },
      { tone: 'positive', label: 'Carburante: >12 mesi', detail: 'Copertura piena delle operazioni.' },
    ],
  },
  // OP-OBJECTS — la sala di governo: oggetti concreti e catene.
  objects: MOCK_OBJECTS,
  industrialCapacity: {
    total: 22, used: 8, free: 14, utilizationPct: 36.4, demand: 8, satisfactionPct: 100,
    overflowFactor: 1, saturated: false, blocked: false,
    allocations: [
      { id: 'ord-mock-1', kind: 'military_production', label: 'Fucili d’assalto ×40', capacityDemand: 4, sector: 'Fanteria (terra)', basis: 'Voce di catalogo: 1 fabbrica richiesta.' },
      { id: 'proc-1', kind: 'project', label: 'Ferrovia transnazionale', capacityDemand: 4, sector: 'Infrastrutture e progetti', basis: 'Progetto di 8 mesi, 38% completato.' },
    ],
    byKind: { military_production: 4, project: 4, maintenance: 0 },
    defenceSharePct: 50,
    totalBasis: '2 fabbriche × 10 linee · 1 porti × 4',
  },
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
 *  - `advanceResult`: esito restituito dall'avanzamento del turno (default
 *    `world_advanced`); usato per verificare i casi in cui il mondo NON cambia.
 */
export function installMockApi(page, opts = {}) {
  const { failWorldGen = false, advanceResult = null, accountHistory = null, resources = null } = opts;

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
  // Editor del preset (tab «5. Mappa»): dati editabili + rapporto catalogo.
  // Il preset mock non ha map.geojson: il selettore di mappe native è attivo.
  page.route(`${API_BASE}/templates/${MOCK_TEMPLATE.id}/edit`, (route) =>
    json(route, { ...MOCK_TEMPLATE, map_geojson: null }));
  page.route(`${API_BASE}/templates/${MOCK_TEMPLATE.id}/scenario`, (route) =>
    json(route, { presetId: MOCK_TEMPLATE.id, hasCatalog: false, report: null }));

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

  // Il server è autorevole: dopo un avanzamento il giocatore rilegge lo stato e
  // deve vedere il turno nuovo (non quello del fixture statico).
  let worldAdvanced = false;
  page.route(`${API_BASE}/games/${MOCK_GAME_ID}`, (route) => json(route, worldAdvanced
    ? { ...MOCK_GAME, currentTurn: 2, currentDate: '1951-02-01', worldRevision: 2 }
    : MOCK_GAME));

  // ── Stato di gioco (chiamate fatte all'apertura dell'HUD) ────────────────
  // Il client chiede la cronaca con `?after=&limit=`: il glob copre la query.
  page.route(`${API_BASE}/games/${MOCK_GAME_ID}/timeline*`, (route) =>
    json(route, { timeline: MOCK_TIMELINE, currentDate: '1951-01-01', hasMore: false, nextAfter: 0 }));
  page.route(`${API_BASE}/games/${MOCK_GAME_ID}/ongoing-processes`, (route) =>
    json(route, { processes: MOCK_ONGOING_PROCESSES }));
  page.route(`${API_BASE}/games/${MOCK_GAME_ID}/national-state`, (route) =>
    json(route, {
      accounts: MOCK_ACCOUNTS,
      history: accountHistory || MOCK_ACCOUNT_HISTORY,
      resources: resources ? { ...MOCK_RESOURCES, ...resources } : MOCK_RESOURCES,
      government: MOCK_GOVERNMENT,
      // GAMEPLAY-LONG: registro strutturato degli impegni (il motore è l'autorità).
      commitments: MOCK_COMMITMENTS,
    }));
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
  // OP-OBJECTS: anteprima (sola lettura) e creazione reale di reparti.
  page.route(`${API_BASE}/games/${MOCK_GAME_ID}/military/formation*`, (route) => {
    const url = new URL(route.request().url());
    const armyId = url.searchParams.get('armyId');
    if (route.request().method() === 'POST') {
      let body = {};
      try { body = route.request().postDataJSON() || {}; } catch { body = {}; }
      const impact = mockFormationImpact(body.armyId ?? null, body.name || 'III Corpo');
      return json(route, {
        ...impact, applied: true, formations: body.formations ?? 1,
        name: body.armyId ? impact.armyName : 'III Corpo', regionId: 'ALPHA', regionName: 'Alpha',
        spentMln: impact.plan.initialCostMln, financedMln: 0, impact,
      });
    }
    return json(route, mockFormationImpact(armyId));
  });
  // MILITARY-UNITS: i reparti e le loro azioni (anteprima `dryRun` e conferma).
  // MAP P2 — lo stato militare persistente è canonico: di default nessun
  // reparto né fronte nel mondo mock (mondo solo SVG). Gli E2E che mappano lo
  // stato militare registrano le proprie fixture AFTER installMockApi.
  // MAP P6 — il mondo mock non ha catalogo strict bindato: la fotografia
  // canonica è vuota e `canonical: false` (comportamento reale di un mondo
  // legacy). Gli E2E della mappa P6 registrano la propria fixture AFTER.
  page.route(`${API_BASE}/games/${MOCK_GAME_ID}/map-assets`, (route) =>
    json(route, { resources: [], facilities: [], canonical: false }));
  page.route(`${API_BASE}/games/${MOCK_GAME_ID}/military/fronts`, (route) =>
    json(route, { fronts: [] }));
  page.route(`${API_BASE}/games/${MOCK_GAME_ID}/military/units`, (route) =>
    json(route, { units: [] }));
  page.route(`${API_BASE}/games/${MOCK_GAME_ID}/military/units/**`, (route) => {
    const pathname = new URL(route.request().url()).pathname;
    const action = pathname.slice(pathname.lastIndexOf('/') + 1);
    let body = {};
    try { body = route.request().postDataJSON() || {}; } catch { body = {}; }
    const unitId = pathname.split('/').slice(-2)[0];
    // PR2: `.../order` porta l'ordine nel corpo, non nel percorso.
    if (action === 'order') return json(route, mockOrderImpact(String(body.order || 'attack'), unitId));
    return json(route, mockUnitImpact(action, { ...body, unitId }));
  });
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
  // ARMY-MOVE P3: proposte non vuote, così l'E2E può verificare che il pannello
  // si azzeri all'avanzamento del turno e si rigeneri solo su richiesta.
  page.route(`${API_BASE}/games/${MOCK_GAME_ID}/suggestions`, (route) =>
    json(route, { suggestions: MOCK_SUGGESTIONS }));

  // ── Avanzamento (ARMY-MOVE P3) ───────────────────────────────────────────
  // Il salto è asincrono: POST del job, polling dello stato, poi l'esito.
  page.route(`${API_BASE}/games/${MOCK_GAME_ID}/simulation-jobs`, (route) => {
    if (route.request().method() !== 'POST') return notFound(route);
    return json(route, { jobId: 'mock-advance-job', status: 'running' });
  });
  page.route(`${API_BASE}/games/${MOCK_GAME_ID}/simulation-jobs/mock-advance-job`, (route) =>
    json(route, { jobId: 'mock-advance-job', status: 'completed' }));
  page.route(`${API_BASE}/games/${MOCK_GAME_ID}/simulation-jobs/mock-advance-job/result`, (route) => {
    // Solo un esito che committa un turno cambia lo stato del mondo.
    if (!advanceResult || advanceResult.type !== 'no_event_found') worldAdvanced = true;
    return json(route, advanceResult || {
      type: 'world_advanced',
      simulationId: 'mock-simulation-2',
      revision: 2,
      newTurn: 2,
      newDate: '1951-02-01',
      result: {
        simulationId: 'mock-simulation-2',
        turn: 1,
        narration: 'Il periodo passa senza crisi: la Confederazione consolida le proprie posizioni.',
        events: ['Consolidamento interno'],
        eventDetails: [],
        periodStart: '1951-01-01',
        periodEnd: '1951-02-01',
      },
    });
  });

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
