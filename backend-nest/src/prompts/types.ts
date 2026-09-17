/**
 * World Story — Prompt Types
 * ======================
 * Типы данных для промптов LLM
 */

import type { StrictEffect } from '../core/simulation/EffectValidator';

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
  /** Identità persistente, priorità correnti e memoria canonica degli NPC rilevanti. */
  NPC_STRATEGIC_PROFILES: string;
  /** GAMEPLAY-LONG: registro strutturato degli impegni in vigore. */
  ACTIVE_COMMITMENTS: string;
  /** Processi in corso (partial) con data prevista: il simulatore deve portarli avanti. */
  ONGOING_PROCESSES?: string;
  /** Anime del governo: interessi, umori, pressioni e richieste della nazione. */
  GOVERNMENT_STATE?: string;
  /** Sfide di pace aperte (interne ed esterne) generate dal motore. */
  PEACETIME_PRESSURES?: string;
  NATION_CRISIS?: string;
  ORDER_FUNDING?: string;
  /** Contesto di reazione già filtrato dal motore: attori, vincoli e opzioni. */
  REACTION_CONTEXT?: string;

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

export type PolityReactionStance = 'supportive' | 'opposed' | 'conditional' | 'neutral';
export type PolityReactionRole = 'counterparty' | 'ally' | 'mediator' | 'observer';

/** Risposta autonoma di una politia non giocante direttamente coinvolta. */
export interface SimulationPolityReaction {
  /**
   * ID canonico del `RelevantActor` scelto nel CONTESTO DI REAZIONE.
   * Obbligatorio per le reazioni prodotte dal contratto corrente; opzionale
   * nei dati persistiti legacy, che restano leggibili senza riscritture.
   */
  actorId?: string;
  /**
   * ID canonico di UNA delle opzioni di `actorId`. Obbligatorio per le nuove
   * reazioni; il validator rifiuta un'opzione che appartiene a un altro attore.
   */
  optionId?: string;
  polityName: string;
  role: PolityReactionRole;
  stance: PolityReactionStance;
  response: string;
  /** Messaggio diretto della nazione al giocatore nel canale diplomatico (prima persona). */
  note?: string;
  /** Interesse del dossier che ha guidato la decisione. */
  priority?: string;
  /** Misura autonoma realmente decisa dalla politia nel periodo. */
  counterAction?: string;
}

export interface SimulationEvent {
  headline: string;
  description: string;
  date: string;
  mapChanges: MapChange[];
  /** Decisioni/reazioni NPC: non sono azioni eseguite dal giocatore. */
  reactions?: SimulationPolityReaction[];
}

export interface MapChange {
  type: 'transfer' | 'create' | 'update' | 'delete'
    | 'spawn_battalion' | 'move_battalion'
    | 'spawn_unit' | 'move_unit' | 'remove_unit'
    | 'start_mobilization' | 'complete_mobilization' | 'cancel_mobilization'
    | 'create_polity' | 'build_facility'
    | 'start_construction' | 'update_construction' | 'complete_construction' | 'cancel_construction';
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
  type: 'city' | 'battalion' | 'army' | 'fleet' | 'missile'
    | 'factory' | 'port' | 'base' | 'airbase' | 'naval_base'
    | 'fortification' | 'radar' | 'missile_site' | 'university'
    | 'infrastructure' | 'power_plant' | 'construction_site' | 'mobilization';
  name: string;
  /** ID opzionale per muovere/rimuovere/completare un oggetto esistente. */
  id?: string;
  x?: number;
  y?: number;
  metadata?: Record<string, any>;
}

export interface ActionOutcome {
  /** ID canonico dell'ordine: unica chiave ammessa nel nuovo protocollo. */
  actionId?: string;
  /** Etichetta legacy, accettata soltanto dall'adapter esplicito e non come chiave canonica. */
  action: string;
  status: 'accepted' | 'partial' | 'rejected';
  summary: string;
  /** Data prevista solo per processi partial, se causalmente stimabile. */
  expectedDate?: string;
  eventHeadlines?: string[];
  /** ID del progetto/processo che questo outcome conclude. */
  completesProjectId?: string;
  /** Etichetta legacy: non è usata dal percorso canonico. */
  completesProcess?: string;
}

export type DiplomaticChatKind =
  | 'meeting'
  | 'summit'
  | 'negotiation'
  | 'conference'
  | 'ultimatum'
  | 'technical'
  | 'statement';

/**
 * Canale diplomatico nato da un evento della simulazione.
 * `polityName` resta per i provider legacy; il nuovo contratto usa
 * `participants` e collega l'apertura a un dispaccio canonico.
 */
export interface SimulationChatStart {
  polityName?: string;
  participants?: string[];
  topic: string;
  kind?: DiplomaticChatKind;
  eventHeadline?: string;
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
  /** Un evento può aprire una chat diretta o una riunione multinazionale. */
  startChat?: SimulationChatStart[];
  /**
   * GAMEPLAY-LONG: impegni proposti dal modello. Il motore li valida
   * (`CommitmentService.parseModelProposals`) e resta l'autorità sullo stato.
   */
  commitments?: Array<Record<string, unknown>>;
  /** Aggiornamenti di stato sugli impegni già registrati (id esatto + status). */
  commitmentUpdates?: Array<Record<string, unknown>>;
  /** Conseguenze diplomatiche, incluse quelle negoziate nelle chat. */
  relationshipChanges?: { from: string; to: string; relationship: 'ally' | 'neutral' | 'hostile'; reason?: string }[];
  /** Per auto-jump: effettiva data d'arrivo scelta dalla simulazione */
  targetDate?: string;
  /** §7.2/T36: lo stream è terminato senza un record «complete» valido —
   * il budget non ha coperto l'intero periodo richiesto. */
  incomplete?: boolean;
  /** M06 µ3: effetti strict (ledger/project_tick/shipment/qualitative) emessi
   * dalla simulazione. In strict sono validati PRIMA di ogni mutatore. */
  effects?: StrictEffect[];
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
  /** Conserva l'identità dell'ordine attraverso conversione e simulazione. */
  actionId?: string;
  /** Indice dichiarato da un provider legacy; non è un ID canonico. */
  legacyIndex?: number;
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
