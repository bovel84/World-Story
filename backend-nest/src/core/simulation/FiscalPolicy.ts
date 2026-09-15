/**
 * World Story — Politica fiscale del giocatore
 * ============================================
 * Il prelievo non è più un numero deciso dal motore: il giocatore sceglie la
 * pressione fiscale complessiva (% del PIL) e ne paga le conseguenze. Qui
 * vivono i limiti, gli effetti sociali ed economici e le descrizioni: il
 * motore applica, la UI mostra, i prompt raccontano.
 *
 * Il riferimento **neutro** (10% del PIL) è un ancoraggio di gioco, ma gli
 * effetti concreti si misurano rispetto all'aliquota che il paese applicherebbe
 * da sé (profilo di fabbriche e porti): sotto si alleggerisce il paese ma si
 * incassa meno, sopra si finanzia lo Stato ma la piazza e l'industria
 * protestano. Gli effetti sono lineari e dichiarati, così il giocatore può
 * ragionare sul trade-off.
 */

export const FISCAL_NEUTRAL_PCT = 10;
export const FISCAL_MIN_PCT = 4;
export const FISCAL_MAX_PCT = 45;

export interface FiscalPolicy {
  /** Pressione fiscale scelta, in percentuale del PIL. */
  taxRatePct: number;
}

export const DEFAULT_FISCAL_POLICY: FiscalPolicy = { taxRatePct: FISCAL_NEUTRAL_PCT };

const round = (value: number, digits = 1): number => {
  const factor = 10 ** digits;
  // `+ 0` normalizza il negativo zero: `-0` non deve trapelare nelle cifre.
  return Math.round(value * factor) / factor + 0;
};

/** Normalizza un'aliquota nei limiti di gioco (default: riferimento neutro). */
export function clampTaxRatePct(value: unknown): number {
  const number = Number(value);
  if (!Number.isFinite(number)) return FISCAL_NEUTRAL_PCT;
  return round(Math.max(FISCAL_MIN_PCT, Math.min(FISCAL_MAX_PCT, number)));
}

export interface FiscalEffects {
  /** Variazione di stabilità rispetto al riferimento neutro (punti 0-100). */
  stabilityDelta: number;
  /** Variazione di tensione sociale (punti 0-100). */
  tensionDelta: number;
  /** Variazione del tasso di crescita annuo (frazione, es. -0.006 = -0.6%). */
  growthDelta: number;
}

/**
 * Effetti dello scostamento dal livello di riferimento (di norma l'aliquota
 * che il paese applicherebbe da sé). Lineari e trasparenti: +10 punti di
 * pressione costano 12 punti di stabilità, 9 di tensione e 0,6% di crescita;
 * il contrario vale per una riduzione.
 *
 * Il consenso è volutamente più sensibile del riequilibrio di cassa: alzare le
 * tasse migliora il saldo ma costa più stabilità di quanta ne compri, così la
 * scelta resta un dilemma e non una salita gratuita.
 */
export function fiscalEffects(taxRatePct: number, referencePct: number = FISCAL_NEUTRAL_PCT): FiscalEffects {
  const delta = clampTaxRatePct(taxRatePct) - clampTaxRatePct(referencePct);
  return {
    stabilityDelta: round(-delta * 1.2),
    tensionDelta: round(delta * 0.9),
    growthDelta: round(-delta * 0.0006, 4),
  };
}

/**
 * Costo politico **transitorio** di una manovra: cambiare le tasse di colpo
 * scontenta anche chi ci guadagna (incertezza, aspettative). Va applicato una
 * volta sola, come modificatore che poi decade. Nullo sotto i 2 punti.
 */
export function fiscalShockModifier(
  previousPct: number,
  nextPct: number,
): { stabilityDelta: number; tensionDelta: number } {
  const change = Math.abs(clampTaxRatePct(nextPct) - clampTaxRatePct(previousPct));
  if (change < 2) return { stabilityDelta: 0, tensionDelta: 0 };
  return {
    stabilityDelta: -round(Math.min(10, change * 0.35)),
    tensionDelta: round(Math.min(12, change * 0.5)),
  };
}

/** Etichetta breve del livello di prelievo. */
export function fiscalLabel(taxRatePct: number): string {
  const value = clampTaxRatePct(taxRatePct);
  if (value <= 6) return 'Prelievo minimo';
  if (value <= 11) return 'Prelievo contenuto';
  if (value <= 18) return 'Prelievo moderato';
  if (value <= 28) return 'Prelievo alto';
  return 'Prelievo molto alto';
}

/** Righe leggibili sugli effetti della manovra, per UI e prompt. */
export function describeFiscalEffects(taxRatePct: number, referencePct: number = FISCAL_NEUTRAL_PCT): string[] {
  const value = clampTaxRatePct(taxRatePct);
  const effects = fiscalEffects(value, referencePct);
  const sign = (amount: number) => `${amount > 0 ? '+' : ''}${amount}`;
  return [
    `Entrate pubbliche circa ${Math.round(value)}% del PIL (${fiscalLabel(value).toLowerCase()})`,
    `Stabilità ${sign(effects.stabilityDelta)} punti · tensione ${sign(effects.tensionDelta)} punti`,
    `Crescita annua ${sign(round(effects.growthDelta * 100, 1))}%`,
  ];
}
