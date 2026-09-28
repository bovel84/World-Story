/**
 * World Story — OrderExecutionService
 * ===================================
 * Preparazione ed economia degli ordini del giocatore, estratta da
 * `game-session.ts` (Fase 1).
 *
 * È un servizio **senza stato proprio**: la coda viva resta in `GameSession`
 * (l'orchestrazione dei checkpoint la legge e la sostituisce), mentre qui vive
 * la logica deterministica:
 *  - stima del costo di un ordine;
 *  - addebito e declassamento degli esiti quando cassa+credito non bastano;
 *  - vincoli di finanziamento consegnati al narratore;
 *  - risoluzione canonica degli esiti LLM per actionId;
 *  - fattibilità e riformulazione (assessment + costi) via LLM/catalogo.
 *
 * Il motore decide cosa è materialmente applicabile; l'LLM propone solo entro
 * quei vincoli.
 */

import path from 'path';
import { shortId } from '../utils/short-id';
import { affordableCharge, describeOrderCost, estimateOrderCost, type OrderCostEstimate } from '../core/simulation/OrderCost';
import { creditHeadroom, type ResourceStock } from '../core/simulation/MaterialEconomy';
import { worldRepository, gameRepository } from '../repositories';
import { loadSimulationCatalog } from '../scenario/loader';
import { FeasibilityService, type OrderAssessment, type ReasonCode } from '../core/feasibility/FeasibilityService';
import { strictReadingsFor } from './PreflightReadings';
import { resolveWorkHolders } from './WorkHolders';
import { normalizeOrderIntent } from '../core/feasibility/intent';
import { estimateIntentCosts, type CostEstimate } from '../core/feasibility/costs';
import type { ActionOutcome, ConvertedAction } from '../prompts/types';
import type { NationalAccount } from '../core/simulation/WorldStateEngine';
import type { TimelineEventRecord } from './TimelineService';

/**
 * Effetto materiale di una decisione sulla tesoreria, in forma strutturata.
 * Prodotto dal motore nello stesso punto in cui addebita la spesa ordinata:
 * nessun valore ricostruito o stimato a posteriori.
 */
export interface OrderSettlementEntry {
  actionId: string;
  /** `charged` = pagata per intero; `partial` = coperta solo in parte; `unfunded` = annullata. */
  kind: 'charged' | 'partial' | 'unfunded';
  /** Importo richiesto dalla stima del motore (mld). */
  requestedMld: number;
  /** Importo davvero addebitato alla tesoreria (mld; 0 se non coperta). */
  chargedMld: number;
  /** Categoria leggibile della stima (es. «Infrastrutture»). */
  label: string;
}

/** Ordine in coda: stato posseduto da questo servizio. */
/**
 * MG02 µ4 — Un ordine che è una COSTRUZIONE dichiarata.
 *
 * L'ordine in coda è normalmente testo libero, e il testo non basta a decidere
 * cosa costruire: la distinta sta nel catalogo. Quando il client ha già una
 * valutazione e sa quale opera sta ordinando, lo dichiara QUI — catalogo e
 * detentori, non quantità: il prezzo e i materiali restano quelli del catalogo
 * e nessun numero viene dal testo o dal modello.
 *
 * Chi non lo dichiara ottiene il comportamento di prima: l'ordine viaggia come
 * prosa e nessun cantiere nasce. Inventare la distinta dal testo libero
 * significherebbe far decidere al modello quanto costa un'opera.
 */
/**
 * MG02 µ6 — La dichiarazione d'opera risolta dal server e rimandata al client.
 * Il client non la inventa: la riceve con la valutazione e la rimanda nella
 * coda. `materialActorId: null` significa che nessun attore della nazione copre
 * tutti i materiali, e `missingMaterials` dice quanto manca.
 */
export interface WorkDeclaration {
  readonly workId: string;
  readonly payerActorId: string;
  readonly materialActorId: string | null;
  readonly funded: boolean;
  readonly missingMaterials: readonly { readonly resourceId: string; readonly missing: string }[];
  readonly note?: string;
}

export interface PendingWorkOrder {
  /** Opera del catalogo (`works.json`): la distinta entra da qui. */
  readonly workId: string;
  /** Chi paga: il conto monetario dell'impegno. */
  readonly payerActorId: string;
  /** Presso chi stanno i materiali: può differire da chi paga. */
  readonly materialActorId: string;
  /** Se il preflight ha dichiarato l'opera coperta. Un ordine non coperto non
   *  si impegna: il commit fallirebbe, e l'esito deve dirlo invece di fallire
   *  il turno. */
  readonly funded: boolean;
}

export interface PendingAction {
  id: string;
  text: string;
  createdAt: string;
  /** MG02 µ4: presente solo se l'ordine è una costruzione dichiarata. */
  workOrder?: PendingWorkOrder;
  /** Adapter UI legacy; le due dimensioni sotto sono autorevoli per F01. */
  status: 'pending' | 'processing' | 'completed';
  deliveryStatus?: 'queued' | 'issued' | 'cancelled';
  executionStatus?: 'not_started' | 'in_progress' | 'completed' | 'failed' | 'rejected' | 'cancelled';
  result?: {
    narration: string;
    countryResponse: string;
    events: string[];
    /** Eventi canonici, con ID persistito e data propria. */
    eventDetails?: TimelineEventRecord[];
    simulationId?: string;
    /** MG02 µ4 — il cantiere nato da questo ordine: è il legame causale fra la
     *  decisione e l'opera, e la Timeline può risalirvi. Presente solo quando
     *  un progetto è stato davvero impegnato. */
    projectId?: string;
    outcome?: {
      status: 'accepted' | 'partial' | 'rejected';
      summary: string;
      expectedDate?: string;
      completesProjectId?: string;
    };
    objects: any[];
    /**
     * DECISION-IMPACT: effetto misurabile già calcolato dal motore per questa
     * decisione (addebito in tesoreria, copertura parziale, ordine annullato).
     * Assente quando l'ordine non è stato eseguito o in modalità strict.
     */
    settlement?: OrderSettlementEntry;
    turn: number;
    periodStart: string;  // Date before processing this action
    periodEnd: string;    // Date after processing this action
  };
}

/** Ordine minimo richiesto dagli helper economici. */
export interface OrderLike {
  id: string;
  text: string;
}

/** Dipendenze fornite da GameSession: stato che NON appartiene a questo dominio. */
export interface OrderExecutionContext {
  readonly gameId: string;
  /** Guardia di giocabilità (partita finita → GameOverError). */
  assertPlayable(): void;
  readonly worldId: string;
  isStrictGame(): boolean;
  playerPolityId(): string;
  /** Polity del giocatore dal profilo, `undefined` se assente (fattibilità). */
  playerPolity(): string | undefined;
  /** MG02 µ1 — ramo head della partita: dove sta il ledger da leggere. */
  branchId(): string | null;
  /** MG02 µ1 — la partita persiste il ledger? (`isStrictGame` guarda la modalità). */
  economyMode(): 'legacy' | 'strict';
  accounts(): Record<string, NationalAccount>;
  resourceStock(polityId: string): ResourceStock;
  saveResourceStock(polityId: string, stock: ResourceStock): void;
  buildGameData(): any;
  /** Riformulazione via GameController. */
  enhanceOrder(gameData: any, text: string): Promise<{ text: string }>;
  /** Conversione testo→intent via PromptEngine. */
  convertActionsBatch(gameData: any, actions: Array<{ actionId: string; text: string }>): Promise<ConvertedAction[]>;
}

export class OrderExecutionService {
  /** Coda ordini viva: posseduta qui, letta dall'orchestrazione via `queue()`. */
  private pendingActions: PendingAction[] = [];

  constructor(private readonly ctx: OrderExecutionContext) {}

  /** Riferimento vivo alla coda: l'orchestrazione filtra/legge senza copie. */
  queue(): PendingAction[] {
    return this.pendingActions;
  }

  /** Sostituisce l'intera coda (restore/salvataggio/playback in pausa). */
  replaceQueue(actions: PendingAction[]): void {
    this.pendingActions = actions;
  }

  /** Copia difensiva della coda (checkpoint/snapshot). */
  snapshot(): PendingAction[] {
    return this.pendingActions.map(action => ({ ...action }));
  }

  /**
   * Add action to pending queue (without processing)
   */
  enqueue(text: string, workOrder?: PendingWorkOrder): PendingAction {
    this.ctx.assertPlayable();
    const action: PendingAction = {
      id: shortId(),
      text,
      createdAt: new Date().toISOString(),
      ...(workOrder ? { workOrder } : {}),
      status: 'pending',
      deliveryStatus: 'queued',
      executionStatus: 'not_started',
    };
    this.pendingActions.push(action);
    gameRepository.queuePendingAction({
      id: action.id,
      gameId: this.ctx.gameId,
      text: action.text,
      createdAt: action.createdAt,
      status: action.status,
      // MG02 µ5: la dichiarazione d'opera va nel database, non solo in RAM.
      ...(workOrder ? { workOrder } : {}),
    });
    console.log('[GameSession] Queued action:', action.id, 'text:', text.substring(0, 50));
    return action;
  }

  getPendingActions(): PendingAction[] {
    return this.pendingActions;
  }

  getQueueVersion(): number {
    return gameRepository.getQueueVersion(this.ctx.gameId);
  }

  /** Rimuove dalla coda un ordine non ancora avviato. */
  removePendingAction(actionId: string): boolean {
    const index = this.pendingActions.findIndex(action => action.id === actionId && action.status === 'pending');
    if (index < 0) return false;
    if (!gameRepository.removePendingAction(this.ctx.gameId, actionId)) return false;
    this.pendingActions.splice(index, 1);
    return true;
  }

  /**
   * Modifica il testo di un ordine ancora in coda (prima della presa in
   * carico). La modifica è persistita: non è soltanto un nascondimento in UI.
   * Un ordine già emesso/elaborato non può essere riscritto retroattivamente.
   */
  updatePendingAction(actionId: string, newText: string): PendingAction | null {
    const trimmed = newText.trim();
    if (!trimmed) return null;
    const action = this.pendingActions.find(item => item.id === actionId && item.status === 'pending');
    if (!action) return null;
    if (!gameRepository.updatePendingActionText(this.ctx.gameId, actionId, trimmed)) return null;
    action.text = trimmed;
    return action;
  }

  /** Clear completed actions from queue */
  clearCompletedActions(): void {
    this.pendingActions = this.pendingActions.filter(a => a.status !== 'completed');
  }

  /**
   * Costo deterministico di un ordine in testo libero, dal conto nazionale.
   * È la stessa stima che l'interfaccia mostra prima di registrare l'ordine.
   */
  estimateOrderCost(text: string): OrderCostEstimate {
    return estimateOrderCost(text, this.ctx.accounts()[this.ctx.playerPolityId()]);
  }

  /**
   * Addebita alla tesoreria gli ordini che il run ha **eseguito** (esito
   * accettato o parziale): la cassa segue le scelte del giocatore. Se la cassa
   * più il credito residuo non bastano, si paga quanto è coperto e il resto
   * resta dichiarato come non onorato — il tetto del debito non si sfonda.
   *
   * Restituisce anche `entries`: la stessa contabilità in forma **strutturata**
   * (una voce per decisione), così il client può attribuire alla singola
   * decisione l'effetto misurabile senza interpretare il testo del bollettino.
   */
  settleOrderCosts(
    actionOutcomes: Array<{ actionId?: string; action?: string; status?: string }> | undefined,
    batchActionIds: string[],
    texts: Map<string, string>,
  ): { lines: string[]; unfunded: Array<{ actionId: string; action: string; reason: string }>; entries: OrderSettlementEntry[] } {
    const empty = { lines: [] as string[], unfunded: [] as Array<{ actionId: string; action: string; reason: string }>, entries: [] as OrderSettlementEntry[] };
    if (this.ctx.isStrictGame()) return empty;
    const polityId = this.ctx.playerPolityId();
    const account = this.ctx.accounts()[polityId];
    if (!account || batchActionIds.length === 0) return empty;
    // Un esito può arrivare per id oppure per testo dell'ordine (contratto
    // legacy): entrambe le chiavi sono accettate, come in outcomesByActionId.
    // Conserviamo il riferimento all'esito per poterlo declassare quando i
    // soldi non bastano: la realtà dell'ordine la decide il motore, non la
    // narrazione.
    const byAction = new Map<string, { status: string; outcome: { status?: string } }>();
    for (const outcome of actionOutcomes || []) {
      const status = String(outcome.status || '');
      const entry = { status, outcome: outcome as { status?: string } };
      if (outcome.actionId) byAction.set(String(outcome.actionId), entry);
      if (outcome.action) byAction.set(`text:${outcome.action}`, entry);
    }
    const lines: string[] = [];
    const unfunded: Array<{ actionId: string; action: string; reason: string }> = [];
    const entries: OrderSettlementEntry[] = [];
    for (const actionId of batchActionIds) {
      const text = texts.get(actionId) || '';
      const entry = byAction.get(actionId) ?? byAction.get(`text:${text}`);
      const status = entry?.status;
      if (status !== 'accepted' && status !== 'partial') continue;
      if (!text.trim()) continue;
      const estimate = this.estimateOrderCost(text);
      const stock = this.ctx.resourceStock(polityId);
      // Il tetto del debito non si sfonda: si paga quanto cassa + credito coprono.
      const { charge, shortfall } = affordableCharge(estimate.amountMld, stock.money, creditHeadroom(stock, account));
      if (charge <= 0) {
        // Nessuna copertura: l'ordine non è attuabile e il motore lo annulla.
        // Il giocatore non può comprare ciò che non può pagare.
        const reason = `la cassa non copre l'ordine (${estimate.label}, ${estimate.amountMld} mld) e il credito è esaurito`;
        unfunded.push({ actionId, action: text, reason });
        entries.push({ actionId, kind: 'unfunded', requestedMld: estimate.amountMld, chargedMld: 0, label: estimate.label });
        entry!.outcome.status = 'voided';
        entry!.status = 'voided';
        lines.push(`La cassa non copre l'ordine «${text.slice(0, 60)}» (${estimate.label}, ${estimate.amountMld} mld): ordine annullato, nessuna spesa registrata.`);
        continue;
      }
      const nextStock: ResourceStock = { ...stock, money: Math.round((stock.money - charge) * 1000) / 1000 };
      this.ctx.saveResourceStock(polityId, nextStock);
      const partial = shortfall > 0.01;
      entries.push({
        actionId,
        kind: partial ? 'partial' : 'charged',
        requestedMld: estimate.amountMld,
        chargedMld: charge,
        label: estimate.label,
      });
      lines.push(`💸 ${describeOrderCost({ ...estimate, amountMld: charge }, text)}`);
      if (partial) {
        // Copertura parziale: nessun successo pieno. L'esito scende a
        // "partial" anche se il modello l'aveva dichiarato completo.
        if (entry) {
          entry.outcome.status = 'partial';
          entry.status = 'partial';
        }
        lines.push(`L'ordine è stato finanziato solo in parte (${charge} mld su ${estimate.amountMld}): il credito residuo è esaurito.`);
      }
    }
    return { lines, unfunded, entries };
  }

  /**
   * Ordini che cassa e credito non possono coprire: al narratore arrivano
   * come vincoli già decisi, con l'esito atteso («voided» o «partial»).
   */
  orderFundingNotes(actions: OrderLike[]): string | null {
    if (actions.length === 0) return null;
    const polityId = this.ctx.playerPolityId();
    const account = this.ctx.accounts()[polityId];
    if (!account) return null;
    const stock = this.ctx.resourceStock(polityId);
    const headroom = creditHeadroom(stock, account);
    const lines: string[] = [];
    for (const action of actions) {
      if (!action.text.trim()) continue;
      const estimate = estimateOrderCost(action.text, account);
      if (estimate.amountMld <= 0) continue;
      const { charge, shortfall } = affordableCharge(estimate.amountMld, stock.money, headroom);
      if (charge <= 0) {
        lines.push(`- [actionId:${action.id}] «${action.text.slice(0, 90)}» costa ${estimate.amountMld} mld: cassa e credito non coprono nulla. Non può riuscire — nel periodo esso fallisce o resta sulla carta: outcome "voided".`);
      } else if (shortfall > 0.01) {
        lines.push(`- [actionId:${action.id}] «${action.text.slice(0, 90)}» costa ${estimate.amountMld} mld ma solo ${charge} mld sono coperti: nessun successo pieno — outcome "partial" e risultato dimezzato.`);
      }
    }
    return lines.length > 0 ? lines.join('\n') : null;
  }

  /**
   * Risolve gli esiti LLM con la chiave canonica. Il testo è ammesso soltanto
   * nell'adapter legacy e solo quando individua una singola azione convertita:
   * testi duplicati, ID ignoti o outcome ripetuti sono errori di protocollo.
   */
  outcomesByActionId(
    actions: OrderLike[],
    outcomes: ActionOutcome[] | undefined,
    convertedActions: ConvertedAction[] | undefined,
  ): Map<string, ActionOutcome> {
    const result = new Map<string, ActionOutcome>();
    const knownIds = new Set(actions.map(action => action.id));
    const converted = convertedActions || [];

    // Avanzamento del solo mondo (nessun ordine nel lotto): un esito emesso
    // dal provider non è attribuibile ad alcun ordine e non può mutare nulla.
    // Ignorarlo evita che una riga spuria faccia fallire un turno world-only,
    // mentre senza ordini reali il fail-closed non protegge niente.
    if (actions.length === 0) {
      if ((outcomes || []).length > 0) {
        console.warn('[GameSession] outcomesByActionId: ignorati', outcomes!.length, 'esiti senza ordini nel lotto');
      }
      return result;
    }

    for (const outcome of outcomes || []) {
      let actionId = outcome.actionId;
      if (!actionId) {
        const candidates = new Set<string>();
        for (const action of actions) {
          if (action.text === outcome.action) candidates.add(action.id);
        }
        for (const action of converted) {
          if (action.actionId && action.text === outcome.action) candidates.add(action.actionId);
        }
        if (candidates.size !== 1) {
          throw new Error('simulation_protocol_error: legacy outcome is ambiguous or unresolved; actionId is required');
        }
        actionId = [...candidates][0];
      }
      if (!knownIds.has(actionId) || result.has(actionId)) {
        throw new Error('simulation_protocol_error: outcome actionId is unknown or duplicated');
      }
      result.set(actionId, outcome);
    }
    return result;
  }

  /**
   * G24 — «Migliora formulazione»: produce un'anteprima riformulata di un
   * ordine libero SENZA accodarla né simulare. L'accettazione resta un click
   * esplicito del giocatore. Non altera il tempo né la coda.
   */
  async enhanceAction(text: string): Promise<{ original: string; enhanced: string }> {
    const trimmed = text.trim();
    if (!trimmed) throw new Error('Il testo dell’ordine è obbligatorio');
    const converted = await this.ctx.enhanceOrder(this.ctx.buildGameData(), trimmed);
    const enhanced = converted.text && converted.text.trim() ? converted.text.trim() : trimmed;
    return { original: trimmed, enhanced };
  }

  /**
   * G4-B — verifica fattibilità da testo libero (sola lettura).
   * Delega a checkFeasibilityWithCosts e restituisce solo l'assessment.
   */
  async checkFeasibility(text: string): Promise<OrderAssessment> {
    const { assessment } = await this.checkFeasibilityWithCosts(text);
    return assessment;
  }

  /**
   * G4-B/G4-D — verifica completa: assessment + stima costi da catalogo in un
   * solo percorso LLM. La stima è sola lettura e usa solo dati autorevoli.
   */
  async checkFeasibilityWithCosts(text: string): Promise<{ assessment: OrderAssessment; costs: CostEstimate; workDeclaration?: WorkDeclaration }> {
    const trimmed = text.trim();
    if (!trimmed) {
      throw new Error('Il testo dell’ordine è obbligatorio');
    }

    // Testo libero → intent: stesso batch LLM del salto, con un solo ordine.
    const gameData = this.ctx.buildGameData();
    const tempId = shortId();
    const convertedActions = await this.ctx.convertActionsBatch(gameData, [{ actionId: tempId, text: trimmed }]);

    if (!convertedActions || convertedActions.length === 0) {
      throw new Error('Impossibile convertire il testo in intenzione');
    }

    const convertedAction = convertedActions[0];

    // Normalizzazione canonica: fallisce con needs_clarification se il testo
    // non individua un intent completo (tipo, target, catalogo, autorizzazione).
    const normalized = normalizeOrderIntent(convertedAction);

    // Identità: mondo con catalog binding e attore tesoreria della polity.
    const worldRow = worldRepository.findById(this.ctx.worldId) as { template_id?: unknown } | undefined;
    const templateId = worldRow?.template_id;
    if (typeof templateId !== 'string' || !templateId) {
      throw new Error('Mondo legacy senza catalog binding');
    }

    const loaded = loadSimulationCatalog(path.join(process.cwd(), 'data', 'presets', templateId));
    if (!loaded.catalog) {
      throw new Error('Catalogo server non valido');
    }

    // La stima costa esiste anche per un intent non normalizzabile: l'eventuale
    // catalogRef già presente orienta la proiezione; altrimenti è 'none'.
    const costs = estimateIntentCosts(loaded.catalog, normalized.ok ? normalized.intent : {
      id: tempId,
      actorPolityId: '',
      originalText: trimmed,
      actionKind: 'qualitative',
      targetIds: [],
      priority: 0,
      dependencyIds: [],
      authorization: { allowPartialStart: false, allowedPhaseIds: [] },
    } as never);

    if (!normalized.ok) {
      return {
        assessment: {
          actionId: tempId,
          status: 'blocked',
          blockers: normalized.clarifications.map(c => ({
            code: c.code as ReasonCode,
            detail: c.message,
          })),
          warnings: [],
          alternatives: [],
        },
        costs,
      };
    }

    const polity = this.ctx.playerPolity();
    if (!polity) {
      throw new Error('Identità politica del giocatore non disponibile');
    }

    const actor = loaded.catalog.actors.find(
      item => item.polityId === polity && item.type === 'treasury',
    );
    if (!actor) {
      throw new Error('Attore economico (tesoreria) non trovato per la polity');
    }

    // MG02 µ1 — parità con la rotta `evaluate`: anche qui si legge il ledger e
    // si passano i deficit, dagli stessi due moduli. Prima di MG02 questa rotta
    // valutava senza leggere il possesso, quindi i tre codici di deficit non
    // erano raggiungibili da qui: due preflight dello stesso ordine davano
    // risposte strutturalmente diverse.
    const measured = strictReadingsFor({
      economyMode: this.ctx.economyMode(),
      branchId: this.ctx.branchId(),
      actorId: actor.actorId,
      catalog: loaded.catalog,
      intent: normalized.intent,
    });

    const assessment = new FeasibilityService(loaded.catalog).evaluate(normalized.intent, {
      actorId: actor.actorId,
      verifiedPolityId: polity,
      // Il consenso dell'autore dell'ordine: la richiesta di valutazione È la
      // decisione del giocatore. Gli altri due consensi non si presumono.
      approvals: ['user'],
      rights: [],
      knowledgeIds: [],
      capabilityIds: [],
      ...(measured ? { deficits: measured.deficits, unknownRequirements: measured.unknown } : {}),
    });

    // MG02 µ6 — Per una costruzione si risolvono i detentori: sono un fatto
    // dello stato economico, e il client deve solo rimandarli indietro.
    const workDeclaration = (() => {
      if (normalized.intent.actionKind !== 'construct') return undefined;
      const work = loaded.catalog!.works?.find(item => item.id === normalized.intent.catalogRef);
      if (!work) return undefined;
      const holders = resolveWorkHolders(loaded.catalog!, this.ctx.branchId(), polity, work);
      return {
        workId: work.id,
        payerActorId: holders.payerActorId,
        materialActorId: holders.materialActorId,
        funded: holders.materialActorId !== null && !(measured?.deficits.length),
        missingMaterials: holders.missingMaterials,
        ...(holders.note ? { note: holders.note } : {}),
      };
    })();

    return { assessment, costs, ...(workDeclaration ? { workDeclaration } : {}) };
  }
}
