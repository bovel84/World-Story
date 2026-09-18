import {
  NATURAL_RESOURCE_KINDS, NATURAL_RESOURCE_LABELS,
  type NaturalEndowment, type NaturalResourceKind,
} from './MilitaryIndustry';
import type { NationalAccount } from './WorldStateEngine';
import type { ResourceStock } from './MaterialEconomy';

/**
 * Risorse naturali dinamiche: estrazione, esaurimento e mercato.
 *
 * Il giacimento (`endowment`, 0-5) resta il tratto immutabile del paese, ma la
 * sua **riserva** si consuma con l'estrazione. Quando la riserva si esaurisce il
 * paese perde il vantaggio di quella risorsa (i bonus di `advanceStock` cadono a
 * zero) e deve importarla dal mercato. Le risorse rinnovabili si rigenerano.
 *
 * Tutto è deterministico: nessun valore è inventato dal modello.
 */

/** Unità di riserva estratte per punto di endowment. */
export const RESERVE_PER_POINT = 24;
/** Frazione della riserva iniziale rigenerata ogni mese per le rinnovabili. */
export const RENEWAL_RATE = 0.15;
/** Quota di estrazione annua per punto di endowment, prima delle infrastrutture. */
export const BASE_EXTRACTION = 0.5;

export const RENEWABLE_RESOURCES: readonly NaturalResourceKind[] = [
  'timber', 'fertile_land', 'fisheries', 'water',
];

/** Valore base di una unità di risorsa (miliardi USD), usato dal mercato. */
export const RESOURCE_VALUE: Record<NaturalResourceKind, number> = {
  oil: 0.6, gas: 0.5, coal: 0.25, iron: 0.35, copper: 0.4, bauxite: 0.3,
  uranium: 1.2, gold: 1.5, diamonds: 1.3, lithium: 0.9, rare_earths: 1.1,
  timber: 0.15, fertile_land: 0.2, fisheries: 0.2, water: 0.05,
};

export interface ResourceNode {
  endowment: number;
  reserve: number;
  maxReserve: number;
  stockpile: number;
  extractedTotal: number;
}

export type ResourceLedger = Partial<Record<NaturalResourceKind, ResourceNode>>;

export interface NaturalAdvance {
  ledger: ResourceLedger;
  extracted: Partial<Record<NaturalResourceKind, number>>;
  depleted: NaturalResourceKind[];
}

export function isRenewable(kind: NaturalResourceKind): boolean {
  return RENEWABLE_RESOURCES.includes(kind);
}

export function resourceLabel(kind: NaturalResourceKind): string {
  return NATURAL_RESOURCE_LABELS[kind] || kind;
}

/** Semina la riserva di una nazione dal suo endowment immutabile. */
export function seedLedger(endowment: NaturalEndowment): ResourceLedger {
  const ledger: ResourceLedger = {};
  for (const kind of NATURAL_RESOURCE_KINDS) {
    const points = Math.max(0, Number(endowment[kind] || 0));
    if (points <= 0) continue;
    const maxReserve = Math.round(points * RESERVE_PER_POINT * 100) / 100;
    ledger[kind] = { endowment: points, reserve: maxReserve, maxReserve, stockpile: 0, extractedTotal: 0 };
  }
  return ledger;
}

/** Estrazione mensile: cresce con le infrastrutture, limitata dalla riserva. */
export function extractionRate(node: ResourceNode, account?: NationalAccount): number {
  const months = 1;
  const factories = Math.max(0, Number(account?.factories || 0));
  const ports = Math.max(0, Number(account?.ports || 0));
  const infra = 1 + factories * 0.06 + ports * 0.04;
  const gross = node.endowment * BASE_EXTRACTION * infra * months;
  return Math.min(node.reserve, gross);
}

/**
 * Avanza le riserve di un periodo: estrae, accumula nel magazzino e rigenera le
 * rinnovabili. Deterministico e senza effetti collaterali.
 */
export function advanceLedger(
  ledger: ResourceLedger, account: NationalAccount | undefined, days: number,
): NaturalAdvance {
  const period = Math.max(0, days) / 30;
  const next: ResourceLedger = {};
  const extracted: Partial<Record<NaturalResourceKind, number>> = {};
  const depleted: NaturalResourceKind[] = [];
  for (const kind of NATURAL_RESOURCE_KINDS) {
    const node = ledger[kind];
    if (!node) continue;
    // Il magazzino della risorsa estratta ha un tetto (mesi di estrazione):
    // non si accumula materiale all'infinito. A silos pieni l'estrazione si ferma.
    const stockpileCap = Math.max(node.endowment * BASE_EXTRACTION * 6, 10);
    const stockpileRoom = Math.max(0, stockpileCap - node.stockpile);
    const gross = extractionRate(node, account) * period;
    const take = Math.min(node.reserve, gross, stockpileRoom);
    const regen = isRenewable(kind) ? node.endowment * RESERVE_PER_POINT * RENEWAL_RATE * period : 0;
    const reserve = Math.min(node.maxReserve, Math.max(0, node.reserve - take + regen));
    const round = (value: number) => Math.round(value * 1000) / 1000;
    next[kind] = {
      ...node,
      reserve: round(reserve),
      stockpile: round(Math.min(stockpileCap, node.stockpile + take)),
      extractedTotal: round(node.extractedTotal + take),
    };
    if (take > 0) extracted[kind] = round(take);
    if (reserve <= 0 && node.reserve > 0) depleted.push(kind);
  }
  return { ledger: next, extracted, depleted };
}

/**
 * Prelievo dal **silo** dell'estrazione: la filiera industriale prende i
 * minerali da lì, non dal giacimento. Se il silo non basta si prende quello che
 * c'è: nessun materiale viene creato dal nulla.
 */
export function drawResourceStockpile(
  ledger: ResourceLedger, drawn: Partial<Record<NaturalResourceKind, number>>,
): { ledger: ResourceLedger; taken: Partial<Record<NaturalResourceKind, number>> } {
  const taken: Partial<Record<NaturalResourceKind, number>> = {};
  let changed = false;
  const next: ResourceLedger = {};
  for (const [key, node] of Object.entries(ledger)) {
    if (!node) continue;
    const kind = key as NaturalResourceKind;
    const want = Math.max(0, Number(drawn[kind] || 0));
    if (want <= 0) { next[kind] = node; continue; }
    const take = Math.min(node.stockpile, want);
    taken[kind] = Math.round(take * 1000) / 1000;
    if (take > 0) changed = true;
    next[kind] = take > 0 ? { ...node, stockpile: Math.round((node.stockpile - take) * 1000) / 1000 } : node;
  }
  return { ledger: changed ? next : ledger, taken };
}

/**
 * Endowment effettivo dopo l'esaurimento: una risorsa senza riserva non offre
 * più i bonus di produzione basati sul giacimento.
 */
export function effectiveEndowment(ledger: ResourceLedger, base: NaturalEndowment): NaturalEndowment {
  const result: NaturalEndowment = {};
  for (const kind of NATURAL_RESOURCE_KINDS) {
    const points = Number(base[kind] || 0);
    if (points <= 0) continue;
    const node = ledger[kind];
    if (!node || node.reserve <= 0) continue;
    result[kind] = points;
  }
  return result;
}

export interface ResourceSummary {
  kind: NaturalResourceKind;
  label: string;
  renewable: boolean;
  endowment: number;
  reserve: number;
  maxReserve: number;
  stockpile: number;
  extractionPerMonth: number;
  depletionPct: number;
  depleted: boolean;
}

export function summarizeLedger(ledger: ResourceLedger, account?: NationalAccount): ResourceSummary[] {
  const summaries: ResourceSummary[] = [];
  for (const kind of NATURAL_RESOURCE_KINDS) {
    const node = ledger[kind];
    if (!node) continue;
    const round = (value: number) => Math.round(value * 100) / 100;
    summaries.push({
      kind,
      label: resourceLabel(kind),
      renewable: isRenewable(kind),
      endowment: node.endowment,
      reserve: round(node.reserve),
      maxReserve: node.maxReserve,
      stockpile: round(node.stockpile),
      extractionPerMonth: round(extractionRate(node, account)),
      depletionPct: node.maxReserve > 0 ? Math.round((1 - node.reserve / node.maxReserve) * 100) : 0,
      depleted: node.reserve <= 0,
    });
  }
  return summaries.sort((a, b) => (b.endowment - a.endowment) || a.kind.localeCompare(b.kind));
}

// ---------------------------------------------------------------------------
// Mercato: prezzi che reagiscono all'esaurimento globale e allo scambio.
// ---------------------------------------------------------------------------

export const SELL_DISCOUNT = 0.92;
export const BUY_MARKUP = 1.18;
const MIN_PRICE_FACTOR = 0.4;
const MAX_PRICE_FACTOR = 3;

export interface WorldMarket {
  /** Riserve globali residue per risorsa (unità). */
  reserves: Partial<Record<NaturalResourceKind, number>>;
  /** Riserve globali iniziali, per misurare la scarsità. */
  initialReserves: Partial<Record<NaturalResourceKind, number>>;
  /** Pressione cumulata degli scambi (positiva = mercato comprato, prezzi su). */
  pressure: Partial<Record<NaturalResourceKind, number>>;
}

export interface MarketQuote {
  kind: NaturalResourceKind;
  label: string;
  base: number;
  mid: number;
  bid: number;
  ask: number;
  scarcityPct: number;
}

export function emptyMarket(): WorldMarket {
  return { reserves: {}, initialReserves: {}, pressure: {} };
}

/** Registra le riserve globali di partenza (una volta per partita). */
export function seedMarket(endowments: Record<string, NaturalEndowment>): WorldMarket {
  const market = emptyMarket();
  for (const endowment of Object.values(endowments)) {
    for (const kind of NATURAL_RESOURCE_KINDS) {
      const points = Number(endowment[kind] || 0);
      if (points <= 0) continue;
      const units = points * RESERVE_PER_POINT;
      market.reserves[kind] = (market.reserves[kind] || 0) + units;
      market.initialReserves[kind] = (market.initialReserves[kind] || 0) + units;
    }
  }
  return market;
}

/** Decrementa le riserve globali dell'estrazione effettiva di una nazione. */
export function applyGlobalExtraction(market: WorldMarket, extracted: Partial<Record<NaturalResourceKind, number>>): void {
  for (const kind of NATURAL_RESOURCE_KINDS) {
    const amount = Number(extracted[kind] || 0);
    if (amount <= 0) continue;
    market.reserves[kind] = Math.max(0, (market.reserves[kind] || 0) - amount);
  }
}

export function marketQuote(market: WorldMarket, kind: NaturalResourceKind): MarketQuote {
  const base = RESOURCE_VALUE[kind];
  const initial = market.initialReserves[kind] || 0;
  const reserve = market.reserves[kind] || 0;
  const scarcity = initial > 0 ? Math.min(0.8, Math.max(0, 1 - reserve / initial)) : 0;
  const pressure = Math.max(-0.4, Math.min(0.8, market.pressure[kind] || 0));
  const factor = Math.max(MIN_PRICE_FACTOR, Math.min(MAX_PRICE_FACTOR, 1 + 0.5 * scarcity + pressure));
  const round = (value: number) => Math.round(value * 1000) / 1000;
  return {
    kind,
    label: resourceLabel(kind),
    base,
    mid: round(base * factor),
    bid: round(base * factor * SELL_DISCOUNT),
    ask: round(base * factor * BUY_MARKUP),
    scarcityPct: Math.round(scarcity * 100),
  };
}

/** Pressione di prezzo per uno scambio: vendere abbassa, comprare alza. */
export function tradePressureDelta(kind: NaturalResourceKind, quantity: number, mode: 'sell' | 'buy'): number {
  const scale = (RESOURCE_VALUE[kind] || 0.5) * 40;
  const direction = mode === 'sell' ? -1 : 1;
  return (direction * quantity) / Math.max(1, scale);
}

export type TradeError = 'unknown_resource' | 'resource_not_held' | 'insufficient_stockpile' | 'insufficient_money' | 'quantity_invalid';

export interface TradeResult {
  ok: boolean;
  error?: TradeError;
  ledger: ResourceLedger;
  stock: ResourceStock;
  unitPrice: number;
  total: number;
}

/** Esegue uno scambio atomico tra magazzino naturale e cassa. */
export function executeTrade(
  ledger: ResourceLedger,
  stock: ResourceStock,
  market: WorldMarket,
  kind: NaturalResourceKind,
  quantity: number,
  mode: 'sell' | 'buy',
): TradeResult {
  const node = ledger[kind];
  const quote = marketQuote(market, kind);
  const qty = Math.floor(quantity);
  if (!NATURAL_RESOURCE_KINDS.includes(kind)) {
    return { ok: false, error: 'unknown_resource', ledger, stock, unitPrice: 0, total: 0 };
  }
  if (!node) {
    return { ok: false, error: 'resource_not_held', ledger, stock, unitPrice: 0, total: 0 };
  }
  if (!Number.isFinite(quantity) || qty <= 0) {
    return { ok: false, error: 'quantity_invalid', ledger, stock, unitPrice: 0, total: 0 };
  }
  const round = (value: number) => Math.round(value * 100) / 100;
  if (mode === 'sell') {
    if (node.stockpile < qty) {
      return { ok: false, error: 'insufficient_stockpile', ledger, stock, unitPrice: quote.bid, total: 0 };
    }
    const total = round(quote.bid * qty);
    const nextStock = { ...stock, money: round(stock.money + total) };
    const nextLedger = { ...ledger, [kind]: { ...node, stockpile: round(node.stockpile - qty) } };
    return { ok: true, ledger: nextLedger, stock: nextStock, unitPrice: quote.bid, total };
  }
  const total = round(quote.ask * qty);
  if (stock.money < total) {
    return { ok: false, error: 'insufficient_money', ledger, stock, unitPrice: quote.ask, total };
  }
  const nextStock = { ...stock, money: round(stock.money - total) };
  const nextLedger = { ...ledger, [kind]: { ...node, stockpile: round(node.stockpile + qty) } };
  return { ok: true, ledger: nextLedger, stock: nextStock, unitPrice: quote.ask, total };
}

export function describeLedger(ledger: ResourceLedger, account?: NationalAccount): string {
  const summaries = summarizeLedger(ledger, account);
  if (summaries.length === 0) return 'Nessuna risorsa naturale sfruttabile registrata.';
  return summaries.map(summary => {
    const state = summary.depleted
      ? 'ESAURITA'
      : `riserva ${summary.reserve}/${summary.maxReserve} (${summary.depletionPct}% consumata)`;
    const extra = summary.stockpile > 0 ? `, magazzino ${summary.stockpile}` : '';
    return `${summary.label}: ${state}${extra}, estrazione ${summary.extractionPerMonth}/mese`;
  }).join('; ');
}
