/**
 * World Story — COUNTRY-CLARITY: scheda Industria
 * ==============================================
 * «Quante fabbriche ho, che cosa producono, quanto ne sto usando, che cosa mi
 * blocca». Il motore pubblica il **numero** di stabilimenti (aggregato) e gli
 * **ordini** che li occupano; non pubblica un registro per stabilimento.
 *
 * Perciò qui non si inventa nessuna destinazione: si collega ciò che il motore
 * conosce davvero — ordini di produzione militare, progetti in corso e
 * manutenzioni — alla capacità disponibile, con la convenzione dichiarata
 * «una lavorazione attiva occupa una linea produttiva». Se il paese ha 8
 * stabilimenti e 6 lavorazioni attive, la capacità usata è 6 su 8: nessuna
 * simulazione industriale nuova, solo attribuzione di ciò che esiste.
 */
import { formatNumber, formatPercent } from '../../utils/format';
import type { NationAccount, NationResources } from './NationDock/types';
import type { ArsenalCatalogItem, ArsenalResponse, ProductionOrder } from '../../services/api';
import type { CompletedProcess, NationalProcess } from './nationDossier';
import { classifyProject } from './projectCategory';
// Il ritmo di consegna è una proprietà dell'ordine militare: la formula vive
// una volta sola (nel modulo delle forze armate) e qui si riusa.
import { orderRatePerMonth } from './militaryOperatingPicture';
import { finiteOrNull, round1, sharePct, type DomainDriver, type DomainStatus, type DriverTone } from './domainStatus';

export type IndustryAssignmentKind = 'produzione' | 'progetto' | 'manutenzione';

export interface IndustryAssignment {
  id: string;
  label: string;
  kind: IndustryAssignmentKind;
  /** Settore leggibile della lavorazione (Difesa, Infrastrutture, …). */
  sector: string;
  detail: string;
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
  /** Unità già consegnate stimate dal progresso dichiarato dal motore. */
  deliveredUnits: number | null;
  efficiencyPct: number | null;
  limits: string[];
  expectedDate: string | null;
  status: ProductionOrder['status'];
}

export interface IndustryPicture extends DomainStatus {
  capacityTotal: number;
  capacityUsed: number;
  capacityFree: number;
  usedPct: number;
  assignments: IndustryAssignment[];
  sectors: Array<{ key: string; label: string; count: number }>;
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

const SECTOR_BY_KIND: Record<IndustryAssignmentKind, string> = {
  produzione: 'Armamenti',
  progetto: 'Costruzioni',
  manutenzione: 'Manutenzione',
};

/**
 * Efficienza di un ordine: quanta parte degli input che il motore traccia è
 * disponibile adesso. Non è una formula economica nuova: è il rapporto fra
 * scorte di armamenti (consumo reale della linea) e fabbisogno delle unità che
 * restano, con il carburante come secondo vincolo quando il motore lo espone.
 */
function orderEfficiency(order: ProductionOrder, catalogItem: ArsenalCatalogItem | undefined, weaponsStock: number | null, fuelStock: number | null, fuelNeed: number | null): { pct: number | null; limits: string[] } {
  const limits: string[] = [];
  const remaining = Math.max(0, Math.round(order.quantity * (1 - Math.min(100, order.progress) / 100)));
  const constraints: number[] = [];

  const weaponsPerUnit = finiteOrNull(catalogItem?.weaponsCost) ?? 0;
  if (weaponsPerUnit > 0 && weaponsStock !== null && remaining > 0) {
    const required = weaponsPerUnit * remaining;
    const coverage = sharePct(weaponsStock, required);
    if (coverage !== null) {
      constraints.push(coverage);
      if (coverage < 100) limits.push(`armamenti ${Math.round(coverage)}%`);
    }
  }
  if (fuelStock !== null && fuelNeed !== null && fuelNeed > 0) {
    const coverage = sharePct(fuelStock, fuelNeed * 2);
    if (coverage !== null) {
      constraints.push(coverage);
      if (coverage < 100) limits.push(`carburante ${Math.round(coverage)}%`);
    }
  }
  if (constraints.length === 0) return { pct: null, limits };
  return { pct: Math.round(Math.min(...constraints)), limits };
}

export function industryOperatingPicture(input: IndustryInput): IndustryPicture {
  const factories = finiteOrNull(input.account?.factories) ?? finiteOrNull(input.arsenal?.capacity?.factories);
  const ports = finiteOrNull(input.account?.ports) ?? finiteOrNull(input.arsenal?.capacity?.ports);
  const universities = finiteOrNull(input.account?.universities) ?? finiteOrNull(input.arsenal?.capacity?.universities);
  const orders = (input.productionOrders ?? input.arsenal?.production?.orders ?? []).filter(order => order.status === 'in_progress');
  const allOrders = input.productionOrders ?? input.arsenal?.production?.orders ?? [];
  const processes = input.processes ?? [];
  const maintenance = input.maintenance ?? [];
  const catalog = input.arsenal?.catalog ?? [];
  const weaponsStock = finiteOrNull(input.resources?.weapons) ?? finiteOrNull(input.arsenal?.capacity?.weapons);
  const fuelStock = finiteOrNull(input.resources?.fuel);
  const fuelNeed = finiteOrNull(input.resources?.needs?.fuel);

  const assignments: IndustryAssignment[] = [
    ...orders.map(order => {
      const item = catalog.find(entry => entry.id === order.equipmentId);
      const missing = item && item.canBuild === false ? item.reasons[0] ?? null : null;
      return {
        id: `prod-${order.id}`,
        label: `${order.name} ×${formatNumber(order.quantity)}`,
        kind: 'produzione' as const,
        sector: SECTOR_BY_KIND.produzione,
        detail: `Avviata ${order.startedDate}${order.expectedDate ? ` · consegna ${order.expectedDate}` : ''}`,
        progressPct: round1(Number(order.progress) || 0),
        expectedDate: order.expectedDate ?? null,
        blocker: missing,
      };
    }),
    ...processes.map(process => {
      const category = classifyProject(process.title, process.summary);
      return {
        id: `proc-${process.id}`,
        label: process.title,
        kind: 'progetto' as const,
        sector: category.label,
        detail: process.summary || `Avviato ${process.started_date}`,
        progressPct: finiteOrNull(process.progress),
        expectedDate: process.expected_date ?? null,
        blocker: process.progress_note || null,
      };
    }),
    ...maintenance.filter(item => item.operational && !item.sufficient).map(item => ({
      id: `maint-${item.facilityId}`,
      label: item.typeName,
      kind: 'manutenzione' as const,
      sector: SECTOR_BY_KIND.manutenzione,
      detail: `Manca ${item.shortfall} ${item.resourceId} per l'impianto.`,
      progressPct: null,
      expectedDate: null,
      blocker: `${item.resourceId} insufficiente`,
    })),
  ];

  const capacityTotal = Math.max(0, factories ?? 0);
  const capacityUsed = Math.min(capacityTotal, assignments.length);
  const capacityFree = Math.max(0, capacityTotal - capacityUsed);
  const usedPct = capacityTotal > 0 ? round1(capacityUsed / capacityTotal * 100) : 0;

  const sectorCounts = new Map<string, number>();
  for (const assignment of assignments) {
    sectorCounts.set(assignment.sector, (sectorCounts.get(assignment.sector) ?? 0) + 1);
  }
  const sectors = [...sectorCounts.entries()]
    .map(([label, count]) => ({ key: label, label, count }))
    .sort((a, b) => b.count - a.count || a.label.localeCompare(b.label));

  const productions: IndustryProduction[] = allOrders.map(order => {
    const item = catalog.find(entry => entry.id === order.equipmentId);
    const ratePerMonth = orderRatePerMonth(order);
    const progress = round1(Number(order.progress) || 0);
    const efficiency = order.status === 'failed'
      ? { pct: 0, limits: ['ordine fallito'] }
      : orderEfficiency(order, item, weaponsStock, fuelStock, fuelNeed);
    return {
      id: order.id,
      label: order.name,
      quantity: Number(order.quantity) || 0,
      progressPct: progress,
      ratePerMonth,
      deliveredUnits: Math.round((Number(order.quantity) || 0) * progress / 100),
      efficiencyPct: efficiency.pct,
      limits: efficiency.limits,
      expectedDate: order.expectedDate ?? null,
      status: order.status,
    };
  });

  const drivers: DomainDriver[] = [];
  if (capacityTotal === 0) {
    drivers.push({ tone: 'warning', label: 'Nessuno stabilimento registrato', detail: 'Il paese non ha fabbriche nel conto nazionale né sulla mappa.' });
  } else {
    drivers.push({
      tone: usedPct >= 95 ? 'warning' : usedPct >= 60 ? 'positive' : 'neutral',
      label: `Capacità industriale usata ${formatPercent(usedPct, 0)}`,
      detail: `${capacityFree} ${capacityFree === 1 ? 'linea libera' : 'linee libere'} su ${capacityTotal}${usedPct >= 95 ? ': nessun margine per nuove lavorazioni.' : '.'}`,
    });
  }
  for (const assignment of assignments.filter(item => item.blocker)) {
    drivers.push({
      tone: 'warning',
      label: `Rallentamento: ${assignment.label}`,
      detail: `${assignment.sector} · ${assignment.blocker}`,
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
  if (capacityTotal === 0) status = 'pressure';
  else if (usedPct >= 95) status = capacityFree === 0 ? 'pressure' : 'pressure';
  const blocked = assignments.filter(item => item.blocker).length;
  if (blocked >= 2) status = 'fragile';
  if (blocked >= 3 || (usedPct >= 95 && blocked >= 1)) status = 'critical';
  if (capacityTotal > 0 && usedPct < 60 && blocked === 0) status = 'healthy';

  const headline = capacityTotal === 0
    ? 'Nessuna capacità industriale registrata.'
    : `${capacityTotal} stabilimenti, ${capacityUsed} occupati da lavorazioni attive, ${capacityFree} liberi.`;

  return {
    status,
    headline,
    drivers,
    capacityTotal,
    capacityUsed,
    capacityFree,
    usedPct,
    assignments,
    sectors,
    productions,
    ports,
    universities,
  };
}
