/**
 * World Story — NationStateService
 * ================================
 * Stato materiale delle nazioni, estratto da `game-session.ts` (Fase 1,
 * punto 4). Possiede le cache e la persistenza di:
 *  - **magazzino** materiale (cibo, vestiario, armamenti, carburante, cassa,
 *    debito) — `ResourceStock`;
 *  - **riserve naturali** dinamiche — `ResourceLedger`;
 *  - **modificatori nazionali** proposti dal modello (poi decadono);
 *  - **mercato mondiale** (riserve globali e pressione di prezzo);
 *  - **avanzamento materiale del turno** (`advanceResources`) e **read model
 *    risorse** per API/dossier (`getResources`).
 *
 * Conti nazionali e leve fiscali restano in `GameSession`. Il servizio riceve
 * dall'esterno i conti e le opzioni del motore tramite `NationStateContext`.
 */

import { resourceRepository, naturalResourceRepository, modifiersRepository, gameRepository, factionMemoryRepository, type PressureRecord } from '../repositories';
import { advanceStock, annualDebtServiceMld, capStock, creditHeadroom, creditLimit, debtOf, describeStock, dropRegistryInheritedDebt, materialNeeds, normalizeStock, overdraftOf, seedStock, storageCapacity, type ResourceStock } from '../core/simulation/MaterialEconomy';
import { averageMaturityYears, describeDebtTranche, marketRatePct } from '../core/simulation/SovereignDebt';
import {
  advanceLedger, applyGlobalExtraction, effectiveEndowment, emptyMarket, marketQuote, seedLedger, seedMarket, summarizeLedger,
  type ResourceLedger, type WorldMarket,
} from '../core/simulation/ResourceMarket';
import {
  PRESSURE_MAX_ACTIVE, generatePressures, highlightPressures, pressurePriority, pressureWindow, scalePressureEffect,
  type PressureEffect, type PressureNeighbour, type PressureSnapshot, type PressureWindow, type RelationStance,
} from '../core/simulation/PeacetimePressures';
import { advanceCrisis, type CrisisEnding, type CrisisInput, type CrisisState } from '../core/simulation/NationCrisis';
import { factionMemoryFromPressure, type FactionMemoryEvent } from '../core/simulation/FactionMemory';
import type { GovernmentMemoryInput } from '../core/simulation/GovernmentFactions';
import { daysBetween } from '../core/simulation/calendar';
import { NATURAL_RESOURCE_KINDS, naturalResourcesFor, type NaturalEndowment, type NaturalResourceKind } from '../core/simulation/MilitaryIndustry';
import { EMPTY_MODIFIERS, applyArsenalEffects, applyModifierEffects, applyStockEffects, decayModifiers, describeNationalEffects, hasModifiers, parseNationalEffects, type NationalEffect, type NationalModifiers } from '../core/simulation/NationalEffects';
import type { NationalAccount } from '../core/simulation/WorldStateEngine';
import { materialBalance } from './materialBalance';

/** Regione minima richiesta dalle pressioni esterne. */
export interface NationStateRegion {
  owner: string;
  militaryPower: number;
  /** Id delle regioni confinanti (`RegionState.borders`), per l'adiacenza. */
  borders?: string[];
}

export interface NationStateContext {
  readonly gameId: string;
  currentTurn(): number;
  currentDate(): string;
  isStrictGame(): boolean;
  playerPolityId(): string;
  worldStateOptions(): { modernFacts: boolean; startDate: string; taxRateByPolity?: Record<string, number> };
  /** Conti nazionali delle province iniziali del mondo. */
  initialAccounts(): Record<string, NationalAccount>;
  /** Conti nazionali correnti (stato dinamico). */
  sessionAccounts(): Record<string, NationalAccount>;

  // ── Pressioni e crisi ───────────────────────────────────────────────────
  regions(): Map<string, NationStateRegion>;
  publicPolityName(polityId: string): string;
  relationToPlayer(polityId: string): RelationStance;
  nationalMilitaryPower(polityId: string): number;
  nationalEffectiveMilitaryPower(polityId: string): number;
  /** Applica l'effetto di una pressione (stato e relazioni in GameSession). */
  applyPressureEffect(effect: PressureEffect, reason: string): void;
  /** Chiude la partita quando la crisi produce un epilogo. */
  onCrisisEnding(ending: CrisisEnding): void;

  // ── Leve nazionali del modello ──────────────────────────────────────────
  /** Risolve un nome di polity nel suo polityId (o `undefined`). */
  resolvePolity(name: string): string | undefined;
  arsenalUnits(polityId: string): Record<string, number>;
  saveArsenal(polityId: string, units: Record<string, number>): void;
}

/** Sfida di pace come la vede la UI: finestra temporale, priorità e evidenza. */
export interface PressureView extends PressureRecord {
  window: PressureWindow;
  /** P0/P2: `critica` | `rilevante` | `ordinaria`. */
  priority: string;
  /** Merita attenzione adesso (max 2 per volta, salvo crisi). */
  highlighted: boolean;
}

export class NationStateService {
  /** Magazzino materiale per polity (cibo, vestiario, armamenti, carburante…). */
  private resourceStocks = new Map<string, ResourceStock>();
  private resourceLedgers = new Map<string, ResourceLedger>();
  private market: WorldMarket = emptyMarket();
  private marketSeeded = false;

  /** Modificatori nazionali proposti dal modello (persistenti, poi decadono). */
  private nationalModifiers = new Map<string, NationalModifiers>();
  private modifiersLoaded = false;

  constructor(private readonly ctx: NationStateContext) {}

  // ── Avanzamento materiale del turno e read model risorse ────────────────

  advanceResources(days: number, accounts?: Record<string, NationalAccount>, asOfDate: string = this.ctx.currentDate()): string[] {
    if (this.ctx.isStrictGame() || days <= 0) return [];
    const snapshot = accounts ?? this.ctx.sessionAccounts();
    const lines: string[] = [];
    for (const [polityId, account] of Object.entries(snapshot)) {
      if (!polityId || polityId === 'neutral' || account.provinces === 0) continue;
      // Risorse naturali dinamiche: estrazione, esaurimento, accumulo in magazzino.
      const ledger = this.resourceLedger(polityId);
      const natural = advanceLedger(ledger, account, days);
      this.saveResourceLedger(polityId, natural.ledger);
      applyGlobalExtraction(this.ensureMarket(), natural.extracted);
      // Una risorsa esaurita smette di dare i bonus di produzione del giacimento.
      const effective = effectiveEndowment(natural.ledger, naturalResourcesFor(polityId));
      const tick = advanceStock(this.resourceStock(polityId), account, days, effective, asOfDate);
      this.saveResourceStock(polityId, tick.stock);
      if (polityId !== this.ctx.playerPolityId()) continue;
      for (const tech of tick.unlocked) {
        lines.push(`🔬 Nuova tecnologia sbloccata: ${tech.name} — ${tech.effects}.`);
      }
      for (const shortage of tick.flow.shortages) lines.push(`⚠️ Carenza materiale — ${shortage}.`);
      lines.push(`🏭 ${describeStock(tick.stock, account)}`);
      // Materiale perso perché il magazzino era oltre la capacità reale.
      const lost = Object.entries(tick.spoiled).filter(([, value]) => (value || 0) > 0.01);
      if (lost.length > 0) {
        const detail = lost.map(([kind, value]) => `${kind} ${Math.round((value as number) * 10) / 10}`).join(', ');
        lines.push(`📦 Magazzino al tetto: perduto ${detail} (capacità di stoccaggio superata).`);
      }
      // Scadenze: il debito che torna va rifinanziato al tasso di mercato.
      for (const rolled of tick.rolledDebts) {
        lines.push(`📜 Scadenza del debito — ${describeDebtTranche(rolled)}: rifinanziato al nuovo tasso.`);
      }
      const extractedKinds = NATURAL_RESOURCE_KINDS.filter(kind => (natural.extracted[kind] || 0) > 0);
      if (extractedKinds.length > 0) {
        lines.push(`⛏️ Estrazione risorse: ${extractedKinds.map(kind => `${natural.extracted[kind]} ${kind}`).join(', ')}.`);
      }
      for (const kind of natural.depleted) {
        lines.push(`🪫 Risorsa esaurita: ${kind} — le produzioni che ne dipendevano perdono il bonus del giacimento.`);
      }
    }
    // I modificatori nazionali decadono verso la neutralità: nessun effetto dura
    // per sempre se la causa che lo ha generato non viene rinnovata.
    for (const polityId of Object.keys(snapshot)) {
      if (!polityId || polityId === 'neutral' || snapshot[polityId].provinces === 0) continue;
      const current = this.modifiersFor(polityId);
      if (!hasModifiers(current)) continue;
      this.saveModifiers(polityId, decayModifiers(current));
    }
    return lines;
  }

  /** Magazzino del paese giocatore, per API e dossier. */
  getResources() {
    const account = this.ctx.sessionAccounts()[this.ctx.playerPolityId()];
    const ledger = this.resourceLedger(this.ctx.playerPolityId());
    const market = this.ensureMarket();
    const natural = summarizeLedger(ledger, account);
    const stock = this.resourceStock(this.ctx.playerPolityId());
    const gdp = Math.max(0, Number(account?.nominalGdpUsdBillions) || 0);
    const debtRatioPct = gdp > 0 ? debtOf(stock) / gdp * 100 : 0;
    return {
      stock,
      account,
      natural,
      market: natural.map(summary => marketQuote(market, summary.kind)),
      debt: Math.round(debtOf(stock) * 100) / 100,
      /** Debito pubblico in essere: titoli con tasso e scadenza. */
      debts: stock.debts,
      overdraft: Math.round(overdraftOf(stock) * 100) / 100,
      /** Interessi passivi annui sull'intero debito (mld). */
      annualInterest: Math.round(annualDebtServiceMld(stock) * 100) / 100,
      /** Scadenza media ponderata residua dei titoli (anni). */
      averageMaturityYears: averageMaturityYears(stock.debts, this.ctx.currentDate()),
      debtRatioPct: Math.round(debtRatioPct * 10) / 10,
      /** Capacità di stoccaggio e fabbisogno mensile del magazzino materiale. */
      capacity: storageCapacity(account),
      needs: materialNeeds(account),
      /**
       * Bilancio materiale del mese (quanto produco, quanto consumo, saldo e
       * materiale perso al tetto). Derivato dalle stesse funzioni del motore
       * sullo stato corrente: nessuna scrittura, nessuno stato duplicato.
       * Nei giochi in modalità stretta il magazzino non avanza (il motore
       * restituisce `null`): il bilancio non viene inventato.
       */
      balance: this.ctx.isStrictGame() ? null : materialBalance(stock, account, effectiveEndowment(ledger, naturalResourcesFor(this.ctx.playerPolityId()))),
      creditLimit: creditLimit(account),
      creditHeadroom: Math.round(creditHeadroom(stock, account) * 100) / 100,
      /** Tasso di mercato che la nazione otterrebbe oggi per una nuova emissione. */
      marketRatePct: marketRatePct(debtRatioPct, 10),
      modifiers: this.modifiersFor(this.ctx.playerPolityId()),
    };
  }

  // ── Magazzino ───────────────────────────────────────────────────────────

  /**
   * Magazzino già noto (cache o DB), senza seminarne uno nuovo. Serve agli
   * overlay di sola lettura (rapporto debito/PIL) che non devono creare righe.
   */
  peekResourceStock(polityId: string): ResourceStock | null {
    const cached = this.resourceStocks.get(polityId);
    if (cached) return cached;
    try {
      const stored = resourceRepository.get(this.ctx.gameId, polityId);
      if (!stored) return null;
      // I mondi storici non ereditano il debito 2024: la bonifica vale anche
      // per le righe scritte prima di questa correzione.
      const { stock: eraStock, changed, legacyModernSeed } = this.stockForEra(stored.stock);
      // Residuo della semina moderna in un mondo storico: si risemina dai dati
      // dell'epoca (cassa e scorte erano su scala 2024).
      const account = this.ctx.initialAccounts()[polityId];
      if (legacyModernSeed && account) {
        const reseeded = seedStock(account, naturalResourcesFor(polityId), this.ctx.currentDate());
        this.saveResourceStock(polityId, reseeded);
        return reseeded;
      }
      // Una riga interamente a zero è una semina mancata, non una nazione
      // senza risorse: non va messa in cache (il repair la risemina), e per
      // l'overlay di sola lettura equivale a nessun magazzino noto.
      const empty = !(eraStock.money > 0)
        && eraStock.debts.length === 0
        && !(eraStock.food > 0) && !(eraStock.clothing > 0)
        && !(eraStock.weapons > 0) && !(eraStock.fuel > 0);
      if (empty) return null;
      // Realismo anche in lettura: le scorte legacy oltre la capacità reale
      // vengono riportate al tetto, non solo al tick successivo.
      const { stock: trimmed, spoiled } = account ? capStock(eraStock, account) : { stock: eraStock, spoiled: {} };
      if (Object.keys(spoiled).length > 0 || changed) this.saveResourceStock(polityId, trimmed);
      this.resourceStocks.set(polityId, trimmed);
      return trimmed;
    } catch {
      return null;
    }
  }

  /** Magazzino in sola cache (nessuna query): per i conti degli NPC. */
  peekStockCached(polityId: string): ResourceStock | null {
    return this.resourceStocks.get(polityId) ?? null;
  }

  /** Magazzino materiale della polity: cache → DB → seed dai dati iniziali. */
  resourceStock(polityId: string): ResourceStock {
    const cached = this.resourceStocks.get(polityId);
    if (cached) return cached;
    try {
      const stored = resourceRepository.get(this.ctx.gameId, polityId);
      if (stored) {
        // I mondi storici non ereditano il debito 2024: la bonifica vale anche
        // per le righe scritte prima di questa correzione.
        const { stock: eraStock, changed, legacyModernSeed } = this.stockForEra(stored.stock);
        const account = this.ctx.initialAccounts()[polityId] ?? this.ctx.sessionAccounts()[polityId];
        // Residuo della semina moderna in un mondo storico: si risemina dai
        // dati dell'epoca (cassa e scorte erano su scala 2024).
        if (legacyModernSeed && account) {
          const reseeded = seedStock(account, naturalResourcesFor(polityId), this.ctx.currentDate());
          this.saveResourceStock(polityId, reseeded);
          return reseeded;
        }
        // Riparazione mirata: un magazzino interamente a zero per una nazione
        // che esiste è una riga mai seminata (non una nazione senza risorse) e
        // va riseminata dai dati di partenza. Una riga con titoli di debito è
        // «seminata» anche a cassa zero.
        const isEmpty = !(eraStock.money > 0)
          && eraStock.debts.length === 0
          && !(eraStock.food > 0)
          && !(eraStock.clothing > 0)
          && !(eraStock.weapons > 0) && !(eraStock.fuel > 0);
        if (isEmpty && account) {
          const repaired = seedStock(account, naturalResourcesFor(polityId), this.ctx.currentDate());
          this.saveResourceStock(polityId, repaired);
          return repaired;
        }
        // Realismo del magazzino anche per i salvataggi vecchi: le scorte oltre
        // la capacità reale (multipli fissi del consumo) vengono riportate al
        // tetto, così una nazione fragile non mostra dispense piene.
        const { stock: trimmed, spoiled } = account ? capStock(eraStock, account) : { stock: eraStock, spoiled: {} };
        if (Object.keys(spoiled).length > 0 || changed) this.saveResourceStock(polityId, trimmed);
        this.resourceStocks.set(polityId, trimmed);
        return trimmed;
      }
    } catch (error) {
      console.warn('[GameSession] Lettura magazzino non disponibile:', error);
    }
    // Il magazzino nasce dai dati di partenza della nazione (province iniziali
    // del mondo), non dallo stato corrente di una partita già avanzata.
    const account = this.ctx.initialAccounts()[polityId]
      ?? this.ctx.sessionAccounts()[polityId];
    if (!account) {
      // Nessun conto: non si persiste un magazzino vuoto (sarebbe una
      // tesoreria a zero permanente). Al prossimo tick, con un conto, si semina.
      return normalizeStock({});
    }
    const seeded = seedStock(account, naturalResourcesFor(polityId), this.ctx.currentDate());
    this.saveResourceStock(polityId, seeded);
    return seeded;
  }

  saveResourceStock(polityId: string, stock: ResourceStock): void {
    this.resourceStocks.set(polityId, stock);
    try {
      resourceRepository.upsert(this.ctx.gameId, polityId, stock, this.ctx.currentTurn(), this.ctx.currentDate());
    } catch (error) {
      console.warn('[GameSession] Impossibile salvare il magazzino:', error);
    }
  }

  /**
   * Bonifica del magazzino secondo l'epoca. Nei mondi storici il debito
   * ereditato dal registro 2024 è anacronistico: va rimosso anche dai
   * salvataggi scritti prima di questa correzione. Se la nazione non ha ancora
   * emesso debito proprio, la riga è un residuo della semina moderna e va
   * riseminata dai dati storici (altrimenti cassa e scorte restano su scala
   * 2024, incoerenti col PIL dell'epoca).
   */
  private stockForEra(stock: ResourceStock): { stock: ResourceStock; changed: boolean; legacyModernSeed: boolean } {
    if (this.ctx.worldStateOptions().modernFacts) return { stock, changed: false, legacyModernSeed: false };
    const debts = Array.isArray(stock.debts) ? stock.debts : [];
    const hadInherited = debts.some(debt => String(debt.id || '').startsWith('debt-inherited-'));
    if (!hadInherited) return { stock, changed: false, legacyModernSeed: false };
    const cleaned = dropRegistryInheritedDebt(stock);
    return { stock: cleaned, changed: true, legacyModernSeed: cleaned.debts.length === 0 };
  }

  /**
   * Crea — se mancante — il magazzino della polity controllata dai suoi dati di
   * partenza. Le altre nazioni vengono seminate al primo tick che le riguarda
   * (`advanceResources`), sempre dai dati iniziali del mondo. Lazy di proposito:
   * un seed eager di tutte le nazioni costerebbe decine di secondi all'avvio.
   */
  seedInitialResources(): void {
    if (this.ctx.isStrictGame() || !this.ctx.playerPolityId()) return;
    const playerPolityId = this.ctx.playerPolityId();
    if (this.resourceStocks.has(playerPolityId)) return;
    try {
      if (resourceRepository.get(this.ctx.gameId, playerPolityId)) return;
    } catch { /* tabella non ancora pronta: si semina comunque */ }
    const account = this.ctx.initialAccounts()[playerPolityId];
    if (!account || account.provinces === 0) return;
    // Le scorte iniziali nascono dalle risorse naturali reali della nazione,
    // come nel percorso di riparazione: i due seed devono coincidere.
    this.saveResourceStock(playerPolityId, seedStock(account, naturalResourcesFor(playerPolityId), this.ctx.currentDate()));
  }

  // ── Riserve naturali ────────────────────────────────────────────────────

  /** Riserva naturale: cache → DB → semina dal giacimento immutabile. */
  resourceLedger(polityId: string): ResourceLedger {
    const cached = this.resourceLedgers.get(polityId);
    if (cached) return cached;
    try {
      const stored = naturalResourceRepository.get(this.ctx.gameId, polityId);
      if (stored) {
        this.resourceLedgers.set(polityId, stored.ledger);
        return stored.ledger;
      }
    } catch (error) {
      console.warn('[GameSession] Lettura risorse naturali non disponibile:', error);
    }
    const seeded = seedLedger(naturalResourcesFor(polityId));
    this.saveResourceLedger(polityId, seeded);
    return seeded;
  }

  saveResourceLedger(polityId: string, ledger: ResourceLedger): void {
    this.resourceLedgers.set(polityId, ledger);
    try {
      naturalResourceRepository.upsert(this.ctx.gameId, polityId, ledger, this.ctx.currentTurn(), this.ctx.currentDate());
    } catch (error) {
      console.warn('[GameSession] Impossibile salvare le risorse naturali:', error);
    }
  }

  // ── Modificatori nazionali ──────────────────────────────────────────────

  /** Modificatori di una polity: cache → DB → neutralità. */
  modifiersFor(polityId: string): NationalModifiers {
    if (!this.modifiersLoaded) {
      try {
        for (const row of modifiersRepository.list(this.ctx.gameId)) this.nationalModifiers.set(row.polityId, row.modifiers);
      } catch (error) {
        console.warn('[GameSession] Lettura modificatori nazionali non disponibile:', error);
      }
      this.modifiersLoaded = true;
    }
    return this.nationalModifiers.get(polityId) || { ...EMPTY_MODIFIERS };
  }

  saveModifiers(polityId: string, modifiers: NationalModifiers): void {
    this.nationalModifiers.set(polityId, modifiers);
    try {
      modifiersRepository.upsert(this.ctx.gameId, polityId, modifiers, this.ctx.currentTurn(), this.ctx.currentDate());
    } catch (error) {
      console.warn('[GameSession] Impossibile salvare i modificatori nazionali:', error);
    }
  }

  // ── Mercato mondiale ────────────────────────────────────────────────────

  /** Mercato mondiale: riserve globali e pressione di prezzo. Una volta per partita. */
  ensureMarket(): WorldMarket {
    if (this.marketSeeded) return this.market;
    const endowments: Record<string, NaturalEndowment> = {};
    for (const polityId of Object.keys(this.ctx.initialAccounts())) {
      if (!polityId || polityId === 'neutral') continue;
      endowments[polityId] = naturalResourcesFor(polityId);
    }
    this.market = seedMarket(endowments);
    try {
      for (const record of naturalResourceRepository.list(this.ctx.gameId)) {
        const extracted: Partial<Record<NaturalResourceKind, number>> = {};
        for (const [kind, node] of Object.entries(record.ledger)) {
          extracted[kind as NaturalResourceKind] = node.extractedTotal;
        }
        applyGlobalExtraction(this.market, extracted);
      }
    } catch (error) {
      console.warn('[GameSession] Mercato risorse non ricostruibile:', error);
    }
    this.marketSeeded = true;
    return this.market;
  }

  // ── Pressioni di pace ───────────────────────────────────────────────────

  /** Vicini rilevanti per le pressioni esterne, dal più armato.
   *  Sono vicini solo i polity che possiedono almeno una regione confinante con
   *  una regione del giocatore (`region.borders`, id di regione già calcolati da
   *  `computeBorders`). Così un polity lontano non entra mai nelle sfide estere
   *  solo perché molto armato. Senza adiacenza disponibile non si inventa un
   *  vicino: la lista resta vuota. */
  pressureNeighbours(): PressureNeighbour[] {
    const playerPolityId = this.ctx.playerPolityId();
    const regions = this.ctx.regions();

    // 1) Polity che toccano davvero il giocatore (confine regione-regione).
    const neighbourPolityIds = new Set<string>();
    for (const region of regions.values()) {
      if (region.owner !== playerPolityId) continue;
      for (const borderId of region.borders ?? []) {
        const owner = regions.get(borderId)?.owner;
        if (!owner || owner === 'neutral' || owner === playerPolityId) continue;
        neighbourPolityIds.add(owner);
      }
    }
    if (neighbourPolityIds.size === 0) return [];

    // 2) Potenza dei soli vicini reali, ordinata dalla più alta.
    const power = new Map<string, number>();
    for (const region of regions.values()) {
      const owner = region.owner;
      if (!owner || owner === 'neutral' || owner === playerPolityId) continue;
      if (!neighbourPolityIds.has(owner)) continue;
      power.set(owner, (power.get(owner) || 0) + (Number(region.militaryPower) || 0));
    }
    return [...power.entries()]
      .filter(([, value]) => value > 0)
      .sort((left, right) => right[1] - left[1])
      .slice(0, 8)
      .map(([polityId, militaryPower]) => ({
        polityId,
        name: this.ctx.publicPolityName(polityId),
        militaryPower,
        stance: this.ctx.relationToPlayer(polityId),
      }));
  }

  /** Mesi di cibo in magazzino del giocatore, `null` se non calcolabile. */
  foodCoverageMonths(account?: NationalAccount): number | null {
    try {
      const needs = materialNeeds(account ?? this.ctx.sessionAccounts()[this.ctx.playerPolityId()]);
      if (!needs.food || needs.food <= 0) return null;
      const stock = this.resourceStock(this.ctx.playerPolityId());
      return Math.max(0, Number(stock.food || 0)) / needs.food;
    } catch {
      return null;
    }
  }

  /** Fotografia degli indicatori da cui nascono le sfide del turno. */
  private pressureSnapshot(): PressureSnapshot {
    const playerPolityId = this.ctx.playerPolityId();
    const account = this.ctx.sessionAccounts()[playerPolityId];
    const gdp = Math.max(0, Number(account?.nominalGdpUsdBillions) || 0);
    const annualDeficitPct = gdp > 0
      ? Math.max(0, -(Number(account?.monthlyBalance || 0) * 12) / gdp * 100)
      : 0;
    return {
      polityId: playerPolityId,
      name: this.ctx.publicPolityName(playerPolityId),
      turn: this.ctx.currentTurn(),
      date: this.ctx.currentDate(),
      seed: this.ctx.gameId,
      atWar: Number(account?.warEffort || 0) >= 60,
      stability: Number(account?.stability ?? 50),
      socialTension: Number(account?.socialTension ?? 20),
      annualGrowthRate: Number(account?.annualGrowthRate ?? 0.01),
      deficitRatioPct: annualDeficitPct,
      debtRatioPct: Number(account?.debtRatioPct ?? 0),
      taxRatePct: Number(account?.taxRatePct ?? 10),
      militaryPower: this.ctx.nationalMilitaryPower(playerPolityId),
      provinces: Number(account?.provinces ?? 0),
      mobilized: Number(account?.mobilized ?? 0),
      foodCoverageMonths: this.foodCoverageMonths(account),
      neighbours: this.pressureNeighbours(),
    };
  }

  /**
   * Genera le sfide del turno corrente solo se non ce ne sono già di attive.
   * Chiamata al caricamento: un riavvio non crea sfide nuove a metà turno.
   */
  ensurePeacetimePressures(): void {
    try {
      // Se il turno corrente ha già avuto le sue sfide (anche se il giocatore
      // le ha risolte tutte), non se ne inventano altre a metà turno.
      const currentTurn = this.ctx.currentTurn();
      if (gameRepository.listPressures(this.ctx.gameId).some(record => record.createdTurn === currentTurn)) return;
      this.openNewPressures();
    } catch (error) {
      console.warn('[GameSession] Pressioni di pace non disponibili:', error);
    }
  }

  /**
   * Finestra temporale di una sfida già aperta, rispetto alla data corrente.
   * GAMEPLAY-LONG: il tempo trascorso è quello del calendario di gioco, quindi
   * un avanzamento di 7 giorni e uno di 365 non producono lo stesso stato.
   */
  private pressureWindowOf(record: PressureRecord): PressureWindow {
    const fallback = record.createdDate;
    const from = fallback || this.ctx.currentDate();
    return pressureWindow(
      {
        createdDate: from,
        durationDays: record.durationDays,
        severity: record.severity,
        escalated: record.escalated,
      },
      this.ctx.currentDate(),
      daysBetween(from, this.ctx.currentDate()),
    );
  }

  /**
   * Apre nuove sfide solo se c'è spazio e se non sono già aperte: le stesse
   * questioni non si ripetono mentre il giocatore le sta ancora valutando — è
   * il modo più semplice per non trasformare il gioco in una pila di notifiche
   * (P2). La generazione resta deterministica e basata sugli indicatori correnti.
   */
  private openNewPressures(): void {
    const active = gameRepository.listPressures(this.ctx.gameId, 'active');
    const room = PRESSURE_MAX_ACTIVE - active.length;
    if (room <= 0) return;
    const openTemplates = new Set(active.map(record => record.template));
    const candidate = generatePressures(this.pressureSnapshot(), { maxPressures: room })
      .filter(pressure => !openTemplates.has(pressure.template));
    if (candidate.length === 0) return;
    gameRepository.insertPressures(
      this.ctx.gameId, this.ctx.playerPolityId(), candidate, this.ctx.currentDate(), this.ctx.currentTurn(),
    );
  }

  /**
   * Fa scorrere il tempo delle sfide di pace:
   *
   *  - le sfide **nei termini restano aperte** (non scadono più ogni turno);
   *  - una sfida **oltre la scadenza** applica l'effetto dell'inerzia e si chiude;
   *  - una sfida **grave** che resta aperta oltre il 60% della sua finestra
   *    peggiora una volta sola, con **metà** dell'effetto di inazione: il tempo
   *    che passa non è gratis, ma nemmeno la condanna immediata;
   *  - se c'è spazio, nascono nuove sfide dagli indicatori aggiornati.
   */
  refreshPeacetimePressures(): void {
    try {
      const active = gameRepository.listPressures(this.ctx.gameId, 'active');
      for (const record of active) {
        const window = this.pressureWindowOf(record);
        if (window.expired) {
          if (gameRepository.expirePressure(this.ctx.gameId, record.id, this.ctx.currentDate())) {
            this.ctx.applyPressureEffect(record.inaction, `${record.title}: sfida ignorata oltre la scadenza`);
            // GAMEPLAY-LONG: chi aveva portato la richiesta non dimentica il silenzio.
            this.recordPressureMemory(record, null, record.inaction, null);
          }
          continue;
        }
        if (window.escalationDue) {
          const escalated = scalePressureEffect(record.inaction);
          if (gameRepository.markPressureEscalated(this.ctx.gameId, record.id, this.ctx.currentDate())) {
            this.ctx.applyPressureEffect(escalated, `${record.title}: la sfida si inasprisce (${window.daysElapsed} giorni senza risposta)`);
          }
        }
      }
      this.openNewPressures();
    } catch (error) {
      console.warn('[GameSession] Pressioni di pace non disponibili:', error);
    }
  }

  // ── Memoria politica delle fazioni (GAMEPLAY-LONG P1) ───────────────────

  /**
   * Registra nella memoria politica ciò che una decisione ha significato:
   * il motore ha già applicato l'effetto, qui si annota **chi** ne esce
   * favorito o danneggiato. Nessun umore inventato e nessuna scrittura di
   * numeri: la soddisfazione resta derivata dal bilancio.
   */
  recordPressureMemory(
    record: PressureRecord,
    optionId: string | null,
    effect: PressureEffect | null | undefined,
    optionLabel?: string | null,
  ): FactionMemoryEvent[] {
    if (this.ctx.isStrictGame()) return [];
    try {
      const events = factionMemoryFromPressure({
        pressureId: record.id,
        template: record.template,
        kind: record.kind,
        title: record.title,
        severity: Number(record.severity) || 1,
        gameDate: this.ctx.currentDate(),
        turn: this.ctx.currentTurn(),
        optionId,
        optionLabel: optionLabel ?? null,
        effect: effect ?? null,
      });
      factionMemoryRepository.insertMany(this.ctx.gameId, this.ctx.playerPolityId(), events);
      return events;
    } catch (error) {
      // La memoria non deve mai bloccare una decisione di gioco.
      console.warn('[NationStateService] Memoria delle fazioni non disponibile:', error);
      return [];
    }
  }

  /** Memoria politica della nazione giocatore, pronta per la fotografia del governo. */
  governmentMemory(): GovernmentMemoryInput | null {
    if (this.ctx.isStrictGame()) return null;
    try {
      const events = factionMemoryRepository.list(this.ctx.gameId, { polityId: this.ctx.playerPolityId() });
      if (events.length === 0) return null;
      return { events, today: this.ctx.currentDate() };
    } catch (error) {
      console.warn('[NationStateService] Memoria delle fazioni non leggibile:', error);
      return null;
    }
  }

  /** Pota la memoria dopo un salto indietro: il passato riscritto non lascia tracce. */
  pruneFactionMemoryAfterTurn(turn: number): number {
    try {
      return factionMemoryRepository.deleteAfterTurn(this.ctx.gameId, turn);
    } catch (error) {
      console.warn('[NationStateService] Potatura della memoria non riuscita:', error);
      return 0;
    }
  }

  /**
   * Le sfide del momento per il dossier: attive da risolvere (con la loro
   * finestra temporale) e le ultime chiuse, così il giocatore vede anche l'eco
   * delle scelte passate. P2: solo le più urgenti vanno evidenziate, le altre
   * restano nel dossier senza interrompere.
   */
  getPeacetimePressures(hasEnding: boolean): {
    pressures: PressureView[];
    recent: PressureRecord[];
    foodCoverageMonths: number | null;
  } {
    const all = gameRepository.listPressures(this.ctx.gameId);
    // Dopo il collasso non c'è più niente da decidere.
    const active = hasEnding ? [] : all.filter(record => record.status === 'active');
    const windows: Record<string, Pick<PressureWindow, 'expired' | 'urgency' | 'daysElapsed' | 'daysLeft'>> = {};
    const withWindow = active.map(record => {
      const window = this.pressureWindowOf(record);
      windows[record.id] = window;
      return {
        ...record,
        window,
        priority: pressurePriority(record, window),
      };
    });
    const highlighted = highlightPressures(withWindow, windows);
    return {
      pressures: withWindow.map(record => ({ ...record, highlighted: highlighted.has(record.id) })),
      recent: all.filter(record => record.status !== 'active').slice(0, 6),
      foodCoverageMonths: this.foodCoverageMonths(),
    };
  }

  // ── Crisi ───────────────────────────────────────────────────────────────

  private crisisInput(): CrisisInput {
    const playerPolityId = this.ctx.playerPolityId();
    const account = this.ctx.sessionAccounts()[playerPolityId];
    const gdp = Math.max(0, Number(account?.nominalGdpUsdBillions) || 0);
    let overdraftMld = 0;
    let foodCoverageMonths: number | null = null;
    try {
      const stock = this.resourceStock(playerPolityId);
      overdraftMld = overdraftOf(stock);
      const needs = materialNeeds(account);
      if (needs.food > 0) foodCoverageMonths = Math.max(0, Number(stock.food || 0)) / needs.food;
    } catch { /* magazzino non disponibile: nessuna misura inventata */ }
    const hostileNeighbours = this.pressureNeighbours()
      .filter(neighbour => neighbour.stance === 'hostile')
      .map(neighbour => ({ polityId: neighbour.polityId, name: neighbour.name, militaryPower: neighbour.militaryPower }));
    return {
      stability: Number(account?.stability ?? 50),
      socialTension: Number(account?.socialTension ?? 20),
      annualGrowthRate: Number(account?.annualGrowthRate ?? 0.01),
      monthlyBalance: Number(account?.monthlyBalance ?? 0),
      nominalGdpUsdBillions: gdp,
      // Debito e servizio EFFETTIVI: l'overlay dei conti li calcola già dal
      // magazzino (titoli + scoperto) su PIL ed entrate reali.
      debtRatioPct: Number(account?.debtRatioPct ?? account?.debtBurdenPct ?? 0),
      debtServicePct: Number(account?.debtServicePct ?? 0),
      baselineDebtRatioPct: Number(account?.debtBurdenPct ?? 0),
      overdraftMld,
      foodCoverageMonths,
      taxRatePct: Number(account?.taxRatePct ?? 10),
      militaryPower: this.ctx.nationalEffectiveMilitaryPower(playerPolityId),
      hostileNeighbours,
      // Mobilitazione piena CONTRO un vicino ostile: senza i due segnali
      // insieme un esercito grande non è una guerra in corso.
      atWar: hostileNeighbours.length > 0 && Number(account?.warEffort || 0) >= 70,
    };
  }

  /**
   * Valuta la crisi senza scrivere nulla: serve al dossier e ai prompt.
   * `advance: false` non fa scorrere la scala.
   */
  peekCrisis(): CrisisState {
    const previous = gameRepository.getCrisisState(this.ctx.gameId);
    return advanceCrisis(this.crisisInput(), previous ?? {}, {
      turn: this.ctx.currentTurn(),
      date: this.ctx.currentDate(),
      advance: false,
    });
  }

  /**
   * Giorni di calendario trascorsi dall'ultima valutazione della crisi.
   *
   * GAMEPLAY-LONG: la crisi progredisce sul TEMPO TRASCORSO, non sul numero di
   * turni. La data dell'ultima valutazione è persistita in `game_crisis_state`,
   * quindi un salto di 7 giorni e uno di 365 pesano in modo diverso. Senza una
   * valutazione precedente (primo turno di una partita) non c'è tempo da
   * accumulare: 0, e nessun collasso può scattare al primo passo.
   */
  private crisisElapsedDays(previous: { updatedDate?: string | null } | null): number {
    if (!previous?.updatedDate) return 0;
    return daysBetween(previous.updatedDate, this.ctx.currentDate());
  }

  /**
   * Valuta la crisi. Con `advance` (default) fa scorrere la scala dei giorni
   * trascorsi; senza, è una lettura pura per il dossier. Se il collasso scatta,
   * chiude la partita una volta sola.
   */
  evaluateCrisis(advance = true): CrisisState {
    const previous = gameRepository.getCrisisState(this.ctx.gameId);
    const state = advanceCrisis(this.crisisInput(), previous ?? {}, {
      turn: this.ctx.currentTurn(),
      date: this.ctx.currentDate(),
      advance,
      days: this.crisisElapsedDays(previous),
    });
    try {
      gameRepository.saveCrisisState({
        gameId: this.ctx.gameId,
        criticalDays: state.criticalDays,
        episodes: state.episodes,
        overall: state.level,
        ending: state.ending ?? previous?.ending ?? null,
        updatedTurn: this.ctx.currentTurn(),
        updatedDate: this.ctx.currentDate(),
      });
    } catch (error) {
      console.warn('[GameSession] Stato di crisi non salvato:', error);
    }
    if (advance && state.ending) this.ctx.onCrisisEnding(state.ending);
    return state;
  }

  // ── Leve nazionali del modello (scorte, arsenale, modificatori) ──────────

  /**
   * Leve del modello sulla vita della nazione (scorte, arsenale, società,
   * economia). Ogni proposta è validata, quantizzata e limitata dal motore.
   */
  applyNationalEffects(raw: unknown): { applied: NationalEffect[]; bulletins: string[] } {
    if (this.ctx.isStrictGame()) return { applied: [], bulletins: [] };
    const effects = parseNationalEffects(raw);
    if (effects.length === 0) return { applied: [], bulletins: [] };
    const playerPolityId = this.ctx.playerPolityId();
    const byPolity = new Map<string, NationalEffect[]>();
    for (const effect of effects) {
      const target = effect.polityId ? this.ctx.resolvePolity(effect.polityId) : playerPolityId;
      const polityId = target || playerPolityId;
      const list = byPolity.get(polityId) || [];
      list.push(effect);
      byPolity.set(polityId, list);
    }
    const applied: NationalEffect[] = [];
    const bulletins: string[] = [];
    for (const [polityId, list] of byPolity) {
      const account = this.ctx.sessionAccounts()[polityId];
      const stockResult = applyStockEffects(this.resourceStock(polityId), list, account);
      if (stockResult.applied.length > 0) this.saveResourceStock(polityId, stockResult.stock);
      const arsenalResult = applyArsenalEffects(this.ctx.arsenalUnits(polityId), list);
      if (arsenalResult.applied.length > 0) this.ctx.saveArsenal(polityId, arsenalResult.units);
      const modifierResult = applyModifierEffects(this.modifiersFor(polityId), list);
      if (modifierResult.applied.length > 0) this.saveModifiers(polityId, modifierResult.modifiers);
      const changed: NationalEffect[] = [
        ...stockResult.applied.map(entry => entry.effect),
        ...list.filter(effect => effect.kind === 'arsenal'
          && arsenalResult.applied.some(entry => entry.equipmentId === effect.equipmentId)),
        ...modifierResult.applied,
      ];
      applied.push(...changed);
      const name = this.ctx.publicPolityName(polityId);
      for (const line of describeNationalEffects(changed)) bulletins.push(`🏛️ ${name} — ${line}`);
      for (const reason of stockResult.rejected) {
        bulletins.push(`🏛️ ${name} — effetto ignorato (limite di turno): ${reason}`);
      }
    }
    console.log(`[GameSession] nationalEffects applicati: ${applied.length}`);
    return { applied, bulletins };
  }
}
