/**
 * World Story — Prompt Builder
 * =========================
 * Сервис для построения переменных промптов
 */

import { PromptVariables, SimulationResult, SimulationEvent, ConvertedAction, Suggestion, AdvisorMessage, difficultyPromptBlock, normalizeDifficulty } from './prompts';
import {
  buildSimulationPrompt,
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
import { addDays, formatItalianDate } from './core/simulation/calendar';
import { getPromptOverride, renderPromptTemplate, PromptOverrides } from './prompts/override';
import { LLMRouter } from './llm';

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
    monthlyRevenue: number;
    monthlyExpenses: number;
    monthlyBalance: number;
    annualGrowthRate: number;
    stability: number;
    nominalGdpUsdBillions: number;
    gdpPerCapitaUsd: number;
    government: string;
  }> };  
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
    return processes.map(process => {
      const due = process.expectedDate
        ? ` — completamento previsto: ${process.expectedDate}`
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
      lines.push(`Dossier nazionale calcolato dal motore: governo ${playerAccount.government}; popolazione ${fmt(playerAccount.population)}; PIL nominale stimato ${fmt(playerAccount.nominalGdpUsdBillions)} miliardi USD; PIL pro capite circa ${fmt(playerAccount.gdpPerCapitaUsd)} USD; entrate mensili ${fmt(playerAccount.monthlyRevenue)}; uscite mensili ${fmt(playerAccount.monthlyExpenses)}; saldo ${fmt(playerAccount.monthlyBalance)}; crescita annua ${(playerAccount.annualGrowthRate * 100).toFixed(1)}%; stabilità ${playerAccount.stability}/100; infrastrutture: ${playerAccount.factories} fabbriche, ${playerAccount.ports} porti, ${playerAccount.universities} università.`);
    }

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
          ? `; PIL ${fmt(account.gdp)}, saldo mensile ${fmt(account.monthlyBalance)}, stabilità ${account.stability}/100`
          : '';
        lines.push(`- ${this.polityDisplayName(owner, allOwned)} [${owner}]: rapporto ${relation}; confina tramite ${borderRegions.map(region => region.name).join(', ')}; potenza militare stimata ${fmt(sum(allOwned, 'militaryPower'))}${economy}.`);
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

  // Battaglioni del giocatore, raggruppati per regione per evitare che il
  // generatore proponga movimenti di unità inesistenti o nel posto sbagliato.
  private buildPlayerBattalions(playerRegionId: string, playerPolityId?: string): string {
    const allRegions = getAllRegions(this.game.world.regions);
    const fallback = getRegion(this.game.world.regions, playerRegionId);
    const owned = playerPolityId
      ? allRegions.filter(region => region.owner === playerPolityId)
      : (fallback ? [fallback] : []);

    const placements = owned.flatMap(region => {
      const count = (region.objects || []).filter((object: any) => object.type === 'battalion').length;
      return count > 0 ? [`${count} unità in ${region.name}`] : [];
    });

    return placements.length > 0 ? placements.join('; ') : 'Nessuna unità militare registrata sulla mappa';
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

  // Cronaca di un singolo turno: narrazione + dettaglio completo degli eventi.
  // Includere i dettagli (non solo il riassunto) è essenziale perché l'LLM
  // possa mantenere continuità: senza, gli eventi dei turni successivi
  // risultano scollegati e casuali.
  private formatTurnHistory(r: TurnResultData): string {
    const lines: string[] = [`Turno ${r.turn}: ${this.compact(r.narration, 420)}`];
    const events = (r.timelineEvents?.length
      ? r.timelineEvents
      : (r.events || []).map((headline, index) => ({
          id: `${r.id}-${index}`,
          date: r.date || '',
          headline,
          detail: '',
        })))
      .slice(-4);
    for (const ev of events) {
      const date = ev.date ? ` (${ev.date})` : '';
      const headline = this.compact(ev.headline, 160);
      const detail = this.compact(ev.detail || '', 280);
      lines.push(detail && detail !== headline
        ? `  • ${headline}${date}: ${detail}`
        : `  • ${headline}${date}`);
    }
    return lines.join('\n');
  }

  // История событий: консолидированное саммари ранних раундов + сырой хвост
  private buildEventHistory(): string {
    if (this.game.results.length === 0 && !this.game.consolidatedHistory) return '';

    const consolidated = this.game.consolidatedHistory?.trim();
    // La memoria canonica è già un riassunto. Il resto è una finestra corta
    // di fatti recenti: basta a proseguire le catene causali senza duplicare
    // centinaia di turni in ogni chiamata.
    const rawTail = this.game.results.slice(-5);
    const recent = rawTail.map(r => this.formatTurnHistory(r)).join('\n\n');
    if (!consolidated) return this.compact(recent, 6_000);

    const out = `[Memoria canonica dei turni precedenti]\n${this.compact(consolidated, 3_600)}`
      + (recent ? `\n\n[Ultimi 5 turni — fatti verificabili]\n${recent}` : '');
    return this.compact(out, 8_000);
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
    // Пресетный шаблон заменяет дефолтный промпт целиком; правила auto-jump
    // (если режим включён) дописываем после него, чтобы механика не ломалась.
    const basePrompt = promptOverride
      ? renderPromptTemplate(promptOverride, vars)
        + buildCausalityGuard(vars)
        + (autoJump ? buildAutoJumpInstruction(vars) : '')
      : buildSimulationPrompt(vars, { autoJump });
    // Budget basso: privilegiamo una catena di conseguenze credibile rispetto
    // a una lista di notizie scollegate. Il modello può sempre concludere prima.
    const maxEvents = autoJump ? 1 : Math.min(12, Math.max(1, Math.ceil(jumpDays / 21)));
    // Anche un override del preset riceve il contratto canonico: può definire
    // il mondo, non rimuovere causalità, autonomia del giocatore e rigore
    // della cronaca. Con gli override riportiamo esplicitamente il canone.
    const prompt = basePrompt
      + buildSimulationNarrativeContract(vars, Boolean(promptOverride))
      + buildIncrementalOutputInstruction(vars, maxEvents, !!autoJump);

    let parsedObjectCount = 0;
    let emittedCount = 0;
    const emitted = new Set<string>();
    const emitEvent = (event: SimulationEvent) => {
      const key = JSON.stringify(event);
      if (emitted.has(key)) return;
      emitted.add(key);
      onEvent?.(event, emittedCount++);
    };

    // system — короткая ролевая инструкция, user — большой промпт.
    // Ogni volta che nello stream si chiude un oggetto JSON `event`, lo
    // normalizziamo e lo consegniamo subito alla sessione di gioco.
    const response = await this.llm.stream(
      'jump',
      'Sei il simulatore di una storia alternativa. Ogni evento deve derivare esplicitamente da ordini, cronaca, diplomazia o stato della mappa forniti; non inventare eventi indipendenti. Produci JSON Lines valido.',
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
      { temperature: 0.7, jsonMode: false, signal }
    );

    const result = parseIncrementalSimulationResponse(response.content);
    // Provider senza streaming o modello che usa ancora il vecchio formato:
    // preserva la compatibilità, pubblicando gli eventi appena arriva la risposta.
    for (const event of result.events) emitEvent(event);
    return result;
  }

  async convertAction(game: GameData, actionText: string, signal?: AbortSignal): Promise<ConvertedAction> {
    const builder = new PromptBuilder(game);
    const vars = builder.buildVariablesForAction(actionText);

    const promptOverride = getPromptOverride(await resolveWorldPrompts(game), 'converter');
    const prompt = promptOverride ? renderPromptTemplate(promptOverride, vars) : buildConverterPrompt(vars);
    // F05 µ2: l’abort del run arresto arriva fino agli adattatori, convertitore compreso.
    const response = await this.llm.generate(
      'converter',
      'Sei l\'analista degli ordini in un gioco strategico globale. Rispondi SOLO con JSON.',
      prompt,
      { temperature: 0.5, signal }
    );

    return parseConverterResponse(response.content);
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

    const prompt = buildBatchConverterPrompt(vars, normalized.map((action, index) => ({
      // Le chiamate pubbliche legacy senza ID restano leggibili, ma non
      // attraversano il percorso canonico GameSession → GameController.
      actionId: action.actionId || `legacy-converter-${index + 1}`,
      text: action.text,
    })));
    const response = await this.llm.generate(
      'converter',
      'Sei l\'analista degli ordini in un gioco strategico globale. Rispondi SOLO con JSON.',
      prompt,
      { temperature: 0.5 }
    );

    return parseBatchConverterResponse(response.content).map(converted => {
      if (converted.actionId) return converted;
      // Adapter esplicito per il vecchio converter: solo un `index` dichiarato
      // dal provider può riallacciare l'output, mai l'ordine dell'array.
      const source = converted.legacyIndex ? normalized[converted.legacyIndex - 1] : undefined;
      return { ...converted, actionId: source?.actionId };
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

  async getSuggestions(game: GameData): Promise<Suggestion[]> {
    const builder = new PromptBuilder(game);
    const vars = builder.buildVariables();

    const promptOverride = getPromptOverride(await resolveWorldPrompts(game), 'suggestions');
    const basePrompt = promptOverride ? renderPromptTemplate(promptOverride, vars) : buildSuggestionsPrompt(vars);
    // Le regole di qualità sono sempre applicate, anche ai prompt salvati nei
    // preset o già persistiti nel DB.
    const prompt = basePrompt + buildSuggestionsQualityInstruction(vars);
    const response = await this.llm.generate(
      'suggestions',
      'Genera ordini strategici immediatamente giocabili in stile Pax Historia. Usa solo fatti presenti nel contesto e rispondi SOLO con JSON valido.',
      prompt,
      { temperature: 0.65, maxTokens: 5500 }
    );

    return parseSuggestionsResponse(response.content);
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
