/**
 * World Story — COUNTRY-CLARITY: linguaggio comune dei domini
 * ==========================================================
 * Ogni scheda del Dossier (economia, risorse, industria, forze armate,
 * governo) parla la stessa lingua: uno **stato** sintetico, una **headline** e
 * una lista di **driver** con tono semantico.
 *
 * Il modulo è puro: nessuna chiamata, nessun React, nessuna scrittura. Riceve
 * solo numeri già pubblicati dal motore e li trasforma in giudizi leggibili
 * (soglie dichiarate qui e coperte dai test). La UI non ricalcola mai le
 * formule del motore: se il motore calcola un saldo, qui si legge e si spiega.
 */

/** Stato sintetico di un dominio: dal migliore al peggiore. */
export type DomainStatusLevel = 'healthy' | 'stable' | 'pressure' | 'fragile' | 'critical';

/** Tono di un singolo driver: serve al colore, non a nuovi calcoli. */
export type DriverTone = 'positive' | 'warning' | 'critical' | 'neutral';

export interface DomainDriver {
  tone: DriverTone;
  label: string;
  detail?: string;
}

export interface DomainStatus {
  status: DomainStatusLevel;
  headline: string;
  drivers: DomainDriver[];
}

/** Etichetta umana dello stato, usata da tutte le schede. */
export const DOMAIN_STATUS_LABEL: Record<DomainStatusLevel, string> = {
  healthy: 'Solido',
  stable: 'Stabile',
  pressure: 'Sotto pressione',
  fragile: 'Fragile',
  critical: 'Critico',
};

/** Ordine di gravità: `healthy` = 0 … `critical` = 4. */
export const DOMAIN_STATUS_ORDER: Record<DomainStatusLevel, number> = {
  healthy: 0, stable: 1, pressure: 2, fragile: 3, critical: 4,
};

/** Tono CSS dello stato: riusa la scala dei toni già presente nel Dossier. */
/** Il Dossier dipinge tre toni; «critical» usa il rosso del negativo. */
export function dossierTone(tone: DriverTone): 'positive' | 'warning' | 'negative' | 'neutral' {
  return tone === 'critical' ? 'negative' : tone;
}

/** Tono CSS di uno stato di dominio, già tradotto per il Dossier. */
export function statusDossierTone(status: DomainStatusLevel): 'positive' | 'warning' | 'negative' | 'neutral' {
  return dossierTone(statusTone(status));
}

export function statusTone(status: DomainStatusLevel): DriverTone {
  switch (status) {
    case 'critical': return 'critical';
    case 'fragile': return 'warning';
    case 'pressure': return 'warning';
    case 'healthy': return 'positive';
    default: return 'neutral';
  }
}

/** Stato peggiore di una lista: il dominio si legge dal suo punto debole. */
export function worstStatus(levels: DomainStatusLevel[]): DomainStatusLevel {
  return levels.reduce<DomainStatusLevel>(
    (worst, level) => (DOMAIN_STATUS_ORDER[level] > DOMAIN_STATUS_ORDER[worst] ? level : worst),
    'healthy',
  );
}

/** Priorità di lettura di un driver: prima i problemi, poi le buone notizie. */
export function driverPriority(tone: DriverTone): number {
  switch (tone) {
    case 'critical': return 0;
    case 'warning': return 1;
    case 'neutral': return 2;
    default: return 3;
  }
}

/**
 * Attenzioni del paese: i soli driver che chiedono una decisione, i più gravi
 * per primi e senza ripetizioni. È la lista che apre la Sala operativa.
 */
export function attentionFrom(domains: Array<{ id: string; label: string; status: DomainStatusLevel; drivers: DomainDriver[] }>, limit = 5): Array<DomainDriver & { domain: string }> {
  const seen = new Set<string>();
  const attention: Array<DomainDriver & { domain: string }> = [];
  for (const domain of [...domains].sort((a, b) => DOMAIN_STATUS_ORDER[b.status] - DOMAIN_STATUS_ORDER[a.status])) {
    for (const driver of domain.drivers) {
      if (driver.tone !== 'critical' && driver.tone !== 'warning') continue;
      if (seen.has(driver.label)) continue;
      seen.add(driver.label);
      attention.push({ ...driver, domain: domain.label });
      if (attention.length >= limit) return attention;
    }
  }
  return attention;
}

/** Somma i driver di più domini, ordinati per gravità. */
export function mergeDrivers(lists: DomainDriver[][], limit = 8): DomainDriver[] {
  return lists
    .flat()
    .map((driver, index) => ({ driver, index }))
    .sort((a, b) => driverPriority(a.driver.tone) - driverPriority(b.driver.tone) || a.index - b.index)
    .slice(0, limit)
    .map(entry => entry.driver);
}

const clamp = (value: number, min: number, max: number): number => Math.max(min, Math.min(max, value));
export const round1 = (value: number): number => Math.round(value * 10) / 10;

/** Numero finito o `null`: il Dossier distingue «zero» da «non pubblicato». */
export function finiteOrNull(value: unknown): number | null {
  if (value === null || value === undefined || value === '') return null;
  const num = Number(value);
  return Number.isFinite(num) ? num : null;
}

/** Percentuale di una parte sul totale, con guardia contro i denominatori zero. */
export function sharePct(part: number | null, total: number | null): number | null {
  if (part === null || total === null || total <= 0) return null;
  return clamp(part / total * 100, 0, 100);
}

/**
 * Mesi di autonomia da uno stock e da un flusso **netto** mensile.
 *
 * Regole dichiarate (e testate):
 *  - saldo positivo (`net > 0`): la scorta cresce → `non critica`;
 *  - saldo nullo con scorta: la scorta non si consuma → `non critica`;
 *  - saldo nullo senza scorta: non c'è nulla da misurare → `dato non disponibile`;
 *  - saldo negativo: `scorta / |saldo|`, con tetto a 12 mesi (`>12 mesi`) perché
 *    oltre un anno la precisione non aggiunge nulla alla decisione;
 *  - dati assenti: `dato non disponibile` — mai un numero inventato.
 */
export interface AutonomyReading {
  /** Mesi esatti, `null` quando non è sensato calcolarli. */
  months: number | null;
  /** `true` quando la riserva cresce o non si consuma. */
  selfSustaining: boolean;
  text: string;
}

export function autonomyMonths(stock: number | null, netPerMonth: number | null, capMonths = 12): AutonomyReading {
  if (stock === null || netPerMonth === null) return { months: null, selfSustaining: false, text: 'dato non disponibile' };
  if (netPerMonth > 0) return { months: null, selfSustaining: true, text: 'non critica' };
  if (netPerMonth === 0) {
    return stock > 0
      ? { months: null, selfSustaining: true, text: 'non critica' }
      : { months: null, selfSustaining: false, text: 'dato non disponibile' };
  }
  const months = stock / Math.abs(netPerMonth);
  if (!Number.isFinite(months) || months <= 0) {
    return { months: 0, selfSustaining: false, text: 'esaurita' };
  }
  if (months >= capMonths) return { months, selfSustaining: false, text: `>${capMonths} mesi` };
  return { months, selfSustaining: false, text: `${months.toFixed(1).replace('.', ',')} mesi` };
}

/** Autonomia già formattata, per le schede che non hanno bisogno dei mesi. */
export function autonomyText(stock: number | null, netPerMonth: number | null): string {
  return autonomyMonths(stock, netPerMonth).text;
}
