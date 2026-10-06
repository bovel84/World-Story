import { WorldStateEngine, type WorldStateRegion } from './WorldStateEngine';
import { coastalFromGeojson } from './NationCapacity';
import { militaryManpower, arsenalSeedUnits, epochForDate, individualWeaponShareFor } from './MilitaryDoctrine';
import { equipmentById, EQUIPMENT_CREW } from './MilitaryIndustry';
import { referenceGdpUsdBillionsForDate, referenceDebtToGdpPctForDate, referencePopulationForDate } from '../../utils/country-facts';

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
export type CountryProfileCompleter = (system: string, prompt: string, signal: AbortSignal) => Promise<string>;
const positive = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value) && value >= 0;
const pct = (value: unknown) => positive(value) && value <= 100;
const round = (n: number) => Math.round(n * 1e6) / 1e6;
const coast = (input: CountryProfileInput) => input.regions.some(r => r.owner === input.polityId && (r.coastal ?? coastalFromGeojson(r.id, r.geojson)));
const authored = (input: CountryProfileInput, type: string) => input.regions.filter(r => r.owner === input.polityId).reduce((sum, r) => sum + (r.objects || []).filter(o => o.type === type).reduce((n, o) => n + Math.max(1, o.level || 1), 0), 0);

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
  const debt = referenceDebtToGdpPctForDate(input.polityId, input.startDate) ?? 0;
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
    infrastructure: { factories: account.factories, ports: account.ports, universities: account.universities },
    mapBaseline: { gdp: account.gdp, militaryPower: account.militaryPower, forces: authored(input, 'army') + authored(input, 'battalion') + authored(input, 'fleet') + authored(input, 'missile'), factories: authored(input, 'factory'), ports: authored(input, 'port'), universities: authored(input, 'university'), mobilized: account.mobilized, stability: account.stability, socialTension: account.socialTension },
    provenance: { source: known || referenceGdpUsdBillionsForDate(input.polityId, input.startDate) !== null ? 'historical+map' : 'deterministic', generatedAt: new Date().toISOString(), confidence: known ? 'medium' : 'low', notes: ['Map inventory is authoritative; initial rates/coverage are estimates, not precise historical inventories.', ...(debt === 0 ? ['No date-correct debt observation: deterministic zero-debt fallback, not evidence of absence.'] : [])] },
  };
}

/** Strict all-or-fallback validation, before any persistence or stock initialization. */
export function validateCountryInitialProfile(raw: unknown, input: CountryProfileInput): CountryInitialProfile | null {
  if (!raw || typeof raw !== 'object') return null;
  const p = raw as CountryInitialProfile;
  if (p.version !== 1 || p.polityId !== input.polityId || p.startDate !== input.startDate || !positive(p.population) || p.population !== (referencePopulationForDate(input.polityId, input.startDate) ?? input.regions.filter(r => r.owner === input.polityId).reduce((n, r) => n + r.population, 0))) return null;
  const { economy: e, military: m, society: s, infrastructure: i } = p;
  const own = input.regions.filter(r => r.owner === input.polityId);
  if (!e || !m || !s || !i || !p.provenance || !p.mapBaseline
    || !['gdp', 'militaryPower', 'forces', 'factories', 'ports', 'universities', 'mobilized', 'stability', 'socialTension'].every(key => positive(p.mapBaseline[key as keyof typeof p.mapBaseline]))) return null;
  if (![e.nominalGdpUsdBillions, e.debtRatioPct, e.treasuryUsdBillions, e.taxRatePct, e.monthlyRevenue, e.monthlyExpenses].every(positive) || e.nominalGdpUsdBillions <= 0 || e.nominalGdpUsdBillions > 1_000_000 || e.debtRatioPct > 250 || e.treasuryUsdBillions > Math.max(0.01, e.nominalGdpUsdBillions * 0.5) || e.taxRatePct > 60) return null;
  if (Math.abs(e.monthlyRevenue - e.nominalGdpUsdBillions * e.taxRatePct / 1200) > Math.max(0.00001, e.monthlyRevenue * 0.02) || e.monthlyExpenses * 12 > e.nominalGdpUsdBillions * 0.8) return null;
  if (![m.activePersonnel, m.reservePersonnel, m.formations, m.averageFormationSize].every(positive) || ![m.activePersonnel, m.reservePersonnel, m.formations].every(Number.isInteger)) return null;
  if (m.activePersonnel > p.population * 0.05 || m.activePersonnel + m.reservePersonnel > p.population * 0.2 || m.formations > Math.max(1000, authored(input, 'army') + authored(input, 'battalion')) || (m.activePersonnel > 0 && (m.formations < 1 || m.activePersonnel / m.formations < 1 || m.activePersonnel / m.formations > 50_000))) return null;
  if (m.activePersonnel === 0 && m.formations > authored(input, 'army') + authored(input, 'battalion')) return null;
  if (Math.abs(m.activePersonnel - m.formations * m.averageFormationSize) > 1 || ![m.readinessPct, m.defenceBurdenPct, m.trainingPct, m.qualityPct, m.logisticsPct, s.stability, s.socialTension].every(pct) || m.defenceBurdenPct > 30) return null;
  if (!(['factories', 'ports', 'universities'] as const).every((key, index) => {
    const authoredCount = authored(input, ['factory', 'port', 'university'][index]);
    return positive(i[key]) && Number.isInteger(i[key]) && i[key] >= authoredCount && i[key] <= Math.max(1000, authoredCount);
  }) || (!coast(input) && i.ports > authored(input, 'port'))) return null;
  if (p.mapBaseline.gdp !== own.reduce((sum, r) => sum + r.gdp, 0)
    || p.mapBaseline.militaryPower !== own.reduce((sum, r) => sum + r.militaryPower, 0)) return null;
  // GDP estimates have a conservative demographic envelope, never arbitrary trillions for microstates.
  const referenceGdp = referenceGdpUsdBillionsForDate(input.polityId, input.startDate);
  if (referenceGdp === null && p.provenance.source === 'llm-estimate' && e.nominalGdpUsdBillions * 1e9 / Math.max(p.population, 1) > 250_000) return null;
  if (!m.equipmentProfile || typeof m.equipmentProfile !== 'object' || Array.isArray(m.equipmentProfile)) return null;
  // Conservative catalog admission years; unknown entries fail closed.
  const admissionYear: Record<string, number> = { fucili: 0, apc: 1940, carri_3: 1975, carri_4: 2015,
    artiglieria: 1940, mlrs: 1940, sam_corto: 1960, sam_lungo: 1980, caccia_3: 1960, caccia_4: 1975,
    caccia_5: 2005, bombardieri: 1950, trasporto: 1940, elicotteri: 1965, aew: 1970,
    pattugliatori: 1940, corvette: 1960, fregate: 1970, cacciatorpediniere: 1980, sottomarini: 1960,
    portaerei: 1960, missili_corto: 1960, missili_medio: 1970, cruise: 1980, antinave: 1960,
    ipersonici: 2020, droni_ricognizione: 1995, droni_attacco: 2005, droni_kamikaze: 2010,
    droni_navali: 2020, sciame: 2025 };
  let crew = 0;
  for (const [id, quantity] of Object.entries(m.equipmentProfile)) {
    const spec = equipmentById(id);
    if (!spec || admissionYear[id] === undefined || Number(input.startDate.slice(0, 4)) < admissionYear[id]
      || !positive(quantity) || !Number.isInteger(quantity) || quantity > Math.max(100, m.activePersonnel * 2)
      || ((spec.domain === 'mare' || id === 'droni_navali') && quantity > 0 && !coast(input))) return null;
    if (spec.domain === 'aria' && quantity > Math.max(20, m.activePersonnel / 100)) return null;
    if (id !== 'fucili' && spec.domain === 'terra' && quantity > Math.max(10, m.activePersonnel / 2)) return null;
    crew += (EQUIPMENT_CREW[id] || 0) * quantity;
  }
  if (crew > m.activePersonnel) return null;
  if (!['deterministic', 'historical+map', 'llm-estimate'].includes(p.provenance.source) || !['low', 'medium', 'high'].includes(p.provenance.confidence) || !Number.isFinite(Date.parse(p.provenance.generatedAt)) || !Array.isArray(p.provenance.notes) || !p.provenance.notes.every(n => typeof n === 'string' && n.length <= 1000)) return null;
  return p;
}

/** Prompt breve e esplicito del bootstrap: ricostruzione nazionale specifica per paese e data. */
export const COUNTRY_BOOTSTRAP_SYSTEM = [
  'Bootstrap del Dossier Nazionale iniziale di una partita storica.',
  'Ricostruisci la situazione nazionale ALLA DATA DI INIZIO indicata: NON la situazione moderna e NON il futuro.',
  'Priorità: dati storici strutturati > preset/mappa > historicalBaseline > stima prudente > fallback deterministico (solo riferimento debole).',
  'Compila in modo specifico per paese e data: economia, forze armate (activePersonnel, reservePersonnel, formations, averageFormationSize, readinessPct, defenceBurdenPct, trainingPct, qualityPct, logisticsPct, equipmentProfile) e infrastrutture (factories, ports, universities).',
  'Vincoli inviolabili: nessuna tecnologia successiva alla data di inizio; nessun porto o marina per un paese senza costa; nessun valore oltre limiti demografici plausibili; nessuna quantità militare sproporzionata.',
  'Non modificare identità, polity, startDate né i dati espliciti del preset/mappa. Gli oggetti di mappa sono un MINIMO autoritativo, non necessariamente il totale nazionale: puoi stimare totali nazionali maggiori se coerenti con paese, data e geografia.',
  'Non inventare precisione falsa: se un valore è incerto usa una stima prudente. Restituisci SOLO JSON conforme allo schema del fallback fornito: nessun testo, nessuna spiegazione narrativa.',
].join('\n');

/** Optional one-call completion; deadline and invalid output never block creation.
 * Reliable structured/map anchors win; approximate fallback values remain estimable. */
export async function generateCountryInitialProfile(input: CountryProfileInput, complete?: CountryProfileCompleter): Promise<CountryInitialProfile> {
  const fallback = buildCountryInitialProfile(input);
  if (!complete) return fallback;
  const gdp = referenceGdpUsdBillionsForDate(input.polityId, input.startDate);
  const debt = referenceDebtToGdpPctForDate(input.polityId, input.startDate);
  const anchors = { population: fallback.population, nominalGdpUsdBillions: gdp, debtRatioPct: debt, mapBaseline: fallback.mapBaseline };
  const controller = new AbortController();
  let timeout: ReturnType<typeof setTimeout> | undefined;
  try {
    const response = await Promise.race([
      complete(COUNTRY_BOOTSTRAP_SYSTEM, JSON.stringify({ country: input.countryName ?? input.polityId, startDate: input.startDate, historicalBaseline: input.historicalBaseline || '', authoritativeMap: input.regions.filter(r => r.owner === input.polityId), anchors, fallback }), controller.signal),
      new Promise<never>((_, reject) => { timeout = setTimeout(() => { controller.abort(); reject(new Error('Profile timeout')); }, 10_000); }),
    ]);
    const raw = JSON.parse(response.replace(/^\s*```(?:json)?\s*/i, '').replace(/\s*```\s*$/, '')) as CountryInitialProfile;
    // Never allow the LLM to rewrite identity, demographic/map authority or inventory.
    raw.version = 1; raw.polityId = input.polityId; raw.startDate = input.startDate; raw.population = fallback.population;
    raw.mapBaseline = fallback.mapBaseline;
    // Map infrastructure is a MINIMUM, not the national total: keep the validated
    // LLM estimate per key, and only fill missing/invalid keys from the fallback.
    const infra = raw.infrastructure && typeof raw.infrastructure === 'object' ? raw.infrastructure as Record<string, unknown> : {};
    raw.infrastructure = {
      factories: positive(infra.factories) && Number.isInteger(infra.factories) ? infra.factories as number : fallback.infrastructure.factories,
      ports: positive(infra.ports) && Number.isInteger(infra.ports) ? infra.ports as number : fallback.infrastructure.ports,
      universities: positive(infra.universities) && Number.isInteger(infra.universities) ? infra.universities as number : fallback.infrastructure.universities,
    };
    if (!raw.economy || !raw.military) return fallback;
    raw.provenance = { source: 'llm-estimate', generatedAt: fallback.provenance.generatedAt,
      confidence: input.historicalBaseline ? 'medium' : 'low',
      notes: [
        'Bootstrap LLM: sezioni stimate = economia, forze armate, infrastrutture (specifiche per paese e data).',
        'Ancore autoritative non riscritte: mapBaseline, popolazione, identità, startDate e dati espliciti del preset; l’infrastruttura stimata non scende sotto gli oggetti di mappa.',
        ...(gdp !== null ? ['PIL di riferimento storico applicato.'] : []),
        ...(debt !== null ? ['Debito/PIL di riferimento storico applicato.'] : []),
      ] };
    // Reject impossible claims before authoritative anchoring can mask them.
    if (!validateCountryInitialProfile(raw, input)) return fallback;
    if (gdp !== null) {
      const oldGdp = raw.economy.nominalGdpUsdBillions;
      if (!positive(oldGdp) || oldGdp === 0) return fallback;
      raw.economy.monthlyRevenue *= gdp / oldGdp; raw.economy.monthlyExpenses *= gdp / oldGdp;
      raw.economy.nominalGdpUsdBillions = gdp;
    }
    if (debt !== null) raw.economy.debtRatioPct = debt;
    return validateCountryInitialProfile(raw, input) ?? fallback;
  } catch { return fallback; }
  finally { if (timeout) clearTimeout(timeout); controller.abort(); }
}
