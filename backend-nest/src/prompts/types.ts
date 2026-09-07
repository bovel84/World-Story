/**
 * Open-Pax — Prompt Types
 * ======================
 * Типы данных для промптов LLM
 */

export interface PromptVariables {
  // Даты
  STARTING_ROUND_DATE: string;
  ORIGIN_ROUND_DATE: string;
  TARGET_ROUND_DATE: string;
  ORIGIN_ROUND_GRAMMATICAL_DATE: string;
  TARGET_ROUND_GRAMMATICAL_DATE: string;
  CURRENT_ROUND_NUMBER: number;

  // Мир
  WORLD_BEFORE_ROUND_ONE_TEXT: string;
  HISTORICAL_PRESET_SIMULATION_RULES: string;
  DIFFICULTY_DESCRIPTION_JUMP_FORWARD: string;

  // Игрок
  PLAYER_POLITY: string;
  PLAYER_POLITY_REGIONS: string;
  PLAYER_POLITY_BATTALION_SUMMARIES: string;

  // Действия
  PLAYER_ACTIONS_THIS_ROUND: string;
  PLAYER_EVERY_ACTION_NOT_PREVIOUS: string;

  // Карта
  GRAND_MAP_DESCRIPTION: string;
  GRAND_MAP_DESCRIPTION_NO_CITY: string;
  /** Stato materiale e diplomatico verificabile al momento del turno. */
  STRATEGIC_STATE: string;
  /** Processi in corso (partial) con data prevista: il simulatore deve portarli avanti. */
  ONGOING_PROCESSES?: string;

  // События
  ALL_EVENTS_WITH_CONSOLIDATION: string;
  CHATS_NON_CONSOLIDATED_ROUNDS: string;
  NON_CONSOLIDATED_ROUNDS_WITH_DATES: string;

  // Язык
  LANGUAGE: string;

  // Для конвертера действий
  DESCRIPTION_ACTION_TEXT?: string;
  isBeta?: boolean;
}

export interface SimulationEvent {
  headline: string;
  description: string;
  date: string;
  mapChanges: MapChange[];
}

export interface MapChange {
  type: 'transfer' | 'create' | 'update' | 'delete' | 'spawn_battalion' | 'move_battalion' | 'create_polity' | 'build_facility';
  /** Имя региона, как показано LLM в описании карты (основной способ адресации) */
  regionName?: string;
  /** Legacy: прямой id региона (принимается для совместимости) */
  regionId?: string;
  /** Имя политии-получателя (существующей или новой) */
  newOwner?: string;
  newColor?: string;
  newName?: string;
  /** Для move_battalion: куда перемещается батальон (имя региона) */
  targetRegionName?: string;
  feature?: MapFeature;
}

export interface MapFeature {
  type: 'city' | 'battalion' | 'factory' | 'port' | 'base' | 'university' | 'radar';
  name: string;
  x?: number;
  y?: number;
  metadata?: Record<string, any>;
}

export interface ActionOutcome {
  /** Copia esatta dell'ordine ricevuto, usata per associarlo al lotto. */
  action: string;
  status: 'accepted' | 'partial' | 'rejected';
  summary: string;
  /** Data prevista solo per processi partial, se causalmente stimabile. */
  expectedDate?: string;
  eventHeadlines?: string[];
  /** Titolo del processo in corso che questo ordine completa (anche riformulato). */
  completesProcess?: string;
}

export interface SimulationResult {
  events: SimulationEvent[];
  narration: string;
  diplomacy: DiplomacyChat[];
  worldChanges: WorldChanges;
  /** Esiti uno-a-uno degli ordini del lotto. */
  actionOutcomes?: ActionOutcome[];
  /** Нереалистичные действия игрока, отклонённые simulaцией, с пояснением */
  voided: VoidedAction[];
  /** ИИ инициирует дипломатический чат. */
  startChat?: { polityName: string; topic: string }[];
  /** Conseguenze diplomatiche, incluse quelle negoziate nelle chat. */
  relationshipChanges?: { from: string; to: string; relationship: 'ally' | 'neutral' | 'hostile'; reason?: string }[];
  /** Для auto-jump: фактическая целевая дата, выбранная симуляцией */
  targetDate?: string;
}

/** Действие игрока, отклонённое как нереалистичное («захватить мир за день») */
export interface VoidedAction {
  action: string;
  reason: string;
}

export interface DiplomacyChat {
  round: number;
  participants: string[];
  messages: ChatMessage[];
}

export interface ChatMessage {
  from: string;
  text: string;
}

export interface WorldChanges {
  regionOwners: Record<string, string>;
  regionColors: Record<string, string>;
  newFeatures: MapFeature[];
  deletedFeatures: string[];
}

export interface ConvertedAction {
  type: 'action' | 'chat';
  text: string;
  targetPolity?: string;
  chatMessage?: string;
}

export interface Suggestion {
  topic: string;
  description: string;
  actions: {
    title: string;
    content: string;
  }[];
}

export interface AdvisorMessage {
  role: 'user' | 'assistant';
  content: string;
}
