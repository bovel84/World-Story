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
 * Determinismo: seed di produzione `${orderId}:${data del periodo}` (OP-OBJECTS
 * SEED-DETERMINISM). La data simulata è la coordinata del tiro, non il turno né
 * il numero di chiamate: un salto lungo e i suoi periodi brevi tirano gli stessi
 * dadi.
 */

import { shortId } from '../utils/short-id';
import { arsenalRepository, productionRepository } from '../repositories';
import { creditHeadroom, creditLimit, debtOf, financePurchase, movementCost, payMovement, type ResourceStock } from '../core/simulation/MaterialEconomy';
import { advanceOrder, productionRate, productionRollSeed, type ProductionContext, type ProductionOrder } from '../core/simulation/MilitaryProduction';
import {
  arsenalCombatFactor, arsenalQualityIndex, arsenalStrength, describeArsenal, describeEndowment,
  DOMAIN_INFO, equipmentById, equipmentStrength, EQUIPMENT_CATALOG, EQUIPMENT_CREW, naturalResourcesFor,
  procurementOption, type NationCapacity,
} from '../core/simulation/MilitaryIndustry';
import { addDays } from '../core/simulation/calendar';
import type { WorldStateRegion } from '../core/simulation/WorldStateEngine';
import {
  arsenalSeedUnits, equipmentCoverage, epochForDate, establishmentFor, individualWeaponShareFor,
  militaryManpower, militaryReadiness, MILITARY_EPOCH_LABEL,
  type MilitaryEpoch, type ReadinessTone,
} from '../core/simulation/MilitaryDoctrine';
import {
  industrialCapacityOf, type IndustrialCapacity,
  type IndustrialMaintenanceInput, type IndustrialProjectInput,
} from '../core/simulation/IndustrialCapacity';
import {
  formationImpact, operatingPicture,
  type FormationImpact, type OperationalInput, type OperationalRegion, type OperatingObject, type OperatingPicture,
} from '../core/simulation/OperationalObjects';
import {
  aggregateArmyFromUnits,
  aggregateObjects, equipmentQuantity, equipmentTotals, isKnownEquipment,
  monthlyNeedsPerFormation, personnelOverlay, persistentObjects,
  materializeUnitsForArmy,
  rifleEquipmentId, rifleRequirement, transferCrewToShip, transferEquipment, transferMenToArmy,
  unitIdFor, unitNameFor, unitNumberOf, unitReadiness, unitStatusFromCoverage,
  type ArmyOperationalState, type MilitaryPersonnelState, type MilitaryUnitState,
} from '../core/simulation/OperationalState';
import type { OperationalStateStore } from './OperationalStateStore';
import { splitMaterialPeriod } from './NationStateService';
import { materialBalance } from './materialBalance';
import { effectiveMaterialNeeds, materialNeeds } from '../core/simulation/MaterialEconomy';
import type { NationalAccount } from '../core/simulation/WorldStateEngine';

/**
 * Tetto di sanità su una singola richiesta di costruzione/acquisto. Non è un
 * limite economico (quello lo fa cassa + credito): con le armi individuali
 * contate una per una, un riarmo completo supera il vecchio tetto di 1000.
 */
export const MAX_PROCUREMENT_QUANTITY = 200_000;

const nonNegative = (value: unknown): number => {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? number : 0;
};
const round3 = (value: number) => Math.round(value * 1000) / 1000;

/**
 * Registro dei bollettini di produzione di **un salto di tempo**: le voci già
 * pubblicate non si ripetono e lo stato di lavorazione di ogni ordine è quello
 * lasciato dal periodo precedente. Condiviso da tutti i periodi materiali dello
 * stesso salto (OP-OBJECTS TIME-STEP: un anno fermo è **una** riga, non dodici).
 */
export interface ProductionNotices {
  seen: Set<string>;
  state: Map<string, string>;
}

/** Registro vuoto: una chiamata isolata non ha memoria dei periodi precedenti. */
export function createProductionNotices(): ProductionNotices {
  return { seen: new Set<string>(), state: new Map<string, string>() };
}

/**
 * Esito (o anteprima) di un'azione su un **reparto**: gli stessi numeri del
 * motore, in tabella PRIMA → DOPO, come l'anteprima di formazione. `blocked`
 * arriva dalle regole del motore (riserva, deposito, destinazione), mai dalla UI.
 */
export interface UnitActionImpact {
  applied: boolean;
  action: 'reinforce' | 'reequip' | 'transfer' | 'reassign';
  unitId: string;
  unitName: string;
  armyId: string;
  armyName: string | null;
  blocked: boolean;
  blockedReason: string | null;
  rows: Array<{ label: string; before: number; after: number; unit: 'numero' | 'pct' | 'mld' | 'per_mese' | 'mesi'; tone: ReadinessTone }>;
  unit: MilitaryUnitState;
  regionName?: string | null;
  stock?: { food: number; fuel: number; money: number };
  note: string;
  why: string;
}

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
  /** Regioni della polity giocante (province, oggetti, costa): oggetti concreti. */
  playerRegions?(): OperationalRegion[];
  /**
   * Aggiunge un oggetto `army` al mondo e lo persiste. Ritorna dove è finito;
   * `null` se il mondo non è disponibile (partite non avviate nei test).
   */
  addArmyObject?(input: { armyId?: string | null; name: string; formations: number }):
    { regionId: string; regionName: string; name: string; armyId?: string | null } | null;
  /**
   * OP-OBJECTS PERSISTENT: stato proprio degli oggetti (impianti, navi, flotte,
   * cantieri, equipaggi; le armate vivono sugli oggetti della mappa). Il seed
   * lazy è dentro lo store: qui si legge solo lo stato corrente.
   */
  operationalObjects?(): OperationalStateStore;
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
    // OP-OBJECTS PERSISTENT: se gli impianti reali esistono, la capacità è la
    // **loro** somma; `factories/ports/universities` restano fallback legacy.
    const store = this.operational();
    let facilities: Array<{ id: string; kind: string; capacity: number }> | undefined;
    if (store) {
      try {
        facilities = store.facilities().map(facility => ({
          id: facility.id, kind: facility.kind, capacity: facility.capacity,
        }));
      } catch (error) {
        console.warn('[MilitaryService] Impianti persistenti non disponibili:', error);
      }
    }
    return industrialCapacityOf({
      factories: capacity.factories,
      ports: capacity.ports,
      universities: capacity.universities,
      facilities,
      orders: this.playerProductionOrders(),
      projects: this.ctx.ongoingProcesses?.() || [],
      maintenance: this.ctx.maintenanceObligations?.() || [],
    });
  }

  /** Arsenale noto in cache senza seed né scritture (per i read model). */
  peekArsenal(polityId: string): Record<string, number> | undefined {
    return this.arsenals.get(polityId);
  }

  // ── OP-OBJECTS PERSISTENT: deposito, totale nazionale, uomini reali ────────

  /**
   * Fabbisogno materiale **efficace**: con gli oggetti persistenti il militare
   * arriva dalle armate e dalle navi reali (una sola contabilità); senza, resta
   * quello derivato dai reparti. Prontezza e autonomia leggono gli stessi numeri
   * del tick.
   */
  private effectiveNeeds(account?: NationalAccount) {
    const store = this.operational();
    if (!store) return materialNeeds(account);
    try {
      const overlay = store.materialFlow();
      return overlay ? effectiveMaterialNeeds(account, overlay) : materialNeeds(account);
    } catch {
      return materialNeeds(account);
    }
  }

  /** Store dello stato proprio degli oggetti, se la sessione lo fornisce. */
  private operational(): OperationalStateStore | null {
    try {
      return this.ctx.operationalObjects?.() ?? null;
    } catch (error) {
      console.warn('[MilitaryService] Stato degli oggetti non disponibile:', error);
      return null;
    }
  }

  /** Fabbisogni mensili di un'armata: dal fabbisogno unitario del motore. */
  private needsForArmy(epoch: MilitaryEpoch, formations: number): { fuel: number; weapons: number; food: number } {
    const per = monthlyNeedsPerFormation(epoch);
    const units = Math.max(0, Math.round(nonNegative(formations)));
    return {
      fuel: round3(per.fuel * units),
      weapons: round3(per.weapons * units),
      food: round3(per.food * units),
    };
  }

  /** **Deposito**: pezzi in magazzino e non assegnati a un oggetto. */
  depotUnits(polityId: string): Record<string, number> {
    return this.arsenalUnits(polityId);
  }

  /**
   * **Totale nazionale** = deposito + equipaggiamento assegnato agli oggetti.
   * È questo che alimenta copertura, qualità e forza: quando un pezzo passa dal
   * deposito a un'armata il totale non cambia, cambia solo chi lo possiede.
   */
  nationalUnits(polityId: string): Record<string, number> {
    const depot = this.depotUnits(polityId);
    const store = this.operational();
    if (!store) return depot;
    try {
      return equipmentTotals(depot, store.assignedEquipment());
    } catch (error) {
      console.warn('[MilitaryService] Equipaggiamento assegnato non disponibile:', error);
      return depot;
    }
  }

  /**
   * Manpower del motore con l'overlay dello **stock** di uomini: la dottrina dà
   * il bacino e il tetto, lo stato di partita dice chi è sotto le armi davvero.
   * Senza stato persistente resta la dottrina (partita legacy).
   */
  private manpowerOf(polityId: string, epoch: MilitaryEpoch): {
    doctrine: ReturnType<typeof militaryManpower>;
    manpower: ReturnType<typeof militaryManpower>;
    personnel: MilitaryPersonnelState | null;
  } {
    const account = this.ctx.accounts()[polityId];
    const doctrine = militaryManpower({
      population: Number(account?.population || 0),
      formations: Number(account?.forces || 0),
      mobilizedFormations: Number(account?.mobilized || 0),
      epoch,
    });
    const store = this.operational();
    if (!store) return { doctrine, manpower: doctrine, personnel: null };
    try {
      const personnel = store.personnel();
      return { doctrine, manpower: personnelOverlay(personnel, doctrine), personnel };
    } catch (error) {
      console.warn('[MilitaryService] Personale persistente non disponibile:', error);
      return { doctrine, manpower: doctrine, personnel: null };
    }
  }

  /**
   * Quadro operativo: oggetti concreti (armate, impianti, cantieri, navi) e
   * catene produttive. Tutto derivato dai fatti del motore, nessuno stato nuovo.
   */
  getOperatingPicture(): OperatingPicture {
    const polityId = this.ctx.playerPolityId();
    const capacity = this.nationCapacity(polityId);
    // Copertura, qualità e forza si misurano sul **totale nazionale** (deposito +
    // assegnato): l'aggregato non cambia quando un pezzo viene assegnato.
    const units = this.nationalUnits(polityId);
    const account = this.ctx.accounts()[polityId];
    const stock = this.ctx.resourceStock(polityId);
    const needs = this.effectiveNeeds(account);
    const epoch = this.epoch();
    const { manpower, personnel } = this.manpowerOf(polityId, epoch);
    const coverage = equipmentCoverage({ units, manpower, epoch, ports: account?.ports });
    const industrial = this.industrialCapacity(polityId, capacity);
    const qualityIndex = arsenalQualityIndex(units);
    const readiness = militaryReadiness({
      coverage,
      fuel: { stock: stock.fuel, need: needs.fuel },
      weapons: { stock: stock.weapons, need: needs.weapons },
      qualityIndex,
      manpower,
    });
    let balance: OperationalInput['balance'] = [];
    try {
      balance = materialBalance(stock, account, capacity.endowment);
    } catch (error) {
      console.warn('[MilitaryService] Bilancio materiale non disponibile per gli oggetti:', error);
    }
    // Attribuzioni dichiarate dei costi: la spesa militare mensile del motore e
    // il resto delle spese civili. Servono solo a ripartire per oggetto una voce
    // che il motore pubblica a livello nazionale.
    const militaryMonthlyMld = nonNegative(account?.nominalGdpUsdBillions) * nonNegative(account?.defenceBurdenPct) / 100 / 12;
    const civilMonthlyMld = Math.max(0, nonNegative(account?.monthlyExpenses) - militaryMonthlyMld);
    const orders = this.playerProductionOrders();
    // Oggetti reali dallo stato persistente (seed lazy compreso): le schede di
    // armate, impianti, navi, flotte e cantieri sono le loro, non quote
    // dell'aggregato. Senza store resta il percorso derivato del motore.
    const store = this.operational();
    let persistent: OperatingObject[] | undefined;
    let activity: number | undefined;
    if (store) {
      try {
        const snapshot = store.snapshot();
        const individual = coverage.find(row => row.category === 'individualWeapons');
        activity = industrial.blocked ? 0 : industrial.overflowFactor;
        // Lo **stesso** pass di allocazione del tick: la scheda mostra la
        // simulazione che modifica davvero lo stato del turno.
        const allocation = store.allocation();
        persistent = persistentObjects({
          polityId,
          date: this.ctx.currentDate(),
          epoch,
          armies: snapshot.armies,
          units: snapshot.units,
          facilities: snapshot.facilities,
          ships: snapshot.ships,
          fleets: snapshot.fleets,
          constructions: snapshot.constructions,
          personnel: personnel ?? snapshot.personnel,
          ordersById: Object.fromEntries(orders.map(order => [order.id, order])),
          readinessPct: readiness.readinessPct,
          individualCoveragePct: individual ? individual.coveragePct : 0,
          activity,
          blocked: industrial.blocked,
          stock: stock as unknown as Record<string, number>,
          endowment: capacity.endowment as unknown as Record<string, number>,
          civilMonthlyMld,
          militaryMonthlyMld,
          fuelMonths: needs.fuel > 0 ? stock.fuel / needs.fuel : null,
          // Chi decide se un'azione del reparto è eseguibile: riserva e deposito.
          availableReserve: manpower.availableReserve,
          depotUnits: this.depotUnits(polityId),
          allocation,
        });
      } catch (error) {
        console.warn('[MilitaryService] Oggetti persistenti non disponibili:', error);
      }
    }
    return operatingPicture({
      polityId,
      epoch,
      date: this.ctx.currentDate(),
      account: account as never,
      manpower,
      coverage,
      readiness,
      units,
      qualityIndex,
      stock,
      needs,
      balance,
      capacity: industrial,
      orders,
      projects: this.ctx.ongoingProcesses?.() || [],
      maintenance: this.ctx.maintenanceObligations?.() || [],
      regions: this.ctx.playerRegions?.() || [],
      endowment: capacity.endowment,
      technologies: stock.technologies,
      persistentObjects: persistent,
    });
  }

  /**
   * Anteprima di creazione di reparti: `PRIMA → DOPO` con i numeri del motore,
   * nessuna scrittura. È la risposta a «quanto costa e che conseguenza ha?».
   */
  formationPreview(input: { formations?: number; armyId?: string | null; name?: string } = {}) {
    const polityId = this.ctx.playerPolityId();
    const account = this.ctx.accounts()[polityId];
    const stock = this.ctx.resourceStock(polityId);
    const regions = this.worldRegions();
    const target = this.formationTarget(input.armyId, input.name, regions);
    const epoch = this.epoch();
    const depot = this.depotUnits(polityId);
    const national = this.nationalUnits(polityId);
    const { manpower, personnel } = this.manpowerOf(polityId, epoch);
    // Armi individuali già in mano all'armata che riceve i reparti: il PRIMA →
    // DOPO mostra dove finiscono i pezzi (deposito che cala, armata che cresce).
    const store = this.operational();
    let assignedRifles = 0;
    if (store) {
      try {
        const armies = store.armies();
        const armyTarget = target.armyId
          ? armies.find(army => String(army.objectId || army.id) === String(target.armyId))
          : armies.find(army => !army.objectId) ?? null;
        assignedRifles = Number(armyTarget?.equipment?.['fucili'] || 0);
      } catch (error) {
        console.warn('[MilitaryService] Equipaggiamento dell\'armata non disponibile:', error);
      }
    }
    const impact = formationImpact({
      epoch,
      account,
      // Copertura sul totale nazionale; disponibilità del piano sul deposito.
      units: national,
      depot,
      personnel: personnel ?? undefined,
      assignedRifles,
      stock,
      qualityIndex: arsenalQualityIndex(national),
      regions,
      options: this.worldStateOptions(),
      targetRegionId: target.regionId,
      armyName: target.armyName,
      armyId: target.armyId,
      formations: input.formations,
    });
    // Anteprima degli **uomini**: la riserva è uno stock, quindi il piano può
    // essere bloccato anche quando i fucili ci sono ma i richiamabili no.
    const menToTransfer = impact.plan.men;
    const reserveAvailable = manpower.availableReserve;
    const reservesShort = menToTransfer > reserveAvailable;
    const blockedReason = impact.plan.blocked
      ? impact.plan.blockedReason
      : reservesShort
        ? `Riserva insufficiente: servono ${menToTransfer.toLocaleString('it-IT')} uomini richiamabili, ne restano ${Math.max(0, Math.floor(reserveAvailable)).toLocaleString('it-IT')}.`
        : null;
    return {
      ...impact,
      target,
      plan: { ...impact.plan, blocked: Boolean(blockedReason), blockedReason },
      reserves: {
        required: menToTransfer,
        available: Math.max(0, Math.floor(reserveAvailable)),
        missing: Math.max(0, menToTransfer - reserveAvailable),
      },
    };
  }

  /**
   * Crea davvero i reparti, in **transazione atomica**: verifica uomini e
   * equipaggiamento, paga il materiale, trasferisce uomini dalla riserva e
   * pezzi dal deposito all'armata, aggiorna lo stato persistente. Il «dopo» è
   * del motore: manpower, fabbisogni, copertura e conti si muovono perché è
   * cambiato il fatto (i reparti e chi possiede i pezzi), non perché lo dica la UI.
   */
  raiseFormation(input: { formations?: number; armyId?: string | null; name?: string; regionId?: string } = {}) {
    const polityId = this.ctx.playerPolityId();
    const account = this.ctx.accounts()[polityId];
    const epoch = this.epoch();
    const formations = Math.max(1, Math.round(Number(input.formations) || 1));
    const preview = this.formationPreview({ ...input, formations });
    if (preview.plan.blocked) throw new Error(`formation_blocked: ${preview.plan.blockedReason}`);

    const store = this.operational();
    const depot = this.depotUnits(polityId);
    const { doctrine, personnel } = this.manpowerOf(polityId, epoch);

    // 1. Uomini: dalla **riserva disponibile** ai reparti. Mai a debito.
    const personnelAfter = personnel
      ? transferMenToArmy(personnel, preview.plan.men, doctrine)
      : null;
    if (personnel && !personnelAfter) {
      throw new Error(`formation_blocked: riserva insufficiente — servono ${preview.plan.men.toLocaleString('it-IT')} uomini richiamabili.`);
    }

    // 2. Equipaggiamento: dal **deposito** all'armata (stesso totale nazionale).
    const targetArmyId = input.armyId ?? null;
    const snapshot = store ? store.snapshot() : null;
    const before = snapshot?.armies.find(army => targetArmyId && String(army.objectId || army.id) === String(targetArmyId)) ?? null;
    const transfer = transferEquipment({
      depot,
      assigned: before?.equipment ?? {},
      items: preview.plan.items.map(item => ({ equipmentId: item.equipmentId, quantity: item.consumed })),
    });
    if (!transfer) throw new Error('formation_blocked: equipaggiamento non disponibile nel deposito.');

    // 3. Denaro: cassa e credito, la stessa finanza del commercio di armi.
    const spentMld = preview.plan.initialCostMln / 1000;
    const financing = financePurchase(this.ctx.resourceStock(polityId), account, spentMld);
    if (!financing.ok) throw new Error('credit_exhausted: cassa e credito insufficienti per formare il reparto');
    const stockAfter: ResourceStock = {
      ...this.ctx.resourceStock(polityId),
      money: round3(this.ctx.resourceStock(polityId).money - spentMld),
    };

    // 4. Scritture: prima lo stato persistente, poi il mondo (l'ordine è quello
    //    che rende il fallimento parziale impossibile: nessuno stato a metà).
    this.saveArsenal(polityId, transfer.depot);
    this.ctx.saveResourceStock(polityId, stockAfter);
    if (personnelAfter) store?.savePersonnel(personnelAfter);
    const placed = this.ctx.addArmyObject?.({
      armyId: input.armyId ?? null,
      name: preview.target.armyName,
      formations,
    }) ?? null;

    // 5. Il reparto **esiste davvero** (MILITARY-UNITS): l'armata non è più un
    //    aggregato con un livello, è la somma dei suoi reparti. Il mondo ha già
    //    dichiarato un reparto in più (il livello dell'armata): se la
    //    materializzazione lazy l'ha creato **vuoto** (`forming`) è quello che
    //    riceve uomini e pezzi; altrimenti il reparto nasce qui. La somma
    //    dell'armata (uomini, pezzi, fabbisogni, reparti) si **deriva**, non si
    //    dichiara: una sola fonte di verità.
    let createdUnit: MilitaryUnitState | null = null;
    if (store) {
      const after = store.snapshot();
      const locatedId = placed?.armyId ?? input.armyId ?? null;
      const garrisonId = after.armies.find(item => !item.objectId)?.id ?? null;
      const targetArmy = locatedId
        ? after.armies.find(army => String(army.objectId || army.id) === String(locatedId)) ?? null
        : after.armies.find(army => army.id === garrisonId) ?? null;
      if (targetArmy) {
        const existing = after.units.filter(unit => String(unit.armyId) === String(targetArmy.id));
        const pending = existing.find(unit => !unit.legacyDerived
          && unit.status === 'forming'
          && Math.round(nonNegative(unit.personnel)) <= 0
          && Object.keys(unit.equipment || {}).length === 0) ?? null;
        const index = pending
          ? unitNumberOf(pending)
          : existing.reduce((max, unit) => Math.max(max, unitNumberOf(unit)), 0) + 1;
        const moved: Record<string, number> = {};
        for (const item of preview.plan.items) {
          if (item.consumed > 0) moved[item.equipmentId] = Math.round(item.consumed);
        }
        const rifles = equipmentQuantity(moved, rifleEquipmentId());
        const status = unitStatusFromCoverage({ assigned: rifles, required: rifleRequirement(epoch, 1) });
        createdUnit = {
          id: pending?.id ?? unitIdFor(targetArmy.id, index),
          armyId: targetArmy.id,
          name: pending?.name ?? unitNameFor(epoch, index),
          personnel: preview.plan.men,
          equipment: moved,
          monthlyNeeds: this.needsForArmy(epoch, 1),
          readiness: 0,
          status,
          regionId: placed?.regionId ?? targetArmy.regionId,
          regionName: placed?.regionName ?? targetArmy.regionName,
          updatedDate: this.ctx.currentDate(),
          legacyDerived: false,
        };
        createdUnit = { ...createdUnit, readiness: unitReadiness({ unit: createdUnit, epoch }) };
        // Prima lo stato dell'armata (che ora è reale), poi i reparti che ne
        // sono la somma: `saveUnits` riallinea l'aggregato nella stessa scrittura.
        store.saveArmies(after.armies.map(army => (army.id === targetArmy.id
          ? { ...army, status: 'operational' as const, legacyDerived: false }
          : army)));
        store.saveUnits(pending
          ? after.units.map(unit => (unit.id === pending.id ? createdUnit as MilitaryUnitState : unit))
          : [...after.units, createdUnit]);
      }
    }

    return {
      applied: true,
      formations,
      name: placed?.name || preview.target.armyName,
      regionId: placed?.regionId || preview.target.regionId,
      regionName: placed?.regionName || '',
      spentMln: Math.round(preview.plan.initialCostMln * 100) / 100,
      financedMln: Math.round(financing.debtUsed * 1000),
      men: preview.plan.men,
      // Il reparto creato: la UI lo mostra senza inventare nulla.
      unit: createdUnit,
      equipment: transfer.assigned,
      impact: preview,
    };
  }

  // ── MILITARY-UNITS: azioni sui reparti (P5) ──────────────────────────────

  /**
   * Stato e prontezza di un reparto ricalcolati dai fatti del motore: la
   * copertura d'armi individuali decide fra `forming`, `operational` e
   * `degraded` (stesse soglie di `armyStatusFromCoverage`). Ritirata e
   * distruzione sono fatti del mondo e non si toccano qui.
   */
  private refreshUnit(unit: MilitaryUnitState, epoch: MilitaryEpoch): MilitaryUnitState {
    const required = rifleRequirement(epoch, 1);
    const assigned = equipmentQuantity(unit.equipment, rifleEquipmentId());
    const status: MilitaryUnitState['status'] = unit.status === 'destroyed' || unit.status === 'retreating'
      ? unit.status
      : unitStatusFromCoverage({ assigned, required });
    const next = { ...unit, status };
    return { ...next, readiness: unitReadiness({ unit: next, epoch }) };
  }

  /** Reparti (unità) persistenti del paese: la granularità sotto le armate. */
  militaryUnits(): MilitaryUnitState[] {
    const store = this.operational();
    if (!store) return [];
    try {
      return store.units();
    } catch (error) {
      console.warn('[MilitaryService] Reparti non disponibili:', error);
      return [];
    }
  }

  /**
   * Azione su un reparto: **Trasferisci · Rinforza · Riequipaggia · Cambia
   * armata**. Con `dryRun` è l'anteprima PRIMA → DOPO (nessuna scrittura); senza
   * è l'azione vera: usa gli stessi passi del motore (riserva addestrata,
   * deposito, costo di movimento del material flow) e l'aggregato dell'armata,
   * che è **la somma** dei suoi reparti, viene riallineato in una scrittura sola.
   */
  unitAction(input: {
    action: 'reinforce' | 'reequip' | 'transfer' | 'reassign';
    unitId: string;
    men?: number;
    equipmentId?: string;
    quantity?: number;
    regionId?: string;
    armyId?: string;
    dryRun?: boolean;
  }): UnitActionImpact {
    const polityId = this.ctx.playerPolityId();
    const epoch = this.epoch();
    const store = this.operational();
    if (!store) throw new Error('unit_unknown: stato degli oggetti non disponibile');
    const snapshot = input.dryRun ? store.previewSnapshot() : store.snapshot();
    const unit = snapshot.units.find(item => String(item.id) === String(input.unitId));
    if (!unit) throw new Error(`unit_unknown: reparto «${input.unitId}» inesistente`);
    const army = snapshot.armies.find(item => String(item.id) === String(unit.armyId)) ?? null;
    const { doctrine, manpower, personnel } = this.manpowerOf(polityId, epoch);
    const rows: UnitActionImpact['rows'] = [];
    const toneFor = (value: number, unitOf: UnitActionImpact['rows'][number]['unit'], good: number, warn: number): ReadinessTone => (
      unitOf !== 'pct' ? 'neutral' : value >= good ? 'positive' : value >= warn ? 'warning' : 'critical'
    );
    const push = (label: string, before: number, after: number, unitOf: UnitActionImpact['rows'][number]['unit'], good = 0, warn = 0) => {
      rows.push({ label, before: round3(before), after: round3(after), unit: unitOf, tone: toneFor(after, unitOf, good, warn) });
    };
    let personnelAfter: MilitaryPersonnelState | null = null;
    const blocked = (blockedReason: string, note: string, why: string): UnitActionImpact => ({
      applied: false,
      action: input.action,
      unitId: unit.id,
      unitName: unit.name,
      armyId: unit.armyId,
      armyName: army?.name ?? null,
      blocked: true,
      blockedReason,
      rows,
      unit,
      regionName: unit.regionName,
      note,
      why,
    });
    const finish = (next: MilitaryUnitState, nextUnits: MilitaryUnitState[], note: string, why: string, stock?: ResourceStock): UnitActionImpact => {
      if (!input.dryRun) {
        if (personnelAfter) store.savePersonnel(personnelAfter);
        if (stock) this.ctx.saveResourceStock(polityId, stock);
        store.saveUnits(nextUnits);
      }
      return {
        applied: !input.dryRun,
        action: input.action,
        unitId: next.id,
        unitName: next.name,
        armyId: next.armyId,
        armyName: snapshot.armies.find(item => String(item.id) === String(next.armyId))?.name ?? army?.name ?? null,
        blocked: false,
        blockedReason: null,
        rows,
        unit: next,
        regionName: next.regionName,
        stock: stock ? { food: stock.food, fuel: stock.fuel, money: stock.money } : undefined,
        note,
        why,
      };
    };

    if (input.action === 'reinforce') {
      const menPerFormation = doctrine.menPerFormation;
      const missing = Math.max(0, menPerFormation - Math.round(nonNegative(unit.personnel)));
      const available = Math.max(0, Math.floor(manpower.availableReserve));
      const wanted = input.men === undefined
        ? Math.min(missing, available)
        : Math.max(0, Math.round(Number(input.men) || 0));
      if (missing <= 0) return blocked(`Organico già completo: ${menPerFormation.toLocaleString('it-IT')} uomini per reparto.`, 'Nessun uomo da aggiungere.', 'Il reparto ha già l\'organico d\'epoca.');
      if (wanted <= 0) return blocked('Nessun uomo disponibile: la riserva addestrata è esaurita.', 'Nessun uomo da aggiungere.', 'Gli uomini arrivano solo dalla riserva addestrata (`transferMenToArmy`).');
      if (wanted > available) return blocked(`Riserva insufficiente: servono ${wanted.toLocaleString('it-IT')} uomini richiamabili, ne restano ${available.toLocaleString('it-IT')}.`, 'Nessun uomo trasferito.', 'Gli uomini arrivano solo dalla riserva addestrata (`transferMenToArmy`).');
      const nextPersonnel = personnel ? transferMenToArmy(personnel, wanted, doctrine) : null;
      if (personnel && !nextPersonnel) return blocked('Riserva insufficiente: nessun uomo richiamabile.', 'Nessun uomo trasferito.', 'Gli uomini arrivano solo dalla riserva addestrata (`transferMenToArmy`).');
      personnelAfter = nextPersonnel;
      const next = this.refreshUnit({ ...unit, personnel: Math.round(nonNegative(unit.personnel)) + wanted, updatedDate: this.ctx.currentDate() }, epoch);
      push('Uomini del reparto', unit.personnel, next.personnel, 'numero');
      push('Organico', menPerFormation > 0 ? nonNegative(unit.personnel) / menPerFormation * 100 : 100, menPerFormation > 0 ? next.personnel / menPerFormation * 100 : 100, 'pct', 95, 60);
      push('Riserva addestrata', manpower.availableReserve, Math.max(0, manpower.availableReserve - wanted), 'numero');
      push('Prontezza', unit.readiness * 100, next.readiness * 100, 'pct', 80, 60);
      return finish(next, snapshot.units.map(item => (item.id === unit.id ? next : item)), `Rinforzato «${next.name}»: ${wanted.toLocaleString('it-IT')} uomini dalla riserva.`, 'Gli uomini passano dalla riserva addestrata al reparto: nessuno viene creato dal nulla.');
    }

    if (input.action === 'reequip') {
      const equipmentId = (input.equipmentId || rifleEquipmentId()).trim();
      if (!isKnownEquipment(equipmentId)) throw new Error(`equipment_unknown: «${equipmentId}» non è nel catalogo`);
      const isIndividual = equipmentId === rifleEquipmentId();
      const required = isIndividual ? rifleRequirement(epoch, 1) : null;
      const assigned = equipmentQuantity(unit.equipment, equipmentId);
      const depot = this.depotUnits(polityId);
      const inDepot = equipmentQuantity(depot, equipmentId);
      if (required === null && input.quantity === undefined) throw new Error(`unit_invalid: quantity obbligatoria per «${equipmentId}»`);
      const missing = required === null
        ? Math.max(0, Math.round(Number(input.quantity) || 0))
        : Math.max(0, required - assigned);
      const wanted = Math.min(missing, inDepot);
      const label = equipmentById(equipmentId)?.name || equipmentId;
      if (missing <= 0) return blocked(`Dotazione già completa: ${assigned.toLocaleString('it-IT')} pezzi assegnati.`, 'Nessun pezzo trasferito.', 'La dotazione del reparto è già quella d\'epoca.');
      if (wanted <= 0) return blocked(`Deposito senza «${label}»: non c\'è nulla da assegnare.`, 'Nessun pezzo trasferito.', 'I pezzi si costruiscono o si comprano: il deposito è ciò che esiste davvero.');
      const transfer = transferEquipment({ depot, assigned: unit.equipment, items: [{ equipmentId, quantity: wanted }] });
      if (!transfer) return blocked('Deposito insufficiente per il trasferimento.', 'Nessun pezzo trasferito.', 'Il deposito è ciò che esiste davvero.');
      const next = this.refreshUnit({ ...unit, equipment: transfer.assigned, updatedDate: this.ctx.currentDate() }, epoch);
      push(`${label} del reparto`, assigned, equipmentQuantity(transfer.assigned, equipmentId), 'numero');
      if (required !== null) push('Copertura armi individuali', required > 0 ? assigned / required * 100 : 100, required > 0 ? equipmentQuantity(transfer.assigned, equipmentId) / required * 100 : 100, 'pct', 95, 80);
      push(`Deposito · ${label}`, inDepot, equipmentQuantity(transfer.depot, equipmentId), 'numero');
      push('Prontezza', unit.readiness * 100, next.readiness * 100, 'pct', 80, 60);
      const partial = wanted < missing ? ` (parziale: mancano ancora ${(missing - wanted).toLocaleString('it-IT')} pezzi)` : '';
      const outcome = finish(next, snapshot.units.map(item => (item.id === unit.id ? next : item)), `Assegnati ${wanted.toLocaleString('it-IT')} × ${label} a «${next.name}»${partial}.`, 'Il pezzo passa dal deposito al reparto: deposito + assegnato resta il totale nazionale.');
      if (!input.dryRun) this.saveArsenal(polityId, transfer.depot);
      return outcome;
    }

    if (input.action === 'transfer') {
      const regions = this.ctx.playerRegions?.() || [];
      const target = input.regionId ? regions.find(region => String(region.id) === String(input.regionId)) : undefined;
      if (!target) throw new Error(`region_unknown: «${input.regionId ?? ''}» non è una regione del paese`);
      if (String(unit.regionId || '') === String(target.id)) return blocked(`Il reparto è già in ${target.name}.`, 'Nessuno spostamento.', 'Un reparto si sposta in un\'altra regione, non dentro la propria.');
      const before = this.ctx.resourceStock(polityId);
      const cost = movementCost(before);
      const payment = payMovement(before, cost);
      const next = { ...unit, regionId: target.id, regionName: target.name || null, updatedDate: this.ctx.currentDate() };
      push('Cibo (scorte)', before.food, payment.stock.food, 'numero');
      push('Carburante (scorte)', before.fuel, payment.stock.fuel, 'numero');
      push('Cassa', before.money, payment.stock.money, 'mld');
      const why = cost.motorized
        ? 'Movimento meccanizzato: paga cibo, carburante e denaro con lo **stesso** costo del motore (`movementCost`).'
        : 'Movimento appiedato: paga cibo e denaro con lo **stesso** costo del motore (`movementCost`). La motorizzazione aggiungerebbe il carburante.';
      const note = payment.covered
        ? `«${next.name}» trasferito in ${next.regionName}.`
        : `«${next.name}» trasferito in ${next.regionName} con scorte insufficienti: ${payment.shortages.join('; ')}.`;
      return finish(next, snapshot.units.map(item => (item.id === unit.id ? next : item)), note, why, payment.stock);
    }

    const targetArmy = input.armyId
      ? snapshot.armies.find(item => String(item.id) === String(input.armyId))
      : undefined;
    if (!targetArmy) throw new Error(`army_unknown: «${input.armyId ?? ''}» non è un\'armata dello stato`);
    if (String(targetArmy.id) === String(unit.armyId)) return blocked(`Il reparto è già in ${targetArmy.name}.`, 'Nessuno spostamento.', 'Un reparto appartiene a una sola armata.');
    // L'id del reparto segue l'armata di appartenenza (gli id sono unici nello
    // stato): cambiando armata il reparto riceve la numerazione libera
    // dell'armata di arrivo. Il **nome** resta quello del reparto.
    const nextNumber = snapshot.units
      .filter(item => String(item.armyId) === String(targetArmy.id))
      .reduce((max, item) => Math.max(max, unitNumberOf(item)), 0) + 1;
    const next = {
      ...unit,
      id: unitIdFor(targetArmy.id, nextNumber),
      armyId: targetArmy.id,
      regionId: targetArmy.regionId ?? unit.regionId,
      regionName: targetArmy.regionName ?? unit.regionName,
      updatedDate: this.ctx.currentDate(),
    };
    const nextUnits = snapshot.units.map(item => (item.id === unit.id ? next : item));
    const sumOf = (armyId: string) => aggregateArmyFromUnits(
      snapshot.armies.find(item => String(item.id) === String(armyId)) ?? targetArmy,
      nextUnits.filter(item => String(item.armyId) === String(armyId)),
    );
    const from = sumOf(unit.armyId);
    const to = sumOf(targetArmy.id);
    push(`Reparti · ${army?.name || 'armata di partenza'}`, army?.formations ?? 0, from.formations, 'numero');
    push(`Uomini · ${army?.name || 'armata di partenza'}`, army?.personnel ?? 0, from.personnel, 'numero');
    push(`Reparti · ${targetArmy.name}`, targetArmy.formations, to.formations, 'numero');
    push(`Uomini · ${targetArmy.name}`, targetArmy.personnel, to.personnel, 'numero');
    // Il mondo dichiara ancora N reparti per l'armata di partenza (il livello
    // dell'oggetto della mappa non si tocca da qui): la materializzazione crea un
    // reparto **in formazione, senza uomini**. Il giocatore deve saperlo.
    const leaving = materializeUnitsForArmy({
      army: snapshot.armies.find(item => String(item.id) === String(unit.armyId)) ?? targetArmy,
      epoch,
      date: this.ctx.currentDate(),
      formations: army?.formations ?? 0,
      existing: nextUnits.filter(item => String(item.armyId) === String(unit.armyId)),
    });
    const cadre = Math.max(0, leaving.length - from.formations);
    const note = cadre > 0
      ? `«${next.name}» passa a ${targetArmy.name}. Il mondo dichiara ancora ${army?.formations ?? 0} reparti per «${army?.name || unit.armyId}»: ne nasce uno **in formazione, senza uomini** (la mappa non si tocca da qui: nessun uomo viene creato dal nulla).`
      : `«${next.name}» passa a ${targetArmy.name}.`;
    return finish(next, nextUnits, note, 'Uomini, pezzi e fabbisogni seguono il reparto: le due armate sono la somma dei loro reparti.');
  }

  /** Regioni del mondo (per gli oggetti concreti e per il «dopo» del motore). */
  private worldRegions(): WorldStateRegion[] {
    const polityId = this.ctx.playerPolityId();
    // I fatti della provincia (popolazione, PIL, potenza militare) sono quelli
    // veri: la proiezione del motore deve vedere la stessa nazione, con i
    // reparti in più, non una nazione impoverita.
    return (this.ctx.playerRegions?.() || []).map(region => ({
      id: region.id,
      owner: polityId,
      population: region.population || 0,
      gdp: region.gdp || 0,
      militaryPower: region.militaryPower || 0,
      coastal: region.coastal,
      objects: region.objects,
    }));
  }

  /**
   * Dove finisce il nuovo reparto: l'armata scelta o la prima provincia della
   * nazione; il nome di un'armata nuova segue la numerazione di quelle in campo.
   */
  private formationTarget(
    armyId: string | null | undefined,
    name: string | undefined,
    regions: Array<{ id: string; name?: string; objects?: OperationalRegion['objects'] }>,
  ): { regionId: string; regionName: string; armyName: string; armyId: string | null } {
    const objects = regions.flatMap(region => (region.objects || [])
      .filter(object => object.type === 'army' || object.type === 'battalion')
      .map(object => ({ region, object })));
    const existing = armyId ? objects.find(item => String(item.object.id) === String(armyId)) : undefined;
    if (existing) {
      return {
        regionId: existing.region.id,
        regionName: existing.region.name || '',
        armyName: String(existing.object.name || 'Armata'),
        armyId: String(existing.object.id),
      };
    }
    const fallback = regions[0];
    return {
      regionId: fallback?.id || '',
      regionName: fallback?.name || '',
      armyName: name?.trim() || `${objects.length + 1}ª Armata`,
      armyId: null,
    };
  }

  /** Opzioni del motore per la proiezione dei conti (epoca dello scenario). */
  private worldStateOptions(): { modernFacts: boolean; startDate: string } {
    const start = this.ctx.worldStartDate?.() || this.ctx.currentDate();
    return { modernFacts: start >= '1990-01-01', startDate: start };
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

  /**
   * Capacità industriale e tecnologica di una polity. `account` è il conto del
   * **periodo** che si sta lavorando: in un salto lungo lo snapshot corrente è
   * il conto dell'ultimo mese e non quello del mese che si chiude.
   */
  private nationCapacity(polityId = this.ctx.playerPolityId(), account?: NationalAccount): NationCapacity {
    const current = account ?? this.ctx.accounts()[polityId];
    const stock = this.ctx.resourceStock(polityId);
    return {
      factories: Math.max(0, current?.factories || 0),
      ports: Math.max(0, current?.ports || 0),
      universities: Math.max(0, current?.universities || 0),
      technologies: stock.technologies,
      money: stock.money,
      weapons: stock.weapons,
      credit: creditHeadroom(stock, current),
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
    // `units` resta il **totale nazionale** (compatibilità con la UI e con i
    // consumatori): deposito + assegnato agli oggetti. Le due parti sono
    // esposte separatamente (`stockpile`, `assigned`).
    const stockpile = this.depotUnits(polityId);
    const units = this.nationalUnits(polityId);
    const assigned = this.operational()?.assignedEquipment() ?? {};
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
    const needs = this.effectiveNeeds(account);
    const epoch = this.epoch();
    const { manpower } = this.manpowerOf(polityId, epoch);
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
      /** Deposito: pezzi in magazzino, non assegnati ad alcun oggetto. */
      stockpile,
      /** Equipaggiamento assegnato alle armate e alle navi. */
      assigned,
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
      // OP-OBJECTS: la sala di governo. Oggetti concreti e catene, derivati dai
      // fatti del motore. Un solo fetch con l'arsenale: nessuna chiamata extra.
      objects: this.getOperatingPicture(),
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
      // OP-OBJECTS PERSISTENT: un acquisto immediato è una consegna in
      // magazzino... ma uno **scafo** comprato entra in servizio come nave reale,
      // con il suo equipaggio. Il totale nazionale non cambia: lo scafo esce dal
      // deposito e vive nella nave.
      if (equipment.domain === 'mare') {
        this.putShipsInService({ equipmentId, name: equipment.name, quantity: qty, depot: units });
      }
      const national = this.nationalUnits(polityId);
      return {
        mode, equipmentId, name: equipment.name, quantity: qty, spentMln,
        financedMln, debtMld, complete: true, units: national, strength: arsenalStrength(national),
      };
    }

    const order = this.startProductionOrder(equipmentId, qty, spentMln);
    const units = this.nationalUnits(polityId);
    return {
      mode, equipmentId, name: equipment.name, quantity: qty, spentMln,
      financedMln, debtMld, complete: false, units, strength: arsenalStrength(units), order,
    };
  }

  /** Libera l'impianto che aveva in lavorazione l'ordine (fine corsa). */
  private releaseFacility(order: ProductionOrder): void {
    const store = this.operational();
    if (!store || !order.facilityId) return;
    try {
      const facilities = store.facilities().map(facility => facility.id === order.facilityId
        ? { ...facility, activeOrders: facility.activeOrders.filter(id => id !== order.id) }
        : facility);
      store.saveFacilities(facilities);
    } catch (error) {
      console.warn('[MilitaryService] Rilascio impianto non riuscito:', error);
    }
  }

  /**
   * Mette in servizio gli scafi appena consegnati: nasce una **nave** con il suo
   * equipaggio (uomini presi dalla riserva) e lo scafo esce dal deposito. Se la
   * riserva non basta, la nave resta senza equipaggio e il bollettino lo dice.
   */
  private putShipsInService(input: {
    equipmentId: string;
    name: string;
    quantity: number;
    depot: Record<string, number>;
  }): string[] {
    const store = this.operational();
    const order = { equipmentId: input.equipmentId, name: input.name } as ProductionOrder;
    const delivered = Math.max(0, Math.round(nonNegative(input.quantity)));
    const depotAfterDeposit = input.depot;
    if (!store || delivered <= 0) return [];
    const bulletins: string[] = [];
    const polityId = this.ctx.playerPolityId();
    const epoch = this.epoch();
    const { doctrine, personnel } = this.manpowerOf(polityId, epoch);
    const equipment = equipmentById(order.equipmentId);
    try {
      const snapshot = store.snapshot();
      const crewPerShip = Math.max(0, Math.round(nonNegative(EQUIPMENT_CREW[order.equipmentId])));
      const existing = snapshot.ships.filter(ship => ship.equipmentId === order.equipmentId).length;
      const ships = [...snapshot.ships];
      const fleets = [...snapshot.fleets];
      let fleet = fleets.find(item => item.name.includes(equipment?.category || '')) ?? null;
      if (!fleet) {
        fleet = {
          id: `fleet-${polityId}-${fleets.length + 1}`,
          name: `${fleets.length + 1}ª Flotta — ${equipment?.category || 'navale'}`,
          shipIds: [],
          createdDate: this.ctx.currentDate(),
          legacyDerived: false,
        };
        fleets.push(fleet);
      }
      const fleetId = fleet.id;
      const newShips: typeof ships = [];
      for (let i = 0; i < delivered; i += 1) {
        const index = existing + i + 1;
        const ship = {
          id: `ship-${polityId}-${order.equipmentId}-${index}`,
          name: delivered > 1 ? `${equipment?.name || order.name} ${index}ª` : (equipment?.name || order.name),
          equipmentId: order.equipmentId,
          fleetId,
          crew: crewPerShip,
          monthlyFuel: round3(Math.max(0.02, crewPerShip * 0.004)),
          ammunition: {} as Record<string, number>,
          status: 'operational' as const,
          portId: null,
          regionId: null,
          createdDate: this.ctx.currentDate(),
          legacyDerived: false,
        };
        newShips.push(ship);
        ships.push(ship);
      }
      // Gli scafi escono dal **deposito**: deposito + assegnato = totale nazionale.
      const depot = { ...depotAfterDeposit };
      const hulls = nonNegative(depot[order.equipmentId]);
      if (hulls <= delivered) delete depot[order.equipmentId];
      else depot[order.equipmentId] = hulls - delivered;
      let personnelAfter = personnel;
      if (personnel) {
        const crewTotal = crewPerShip * delivered;
        const next = crewTotal > 0 ? transferCrewToShip(personnel, crewTotal, doctrine) : { ...personnel };
        if (next) {
          personnelAfter = next;
        } else {
          for (const ship of newShips) ship.crew = 0;
          bulletins.push(`⚠️ ${delivered} × ${equipment?.name || order.name} in servizio **senza equipaggio**: la riserva addestrata non ha ${crewTotal.toLocaleString('it-IT')} marinai disponibili.`);
        }
      }
      store.saveShips(ships);
      store.saveFleets(fleets.map(item => item.id === fleetId
        ? { ...item, shipIds: [...item.shipIds, ...newShips.map(ship => ship.id)] }
        : item));
      if (personnelAfter) store.savePersonnel(personnelAfter);
      this.saveArsenal(polityId, depot);
      bulletins.push(`⚓ ${delivered} × ${equipment?.name || order.name} in servizio nella ${fleet.name}.`);
    } catch (error) {
      console.warn('[MilitaryService] Messa in servizio delle navi non riuscita:', error);
      bulletins.push('⚠️ Scafi consegnati al deposito: messa in servizio non riuscita.');
    }
    return bulletins;
  }

  /**
   * Contesto produttivo di un periodo. `account` è il conto nazionale di **quel**
   * periodo: senza di esso si ripiegava sullo snapshot corrente, cioè — nei salti
   * lunghi — sul conto dell'ultimo mese invece che su quello del mese lavorato
   * (instabilità, tensione e infrastrutture sono quelle del periodo).
   */
  private productionContext(account?: NationalAccount): ProductionContext {
    const current = account ?? this.ctx.accounts()[this.ctx.playerPolityId()];
    const stock = this.ctx.resourceStock(this.ctx.playerPolityId());
    return {
      factories: Math.max(0, current?.factories || 0),
      ports: Math.max(0, current?.ports || 0),
      universities: Math.max(0, current?.universities || 0),
      stability: Number(current?.stability ?? 50),
      socialTension: Number(current?.socialTension ?? 0),
      technologies: stock.technologies,
    };
  }

  /** Apre un ordine di produzione: il costo è già stato pagato all'avvio. */
  private startProductionOrder(equipmentId: string, quantity: number, spentMln: number): ProductionOrder {
    const equipment = equipmentById(equipmentId)!;
    const id = `ord-${shortId(8)}`;
    const order: ProductionOrder = {
      id,
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
      // L'ordine è assegnato **a un impianto reale**, in modo deterministico:
      // non è più una rotazione decisa a ogni lettura della scheda.
      facilityId: this.assignFacilityFor(equipment.domain, id),
    };
    this.saveProductionOrder(order);
    return order;
  }

  /**
   * Impianto a cui assegnare una nuova lavorazione: navale ⇒ cantiere, terra ⇒
   * fabbrica, ricerca ⇒ ateneo. Deterministico (id più basso con meno lavoro).
   */
  private assignFacilityFor(domain: string, orderId: string): string | null {
    const store = this.operational();
    if (!store) return null;
    try {
      const facilities = store.facilities();
      const pool = facilities.filter(facility => domain === 'mare'
        ? facility.kind === 'shipyard'
        : facility.kind !== 'shipyard' && facility.kind !== 'mine' && facility.kind !== 'research_center');
      const candidates = pool.length > 0 ? pool : facilities.filter(facility => facility.kind !== 'mine');
      if (candidates.length === 0) return null;
      const sorted = [...candidates].sort((a, b) =>
        (a.activeOrders.length - b.activeOrders.length) || String(a.id).localeCompare(String(b.id)));
      const chosen = sorted[0];
      const next = facilities.map(facility => facility.id === chosen.id
        ? { ...facility, activeOrders: [...facility.activeOrders, orderId] }
        : facility);
      store.saveFacilities(next);
      return chosen.id;
    } catch (error) {
      console.warn('[MilitaryService] Assegnazione impianto non riuscita:', error);
      return null;
    }
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
   * lettura, così un imprevisto sposta la data invece di nasconderla. Se
   * l'impianto che ospita l'ordine è fermo o senza materiali, la consegna è
   * **sospesa** (`null`): una data inventata sarebbe peggio di nessuna data.
   */
  private withOrderEta(order: ProductionOrder, context: ProductionContext, overflowFactor = 1): ProductionOrder {
    if (order.status !== 'in_progress') return order;
    const equipment = equipmentById(order.equipmentId);
    const factor = this.facilityMaterialFactor(order);
    const rate = equipment ? productionRate(equipment, context) * overflowFactor * factor : 0;
    if (rate <= 0) return { ...order, expectedDate: null };
    const months = Math.max(0, (100 - order.progress) / rate);
    return { ...order, expectedDate: addDays(this.ctx.currentDate(), Math.round(months * 30)) };
  }

  /**
   * Fattore **materiale** dell'impianto che ospita l'ordine (0…1): capacità
   * della linea × disponibilità reale dei materiali. Un ordine senza impianto
   * (partita legacy) o senza store non ha vincoli oggettuali: fattore 1.
   */
  private facilityMaterialFactor(order: ProductionOrder, factors?: Record<string, number>): number {
    if (!order.facilityId) return 1;
    // Se il periodo porta con sé il **passaggio di allocazione** (tick del
    // mondo) si usa quello: ricalcolarlo dopo il prelievo dei materiali
    // leggerebbe un silo già vuoto e l'ordine si fermerebbe mentre l'impianto
    // ha appena lavorato a pieno regime (OP-OBJECTS TIME-STEP).
    const declared = factors?.[order.facilityId];
    if (typeof declared === 'number' && Number.isFinite(declared)) {
      return Math.max(0, Math.min(1, declared));
    }
    const store = this.operational();
    if (!store) return 1;
    try {
      return Math.max(0, Math.min(1, store.facilityFactor(order.facilityId)));
    } catch {
      return 1;
    }
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
  advanceProduction(
    days: number, account?: NationalAccount, factors?: Record<string, number>, notices?: ProductionNotices,
    temporal?: { stepDate?: string },
  ): string[] {
    if (this.ctx.isStrictGame() || days <= 0) return [];
    const polityId = this.ctx.playerPolityId();
    const bulletins: string[] = [];
    // Deduplica: un anno di sospensione non produce dodici messaggi identici.
    // `notices` è condiviso da tutti i periodi dello stesso salto: senza di esso
    // ogni periodo aprirebbe il proprio registro e il messaggio tornerebbe.
    const report = notices ?? createProductionNotices();
    const seen = report.seen;
    const state = report.state;
    const push = (line: string) => {
      if (seen.has(line)) return;
      seen.add(line);
      bulletins.push(line);
    };
    // OP-OBJECTS TIME-STEP: gli ordini avanzano a **periodi materiali**, come il
    // magazzino. Il fattore dell'impianto (capacità × materiali) si ricalcola a
    // ogni periodo: non è il fattore del primo giorno moltiplicato per sei mesi.
    const steps = splitMaterialPeriod(days);
    // Data dell'ultimo giorno del blocco dichiarata dal chiamante (il tick
    // materiale passa la data del periodo). I periodi interni sono i giorni che
    // la precedono, quindi `advanceProduction(90)` e tre chiamate da 30 giorni
    // vedono le **stesse** date — e gli stessi tiri.
    const endDate = temporal?.stepDate ?? this.ctx.currentDate();
    let elapsed = 0;
    for (let index = 0; index < steps.length; index++) {
      const step = steps[index];
      elapsed += step;
      const stepDate = steps.length === 1 ? endDate : addDays(endDate, elapsed - days);
      const orders = this.playerProductionOrders().filter(order => order.status === 'in_progress');
      if (orders.length === 0) continue;
      const context = this.productionContext(account);
      // Capacità industriale del periodo: se la domanda supera le linee
      // disponibili, il lavoro avanza più lentamente per tutti (stesso fattore
      // per ogni ordine aperto in quel periodo).
      const capacity = this.industrialCapacity(polityId, this.nationCapacity(polityId, account));
      if (capacity.blocked) {
        // Nessuna linea e lavoro da fare: non si avanza di un punto e non si
        // inventa un ritmo del 25%. Gli ordini restano aperti, in attesa.
        push('🏭 Produzione bloccata: nessuna capacità industriale disponibile — nessuna linea di lavorazione. Le consegne restano ferme finché non si costruiscono impianti.');
        break;
      }
      const months = (step / 30) * capacity.overflowFactor;
      if (capacity.saturated) {
        push(`🏭 Industria satura: ${capacity.demand} linee richieste su ${capacity.total} disponibili — la produzione avanza al ${Math.round(capacity.overflowFactor * 100)}% del ritmo.`);
      }
      for (const order of orders) {
        // L'impianto che ospita l'ordine deve essere operativo **e** avere i
        // materiali: se il fattore è zero la lavorazione non avanza di un punto.
        // Nel primo periodo si riusa il passaggio di allocazione del tick.
        const materialFactor = this.facilityMaterialFactor(order, index === 0 ? factors : undefined);
        const working = materialFactor > 0 ? 'attiva' : 'sospesa';
        const previous = state.get(order.id);
        state.set(order.id, working);
        // Il messaggio di sospensione compare al **cambio di stato**: dodici
        // periodi fermi restano una riga sola.
        if (working === 'sospesa') {
          if (previous !== 'sospesa') {
            push(`🏭 ${order.name}: lavorazione sospesa — l'impianto assegnato è fermo o senza materiali. La consegna prevista è sospesa.`);
          }
          continue;
        }
        // OP-OBJECTS SEED-DETERMINISM: il tiro dipende dalla **data** del
        // periodo, non dal turno (che dentro un salto non cambia) né dal numero
        // di chiamate: sei mesi tirano sei dadi diversi, e un salto unico tira
        // gli stessi dadi di sei turni separati.
        const seed = productionRollSeed({ orderId: order.id, date: stepDate });
        const result = advanceOrder(order, context, months * materialFactor, seed);
        if (result.completed) {
          const units = { ...this.arsenalUnits(polityId) };
          units[order.equipmentId] = (units[order.equipmentId] || 0) + result.delivered;
          this.saveArsenal(polityId, units);
          this.releaseFacility(order);
          productionRepository.remove(this.ctx.gameId, order.id);
          this.productionOrders.delete(order.id);
          const defect = result.order.qualityLoss > 0 ? ` (${Math.round(result.order.qualityLoss)}% difettose)` : '';
          push(`🏭 Produzione completata: ${result.delivered}/${order.quantity} × ${order.name}${defect}.`);
          // OP-OBJECTS PERSISTENT: gli scafi consegnati **entrano in servizio** come
          // navi reali, con il loro equipaggio preso dalla riserva addestrata.
          if (equipmentById(order.equipmentId)?.domain === 'mare' && result.delivered > 0) {
            for (const line of this.putShipsInService({
              equipmentId: order.equipmentId, name: order.name, quantity: result.delivered, depot: units,
            })) push(line);
          }
        } else if (result.failed) {
          this.releaseFacility(order);
          productionRepository.remove(this.ctx.gameId, order.id);
          this.productionOrders.delete(order.id);
          push(`⚠️ Produzione fallita: ${order.name} — ${result.order.note}.`);
        } else {
          // `updatedDate` segue il periodo vissuto: la data non si inventa, è
          // quella del substep appena lavorato.
          const stamped = result.order.updatedDate === stepDate
            ? result.order
            : { ...result.order, updatedDate: stepDate };
          this.saveProductionOrder(stamped);
          if (result.setbackPct > 0) {
            push(`⚠️ ${order.name}: imprevisto in produzione, avanzamento ${Math.round(result.order.progress)}% (−${result.setbackPct}%).`);
          }
        }
      }
    }
    return bulletins;
  }
}
