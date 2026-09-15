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
 * Frase sulla serie di criticità. Solo una dimensione critica accumula turni
 * verso il collasso; l'allarme è un avvertimento senza contatore.
 */
export function crisisStreakText(risk: CrisisRisk, streak: number, collapseStreak: number): string {
  const safeStreak = Math.max(0, Math.floor(Number(streak) || 0));
  const limit = Math.max(1, Math.floor(Number(collapseStreak) || 1));
  if (risk.level === 'critical') {
    return safeStreak > 0
      ? `${safeStreak}/${limit} turni di criticità: all'ultimo la nazione cade.`
      : 'Un turno critico in più e la nazione è a un passo dal collasso.';
  }
  if (risk.level === 'watch') {
    return 'Allarme: va corretto prima che diventi critico.';
  }
  return '';
}

/** Quante dimensioni sono critiche: serve all'HUD per un colpo d'occhio. */
export function criticalCount(risks: CrisisRisk[]): number {
  return risks.filter(risk => risk.level === 'critical').length;
}
