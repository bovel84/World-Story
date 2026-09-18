/**
 * World Story — COUNTRY-CLARITY: Forze armate
 * ==========================================
 * Risponde, con i soli numeri del motore, a: quanti uomini ho (attivi,
 * mobilitati, riserva mobilitabile), con quali equipaggiamenti combattono,
 * quanto sono coperto per categoria, quanto sono pronto a combattere e che
 * cosa produco in casa invece di importare.
 *
 * Non ricalcola nessuna formula del motore: `forces`, `mobilized`, `arsenal
 * qualityIndex`, `combatFactor` sono letti; l'unica cosa derivata è la
 * **copertura** (possesso / dotazione di riferimento) e la **prontezza**
 * (media pesata della copertura modulata da carburante, armamenti e qualità),
 * entrambe con soglie dichiarate e coperte dai test.
 */
import { formatNumber, formatPercent } from '../../utils/format';
import type { NationAccount, NationResources } from './NationDock/types';
import type { ArsenalResponse, ProductionOrder } from '../../services/api';
import { autonomyMonths, finiteOrNull, round1, type DomainDriver, type DomainStatus, type DriverTone } from './domainStatus';

/**
 * Manpower: il motore conta **reparti**, non uomini (`forces` = reparti in
 * servizio, `mobilized` = reparti di riserva richiamati, `capacityBase.forces`
 * = reparti della base nazionale). Qui non si converte nulla in teste: una
 * conversione sarebbe un numero inventato. La riserva *richiamabile* non è
 * modellata dal motore e viene dichiarata assente (`null`).
 */
export interface ManpowerPayload {
  population: number | null;
  /** Reparti in servizio permanente (motore: `account.forces`). */
  active: number;
  /** Reparti di riserva richiamati (motore: `account.mobilized`). */
  mobilized: number;
  /** Reparti sotto le armi oggi: attivi + richiamati. */
  standing: number;
  /** Reparti della base nazionale calcolata dal motore (`capacityBase.forces`). */
  baseline: number | null;
  /** Riserva richiamabile non ancora in armi: non modellata dal motore. */
  reservePool: number | null;
  /** Quota dei soli reparti richiamati sul totale in armi, in %. */
  mobilizedPct: number;
  /** Quota della popolazione in armi, in %: `null` (il motore non la modella). */
  shareOfPopulationPct: number | null;
}

/** Deriva il manpower dai soli numeri del motore, senza conversioni inventate. */
export function manpowerPayload(
  account?: Partial<NationAccount> | null,
  assets?: { capacityBase?: { forces?: number } } | null,
): ManpowerPayload | null {
  const hasArmy = account && (finiteOrNull(account.forces) !== null || finiteOrNull(account.mobilized) !== null);
  const baseline = finiteOrNull(assets?.capacityBase?.forces);
  if (!hasArmy && baseline === null) return null;
  const active = Math.max(0, finiteOrNull(account?.forces) ?? 0);
  const mobilized = Math.max(0, finiteOrNull(account?.mobilized) ?? 0);
  const standing = active + mobilized;
  return {
    population: finiteOrNull(account?.population),
    active,
    mobilized,
    standing,
    baseline,
    reservePool: null,
    mobilizedPct: standing > 0 ? round1(mobilized / standing * 100) : 0,
    shareOfPopulationPct: null,
  };
}

export interface CoverageRow {
  id: string;
  label: string;
  actual: number;
  required: number;
  pct: number;
  tone: DriverTone;
  /** Beni in servizio che contribuiscono alla categoria. */
  items: string[];
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
  manpower: ManpowerPayload | null;
  coverage: CoverageRow[];
  readiness: ReadinessPicture;
  procurement: ProcurementRow[];
  stock: MilitaryStockRow[];
  /** Indici già calcolati dal motore, riportati per trasparenza. */
  qualityIndex: number | null;
  combatFactor: number | null;
  effectiveMilitaryPower: number | null;
  baseMilitaryPower: number | null;
}

export interface MilitaryInput {
  account?: Partial<NationAccount> | null;
  resources?: Partial<NationResources> | null;
  arsenal?: Partial<ArsenalResponse> | null;
  /** Risorse del paese: serve solo la base di reparti calcolata dal motore. */
  assets?: { capacityBase?: { forces?: number } } | null;
}

/**
 * Dotazione di riferimento per reparto (establishment). I due valori ancorati
 * al motore sono quelli della formula di seed dell'arsenale
 * (`MilitaryService.arsenalUnits`: 40 fucili per reparto, 1,5 corazzati per
 * reparto); gli altri completano la stessa dotazione di riferimento e sono
 * dichiarati qui, non nascosti nella UI. `weight` è il peso della categoria
 * nella prontezza: gli uomini prima, poi i mezzi.
 */
const ESTABLISHMENT: Array<{
  id: string;
  label: string;
  perForce: number;
  perMobilized?: number;
  categories?: string[];
  domains?: string[];
  weight: number;
}> = [
  { id: 'individualWeapons', label: 'Armi individuali', perForce: 40, perMobilized: 50, categories: ['Fanteria'], weight: 0.3 },
  { id: 'supportWeapons', label: 'Armi di supporto', perForce: 0.8, categories: ['Difesa aerea'], domains: ['missili'], weight: 0.1 },
  { id: 'armoredMobility', label: 'Mobilità corazzata', perForce: 1.5, categories: ['Corazzati'], weight: 0.2 },
  { id: 'artillery', label: 'Artiglieria', perForce: 0.5, categories: ['Artiglieria'], weight: 0.15 },
  { id: 'airSupport', label: 'Supporto aereo', perForce: 0.2, domains: ['aria', 'droni'], weight: 0.15 },
  { id: 'navalSupport', label: 'Supporto navale', perForce: 0.06, domains: ['mare'], weight: 0.1 },
];

function toneForCoverage(pct: number): DriverTone {
  if (pct >= 85) return 'positive';
  if (pct >= 60) return 'warning';
  return 'critical';
}

/**
 * Copertura per categoria: quantità in servizio sulla dotazione di riferimento.
 * `forces` e `mobilized` sono i due numeri del motore; la riserva mobilitabile
 * non entra nel fabbisogno finché non è richiamata.
 */
export function equipmentCoverage(account?: Partial<NationAccount> | null, arsenal?: Partial<ArsenalResponse> | null): CoverageRow[] {
  const forces = Math.max(0, finiteOrNull(account?.forces) ?? 0);
  const mobilized = Math.max(0, finiteOrNull(account?.mobilized) ?? 0);
  const lines = arsenal?.lines ?? [];
  return ESTABLISHMENT.map(entry => {
    const required = Math.ceil(entry.perForce * forces + (entry.perMobilized ?? 0) * mobilized);
    const matched = lines.filter(line => {
      if (entry.categories && !entry.categories.includes(line.category)) return false;
      if (entry.domains && !entry.domains.includes(line.domain)) return false;
      return true;
    });
    const actual = matched.reduce((total, line) => total + (Number(line.quantity) || 0), 0);
    const pct = required > 0 ? Math.min(100, round1(actual / required * 100)) : (actual > 0 ? 100 : 0);
    return {
      id: entry.id,
      label: entry.label,
      actual,
      required,
      pct,
      tone: toneForCoverage(pct),
      items: matched.map(line => `${line.name} ×${formatNumber(line.quantity)}`),
    };
  });
}

/**
 * Prontezza: media pesata della copertura per categoria, modulata dai vincoli
 * che il motore traccia davvero — carburante, scorte di armamenti, qualità
 * media dell'arsenale e riserve richiamate ma non ancora operative.
 * Ogni fattore compare nei `drivers`, così il numero non è mai opaco.
 */
export function readinessPicture(input: {
  account?: Partial<NationAccount> | null;
  resources?: Partial<NationResources> | null;
  arsenal?: Partial<ArsenalResponse> | null;
  coverage: CoverageRow[];
}): ReadinessPicture {
  const { account, resources, arsenal, coverage } = input;
  const forces = Math.max(0, finiteOrNull(account?.forces) ?? 0);
  const mobilized = Math.max(0, finiteOrNull(account?.mobilized) ?? 0);
  const qualityIndex = finiteOrNull(arsenal?.qualityIndex) ?? 0;

  const weightTotal = ESTABLISHMENT.reduce((total, entry) => total + entry.weight, 0);
  const weighted = coverage.reduce((total, row) => {
    const entry = ESTABLISHMENT.find(item => item.id === row.id);
    return total + row.pct * (entry?.weight ?? 0);
  }, 0) / (weightTotal || 1);

  const fuelStock = finiteOrNull(resources?.fuel);
  const fuelNeed = finiteOrNull(resources?.needs?.fuel);
  const weaponsStock = finiteOrNull(resources?.weapons);
  const weaponsNeed = finiteOrNull(resources?.needs?.weapons);
  // Tre mesi di fabbisogno = disponibilità piena: sotto, la prontezza scende in
  // proporzione. È una soglia dichiarata, non una formula economica nuova.
  const OPERATION_MONTHS = 3;
  const fuelFactor = fuelStock === null || fuelNeed === null || fuelNeed <= 0
    ? 1
    : Math.max(0, Math.min(1, fuelStock / (fuelNeed * OPERATION_MONTHS)));
  const weaponsFactor = weaponsStock === null || weaponsNeed === null || weaponsNeed <= 0
    ? 1
    : Math.max(0, Math.min(1, weaponsStock / (weaponsNeed * OPERATION_MONTHS)));
  const qualityFactor = 0.75 + Math.min(0.25, qualityIndex / 400);
  const soldiers = forces + mobilized;
  const mobilizationFactor = soldiers > 0 ? 1 - Math.min(0.15, mobilized / soldiers * 0.3) : 1;

  const raw = weighted * fuelFactor * weaponsFactor * qualityFactor * mobilizationFactor;
  const readinessPct = Math.max(0, Math.min(100, Math.round(raw)));

  const drivers: DomainDriver[] = [];
  const weakest = [...coverage].sort((a, b) => a.pct - b.pct)[0];
  for (const row of coverage.filter(item => item.pct < 85)) {
    drivers.push({
      tone: toneForCoverage(row.pct),
      label: `Copertura ${row.label.toLowerCase()} ${formatPercent(row.pct, 0)}`,
      detail: `${formatNumber(row.actual)} in servizio su ${formatNumber(row.required)} della dotazione di riferimento.`,
    });
  }
  const fuelMonths = fuelStock !== null && fuelNeed !== null && fuelNeed > 0 ? round1(fuelStock / fuelNeed) : null;
  if (fuelMonths !== null && fuelMonths < OPERATION_MONTHS) {
    drivers.push({
      tone: fuelMonths < 1 ? 'critical' : 'warning',
      label: `Carburante: ${autonomyMonths(fuelStock, -(fuelNeed ?? 0)).text} di operazioni`,
      detail: `Servono ${formatNumber(fuelNeed ?? 0)}/mese: sotto i ${OPERATION_MONTHS} mesi la prontezza cala.`,
    });
  } else if (fuelMonths !== null) {
    drivers.push({ tone: 'positive', label: `Carburante: ${autonomyMonths(fuelStock, -(fuelNeed ?? 0)).text}`, detail: `Copertura piena delle operazioni (${formatNumber(fuelStock ?? 0)} in magazzino).` });
  }
  if (weaponsFactor < 1 && weaponsStock !== null) {
    drivers.push({
      tone: weaponsFactor < 0.5 ? 'critical' : 'warning',
      label: `Scorte armamenti ${formatPercent(weaponsFactor * 100, 0)} del fabbisogno`,
      detail: `${formatNumber(weaponsStock)} disponibili: il rimpiazzo dei pezzi consumati è limitato.`,
    });
  }
  if (qualityIndex > 0) {
    drivers.push({
      tone: qualityIndex >= 60 ? 'positive' : qualityIndex >= 30 ? 'warning' : 'critical',
      label: `Qualità media armi ${formatNumber(qualityIndex)}/100`,
      detail: 'Pesa sui combattimenti insieme alla copertura.',
    });
  }
  if (mobilized > 0) {
    drivers.push({
      tone: 'warning',
      label: `${formatNumber(mobilized)} riservisti richiamati`,
      detail: 'Le riserve consumano equipaggiamento per diventare operative: la prontezza ne risente finché non sono in linea.',
    });
  }
  if (weakest && weakest.pct >= 85 && drivers.length <= 1) {
    drivers.push({ tone: 'positive', label: 'Nessun vincolo materiale rilevante', detail: 'Copertura, carburante e scorte sono sopra le soglie operative.' });
  }

  let status: DomainStatus['status'] = 'stable';
  if (readinessPct >= 80) status = 'healthy';
  else if (readinessPct >= 65) status = 'stable';
  else if (readinessPct >= 50) status = 'pressure';
  else if (readinessPct >= 35) status = 'fragile';
  else status = 'critical';

  return { readinessPct, status, drivers };
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

export function militaryOperatingPicture(input: MilitaryInput): MilitaryPicture {
  const { account, resources, arsenal } = input;
  const manpower = manpowerPayload(account, input.assets);
  const coverage = equipmentCoverage(account, arsenal);
  const readiness = readinessPicture({ account, resources, arsenal, coverage });
  const procurement = procurementRows(arsenal);
  const qualityIndex = finiteOrNull(arsenal?.qualityIndex);
  const combatFactor = finiteOrNull(arsenal?.combatFactor);

  const stock: MilitaryStockRow[] = [
    {
      id: 'weapons',
      label: 'Scorte armamenti',
      stock: finiteOrNull(resources?.weapons),
      need: finiteOrNull(resources?.needs?.weapons),
      ...((): { months: number | null; text: string; tone: DriverTone } => {
        const stockValue = finiteOrNull(resources?.weapons);
        const need = finiteOrNull(resources?.needs?.weapons);
        const months = stockValue !== null && need !== null && need > 0 ? round1(stockValue / need) : null;
        return {
          months,
          text: months === null ? 'dato non disponibile' : autonomyMonths(stockValue, -(need ?? 0)).text,
          tone: months === null ? 'neutral' : months >= 3 ? 'positive' : months >= 1 ? 'warning' : 'critical',
        };
      })(),
    },
    {
      id: 'fuel',
      label: 'Carburante',
      stock: finiteOrNull(resources?.fuel),
      need: finiteOrNull(resources?.needs?.fuel),
      ...((): { months: number | null; text: string; tone: DriverTone } => {
        const stockValue = finiteOrNull(resources?.fuel);
        const need = finiteOrNull(resources?.needs?.fuel);
        const months = stockValue !== null && need !== null && need > 0 ? round1(stockValue / need) : null;
        return {
          months,
          text: months === null ? 'dato non disponibile' : autonomyMonths(stockValue, -(need ?? 0)).text,
          tone: months === null ? 'neutral' : months >= 3 ? 'positive' : months >= 1 ? 'warning' : 'critical',
        };
      })(),
    },
  ];

  const drivers: DomainDriver[] = [];
  if (manpower) {
    drivers.push({
      tone: manpower.standing > 0 ? 'neutral' : 'warning',
      label: `${formatNumber(manpower.standing)} ${manpower.standing === 1 ? 'reparto' : 'reparti'} sotto le armi`,
      detail: `${formatNumber(manpower.active)} in servizio permanente, ${formatNumber(manpower.mobilized)} richiamati${manpower.baseline !== null ? `, su una base di ${formatNumber(manpower.baseline)} reparti` : ''}. Il motore conta reparti, non uomini.`,
    });
  } else {
    drivers.push({ tone: 'neutral', label: 'Forze non pubblicate dal motore', detail: 'Questo scenario non espone reparti in armi.' });
  }
  drivers.push({
    tone: readiness.status === 'healthy' ? 'positive' : readiness.status === 'stable' ? 'neutral' : readiness.status === 'pressure' ? 'warning' : 'critical',
    label: `Prontezza operativa ${readiness.readinessPct}%`,
    detail: readiness.drivers.filter(driver => driver.tone !== 'positive')[0]?.label ?? 'Nessun vincolo materiale rilevante.',
  });
  const domesticCount = procurement.filter(row => row.domestic).length;
  drivers.push({
    tone: domesticCount > 0 ? 'positive' : 'warning',
    label: `${domesticCount} sistemi producibili in casa`,
    detail: `su ${procurement.length} del catalogo dello scenario.`,
  });
  drivers.push(...readiness.drivers.filter(driver => driver.tone === 'critical' || driver.tone === 'warning').slice(0, 2));

  let status: MilitaryPicture['status'] = readiness.status;
  if (manpower && manpower.standing === 0 && coverage.every(row => row.actual === 0)) status = 'critical';
  if (stock.some(row => row.tone === 'critical') && status === 'healthy') status = 'pressure';

  const headline = manpower
    ? `${formatNumber(manpower.standing)} ${manpower.standing === 1 ? 'reparto' : 'reparti'} sotto le armi · prontezza ${readiness.readinessPct}% · ${domesticCount} sistemi prodotti in casa.`
    : `Prontezza ${readiness.readinessPct}% · ${domesticCount} sistemi prodotti in casa.`;

  return {
    status,
    headline,
    drivers,
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
