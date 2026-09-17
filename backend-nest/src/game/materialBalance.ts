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
  advanceStock, materialNeeds, storageCapacity, type ResourceStock,
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
): MaterialBalanceRow[] {
  if (!account) return [];
  const tick = advanceStock(stock, account, days, endowment);
  const needs = materialNeeds(account);
  const capacity = storageCapacity(account);
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

/** Riga di sintesi leggibile: «Armamenti 4/4 · saldo +0,86/mese». */
export function describeMaterialBalance(rows: MaterialBalanceRow[]): string {
  if (rows.length === 0) return 'Bilancio materiale non pubblicato.';
  return rows
    .map(row => `${row.label} ${row.stock}/${row.capacity} · saldo ${row.balancePerMonth >= 0 ? '+' : ''}${row.balancePerMonth}/mese`)
    .join('; ');
}
