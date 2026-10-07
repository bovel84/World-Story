import { WorldStateEngine, type WorldStateRegion, type NationalAccount } from './WorldStateEngine';
import { coastalFromGeojson } from './NationCapacity';
import { militaryManpower, arsenalSeedUnits, epochForDate, individualWeaponShareFor } from './MilitaryDoctrine';
import { equipmentById, EQUIPMENT_CREW } from './MilitaryIndustry';
import { storageCapacity, initialResearchCap, availableTechnologiesAt, technologyAvailableAt, closeTechnologySet, technologyById } from './MaterialEconomy';
import { referenceGdpUsdBillionsForDate, referenceDebtToGdpPctForDate, referencePopulationForDate, isLandlockedPolity } from '../../utils/country-facts';
import { LLMError } from '../../llm/types';

/** Sezione opzionale del bootstrap: scorte e tecnologia iniziali specifiche per nazione/data.
 * Se assente, la semina materiale segue la logica deterministica di `seedStock`. */
export interface CountryInitialResources {
  food?: number;
  clothing?: number;
  weapons?: number;
  fuel?: number;
  research?: number;
  technologies?: string[];
}

/** Immutable bootstrap anchors. Money/flows are billions USD; personnel are people.
 * Infrastructure counts represent national TOTALS, not extra map assets. */
export interface CountryInitialProfile {
  version: 1;
  polityId: string;
  startDate: string;
  population: number;
  economy: { nominalGdpUsdBillions: number; debtRatioPct: number; treasuryUsdBillions: number; taxRatePct: number; monthlyRevenue: number; monthlyExpenses: number };
  military: { activePersonnel: number; reservePersonnel: number; formations: number; averageFormationSize: number; readinessPct: number; defenceBurdenPct: number; equipmentProfile: Record<string, number>; trainingPct: number; qualityPct: number; logisticsPct: number };
  society: { stability: number; socialTension: number };
  infrastructure: { factories: number; ports: number; universities: number };
  /** Scorte/tecnologie iniziali stimate (opzionale). Assente nei profili/salvataggi legacy. */
  resources?: CountryInitialResources;
  /** Initial map anchors let the existing deterministic engine evolve the profile. */
  mapBaseline: { gdp: number; militaryPower: number; forces: number; factories: number; ports: number; universities: number; mobilized: number; stability: number; socialTension: number };
  provenance: { source: 'deterministic' | 'historical+map' | 'llm-estimate'; generatedAt: string; confidence: 'low' | 'medium' | 'high'; notes: string[] };
}
export interface CountryProfileInput {
  polityId: string;
  startDate: string;
  regions: WorldStateRegion[];
  historicalBaseline?: string;
  countryName?: string;
}
/** Return game-local population anchors; never mutate the shared world/preset. */
export function countryProfileRegions(regions: WorldStateRegion[], startDate: string): WorldStateRegion[] {
  const totals = new Map<string, number>();
  for (const r of regions) totals.set(r.owner, (totals.get(r.owner) || 0) + r.population);
  const assigned = new Map<string, number>();
  const last = new Map<string, string>();
  for (const r of regions) last.set(r.owner, r.id);
  return regions.map(r => {
    const observed = referencePopulationForDate(r.owner, startDate);
    const total = totals.get(r.owner) || 0;
    if (observed === null || total <= 0) return { ...r };
    const population = last.get(r.owner) === r.id ? observed - (assigned.get(r.owner) || 0)
      : Math.floor(observed * r.population / total);
    assigned.set(r.owner, (assigned.get(r.owner) || 0) + population);
    return { ...r, population };
  });
}
export type CountryProfileSection = 'economy' | 'national-state' | 'military-resources';
/** Budget per sezione: piccolo e dedicato, non 4000 token per ognuna. */
export const COUNTRY_BOOTSTRAP_SECTION_MAX_TOKENS: Record<CountryProfileSection, number> = {
  economy: 1_200,
  'national-state': 1_200,
  'military-resources': 1_800,
};
/** Budget del secondo (e ultimo) tentativo quando il primo torna vuoto: nei
 * modelli reasoning il thinking può consumare l'intero budget e lasciare
 * `message.content` vuoto, quindi la sezione va rifatta con più spazio. */
export const COUNTRY_BOOTSTRAP_SECTION_REPAIR_MAX_TOKENS: Record<CountryProfileSection, number> = {
  economy: 3_000,
  'national-state': 3_000,
  'military-resources': 4_500,
};
/** Una completion per sezione; il quarto argomento porta budget e sezione. */
export type CountryProfileCompleter = (
  system: string,
  prompt: string,
  signal: AbortSignal,
  options?: { maxTokens?: number; section?: CountryProfileSection },
) => Promise<string>;
const positive = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value) && value >= 0;
const pct = (value: unknown) => positive(value) && value <= 100;
const round = (n: number) => Math.round(n * 1e6) / 1e6;

/** Popolazione storica stimata dall'LLM: accettata solo se plausibile rispetto
 * al totale di mappa, così un valore moderno non viene spacciato per storico.
 * `null` quando manca del tutto una stima o è fuori scala. */
export function plausiblePopulation(value: unknown, mapTotal: number): number | null {
  if (!positive(value) || value <= 0) return null;
  const population = Math.round(value);
  if (population < 1 || population > 2_000_000_000) return null;
  if (mapTotal > 0 && (population < mapTotal * 0.1 || population > mapTotal * 5)) return null;
  return population;
}

/** Stima storica LLM della popolazione quando manca la reference. Oltre al range
 * generale, rifiuta un valore indistinguibile (±5%) dal totale di mappa: il
 * prompt dichiara mapPopulation come ordine di grandezza moderno, quindi una
 * copia non è una ricostruzione storica. Non è hardcoded per paese. */
export function historicalPopulationEstimate(value: unknown, mapTotal: number): number | null {
  const population = plausiblePopulation(value, mapTotal);
  if (population === null) return null;
  if (mapTotal > 0 && Math.abs(population - mapTotal) <= mapTotal * 0.05) return null;
  return population;
}
/** Costa marittima: una polity senza sbocco al mare non ha litorale, anche
 * quando la mappa marca `Coastal` una provincia lacustre (es. lago Vittoria). */
const coast = (input: CountryProfileInput) => !isLandlockedPolity(input.polityId)
  && input.regions.some(r => r.owner === input.polityId && (r.coastal ?? coastalFromGeojson(r.id, r.geojson)));
const authored = (input: CountryProfileInput, type: string) => input.regions.filter(r => r.owner === input.polityId).reduce((sum, r) => sum + (r.objects || []).filter(o => o.type === type).reduce((n, o) => n + Math.max(1, o.level || 1), 0), 0);

function materialAccount(input: CountryProfileInput): NationalAccount | undefined {
  return WorldStateEngine.accounts(input.regions, { modernFacts: input.startDate.startsWith('2024-'), startDate: input.startDate })[input.polityId];
}

/** Limiti infrastrutturali larghi ma dipendenti da popolazione, PIL e geografia.
 * Bloccano output palesemente assurdi senza penalizzare le grandi potenze. Il
 * totale nazionale non può mai scendere sotto gli oggetti authored della mappa;
 * un paese senza costa ha come tetto porti esattamente i porti authored. */
export function infrastructureCaps(input: CountryProfileInput): { factories: number; universities: number; ports: number } {
  const own = input.regions.filter(r => r.owner === input.polityId);
  const account = materialAccount(input);
  const population = referencePopulationForDate(input.polityId, input.startDate) ?? account?.population ?? own.reduce((n, r) => n + r.population, 0);
  const gdp = referenceGdpUsdBillionsForDate(input.polityId, input.startDate) ?? account?.nominalGdpUsdBillions ?? own.reduce((n, r) => n + r.gdp, 0);
  return {
    factories: Math.max(authored(input, 'factory'), Math.ceil(population / 2_000_000) + Math.ceil(gdp / 100) + 4),
    universities: Math.max(authored(input, 'university'), Math.ceil(population / 5_000_000) + Math.ceil(gdp / 250) + 3),
    ports: coast(input)
      ? Math.max(authored(input, 'port'), Math.ceil(population / 20_000_000) + Math.ceil(gdp / 200) + 2)
      : authored(input, 'port'),
  };
}

/** Scorte/tecnologie iniziali validate: stock finiti e non negativi clampati
 * alla capacità di stoccaggio, tecnologie note e disponibili alla data.
 * Restituisce `undefined` se non resta nulla di utilizzabile: in quel caso la
 * semina materiale resta quella deterministica. */
export function sanitizeInitialResources(raw: unknown, input: CountryProfileInput): CountryInitialResources | undefined {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return undefined;
  const value = raw as Record<string, unknown>;
  const account = materialAccount(input);
  const capacity = account ? storageCapacity(account) : undefined;
  const resources: CountryInitialResources = {};
  for (const kind of ['food', 'clothing', 'weapons', 'fuel'] as const) {
    const amount = value[kind];
    if (!Number.isFinite(Number(amount)) || Number(amount) < 0) continue;
    const cap = capacity?.[kind];
    const bounded = cap === undefined ? Number(amount) : Math.min(Number(amount), cap);
    resources[kind] = Math.round(bounded * 1000) / 1000;
  }
  if (Number.isFinite(Number(value.research)) && Number(value.research) >= 0) {
    resources.research = Math.round(Math.min(Number(value.research), initialResearchCap(account)) * 1000) / 1000;
  }
  if (Array.isArray(value.technologies)) {
    const requested = value.technologies.filter((id): id is string => typeof id === 'string' && technologyAvailableAt(id, input.startDate));
    if (requested.length > 0) resources.technologies = closeTechnologySet([...new Set(requested)]);
  }
  const empty = resources.food === undefined && resources.clothing === undefined && resources.weapons === undefined
    && resources.fuel === undefined && resources.research === undefined && !resources.technologies?.length;
  return empty ? undefined : resources;
}

/** These are explicit approximate start-year estimates, NOT precise inventory records.
 * USA personnel: DoD historical manpower (FY2000 ~1.38m active, ~0.87m reserve).
 * BIH: post-Dayton separate forces ~30k around 2000; integrated 2024 AF ~9k.
 * Budget/readiness/training are conservative gameplay estimates, marked medium.
 * These values seed the FALLBACK, not protected completion anchors.
 * Do not propagate these to other years. */
function countryEstimate(input: CountryProfileInput) {
  const year = Number(input.startDate.slice(0, 4));
  if (input.polityId === 'USA' && year === 2000) return { active: 1_384_000, reserve: 865_000, size: 8000, defence: 3, tax: 28, expenses: 29, ready: 78, stability: 76, tension: 24 };
  if (input.polityId === 'BIH' && year === 2000) return { active: 30_000, reserve: 40_000, size: 2500, defence: 5, tax: 30, expenses: 34, ready: 42, stability: 40, tension: 62 };
  if (input.polityId === 'BIH' && year === 2024) return { active: 9000, reserve: 0, size: 2250, defence: 1, tax: 32, expenses: 35, ready: 48, stability: 51, tension: 48 };
  return null;
}

export function buildCountryInitialProfile(input: CountryProfileInput): CountryInitialProfile {
  const account = WorldStateEngine.accounts(input.regions, { modernFacts: input.startDate.startsWith('2024-'), startDate: input.startDate })[input.polityId];
  if (!account) throw new Error('Profile requires an owned region');
  const known = countryEstimate(input);
  const population = referencePopulationForDate(input.polityId, input.startDate) ?? account.population;
  const gdp = referenceGdpUsdBillionsForDate(input.polityId, input.startDate) ?? account.nominalGdpUsdBillions;
  const doctrine = militaryManpower({ population, formations: account.forces, mobilizedFormations: 0, epoch: epochForDate(input.startDate) });
  // Cap generic estimates by demography: sparse map armies cannot consume a small country's population.
  const authoredFormations = authored(input, 'army') + authored(input, 'battalion');
  let active = Math.floor(Math.min(population * 0.03, known?.active ?? doctrine.activePersonnel));
  // A populated authored company needs at least one person. Impossible tiny
  // synthetic maps retain empty organizations, never invented population.
  if (active < authoredFormations) active = authoredFormations <= Math.floor(population * 0.05) ? authoredFormations : 0;
  const size = Math.max(1, Math.min(active || 1, known?.size ?? Math.min(20000, Math.max(500, Math.round(Math.sqrt(population) * 2)))));
  const formations = Math.max(authoredFormations, active > 0 ? Math.ceil(active / size) : 0);
  // Nessun fallback implicito a zero: `null` = serie storica mancante. Il
  // profilo deterministico usa 0 solo come segnaposto dichiarato in provenance.
  const referenceDebt = referenceDebtToGdpPctForDate(input.polityId, input.startDate);
  const debt = referenceDebt ?? 0;
  const tax = known?.tax ?? account.taxRatePct ?? 9;
  const defence = known?.defence ?? account.defenceBurdenPct;
  const readiness = known?.ready ?? Math.max(15, Math.min(80, Math.round(25 + Math.log10(Math.max(gdp / Math.max(population, 1) * 1e9, 1)) * 7)));
  const equipment = arsenalSeedUnits(epochForDate(input.startDate), formations, 0);
  if (Number(input.startDate.slice(0, 4)) < 1940) delete equipment.apc;
  else if (equipment.apc) equipment.apc = Math.min(equipment.apc, Math.floor(active / 10));
  equipment.fucili = Math.round(active * individualWeaponShareFor(epochForDate(input.startDate)));
  return {
    version: 1, polityId: input.polityId, startDate: input.startDate, population,
    economy: { nominalGdpUsdBillions: gdp, debtRatioPct: debt, treasuryUsdBillions: Math.max(0.005, round(gdp * 0.02)), taxRatePct: tax, monthlyRevenue: round(gdp * tax / 1200), monthlyExpenses: round(known ? gdp * known.expenses / 1200 : account.monthlyExpenses) },
    military: { activePersonnel: active, reservePersonnel: Math.round(Math.min(Math.max(0, population * 0.15 - active), known?.reserve ?? doctrine.reservePersonnel)), formations, averageFormationSize: formations ? active / formations : 0, readinessPct: readiness, defenceBurdenPct: defence, equipmentProfile: equipment, trainingPct: readiness, qualityPct: readiness, logisticsPct: readiness },
    society: { stability: known?.stability ?? account.stability, socialTension: known?.tension ?? account.socialTension },
    infrastructure: { factories: account.factories, ports: Math.min(account.ports, infrastructureCaps(input).ports), universities: account.universities },
    mapBaseline: { gdp: account.gdp, militaryPower: account.militaryPower, forces: authored(input, 'army') + authored(input, 'battalion') + authored(input, 'fleet') + authored(input, 'missile'), factories: authored(input, 'factory'), ports: authored(input, 'port'), universities: authored(input, 'university'), mobilized: account.mobilized, stability: account.stability, socialTension: account.socialTension },
    provenance: { source: known || referenceGdpUsdBillionsForDate(input.polityId, input.startDate) !== null ? 'historical+map' : 'deterministic', generatedAt: new Date().toISOString(), confidence: known ? 'medium' : 'low', notes: ['Map inventory is authoritative; initial rates/coverage are estimates, not precise historical inventories.', ...(referenceDebt === null ? ['No date-correct debt observation: deterministic zero-debt fallback, not evidence of absence.'] : [])] },
  };
}

const ADMISSION_YEAR: Record<string, number> = { fucili: 0, apc: 1940, carri_3: 1975, carri_4: 2015,
  artiglieria: 1940, mlrs: 1940, sam_corto: 1960, sam_lungo: 1980, caccia_3: 1960, caccia_4: 1975,
  caccia_5: 2005, bombardieri: 1950, trasporto: 1940, elicotteri: 1965, aew: 1970,
  pattugliatori: 1940, corvette: 1960, fregate: 1970, cacciatorpediniere: 1980, sottomarini: 1960,
  portaerei: 1960, missili_corto: 1960, missili_medio: 1970, cruise: 1980, antinave: 1960,
  ipersonici: 2020, droni_ricognizione: 1995, droni_attacco: 2005, droni_kamikaze: 2010,
  droni_navali: 2020, sciame: 2025 };

/** Validazione per sezione: riusata sia dal firewall finale sia dalla
 * composizione per sezioni, così le due strade non possono divergere. */
function validEconomySection(e: unknown): e is CountryInitialProfile['economy'] {
  if (!e || typeof e !== 'object') return false;
  const v = e as CountryInitialProfile['economy'];
  return [v.nominalGdpUsdBillions, v.debtRatioPct, v.treasuryUsdBillions, v.taxRatePct, v.monthlyRevenue, v.monthlyExpenses].every(positive)
    && v.nominalGdpUsdBillions > 0 && v.nominalGdpUsdBillions <= 1_000_000
    && v.debtRatioPct <= 250
    && v.treasuryUsdBillions <= Math.max(0.01, v.nominalGdpUsdBillions * 0.5)
    && v.taxRatePct <= 60
    && Math.abs(v.monthlyRevenue - v.nominalGdpUsdBillions * v.taxRatePct / 1200) <= Math.max(0.00001, v.monthlyRevenue * 0.02)
    && v.monthlyExpenses * 12 <= v.nominalGdpUsdBillions * 0.8;
}

function validMilitarySection(m: unknown, input: CountryProfileInput, population: number): m is CountryInitialProfile['military'] {
  if (!m || typeof m !== 'object') return false;
  const v = m as CountryInitialProfile['military'];
  if (![v.activePersonnel, v.reservePersonnel, v.formations, v.averageFormationSize].every(positive)
    || ![v.activePersonnel, v.reservePersonnel, v.formations].every(Number.isInteger)) return false;
  if (v.activePersonnel > population * 0.05 || v.activePersonnel + v.reservePersonnel > population * 0.2
    || v.formations > Math.max(1000, authored(input, 'army') + authored(input, 'battalion'))
    || (v.activePersonnel > 0 && (v.formations < 1 || v.activePersonnel / v.formations < 1 || v.activePersonnel / v.formations > 50_000))) return false;
  if (v.activePersonnel === 0 && v.formations > authored(input, 'army') + authored(input, 'battalion')) return false;
  if (Math.abs(v.activePersonnel - v.formations * v.averageFormationSize) > 1
    || ![v.readinessPct, v.defenceBurdenPct, v.trainingPct, v.qualityPct, v.logisticsPct].every(pct)
    || v.defenceBurdenPct > 30) return false;
  if (!v.equipmentProfile || typeof v.equipmentProfile !== 'object' || Array.isArray(v.equipmentProfile)) return false;
  // Admission years conservative: le voci fuori catalogo o troppo antiche falliscono chiuse.
  let crew = 0;
  for (const [id, quantity] of Object.entries(v.equipmentProfile)) {
    const spec = equipmentById(id);
    if (!spec || ADMISSION_YEAR[id] === undefined || Number(input.startDate.slice(0, 4)) < ADMISSION_YEAR[id]
      || !positive(quantity) || !Number.isInteger(quantity) || quantity > Math.max(100, v.activePersonnel * 2)
      || ((spec.domain === 'mare' || id === 'droni_navali') && quantity > 0 && !coast(input))) return false;
    if (spec.domain === 'aria' && quantity > Math.max(20, v.activePersonnel / 100)) return false;
    if (id !== 'fucili' && spec.domain === 'terra' && quantity > Math.max(10, v.activePersonnel / 2)) return false;
    crew += (EQUIPMENT_CREW[id] || 0) * quantity;
  }
  return crew <= v.activePersonnel;
}

/** Composizione per campo dell'economia: riferimento storico > stima LLM
 * valida > fallback del singolo campo. Un campo incoerente non scarta gli
 * altri (es. un `monthlyExpenses` assurdo non perde un debito LLM valido). */
function mergeEconomySection(raw: unknown, fallback: CountryInitialProfile['economy'], gdp: number | null, debt: number | null): CountryInitialProfile['economy'] {
  const r = (raw && typeof raw === 'object' ? raw : {}) as Partial<CountryInitialProfile['economy']>;
  const nominalGdpUsdBillions = gdp !== null ? gdp
    : (positive(r.nominalGdpUsdBillions) && r.nominalGdpUsdBillions > 0 && r.nominalGdpUsdBillions <= 1_000_000 ? r.nominalGdpUsdBillions : fallback.nominalGdpUsdBillions);
  const debtRatioPct = debt !== null ? debt
    : (positive(r.debtRatioPct) && r.debtRatioPct <= 250 ? r.debtRatioPct : fallback.debtRatioPct);
  const taxRatePct = positive(r.taxRatePct) && r.taxRatePct <= 60 ? r.taxRatePct : fallback.taxRatePct;
  const treasuryUsdBillions = positive(r.treasuryUsdBillions) && r.treasuryUsdBillions <= Math.max(0.01, nominalGdpUsdBillions * 0.5)
    ? r.treasuryUsdBillions : fallback.treasuryUsdBillions;
  // Revenue: se incoerente con PIL/aliquota finali si ricalcola SOLO revenue.
  const idealRevenue = nominalGdpUsdBillions * taxRatePct / 1200;
  const monthlyRevenue = positive(r.monthlyRevenue) && Math.abs(r.monthlyRevenue - idealRevenue) <= Math.max(0.00001, r.monthlyRevenue * 0.02)
    ? r.monthlyRevenue : round(idealRevenue);
  const monthlyExpenses = positive(r.monthlyExpenses) && r.monthlyExpenses * 12 <= nominalGdpUsdBillions * 0.8
    ? r.monthlyExpenses : fallback.monthlyExpenses;
  return {
    nominalGdpUsdBillions,
    debtRatioPct,
    treasuryUsdBillions: Math.min(treasuryUsdBillions, Math.max(0.01, nominalGdpUsdBillions * 0.5)),
    taxRatePct,
    monthlyRevenue,
    monthlyExpenses: Math.min(monthlyExpenses, nominalGdpUsdBillions * 0.8 / 12),
  };
}

function validSocietySection(s: unknown): s is CountryInitialProfile['society'] {
  if (!s || typeof s !== 'object') return false;
  const v = s as CountryInitialProfile['society'];
  return pct(v.stability) && pct(v.socialTension);
}

function validInfrastructureSection(i: unknown, input: CountryProfileInput): i is CountryInitialProfile['infrastructure'] {
  if (!i || typeof i !== 'object') return false;
  const v = i as CountryInitialProfile['infrastructure'];
  if (!(['factories', 'ports', 'universities'] as const).every(key => positive(v[key]) && Number.isInteger(v[key]))) return false;
  const caps = infrastructureCaps(input);
  return v.factories >= authored(input, 'factory') && v.factories <= caps.factories
    && v.ports >= authored(input, 'port') && v.ports <= caps.ports
    && v.universities >= authored(input, 'university') && v.universities <= caps.universities;
}

/** Strict all-or-fallback validation, before any persistence or stock initialization. */
export function validateCountryInitialProfile(raw: unknown, input: CountryProfileInput): CountryInitialProfile | null {
  if (!raw || typeof raw !== 'object') return null;
  const p = raw as CountryInitialProfile;
  if (p.version !== 1 || p.polityId !== input.polityId || p.startDate !== input.startDate) return null;
  const referencePopulation = referencePopulationForDate(input.polityId, input.startDate);
  const mapPopulation = input.regions.filter(r => r.owner === input.polityId).reduce((n, r) => n + r.population, 0);
  // Popolazione: riferimento storico autorevole; senza di esso una stima LLM
  // deve essere plausibile e distinguibile dal valore moderno di mappa. Per le
  // fonti deterministiche il totale di mappa resta il fallback dichiarato.
  if (referencePopulation !== null) {
    if (p.population !== referencePopulation) return null;
  } else {
    const bound = p.provenance?.source === 'llm-estimate' ? historicalPopulationEstimate : plausiblePopulation;
    if (bound(p.population, mapPopulation) === null) return null;
  }
  const { economy: e, military: m, society: s, infrastructure: i } = p;
  const own = input.regions.filter(r => r.owner === input.polityId);
  if (!e || !m || !s || !i || !p.provenance || !p.mapBaseline
    || !['gdp', 'militaryPower', 'forces', 'factories', 'ports', 'universities', 'mobilized', 'stability', 'socialTension'].every(key => positive(p.mapBaseline[key as keyof typeof p.mapBaseline]))) return null;
  if (!validEconomySection(e) || !validMilitarySection(m, input, p.population) || !validSocietySection(s) || !validInfrastructureSection(i, input)) return null;
  if (p.mapBaseline.gdp !== own.reduce((sum, r) => sum + r.gdp, 0)
    || p.mapBaseline.militaryPower !== own.reduce((sum, r) => sum + r.militaryPower, 0)) return null;
  // GDP estimates have a conservative demographic envelope, never arbitrary trillions for microstates.
  const referenceGdp = referenceGdpUsdBillionsForDate(input.polityId, input.startDate);
  if (referenceGdp === null && p.provenance.source === 'llm-estimate' && e.nominalGdpUsdBillions * 1e9 / Math.max(p.population, 1) > 250_000) return null;
  if (!['deterministic', 'historical+map', 'llm-estimate'].includes(p.provenance.source) || !['low', 'medium', 'high'].includes(p.provenance.confidence) || !Number.isFinite(Date.parse(p.provenance.generatedAt)) || !Array.isArray(p.provenance.notes) || !p.provenance.notes.every(n => typeof n === 'string' && n.length <= 1000)) return null;
  // Sezione risorse opzionale: `undefined` = semina deterministica. Se presente,
  // niente stock negativi/enormi, solo tecnologie note e non anacronistiche.
  if (p.resources !== undefined) {
    const r = p.resources;
    if (!r || typeof r !== 'object' || Array.isArray(r)) return null;
    const account = materialAccount(input);
    const capacity = account ? storageCapacity(account) : undefined;
    for (const kind of ['food', 'clothing', 'weapons', 'fuel'] as const) {
      const amount = r[kind];
      if (amount === undefined) continue;
      const cap = capacity?.[kind];
      if (!positive(amount) || (cap !== undefined && amount > cap * 1.5 + 1)) return null;
    }
    if (r.research !== undefined && (!positive(r.research) || r.research > initialResearchCap(account))) return null;
    if (r.technologies !== undefined && (!Array.isArray(r.technologies)
      || !r.technologies.every(id => typeof id === 'string' && technologyAvailableAt(id, input.startDate)))) return null;
  }
  return p;
}

/** Prompt breve e esplicito del bootstrap: ricostruzione nazionale specifica per paese e data. */
export const COUNTRY_BOOTSTRAP_SYSTEM = [
  'Bootstrap del Dossier Nazionale iniziale di una partita storica.',
  'Ricostruisci la situazione nazionale ALLA DATA DI INIZIO indicata: NON la situazione moderna e NON il futuro.',
  'Priorità: dati storici strutturati > preset/mappa > historicalBaseline > stima prudente > fallback deterministico (solo riferimento debole).',
  'Nel payload: `anchors` sono fatti autoritativi; `missing` elenca i campi senza fonte storica verificata; `fallback` è un riferimento debole, NON autoritativo.',
  'Se `missing.debtRatioPct` è true il debito storico è sconosciuto: stimane uno prudente in base a paese e data; NON copiare lo 0 del fallback, che significa “dato mancante”, non “debito nullo”.',
  'Compila in modo specifico per paese e data: economia, forze armate (activePersonnel, reservePersonnel, formations, averageFormationSize, readinessPct, defenceBurdenPct, trainingPct, qualityPct, logisticsPct, equipmentProfile) e infrastrutture (factories, ports, universities).',
  'Compila anche resources (opzionale): food, clothing, weapons, fuel (scorte materiali), research (punti ricerca) e technologies (array di ID). Le scorte sono ciò che il paese può realisticamente avere all’inizio, entro la capacità di stoccaggio: mai valori enormi.',
  'technologies deve usare ESCLUSIVAMENTE gli ID elencati in availableTechnologies; nessuna tecnologia successiva alla startDate.',
  'Se una sezione è incerta, ometti resources: il fallback deterministico resta valido.',
  'Vincoli inviolabili: nessuna tecnologia successiva alla data di inizio; nessun porto o marina per un paese senza costa; nessun valore oltre limiti demografici plausibili; nessuna quantità militare sproporzionata.',
  'Non modificare identità, polity, startDate né i dati espliciti del preset/mappa. Gli oggetti di mappa sono un MINIMO autoritativo, non necessariamente il totale nazionale: puoi stimare totali nazionali maggiori se coerenti con paese, data e geografia.',
  'Non inventare precisione falsa: se un valore è incerto usa una stima prudente. Restituisci SOLO JSON conforme allo schema del fallback fornito: nessun testo, nessuna spiegazione narrativa.',
].join('\n');

/** Timeout di UNA singola sezione. Tre call sequenziali hanno ciascuna il
 * proprio timer, ma il bootstrap ha anche un budget complessivo per non
 * restare appeso minuti dentro una singola POST /games. */
export const BOOTSTRAP_SECTION_TIMEOUT_MS = 35_000;
/** Budget complessivo del bootstrap (baseline esclusa): sotto il limite proxy,
 * così POST /games non può restare bloccata da 3 sezioni + retry. */
export const BOOTSTRAP_TOTAL_TIMEOUT_MS = 80_000;

export class CountryInitialProfileError extends Error {
  constructor(reason: string) {
    super(`Impossibile stimare il profilo iniziale del paese: ${reason}. Partita non creata.`);
    this.name = 'CountryInitialProfileError';
  }
}

/** Retry transitorio limitato: solo 429/5xx e rete, un solo tentativo in più. */
const RETRYABLE_STATUSES = new Set([408, 409, 425, 429, 500, 502, 503, 504]);
function isRetriableError(error: unknown): boolean {
  if (!error || typeof error !== 'object') return false;
  const e = error as { retriable?: unknown; status?: unknown };
  if (e.retriable === true) return true;
  return typeof e.status === 'number' && RETRYABLE_STATUSES.has(e.status);
}

function parseSectionJson(response: string): Record<string, unknown> {
  let raw: unknown;
  try { raw = JSON.parse(response.replace(/^\s*```(?:json)?\s*/i, '').replace(/\s*```\s*$/, '')); }
  catch { throw new CountryInitialProfileError('risposta LLM non interpretabile come JSON'); }
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new CountryInitialProfileError('risposta LLM priva di un profilo');
  return raw as Record<string, unknown>;
}

/** Causa sicura per il client: solo i messaggi già sanitizzati dal provider LLM. */
function safeFailureReason(error: unknown): string {
  return error instanceof LLMError && error.message ? error.message : 'completion LLM non riuscita';
}

/** Riconosce la risposta vuota del provider (thinking che esaurisce il budget). */
function isEmptyResponseError(error: unknown): boolean {
  return error instanceof LLMError && /risposta vuota dal modello/i.test(error.message);
}

/** Una sezione = al massimo DUE completion, ciascuna col proprio AbortController/
 * timeout. Primo tentativo col budget normale; secondo (e ultimo) tentativo solo
 * se il primo è vuoto (budget repair maggiore) o transitorio (503/network).
 * Mai un terzo tentativo. */
async function completeSection(
  section: CountryProfileSection,
  prompt: string,
  complete: CountryProfileCompleter,
  deadline: number,
): Promise<string> {
  const attempt = async (maxTokens: number): Promise<string> => {
    const budget = Math.min(BOOTSTRAP_SECTION_TIMEOUT_MS, deadline - Date.now());
    if (budget <= 0) throw new CountryInitialProfileError('tempo limite complessivo del bootstrap superato');
    const controller = new AbortController();
    let timeout: ReturnType<typeof setTimeout> | undefined;
    try {
      return await Promise.race([
        complete(COUNTRY_BOOTSTRAP_SYSTEM, prompt, controller.signal, { maxTokens, section }),
        new Promise<never>((_, reject) => {
          timeout = setTimeout(() => {
            controller.abort();
            reject(new CountryInitialProfileError(`tempo limite di ${Math.round(budget / 1000)} secondi superato nella sezione ${section}`));
          }, budget);
        }),
      ]);
    } finally {
      if (timeout) clearTimeout(timeout);
      controller.abort();
    }
  };

  const normal = COUNTRY_BOOTSTRAP_SECTION_MAX_TOKENS[section];
  const repair = COUNTRY_BOOTSTRAP_SECTION_REPAIR_MAX_TOKENS[section];
  try {
    return await attempt(normal);
  } catch (error) {
    // Secondo tentativo ammesso solo per vuoto o transitorio, e solo col tempo residuo.
    const empty = isEmptyResponseError(error);
    if (!empty && !isRetriableError(error)) throw error;
    if (deadline - Date.now() <= 0) throw error;
    console.warn(empty
      ? `[CountryInitialProfile] ${section}: risposta vuota, retry con maxTokens=${repair}`
      : `[CountryInitialProfile] ${section}: errore transitorio, secondo tentativo (maxTokens=${repair})`);
    return await attempt(repair);
  }
}

function economyPrompt(input: CountryProfileInput, fallback: CountryInitialProfile, gdp: number | null, debt: number | null): string {
  return JSON.stringify({
    section: 'economy',
    country: input.countryName ?? input.polityId,
    startDate: input.startDate,
    historicalBaseline: input.historicalBaseline || '',
    anchors: { nominalGdpUsdBillions: gdp, debtRatioPct: debt },
    missing: { nominalGdpUsdBillions: gdp === null, debtRatioPct: debt === null },
    fallback: { ...fallback.economy, debtRatioPct: debt },
    schema: { economy: { nominalGdpUsdBillions: 'number miliardi USD', debtRatioPct: 'number 0-250', treasuryUsdBillions: 'number >=0', taxRatePct: 'number 0-60', monthlyRevenue: 'number >=0', monthlyExpenses: 'number >=0' } },
  });
}

function nationalStatePrompt(input: CountryProfileInput, fallback: CountryInitialProfile, referencePopulation: number | null, mapPopulation: number): string {
  const known = referencePopulation !== null;
  return JSON.stringify({
    section: 'national-state',
    country: input.countryName ?? input.polityId,
    startDate: input.startDate,
    historicalBaseline: input.historicalBaseline || '',
    anchors: { population: referencePopulation, mapPopulation },
    missing: { population: !known },
    // Senza reference NON suggerire il valore della mappa come popolazione
    // storica: resta solo in `anchors.mapPopulation` come ordine di grandezza.
    fallback: { population: known ? referencePopulation : null, society: fallback.society, infrastructure: fallback.infrastructure },
    populationRule: known
      ? 'Popolazione di riferimento storica autorevole: riportala invariata.'
      : 'Popolazione storica sconosciuta. mapPopulation descrive la mappa corrente ed è solo un ordine di grandezza: NON copiarlo automaticamente come popolazione storica alla startDate. Produci una stima storica propria, coerente con paese e data.',
    infrastructureCaps: infrastructureCaps(input),
    schema: { population: 'number', society: { stability: '0-100', socialTension: '0-100' }, infrastructure: { factories: 'intero', ports: 'intero', universities: 'intero' } },
  });
}

function militaryResourcesPrompt(input: CountryProfileInput, fallback: CountryInitialProfile, population: number): string {
  return JSON.stringify({
    section: 'military-resources',
    country: input.countryName ?? input.polityId,
    startDate: input.startDate,
    historicalBaseline: input.historicalBaseline || '',
    anchors: { population, mapBaseline: fallback.mapBaseline, authoredFormations: authored(input, 'army') + authored(input, 'battalion') },
    fallback: { military: fallback.military, ...(fallback.resources ? { resources: fallback.resources } : {}) },
    limits: { landlocked: isLandlockedPolity(input.polityId), epoch: epochForDate(input.startDate), maxActiveShare: 0.05 },
    availableTechnologies: availableTechnologiesAt(input.startDate).map(({ id, name }) => `${id} (${name})`),
    schema: { military: { activePersonnel: 'intero', reservePersonnel: 'intero', formations: 'intero', averageFormationSize: 'number', readinessPct: '0-100', defenceBurdenPct: '0-30', trainingPct: '0-100', qualityPct: '0-100', logisticsPct: '0-100', equipmentProfile: 'id->intero' }, resources: { food: 'number?', clothing: 'number?', weapons: 'number?', fuel: 'number?', research: 'number?', technologies: 'string[]?' } },
  });
}

/** Bootstrap canonico: TRE completion sequenziali (economia → stato nazionale →
 * militare/risorse), ognuna con retry transitorio limitato, poi merge e
 * validazione server-side. Le stime del player falliscono chiuse: nessuna
 * sezione obbligatoria ripiega mai sul profilo deterministico completo. */
export async function generateCountryInitialProfile(input: CountryProfileInput, complete?: CountryProfileCompleter, options: { requireEstimate?: boolean } = {}): Promise<CountryInitialProfile> {
  const fallback = buildCountryInitialProfile(input);
  const requireEstimate = Boolean(options.requireEstimate);
  if (!complete) {
    if (requireEstimate) throw new CountryInitialProfileError('servizio LLM non disponibile');
    return fallback;
  }
  const gdp = referenceGdpUsdBillionsForDate(input.polityId, input.startDate);
  const debt = referenceDebtToGdpPctForDate(input.polityId, input.startDate);
  const referencePopulation = referencePopulationForDate(input.polityId, input.startDate);
  const mapPopulation = input.regions.filter(r => r.owner === input.polityId).reduce((n, r) => n + r.population, 0);
  // Budget globale: nessuna sezione può far restare POST /games appesa per minuti.
  const deadline = Date.now() + BOOTSTRAP_TOTAL_TIMEOUT_MS;
  try {
    // --- CALL 1 — economia / debito / tesoreria ---
    const economySection = parseSectionJson(await completeSection('economy', economyPrompt(input, fallback, gdp, debt), complete, deadline));
    const economy = mergeEconomySection(economySection.economy, fallback.economy, gdp, debt);
    if (requireEstimate) {
      const e = economySection.economy as Partial<CountryInitialProfile['economy']> | undefined;
      if (!e || (gdp === null && (!positive(e.nominalGdpUsdBillions) || e.nominalGdpUsdBillions <= 0 || e.nominalGdpUsdBillions > 1_000_000))
        || (debt === null && (!positive(e.debtRatioPct) || e.debtRatioPct > 250))
        || !positive(e.treasuryUsdBillions) || e.treasuryUsdBillions > Math.max(0.01, economy.nominalGdpUsdBillions * 0.5)
        || !positive(e.taxRatePct) || e.taxRatePct > 60) {
        throw new CountryInitialProfileError('dati economici minimi mancanti o non validi');
      }
    }

    // --- CALL 2 — popolazione / società / infrastrutture ---
    const stateSection = parseSectionJson(await completeSection('national-state', nationalStatePrompt(input, fallback, referencePopulation, mapPopulation), complete, deadline));
    // Senza reference, una stima che copia la mappa moderna non è storica: rifiutata.
    const llmPopulation = referencePopulation !== null ? null : historicalPopulationEstimate(stateSection.population, mapPopulation);
    const population = referencePopulation ?? llmPopulation ?? fallback.population;
    const society = validSocietySection(stateSection.society) ? stateSection.society : fallback.society;
    const caps = infrastructureCaps(input);
    const infra = stateSection.infrastructure && typeof stateSection.infrastructure === 'object' ? stateSection.infrastructure as Record<string, unknown> : {};
    const pickInfra = (key: 'factories' | 'ports' | 'universities'): number => {
      const value = infra[key];
      return positive(value) && Number.isInteger(value) && (value as number) >= authored(input, key) && (value as number) <= caps[key]
        ? value as number : fallback.infrastructure[key];
    };
    const infrastructure = { factories: pickInfra('factories'), ports: pickInfra('ports'), universities: pickInfra('universities') };

    // --- CALL 3 — militare / risorse ---
    const militarySection = parseSectionJson(await completeSection('military-resources', militaryResourcesPrompt(input, fallback, population), complete, deadline));
    const military = validMilitarySection(militarySection.military, input, population) ? militarySection.military : fallback.military;
    const resources = sanitizeInitialResources(militarySection.resources, input);

    // Fail-closed del player: una sezione obbligatoria invalida non ripiega mai
    // sul profilo deterministico completo.
    const economyValid = validEconomySection(economySection.economy);
    const stateValid = validSocietySection(stateSection.society) && validInfrastructureSection(stateSection.infrastructure, input)
      && (referencePopulation !== null || llmPopulation !== null);
    const militaryValid = validMilitarySection(militarySection.military, input, population);
    if (requireEstimate && !stateValid) throw new CountryInitialProfileError('sezione stato nazionale non valida');
    if (requireEstimate && !militaryValid) throw new CountryInitialProfileError('sezione militare non valida');

    const failed: string[] = [];
    if (!economyValid) failed.push('economy');
    if (!stateValid) failed.push('national-state');
    if (!militaryValid) failed.push('military-resources');

    const provenance: CountryInitialProfile['provenance'] = failed.length === 0 || requireEstimate
      ? { source: 'llm-estimate', generatedAt: fallback.provenance.generatedAt,
          confidence: input.historicalBaseline ? 'medium' : 'low',
          notes: [
            'Bootstrap LLM a sezioni sequenziali: economia, stato nazionale, militare/risorse.',
            `economy: ${economyValid ? 'llm-estimate' : 'fallback-deterministico'}`,
            `national-state: ${stateValid ? 'llm-estimate' : 'fallback-deterministico'}`,
            `military-resources: ${militaryValid ? 'llm-estimate' : 'fallback-deterministico'}`,
            'Ancore storiche preservate; inventario di mappa preservato (non riscritto dall’LLM).',
            ...(gdp !== null ? ['PIL di riferimento storico applicato.'] : []),
            ...(debt !== null ? ['Debito/PIL di riferimento storico applicato.'] : []),
            ...(debt === null ? ['Nessuna serie storica del debito pubblico per paese/data: si conserva la stima LLM, non un default a zero.'] : []),
            ...(referencePopulation === null ? ['Popolazione senza serie storica: stima LLM validata, non il valore moderno di mappa spacciato per storico.'] : []),
            ...(resources ? ['Scorte/materiali e tecnologie iniziali stimati, validati e clampati alla capacità di stoccaggio.'] : []),
          ] }
      : { ...fallback.provenance, notes: [...fallback.provenance.notes, `Sezioni LLM non utilizzate, ripiegate sul fallback: ${failed.join(', ')}.`] };

    const profile: CountryInitialProfile = {
      version: 1, polityId: input.polityId, startDate: input.startDate, population,
      economy,
      military,
      society,
      infrastructure,
      ...(resources ? { resources } : {}),
      mapBaseline: fallback.mapBaseline,
      provenance,
    };
    const accepted = ['economy', 'national-state', 'military-resources'].filter(s => !failed.includes(s));
    if (resources) accepted.push('resources');
    console.info(`[CountryInitialProfile] ${input.polityId}@${input.startDate} source=${provenance.source} llm=[${accepted.join(',')}] fallback=[${failed.join(',')}]`);
    const validated = validateCountryInitialProfile(profile, input);
    if (!validated && requireEstimate) throw new CountryInitialProfileError('profilo non conforme ai vincoli di validazione');
    return validated ?? fallback;
  } catch (error) {
    if (requireEstimate) {
      throw error instanceof CountryInitialProfileError ? error : new CountryInitialProfileError(safeFailureReason(error));
    }
    console.info(`[CountryInitialProfile] ${input.polityId}@${input.startDate} source=deterministic llm=[] fallback=[economy,national-state,military-resources,resources] failure=${safeFailureReason(error)}`);
    return fallback;
  }
}
