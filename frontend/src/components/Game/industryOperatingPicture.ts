/**
 * World Story — COUNTRY-CLARITY ENGINE: scheda Industria (read model)
 * ==================================================================
 * «Quante linee ho, chi le occupa, quanto ne sto usando, che cosa mi blocca».
 *
 * La capacità industriale **non è più una convenzione della UI**: totale,
 * occupazione, saturazione, quota difesa e fattore di rallentamento arrivano
 * già calcolati dal motore (`core/simulation/IndustrialCapacity.ts`, pubblicato
 * in `/arsenal`). Qui si fa solo il lavoro del read model: unire le lavorazioni
 * che il motore elenca alle loro date e ai loro vincoli locali (avanzamento,
 * consegna prevista, nota di rischio) e tradurre tutto in righe leggibili.
 *
 * Se il motore non pubblica la capacità, il Dossier **lo dice**: non esiste un
 * secondo calcolo nel browser che la sostituisca.
 */
import { formatNumber, formatPercent } from '../../utils/format';
import type { NationAccount, NationResources } from './NationDock/types';
import type { ArsenalResponse, IndustrialAllocationPayload, ProductionOrder } from '../../services/api';
import type { CompletedProcess, NationalProcess } from './nationDossier';
import { classifyProject } from './projectCategory';
// Il ritmo di consegna è una proprietà dell'ordine militare: la formula vive
// una volta sola (nel modulo delle forze armate) e qui si riusa.
import { orderRatePerMonth, projectedDeliveredUnits } from './militaryOperatingPicture';
import { finiteOrNull, round1, type DomainDriver, type DomainStatus, type DriverTone } from './domainStatus';

export type IndustryAssignmentKind = 'produzione' | 'progetto' | 'manutenzione';

export interface IndustryAssignment {
  id: string;
  label: string;
  kind: IndustryAssignmentKind;
  /** Settore leggibile della lavorazione, dichiarato dal motore. */
  sector: string;
  detail: string;
  /** Linee di lavorazione che la lavorazione occupa (dal motore). */
  capacityDemand: number;
  progressPct: number | null;
  expectedDate: string | null;
  /** Vincolo che sta rallentando la lavorazione, se il motore lo dichiara. */
  blocker: string | null;
}

export interface IndustryProduction {
  id: string;
  label: string;
  quantity: number;
  progressPct: number;
  /** Ritmo ricostruito dalle date del motore (quantità / durata dichiarata). */
  ratePerMonth: number | null;
  /**
   * Unità **già consegnate**: il motore consegna solo a lavori finiti, quindi
   * un ordine in corso ne ha zero. Non si stima dal progresso.
   */
  deliveredUnits: number;
  /** Unità che saranno consegnate a fine lavorazione (formula del motore). */
  projectedUnits: number;
  /** Unità ancora in lavorazione. */
  inProgressUnits: number;
  efficiencyPct: number | null;
  limits: string[];
  expectedDate: string | null;
  status: ProductionOrder['status'];
}

export interface IndustryPicture extends DomainStatus {
  /** `true` se il motore ha pubblicato il quadro della capacità industriale. */
  capacityPublished: boolean;
  /** Stabilimenti censiti dal motore (le linee sono un'altra cosa). */
  establishments: number | null;
  capacityTotal: number;
  capacityUsed: number;
  capacityFree: number;
  usedPct: number;
  /** Domanda complessiva delle lavorazioni: se supera il totale, è saturazione. */
  demand: number;
  satisfactionPct: number;
  overflowFactor: number;
  saturated: boolean;
  defenceSharePct: number;
  /** Da dove nasce il totale delle linee (testo del motore). */
  totalBasis: string;
  /** Linee occupate per tipo di lavorazione. */
  byKind: Record<string, number>;
  assignments: IndustryAssignment[];
  sectors: Array<{ key: string; label: string; count: number; capacityDemand: number }>;
  productions: IndustryProduction[];
  /** Porti e cantieri: capacità navale dichiarata dal motore. */
  ports: number | null;
  universities: number | null;
}

export interface IndustryInput {
  account?: Partial<NationAccount> | null;
  resources?: Partial<NationResources> | null;
  arsenal?: Partial<ArsenalResponse> | null;
  productionOrders?: ProductionOrder[] | null;
  processes?: NationalProcess[] | null;
  completedProcesses?: CompletedProcess[] | null;
  maintenance?: Array<{ facilityId: string; typeName: string; operational: boolean; sufficient: boolean; resourceId: string; shortfall: string }> | null;
}

const KIND_BY_MOTORE: Record<IndustrialAllocationPayload['kind'], IndustryAssignmentKind> = {
  military_production: 'produzione',
  project: 'progetto',
  maintenance: 'manutenzione',
};

/**
 * Efficienza di un ordine: quanta parte degli input che il motore traccia è
 * disponibile adesso. Non è una formula economica nuova: è il rapporto fra
 * scorte di armamenti (consumo reale della linea) e fabbisogno delle unità che
 * restano, con il carburante come secondo vincolo quando il motore lo espone.
 */
function orderEfficiency(order: ProductionOrder, catalogItem: ArsenalResponse['catalog'][number] | undefined, weaponsStock: number | null, fuelStock: number | null, fuelNeed: number | null): { pct: number | null; limits: string[] } {
  const limits: string[] = [];
  const remaining = Math.max(0, Math.round(order.quantity * (1 - Math.min(100, order.progress) / 100)));
  const constraints: number[] = [];

  const weaponsPerUnit = finiteOrNull(catalogItem?.weaponsCost) ?? 0;
  if (weaponsPerUnit > 0 && weaponsStock !== null && remaining > 0) {
    const required = weaponsPerUnit * remaining;
    const coverage = required > 0 ? Math.min(100, round1(weaponsStock / required * 100)) : null;
    if (coverage !== null) {
      constraints.push(coverage);
      if (coverage < 100) limits.push(`armamenti ${Math.round(coverage)}%`);
    }
  }
  if (fuelStock !== null && fuelNeed !== null && fuelNeed > 0) {
    const coverage = Math.min(100, round1(fuelStock / (fuelNeed * 2) * 100));
    constraints.push(coverage);
    if (coverage < 100) limits.push(`carburante ${Math.round(coverage)}%`);
  }
  if (constraints.length === 0) return { pct: null, limits };
  return { pct: Math.round(Math.min(...constraints)), limits };
}

export function industryOperatingPicture(input: IndustryInput): IndustryPicture {
  const capacity = input.arsenal?.industrialCapacity ?? null;
  const capacityPublished = capacity !== null && finiteOrNull(capacity.total) !== null;
  const establishments = finiteOrNull(input.account?.factories) ?? finiteOrNull(input.arsenal?.capacity?.factories);
  const ports = finiteOrNull(input.account?.ports) ?? finiteOrNull(input.arsenal?.capacity?.ports);
  const universities = finiteOrNull(input.account?.universities) ?? finiteOrNull(input.arsenal?.capacity?.universities);
  const allOrders = input.productionOrders ?? input.arsenal?.production?.orders ?? [];
  const orders = allOrders.filter(order => order.status === 'in_progress');
  const processes = input.processes ?? [];
  const maintenance = input.maintenance ?? [];
  const catalog = input.arsenal?.catalog ?? [];
  const weaponsStock = finiteOrNull(input.resources?.weapons) ?? finiteOrNull(input.arsenal?.capacity?.weapons);
  const fuelStock = finiteOrNull(input.resources?.fuel);
  const fuelNeed = finiteOrNull(input.resources?.needs?.fuel);

  // Le lavorazioni sono quelle del motore: qui si aggiunge solo il contesto
  // locale (date, avanzamento, vincolo) cercandole per lo stesso id.
  const assignments: IndustryAssignment[] = (capacity?.allocations ?? []).map(allocation => {
    const kind = KIND_BY_MOTORE[allocation.kind] ?? 'produzione';
    if (kind === 'produzione') {
      const order = orders.find(item => item.id === allocation.id) ?? allOrders.find(item => item.id === allocation.id);
      return {
        id: `prod-${allocation.id}`,
        label: allocation.label,
        kind,
        sector: allocation.sector,
        detail: order
          ? `Avviata ${order.startedDate}${order.expectedDate ? ` · consegna prevista ${order.expectedDate}` : ''}`
          : allocation.basis,
        capacityDemand: allocation.capacityDemand,
        progressPct: order ? round1(Number(order.progress) || 0) : null,
        expectedDate: order?.expectedDate ?? null,
        blocker: order?.note && order.note.trim().length > 0 ? order.note : null,
      };
    }
    if (kind === 'progetto') {
      const process = processes.find(item => item.id === allocation.id);
      const category = process ? classifyProject(process.title, process.summary) : null;
      return {
        id: `proc-${allocation.id}`,
        label: allocation.label,
        kind,
        sector: category?.label ?? allocation.sector,
        detail: process ? (process.summary || `Avviato ${process.started_date}`) : allocation.basis,
        capacityDemand: allocation.capacityDemand,
        progressPct: process ? finiteOrNull(process.progress) : null,
        expectedDate: process?.expected_date ?? null,
        blocker: process?.progress_note && process.progress_note.trim().length > 0 ? process.progress_note : null,
      };
    }
    const obligation = maintenance.find(item => item.facilityId === allocation.id);
    return {
      id: `maint-${allocation.id}`,
      label: allocation.label,
      kind,
      sector: allocation.sector,
      detail: obligation
        ? `Manca ${obligation.shortfall} ${obligation.resourceId} per l'impianto.`
        : allocation.basis,
      capacityDemand: allocation.capacityDemand,
      progressPct: null,
      expectedDate: null,
      blocker: obligation && !obligation.sufficient ? `${obligation.resourceId} insufficiente` : null,
    };
  });

  const capacityTotal = capacityPublished ? Math.max(0, finiteOrNull(capacity!.total) ?? 0) : 0;
  const capacityUsed = capacityPublished ? Math.max(0, finiteOrNull(capacity!.used) ?? 0) : 0;
  const capacityFree = capacityPublished ? Math.max(0, finiteOrNull(capacity!.free) ?? 0) : 0;
  const usedPct = capacityPublished ? round1(finiteOrNull(capacity!.utilizationPct) ?? 0) : 0;
  const demand = capacityPublished ? Math.max(0, finiteOrNull(capacity!.demand) ?? 0) : 0;
  const saturation = {
    demand,
    satisfactionPct: capacityPublished ? round1(finiteOrNull(capacity!.satisfactionPct) ?? 100) : 100,
    overflowFactor: capacityPublished ? (finiteOrNull(capacity!.overflowFactor) ?? 1) : 1,
    saturated: capacityPublished ? capacity!.saturated === true : false,
    defenceSharePct: capacityPublished ? round1(finiteOrNull(capacity!.defenceSharePct) ?? 0) : 0,
    totalBasis: capacity?.totalBasis ?? '',
    byKind: capacity?.byKind ?? {},
  };

  const sectorCounts = new Map<string, { count: number; demand: number }>();
  for (const assignment of assignments) {
    const current = sectorCounts.get(assignment.sector) ?? { count: 0, demand: 0 };
    sectorCounts.set(assignment.sector, { count: current.count + 1, demand: current.demand + assignment.capacityDemand });
  }
  const sectors = [...sectorCounts.entries()]
    .map(([label, value]) => ({ key: label, label, count: value.count, capacityDemand: value.demand }))
    .sort((a, b) => b.capacityDemand - a.capacityDemand || a.label.localeCompare(b.label));

  const productions: IndustryProduction[] = allOrders.map(order => {
    const item = catalog.find(entry => entry.id === order.equipmentId);
    const ratePerMonth = orderRatePerMonth(order);
    const progress = round1(Number(order.progress) || 0);
    const quantity = Number(order.quantity) || 0;
    const projected = projectedDeliveredUnits(order);
    const efficiency = order.status === 'failed'
      ? { pct: 0, limits: ['ordine fallito'] }
      : orderEfficiency(order, item, weaponsStock, fuelStock, fuelNeed);
    return {
      id: order.id,
      label: order.name,
      quantity,
      progressPct: progress,
      ratePerMonth,
      // Consegnate davvero: zero finché la linea lavora (il motore consegna a
      // lavori finiti). A ordine concluso, le unità del motore.
      deliveredUnits: order.status === 'completed' ? projected : 0,
      projectedUnits: projected,
      inProgressUnits: order.status === 'in_progress' ? quantity : 0,
      efficiencyPct: efficiency.pct,
      limits: efficiency.limits,
      expectedDate: order.expectedDate ?? null,
      status: order.status,
    };
  });

  const maintenanceAssignments = assignments.filter(item => item.kind === 'manutenzione');
  const blocked = assignments.filter(item => item.blocker).length;

  const drivers: DomainDriver[] = [];
  if (!capacityPublished) {
    drivers.push({
      tone: 'warning',
      label: 'Capacità industriale non pubblicata dal motore',
      detail: 'Il Dossier non sostituisce il dato mancante con una stima: ordini, progetti e impianti sono elencati senza occupazione delle linee.',
    });
  } else if (capacityTotal === 0) {
    drivers.push({ tone: 'warning', label: 'Nessuno stabilimento registrato', detail: 'Il paese non ha fabbriche nel conto nazionale né sulla mappa.' });
  } else {
    drivers.push({
      tone: saturation.saturated ? 'critical' : usedPct >= 85 ? 'warning' : usedPct >= 60 ? 'positive' : 'neutral',
      label: saturation.saturated
        ? `Industria satura: ${formatNumber(demand)} linee richieste su ${formatNumber(capacityTotal)}`
        : `Capacità industriale usata ${formatPercent(usedPct, 0)}`,
      detail: saturation.saturated
        ? `Ritmo ridotto al ${formatPercent(saturation.overflowFactor * 100, 0)}: le consegne slittano finché la domanda non rientra.`
        : `${capacityFree} ${capacityFree === 1 ? 'linea libera' : 'linee libere'} su ${capacityTotal}${usedPct >= 85 ? ': margine ridotto per nuove lavorazioni.' : '.'}`,
    });
    if (saturation.byKind.military_production > 0) {
      drivers.push({
        tone: 'neutral',
        label: `${formatPercent(saturation.defenceSharePct, 0)} della capacità è militare`,
        detail: `${formatNumber(saturation.byKind.military_production)} linee per la produzione di armamenti.`,
      });
    }
  }
  for (const assignment of assignments.filter(item => item.blocker)) {
    drivers.push({
      tone: 'warning',
      label: `Rallentamento: ${assignment.label}`,
      detail: `${assignment.sector} · ${assignment.blocker}`,
    });
  }
  if (maintenanceAssignments.length > 0) {
    drivers.push({
      tone: maintenanceAssignments.some(item => item.blocker) ? 'warning' : 'neutral',
      label: `${maintenanceAssignments.length} impianti in manutenzione`,
      detail: maintenanceAssignments.some(item => item.blocker)
        ? 'Almeno un impianto ha le scorte di manutenzione insufficienti.'
        : 'La manutenzione occupa linee ma le scorte bastano.',
    });
  }
  if (ports !== null && ports > 0) {
    drivers.push({ tone: 'neutral', label: `${formatNumber(ports)} porti e cantieri`, detail: 'Capacità navale per costruzioni e importazioni.' });
  }
  if (universities !== null && universities > 0) {
    drivers.push({ tone: 'neutral', label: `${formatNumber(universities)} università`, detail: 'Sbloccano tecnologie e producono ricerca.' });
  }
  if (assignments.length === 0 && capacityTotal > 0) {
    drivers.push({ tone: 'neutral', label: 'Nessuna lavorazione attiva', detail: 'Tutte le linee sono libere: la capacità è disponibile.' });
  }

  let status: IndustryPicture['status'] = 'stable';
  if (!capacityPublished) status = 'pressure';
  else if (capacityTotal === 0) status = 'pressure';
  else if (saturation.saturated) status = 'pressure';
  if (blocked >= 2) status = 'fragile';
  if (blocked >= 3 || (saturation.saturated && blocked >= 1)) status = 'critical';
  if (capacityTotal > 0 && !saturation.saturated && usedPct < 60 && blocked === 0) status = 'healthy';

  const headline = !capacityPublished
    ? 'Capacità industriale non pubblicata dal motore.'
    : capacityTotal === 0
      ? 'Nessuna capacità industriale registrata.'
      : saturation.saturated
        ? `${formatNumber(capacityTotal)} linee di lavorazione, ${formatNumber(demand)} richieste: industria satura, consegne rallentate al ${formatPercent(saturation.overflowFactor * 100, 0)}.`
        : `${formatNumber(capacityTotal)} linee di lavorazione, ${formatNumber(capacityUsed)} occupate da lavorazioni attive, ${formatNumber(capacityFree)} libere.`;

  return {
    status,
    headline,
    drivers,
    capacityPublished,
    establishments,
    capacityTotal,
    capacityUsed,
    capacityFree,
    usedPct,
    ...saturation,
    assignments,
    sectors,
    productions,
    ports,
    universities,
  };
}
