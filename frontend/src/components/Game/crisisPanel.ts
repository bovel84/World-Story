/**
 * World Story — Presentazione della crisi nazionale
 * =================================================
 * Il Dossier non inventa: traduce in etichette e toni i punteggi già calcolati
 * dal motore. Qui vivono le mappe e le frasi derivate, così il pannello resta
 * leggibile e testabile senza montare React.
 */

import type { CrisisDimension, CrisisLevel, CrisisRisk } from '../../services/api';

export const CRISIS_LEVEL_LABEL: Record<CrisisLevel, string> = {
  calm: 'Calmo',
  watch: 'Allarme',
  critical: 'Critico',
};

export const CRISIS_DIMENSION_LABEL: Record<CrisisDimension, string> = {
  revolt: 'Rivolta interna',
  insolvency: 'Default sul debito',
  invasion: 'Invasione straniera',
};

export type CrisisTone = 'positive' | 'warning' | 'negative';

/** Tono semantico della dimensione: verde se calma, ambra in allarme, rosso se critica. */
export function crisisLevelTone(level: CrisisLevel): CrisisTone {
  if (level === 'critical') return 'negative';
  if (level === 'watch') return 'warning';
  return 'positive';
}

/**
 * Frase sui giorni di criticità accumulati. La crisi avanza col tempo
 * trascorso: solo una dimensione critica accumula giorni verso il collasso,
 * l'allarme logora più lentamente e la calma consuma l'arretrato.
 */
export function crisisDaysText(risk: CrisisRisk, days: number, collapseDays: number): string {
  const safeDays = Math.max(0, Math.floor(Number(days) || 0));
  const limit = Math.max(1, Math.floor(Number(collapseDays) || 1));
  if (risk.level === 'critical') {
    if (safeDays >= limit) {
      return `${safeDays}/${limit} giorni di criticità: la nazione è a un passo dal collasso.`;
    }
    return safeDays > 0
      ? `${safeDays}/${limit} giorni di criticità: il tempo gioca contro di noi.`
      : `La crisi è appena iniziata: ${limit} giorni di criticità portano al collasso.`;
  }
  if (risk.level === 'watch') {
    return safeDays > 0
      ? `Allarme da ${safeDays} giorni: va corretto prima che diventi critico.`
      : 'Allarme: va corretto prima che diventi critico.';
  }
  // In calma l'arretrato si consuma: mostrarlo dice al giocatore che sta recuperando.
  return safeDays > 0 ? `Recupero in corso: ${safeDays} giorni di criticità ancora da smaltire.` : '';
}

/** Quante dimensioni sono critiche: serve all'HUD per un colpo d'occhio. */
export function criticalCount(risks: CrisisRisk[]): number {
  return risks.filter(risk => risk.level === 'critical').length;
}
