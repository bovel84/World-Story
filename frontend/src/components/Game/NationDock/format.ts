/**
 * World Story — Dossier Nazione: formattazione e toni
 * ==================================================
 * Estratti da `NationDock.tsx` (blocco 2, punto 4): comportamento invariato.
 */
import { formatDateOr, formatMoney, formatNumber } from '../../../utils/format';
import type { Tone } from './types';

/**
 * N1/N2 — l'unità di conto del gioco, dichiarata **una volta sola**.
 *
 * Fino a ieri la stringa `'mld'` era ricopiata in 36 punti: cambiarla significava
 * cambiarla 36 volte, e dimenticarsene in un punto produceva un numero nudo senza
 * che nessun test se ne accorgesse. Ora l'unità vive qui e i punti la usano.
 *
 * **Che cosa dichiara, e che cosa non dichiara.** Il motore calcola le grandezze
 * di conto in miliardi di **dollari del 2026**, anche per un mondo del 1815: la
 * scala storica cambia il valore, non la valuta (`WorldStateEngine`). «mld» dice
 * perciò la verità che il dato porta — l'ordine di grandezza — e non finge una
 * moneta d'epoca che il motore non conosce. Una moneta d'epoca (lire, sterline,
 * franchi) richiederebbe scala dei prezzi e cambi, cioè motore: è una decisione
 * di prodotto, non un'etichetta (vedi `docs/COERENZA_DOSSIER_ANNO_NAZIONE.md` D-B).
 */
export const MONEY_UNIT = 'mld';

/** Riga da mettere nella descrizione di un blocco che mostra denaro (N1). */
export const MONEY_UNIT_NOTE = `Importi in miliardi (${MONEY_UNIT}).`;

/**
 * Denaro del dossier: `formatMoney` + l'unità dichiarata.
 * `sign` antepone +/− esplicito (per saldi e variazioni).
 */
export function money(value: number | null | undefined, decimals = 2, opts: { sign?: boolean } = {}): string {
  return formatMoney(value, { currency: MONEY_UNIT, decimals, sign: opts.sign });
}

/** Numero senza unità (indici, pesi, quote): «123,4», mai una valuta. */
export function index(value: number | null | undefined, decimals = 1, opts: { sign?: boolean } = {}): string {
  return formatMoney(value, { decimals, sign: opts.sign });
}

export function plural(value: number, singular: string, pluralForm: string): string {
  return `${formatNumber(value)} ${value === 1 ? singular : pluralForm}`;
}

/**
 * N08 — il Dossier usa **una sola** implementazione della data breve, quella
 * condivisa (`utils/format`). Qui resta solo il fallback proprio del dossier:
 * «Data non pubblicata» dice che il motore non ha pubblicato la data, che è
 * un'informazione diversa da un trattino.
 */
export function formatDate(value?: string | null): string {
  return formatDateOr(value, 'Data non pubblicata');
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
  return money(value, decimals);
}
