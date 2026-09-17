/**
 * World Story — Strategie delle potenze (frontend, puro)
 * ======================================================
 * Il motore pubblica gli obiettivi persistenti delle polity non giocanti
 * (descrizione, priorità, progresso, motivo, data di nascita). Qui si scelgono
 * solo le parole e i toni: nessuna stima, nessuna strategia inventata dal client.
 */
import type { PowerAgenda, StrategicObjective } from '../../services/api';

export type AgendaTone = 'critical' | 'warning' | 'neutral' | 'positive';

/** Quanto pesa un obiettivo, in una parola. */
export function objectivePriorityLabel(priority: number): string {
  if (priority >= 3) return 'decisivo';
  if (priority === 2) return 'rilevante';
  return 'di contorno';
}

export function objectivePriorityTone(priority: number): AgendaTone {
  if (priority >= 3) return 'critical';
  if (priority === 2) return 'warning';
  return 'neutral';
}

/** Il progresso racconta l'avvicinamento, non il successo. */
export function objectiveProgressTone(progress: number): AgendaTone {
  if (progress >= 75) return 'positive';
  if (progress >= 40) return 'neutral';
  if (progress >= 15) return 'warning';
  return 'critical';
}

/** Riga pronta: «decisivo · progresso 40% · dal 12 mar 1815». */
export function objectiveSummary(objective: StrategicObjective): string {
  const parts = [objectivePriorityLabel(objective.priority), `progresso ${Math.round(objective.progress)}%`];
  if (objective.since) parts.push(`dal ${formatAgendaDate(objective.since)}`);
  return parts.join(' · ');
}

/** Data breve in italiano; se non è leggibile, la stringa originale. */
export function formatAgendaDate(value: string): string {
  const time = Date.parse(`${String(value ?? '').slice(0, 10)}T00:00:00Z`);
  if (!Number.isFinite(time)) return String(value ?? '');
  const date = new Date(time);
  const months = ['gen', 'feb', 'mar', 'apr', 'mag', 'giu', 'lug', 'ago', 'set', 'ott', 'nov', 'dic'];
  return `${date.getUTCDate()} ${months[date.getUTCMonth()]} ${date.getUTCFullYear()}`;
}

/**
 * Ordina le potenze per quanto la loro agenda tocca il giocatore: prima gli
 * obiettivi che nominano la polity del giocatore o sono decisivi. Nessun
 * riordino casuale: a parità, l'ordine alfabetico del motore.
 */
export function rankPowerAgendas(
  agenda: { powers?: PowerAgenda[] | null } | null | undefined,
  playerPolityId?: string | null,
): PowerAgenda[] {
  const powers = Array.isArray(agenda?.powers) ? [...agenda!.powers] : [];
  const score = (power: PowerAgenda): number => {
    let value = 0;
    for (const objective of power.objectives ?? []) {
      value += objective.priority * 3;
      if (objective.progress >= 0) value += 0;
      if (playerPolityId && `${objective.description} ${objective.reason}`.includes(playerPolityId)) value += 6;
    }
    return value;
  };
  return powers.sort((a, b) => score(b) - score(a) || a.name.localeCompare(b.name));
}

/** Le potenze che hanno davvero qualcosa in corso (il resto non merita spazio). */
export function agendasWithObjectives(
  agenda: { powers?: PowerAgenda[] | null } | null | undefined,
  playerPolityId?: string | null,
): PowerAgenda[] {
  return rankPowerAgendas(agenda, playerPolityId)
    .map(power => ({ ...power, objectives: (power.objectives ?? []).filter(Boolean) }))
    .filter(power => power.objectives.length > 0);
}

/**
 * La strategia più urgente di una potenza, per il briefing: descrizione,
 * priorità, progresso, motivo. Una riga sola (P2: non un secondo dossier).
 */
export function agendaBriefingDetail(power: PowerAgenda): string {
  const top = [...(power.objectives ?? [])].sort((a, b) => b.priority - a.priority)[0];
  if (!top) return '';
  return `${top.description} · ${objectiveSummary(top)} · motivo: ${top.reason}`;
}

/** La potenza con la strategia più urgente, se ne ha una decisiva. */
export function mostUrgentAgenda(
  agenda: { powers?: PowerAgenda[] | null } | null | undefined,
  playerPolityId?: string | null,
): PowerAgenda | null {
  const scored = agendasWithObjectives(agenda, playerPolityId)
    .map(power => ({ power, top: Math.max(0, ...power.objectives.map(item => item.priority)) }))
    .filter(entry => entry.top >= 3)
    .sort((a, b) => b.top - a.top || a.power.name.localeCompare(b.power.name));
  return scored[0]?.power ?? null;
}

/** Riga unica per il briefing: «Francia: stabilizzare l'economia (decisivo)». */
export function agendaBriefingLine(power: PowerAgenda): string {
  const top = [...(power.objectives ?? [])].sort((a, b) => b.priority - a.priority)[0];
  return top ? `${power.name}: ${top.description} (${objectivePriorityLabel(top.priority)})` : power.name;
}
