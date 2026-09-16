/**
 * World Story — Dossier Nazione: formattazione e toni
 * ==================================================
 * Estratti da `NationDock.tsx` (blocco 2, punto 4): comportamento invariato.
 */
import { formatMoney, formatNumber } from '../../../utils/format';
import type { Tone } from './types';

export function plural(value: number, singular: string, pluralForm: string): string {
  return `${formatNumber(value)} ${value === 1 ? singular : pluralForm}`;
}

export function formatDate(value?: string | null): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(value || '');
  if (!match) return value || 'Data non pubblicata';
  const months = ['gen', 'feb', 'mar', 'apr', 'mag', 'giu', 'lug', 'ago', 'set', 'ott', 'nov', 'dic'];
  return `${Number(match[3])} ${months[Number(match[2]) - 1]} ${match[1]}`;
}

/** Soglie di stato: derivano dalle stesse cifre del motore, non da giudizi. */
export function stabilityTone(value: number): Tone {
  return value >= 55 ? 'positive' : value >= 40 ? 'warning' : 'negative';
}
export function tensionTone(value: number): Tone {
  return value >= 55 ? 'negative' : value > 30 ? 'warning' : 'positive';
}
export function warEffortTone(value: number): Tone {
  return value >= 50 ? 'negative' : value > 0 ? 'warning' : 'neutral';
}
export function defenceTone(value: number): Tone {
  return value >= 8 ? 'negative' : value >= 5 ? 'warning' : 'positive';
}

/** Tono delle scorte in base ai mesi di copertura del fabbisogno mensile. */
export function resourceTone(value: number, monthly: number): Tone {
  if (monthly <= 0) return value > 0 ? 'positive' : 'neutral';
  const months = value / monthly;
  return months >= 3 ? 'positive' : months >= 1 ? 'warning' : 'negative';
}
export function resourceMonths(value: number, monthly: number): number {
  if (monthly <= 0) return value > 0 ? Infinity : 0;
  return value / monthly;
}

/** Etichette dei domini militari del catalogo. */
export const DOMAIN_LABELS: Record<string, string> = {
  terra: 'Forze di terra', aria: 'Aeronautica', mare: 'Marina', missili: 'Missili', droni: 'Droni',
};
export const TIER_TONE: Record<string, Tone> = {
  obsoleto: 'negative', datato: 'warning', moderno: 'neutral', avanzato: 'positive', nuova_generazione: 'positive',
};
export const RESOURCE_LABELS: Record<string, string> = {
  oil: 'Petrolio', gas: 'Gas', coal: 'Carbone', iron: 'Ferro', copper: 'Rame', bauxite: 'Bauxite',
  uranium: 'Uranio', gold: 'Oro', diamonds: 'Diamanti', lithium: 'Litio', rare_earths: 'Terre rare',
  timber: 'Legname', fertile_land: 'Terra fertile', fisheries: 'Pesca', water: 'Acqua',
};

export const TIER_LABEL = (tier: string): string => {
  const words = tier.replace(/_/g, ' ');
  return words.charAt(0).toUpperCase() + words.slice(1);
};

/**
 * Costo unitario: il catalogo è in milioni di USD, la tesoreria in miliardi.
 * Le cifre decimali si adattano all'ordine di grandezza (niente finta
 * precisione su una portaerei da 6.000 miliardi).
 */
export function formatBillions(mln: number): string {
  const value = mln / 1000;
  const decimals = value < 1 ? 3 : value < 100 ? 1 : 0;
  return formatMoney(value, { currency: 'mld', decimals });
}
