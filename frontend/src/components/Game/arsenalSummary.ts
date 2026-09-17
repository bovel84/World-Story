/**
 * World Story — MATERIEL-CLARITY: sintesi dell'arsenale
 * ===================================================
 * La scheda di un armamento apriva con ruolo, descrizione e caratteristiche
 * tecniche (calibro, gittata, serventi) e lasciava in secondo piano la domanda
 * del giocatore: **quanti ne ho e quanti ne sto producendo?**
 *
 * Qui i dati del motore diventano una riga di sintesi. Funzione pura: legge
 * soltanto ciò che il motore pubblica (`lines`, `production.orders`) e non
 * calcola né stima nulla per conto proprio.
 */

import { formatMoney, formatNumber } from '../../utils/format';
import { formatDate } from './NationDock/format';

export interface ProductionOrderLike {
  equipmentId?: string;
  name?: string;
  quantity?: number;
  progress?: number;
  status?: string;
  expectedDate?: string | null;
}

export interface ArsenalLineLike {
  id: string;
  name: string;
  quantity: number;
  /** Forza della voce (quantità × qualità × dominio) dal motore. */
  strength?: number;
  /** Quota sulla forza totale dell'arsenale, in %. */
  sharePct?: number;
  /** Unità realmente in servizio secondo il registro (`units`). */
  units?: number;
}

export interface ArsenalProduction {
  /** Unità in costruzione (somma degli ordini aperti). */
  quantity: number;
  orders: number;
  /** Completamento medio ponderato sulle quantità (0-100). */
  progress: number;
  /** Prima consegna prevista fra gli ordini aperti. */
  expectedDate: string | null;
}

const n = (value: unknown): number => (Number.isFinite(Number(value)) ? Number(value) : 0);

/**
 * Produzione in corso di un singolo armamento: somma degli ordini **aperti**
 * (`in_progress`) del motore, con il completamento medio ponderato sulle
 * quantità e la prima data di consegna prevista.
 */
export function arsenalProductionFor(
  orders: readonly ProductionOrderLike[] | null | undefined,
  equipmentId: string,
): ArsenalProduction | null {
  if (!Array.isArray(orders) || !equipmentId) return null;
  const open = orders.filter(order =>
    order && order.equipmentId === equipmentId && (order.status === undefined || order.status === 'in_progress'));
  if (open.length === 0) return null;
  let quantity = 0;
  let weighted = 0;
  let expectedDate: string | null = null;
  for (const order of open) {
    const units = Math.max(0, n(order.quantity));
    quantity += units;
    weighted += Math.max(0, Math.min(100, n(order.progress))) * units;
    const date = typeof order.expectedDate === 'string' && order.expectedDate ? order.expectedDate : null;
    if (date && (expectedDate === null || date < expectedDate)) expectedDate = date;
  }
  return {
    quantity,
    orders: open.length,
    progress: quantity > 0 ? Math.round(weighted / quantity) : 0,
    expectedDate,
  };
}

/**
 * Riga di sintesi di un armamento: «×160 in servizio · in produzione ×40 (42%,
 * consegna 20 giu 1951) · forza 56,0 (94,8% dell'arsenale)». Se il motore non
 * registra produzione in corso, la riga lo dice invece di tacere.
 */
export function arsenalLineSummary(line: ArsenalLineLike, production?: ArsenalProduction | null): string {
  const parts = [`×${formatNumber(line.quantity)} in servizio`];
  if (production && production.quantity > 0) {
    const eta = production.expectedDate ? `, consegna ${formatDate(production.expectedDate)}` : '';
    parts.push(`in produzione ×${production.quantity} (${production.progress}%${eta})`);
  } else {
    parts.push('nessun ordine in corso');
  }
  const strength = Number(line.strength);
  const share = Number(line.sharePct);
  if (Number.isFinite(strength) && Number.isFinite(share)) {
    parts.push(`forza ${formatMoney(strength, { decimals: 1 })} (${formatMoney(share, { decimals: 1 })}% dell'arsenale)`);
  }
  return parts.join(' · ');
}

export interface ArsenalBrief {
  lines: number;
  units: number;
  /** Ordini aperti che riguardano armamenti già in servizio. */
  openOrders: number;
  /** Unità complessive in costruzione su tutti gli ordini aperti. */
  unitsInProduction: number;
}

/** Fotografia dell'arsenale in una riga: voci, unità, produzione in corso. */
export function arsenalBrief(
  lines: readonly ArsenalLineLike[] | null | undefined,
  orders: readonly ProductionOrderLike[] | null | undefined,
): ArsenalBrief {
  const list = Array.isArray(lines) ? lines : [];
  const open = Array.isArray(orders) ? orders.filter(order => order && (order.status === undefined || order.status === 'in_progress')) : [];
  return {
    lines: list.length,
    units: list.reduce((total, line) => total + Math.max(0, n(line?.quantity)), 0),
    openOrders: open.length,
    unitsInProduction: open.reduce((total, order) => total + Math.max(0, n(order.quantity)), 0),
  };
}

/** Testo della fotografia: «3 voci · 43 unità in servizio · 2 ordini (52 pezzi)». */
export function arsenalBriefText(brief: ArsenalBrief): string {
  const parts = [
    `${brief.lines} ${brief.lines === 1 ? 'voce' : 'voci'}`,
    `${formatNumber(brief.units)} unità in servizio`,
  ];
  parts.push(brief.openOrders === 0
    ? 'nessuna produzione in corso'
    : `${brief.openOrders} ${brief.openOrders === 1 ? 'ordine' : 'ordini'} in corso (${brief.unitsInProduction} pezzi)`);
  return parts.join(' · ');
}
