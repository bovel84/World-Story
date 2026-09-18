/**
 * World Story — Bilancio materiale (read model)
 * ============================================
 *
 * Risponde in due secondi alla domanda del giocatore: «quanto ho, quanto
 * produco, quanto consumo, sto andando bene o male?».
 *
 * **Non è una seconda simulazione.** Il motore calcola già, a ogni avanzamento,
 * il **flusso netto** di ogni materiale (`advanceStock` → `MaterialTick.flow`)
 * e il **fabbisogno mensile** (`materialNeeds`); quei numeri però finiscono solo
 * in una riga di bollettino e non sono più leggibili dal Dossier. Qui vengono
 * ricomposti in forma strutturata, riusando **le stesse funzioni del motore**
 * (pure, senza scritture e senza effetti collaterali) sullo stato corrente:
 *
 *   consumo/mese    = fabbisogno del mese (motore)
 *   saldo/mese      = flusso netto del mese (motore)
 *   produzione/mese = consumo + saldo (aritmetica sui due numeri del motore)
 *
 * Tetto di stoccaggio, materiale perso e stock avanzato vengono dallo stesso
 * tick del motore. Nessun valore è inventato e nessuno stato è duplicato.
 */

import {
  advanceStock, civilMaterialNeeds, effectiveMaterialNeeds, materialNeeds, storageCapacity,
  type MaterialFlowOverlay, type MaterialNeeds, type ResourceStock,
} from '../core/simulation/MaterialEconomy';
import type { NationalAccount } from '../core/simulation/WorldStateEngine';
import type { NaturalEndowment } from '../core/simulation/MilitaryIndustry';

/** I materiali del magazzino che hanno insieme scorta, produzione e consumo. */
export type MaterialKind = 'food' | 'clothing' | 'weapons' | 'fuel';

export const MATERIAL_KINDS: MaterialKind[] = ['food', 'clothing', 'weapons', 'fuel'];

export const MATERIAL_LABELS: Record<MaterialKind, string> = {
  food: 'Cibo',
  clothing: 'Vestiario',
  weapons: 'Armamenti',
  fuel: 'Carburante',
};

/** Il ritmo materiale del motore è mensile: 30 giorni. */
export const MATERIAL_BALANCE_DAYS = 30;

export interface MaterialBalanceRow {
  kind: MaterialKind;
  label: string;
  /** Scorta attuale (stessa unità dell'indice materiale). */
  stock: number;
  /** Tetto di stoccaggio: oltre quel valore il surplus si perde. */
  capacity: number;
  /** Quanto il paese produce in un mese. */
  productionPerMonth: number;
  /** Quanto il paese consuma in un mese (fabbisogno). */
  consumptionPerMonth: number;
  /** Saldo mensile del motore: produzione − consumo (segno compreso). */
  balancePerMonth: number;
  /** Materiale perso nel mese perché il magazzino era già al tetto. */
  spoiledPerMonth: number;
}

const round = (value: number | undefined, digits = 3) => {
  const factor = 10 ** digits;
  return Math.round((Number.isFinite(Number(value)) ? Number(value) : 0) * factor) / factor;
};

/**
 * Bilancio materiale mensile della nazione, derivato dal motore.
 * `endowment` è la dotazione efficace (giacimenti residui compresi), la stessa
 * che il motore usa per avanzare le scorte.
 */
export function materialBalance(
  stock: ResourceStock,
  account: NationalAccount | undefined,
  endowment: NaturalEndowment = {},
  days: number = MATERIAL_BALANCE_DAYS,
  overlay?: MaterialFlowOverlay | null,
): MaterialBalanceRow[] {
  if (!account) return [];
  const tick = advanceStock(stock, account, days, endowment, undefined, overlay);
  // Il fabbisogno è quello **efficace**: con gli oggetti persistenti il
  // militare arriva dalle armate e dalle navi, non dai reparti generici.
  const needs = effectiveMaterialNeeds(account, overlay);
  const capacity = storageCapacity(account, needs);
  return MATERIAL_KINDS.map(kind => {
    const consumption = Number(needs[kind]) || 0;
    const balance = Number(tick.flow[kind]) || 0;
    return {
      kind,
      label: MATERIAL_LABELS[kind],
      stock: round(stock[kind] ?? 0),
      capacity: round(capacity[kind] ?? 0),
      productionPerMonth: round(consumption + balance),
      consumptionPerMonth: round(consumption),
      balancePerMonth: round(balance),
      spoiledPerMonth: round(tick.spoiled?.[kind]),
    };
  });
}

/**
 * Da dove arriva e dove finisce ogni materiale, in un mese: la struttura che
 * rende leggibile il tick (motore + oggetti reali). `total` è il saldo del
 * motore; `natural` è ciò che resta togliendo oggetti e consumi (agricoltura,
 * giacimenti, popolazione): aritmetica sui numeri del motore, niente inventato.
 */
export interface MaterialFlowRow {
  kind: MaterialKind;
  label: string;
  /** Consumo civile (popolazione, impianti): negativo. */
  civilian: number;
  /** Saldo degli impianti reali (produzione − input): segno compreso. */
  facilities: number;
  /** Consumo delle armate: negativo. */
  army: number;
  /** Consumo della marina: negativo. */
  navy: number;
  /** Produzione naturale del motore (agricoltura, giacimenti, popolazione). */
  natural: number;
  /** Saldo del mese dal motore. */
  total: number;
}

export function materialFlowBreakdown(
  stock: ResourceStock,
  account: NationalAccount | undefined,
  endowment: NaturalEndowment = {},
  days: number = MATERIAL_BALANCE_DAYS,
  overlay?: MaterialFlowOverlay | null,
): MaterialFlowRow[] {
  if (!account) return [];
  const tick = advanceStock(stock, account, days, endowment, undefined, overlay);
  const civil: MaterialNeeds = civilMaterialNeeds(account);
  const military = overlay?.militaryNeeds ?? materialNeeds(account);
  const navyFuel = Math.max(0, Number(overlay?.navyFuel) || 0);
  return MATERIAL_KINDS.map(kind => {
    const total = round(tick.flow[kind]);
    const facilities = overlay
      ? round(Number(overlay.production?.[kind] || 0) - Number(overlay.consumption?.[kind] || 0))
      : 0;
    const navy = kind === 'fuel' && overlay ? -round(navyFuel) : 0;
    const militaryNeed = Number(military[kind]) || 0;
    const army = overlay ? -round(Math.max(0, militaryNeed - (kind === 'fuel' ? navyFuel : 0))) : 0;
    const civilian = -round(Number(civil[kind]) || 0);
    return {
      kind,
      label: MATERIAL_LABELS[kind],
      civilian,
      facilities,
      army,
      navy,
      natural: round(total - (facilities + civilian + army + navy)),
      total,
    };
  });
}

/** Riga di sintesi del flusso: «Carburante +5/mese (impianti +12, naturale +5, civile −4, esercito −6, marina −2)». */
export function describeMaterialFlow(rows: MaterialFlowRow[]): string {
  if (rows.length === 0) return 'Flusso materiale non pubblicato.';
  return rows.map(row => {
    const sign = (value: number) => (value >= 0 ? `+${value}` : `${value}`);
    const parts = [
      `impianti ${sign(row.facilities)}`,
      `naturale ${sign(row.natural)}`,
      `civile ${sign(row.civilian)}`,
      `esercito ${sign(row.army)}`,
      `marina ${sign(row.navy)}`,
    ].join(', ');
    return `${row.label} ${sign(row.total)}/mese (${parts})`;
  }).join('; ');
}

/** Riga di sintesi leggibile: «Armamenti 4/4 · saldo +0,86/mese». */
export function describeMaterialBalance(rows: MaterialBalanceRow[]): string {
  if (rows.length === 0) return 'Bilancio materiale non pubblicato.';
  return rows
    .map(row => `${row.label} ${row.stock}/${row.capacity} · saldo ${row.balancePerMonth >= 0 ? '+' : ''}${row.balancePerMonth}/mese`)
    .join('; ');
}
