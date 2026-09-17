/**
 * World Story — Registro degli impegni (frontend, puro)
 * =====================================================
 * Il motore pubblica gli impegni con tipo, stato, scadenza e importanza. Qui si
 * scelgono parole e toni: nessuna scadenza, nessuno stato e nessuna importanza
 * vengono calcolati nel browser.
 */
import type { Commitment } from '../../services/api';

export type CommitmentTone = 'critical' | 'warning' | 'neutral' | 'positive';

export const COMMITMENT_TYPE_LABEL: Record<string, string> = {
  treaty: 'Trattato',
  promise: 'Promessa',
  guarantee: 'Garanzia',
  ultimatum: 'Ultimatum',
  'trade-agreement': 'Accordo commerciale',
  'territorial-access': 'Accesso territoriale',
  ceasefire: 'Cessate il fuoco',
  'military-commitment': 'Impegno militare',
  'future-obligation': 'Obbligo futuro',
};

export const COMMITMENT_STATUS_LABEL: Record<string, string> = {
  active: 'in vigore',
  fulfilled: 'onorato',
  broken: 'tradito',
  expired: 'decaduto',
  superseded: 'sostituito',
};

export function commitmentTypeLabel(type: string): string {
  return COMMITMENT_TYPE_LABEL[type] ?? type;
}

export function commitmentStatusLabel(status: string): string {
  return COMMITMENT_STATUS_LABEL[status] ?? status;
}

/** Il tono dice quanto pesa: un impegno tradito o scaduto è un fatto negativo. */
export function commitmentTone(commitment: Pick<Commitment, 'status' | 'importance'>): CommitmentTone {
  if (commitment.status === 'broken') return 'critical';
  if (commitment.status === 'fulfilled') return 'positive';
  if (commitment.status === 'expired') return 'warning';
  if (commitment.status === 'superseded') return 'neutral';
  return commitment.importance >= 3 ? 'warning' : 'neutral';
}

/** Giorni fra due date ISO (0 se non leggibili). Il tempo lo detta il motore. */
export function daysUntil(deadline: string | null | undefined, today: string): number | null {
  if (!deadline) return null;
  const target = Date.parse(`${String(deadline).slice(0, 10)}T00:00:00Z`);
  const now = Date.parse(`${String(today ?? '').slice(0, 10)}T00:00:00Z`);
  if (!Number.isFinite(target) || !Number.isFinite(now)) return null;
  return Math.round((target - now) / 86_400_000);
}

/** Riga di tempo: scadenza, giorni rimasti o età dell'impegno. */
export function commitmentTimingText(
  commitment: Pick<Commitment, 'status' | 'deadline' | 'createdDate'>,
  today: string,
): string {
  const left = daysUntil(commitment.deadline, today);
  if (left === null) {
    return commitment.createdDate ? `dal ${formatCommitmentDate(commitment.createdDate)}` : '';
  }
  if (left < 0) return `scaduto il ${formatCommitmentDate(commitment.deadline!)}`;
  if (left === 0) return 'scade oggi';
  return `scade fra ${left} ${left === 1 ? 'giorno' : 'giorni'}`;
}

/** Data breve in italiano. */
export function formatCommitmentDate(value: string): string {
  const time = Date.parse(`${String(value ?? '').slice(0, 10)}T00:00:00Z`);
  if (!Number.isFinite(time)) return String(value ?? '');
  const date = new Date(time);
  const months = ['gen', 'feb', 'mar', 'apr', 'mag', 'giu', 'lug', 'ago', 'set', 'ott', 'nov', 'dic'];
  return `${date.getUTCDate()} ${months[date.getUTCMonth()]} ${date.getUTCFullYear()}`;
}

/** Chi ha preso l'impegno, verso chi. */
export function commitmentPartiesText(commitment: Pick<Commitment, 'actor' | 'counterparty'>): string {
  return commitment.counterparty ? `${commitment.actor} → ${commitment.counterparty}` : `${commitment.actor} (interno)`;
}

/**
 * Ordina gli impegni per rilevanza **vista dal giocatore**: prima quelli in
 * vigore con scadenza vicina, poi i traditi/decaduti, poi la storia.
 */
export function sortCommitments(commitments: readonly Commitment[] | null | undefined, today: string): Commitment[] {
  const rank = (commitment: Commitment): number => {
    if (commitment.status === 'active') {
      const left = daysUntil(commitment.deadline, today);
      if (left !== null && left <= 30) return 0;
      if (commitment.importance >= 3) return 1;
      return 2;
    }
    if (commitment.status === 'broken') return 3;
    if (commitment.status === 'expired') return 4;
    if (commitment.status === 'fulfilled') return 5;
    return 6;
  };
  return [...(commitments ?? [])].sort((a, b) =>
    rank(a) - rank(b)
    || b.importance - a.importance
    || (b.createdTurn ?? 0) - (a.createdTurn ?? 0)
    || a.id.localeCompare(b.id));
}

/** Gli impegni ancora in vigore: la parte che vincola le decisioni. */
export function activeCommitmentsOf(commitments: readonly Commitment[] | null | undefined): Commitment[] {
  return (commitments ?? []).filter(commitment => commitment.status === 'active');
}

/** Riga per il briefing: «Ultimatum ITA → AUT: … (scade fra 12 giorni)». */
export function commitmentBriefingLine(commitment: Commitment, today: string): string {
  const timing = commitmentTimingText(commitment, today);
  return `${commitmentTypeLabel(commitment.type)} ${commitmentPartiesText(commitment)}: ${commitment.description}${timing ? ` · ${timing}` : ''}`;
}
