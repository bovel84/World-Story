/**
 * World Story — COUNTRY-CLARITY ENGINE: Forze armate (read model)
 * ==============================================================
 * Risponde, con i soli numeri del motore, a: quanti **uomini** ho (attivi,
 * riserva addestrata, richiamati), con quali equipaggiamenti combattono,
 * quanto sono coperto per categoria, quanto sono pronto a combattere e che
 * cosa produco in casa invece di importare.
 *
 * **Qui non si calcola più nessuna regola militare.** Epoca, uomini, dotazioni
 * di riferimento, copertura e prontezza arrivano già calcolati da
 * `core/simulation/MilitaryDoctrine.ts` e pubblicati da `/arsenal`: questo
 * modulo li legge, li formatta e li rende leggibili. L'unica aritmetica è
 * aritmetica fra numeri del motore (quote, mesi di autonomia, unità previste a
 * fine lavorazione con la formula di consegna del motore).
 */
import { formatNumber, formatPercent } from '../../utils/format';
import type { NationResources } from './NationDock/types';
import type { ArsenalResponse, ProductionOrder } from '../../services/api';
import { autonomyMonths, finiteOrNull, round1, type DomainDriver, type DomainStatus, type DriverTone } from './domainStatus';

/** Personale in armi: i **reparti** del motore e gli **uomini** che ne derivano. */
export interface ManpowerPayload {
  population: number | null;
  /** Reparti in servizio permanente (motore: `account.forces`). */
  active: number;
  /** Reparti di riserva richiamati (motore: `account.mobilized`). */
  mobilized: number;
  /** Reparti sotto le armi oggi. */
  standing: number;
  /** Uomini in servizio permanente. */
  activePersonnel: number;
  /** Riservisti addestrati, compresi i richiamati. */
  reservePersonnel: number;
  /** Riservisti già richiamati alle armi. */
  mobilizedPersonnel: number;
  /** Riservisti non ancora richiamati: quello che resta da chiamare. */
  availableReserve: number;
  /** Bacino mobilitabile teorico (popolazione in età utile). */
  eligiblePopulation: number;
  /** Uomini per reparto usati dalla dottrina d'epoca. */
  menPerFormation: number;
  /** Quota della popolazione in età utile, in %. */
  eligibleSharePct: number | null;
  /** Quota dei richiamati sulle forze in armi, in %. */
  mobilizedPct: number;
  /** Tetto di richiamo simultaneo deciso dalla dottrina d'epoca. */
  mobilizationCap: number;
  /** Quanti riservisti si possono ancora richiamare dentro il tetto. */
  mobilizationHeadroom: number;
  /** I richiamati dichiarati dal motore superano il tetto d'epoca. */
  overMobilized: boolean;
}

/** Dotazione di riferimento di una categoria per l'epoca dello scenario. */
export interface EstablishmentRow {
  id: string;
  label: string;
  /** Pezzi per reparto: `null` per le categorie a quota di personale. */
  perFormation: number | null;
  /** Pezzi per reparto di riserva richiamato. */
  perMobilized: number | null;
  /** Quota d'epoca degli uomini in armi con arma individuale, in %. */
  personnelSharePct: number | null;
  /** Come si calcola il fabbisogno: per reparto o per quota di personale. */
  demand: 'per_formation' | 'personnel_share';
  weight: number;
  /** `engine_seed` = costante del seed del motore; `doctrine` = dottrina d'epoca. */
  source: 'engine_seed' | 'doctrine' | 'unknown';
  basis: string;
}

export interface CoverageRow {
  id: string;
  label: string;
  /** Pezzi in servizio. */
  actual: number;
  /** Pezzi richiesti dal personale effettivo. */
  required: number;
  /** Pezzi mancanti. */
  missing: number;
  pct: number;
  tone: DriverTone;
  /** Beni in servizio che contribuiscono alla categoria. */
  items: string[];
  /** Perché la categoria esiste in questa epoca (testo del motore). */
  basis: string;
}

export interface ReadinessPicture {
  readinessPct: number;
  status: DomainStatus['status'];
  drivers: DomainDriver[];
}

export interface ProcurementRow {
  id: string;
  name: string;
  domain: string;
  /** In servizio adesso. */
  available: number;
  /** Unità in costruzione negli ordini aperti. */
  inProduction: number;
  /** Ritmo di consegna ricostruito dalle date del motore. */
  productionPerMonth: number | null;
  /** Importazioni: il motore non le traccia separatamente. */
  imported: number | null;
  canBuild: boolean;
  canBuy: boolean;
  buildCostMln: number;
  buyCostMln: number;
  reasons: string[];
  /** `true` se il paese lo produce in casa oggi. */
  domestic: boolean;
}

export interface MilitaryStockRow {
  id: string;
  label: string;
  stock: number | null;
  need: number | null;
  months: number | null;
  text: string;
  tone: DriverTone;
}

export interface MilitaryPicture extends DomainStatus {
  /** Epoca militare dello scenario e sua etichetta. */
  epoch: string | null;
  epochLabel: string | null;
  /** Dotazioni di riferimento pertinenti all'epoca. */
  establishment: EstablishmentRow[];
  manpower: ManpowerPayload | null;
  coverage: CoverageRow[];
  readiness: ReadinessPicture | null;
  procurement: ProcurementRow[];
  stock: MilitaryStockRow[];
  /** Indici già calcolati dal motore, riportati per trasparenza. */
  qualityIndex: number | null;
  combatFactor: number | null;
  effectiveMilitaryPower: number | null;
  baseMilitaryPower: number | null;
}

export interface MilitaryInput {
  resources?: Partial<NationResources> | null;
  arsenal?: Partial<ArsenalResponse> | null;
}

/**
 * Personale in armi, letto dal motore. Nessuna conversione inventata: `forces`
 * e `mobilized` restano reparti, gli uomini sono quelli che il motore deriva
 * con la dottrina dell'epoca (`menPerFormation`).
 */
export function manpowerPayload(arsenal?: Partial<ArsenalResponse> | null): ManpowerPayload | null {
  const source = arsenal?.manpower;
  if (!source || finiteOrNull(source.activePersonnel) === null) return null;
  const activePersonnel = Math.max(0, finiteOrNull(source.activePersonnel) ?? 0);
  const standingFormations = Math.max(0, finiteOrNull(source.formations) ?? 0) + Math.max(0, finiteOrNull(source.mobilizedFormations) ?? 0);
  const mobilizedPersonnel = Math.max(0, finiteOrNull(source.mobilizedPersonnel) ?? 0);
  const population = finiteOrNull(source.population);
  const eligible = finiteOrNull(source.eligiblePopulation);
  return {
    population,
    active: Math.max(0, finiteOrNull(source.formations) ?? 0),
    mobilized: Math.max(0, finiteOrNull(source.mobilizedFormations) ?? 0),
    standing: standingFormations,
    activePersonnel,
    reservePersonnel: Math.max(0, finiteOrNull(source.reservePersonnel) ?? 0),
    mobilizedPersonnel,
    availableReserve: Math.max(0, finiteOrNull(source.availableReserve) ?? 0),
    eligiblePopulation: Math.max(0, eligible ?? 0),
    menPerFormation: Math.max(0, finiteOrNull(source.menPerFormation) ?? 0),
    eligibleSharePct: population !== null && population > 0 && eligible !== null ? round1(eligible / population * 100) : null,
    mobilizedPct: activePersonnel + mobilizedPersonnel > 0 ? round1(mobilizedPersonnel / (activePersonnel + mobilizedPersonnel) * 100) : 0,
    mobilizationCap: Math.max(0, finiteOrNull(source.mobilizationCap) ?? 0),
    mobilizationHeadroom: Math.max(0, finiteOrNull(source.mobilizationHeadroom) ?? 0),
    overMobilized: source.overMobilized === true,
  };
}

/** Toni della copertura: soglie di lettura, non regole militari nuove. */
function toneForCoverage(pct: number): DriverTone {
  if (pct >= 85) return 'positive';
  if (pct >= 60) return 'warning';
  return 'critical';
}

/** Copertura per categoria, così come la calcola il motore. */
export function equipmentCoverage(arsenal?: Partial<ArsenalResponse> | null): CoverageRow[] {
  const establishment = arsenal?.establishment ?? [];
  return (arsenal?.coverage ?? []).map(row => {
    const entry = establishment.find(item => item.category === row.category);
    const pct = round1(Number(row.coveragePct) || 0);
    return {
      id: row.category,
      label: row.label || entry?.label || row.category,
      actual: Number(row.available) || 0,
      required: Number(row.required) || 0,
      missing: Number(row.missing) || 0,
      pct,
      tone: toneForCoverage(pct),
      items: row.items ?? [],
      basis: entry?.basis ?? '',
    };
  });
}

/** Dotazioni di riferimento dell'epoca, con origine e motivazione del motore. */
export function establishmentRows(arsenal?: Partial<ArsenalResponse> | null): EstablishmentRow[] {
  return (arsenal?.establishment ?? []).map(entry => ({
    id: entry.category,
    label: entry.label,
    perFormation: finiteOrNull(entry.perFormation),
    perMobilized: finiteOrNull(entry.perMobilized),
    personnelSharePct: finiteOrNull(entry.personnelSharePct),
    demand: entry.demand === 'personnel_share' ? 'personnel_share' : 'per_formation',
    weight: Number(entry.weight) || 0,
    source: entry.source ?? 'unknown',
    basis: entry.basis ?? '',
  }));
}

/** Prontezza operativa: numero, stato e driver del motore. */
export function readinessPicture(arsenal?: Partial<ArsenalResponse> | null): ReadinessPicture | null {
  const source = arsenal?.readiness;
  if (!source || finiteOrNull(source.readinessPct) === null) return null;
  return {
    readinessPct: Math.max(0, Math.min(100, Math.round(Number(source.readinessPct) || 0))),
    status: (source.status ?? 'stable') as DomainStatus['status'],
    drivers: (source.drivers ?? []).map(driver => ({ tone: driver.tone, label: driver.label, detail: driver.detail })),
  };
}

function daysBetween(from?: string | null, to?: string | null): number | null {
  if (!from || !to) return null;
  const start = Date.parse(`${from.slice(0, 10)}T00:00:00Z`);
  const end = Date.parse(`${to.slice(0, 10)}T00:00:00Z`);
  if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) return null;
  return Math.round((end - start) / 86_400_000);
}

/** Ritmo mensile di un ordine, ricostruito dalle date pubblicate dal motore. */
export function orderRatePerMonth(order: ProductionOrder): number | null {
  const period = daysBetween(order.startedDate, order.expectedDate ?? null);
  if (!period || period <= 0) return null;
  return round1((Number(order.quantity) || 0) / period * 30);
}

/** Unità che il motore consegnerà a lavori finiti, difetti compresi. */
export function projectedDeliveredUnits(order: ProductionOrder): number {
  const quantity = Number(order.quantity) || 0;
  const qualityLoss = Math.max(0, Math.min(100, Number(order.qualityLoss) || 0));
  return Math.max(0, Math.round(quantity * (1 - qualityLoss / 100)));
}

/**
 * Produzione nazionale contro acquisto estero, voce per voce: quello che è in
 * servizio, quello che è in costruzione, quello che il paese può produrre e
 * quello che deve importare. `canBuild`/`canBuy`/`reasons` sono del motore.
 */
export function procurementRows(arsenal?: Partial<ArsenalResponse> | null, orders?: ProductionOrder[] | null): ProcurementRow[] {
  const catalog = arsenal?.catalog ?? [];
  const units = arsenal?.units ?? {};
  const productionOrders = orders ?? arsenal?.production?.orders ?? [];
  const rows = catalog.map(item => {
    const inProduction = productionOrders
      .filter(order => order.equipmentId === item.id && order.status === 'in_progress')
      .reduce((total, order) => total + (Number(order.quantity) || 0), 0);
    const rates = productionOrders
      .filter(order => order.equipmentId === item.id && order.status === 'in_progress')
      .map(orderRatePerMonth)
      .filter((rate): rate is number => rate !== null);
    return {
      id: item.id,
      name: item.name,
      domain: item.domain,
      available: Number(units[item.id] || 0),
      inProduction,
      productionPerMonth: rates.length > 0 ? round1(rates.reduce((total, rate) => total + rate, 0)) : null,
      imported: null,
      canBuild: item.canBuild === true,
      canBuy: item.canBuy === true,
      buildCostMln: item.buildCostMln,
      buyCostMln: item.buyCostMln,
      reasons: item.reasons ?? [],
      domestic: item.canBuild === true || inProduction > 0,
    };
  });
  // Prima ciò che si ha o si sta costruendo, poi ciò che si può produrre, poi
  // il resto: la domanda «cosa produco in casa» non deve richiedere ricerche.
  return rows.sort((a, b) => {
    const score = (row: ProcurementRow) => (row.available > 0 ? 0 : row.inProduction > 0 ? 1 : row.canBuild ? 2 : 3);
    return score(a) - score(b) || b.available - a.available || a.name.localeCompare(b.name);
  });
}

/** Scorta e fabbisogno di un materiale, con mesi di autonomia dichiarati. */
function stockRow(id: string, label: string, stock: number | null, need: number | null): MilitaryStockRow {
  const months = stock !== null && need !== null && need > 0 ? round1(stock / need) : null;
  return {
    id,
    label,
    stock,
    need,
    months,
    text: months === null ? 'dato non disponibile' : autonomyMonths(stock, -(need ?? 0)).text,
    tone: months === null ? 'neutral' : months >= 3 ? 'positive' : months >= 1 ? 'warning' : 'critical',
  };
}

export function militaryOperatingPicture(input: MilitaryInput): MilitaryPicture {
  const { resources, arsenal } = input;
  const manpower = manpowerPayload(arsenal);
  const coverage = equipmentCoverage(arsenal);
  const readiness = readinessPicture(arsenal);
  const establishment = establishmentRows(arsenal);
  const procurement = procurementRows(arsenal);
  const qualityIndex = finiteOrNull(arsenal?.qualityIndex);
  const combatFactor = finiteOrNull(arsenal?.combatFactor);

  const stock: MilitaryStockRow[] = [
    stockRow('weapons', 'Scorte armamenti', finiteOrNull(resources?.weapons), finiteOrNull(resources?.needs?.weapons)),
    stockRow('fuel', 'Carburante', finiteOrNull(resources?.fuel), finiteOrNull(resources?.needs?.fuel)),
  ];

  const drivers: DomainDriver[] = [];
  if (manpower) {
    drivers.push({
      tone: manpower.standing > 0 ? 'neutral' : 'warning',
      label: `${formatNumber(manpower.activePersonnel + manpower.mobilizedPersonnel)} uomini sotto le armi`,
      detail: `${formatNumber(manpower.standing)} ${manpower.standing === 1 ? 'reparto' : 'reparti'}${manpower.menPerFormation > 0 ? ` da ${formatNumber(manpower.menPerFormation)} uomini` : ''} · ${formatNumber(manpower.activePersonnel)} in servizio permanente · ${formatNumber(manpower.availableReserve)} riservisti richiamabili.`,
    });
    if (manpower.mobilizedPersonnel > 0) {
      drivers.push({
        tone: 'warning',
        label: `${formatNumber(manpower.mobilizedPersonnel)} richiamati alle armi`,
        detail: `${formatPercent(manpower.mobilizedPct, 1)} della forza è riserva mobilitata: consuma equipaggiamento per diventare operativa.`,
      });
    }
  } else {
    drivers.push({ tone: 'neutral', label: 'Forze non pubblicate dal motore', detail: 'Questo scenario non espone reparti in armi.' });
  }
  if (readiness) {
    drivers.push({
      tone: readiness.status === 'healthy' ? 'positive' : readiness.status === 'stable' ? 'neutral' : readiness.status === 'pressure' ? 'warning' : 'critical',
      label: `Prontezza operativa ${readiness.readinessPct}%`,
      detail: readiness.drivers.filter(driver => driver.tone !== 'positive')[0]?.label ?? 'Nessun vincolo materiale rilevante.',
    });
    drivers.push(...readiness.drivers.filter(driver => driver.tone === 'critical' || driver.tone === 'warning').slice(0, 2));
  }
  const domesticCount = procurement.filter(row => row.domestic).length;
  drivers.push({
    tone: domesticCount > 0 ? 'positive' : 'warning',
    label: `${domesticCount} sistemi producibili in casa`,
    detail: `su ${procurement.length} del catalogo dello scenario.`,
  });

  let status: MilitaryPicture['status'] = readiness?.status ?? 'stable';
  if (manpower && manpower.standing === 0 && coverage.every(row => row.actual === 0)) status = 'critical';
  if (stock.some(row => row.tone === 'critical') && status === 'healthy') status = 'pressure';

  const headline = manpower && readiness
    ? `${formatNumber(manpower.activePersonnel + manpower.mobilizedPersonnel)} uomini in armi · prontezza ${readiness.readinessPct}% · ${domesticCount} sistemi prodotti in casa.`
    : readiness
      ? `Prontezza ${readiness.readinessPct}% · ${domesticCount} sistemi prodotti in casa.`
      : `Forze armate non pubblicate dal motore · ${domesticCount} sistemi prodotti in casa.`;

  return {
    status,
    headline,
    drivers,
    epoch: arsenal?.epoch ?? null,
    epochLabel: arsenal?.epochLabel ?? null,
    establishment,
    manpower,
    coverage,
    readiness,
    procurement,
    stock,
    qualityIndex,
    combatFactor,
    effectiveMilitaryPower: finiteOrNull(arsenal?.effectiveMilitaryPower),
    baseMilitaryPower: finiteOrNull(arsenal?.baseMilitaryPower),
  };
}
