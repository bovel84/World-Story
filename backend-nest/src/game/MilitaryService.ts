/**
 * World Story — MilitaryService
 * =============================
 * Arsenale e produzione militare, estratti da `game-session.ts` (Fase 1).
 *
 * Il servizio **possiede le proprie cache** (`arsenals`, `productionOrders`,
 * `productionLoaded`), che prima vivevano in `GameSession` ma erano usate solo
 * dal gruppo militare. Tutto ciò che appartiene ad altri domini (conti nazionali,
 * scorte materiali, data/turno, modalità strict) arriva da un `MilitaryContext`
 * esplicito: nessun import circolare, nessuna logica duplicata.
 *
 * Determininismo invariato: seed di produzione `${gameId}:${orderId}:${turn}`.
 */

import { shortId } from '../utils/short-id';
import { arsenalRepository, productionRepository } from '../repositories';
import { creditHeadroom, creditLimit, debtOf, financePurchase, type ResourceStock } from '../core/simulation/MaterialEconomy';
import { advanceOrder, productionRate, type ProductionContext, type ProductionOrder } from '../core/simulation/MilitaryProduction';
import {
  arsenalCombatFactor, arsenalQualityIndex, arsenalStrength, describeArsenal, describeEndowment,
  DOMAIN_INFO, equipmentById, equipmentStrength, EQUIPMENT_CATALOG, naturalResourcesFor,
  procurementOption, type NationCapacity,
} from '../core/simulation/MilitaryIndustry';
import { addDays } from '../core/simulation/calendar';
import {
  arsenalSeedUnits, equipmentCoverage, epochForDate, establishmentFor, individualWeaponShareFor,
  militaryManpower, militaryReadiness, MILITARY_EPOCH_LABEL,
  type MilitaryEpoch,
} from '../core/simulation/MilitaryDoctrine';
import {
  industrialCapacityOf, type IndustrialCapacity,
  type IndustrialMaintenanceInput, type IndustrialProjectInput,
} from '../core/simulation/IndustrialCapacity';
import { materialNeeds } from '../core/simulation/MaterialEconomy';
import type { NationalAccount } from '../core/simulation/WorldStateEngine';

/**
 * Tetto di sanità su una singola richiesta di costruzione/acquisto. Non è un
 * limite economico (quello lo fa cassa + credito): con le armi individuali
 * contate una per una, un riarmo completo supera il vecchio tetto di 1000.
 */
export const MAX_PROCUREMENT_QUANTITY = 200_000;

/** Dipendenze fornite da GameSession: stato che NON appartiene al dominio militare. */
export interface MilitaryContext {
  readonly gameId: string;
  currentTurn(): number;
  currentDate(): string;
  playerPolityId(): string;
  isStrictGame(): boolean;
  /** Conti nazionali con overlay dei modificatori (motore). */
  accounts(): Record<string, NationalAccount>;
  /** Conti iniziali della partita (per il seed dell'arsenale). */
  initialAccounts(): Record<string, NationalAccount>;
  resourceStock(polityId: string): ResourceStock;
  saveResourceStock(polityId: string, stock: ResourceStock): void;
  /** Data d'inizio dello scenario: fissa l'epoca militare della partita. */
  worldStartDate?(): string;
  /** Progetti in corso del motore (per la capacità industriale). */
  ongoingProcesses?(): IndustrialProjectInput[];
  /** Termini di manutenzione degli impianti posseduti (per la capacità industriale). */
  maintenanceObligations?(): IndustrialMaintenanceInput[];
}

export class MilitaryService {
  /** Arsenale militare per polity (quantità per voce di catalogo). */
  private readonly arsenals = new Map<string, Record<string, number>>();
  /** Ordini di produzione con percentuale di completamento (giocatore). */
  private readonly productionOrders = new Map<string, ProductionOrder>();
  private productionLoaded = false;

  constructor(private readonly ctx: MilitaryContext) {}

  /**
   * Epoca militare della partita: dalla **data d'inizio dello scenario**, non
   * dalla data corrente — la dottrina di una nazione non si riscrive in un anno.
   */
  epoch(): MilitaryEpoch {
    return epochForDate(this.ctx.worldStartDate?.() ?? this.ctx.currentDate());
  }

  /** Quadro industriale della nazione: ordini aperti + progetti + manutenzione. */
  industrialCapacity(polityId: string, known?: NationCapacity): IndustrialCapacity {
    const capacity = known ?? this.nationCapacity(polityId);
    return industrialCapacityOf({
      factories: capacity.factories,
      ports: capacity.ports,
      universities: capacity.universities,
      orders: this.playerProductionOrders(),
      projects: this.ctx.ongoingProcesses?.() || [],
      maintenance: this.ctx.maintenanceObligations?.() || [],
    });
  }

  /** Arsenale noto in cache senza seed né scritture (per i read model). */
  peekArsenal(polityId: string): Record<string, number> | undefined {
    return this.arsenals.get(polityId);
  }

  /** Arsenale della polity: cache → DB → seed dal suo esercito di partenza. */
  arsenalUnits(polityId: string): Record<string, number> {
    const cached = this.arsenals.get(polityId);
    if (cached) return cached;
    try {
      const stored = arsenalRepository.get(this.ctx.gameId, polityId);
      if (stored) {
        this.arsenals.set(polityId, stored.units);
        return stored.units;
      }
    } catch (error) {
      console.warn('[GameSession] Lettura arsenale non disponibile:', error);
    }
    const account = this.ctx.initialAccounts()[polityId];
    const forces = Math.max(0, account?.forces || 0);
    const mobilized = Math.max(0, account?.mobilized || 0);
    // Dotazione di partenza dalla **dottrina d'epoca**: armi individuali per i
    // reparti (più il sovrappiù dei richiamati) e mezzi di mobilità solo se
    // l'epoca li prevede — un mondo del 1815 non nasce con i corazzati.
    const units = arsenalSeedUnits(this.epoch(), forces, mobilized);
    this.saveArsenal(polityId, units);
    return units;
  }

  saveArsenal(polityId: string, units: Record<string, number>): void {
    this.arsenals.set(polityId, units);
    try {
      arsenalRepository.upsert(this.ctx.gameId, polityId, units, this.ctx.currentTurn(), this.ctx.currentDate());
    } catch (error) {
      console.warn('[GameSession] Impossibile salvare l’arsenale:', error);
    }
  }

  /** Capacità industriale e tecnologica corrente della polity giocatore. */
  private nationCapacity(polityId = this.ctx.playerPolityId()): NationCapacity {
    const account = this.ctx.accounts()[polityId];
    const stock = this.ctx.resourceStock(polityId);
    return {
      factories: Math.max(0, account?.factories || 0),
      ports: Math.max(0, account?.ports || 0),
      universities: Math.max(0, account?.universities || 0),
      technologies: stock.technologies,
      money: stock.money,
      weapons: stock.weapons,
      credit: creditHeadroom(stock, account),
      endowment: naturalResourcesFor(polityId),
    };
  }

  /**
   * Arsenale, risorse naturali, capacità industriale e catalogo completo con la
   * fattibilità di costruzione/acquisto per ogni voce.
   */
  getArsenal() {
    const polityId = this.ctx.playerPolityId();
    const capacity = this.nationCapacity(polityId);
    const units = this.arsenalUnits(polityId);
    const account = this.ctx.accounts()[polityId];
    const combatFactor = arsenalCombatFactor(units, Number(account?.forces || 0) + Number(account?.mobilized || 0));
    const endowment = capacity.endowment;
    const lines = describeArsenal(units).map(line => ({
      id: line.equipment.id,
      name: line.equipment.name,
      domain: line.equipment.domain,
      domainLabel: DOMAIN_INFO[line.equipment.domain].label,
      category: line.equipment.category,
      quality: line.equipment.quality,
      tier: line.equipment.tier,
      quantity: line.quantity,
      // Che cos'è: scheda descrittiva statica + contributo alla forza.
      role: line.equipment.role,
      description: line.equipment.description,
      specs: line.equipment.specs,
      strength: equipmentStrength(line.equipment.id, line.quantity),
    }));
    const totalStrength = arsenalStrength(units);
    const enrichedLines = lines.map(line => ({
      ...line,
      // Quanto pesa questa voce sul totale: rende leggibile il «×37».
      sharePct: totalStrength > 0 ? Math.round((line.strength / totalStrength) * 1000) / 10 : 0,
    }));
    const catalog = EQUIPMENT_CATALOG.map(equipment => {
      const option = procurementOption(equipment, capacity);
      return {
        ...equipment,
        canBuild: option.canBuild,
        canBuy: option.canBuy,
        buildCostMln: option.buildCostMln,
        buyCostMln: option.buyCostMln,
        resourceFactor: option.resourceFactor,
        reasons: option.reasons,
      };
    });
    const stock = this.ctx.resourceStock(polityId);
    const needs = materialNeeds(account);
    const epoch = this.epoch();
    const manpower = militaryManpower({
      population: Number(account?.population || 0),
      formations: Number(account?.forces || 0),
      mobilizedFormations: Number(account?.mobilized || 0),
      epoch,
    });
    const coverage = equipmentCoverage({
      units,
      manpower,
      epoch,
      // I porti sono geografia: senza sbocco al mare la categoria navale non
      // entra nel fabbisogno. Dato assente ≠ zero: il filtro scatta solo su 0.
      ports: account?.ports,
    });
    const readiness = militaryReadiness({
      coverage,
      fuel: { stock: stock.fuel, need: needs.fuel },
      weapons: { stock: stock.weapons, need: needs.weapons },
      qualityIndex: arsenalQualityIndex(units),
      manpower,
    });
    const industrial = this.industrialCapacity(polityId, capacity);
    return {
      polityId,
      units,
      strength: totalStrength,
      qualityIndex: arsenalQualityIndex(units),
      combatFactor,
      baseMilitaryPower: Math.round(Number(account?.militaryPower || 0)),
      effectiveMilitaryPower: Math.round(Number(account?.militaryPower || 0) * combatFactor * 10) / 10,
      lines: enrichedLines,
      /** Legenda dei domini: cosa sono e quanto pesano nella forza. */
      domains: (Object.keys(DOMAIN_INFO) as Array<keyof typeof DOMAIN_INFO>)
        .map(domain => ({ domain, ...DOMAIN_INFO[domain] })),
      naturalResources: endowment,
      naturalResourcesText: describeEndowment(endowment),
      // Dottrina militare strutturale: epoca, uomini, dotazioni, prontezza,
      // capacità industriale. **Regole del motore**: la UI le mostra soltanto.
      epoch,
      epochLabel: MILITARY_EPOCH_LABEL[epoch],
      establishment: establishmentFor(epoch).map(entry => ({
        category: entry.id,
        label: entry.label,
        // Le categorie a quota di personale (armi individuali) non hanno una
        // dotazione «per reparto»: la UI mostra la quota d'epoca del personale.
        perFormation: entry.perFormation ?? null,
        perMobilized: entry.perMobilized ?? entry.perFormation ?? null,
        personnelSharePct: entry.demand?.kind === 'personnel_share'
          ? Math.round(individualWeaponShareFor(epoch) * 1000) / 10
          : null,
        demand: entry.demand?.kind ?? 'per_formation',
        weight: entry.weight,
        source: entry.source,
        basis: entry.basis,
      })),
      manpower,
      coverage,
      readiness,
      industrialCapacity: industrial,
      debt: Math.round(debtOf(this.ctx.resourceStock(polityId)) * 100) / 100,
      creditLimit: creditLimit(account),
      production: this.getProduction(industrial.overflowFactor),
      capacity: {
        factories: capacity.factories,
        ports: capacity.ports,
        universities: capacity.universities,
        money: capacity.money,
        weapons: capacity.weapons,
        credit: capacity.credit || 0,
        technologies: capacity.technologies,
      },
      catalog,
    };
  }

  /**
   * Costruisce (`build`) o importa (`buy`) equipaggiamento militare.
   *
   * - L'**acquisto** all'estero è immediato: consegna subito, pagando il
   *   sovrapprezzo.
   * - La **costruzione** apre un ordine con percentuale di completamento: si
   *   paga all'avvio, la consegna arriva a lavori finiti e può subire ritardi o
   *   difetti.
   * - Se la cassa non basta si va **a debito** entro il tetto di credito
   *   (60% del PIL nominale); oltre il tetto la spesa è rifiutata.
   */
  procureEquipment(mode: 'build' | 'buy', equipmentId: string, quantity = 1) {
    const polityId = this.ctx.playerPolityId();
    const equipment = equipmentById(equipmentId);
    if (!equipment) throw new Error(`equipment_unknown: ${equipmentId}`);
    const qty = Math.max(1, Math.floor(Number(quantity) || 1));
    // Il tetto è una guardia di sanità: con la scala **unitaria** delle armi
    // individuali un riarmo completo può superare di slancio il vecchio tetto
    // di mille «lotti»; cassa e credito restano il vero limite economico.
    if (qty > MAX_PROCUREMENT_QUANTITY) throw new Error('equipment_quantity_invalid');
    if (mode !== 'build' && mode !== 'buy') throw new Error('procurement_mode_invalid');
    const account = this.ctx.accounts()[polityId];
    const capacity = this.nationCapacity(polityId);
    const option = procurementOption(equipment, capacity);
    // Senza **nessun** impianto non si costruisce nulla: meglio rifiutare
    // l'ordine che aprirlo e lasciarlo fermo per sempre.
    if (mode === 'build' && this.industrialCapacity(polityId, capacity).total === 0) {
      throw new Error('build_unavailable: nessuna capacità industriale disponibile (nessuna fabbrica, porto o ateneo)');
    }
    if (mode === 'build' && !option.canBuild) {
      if (option.reasons.some(reason => reason.includes('credito'))) {
        throw new Error('credit_exhausted: cassa e credito insufficienti (debito al limite)');
      }
      throw new Error(`build_unavailable: ${option.reasons.join('; ') || 'capacità insufficienti'}`);
    }
    if (mode === 'buy' && !option.canBuy) {
      throw new Error('credit_exhausted: cassa e credito insufficienti (debito al limite)');
    }
    const unitCostMln = mode === 'build' ? option.buildCostMln : option.buyCostMln;
    const spentMln = unitCostMln * qty;
    const spentMld = spentMln / 1000;
    const stock = this.ctx.resourceStock(polityId);
    const financing = financePurchase(stock, account, spentMld);
    if (!financing.ok) throw new Error('credit_exhausted: debito al limite del tetto');
    const nextStock: ResourceStock = {
      ...stock,
      money: Math.round((stock.money - spentMld) * 1000) / 1000,
      weapons: mode === 'build' ? Math.max(0, stock.weapons - equipment.weaponsCost * qty) : stock.weapons,
    };
    this.ctx.saveResourceStock(polityId, nextStock);
    const financedMln = Math.round(financing.debtUsed * 1000);
    const debtMld = debtOf(nextStock);

    if (mode === 'buy') {
      const units = { ...this.arsenalUnits(polityId) };
      units[equipmentId] = (units[equipmentId] || 0) + qty;
      this.saveArsenal(polityId, units);
      return {
        mode, equipmentId, name: equipment.name, quantity: qty, spentMln,
        financedMln, debtMld, complete: true, units, strength: arsenalStrength(units),
      };
    }

    const order = this.startProductionOrder(equipmentId, qty, spentMln);
    const units = this.arsenalUnits(polityId);
    return {
      mode, equipmentId, name: equipment.name, quantity: qty, spentMln,
      financedMln, debtMld, complete: false, units, strength: arsenalStrength(units), order,
    };
  }

  private productionContext(): ProductionContext {
    const account = this.ctx.accounts()[this.ctx.playerPolityId()];
    const stock = this.ctx.resourceStock(this.ctx.playerPolityId());
    return {
      factories: Math.max(0, account?.factories || 0),
      ports: Math.max(0, account?.ports || 0),
      universities: Math.max(0, account?.universities || 0),
      stability: Number(account?.stability ?? 50),
      socialTension: Number(account?.socialTension ?? 0),
      technologies: stock.technologies,
    };
  }

  /** Apre un ordine di produzione: il costo è già stato pagato all'avvio. */
  private startProductionOrder(equipmentId: string, quantity: number, spentMln: number): ProductionOrder {
    const equipment = equipmentById(equipmentId)!;
    const order: ProductionOrder = {
      id: `ord-${shortId(8)}`,
      equipmentId,
      name: equipment.name,
      domain: equipment.domain,
      quantity,
      progress: 0,
      spentMln,
      startedTurn: this.ctx.currentTurn(),
      startedDate: this.ctx.currentDate(),
      status: 'in_progress',
      note: '',
      qualityLoss: 0,
      updatedDate: this.ctx.currentDate(),
    };
    this.saveProductionOrder(order);
    return order;
  }

  /** Ordini di produzione del giocatore, per API e dossier. */
  getProduction(overflowFactor = 1) {
    const context = this.productionContext();
    const orders = this.playerProductionOrders()
      .slice()
      .sort((a, b) => {
        const rank = (order: ProductionOrder) => order.status === 'in_progress' ? 0 : 1;
        return rank(a) - rank(b) || a.startedTurn - b.startedTurn;
      })
      .map(order => this.withOrderEta(order, context, overflowFactor));
    return { orders, inProgress: orders.filter(order => order.status === 'in_progress').length };
  }

  /**
   * Data di consegna prevista dal ritmo reale della linea: si ricalcola a ogni
   * lettura, così un imprevisto sposta la data invece di nasconderla.
   */
  private withOrderEta(order: ProductionOrder, context: ProductionContext, overflowFactor = 1): ProductionOrder {
    if (order.status !== 'in_progress') return order;
    const equipment = equipmentById(order.equipmentId);
    const rate = equipment ? productionRate(equipment, context) * overflowFactor : 0;
    if (rate <= 0) return { ...order, expectedDate: null };
    const months = Math.max(0, (100 - order.progress) / rate);
    return { ...order, expectedDate: addDays(this.ctx.currentDate(), Math.round(months * 30)) };
  }

  private playerProductionOrders(): ProductionOrder[] {
    if (!this.productionLoaded) {
      try {
        for (const order of productionRepository.list(this.ctx.gameId)) this.productionOrders.set(order.id, order);
      } catch (error) {
        console.warn('[GameSession] Lettura ordini di produzione non disponibile:', error);
      }
      this.productionLoaded = true;
    }
    return [...this.productionOrders.values()];
  }

  private saveProductionOrder(order: ProductionOrder): void {
    this.productionOrders.set(order.id, order);
    try {
      productionRepository.upsert(this.ctx.gameId, order);
    } catch (error) {
      console.warn('[GameSession] Impossibile salvare l’ordine di produzione:', error);
    }
  }

  /** Avanza gli ordini di produzione del giocatore e consegna a lavori finiti. */
  advanceProduction(days: number, account?: NationalAccount): string[] {
    if (this.ctx.isStrictGame() || days <= 0) return [];
    const orders = this.playerProductionOrders().filter(order => order.status === 'in_progress');
    if (orders.length === 0) return [];
    const context = this.productionContext();
    const bulletins: string[] = [];
    const polityId = this.ctx.playerPolityId();
    // Capacità industriale: se la domanda supera le linee disponibili, il lavoro
    // avanza più lentamente per tutti (stesso fattore per ogni ordine aperto).
    const capacity = this.industrialCapacity(polityId);
    if (capacity.blocked) {
      // Nessuna linea e lavoro da fare: non si avanza di un punto e non si
      // inventa un ritmo del 25%. Gli ordini restano aperti, in attesa.
      bulletins.push('🏭 Produzione bloccata: nessuna capacità industriale disponibile — nessuna linea di lavorazione. Le consegne restano ferme finché non si costruiscono impianti.');
      return bulletins;
    }
    const months = (days / 30) * capacity.overflowFactor;
    if (capacity.saturated && orders.length > 0) {
      bulletins.push(`🏭 Industria satura: ${capacity.demand} linee richieste su ${capacity.total} disponibili — la produzione avanza al ${Math.round(capacity.overflowFactor * 100)}% del ritmo.`);
    }
    for (const order of orders) {
      const seed = `${this.ctx.gameId}:${order.id}:${this.ctx.currentTurn()}`;
      const result = advanceOrder(order, context, months, seed);
      if (result.completed) {
        const units = { ...this.arsenalUnits(polityId) };
        units[order.equipmentId] = (units[order.equipmentId] || 0) + result.delivered;
        this.saveArsenal(polityId, units);
        productionRepository.remove(this.ctx.gameId, order.id);
        this.productionOrders.delete(order.id);
        const defect = result.order.qualityLoss > 0 ? ` (${Math.round(result.order.qualityLoss)}% difettose)` : '';
        bulletins.push(`🏭 Produzione completata: ${result.delivered}/${order.quantity} × ${order.name}${defect}.`);
      } else if (result.failed) {
        productionRepository.remove(this.ctx.gameId, order.id);
        this.productionOrders.delete(order.id);
        bulletins.push(`⚠️ Produzione fallita: ${order.name} — ${result.order.note}.`);
      } else {
        this.saveProductionOrder(result.order);
        if (result.setbackPct > 0) {
          bulletins.push(`⚠️ ${order.name}: imprevisto in produzione, avanzamento ${Math.round(result.order.progress)}% (−${result.setbackPct}%).`);
        }
      }
    }
    void account;
    return bulletins;
  }
}
