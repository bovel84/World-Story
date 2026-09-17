/**
 * World Story — MATERIEL-CLARITY: sintesi leggibile del bilancio materiale
 * ======================================================================
 * Il Dossier pubblicava schede tecniche (calibro, gittata, serventi) senza la
 * lettura che serve a decidere: **quanto ho, quanto produco, quanto consumo,
 * avanzo o deficit?**
 *
 * Qui i numeri del motore (`resources.balance`, derivato lato server dalle
 * stesse funzioni del motore) diventano una riga di sintesi: disponibilità,
 * produzione, consumo, saldo con segno e stato. Funzione **pura**: nessun
 * numero è calcolato qui se non la lettura dei dati ricevuti — se il motore non
 * pubblica il bilancio, non si inventa nulla e si dice che manca.
 */

import { formatMoney } from '../../utils/format';

export interface MaterialBalanceRow {
  kind: string;
  label?: string;
  stock?: number;
  capacity?: number;
  productionPerMonth?: number;
  consumptionPerMonth?: number;
  balancePerMonth?: number;
  spoiledPerMonth?: number;
}

export type MaterialState = 'critico' | 'teso' | 'sufficiente' | 'al_tetto' | 'ignoto';

export interface MaterialRowView {
  kind: string;
  label: string;
  /** «20,9 / 24» — disponibilità e tetto del magazzino. */
  availabilityText: string;
  productionText: string;
  consumptionText: string;
  balanceText: string;
  balanceTone: 'positive' | 'negative' | 'neutral';
  state: MaterialState;
  stateLabel: string;
  stateHint: string;
}

/** Etichette di riserva se il motore non manda l'etichetta della riga. */
const FALLBACK_LABELS: Record<string, string> = {
  food: 'Cibo', clothing: 'Vestiario', weapons: 'Armamenti', fuel: 'Carburante',
};

const num = (value: unknown): number | undefined =>
  Number.isFinite(Number(value)) ? Number(value) : undefined;

/**
 * Due decimali con la formattazione condivisa (`utils/format`): virgola
 * decimale, punto per le migliaia e «—» per i valori assenti. La stessa lingua
 * del resto del Dossier, senza dipendere dai dati ICU del runtime.
 */
const dec = (value: number, decimals = 2): string => formatMoney(value, { decimals });
const signed = (value: number, decimals = 2): string => formatMoney(value, { decimals, sign: true });

/**
 * Stato del materiale: deriva da copertura (mesi di scorta) e tetto, entrambi
 * numeri del motore. Nessun giudizio indipendente dai dati.
 */
function stateOf(stock: number | undefined, consumption: number | undefined, balance: number | undefined, capacity: number | undefined, spoiled: number | undefined): MaterialState {
  if (stock === undefined) return 'ignoto';
  const months = consumption && consumption > 0 ? stock / consumption : undefined;
  if (months !== undefined && months < 1) return 'critico';
  if (capacity !== undefined && capacity > 0 && stock >= capacity * 0.995 && (balance ?? 0) >= 0) return 'al_tetto';
  if (months !== undefined && months < 3) return 'teso';
  if (balance !== undefined && balance < 0) return 'teso';
  return 'sufficiente';
}

const STATE_LABELS: Record<MaterialState, string> = {
  critico: 'critico', teso: 'teso', sufficiente: 'sufficiente', al_tetto: 'in accumulo', ignoto: 'non pubblicato',
};

function stateHint(state: MaterialState, spoiled: number | undefined): string {
  switch (state) {
    case 'critico': return 'meno di un mese di copertura: il fabbisogno non è coperto';
    case 'teso': return 'copertura sotto i tre mesi: basta un imprevisto';
    case 'al_tetto': return (spoiled ?? 0) > 0
      ? 'magazzino al tetto: il surplus prodotto va perso'
      : 'magazzino al tetto: non può accumulare oltre';
    case 'sufficiente': return 'copertura adeguata al fabbisogno';
    default: return 'il motore non pubblica il bilancio di questo materiale';
  }
}

/** Trasforma le righe del motore in righe scansionabili. Ordine invariato. */
export function deriveMaterialRows(rows: MaterialBalanceRow[] | null | undefined): MaterialRowView[] {
  if (!Array.isArray(rows)) return [];
  const seen = new Set<string>();
  const views: MaterialRowView[] = [];
  for (const row of rows) {
    const kind = String(row?.kind || '');
    if (!kind || seen.has(kind)) continue;
    seen.add(kind);
    const label = row.label || FALLBACK_LABELS[kind] || kind;
    const stock = num(row.stock);
    const capacity = num(row.capacity);
    const production = num(row.productionPerMonth);
    const consumption = num(row.consumptionPerMonth);
    const balance = num(row.balancePerMonth);
    const spoiled = num(row.spoiledPerMonth);
    const state = stateOf(stock, consumption, balance, capacity, spoiled);
    views.push({
      kind,
      label,
      availabilityText: stock === undefined
        ? '—'
        : capacity !== undefined && capacity > 0 ? `${dec(stock, stock < 10 ? 2 : 1)} / ${dec(capacity, capacity < 10 ? 2 : 1)}` : dec(stock, stock < 10 ? 2 : 1),
      productionText: production === undefined ? '—' : `${dec(production)}/mese`,
      consumptionText: consumption === undefined ? '—' : `${dec(consumption)}/mese`,
      balanceText: balance === undefined ? '—' : `${signed(balance)}/mese`,
      balanceTone: balance === undefined || balance === 0 ? 'neutral' : balance > 0 ? 'positive' : 'negative',
      state,
      stateLabel: STATE_LABELS[state],
      stateHint: stateHint(state, spoiled),
    });
  }
  return views;
}

/** Filtra la sintesi sui materiali richiesti (l'ordine resta quello del motore). */
export function materialRowsOf(views: MaterialRowView[], kinds: string[]): MaterialRowView[] {
  if (kinds.length === 0) return views;
  const wanted = new Set(kinds);
  return views.filter(view => wanted.has(view.kind));
}

/** Riga di sintesi in una frase: «Armamenti 160,0 / 200 · saldo +0,30/mese». */
export function materialSummaryLine(view: MaterialRowView): string {
  return `${view.label} ${view.availabilityText} · saldo ${view.balanceText} · ${view.stateLabel}`;
}
