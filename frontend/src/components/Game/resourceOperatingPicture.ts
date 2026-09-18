/**
 * World Story — COUNTRY-CLARITY: scheda Risorse
 * ============================================
 * Da «quanto ho» a «quanto mi dura»: per ogni risorsa modellata dal motore
 * (cibo, vestiario, armamenti, carburante) mostra stock, produzione, consumo,
 * saldo e **mesi di autonomia**; per le risorse naturali mostra giacimento,
 * estrazione e magazzino.
 *
 * Le cifre vengono da `MaterialEconomy` (via `resources.balance`) e dal ledger
 * delle risorse naturali. L'unica trasformazione aggiunta è la divisione
 * `scorta / saldo negativo`, con tutte le guardie del caso (`domainStatus`).
 */
import { formatNumber } from '../../utils/format';
import type { NationResources } from './NationDock/types';
import { deriveMaterialRows, type MaterialBalanceRow, type MaterialRowView } from './materialBalance';
import { autonomyMonths, finiteOrNull, round1, type AutonomyReading, type DomainDriver, type DomainStatus, type DriverTone } from './domainStatus';

export interface ResourceFlowRow {
  id: string;
  label: string;
  stock: number | null;
  capacity: number | null;
  productionPerMonth: number | null;
  consumptionPerMonth: number | null;
  netPerMonth: number | null;
  /** Importazioni/esportazioni mensili: `null` se il motore non le modella. */
  importsPerMonth: number | null;
  exportsPerMonth: number | null;
  autonomy: AutonomyReading;
  /** Stato già calcolato da MaterialBalance (`critico`…`ignoto`). */
  state: MaterialRowView['state'];
  stateLabel: string;
  stateHint: string;
  tone: DriverTone;
}

export interface NaturalResourceRow {
  id: string;
  label: string;
  stockpile: number;
  reserve: number;
  maxReserve: number;
  extractionPerMonth: number;
  depletionPct: number;
  depleted: boolean;
  renewable: boolean;
}

export interface ResourcePicture extends DomainStatus {
  rows: ResourceFlowRow[];
  /** Righe in stato critico o teso: sono le attenzioni del dominio. */
  critical: ResourceFlowRow[];
  /** Carburante: la voce che decide la prontezza militare. */
  fuel: ResourceFlowRow | null;
  natural: NaturalResourceRow[];
  /** Riserve naturali esaurite o quasi (≥90% consumate). */
  depletedNatural: NaturalResourceRow[];
  /** Punti ricerca non spesi (progresso tecnologico). */
  researchPoints: number | null;
}

const EPSILON = 1e-9;

function toneOf(state: MaterialRowView['state']): DriverTone {
  switch (state) {
    case 'critico': return 'critical';
    case 'teso': return 'warning';
    case 'al_tetto': return 'positive';
    case 'ignoto': return 'neutral';
    default: return 'positive';
  }
}

/**
 * Riga di flusso completa: ai numeri del motore aggiunge solo l'autonomia.
 * `imports/exports` restano `null` perché il motore non modella gli scambi
 * mensili dei materiali: il Dossier mostra «—» invece di inventare un saldo.
 */
function flowRow(raw: Partial<MaterialBalanceRow> & { kind: string }, view: MaterialRowView): ResourceFlowRow {
  const stock = finiteOrNull(raw.stock);
  const production = finiteOrNull(raw.productionPerMonth);
  const consumption = finiteOrNull(raw.consumptionPerMonth);
  const net = finiteOrNull(raw.balancePerMonth)
    ?? (production !== null && consumption !== null ? round1(production - consumption) : null);
  return {
    id: raw.kind,
    label: view.label,
    stock,
    capacity: finiteOrNull(raw.capacity),
    productionPerMonth: production,
    consumptionPerMonth: consumption,
    netPerMonth: net,
    importsPerMonth: null,
    exportsPerMonth: null,
    autonomy: autonomyMonths(stock, net),
    state: view.state,
    stateLabel: view.stateLabel,
    stateHint: view.stateHint,
    tone: toneOf(view.state),
  };
}

export function resourceOperatingPicture(resources?: Partial<NationResources> | null): ResourcePicture {
  const balance = Array.isArray(resources?.balance) ? resources!.balance! : null;
  const views = deriveMaterialRows(balance);

  const rows: ResourceFlowRow[] = views.map(view => flowRow(balance?.find(row => row.kind === view.kind) ?? { kind: view.kind }, view));

  const natural: NaturalResourceRow[] = (resources?.natural ?? []).map(node => ({
    id: node.kind,
    label: node.label,
    stockpile: finiteOrNull(node.stockpile) ?? 0,
    reserve: finiteOrNull(node.reserve) ?? 0,
    maxReserve: finiteOrNull(node.maxReserve) ?? 0,
    extractionPerMonth: finiteOrNull(node.extractionPerMonth) ?? 0,
    depletionPct: finiteOrNull(node.depletionPct) ?? 0,
    depleted: node.depleted === true,
    renewable: node.renewable === true,
  }));

  const critical = rows.filter(row => row.state === 'critico' || row.state === 'teso');
  const fuel = rows.find(row => row.id === 'fuel') ?? null;
  const depletedNatural = natural.filter(node => node.depleted || node.depletionPct >= 90);
  const researchPoints = finiteOrNull(resources?.research);

  const drivers: DomainDriver[] = [];
  for (const row of critical) {
    drivers.push({
      tone: row.state === 'critico' ? 'critical' : 'warning',
      label: `${row.label}: ${row.stateLabel}`,
      detail: `${row.stateHint} · autonomia ${row.autonomy.text}.`,
    });
  }
  if (fuel) {
    drivers.push({
      tone: fuel.state === 'critico' ? 'critical' : fuel.state === 'teso' ? 'warning' : 'positive',
      label: `Carburante: ${fuel.autonomy.text}`,
      detail: (fuel.consumptionPerMonth ?? 0) > 0
        ? `Consumo ${formatNumber(fuel.consumptionPerMonth ?? 0)}/mese, produzione ${formatNumber(fuel.productionPerMonth ?? 0)}/mese.`
        : 'Nessun consumo registrato per questo materiale.',
    });
  }
  if (depletedNatural.length > 0) {
    drivers.push({
      tone: 'warning',
      label: `${depletedNatural.length} giacimenti in esaurimento`,
      detail: `${depletedNatural.map(node => `${node.label} (${node.depletionPct}%)`).join(', ')}.`,
    });
  }
  if (rows.length === 0) {
    drivers.push({ tone: 'neutral', label: 'Bilancio materiale non pubblicato', detail: 'Il motore non espone ancora produzione e consumo di questo scenario.' });
  }

  let status: ResourcePicture['status'] = 'stable';
  if (rows.length === 0) status = 'pressure';
  if (critical.length > 0) status = critical.some(row => row.state === 'critico') ? 'fragile' : 'pressure';
  if (critical.filter(row => row.state === 'critico').length >= 2) status = 'critical';
  if (fuel?.state === 'critico' && (fuel.autonomy.months ?? 1) < 0.5) status = 'critical';

  const headline = rows.length === 0
    ? 'Il motore non pubblica il bilancio materiale di questa partita.'
    : critical.length === 0
      ? 'Scorte coperte: nessun materiale sotto la soglia di allerta.'
      : `${critical.length} materiali sotto la soglia: ${critical.map(row => row.label.toLowerCase()).join(', ')}.`;

  return {
    status,
    headline,
    drivers,
    rows,
    critical,
    fuel,
    natural,
    depletedNatural,
    researchPoints,
  };
}

/** Etichetta «disponibile/tetto» per una riga di flusso. */
export function stockLabel(row: ResourceFlowRow): string {
  if (row.stock === null) return '—';
  return row.capacity && row.capacity > 0
    ? `${formatNumber(row.stock)}/${formatNumber(row.capacity)}`
    : formatNumber(row.stock);
}

/** Riga secondaria con i flussi del mese, senza inventare import/export. */
export function flowLine(row: ResourceFlowRow): string {
  const parts = [
    `produzione ${formatNumber(row.productionPerMonth ?? 0)}/mese`,
    `consumo ${formatNumber(row.consumptionPerMonth ?? 0)}/mese`,
    `saldo ${(row.netPerMonth ?? 0) > EPSILON ? '+' : ''}${formatNumber(row.netPerMonth ?? 0)}/mese`,
    `autonomia ${row.autonomy.text}`,
  ];
  if (row.importsPerMonth !== null || row.exportsPerMonth !== null) {
    parts.push(`import ${formatNumber(row.importsPerMonth ?? 0)} · export ${formatNumber(row.exportsPerMonth ?? 0)}`);
  }
  return parts.join(' · ');
}
