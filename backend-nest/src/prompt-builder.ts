/**
 * World Story — Prompt Builder
 * =========================
 * Сервис для построения переменных промптов
 */

import { PromptVariables, SimulationResult, SimulationEvent, ConvertedAction, Suggestion, AdvisorMessage, ActionOutcome, difficultyPromptBlock, normalizeDifficulty } from './prompts';
import {
  buildSimulationPrompt,
  buildConstrainedSimulationPrompt,
  buildAutoJumpInstruction,
  buildCausalityGuard,
  buildSimulationNarrativeContract,
  buildIncrementalOutputInstruction,
  extractCompleteJsonObjects,
  parseIncrementalSimulationRecord,
  parseIncrementalSimulationResponse,
} from './prompts/simulation';
import { buildAdvisorPrompt, parseAdvisorResponse, buildAdvisorDialogSuffix } from './prompts/advisor';
import { buildSuggestionsPrompt, buildSuggestionsQualityInstruction, parseSuggestionsResponse } from './prompts/suggestions';
import { buildConverterPrompt, parseConverterResponse, buildBatchConverterPrompt, parseBatchConverterResponse } from './prompts/converter';
import { buildNarrationPrompt, parseNarrationResponse } from './prompts/narration';
import { buildNarrativeMemory } from './prompts/narrative-memory';
import { buildNationalDecisionContext, buildActionElaborationGuard } from './prompts/national-context';
import { addDays, formatItalianDate } from './core/simulation/calendar';
import { getPromptOverride, renderPromptTemplate, PromptOverrides } from './prompts/override';
import { LLMError, LLMRouter } from './llm';

interface GameData {
  id: string;
  currentDate: string;
  currentTurn: number;
  /** Сложность игры (Этап 2) */
  difficulty?: string;
  /** Консолидированная история ранних раундов (Этап 2) */
  consolidatedHistory?: string;
  /** Сколько последних раундов держать сырыми при консолидации */
  consolidationTail?: number;
  /** Этап 3: предформатированные транскрипты дипломатических чатов */
  chatTranscripts?: string;
  /** Этап 5: кастомные правила симуляции мира (rules.md пресет-пакета) */
  simulationRules?: string;
  /** In strict gli errori di protocollo restano fail-closed, senza adapter. */
  strictMode?: boolean;
  /** Переопределённые промпты мира (секция "prompts" пресета; объект или JSON-строка) */
  prompts?: PromptOverrides | string | null;
  world: {
    name: string;
    basePrompt: string;
    startDate: string;
    regions: any; // può essere Map o oggetto
    /** Переопределённые промпты мира (приоритет над дефолтными builders) */
    prompts?: PromptOverrides | string | null;
  };
  players: PlayerData[];
  /** Politia del giocatore (polityId) — для пометки в описании карты */
  playerPolityId?: string;
  /** Nomi leggibili delle politie (necessari quando le regioni sono province). */
  playerPolityName?: string;
  polityNames?: Record<string, string>;
  /** Relazioni persistenti tra politie, indicizzate per polityId. */
  relationships?: Record<string, Record<string, string>>;
  /** Dossier NPC: identità stabile, priorità dinamiche e memoria canonica. */
  npcStrategicProfiles?: string;
  /** Processi in corso (esiti partial) che la simulazione deve portare avanti. */
  ongoingProcesses?: Array<{
    id: string;
    sourceActionId: string;
    title: string;
    summary: string;
    startedDate: string;
    expectedDate?: string | null;
  }>;
  /** Conti nazionali calcolati dal motore, non stimati dall'LLM. */
  worldState?: { accounts?: Record<string, {
    provinces: number;
    population: number;
    gdp: number;
    militaryPower: number;
    factories: number;
    ports: number;
    universities: number;
    forces?: number;
    mobilized?: number;
    monthlyRevenue: number;
    monthlyExpenses: number;
    monthlyBalance: number;
    annualGrowthRate: number;
    stability: number;
    defenceBurdenPct?: number;
    warEffort?: number;
    socialTension?: number;
    nominalGdpUsdBillions: number;
    gdpPerCapitaUsd: number;
    government: string;
    /** Potenza effettiva e fattore arsenale calcolati dal motore. */
    effectiveMilitaryPower?: number;
    arsenalCombatFactor?: number;
  }>;
    /** Potenza militare effettiva (arsenale incluso), calcolata dal motore. */
    military?: { combatFactor?: number; baseMilitaryPower?: number; effectiveMilitaryPower?: number };
    /** Arsenale e risorse naturali della nazione giocatore. */
    arsenal?: { units?: Record<string, number>; strength?: number; qualityIndex?: number; naturalResources?: Record<string, number> };
    /** Magazzino materiale e riserve naturali dinamiche. */
    resources?: {
      stock?: { money?: number; food?: number; clothing?: number; weapons?: number; fuel?: number; research?: number; technologies?: string[] };
      natural?: Array<{ kind: string; label: string; endowment: number; reserve: number; maxReserve: number; stockpile: number; depletionPct: number; depleted: boolean }>;
    };
  };
  actions: ActionData[];
  results: TurnResultData[];
}

/** Нормализовать prompts-запись: объект или JSON-строка → чистый словарь. */
function normalizePrompts(raw: unknown): PromptOverrides | undefined {
  if (!raw) return undefined;
  let obj = raw;
  if (typeof obj === 'string') {
    try {
      obj = JSON.parse(obj);
    } catch {
      return undefined;
    }
  }
  if (typeof obj !== 'object' || obj === null || Array.isArray(obj)) return undefined;
  const out: PromptOverrides = {};
  for (const [key, value] of Object.entries(obj as Record<string, unknown>)) {
    if (typeof value === 'string' && value.trim()) out[key] = value;
  }
  return Object.keys(out).length > 0 ? out : undefined;
}

/**
 * Переопределённые промпты мира (пресетная секция "prompts").
 *
 * Приоритет: GameData.world.prompts → GameData.prompts → ленивый lookup в БД
 * (games → worlds.prompts). Lookup нужен, потому что GameSession не знает о
 * колонке prompts; любая ошибка (нет игры, нет БД, битый JSON) молча
 * откатывает на дефолтные промпты.
 */
export async function resolveWorldPrompts(game: GameData): Promise<PromptOverrides | undefined> {
  const direct = normalizePrompts(game.world?.prompts) ?? normalizePrompts(game.prompts);
  if (direct) return direct;

  try {
    // Ленивый dynamic import: repositories тянут database (better-sqlite3) —
    // не хотим открывать БД при импорте prompt-builder в средах без неё.
    const { gameRepository } = await import('./repositories');
    const row = gameRepository.findById(game.id);
    return normalizePrompts(row?.world?.prompts);
  } catch {
    return undefined;
  }
}

interface RegionData {
  id: string;
  name: string;
  color: string;
  owner: string;
  population?: number;
  gdp?: number;
  militaryPower?: number;
  borders?: string[];
  objects?: any[];
}

interface PlayerData {
  id: string;
  name: string;
  regionId: string;
  polityId?: string;
}

// Хелпер для работы с regions (può essere Map o oggettoом)
function getRegion(regions: any, regionId: string): RegionData | undefined {
  if (typeof regions.get === 'function') {
    return regions.get(regionId);
  }
  return regions[regionId];
}

function getAllRegions(regions: any): RegionData[] {
  if (typeof regions.values === 'function') {
    return Array.from(regions.values());
  }
  return Object.values(regions);
}

function clipConstrained(value: unknown, maxChars: number): string {
  const text = String(value || '').trim();
  return text.length <= maxChars ? text : `${text.slice(0, Math.max(0, maxChars - 1)).trimEnd()}…`;
}

interface ActionData {
  id: string;
  playerId: string;
  turn: number;
  text: string;
  createdAt: string;
}

interface TurnResultData {
  id: string;
  turn: number;
  narration: string;
  events?: string[];
  /** Data di gioco raggiunta alla fine del periodo. */
  date?: string;
  /** Eventi strutturati con dettaglio completo (headline + descrizione). */
  timelineEvents?: {
    id: string;
    date: string;
    headline: string;
    detail: string;
    source?: string;
  }[];
}

export class PromptBuilder {
  private game: GameData;
  private language: string = 'italian';

  constructor(game: GameData) {
    this.game = game;
  }

  // Построить полный набор переменных
  buildVariables(): PromptVariables {
    const player = this.game.players[0];
    const playerRegion = getRegion(this.game.world.regions, player.regionId);
    const playerPolityId = this.game.playerPolityId || player.polityId || playerRegion?.owner;
    const ownedRegions = getAllRegions(this.game.world.regions)
      .filter(region => region.owner === playerPolityId);
    const playerPolityName = this.game.playerPolityName
      || (ownedRegions.length === 1 ? ownedRegions[0].name : undefined)
      || playerPolityId
      || playerRegion?.name
      || player.name;

    return {
      STARTING_ROUND_DATE: this.game.world.startDate || '1951-01-01',
      ORIGIN_ROUND_DATE: this.game.currentDate,
      TARGET_ROUND_DATE: this.calculateTargetDate(this.game.currentDate, 30),
      ORIGIN_ROUND_GRAMMATICAL_DATE: this.toGrammaticalDate(this.game.currentDate),
      TARGET_ROUND_GRAMMATICAL_DATE: this.toGrammaticalDate(this.calculateTargetDate(this.game.currentDate, 30)),
      CURRENT_ROUND_NUMBER: this.game.currentTurn,

      WORLD_BEFORE_ROUND_ONE_TEXT: this.game.world.basePrompt || 'Storia alternativa',
      // Этап 5: правила симуляции пресета переопределяют дефолт
      HISTORICAL_PRESET_SIMULATION_RULES: this.game.simulationRules ?? 'Gli eventi si sviluppano in modo logico. Considera l\'economia e la potenza militare.',
      DIFFICULTY_DESCRIPTION_JUMP_FORWARD: difficultyPromptBlock(normalizeDifficulty(this.game.difficulty)),

      PLAYER_POLITY: playerPolityName,
      PLAYER_POLITY_REGIONS: this.buildPlayerRegions(player.regionId, playerPolityId),
      PLAYER_POLITY_BATTALION_SUMMARIES: this.buildPlayerBattalions(player.regionId, playerPolityId),

      PLAYER_ACTIONS_THIS_ROUND: this.buildCurrentActions(),
      PLAYER_EVERY_ACTION_NOT_PREVIOUS: this.buildAllPastActions(),

      GRAND_MAP_DESCRIPTION: this.buildMapDescription(),
      GRAND_MAP_DESCRIPTION_NO_CITY: this.buildMapDescriptionNoCity(),
      STRATEGIC_STATE: this.buildStrategicState(playerPolityId),
      NPC_STRATEGIC_PROFILES: this.game.npcStrategicProfiles || 'Nessun dossier NPC specifico disponibile.',
      ONGOING_PROCESSES: this.buildOngoingProcesses(),

      ALL_EVENTS_WITH_CONSOLIDATION: this.buildEventHistory(),
      CHATS_NON_CONSOLIDATED_ROUNDS: this.game.chatTranscripts ?? '',
      NON_CONSOLIDATED_ROUNDS_WITH_DATES: '',

      LANGUAGE: this.language,
      isBeta: true,
    };
  }

  // Построить переменные с конкретным действием для конвертера
  buildVariablesForAction(actionText: string): PromptVariables {
    return {
      ...this.buildVariables(),
      DESCRIPTION_ACTION_TEXT: actionText,
    };
  }

  /**
   * Отображаемое имя политии для LLM: имя «главного» региона (для шаблонов
   * это название страны). Раньше LLM видел внутренние id ('ai-USA'), а не
   * имена — и не мог осмысленно адресовать политии в mapChanges.
   */
  private polityDisplayName(owner: string, regionList: RegionData[]): string {
    return this.game.polityNames?.[owner]
      || (regionList.length === 1 ? regionList[0]?.name : undefined)
      || owner;
  }

  private polityHeader(owner: string, regionList: RegionData[]): string {
    const displayName = this.polityDisplayName(owner, regionList);
    const playerMark = owner === this.game.playerPolityId ? ' (GIOCATORE)' : '';
    // Показываем и имя, и id-алиас: LLM адресует политию по имени,
    // движок резолвит и то, и другое (см. utils/name-resolver).
    return `Politia "${displayName}" [${owner}]${playerMark} (colore ${regionList[0].color}):`;
  }

  /** Oggetti operativi/cantieri già esistenti: servono al modello per poterli
   * completare, muovere o rimuovere per nome senza crearne duplicati. */
  private strategicObjectSummaries(regionList: RegionData[], limit = 14): string[] {
    return regionList.flatMap(region => (region.objects || [])
      .filter((object: any) => object?.type && object.type !== 'city' && object.type !== 'capital')
      .map((object: any) => ({ region, object })))
      // Keep unfinished work visible even when the country owns many facilities.
      .sort((a, b) => Number(b.object.type === 'construction_site' || b.object.type === 'mobilization')
        - Number(a.object.type === 'construction_site' || a.object.type === 'mobilization'))
      .slice(0, limit)
      .map(({ region, object }: any) => {
        const meta = object.metadata || {};
        const status = meta.status ? `, ${meta.status}` : '';
        const planned = meta.plannedType ? `→${meta.plannedType}` : '';
        const report = object.type === 'construction_site' ? [
          meta.phase && `fase: ${meta.phase}`,
          meta.startedDate && `avviato: ${meta.startedDate}`,
          meta.expectedDate && `previsione, non certezza: ${meta.expectedDate}`,
          meta.blocker && `impedimento: ${this.compact(meta.blocker, 180)}`,
          meta.nextStep && `prossimo passo: ${this.compact(meta.nextStep, 180)}`,
        ].filter(Boolean).join('; ') : '';
        return `${object.name || 'oggetto senza nome'} [id:${object.id}; ${object.type}${planned}${status}] in ${region.name}${report ? ` — ${report}` : ''}`;
      });
  }

  /** Limite esplicito: la memoria operativa deve essere leggibile dal modello,
   * non una trascrizione completa del database geografico. */
  private compact(text: string, maxChars: number): string {
    const normalized = String(text || '').replace(/\s+/g, ' ').trim();
    return normalized.length <= maxChars ? normalized : `${normalized.slice(0, Math.max(0, maxChars - 1)).trimEnd()}…`;
  }

  /** Mappa nazionale compatta per mondi provinciali: conserva identità delle
   * politie e dimensione, mentre province/frontiere rilevanti restano nello
   * stato strategico. Questo evita decine di migliaia di token inutili. */
  private buildCompactProvincialMap(regions: RegionData[]): string {
    const polities = this.groupRegionsByOwner(regions);
    const accountByPolity = this.game.worldState?.accounts || {};
    const entries = [...polities.entries()]
      .filter(([owner]) => owner !== 'neutral')
      .sort(([a, left], [b, right]) => {
        if (a === this.game.playerPolityId) return -1;
        if (b === this.game.playerPolityId) return 1;
        return (accountByPolity[right[0]?.owner]?.gdp || 0) - (accountByPolity[left[0]?.owner]?.gdp || 0)
          || this.polityDisplayName(a, left).localeCompare(this.polityDisplayName(b, right));
      });
    const listed = entries.slice(0, 72).map(([owner, regionList]) => {
      const account = accountByPolity[owner];
      const playerMark = owner === this.game.playerPolityId ? ' GIOCATORE' : '';
      return `- ${this.polityDisplayName(owner, regionList)} [${owner}]${playerMark}: ${regionList.length} province; popolazione ${Math.round(account?.population || regionList.reduce((n, r) => n + (Number(r.population) || 0), 0)).toLocaleString('it-IT')}.`;
    });
    const omitted = entries.length - listed.length;
    return [
      `Mappa provinciale compressa: ${regions.length} province in ${entries.length} politie.`,
      'Le frontiere e le province che il giocatore può influenzare sono elencate nello Stato strategico; non inventare province non nominate lì o nell’ordine.',
      ...listed,
      omitted > 0 ? `Altre ${omitted} politie presenti ma non rilevanti per il teatro attuale.` : '',
    ].filter(Boolean).join('\n');
  }

  // Описание карты (полное)
  private buildMapDescription(): string {
    const regions = getAllRegions(this.game.world.regions);
    if (regions.length > 350) return this.buildCompactProvincialMap(regions);
    const polities = this.groupRegionsByOwner(regions);

    let description = '';

    for (const [owner, regionList] of polities) {
      if (owner === 'neutral') continue;

      const capitals = regionList.filter(r => r.objects?.some((o: any) => o.type === 'capital'));
      const capitalsStr = capitals.length > 0
        ? capitals.map(r => `${r.name} (capitale)`).join(', ')
        : '';

      description += `${this.polityHeader(owner, regionList)}\n`;
      if (capitalsStr) description += `- ${capitalsStr}\n`;
      description += `- Regioni: ${regionList.map(r => r.name).join(', ')}\n`;
      description += `\n`;
    }

    // Нейтральные регионы
    const neutral = regions.filter(r => r.owner === 'neutral');
    if (neutral.length > 0) {
      description += `Regioni neutrali:\n`;
      description += `- ${neutral.map(r => r.name).join(', ')}\n`;
    }

    return description;
  }

  // Описание карты без городов
  private buildMapDescriptionNoCity(): string {
    const regions = getAllRegions(this.game.world.regions);
    if (regions.length > 350) return this.buildCompactProvincialMap(regions);
    const polities = this.groupRegionsByOwner(regions);

    let description = '';

    for (const [owner, regionList] of polities) {
      if (owner === 'neutral') {
        description += `Regioni neutrali:\n`;
        description += regionList.map(r => r.name).join(', ');
        description += '\n\n';
        continue;
      }

      description += `${this.polityHeader(owner, regionList)}\n`;
      description += regionList.map(r => r.name).join(', ');
      const strategicObjects = this.strategicObjectSummaries(regionList);
      if (strategicObjects.length) description += `\n- Oggetti territoriali: ${strategicObjects.join('; ')}`;
      description += '\n\n';
    }

    return description;
  }

  /**
   * Fotografia di stato per il simulatore. Manteniamo il blocco conciso e
   * verificabile: il modello deve poter fondare le reazioni sui confini, sulle
   * risorse e sui rapporti reali, senza inventare minacce o alleanze.
   */
  /** Elenco leggibile dei processi in corso per il prompt di simulazione. */
  private buildOngoingProcesses(): string {
    const processes = this.game.ongoingProcesses || [];
    if (!processes.length) return '';
    return [...processes].sort((a, b) => (a.expectedDate || '9999').localeCompare(b.expectedDate || '9999')).map(process => {
      const overdue = process.expectedDate && process.expectedDate <= this.game.currentDate;
      const due = process.expectedDate
        ? ` — completamento previsto: ${process.expectedDate}${overdue ? ' (scadenza raggiunta: verificare esito o impedimento, non completare automaticamente)' : ''}`
        : ' — completamento previsto: data non determinata';
      return `- [projectId:${process.id}; sourceActionId:${process.sourceActionId}] ${process.title}${due}. Stato: ${process.summary} (avviato: ${process.startedDate})`;
    }).join('\n');
  }

  private buildStrategicState(playerPolityId?: string): string {
    const regions = getAllRegions(this.game.world.regions);
    if (!playerPolityId) return 'Stato strategico non disponibile.';

    const owned = regions.filter(region => region.owner === playerPolityId);
    if (owned.length === 0) return 'La politia del giocatore non controlla regioni.';

    const byId = new Map(regions.map(region => [region.id, region]));
    const neighbours = new Map<string, RegionData[]>();
    for (const region of regions) {
      if (region.owner === playerPolityId || region.owner === 'neutral') continue;
      const touchesPlayer = (region.borders || []).some(id => byId.get(id)?.owner === playerPolityId)
        || owned.some(playerRegion => (playerRegion.borders || []).includes(region.id));
      if (!touchesPlayer) continue;
      const list = neighbours.get(region.owner) || [];
      list.push(region);
      neighbours.set(region.owner, list);
    }

    const sum = (items: RegionData[], field: 'population' | 'gdp' | 'militaryPower') =>
      items.reduce((total, region) => total + (Number(region[field]) || 0), 0);
    const fmt = (value: number) => new Intl.NumberFormat('it-IT', { maximumFractionDigits: 1 }).format(value);
    const playerName = this.polityDisplayName(playerPolityId, owned);
    const playerAccount = this.game.worldState?.accounts?.[playerPolityId];
    const lines = [
      `Politia del giocatore: ${playerName} [${playerPolityId}].`,
      `Risorse attuali: popolazione ${fmt(sum(owned, 'population'))}; PIL ${fmt(sum(owned, 'gdp'))}; potenza militare ${fmt(sum(owned, 'militaryPower'))}.`,
      `Territori controllati: ${owned.length <= 42 ? owned.map(region => region.name).join(', ') : `${owned.slice(0, 42).map(region => region.name).join(', ')}, più altre ${owned.length - 42} province`}.`,
    ];
    if (playerAccount) {
      lines.push(`Dossier nazionale calcolato dal motore: governo ${playerAccount.government}; popolazione ${fmt(playerAccount.population)}; PIL nominale stimato ${fmt(playerAccount.nominalGdpUsdBillions)} miliardi USD; PIL pro capite circa ${fmt(playerAccount.gdpPerCapitaUsd)} USD; entrate mensili ${fmt(playerAccount.monthlyRevenue)}; uscite mensili ${fmt(playerAccount.monthlyExpenses)}; saldo ${fmt(playerAccount.monthlyBalance)}; crescita annua ${(playerAccount.annualGrowthRate * 100).toFixed(1)}%; stabilità ${playerAccount.stability}/100; spesa militare ${playerAccount.defenceBurdenPct}% del PIL; riserve mobilitate ${playerAccount.mobilized}; sforzo bellico ${playerAccount.warEffort}/100; tensione sociale ${playerAccount.socialTension}/100; infrastrutture: ${playerAccount.factories} fabbriche, ${playerAccount.ports} porti, ${playerAccount.universities} università.`);
      const military = this.game.worldState?.military;
      if (military && Number.isFinite(Number(military.effectiveMilitaryPower))) {
        lines.push(`Forze armate effettive: potenza militare ${fmt(Number(military.effectiveMilitaryPower))} (base ${fmt(Number(military.baseMilitaryPower || 0))} × fattore arsenale ${military.combatFactor}); qualità media delle armi ${this.game.worldState?.arsenal?.qualityIndex ?? 0}/100. I combattimenti devono usare la potenza effettiva, non quella nominale.`);
      }
      const stock = this.game.worldState?.resources?.stock;
      if (stock) {
        const techs = stock.technologies?.length ? stock.technologies.join(', ') : 'nessuna';
        lines.push(`Magazzino materiale: denaro ${fmt(Number(stock.money || 0))} mld; cibo ${fmt(Number(stock.food || 0))}; vestiario ${fmt(Number(stock.clothing || 0))}; armamenti ${fmt(Number(stock.weapons || 0))}; carburante ${fmt(Number(stock.fuel || 0))}; ricerca ${fmt(Number(stock.research || 0))}; tecnologie: ${techs}.`);
      }
      const natural = this.game.worldState?.resources?.natural;
      if (natural && natural.length > 0) {
        lines.push(`Risorse naturali (giacimento 0-5 / riserva / magazzino): ${natural.map(n => `${n.label} ${n.endowment}/5, riserva ${n.reserve}/${n.maxReserve}${n.depleted ? ' ESAURITA' : ` (${n.depletionPct}% consumata)`}${n.stockpile > 0 ? `, magazzino ${n.stockpile}` : ''}`).join('; ')}. L'estrazione consuma la riserva; le risorse si possono vendere o comprare sul mercato.`);
      }
      const arsenalUnits = this.game.worldState?.arsenal?.units;
      if (arsenalUnits && Object.keys(arsenalUnits).length > 0) {
        lines.push(`Arsenale (quantità per voce): ${Object.entries(arsenalUnits).map(([id, qty]) => `${id}×${qty}`).join(', ')}.`);
      }
    }
    const playerObjects = this.strategicObjectSummaries(owned, 20);
    lines.push(playerObjects.length
      ? `Oggetti territoriali e formazioni del giocatore: ${playerObjects.join('; ')}.`
      : 'Oggetti territoriali e formazioni del giocatore: nessuno registrato.');

    if (neighbours.size === 0) {
      lines.push('Confini terrestri con altre politie: nessuno registrato sulla mappa.');
    } else {
      lines.push('Frontiere e rapporti attuali:');
      for (const [owner, borderRegions] of neighbours) {
        const allOwned = regions.filter(region => region.owner === owner);
        const relation = this.game.relationships?.[playerPolityId]?.[owner]
          || this.game.relationships?.[owner]?.[playerPolityId]
          || 'neutral';
        const account = this.game.worldState?.accounts?.[owner];
        const economy = account
          ? `; PIL ${fmt(account.gdp)}, saldo mensile ${fmt(account.monthlyBalance)}, stabilità ${account.stability}/100, riserve mobilitate ${account.mobilized}, sforzo bellico ${account.warEffort}/100, tensione sociale ${account.socialTension}/100`
          : '';
        const objects = this.strategicObjectSummaries(allOwned, 8);
        const effectivePower = Number(account?.effectiveMilitaryPower);
        const powerLabel = Number.isFinite(effectivePower) && effectivePower > 0
          ? `${fmt(effectivePower)} effettiva (nominale ${fmt(sum(allOwned, 'militaryPower'))})`
          : `stimata ${fmt(sum(allOwned, 'militaryPower'))}`;
        lines.push(`- ${this.polityDisplayName(owner, allOwned)} [${owner}]: rapporto ${relation}; confina tramite ${borderRegions.map(region => region.name).join(', ')}; potenza militare ${powerLabel}${economy}.${objects.length ? ` Oggetti osservabili: ${objects.join('; ')}.` : ''}`);
      }
    }

    lines.push('Questi dati sono vincolanti: non attribuire risorse, frontiere, alleanze, mobilitazioni o minacce non presenti nella cronaca o in questo stato.');
    return lines.join('\n');
  }

  // Territori e risorse del giocatore: tutte le regioni della politia, non
  // soltanto quella scelta all'avvio (che nei preset provinciali è una provincia).
  private buildPlayerRegions(playerRegionId: string, playerPolityId?: string): string {
    const allRegions = getAllRegions(this.game.world.regions);
    const fallback = getRegion(this.game.world.regions, playerRegionId);
    const owned = playerPolityId
      ? allRegions.filter(region => region.owner === playerPolityId)
      : (fallback ? [fallback] : []);
    if (owned.length === 0) return 'Nessuna regione';

    const sum = (key: 'population' | 'gdp' | 'militaryPower') =>
      owned.reduce((total, region) => total + (Number(region[key]) || 0), 0);
    const fmt = (value: number) => new Intl.NumberFormat('it-IT', { maximumFractionDigits: 1 }).format(value);

    const regionNames = owned.length <= 42
      ? owned.map(region => region.name).join(', ')
      : `${owned.slice(0, 42).map(region => region.name).join(', ')}, più altre ${owned.length - 42} province`;
    return `Regioni controllate: ${regionNames}. `
      + `Risorse aggregate: popolazione ${fmt(sum('population'))}; PIL ${fmt(sum('gdp'))}; potenza militare ${fmt(sum('militaryPower'))}.`;
  }

  // Formazioni del giocatore, raggruppate per regione per evitare che il
  // generatore proponga movimenti di unità inesistenti o nel posto sbagliato.
  // Il nome della variabile resta legacy, ma include armate/flotte/missili e
  // mobilitazioni non ancora operative.
  private buildPlayerBattalions(playerRegionId: string, playerPolityId?: string): string {
    const allRegions = getAllRegions(this.game.world.regions);
    const fallback = getRegion(this.game.world.regions, playerRegionId);
    const owned = playerPolityId
      ? allRegions.filter(region => region.owner === playerPolityId)
      : (fallback ? [fallback] : []);

    const operationalTypes = new Set(['battalion', 'army', 'fleet', 'missile']);
    const placements = owned.flatMap(region => {
      const operational = (region.objects || []).filter((object: any) => operationalTypes.has(object.type));
      const mobilizations = (region.objects || []).filter((object: any) => object.type === 'mobilization');
      if (!operational.length && !mobilizations.length) return [];
      const names = [...operational, ...mobilizations].map((object: any) => {
        const name = object.name || 'unità senza nome';
        const planned = object.type === 'mobilization' && object.metadata?.plannedType
          ? `→${object.metadata.plannedType}`
          : '';
        return `${name} [${object.type}${planned}]`;
      });
      const mobilizationLabel = mobilizations.length ? `; ${mobilizations.length} mobilitazioni in corso` : '';
      return [`${operational.length} unità in ${region.name}${mobilizationLabel}: ${names.join(', ')}`];
    });

    return placements.length > 0 ? placements.join('; ') : 'Nessuna unità o mobilitazione militare registrata sulla mappa';
  }

  // Действия за текущий раунд
  private buildCurrentActions(): string {
    const currentActions = this.game.actions.filter(a => a.turn === this.game.currentTurn);
    if (currentActions.length === 0) return '';

    return currentActions.map(a => `- ${a.text}`).join('\n');
  }

  // Все прошлые действия
  private buildAllPastActions(): string {
    // La cronaca consolidata conserva gli effetti remoti. Qui servono soltanto
    // gli ultimi ordini irrisolti, così non replichiamo l'intera partita.
    const pastActions = this.game.actions
      .filter(a => a.turn < this.game.currentTurn)
      .slice(-6);
    if (pastActions.length === 0) return 'Nessuna azione passata rilevante';
    return pastActions
      .map(action => `T${action.turn}: ${this.compact(action.text, 220)}`)
      .join('\n');
  }

  // Separate budgets for recent facts and long-term memory; the latest
  // committed event remains available even in the constrained-model path.
  private buildEventHistory(): string {
    return buildNarrativeMemory(this.game.results, this.game.consolidatedHistory);
  }

  // Группировка регионов по владельцам
  private groupRegionsByOwner(regions: RegionData[]): Map<string, RegionData[]> {
    const polities = new Map<string, RegionData[]>();

    for (const region of regions) {
      const owner = region.owner || 'neutral';
      if (!polities.has(owner)) {
        polities.set(owner, []);
      }
      polities.get(owner)!.push(region);
    }

    return polities;
  }

  // Расчёт целевой даты (UTC — локальная арифметика ломалась на DST)
  private calculateTargetDate(startDate: string, days: number): string {
    return addDays(startDate, days);
  }

  // Дата в грамматическом формате
  private toGrammaticalDate(dateStr: string): string {
    return formatItalianDate(dateStr);
  }
}

// Класс для работы с LLM через промпты
export class PromptEngine {
  private llm: LLMRouter;

  constructor(llm: LLMRouter) {
    this.llm = llm;
  }

  /** I modelli OpenRouter gratuiti e quelli <=4B ricevono un protocollo più
   * corto: meno istruzioni duplicate e più budget utile per il JSON. */
  private isConstrainedModel(mechanic: 'jump' | 'converter' | 'suggestions' = 'jump'): boolean {
    const describe = (this.llm as any)?.describe;
    if (typeof describe !== 'function') return false;
    const model = String(describe.call(this.llm)?.[mechanic]?.model || '').toLowerCase();
    return /:free(?:$|[/?#])/.test(model)
      || /(?:^|[-_/])(?:[0-4](?:\.\d+)?)b(?:$|[-_/:])/.test(model);
  }

  /**
   * Gli esiti con ID inventati non devono far fallire un turno già valido.
   * Rimappiamo solo casi non ambigui (testo esatto o singolo ordine), scartiamo
   * duplicati/extra e preserviamo come unresolved ciò che non è dimostrabile.
   */
  private sanitizeSimulationResult(
    game: GameData,
    result: SimulationResult,
    actions: Array<{ actionId?: string; text: string }>,
    maxEvents: number,
    autoJump: boolean,
    repair = false,
  ): SimulationResult {
    const boundedEvents = (result.events || []).slice(0, maxEvents);
    // Fuori dai modelli free l'adattatore è disattivato: ID ignoti, progetti
    // invalidi e protocolli sbagliati devono continuare a fallire chiuse
    // (C01/C02) invece di essere ridotti silenziosamente.
    if (!repair || game.strictMode) {
      return {
        ...result,
        events: boundedEvents,
        targetDate: autoJump && boundedEvents.length > 0 ? boundedEvents.at(-1)!.date : result.targetDate,
      };
    }
    const canonicalActions = actions.filter(action => !!action.actionId) as Array<{ actionId: string; text: string }>;
    const knownIds = new Set(canonicalActions.map(action => action.actionId));
    const used = new Set<string>();
    const comparable = (value: string | undefined) => String(value || '')
      .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
      .toLocaleLowerCase('it').replace(/\s+/g, ' ').trim();
    const knownProjects = new Set((game.ongoingProcesses || []).map(project => project.id));
    const inputOutcomes = Array.isArray(result.actionOutcomes) ? result.actionOutcomes : [];
    const actionOutcomes: ActionOutcome[] = [];

    for (const outcome of inputOutcomes) {
      let actionId = outcome.actionId && knownIds.has(outcome.actionId) && !used.has(outcome.actionId)
        ? outcome.actionId
        : undefined;
      if (!actionId && outcome.action) {
        const matches = canonicalActions.filter(action =>
          !used.has(action.actionId) && comparable(action.text) === comparable(outcome.action));
        if (matches.length === 1) actionId = matches[0].actionId;
      }
      if (!actionId && canonicalActions.length === 1 && inputOutcomes.length === 1 && !used.size) {
        actionId = canonicalActions[0].actionId;
      }
      if (!actionId || used.has(actionId)) continue;
      used.add(actionId);
      actionOutcomes.push({
        ...outcome,
        actionId,
        action: outcome.action || canonicalActions.find(action => action.actionId === actionId)?.text || '',
        completesProjectId: outcome.status === 'accepted' && outcome.completesProjectId
          && knownProjects.has(outcome.completesProjectId)
          ? outcome.completesProjectId
          : undefined,
      });
    }

    // Un voided esplicito è sufficiente per ricostruire in sicurezza l'esito
    // rejected quando il modello piccolo ha dimenticato actionOutcomes.
    for (const rejected of result.voided || []) {
      const matches = canonicalActions.filter(action =>
        !used.has(action.actionId) && comparable(action.text) === comparable(rejected.action));
      const source = matches.length === 1
        ? matches[0]
        : canonicalActions.length === 1 && (result.voided || []).length === 1 && !used.size
          ? canonicalActions[0]
          : undefined;
      if (!source || !rejected.reason?.trim()) continue;
      used.add(source.actionId);
      actionOutcomes.push({
        actionId: source.actionId,
        action: source.text,
        status: 'rejected',
        summary: rejected.reason.trim(),
        eventHeadlines: [],
      });
    }

    const events = boundedEvents;
    return {
      ...result,
      events,
      actionOutcomes,
      targetDate: autoJump && events.length > 0 ? events.at(-1)!.date : result.targetDate,
      worldChanges: result.worldChanges && typeof result.worldChanges === 'object'
        ? result.worldChanges
        : { regionOwners: {}, regionColors: {}, newFeatures: [], deletedFeatures: [] },
    };
  }

  async runSimulation(
    game: GameData,
    actions: Array<string | { actionId: string; text: string }>,
    jumpDays: number,
    onProgress?: (charsSoFar: number) => void,
    autoJump?: boolean,
    onEvent?: (event: SimulationEvent, index: number) => void,
    signal?: AbortSignal,
  ): Promise<SimulationResult> {
    const builder = new PromptBuilder(game);

    // Обновляем целевую дату
    const vars = builder.buildVariables();
    vars.TARGET_ROUND_DATE = this.calculateTargetDate(game.currentDate, jumpDays);
    vars.TARGET_ROUND_GRAMMATICAL_DATE = this.toGrammaticalDate(vars.TARGET_ROUND_DATE);
    const normalizedActions: Array<{ actionId?: string; text: string }> = actions.map(action => typeof action === 'string'
      ? { text: action }
      : action);
    // L'identità entra nel prompt: il testo è descrittivo, non una chiave.
    vars.PLAYER_ACTIONS_THIS_ROUND = normalizedActions
      .map(action => action.actionId ? `[actionId:${action.actionId}] ${action.text}` : action.text)
      .join('\n');

    const promptOverride = getPromptOverride(await resolveWorldPrompts(game), 'simulation');
    // Budget eventi: nel salto fisso è proporzionale alla durata; in ogni caso
    // non può scendere sotto il numero di ordini in coda. Il modello può
    // concludere prima se manca una causa verificabile.
    const actionsCount = normalizedActions.length;
    const maxEvents = autoJump
      ? Math.max(1, actionsCount)
      : Math.min(30, Math.max(1, Math.ceil(jumpDays / 21), actionsCount));
    const renderedOverride = promptOverride ? renderPromptTemplate(promptOverride, vars) : undefined;
    const constrained = !game.strictMode && this.isConstrainedModel('jump');
    const prompt = constrained
      ? buildConstrainedSimulationPrompt(vars, {
          autoJump,
          eventBudget: maxEvents,
          presetOverride: renderedOverride,
        })
      : (() => {
          const basePrompt = renderedOverride
            ? renderedOverride
              + buildCausalityGuard(vars)
              + (autoJump ? buildAutoJumpInstruction(vars, maxEvents) : '')
            : buildSimulationPrompt(vars, { autoJump, eventBudget: maxEvents });
          // I preset possono definire il mondo, non rimuovere causalità,
          // autonomia del giocatore e rigore della cronaca.
          return basePrompt
            + buildSimulationNarrativeContract(vars, Boolean(promptOverride))
            + buildIncrementalOutputInstruction(vars, maxEvents, !!autoJump);
        })();

    let parsedObjectCount = 0;
    let emittedCount = 0;
    const emitted = new Set<string>();
    const emitEvent = (event: SimulationEvent) => {
      if (emittedCount >= maxEvents) return;
      const key = JSON.stringify(event);
      if (emitted.has(key)) return;
      emitted.add(key);
      onEvent?.(event, emittedCount++);
    };

    // system — короткая ролевая инструкция, user — большой промпт.
    // Ogni volta che nello stream si chiude un oggetto JSON `event`, lo
    // normalizziamo e lo consegniamo subito alla sessione di gioco.
    const system = constrained
      ? 'Simula causa ed effetto. Copia gli actionId. Rispetta l’autonomia NPC. Rispondi solo in NDJSON valido: righe event, poi una riga complete.'
      : 'Sei il simulatore di una storia alternativa. Non parafrasare gli ordini: simula decisioni autonome delle controparti rispettando personalità, priorità e memoria fornite. Ogni nazione NPC direttamente coinvolta deve rispondere nel campo reactions; il giocatore non può accettare accordi al suo posto. Usa mapChanges per cantieri, mobilitazioni, unità e opere realmente avviati o completati. Produci JSON Lines valido.';
    const requestOptions = {
      temperature: constrained ? 0.35 : 0.7,
      jsonMode: false,
      maxTokens: Math.min(8_000, Math.max(4_096, 2_800 + maxEvents * 700)),
      signal,
    };
    let response = await this.llm.stream(
      'jump',
      system,
      prompt,
      (chars, content) => {
        onProgress?.(chars);
        if (!onEvent || !content || !content.slice(Math.max(0, chars - 256)).includes('}')) return;
        const objects = extractCompleteJsonObjects(content);
        for (const raw of objects.slice(parsedObjectCount)) {
          const record = parseIncrementalSimulationRecord(raw);
          if (record?.type === 'event') emitEvent(record.event);
        }
        parsedObjectCount = objects.length;
      },
      // NDJSON non è un singolo documento JSON: disattiva response_format.
      requestOptions,
    );

    let rawObjects = extractCompleteJsonObjects(response.content);
    let result = parseIncrementalSimulationResponse(response.content);
    const looksLikeProtocol = () => rawObjects.some(raw =>
      !!parseIncrementalSimulationRecord(raw)
      || Array.isArray(raw?.events) || typeof raw?.narration === 'string')
      || /"(?:events|narration|actionOutcomes)"\s*:/.test(response.content);

    // Un solo retry di formato, solo per modelli piccoli e soltanto quando non
    // è stato riconosciuto alcun record. Non ripetiamo mai eventi già emessi.
    if (constrained && emittedCount === 0 && !looksLikeProtocol()) {
      const retryPrompt = `${prompt}\n\n[CORREZIONE FORMATO]\nLa risposta precedente non era leggibile. Ripeti una sola volta: nessun commento, una riga JSON per evento e infine la riga JSON type=complete. Copia gli actionId senza modificarli.`;
      response = await this.llm.generate(
        'jump',
        system,
        retryPrompt,
        { ...requestOptions, temperature: 0.15 },
      );
      rawObjects = extractCompleteJsonObjects(response.content);
      result = parseIncrementalSimulationResponse(response.content);
    }

    const hasCompletion = rawObjects.some(raw => parseIncrementalSimulationRecord(raw)?.type === 'complete')
      || rawObjects.some(raw => Array.isArray(raw?.events) && typeof raw?.narration === 'string');
    // Se gli eventi sono arrivati ma la chiusura è stata troncata, chiediamo
    // soltanto il piccolo record complete: niente seconda simulazione e niente
    // rischio di applicare due volte la mappa.
    if (constrained && result.events.length > 0 && !hasCompletion) {
      const closurePrompt = `Completa un output di simulazione già emesso. NON generare altri eventi.\nOrdini: ${JSON.stringify(normalizedActions)}\nEventi già validi: ${JSON.stringify(result.events.map(event => ({ headline: event.headline, date: event.date, description: event.description })))}\nRispondi SOLO con una riga JSON: {"type":"complete","narration":"sintesi","actionOutcomes":[{"actionId":"ID esatto","status":"accepted|partial|rejected","summary":"esito","eventHeadlines":[]}],"voided":[],"startChat":[],"relationshipChanges":[],"worldChanges":{"regionOwners":{},"regionColors":{}},"targetDate":${autoJump ? JSON.stringify(result.events.at(-1)?.date || vars.TARGET_ROUND_DATE) : JSON.stringify(vars.TARGET_ROUND_DATE)}}`;
      try {
        const closure = await this.llm.generate(
          'jump',
          'Chiudi il protocollo senza aggiungere eventi. Copia gli actionId e rispondi soltanto con JSON valido.',
          closurePrompt,
          { temperature: 0.1, maxTokens: 2_400, jsonMode: false, signal },
        );
        const completion = extractCompleteJsonObjects(closure.content)
          .map(parseIncrementalSimulationRecord)
          .find((record): record is Extract<ReturnType<typeof parseIncrementalSimulationRecord>, { type: 'complete' }> => record?.type === 'complete');
        if (completion) result = { ...completion.result, events: result.events, incomplete: false };
      } catch (error) {
        // Gli eventi completi restano recuperabili come run incompleto; non
        // trasformiamo una chiusura ausiliaria fallita in 502/424 del turno.
        console.warn('[PromptEngine] Chiusura compatta non disponibile:', error);
      }
    }

    result = this.sanitizeSimulationResult(game, result, normalizedActions, maxEvents, !!autoJump, constrained);
    // Provider senza streaming o modello che usa ancora il vecchio formato:
    // pubblica gli eventi validati appena arriva la risposta completa.
    for (const event of result.events) emitEvent(event);
    return result;
  }

  async convertAction(game: GameData, actionText: string, signal?: AbortSignal): Promise<ConvertedAction> {
    const builder = new PromptBuilder(game);
    const vars = builder.buildVariablesForAction(actionText);

    const promptOverride = getPromptOverride(await resolveWorldPrompts(game), 'converter');
    const constrained = this.isConstrainedModel('converter');
    const prompt = constrained
      ? `Riformula UN ordine per la simulazione senza cambiarne l'intenzione. Italiano, massimo 650 caratteri.\nPolitia: ${vars.PLAYER_POLITY}. Data: ${vars.ORIGIN_ROUND_DATE}.\nStato utile: ${clipConstrained(vars.STRATEGIC_STATE, 2_500)}\nMappa utile: ${clipConstrained(vars.GRAND_MAP_DESCRIPTION_NO_CITY, 2_500)}\n${promptOverride ? `Regole preset: ${clipConstrained(renderPromptTemplate(promptOverride, vars), 1_500)}\n` : ''}ORDINE ORIGINALE (non perderlo): ${actionText}\nRispondi SOLO: {"type":"action|chat","text":"ordine preciso","targetPolity":"solo chat","chatMessage":"solo chat"}`
      : promptOverride ? renderPromptTemplate(promptOverride, vars) : buildConverterPrompt(vars);
    // F05 µ2: l'abort del run arresto arriva fino agli adattatori, convertitore compreso.
    const response = await this.llm.generate(
      'converter',
      'Sei l\'analista degli ordini in un gioco strategico globale. Rispondi SOLO con JSON.',
      prompt + buildNationalDecisionContext(vars) + buildActionElaborationGuard(),
      { temperature: constrained ? 0.25 : 0.5, maxTokens: constrained ? 1_200 : undefined, signal }
    );

    return parseConverterResponse(response.content, actionText);
  }

  /**
   * Convert multiple actions in a single LLM call (batch processing)
   * Significantly reduces API calls when processing multiple pending actions
   */
  async convertActionsBatch(
    game: GameData,
    actions: Array<string | { actionId: string; text: string }>,
    signal?: AbortSignal,
  ): Promise<ConvertedAction[]> {
    const normalized: Array<{ actionId?: string; text: string }> = actions.map(action => typeof action === 'string' ? { text: action } : action);
    if (normalized.length === 0) return [];
    if (normalized.length === 1) {
      // Compatibilità single-action: l'ID viene conservato fuori dalla prosa.
      return [{ ...await this.convertAction(game, normalized[0].text, signal), actionId: normalized[0].actionId }];
    }

    // Пресетный шаблон конвертера рассчитан на одно действие: с ним
    // конвертируем последовательно — корректность важнее экономии вызовов.
    if (getPromptOverride(await resolveWorldPrompts(game), 'converter')) {
      const converted: ConvertedAction[] = [];
      for (const action of normalized) {
        converted.push({ ...await this.convertAction(game, action.text, signal), actionId: action.actionId });
      }
      return converted;
    }

    const builder = new PromptBuilder(game);
    const vars = builder.buildVariables();

    const converterInputs = normalized.map((action, index) => ({
      // Le chiamate pubbliche legacy senza ID restano leggibili, ma non
      // attraversano il percorso canonico GameSession → GameController.
      actionId: action.actionId || `legacy-converter-${index + 1}`,
      text: action.text,
    }));
    const constrained = this.isConstrainedModel('converter');
    const prompt = constrained
      ? `Riformula ogni ordine senza cambiarne l'intenzione. Non eliminare record. Copia ogni actionId ESATTAMENTE. Italiano, massimo 650 caratteri per text.\nPolitia: ${vars.PLAYER_POLITY}; data: ${vars.ORIGIN_ROUND_DATE}.\nStato utile: ${clipConstrained(vars.STRATEGIC_STATE, 2_500)}\nINPUT: ${JSON.stringify(converterInputs)}\nRispondi SOLO con un array JSON: [{"actionId":"ID esatto","type":"action|chat","text":"ordine preciso","targetPolity":"solo chat","chatMessage":"solo chat"}]`
      : buildBatchConverterPrompt(vars, converterInputs);
    const response = await this.llm.generate(
      'converter',
      'Sei l\'analista degli ordini in un gioco strategico globale. Rispondi SOLO con JSON.',
      prompt + buildNationalDecisionContext(vars) + buildActionElaborationGuard(),
      { temperature: constrained ? 0.2 : 0.5, maxTokens: constrained ? Math.min(4_000, 700 + normalized.length * 700) : undefined }
    );

    const parsed = parseBatchConverterResponse(response.content);
    const used = new Set<number>();
    // Ogni input sopravvive anche a JSON parziale, record extra o ID copiati
    // male. Accettiamo un record soltanto per ID canonico, indice legacy
    // esplicito o lotto singolo; altrimenti conserviamo l'ordine originale.
    return normalized.map((source, sourceIndex) => {
      let parsedIndex = parsed.findIndex((converted, index) =>
        !used.has(index) && !!source.actionId && converted.actionId === source.actionId);
      if (parsedIndex < 0) {
        parsedIndex = parsed.findIndex((converted, index) =>
          !used.has(index) && converted.legacyIndex === sourceIndex + 1);
      }
      if (parsedIndex < 0 && normalized.length === 1 && parsed.length === 1) parsedIndex = 0;
      if (parsedIndex < 0) {
        return { actionId: source.actionId, type: 'action' as const, text: source.text };
      }
      used.add(parsedIndex);
      const converted = parsed[parsedIndex];
      return {
        ...converted,
        actionId: source.actionId,
        text: converted.text?.trim() ? converted.text : source.text,
      };
    });
  }

  async getAdvisor(game: GameData, message: string, history: AdvisorMessage[] = []): Promise<string> {
    const builder = new PromptBuilder(game);
    const vars = builder.buildVariables();

    // Пресетный шаблон советника: роль/стиль из пресета, но историю диалога
    // и текущий вопрос игрока всегда дописываем — иначе советник «оглохнет».
    const promptOverride = getPromptOverride(await resolveWorldPrompts(game), 'advisor');
    const prompt = promptOverride
      ? renderPromptTemplate(promptOverride, vars) + buildAdvisorDialogSuffix(message, history)
      : buildAdvisorPrompt(vars, message, history);
    const response = await this.llm.generate(
      'advisor',
      'Sei il saggio consigliere del capo di Stato in una storia alternativa.',
      prompt,
      { temperature: 0.7 }
    );

    return parseAdvisorResponse(response.content);
  }

  /**
   * Этап 3: стриминговый вариант советника (живой Советник на фронте).
   * Контракт как у getAdvisor, но токены летят в onToken.
   */
  async getAdvisorStream(
    game: GameData,
    message: string,
    history: AdvisorMessage[] = [],
    onToken: (charsSoFar: number) => void
  ): Promise<string> {
    const builder = new PromptBuilder(game);
    const vars = builder.buildVariables();

    const promptOverride = getPromptOverride(await resolveWorldPrompts(game), 'advisor');
    const prompt = promptOverride
      ? renderPromptTemplate(promptOverride, vars) + buildAdvisorDialogSuffix(message, history)
      : buildAdvisorPrompt(vars, message, history);
    const response = await this.llm.stream(
      'advisor',
      'Sei il saggio consigliere del capo di Stato in una storia alternativa.',
      prompt,
      onToken,
      { temperature: 0.7 }
    );

    return response.content;
  }

  private safeSuggestionFallback(vars: PromptVariables, game: GameData): Suggestion[] {
    const suggestions: Suggestion[] = [
      {
        topic: 'Verificare le capacità nazionali',
        description: 'Un quadro aggiornato evita di impegnare risorse, forze o infrastrutture che la politia non possiede realmente.',
        actions: [
          { title: 'Inventario operativo', content: 'Incarichiamo l’amministrazione di censire risorse, forze e infrastrutture disponibili, indicando carenze verificabili prima di autorizzare nuovi impegni.' },
          { title: 'Priorità di bilancio', content: 'Ordiniamo una revisione delle spese correnti, proteggendo gli impegni essenziali e rinviando programmi privi di copertura materiale verificata.' },
        ],
      },
      {
        topic: 'Preparare la sicurezza territoriale',
        description: 'La pianificazione difensiva può rafforzare la prontezza senza inventare unità né aprire automaticamente nuove ostilità.',
        actions: [
          { title: 'Valutazione delle frontiere', content: 'Ordiniamo allo stato maggiore di valutare frontiere e collegamenti registrati, predisponendo opzioni logistiche proporzionate senza iniziare ostilità.' },
          { title: 'Piano di mobilitazione', content: 'Prepariamo un piano graduale di reclutamento e addestramento, subordinando ogni nuova formazione alla disponibilità documentata di personale ed equipaggiamento.' },
        ],
      },
      {
        topic: 'Mantenere aperta la diplomazia',
        description: `Per ${vars.PLAYER_POLITY}, contatti esplorativi prudenti possono chiarire intenzioni e condizioni senza dichiarare accordi inesistenti.`,
        actions: [
          { title: 'Riesame dei rapporti', content: 'Incarichiamo il ministero degli esteri di riesaminare i rapporti registrati, preparando contatti esplorativi senza promettere accordi o concessioni.' },
          { title: 'Garanzie verificabili', content: 'Formuliamo una proposta tecnica basata su reciprocità, calendario e verifiche, lasciando a ciascuna controparte la propria decisione autonoma.' },
        ],
      },
    ];
    const lastTurn = game.results.at(-1);
    const latest = lastTurn?.timelineEvents?.at(-1)?.headline || lastTurn?.events?.at(-1);
    if (latest) {
      const headline = clipConstrained(latest, 180);
      suggestions[1] = {
        topic: 'Dare seguito alla cronaca nazionale',
        description: `La cronaca registra «${headline}». Prima di cambiare la linea di ${vars.PLAYER_POLITY}, occorre chiarire gli effetti ancora aperti senza presumere nuovi sviluppi.`,
        actions: [
          { title: 'Valutare gli effetti', content: `Incarichiamo l’amministrazione di valutare gli effetti per ${vars.PLAYER_POLITY} dell’evento «${headline}», distinguendo fatti confermati e questioni ancora aperte.` },
          { title: 'Verificare gli impegni', content: `Riesaminiamo gli impegni nazionali collegati a «${headline}», individuando quali richiedano ancora una decisione senza autorizzare nuove spese.` },
        ],
      };
    }
    return suggestions.map(suggestion => ({ ...suggestion,
      description: `Proposta prudenziale di riserva: l’IA non ha restituito proposte utilizzabili. ${suggestion.description}`,
    }));
  }

  async getSuggestions(game: GameData): Promise<Suggestion[]> {
    const builder = new PromptBuilder(game);
    const vars = builder.buildVariables();

    const promptOverride = getPromptOverride(await resolveWorldPrompts(game), 'suggestions');
    const constrained = this.isConstrainedModel('suggestions');
    const basePrompt = promptOverride ? renderPromptTemplate(promptOverride, vars) : buildSuggestionsPrompt(vars);
    // Per i modelli free chiediamo meno schede e passiamo soltanto il teatro
    // rilevante: la qualità resta, ma la risposta difficilmente viene troncata.
    const prompt = (constrained
      ? `Genera fino a 4 temi fondati nella storia di ${vars.PLAYER_POLITY}, con 2-3 ordini alternativi per tema. Non riempire una quota se mancano fatti.\nTerritori/risorse: ${clipConstrained(vars.PLAYER_POLITY_REGIONS, 1_500)}\nForze: ${clipConstrained(vars.PLAYER_POLITY_BATTALION_SUMMARIES, 1_500)}\nStato: ${clipConstrained(vars.STRATEGIC_STATE, 3_000)}\nRegole scenario: ${clipConstrained(vars.HISTORICAL_PRESET_SIMULATION_RULES, 1_000)}\n${promptOverride ? `Regole preset: ${clipConstrained(basePrompt, 1_500)}\n` : ''}${buildNationalDecisionContext(vars)}\nRispondi SOLO: {"suggestions":[{"topic":"tema nazionale","description":"antefatto, problema aperto e motivo per decidere (40-75 parole)","actions":[{"title":"2-6 parole","content":"ordine contestualizzato, 20-45 parole"}]}]}`
      : basePrompt + (promptOverride ? buildNationalDecisionContext(vars) : ''))
      + buildSuggestionsQualityInstruction(vars);
    const system = 'Genera ordini strategici immediatamente giocabili in stile Pax Historia. Usa solo fatti presenti nel contesto e rispondi SOLO con JSON valido.';
    const options = { temperature: constrained ? 0.35 : 0.65, maxTokens: constrained ? 5_000 : 8_000 };
    const response = await this.llm.generate('suggestions', system, prompt, options);

    try {
      const parsed = parseSuggestionsResponse(response.content, true);
      if (constrained && parsed.length === 0) throw new Error('Risposta free senza proposte valide');
      return parsed;
    } catch {
      // Non lasciare per cinque minuti una risposta malformata nella cache:
      // invalida soltanto questa richiesta e prova una correzione più vincolata.
      this.llm.invalidateCache('suggestions', system, prompt);
      const retryPrompt = `${prompt}\n\n[CORREZIONE FORMATO]\nLa risposta precedente non era JSON utilizzabile. Produci ora soltanto l'oggetto JSON richiesto, senza premesse, Markdown o blocchi di codice.`;
      try {
        const retried = await this.llm.generate(
          'suggestions',
          system,
          retryPrompt,
          { temperature: 0.2, maxTokens: constrained ? 5_000 : 8_000 },
        );
        const parsed = parseSuggestionsResponse(retried.content, true);
        if (constrained && parsed.length === 0) throw new Error('Seconda risposta free senza proposte valide');
        return parsed;
      } catch {
        if (constrained) return this.safeSuggestionFallback(vars, game);
        const provider = this.llm.describe().suggestions.provider;
        throw new LLMError('Il modello non ha restituito proposte nel formato richiesto. Riprova.', {
          provider,
          mechanic: 'suggestions',
          retriable: true,
        });
      }
    }
  }

  async generateNarration(
    facts: string[],
    jumpDays: number,
    currentDate: string,
    playerPolity: string,
    language: string = 'italian'
  ): Promise<string> {
    const targetDate = this.calculateTargetDate(currentDate, jumpDays);

    const prompt = buildNarrationPrompt({
      facts,
      jumpDays,
      currentDate,
      targetDate,
      playerPolity,
      language,
    });

    const response = await this.llm.generate(
      'narration',
      'Sei il cronista di una storia alternativa. Scrivi con stile vivace ma sobrio.',
      prompt,
      { temperature: 0.7 }
    );

    return parseNarrationResponse(response.content);
  }

  private calculateTargetDate(startDate: string, days: number): string {
    return addDays(startDate, days);
  }

  private toGrammaticalDate(dateStr: string): string {
    return formatItalianDate(dateStr);
  }
}
