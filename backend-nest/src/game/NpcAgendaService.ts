/**
 * World Story — Agenda strategica degli NPC (servizio)
 * ====================================================
 * Tiene il ciclo di vita degli obiettivi: legge l'agenda corrente dal database,
 * la rivede con lo stato del mondo, scrive **solo quando cambia qualcosa** e la
 * espone al dossier del turno e alle chat diplomatiche.
 *
 * Una revisione per avanzamento (non per prompt): la strategia resta stabile e
 * il costo è nullo in termini di chiamate LLM.
 */
import { npcAgendaRepository } from '../repositories';
import {
  describeAgenda, deriveObjectiveSeeds, reviewAgenda,
  type NpcAgendaContext, type NpcAgendaProfile, type NpcObjective,
} from '../core/simulation/NpcAgenda';

export interface NpcAgendaTarget {
  polityId: string;
  profile?: NpcAgendaProfile | null;
  context: NpcAgendaContext;
}

export interface NpcAgendaRefreshResult {
  /** Obiettivi attivi dopo la revisione, per polity. */
  active: Record<string, NpcObjective[]>;
  opened: NpcObjective[];
  closed: NpcObjective[];
  /** Righe scritte (0 = agenda già coerente con lo stato). */
  written: number;
}

export class NpcAgendaService {
  constructor(private readonly ctx: {
    gameId: string;
    currentDate(): string;
    currentTurn(): number;
    isStrictGame(): boolean;
  }) {}

  /** Agenda corrente di una o più polity (solo lettura). */
  agendaFor(polityIds?: readonly string[]): Record<string, NpcObjective[]> {
    if (this.ctx.isStrictGame()) return {};
    try {
      const all = npcAgendaRepository.list(this.ctx.gameId, { activeOnly: true });
      const wanted = polityIds ? new Set(polityIds) : null;
      const grouped: Record<string, NpcObjective[]> = {};
      for (const objective of all) {
        if (wanted && !wanted.has(objective.polityId)) continue;
        (grouped[objective.polityId] ??= []).push(objective);
      }
      return grouped;
    } catch (error) {
      console.warn('[NpcAgendaService] Agenda non leggibile:', error);
      return {};
    }
  }

  /** Blocco pronto per il prompt di una polity. */
  describe(polityId: string): string {
    return describeAgenda(this.agendaFor([polityId])[polityId]);
  }

  /**
   * Rivede l'agenda delle polity indicate. Idempotente: chiamarla due volte
   * nello stesso turno non duplica obiettivi né versioni.
   */
  refresh(targets: readonly NpcAgendaTarget[]): NpcAgendaRefreshResult {
    const empty: NpcAgendaRefreshResult = { active: {}, opened: [], closed: [], written: 0 };
    if (this.ctx.isStrictGame() || targets.length === 0) return empty;
    const date = this.ctx.currentDate();
    const turn = this.ctx.currentTurn();
    try {
      const stored = npcAgendaRepository.list(this.ctx.gameId);
      const byPolity = new Map<string, NpcObjective[]>();
      for (const objective of stored) {
        const list = byPolity.get(objective.polityId) ?? [];
        list.push(objective);
        byPolity.set(objective.polityId, list);
      }
      const active: Record<string, NpcObjective[]> = {};
      const opened: NpcObjective[] = [];
      const closed: NpcObjective[] = [];
      for (const target of targets) {
        const current = byPolity.get(target.polityId) ?? [];
        const seeds = deriveObjectiveSeeds(target.profile ?? null, target.context);
        const review = reviewAgenda(current, seeds, target.context, {
          polityId: target.polityId, date, turn,
        });
        active[target.polityId] = review.active;
        opened.push(...review.opened);
        closed.push(...review.closed);
        // Solo i cambiamenti visibili producono una nuova versione: l'agenda
        // non cresce di una riga a ogni turno.
        const toAppend: NpcObjective[] = [...review.opened, ...review.closed];
        if (review.changed) {
          toAppend.push(...review.active.filter(objective => {
            const previous = current.find(item => item.id === objective.id);
            return !previous || previous.reviewedTurn !== objective.reviewedTurn
              || previous.progress !== objective.progress
              || previous.priority !== objective.priority
              || previous.description !== objective.description;
          }));
        }
        npcAgendaRepository.appendMany(this.ctx.gameId, toAppend);
      }
      return { active, opened, closed, written: opened.length + closed.length };
    } catch (error) {
      console.warn('[NpcAgendaService] Revisione dell’agenda non riuscita:', error);
      return empty;
    }
  }

  /** Potatura del rewind: le versioni scritte dopo il turno ripristinato spariscono. */
  pruneAfterTurn(turn: number): number {
    try {
      return npcAgendaRepository.pruneAfterTurn(this.ctx.gameId, turn);
    } catch (error) {
      console.warn('[NpcAgendaService] Potatura dell’agenda non riuscita:', error);
      return 0;
    }
  }

  /** Chi ha un'agenda attiva: serve a cronaca e briefing. */
  summarizeOpened(objectives: readonly NpcObjective[]): string[] {
    return objectives.map(objective => `${objective.polityId}: ${objective.description}`);
  }
}
