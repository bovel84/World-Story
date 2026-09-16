/**
 * World Story — GameDataService
 * =============================
 * Assemblaggio del read model `GameData` passato al motore di prompt e
 * all'LLM, estratto da `game-session.ts` (Fase 1). È pura lettura: non muta
 * lo stato di sessione, riceve tutto tramite `GameDataContext`.
 */

import { gameRepository } from '../repositories';
import { governmentSnapshot } from '../core/simulation/GovernmentFactions';
import { projectProgress } from '../core/simulation/MilitaryProduction';
import { arsenalCombatFactor, arsenalQualityIndex, arsenalStrength, naturalResourcesFor } from '../core/simulation/MilitaryIndustry';
import { effectiveEndowment, summarizeLedger } from '../core/simulation/ResourceMarket';
import { annualDebtServiceMld, creditHeadroom, creditLimit, debtOf, materialNeeds, storageCapacity, type ResourceStock } from '../core/simulation/MaterialEconomy';
import { averageMaturityYears } from '../core/simulation/SovereignDebt';
import { buildReactionContext, renderReactionContext, type CurrentReactionAction, type ReactionContext } from '../core/simulation/ReactionContext';
import { polityNameAliases } from '../utils/country-facts';
import { countryRepository } from '../repositories/country.repository';
import type { NationalAccount } from '../core/simulation/WorldStateEngine';
import type { ResourceLedger } from '../core/simulation/ResourceMarket';
import type { RegionState } from '../game-session';

export interface GameDataContext {
  gameId: string;
  players(): any[];
  regions(): Map<string, RegionState>;
  playerPolityId(): string;
  currentDate(): string;
  currentTurn(): number;
  difficulty(): any;
  consolidatedHistory(): string;
  keepRawTail(): number;
  worldName(): string;
  worldBasePrompt(): string;
  worldStartDate(): string;
  worldSimulationRules(): string | undefined;
  isStrictGame(): boolean;
  publicPolityName(polityId: string): string;
  sessionAccounts(): Record<string, NationalAccount>;
  arsenalUnits(polityId: string): Record<string, number>;
  peekArsenal(polityId: string): Record<string, number> | undefined;
  resourceStock(polityId: string): ResourceStock;
  resourceLedger(polityId: string): ResourceLedger;
  modifiersFor(polityId: string): any;
  productionOrders(): any[];
  governmentVoices(): { key: string; data: any } | null;
  governmentVoiceKey(): string;
  peekCrisis(): any;
  ending(): any;
  pendingFundingNotes(): string | null;
  buildNpcStrategicDossiers(focusTexts: string[], accounts: Record<string, NationalAccount>): string;
  relationships(): unknown;
  chatTranscripts(): unknown;
  actions(): any[];
  results(): any[];
}

export class GameDataService {
  constructor(private readonly ctx: GameDataContext) {}

  build(focusTexts: string[] = [], currentActions: CurrentReactionAction[] = []): any {
    const player = this.ctx.players()[0];

    // Convert regions Map to object for compatibility
    const regionsObj: Record<string, RegionState> = {};
    const regionsByPolity = new Map<string, RegionState[]>();
    for (const [id, region] of this.ctx.regions()) {
      regionsObj[id] = region;
      if (!regionsByPolity.has(region.owner)) regionsByPolity.set(region.owner, []);
      regionsByPolity.get(region.owner)!.push(region);
    }
    const polityNames: Record<string, string> = {};
    const polityAliases: Record<string, string[]> = {};
    for (const [owner] of regionsByPolity) {
      polityNames[owner] = this.ctx.publicPolityName(owner);
      // Codice stato, nome del registro e nome italiano — la stessa lista usata
      // dal resolver: un ordine può nominare la controparte in modi diversi dal
      // nome della regione e il contratto fail-closed deve poterla elencare.
      polityAliases[owner] = polityNameAliases(owner, countryRepository.findByCode(owner)?.name);
    }
    const accounts = this.ctx.sessionAccounts();
    // Arsenale della nazione giocatore: pesa sulla potenza militare effettiva.
    const playerArsenalUnits = this.ctx.arsenalUnits(this.ctx.playerPolityId());
    const playerArsenalFactor = arsenalCombatFactor(playerArsenalUnits,
      Number(accounts[this.ctx.playerPolityId()]?.forces || 0) + Number(accounts[this.ctx.playerPolityId()]?.mobilized || 0));
    // Potenza effettiva per tutte le politie con arsenale già noto (il
    // giocatore e ogni nazione NPC i cui armamenti sono stati seminati).
    const effectiveAccounts: typeof accounts = {};
    for (const [id, account] of Object.entries(accounts)) {
      const units = id === this.ctx.playerPolityId() ? playerArsenalUnits : this.ctx.peekArsenal(id);
      if (!units) { effectiveAccounts[id] = account; continue; }
      const factor = arsenalCombatFactor(units,
        Number(account.forces || 0) + Number(account.mobilized || 0));
      effectiveAccounts[id] = {
        ...account,
        arsenalStrength: arsenalStrength(units),
        arsenalCombatFactor: factor,
        effectiveMilitaryPower: Math.round(Number(account.militaryPower || 0) * factor * 10) / 10,
      } as NationalAccount;
    }

    // Righe DB riusate sia dal contesto di reazione sia dal read model.
    const pressureRows = gameRepository.listPressures(this.ctx.gameId, 'active');
    const processRows = gameRepository.getOngoingProcesses(this.ctx.gameId);
    const playerStock = this.ctx.resourceStock(this.ctx.playerPolityId());
    const playerAccountForContext = accounts[this.ctx.playerPolityId()];

    // Contesto di reazione: chi è coinvolto e quali opzioni sono ammesse. È
    // calcolato una volta sola perché serve sia al prompt (testo) sia al
    // validator deterministico delle reactions (forma strutturata).
    const reactionContextData: ReactionContext = buildReactionContext({
      playerPolityId: this.ctx.playerPolityId(),
      playerPolityName: polityNames[this.ctx.playerPolityId()],
      focusTexts,
      currentActions,
      polityNames,
      polityAliases,
      regions: regionsObj,
      relationships: this.ctx.relationships() as Record<string, Record<string, string>> | undefined,
      accounts: effectiveAccounts,
      resources: {
        debt: debtOf(playerStock),
        creditLimit: creditLimit(playerAccountForContext),
        creditHeadroom: creditHeadroom(playerStock, playerAccountForContext),
        stock: playerStock as unknown as Record<string, number>,
      },
      government: {
        factions: governmentSnapshot(playerAccountForContext).factions.map(faction => ({
          id: faction.id, name: faction.name, pressure: faction.pressure, stance: faction.stance,
        })),
      },
      pressures: pressureRows.map(record => ({ id: record.id, kind: record.kind, title: record.title, detail: record.detail })),
      ongoingProcesses: processRows.map((process: any) => ({ id: process.id, title: process.title, sourceActionId: process.source_action_id })),
      crisis: { level: this.ctx.peekCrisis().level, headline: this.ctx.peekCrisis().headline },
    });

    return {
      id: this.ctx.gameId,
      currentDate: this.ctx.currentDate(),
      currentTurn: this.ctx.currentTurn(),
      difficulty: this.ctx.difficulty(),
      consolidatedHistory: this.ctx.consolidatedHistory(),
      consolidationTail: this.ctx.keepRawTail(),
      // Stato materiale del mondo: è ricostruito dal motore deterministico
      // dalla mappa e quindi non può contraddire la memoria narrativa.
      worldState: {
        accounts: effectiveAccounts,
        resources: (() => {
          const stock = this.ctx.resourceStock(this.ctx.playerPolityId());
          const account = accounts[this.ctx.playerPolityId()];
          return {
            stock,
            account,
            natural: summarizeLedger(this.ctx.resourceLedger(this.ctx.playerPolityId()), account),
            debt: Math.round(debtOf(stock) * 100) / 100,
            annualInterest: Math.round(annualDebtServiceMld(stock) * 100) / 100,
            averageMaturityYears: averageMaturityYears(stock.debts, this.ctx.currentDate()),
            creditLimit: creditLimit(account),
            creditHeadroom: Math.round(creditHeadroom(stock, account) * 100) / 100,
            capacity: storageCapacity(account),
            needs: materialNeeds(account),
          };
        })(),
        // Ordini di produzione in corso con percentuale di completamento.
        production: this.ctx.productionOrders()
          .filter(order => order.status === 'in_progress')
          .map(order => ({ id: order.id, name: order.name, quantity: order.quantity, progress: Math.round(order.progress), note: order.note })),
        // Modificatori nazionali attivi (proposti dal modello, poi decadono).
        modifiers: this.ctx.modifiersFor(this.ctx.playerPolityId()),
        // Arsenale e risorse naturali: tratti materiali della nazione, non
        // inventati dal modello. Il catalogo completo resta nelle API.
        arsenal: {
          units: playerArsenalUnits,
          strength: arsenalStrength(playerArsenalUnits),
          qualityIndex: arsenalQualityIndex(playerArsenalUnits),
          naturalResources: effectiveEndowment(this.ctx.resourceLedger(this.ctx.playerPolityId()), naturalResourcesFor(this.ctx.playerPolityId())),
        },
        // Potenza militare effettiva: è il numero su cui si risolvono i
        // combattimenti narrati (potenza mappa × qualità/copertura dell'arsenale).
        military: {
          combatFactor: playerArsenalFactor,
          baseMilitaryPower: Math.round(Number(accounts[this.ctx.playerPolityId()]?.militaryPower || 0)),
          effectiveMilitaryPower: Math.round(Number(accounts[this.ctx.playerPolityId()]?.militaryPower || 0) * playerArsenalFactor * 10) / 10,
        },
        // Anime del governo: chi preme dentro la nazione. Il motore le calcola
        // dalle stesse cifre del dossier; le voci LLM, se generate, restano
        // valide solo per il turno corrente e non attraversano il salto.
        government: governmentSnapshot(accounts[this.ctx.playerPolityId()]),
        governmentVoices: this.ctx.governmentVoices()?.key === this.ctx.governmentVoiceKey()
          ? this.ctx.governmentVoices()?.data
          : undefined,
        // Sfide del momento: generate dal motore, scelte dal giocatore. Il
        // narratore le riceve come fatti aperti, non come invenzioni.
        pressures: pressureRows.map(record => ({
          id: record.id,
          kind: record.kind,
          title: record.title,
          detail: record.detail,
          severity: record.severity,
          source: record.source,
          options: record.options.map(option => ({ id: option.id, label: option.label, detail: option.detail })),
        })),
        // Crisi: il narratore deve sapere quanto la nazione è vicina al
        // collasso, per non raccontare un successo che la realtà smentisce.
        crisis: (() => {
          const state = this.ctx.peekCrisis();
          return {
            level: state.level,
            headline: state.headline,
            summary: state.summary,
            risks: state.risks.map((risk: any) => ({
              dimension: risk.dimension,
              level: risk.level,
              score: risk.score,
              title: risk.title,
              drivers: risk.drivers,
              streak: state.streaks[risk.dimension],
            })),
          };
        })(),
        ending: this.ctx.ending()
          ? { kind: this.ctx.ending().kind, title: this.ctx.ending().title, summary: this.ctx.ending().summary }
          : undefined,
        // Ordini senza copertura: il narratore sa già che non possono riuscire.
        orderFunding: this.ctx.pendingFundingNotes() ?? undefined,
      },
      world: {
        name: this.ctx.worldName(),
        basePrompt: this.ctx.worldBasePrompt(),
        startDate: this.ctx.worldStartDate() || this.ctx.currentDate(),
        regions: regionsObj,
      },
      // Этап 5: правила симуляции мира → HISTORICAL_PRESET_SIMULATION_RULES
      simulationRules: this.ctx.worldSimulationRules() ?? undefined,
      // Gli adapter permissivi per modelli free restano disattivati nelle
      // partite strict, che devono fallire chiuse su ogni protocollo invalido.
      strictMode: this.ctx.isStrictGame(),
      players: this.ctx.players().map(p => ({
        id: p.id,
        name: p.polityId === this.ctx.playerPolityId() ? this.ctx.publicPolityName(this.ctx.playerPolityId()) : p.name,
        regionId: p.regionId,
        polityId: p.polityId,
      })),
      playerPolityId: this.ctx.playerPolityId(),
      playerPolityName: polityNames[this.ctx.playerPolityId()],
      polityNames,
      // Stato diplomatico persistente: il prompt usa questi rapporti per
      // motivare le reazioni delle altre politie, non per inventarle.
      relationships: this.ctx.relationships(),
      // Identità stabile + priorità dinamiche + memoria per le politie davvero
      // rilevanti al teatro corrente. È la stessa fonte usata dalle chat.
      npcStrategicProfiles: this.ctx.buildNpcStrategicDossiers(focusTexts, accounts),
      // Il motore decide chi è coinvolto e quali opzioni sono materialmente
      // possibili: il prompt riceve un contesto già filtrato e limitato.
      // `currentActions` è il lotto del turno corrente (con ID canonico): lo
      // storico azioni non entra mai nel trigger.
      reactionContext: renderReactionContext(reactionContextData),
      // Stesso contesto in forma strutturata: serve al validator deterministico
      // delle reactions (actorId/optionId) nel percorso di simulazione.
      reactionContextData,
      // I progetti attivi sono contesto canonico anche senza nuovi ordini.
      // LLM riceve ID e date, non deve riconoscerli per titolo.
      ongoingProcesses: processRows.map((process: any) => ({
        id: process.id,
        sourceActionId: process.source_action_id,
        title: process.title,
        summary: process.summary,
        startedDate: process.started_date,
        expectedDate: process.expected_date || undefined,
        // Percentuale di completamento calcolata dal motore, non dal modello.
        progress: Number(process.progress) >= 0 && process.progress !== null
          ? Number(process.progress)
          : projectProgress(process.started_date, process.expected_date, this.ctx.currentDate()),
        progressNote: process.progress_note || undefined,
      })),
      actions: this.ctx.actions(),
      results: this.ctx.results(),
      // Le trattative diplomatiche entrano nella simulazione (i patti contano)
      chatTranscripts: this.ctx.chatTranscripts(),
    };
  }
}
