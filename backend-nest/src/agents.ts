/**
 * World Story — Game Agents
 * ======================
 * GameController: фасад над PromptEngine (конвертер действий, симуляция,
 * советник, подсказки) и NPC-агентами.
 *
 * Legacy-агенты (CountryAgent/WorldAgent/AdvisorAgent/TurnControllerAgent и
 * детерминированный processTurn) удалены на этапе стабилизации: они не
 * вызывались ниоткуда, кроме самих себя.
 */

import { LLMRouter } from './llm';
import { NPCCountryAgent, NPCCountryContext, createNPCCountries, type NPCAction } from './npc-agents';
import { PromptEngine } from './prompt-builder';
import type { SimulationEvent } from './prompts/types';
import type { StrictEffect } from './core/simulation/EffectValidator';
import { prepareSimulationGameData } from './prompts/strict-simulation';

// Compatibility re-export for tests and callers that imported these helpers
// from agents.ts before the strict contract was split into its own module.
export {
  STRICT_SIMULATION_CONTRACT,
  withStrictSimulationContract,
} from './prompts/strict-simulation';

export class GameController {
  private provider: LLMRouter;
  private npcAgents: Map<string, NPCCountryAgent> = new Map();
  private worldPrompt: string = '';
  private promptEngine: PromptEngine | null = null;

  constructor(provider: LLMRouter) {
    this.provider = provider;
  }

  /**
   * Инициализировать PromptEngine для игры
   */
  initPromptEngine(gameData: any): void {
    this.promptEngine = new PromptEngine(this.provider);
    console.log('[GameController] PromptEngine initialized');
  }

  /**
   * Обработать ход используя промпты (converter → simulation time-rewind)
   */
  async processTurnWithPrompts(
    gameData: any,
    actions: Array<{ actionId: string; text: string }>,
    jumpDays: number,
    onProgress?: (charsSoFar: number) => void,
    autoJump?: boolean,
    onEvent?: (event: SimulationEvent, index: number) => void,
    signal?: AbortSignal,
  ): Promise<{
    narration: string;
    events: SimulationEvent[];
    worldChanges: any;
    convertedActions: any[];
    actionOutcomes?: Array<{
      action: string;
      status: 'accepted' | 'partial' | 'rejected';
      summary: string;
      expectedDate?: string;
      eventHeadlines?: string[];
      completesProjectId?: string;
      completesProcess?: string;
    }>;
    voided?: { action: string; reason: string }[];
    startChat?: { polityName: string; topic: string }[];
    relationshipChanges?: { from: string; to: string; relationship: 'ally' | 'neutral' | 'hostile'; reason?: string }[];
    targetDate?: string;
    /** §7.2/T36: lo stream è terminato senza record complete (budget). */
    incomplete?: boolean;
    /** M06 µ3: effetti strict emessi dalla simulazione, validati nel run. */
    effects?: StrictEffect[];
  }> {
    if (!this.promptEngine) {
      this.initPromptEngine(gameData);
    }

    console.log('[GameController] Processing turn with prompts:', { actions, jumpDays, count: actions.length });

    // 1. Конвертируем действия (batch — 1 LLM-вызов вместо N)
    const convertedActions = await this.promptEngine!.convertActionsBatch(gameData, actions, signal);
    console.log('[GameController] Converted', convertedActions.length, 'actions via batch LLM call');

    // Strict mode adds a prompt-only contract. The server validator remains
    // authoritative and runs after the provider response in GameSession.
    const simulationGameData = await prepareSimulationGameData(gameData);

    // 2. Запускаем симуляцию (time-rewind) со стримингом прогресса генерации
    const simulationResult = await this.promptEngine!.runSimulation(
      simulationGameData,
      convertedActions.map(action => ({
        actionId: action.actionId || '',
        text: action.text,
      })),
      jumpDays,
      onProgress,
      autoJump,
      onEvent,
      signal,
    );

    console.log('[GameController] Simulation result:', simulationResult.narration.substring(0, 100));

    return {
      narration: simulationResult.narration,
      // Полные события (с mapChanges) — движок применяет их к карте
      events: simulationResult.events,
      worldChanges: simulationResult.worldChanges,
      convertedActions,
      actionOutcomes: simulationResult.actionOutcomes,
      voided: simulationResult.voided,
      startChat: simulationResult.startChat,
      relationshipChanges: simulationResult.relationshipChanges,
      targetDate: simulationResult.targetDate,
      incomplete: simulationResult.incomplete,
      effects: simulationResult.effects,
    };
  }

  /**
   * G24 — riformula un singolo ordine libero (anteprima, senza accodare).
   */
  async enhanceAction(gameData: any, text: string): Promise<{ text: string }> {
    if (!this.promptEngine) {
      this.initPromptEngine(gameData);
    }
    const converted = await this.promptEngine!.convertAction(gameData, text);
    return { text: converted.text };
  }

  /**
   * Получить советы через advisor.md
   */
  async getAdvisorWithPrompts(gameData: any, message: string, history: any[] = []): Promise<string> {
    if (!this.promptEngine) {
      this.initPromptEngine(gameData);
    }

    return this.promptEngine!.getAdvisor(gameData, message, history);
  }

  /**
   * Стриминговая версия советника (Этап 3): прогресс генерации приходит
   * в onToken (счётчик символов, конвенция LLMRouter.stream),
   * возвращается полный текст ответа.
   */
  async getAdvisorStreamWithPrompts(
    gameData: any,
    message: string,
    history: any[] = [],
    onToken: (charsSoFar: number) => void
  ): Promise<string> {
    if (!this.promptEngine) {
      this.initPromptEngine(gameData);
    }

    return this.promptEngine!.getAdvisorStream(gameData, message, history, onToken);
  }

  /**
   * Получить предложения через actions.md
   */
  async getSuggestionsWithPrompts(gameData: any): Promise<any[]> {
    if (!this.promptEngine) {
      this.initPromptEngine(gameData);
    }

    return this.promptEngine!.getSuggestions(gameData);
  }

  setupWorld(worldPrompt: string): void {
    this.worldPrompt = worldPrompt;
  }

  /**
   * Setup NPC countries from world configuration
   */
  setupNPCCountries(regionConfigs: { id: string; name: string; owner: string }[]): void {
    this.npcAgents = createNPCCountries(this.provider, regionConfigs);
  }

  /**
   * Process turn for a single NPC country
   */
  async processNPCTurn(
    regionId: string,
    context: NPCCountryContext
  ): Promise<NPCAction | null> {
    const npcAgent = this.npcAgents.get(regionId);
    if (!npcAgent) {
      return null;
    }

    return npcAgent.think(context);
  }

  /**
   * Get all NPC countries
   */
  getNPCCountries(): string[] {
    return Array.from(this.npcAgents.keys());
  }
}
