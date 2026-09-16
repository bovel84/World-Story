/**
 * World Story — HistoryService
 * ============================
 * Consolidamento LLM della cronaca dei primi turni (Fase 1: estratto da
 * `game-session.ts`). Quando i round coperti superano `consolidation.chunkSize`,
 * il riassunto canonico viene riscritto e persistito; i prompt ricevono
 * riassunto + coda grezza.
 *
 * Lo **stato** (`consolidatedHistory`, `consolidatedUpTo`, `results`,
 * `currentTurn`) è posseduto da `SessionStateStore`.
 */

import { gameRepository } from '../repositories';
import type { SessionStateStore } from './SessionStateStore';

export interface HistoryContext {
  gameId: string;
  state: SessionStateStore;
  llm: any;
}

export class HistoryService {
  constructor(private readonly ctx: HistoryContext) {}

  private get state(): SessionStateStore { return this.ctx.state; }

  /**
   * Консолидация истории (механика оригинала): когда раундов накопилось
   * больше consolidation.chunkSize поверх consolidatedUpTo — LLM-саммари
   * старых раундов дописывается в consolidated_history, а в промпты
   * подаётся саммари + сырой хвост последних раундов.
   */
  async maybeConsolidate(): Promise<void> {
    const cfg = this.ctx.llm.consolidation;
    const lastTurn = this.state.currentTurn - 1;
    if (lastTurn < cfg.startRound) return;
    if (lastTurn - this.state.consolidatedUpTo < cfg.chunkSize) return;

    const toSummarize = this.state.results.filter(
      r => r.turn > this.state.consolidatedUpTo && r.turn <= lastTurn
    );
    if (toSummarize.length === 0) return;

    console.log(`[GameSession] Consolidating rounds ${this.state.consolidatedUpTo + 1}..${lastTurn} (${toSummarize.length} turni)`);

    const system = 'Sei il cronista di un gioco strategico. Condensa la storia mantenendo i fatti, scrivendo in italiano.';
    const user = `Qui sotto c'è la cronaca dei turni già vissuti di un gioco strategico (turni ${this.state.consolidatedUpTo + 1}–${lastTurn}).
${this.state.consolidatedHistory ? `\n[Cronaca già consolidata dei turni precedenti]\n${this.state.consolidatedHistory}\n` : ''}
[Nuovi turni da condensare]
${toSummarize.map(r => `Turno ${r.turn}: ${r.narration}`).join('\n\n')}

Condensa TUTTA la storia in una MEMORIA CANONICA di massimo 220 parole, in italiano.
Usa frasi fattuali e dense, senza stile letterario. Conserva sempre: cambi di proprietà delle regioni,
guerre e trattati di pace, alleanze, decisioni chiave del giocatore, impegni ancora aperti e conseguenze.
Non inventare nuovi fatti né statistiche. Il riassunto sarà l'unica memoria remota passata ai turni futuri.`;

    const res = await this.ctx.llm.generate('consolidation', system, user, { temperature: 0.2, maxTokens: 900 });
    this.state.consolidatedHistory = res.content;
    this.state.consolidatedUpTo = lastTurn;
    gameRepository.updateConsolidation(this.ctx.gameId, this.state.consolidatedHistory, this.state.consolidatedUpTo);
    console.log('[HistoryService] Consolidated history updated, length:', this.state.consolidatedHistory.length);
  }
}
