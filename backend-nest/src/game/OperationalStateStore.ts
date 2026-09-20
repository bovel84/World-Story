/**
 * World Story — Operational State Store (OP-OBJECTS PERSISTENT)
 * ============================================================
 *
 * Ponte tra il **database** e la logica pura di `core/simulation/OperationalState`.
 * Responsabilità:
 *  1. **seed lazy** (materializzazione) degli oggetti dagli aggregati legacy, una
 *     sola volta, senza cambiare il risultato nazionale;
 *  2. lettura/scrittura dello stato persistente (impianti, navi, flotte, cantieri,
 *     equipaggi; le armate vivono sugli oggetti della mappa);
 *  3. riconciliazione delle armate con gli oggetti reali della mappa.
 *
 * Nessuna seconda contabilità: l'aggregato nazionale continua a nascere dalle
 * funzioni del motore; qui c'è solo lo stato che l'aggregato non può esprimere.
 */
import { operationalObjectRepository, type OperationalObjectKind } from '../repositories';
import type { MilitaryEpoch, MilitaryManpower } from '../core/simulation/MilitaryDoctrine';
import { militaryManpower } from '../core/simulation/MilitaryDoctrine';
import type { IndustrialProjectInput } from '../core/simulation/IndustrialCapacity';
import {
  allocateFacilityProduction,
  engineFacilityRecipe,
  facilityRecipeDrifted,
  facilityRecipeStale,
  monthlyNeedsPerFormation,
  shipConsumptionFactor,
  MATERIAL_MONTH_DAYS,
  type FacilityAllocation,
  type FacilityKind,
} from '../core/simulation/OperationalState';
import type { MaterialFlowOverlay, MaterialNeeds, ResourceStock } from '../core/simulation/MaterialEconomy';
import { unitIsActiveOnFront } from '../core/simulation/WarFronts';
import { extractionRate, type ResourceLedger } from '../core/simulation/ResourceMarket';
import type { NationalAccount } from '../core/simulation/WorldStateEngine';
import {
  advanceConstructions,
  aggregateArmyFromUnits,
  aggregateObjects,
  emptyOperationalState,
  materializeUnitsForArmy,
  normalizeUnitState,
  seedArmies,
  seedConstructions,
  seedFacilities,
  seedPersonnel,
  seedShips,
  UNIT_ORDER_DEFAULT,
  UNIT_ORDER_INFO,
  type ArmyOperationalState,
  type ConstructionState,
  type FacilityState,
  type FleetState,
  type MilitaryPersonnelState,
  type MilitaryUnitState,
  type OperationalAggregate,
  type OperationalStateSnapshot,
  type SeedArmyInput,
  type SeedRegion,
  type ShipState,
  type WarFrontState,
} from '../core/simulation/OperationalState';

export interface OperationalStoreInputs {
  gameId: string;
  playerPolityId(): string;
  currentDate(): string;
  epoch(): MilitaryEpoch;
  /** Deposito: ciò che è in magazzino e non assegnato a un oggetto. */
  depotUnits(): Record<string, number>;
  saveDepotUnits(units: Record<string, number>): void;
  /** Aggregati legacy per il seed: fabbriche, porti, atenei (conto nazionale). */
  factories(): number;
  ports(): number;
  universities(): number;
  /** Regioni della polity giocante (province, oggetti, costa). */
  regions(): SeedRegion[];
  /** Oggetti `army` reali della mappa. */
  armyObjects(): SeedArmyInput[];
  /** Reparti totali dichiarati dal motore (`account.forces`). */
  totalFormations(): number;
  /** Riserva dottrinale: usata **solo** per il seed iniziale del personale. */
  manpower(): MilitaryManpower;
  /** Materie prime dichiarate (giacimenti): seed delle miniere. */
  endowment(): Record<string, number>;
  /** Progetti del motore (cantieri in corso). */
  projects(): IndustrialProjectInput[];
  /** Stock materiale corrente (produzione degli impianti). */
  stock(): ResourceStock;
  /**
   * Registro delle risorse naturali: l'input minerario di un impianto viene
   * dalla **estrazione del mese** (silo), non dal giacimento come scorta infinita.
   */
  ledger?(): ResourceLedger;
  /** Conto nazionale: serve a stimare l'estrazione mensile reale. */
  account?(): NationalAccount | undefined;
  /** Attività nazionale delle linee (0…1) dal motore. */
  activity?(): number;
  /** Persiste i campi operativi delle armate sugli oggetti della mappa. */
  saveArmies(armies: ArmyOperationalState[]): void;
  onWarn?(label: string, error: unknown): void;
}

const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T;
const round1 = (value: number) => Math.round(value * 10) / 10;
const nonNegative = (value: unknown): number => {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? number : 0;
};

/**
 * MILITARY/WARFRONT INTEGRITY P0-2 — fattore di consumo dell'ordine in corso.
 * Fuori dal fronte un reparto non ha un ordine operativo e consuma **quanto
 * dichiara** (×1); sul fronte paga il coefficiente dell'ordine, che è il
 * consumo **totale** della guerra, non un addendo sopra la base.
 *
 * P0-B: «sul fronte» non è «ha un `frontId`». La regola è quella condivisa
 * `unitIsActiveOnFront`: fronte esistente, non chiuso, reparto nel teatro. Un
 * `frontId` che punta al nulla (o a un fronte chiuso, o a una provincia che il
 * reparto ha lasciato) non fa pagare il coefficiente di guerra — ed è la
 * ragione per cui il fabbisogno del periodo non dipende dall'ordine in cui il
 * tick legge i reparti.
 */
function orderConsumptionFactor(unit: MilitaryUnitState, front: WarFrontState | null): number {
  if (!unitIsActiveOnFront({ unit, front })) return 1;
  const order = unit.order || UNIT_ORDER_DEFAULT;
  const info = UNIT_ORDER_INFO[order];
  return info ? Math.max(0, info.consumption) : 1;
}

export class OperationalStateStore {
  private state: OperationalStateSnapshot | null = null;
  private seeding = false;
  /** Esito della verifica del seed, memorizzato: una query sola per sessione. */
  private seedChecked = false;
  private seedDone = false;

  constructor(private readonly inputs: OperationalStoreInputs) {}

  private warn(label: string, error: unknown): void {
    if (this.inputs.onWarn) this.inputs.onWarn(label, error);
    else console.warn(`[OperationalState] ${label}`, error);
  }

  /** Stato corrente dalla cache; se assente, lo carica (senza seed). */
  private read(): OperationalStateSnapshot {
    if (this.state) return this.state;
    const date = this.inputs.currentDate();
    const snapshot = emptyOperationalState(date);
    try {
      const rows = operationalObjectRepository.list(this.inputs.gameId);
      for (const row of rows) {
        const data = row.data as Record<string, unknown>;
        switch (row.kind) {
          // P5 — lo snapshot resta player-facing: le riserve NPC persistono
          // nella stessa tabella, ma non possono sostituire quella del player.
          case 'personnel':
            if (String(row.id) === String(this.inputs.playerPolityId())) {
              snapshot.personnel = data as unknown as MilitaryPersonnelState;
            }
            break;
          case 'unit': snapshot.units.push(normalizeUnitState(data, this.inputs.playerPolityId())); break;
          case 'front': snapshot.fronts.push(data as unknown as WarFrontState); break;
          case 'facility': snapshot.facilities.push(data as unknown as FacilityState); break;
          case 'ship': snapshot.ships.push(data as unknown as ShipState); break;
          case 'fleet': snapshot.fleets.push(data as unknown as FleetState); break;
          case 'construction': snapshot.constructions.push(data as unknown as ConstructionState); break;
          default: break;
        }
      }
    } catch (error) {
      this.warn('lettura stato oggetti non disponibile', error);
    }
    snapshot.facilities.sort((a, b) => String(a.id).localeCompare(String(b.id)));
    snapshot.units.sort((a, b) => String(a.id).localeCompare(String(b.id)));
    snapshot.fronts.sort((a, b) => String(a.id).localeCompare(String(b.id)));
    snapshot.ships.sort((a, b) => String(a.id).localeCompare(String(b.id)));
    snapshot.fleets.sort((a, b) => String(a.id).localeCompare(String(b.id)));
    snapshot.constructions.sort((a, b) => String(a.id).localeCompare(String(b.id)));
    this.state = snapshot;
    return snapshot;
  }

  /**
   * MILITARY/WARFRONT INTEGRITY P0-1: la cache dello stato operativo non deve
   * mai servire il «futuro» dopo un restore/rewind o l'apertura di un ramo.
   * Il DB è già stato riscritto (transazione del restore): la prima lettura
   * successiva ricarica da lì. Anche la sentinella del seed si ricontrolla,
   * perché il ramo ripristinato può essere precedente o successivo al seed.
   */
  invalidate(): void {
    this.state = null;
    this.seedChecked = false;
    this.seedDone = false;
  }

  /** Il seed è avvenuto? La riga di personale **del player** è la sentinella. */
  seeded(): boolean {
    if (this.seedChecked) return this.seedDone;
    try {
      const player = String(this.inputs.playerPolityId());
      this.seedDone = operationalObjectRepository.idsOfKind(this.inputs.gameId, 'personnel')
        .some(id => String(id) === player);
      this.seedChecked = true;
      return this.seedDone;
    } catch (error) {
      this.warn('verifica seed non disponibile', error);
      return false;
    }
  }

  /**
   * Materializza gli oggetti **una volta sola**, dagli aggregati correnti.
   * L'invariante è che il totale nazionale non cambia: le navi escono dal
   * deposito (deposito + assegnato = totale), le armate nascono senza
   * equipaggiamento (resta nel deposito finché non viene assegnato davvero).
   */
  ensureSeeded(): OperationalStateSnapshot {
    const snapshot = this.read();
    if (this.seeded() || this.seeding) return this.syncArmies(snapshot);
    this.seeding = true;
    try {
      const date = this.inputs.currentDate();
      const polityId = this.inputs.playerPolityId();
      const epoch = this.inputs.epoch();
      const doctrine = this.inputs.manpower();
      const regions = this.inputs.regions();
      const endowment = this.inputs.endowment();
      const technologies = this.technologies();
      // Ricetta per impianto dal **motore** (`engineFacilityRecipe`): la somma
      // degli impianti è la produzione nazionale; giacimenti e agricoltura
      // restano voci a sé del bilancio, così nessun bonus entra due volte.
      const recipeOf = (kind: FacilityKind) => engineFacilityRecipe(kind, technologies);
      const facilities = seedFacilities({
        polityId,
        factories: this.inputs.factories(),
        ports: this.inputs.ports(),
        universities: this.inputs.universities(),
        regions,
        date,
        endowment,
        recipeOf,
      });
      const depot = { ...this.inputs.depotUnits() };
      const { ships, fleets } = seedShips({
        polityId,
        units: depot,
        date,
        regions,
      });
      // Le navi **possedute** escono dal deposito: nessun doppio conteggio.
      for (const ship of ships) {
        const current = nonNegative(depot[ship.equipmentId]);
        if (current <= 1) delete depot[ship.equipmentId];
        else depot[ship.equipmentId] = current - 1;
      }
      const constructions = seedConstructions({
        projects: this.inputs.projects(),
        regions,
        date,
        capacityOf: project => Math.max(1, Math.round(nonNegative(project.progress) > 0 ? 4 : 4)),
      });
      const personnel = seedPersonnel(doctrine, date);
      const armies = seedArmies({
        polityId,
        armies: this.inputs.armyObjects(),
        accountedFormations: this.armyObjectsFormations(),
        totalFormations: this.inputs.totalFormations(),
        epoch,
        date,
      });
      const rows: Array<{ kind: OperationalObjectKind; id: string; data: Record<string, unknown> }> = [
        { kind: 'personnel', id: polityId, data: personnel as unknown as Record<string, unknown> },
        ...facilities.map(item => ({ kind: 'facility' as const, id: item.id, data: item as unknown as Record<string, unknown> })),
        ...ships.map(item => ({ kind: 'ship' as const, id: item.id, data: item as unknown as Record<string, unknown> })),
        ...fleets.map(item => ({ kind: 'fleet' as const, id: item.id, data: item as unknown as Record<string, unknown> })),
        ...constructions.map(item => ({ kind: 'construction' as const, id: item.id, data: item as unknown as Record<string, unknown> })),
      ];
      operationalObjectRepository.upsertMany(this.inputs.gameId, rows);
      this.inputs.saveDepotUnits(depot);
      this.inputs.saveArmies(armies);
      this.state = { personnel, armies, units: [], fronts: [], facilities, ships, fleets, constructions };
      this.seedChecked = true;
      this.seedDone = true;
      return this.state;
    } catch (error) {
      this.warn('seed oggetti non riuscito', error);
      return snapshot;
    } finally {
      this.seeding = false;
    }
  }

  /** Tecnologie del paese (dallo stock materiale, che le possiede). */
  technologies(): string[] {
    try {
      return [...(this.inputs.stock().technologies || [])];
    } catch (error) {
      this.warn('tecnologie non disponibili', error);
      return [];
    }
  }

  /**
   * Le ricette nascono dal profilo del motore con le tecnologie **di allora**:
   * quando il paese ne sblocca una nuova il profilo va rifatto, altrimenti il
   * bonus resterebbe solo sulla carta. Riscrittura lazy, una volta sola.
   */
  private refreshRecipes(snapshot: OperationalStateSnapshot): void {
    const technologies = this.technologies();
    const updated = snapshot.facilities.map(facility => {
      const current = engineFacilityRecipe(facility.kind, technologies);
      const stale = facilityRecipeStale(facility.recipe, technologies)
        || facilityRecipeDrifted(facility.recipe, current);
      return stale ? { ...facility, recipe: current } : facility;
    });
    if (!updated.some((facility, index) => facility.recipe !== snapshot.facilities[index]?.recipe)) return;
    snapshot.facilities = updated;
    this.state = snapshot;
    try {
      operationalObjectRepository.upsertMany(
        this.inputs.gameId,
        updated.map(facility => ({ kind: 'facility' as const, id: facility.id, data: facility as unknown as Record<string, unknown> })),
      );
    } catch (error) {
      this.warn('aggiornamento ricette non riuscito', error);
    }
  }

  /**
   * Disponibilità del periodo per materiale: le **scorte** per i materiali e il
   * **silo** per i giacimenti. Un giacimento non è uno stock infinito: se il
   * silo è vuoto, la filiera si ferma.
   *
   * `monthlyExtraction` (default `true`) somma al silo il gettito di un mese:
   * è la lettura del Dossier («quanto posso lavorare questo mese»). Nel **tick
   * a substep** vale `false`, perché l'estrazione del periodo è già stata
   * versata nel silo da `advanceLedger`: sommarla di nuovo sarebbe un doppio
   * conteggio (OP-OBJECTS TIME-STEP).
   *
   * `stepDays` sono i giorni del periodo: se la lettura somma l'estrazione
   * **mensile** e il periodo è parziale, se ne somma solo la parte che il tempo
   * concede (15 giorni ⇒ mezzo mese di gettito). Assente o 30 ⇒ come prima.
   */
  availability(options?: { monthlyExtraction?: boolean; stepDays?: number }): Record<string, number> {
    const monthlyExtraction = options?.monthlyExtraction !== false;
    const period = Math.max(0, options?.stepDays === undefined ? MATERIAL_MONTH_DAYS : options.stepDays) / MATERIAL_MONTH_DAYS;
    const availability: Record<string, number> = {};
    let stock: ResourceStock | null = null;
    try {
      stock = this.inputs.stock();
      for (const kind of ['food', 'clothing', 'weapons', 'fuel', 'research', 'money']) {
        availability[kind] = Math.max(0, Number((stock as unknown as Record<string, number>)[kind]) || 0);
      }
    } catch (error) {
      this.warn('scorte non disponibili per l\'allocazione', error);
    }
    if (!this.inputs.ledger) return availability;
    try {
      const ledger = this.inputs.ledger();
      const account = this.inputs.account ? this.inputs.account() : undefined;
      for (const [kind, node] of Object.entries(ledger)) {
        if (!node) continue;
        const silo = Math.max(0, Number(node.stockpile) || 0);
        const month = monthlyExtraction ? Math.max(0, extractionRate(node, account)) * period : 0;
        availability[kind] = Math.round((silo + month) * 1000) / 1000;
      }
    } catch (error) {
      this.warn('estrazione non disponibile per l\'allocazione', error);
    }
    return availability;
  }

  /**
   * Pass di allocazione degli impianti: **una sola** scorta divisa fra tutti.
   * Gli stessi numeri vanno al tick, alla scheda e agli ordini.
   *
   * `stepDays` è il tempo del periodo: la copertura si misura sul fabbisogno
   * **del periodo** (15 giorni ⇒ mezzo fabbisogno mensile). Assente ⇒ mese pieno.
   */
  allocation(options?: { monthlyExtraction?: boolean; stepDays?: number }): FacilityAllocation {
    const snapshot = this.snapshot();
    return allocateFacilityProduction({
      facilities: snapshot.facilities,
      availability: this.availability(options),
      activity: this.inputs.activity ? this.inputs.activity() : 1,
      stepDays: options?.stepDays,
    });
  }

  /**
   * Fattore materiale reale di un impianto (0 se fermo o senza input), senza il
   * fattore di capacità industriale: quello lo applica già il motore al tempo.
   *
   * Lettura del **Dossier**: mese pieno (`stepDays` di default). Nel tick il
   * fattore del periodo arriva dall'overlay, non da qui.
   */
  facilityFactor(facilityId: string | null | undefined): number {
    if (!facilityId) return 1;
    const entry = this.allocation().facilities.find(item => item.facilityId === facilityId);
    return entry ? entry.materialFactor : 1;
  }

  /** Fabbisogno **militare** degli oggetti: armate + navi, una sola volta. */
  militaryNeeds(): MaterialNeeds {
    return this.militaryNeedsOf(true);
  }

  /**
   * P4 — fabbisogno militare **di una polity**: i suoi reparti persistenti
   * (`Σ monthlyNeeds × orderFactor`) e, solo per il giocatore, le armate senza
   * reparti. Serve a dare all'NPC la stessa contabilità del giocatore quando ha
   * unità persistite.
   */
  militaryNeedsForPolity(polityId: string): MaterialNeeds {
    return this.militaryNeedsOf(true, polityId);
  }

  /** P4 — base **strutturale** (senza coefficiente d'ordine) di una polity. */
  baseMilitaryNeedsForPolity(polityId: string): MaterialNeeds {
    return this.militaryNeedsOf(false, polityId);
  }

  /** P4 — reparti persistenti di una polity (authority: `unit.polityId`). */
  unitsForPolity(polityId: string): MilitaryUnitState[] {
    return this.snapshot().units.filter(unit => String(unit.polityId) === String(polityId));
  }

  /**
   * Base **strutturale** del fabbisogno militare: gli stessi reparti e le stesse
   * armate, ma **senza** il coefficiente d'ordine (`UNIT_ORDER_INFO`). È il
   * fabbisogno di pace che dimensiona i magazzini: la guerra consuma di più, non
   * costruisce depositi nuovi (P0-D2, `WAR DEMAND ≠ STORAGE CAPACITY`).
   */
  baseMilitaryNeeds(): MaterialNeeds {
    return this.militaryNeedsOf(false);
  }

  private militaryNeedsOf(applyOrderFactor: boolean, polityId?: string): MaterialNeeds {
    const snapshot = this.snapshot();
    // P4 — il fabbisogno è **per polity**: senza filtro resterebbe player-only
    // (le unità NPC non devono entrare nel conto del giocatore e viceversa).
    const forPolity = String(polityId ?? this.inputs.playerPolityId());
    const isPlayer = forPolity === String(this.inputs.playerPolityId());
    const needs: MaterialNeeds = { food: 0, clothing: 0, weapons: 0, fuel: 0 };
    // MILITARY/WARFRONT INTEGRITY P0-2: il fabbisogno militare è **una sola**
    // grandezza e nasce dai reparti reali, con il **fattore d'ordine** che
    // dipende solo dall'essere (o no) su un fronte:
    //   unità sul fronte    → UNIT_ORDER_INFO[order].consumption (attacco 1,8 …)
    //   unità fuori fronte  → 1 (nessun ordine operativo)
    // I coefficienti sono il consumo **totale**, non `base + guerra`: chi
    // sottrae è solo `advanceStock` (`effectiveMaterialNeeds`).
    //
    // Il fabbisogno si legge **una volta sola** per armata: se l'armata ha
    // reparti persistiti sono i suoi reparti a consumare (con l'ordine di
    // ciascuno); un'armata senza reparti consuma quanto dichiara — mai due
    // volte la stessa cosa.
    const unitsOfArmy = new Map<string, MilitaryUnitState[]>();
    for (const unit of snapshot.units) {
      if (String(unit.polityId) !== forPolity) continue;
      const list = unitsOfArmy.get(String(unit.armyId));
      if (list) list.push(unit);
      else unitsOfArmy.set(String(unit.armyId), [unit]);
    }
    // I fronti **del periodo**: il fattore d'ordine vale solo per chi è davvero
    // sul fronte (P0-B), la stessa regola della sincronizzazione dei fronti.
    const frontsById = new Map(snapshot.fronts.map(front => [String(front.id), front]));
    for (const list of unitsOfArmy.values()) {
      for (const unit of list) {
        if (unit.status === 'destroyed') continue;
        const front = unit.frontId ? frontsById.get(String(unit.frontId)) ?? null : null;
        const factor = applyOrderFactor ? orderConsumptionFactor(unit, front) : 1;
        needs.food += Math.max(0, Number(unit.monthlyNeeds?.food) || 0) * factor;
        needs.weapons += Math.max(0, Number(unit.monthlyNeeds?.weapons) || 0) * factor;
        needs.fuel += Math.max(0, Number(unit.monthlyNeeds?.fuel) || 0) * factor;
      }
    }
    if (!isPlayer) {
      // Le armate sono oggetti della mappa del giocatore: per le altre polity
      // contano **solo** i reparti persistiti.
      const round = (value: number) => Math.round(value * 1000) / 1000;
      return { food: round(needs.food), clothing: round(needs.clothing), weapons: round(needs.weapons), fuel: round(needs.fuel) };
    }
    for (const army of snapshot.armies) {
      if (unitsOfArmy.has(String(army.id))) continue;
      needs.food += Math.max(0, Number(army.monthlyNeeds?.food) || 0);
      needs.weapons += Math.max(0, Number(army.monthlyNeeds?.weapons) || 0);
      needs.fuel += Math.max(0, Number(army.monthlyNeeds?.fuel) || 0);
    }
    for (const ship of snapshot.ships) {
      needs.fuel += Math.max(0, Number(ship.monthlyFuel) || 0) * shipConsumptionFactor(ship.status);
    }
    const round = (value: number) => Math.round(value * 1000) / 1000;
    return { food: round(needs.food), clothing: round(needs.clothing), weapons: round(needs.weapons), fuel: round(needs.fuel) };
  }

  /** Consumo navale di carburante del mese (per il dettaglio del flusso). */
  navyFuel(): number {
    return this.snapshot().ships
      .reduce((total, ship) => total + Math.max(0, Number(ship.monthlyFuel) || 0) * shipConsumptionFactor(ship.status), 0);
  }

  /**
   * Flusso materiale degli oggetti reali, per il tick del motore.
   * `null` quando lo stato persistente non esiste (partita legacy): in quel caso
   * il motore usa il percorso di sempre, senza alcun doppio conteggio.
   *
   * Contratto di unità: `production`/`consumption` sono **mensili** (li scala
   * `advanceStock` × `period`), `naturalInputs` è la quantità **del periodo**
   * (la preleva dal silo `drawResourceStockpile`, nessuno la riscala).
   */
  materialFlow(options?: { monthlyExtraction?: boolean; stepDays?: number }): MaterialFlowOverlay | null {
    try {
      const snapshot = this.snapshot();
      if (snapshot.facilities.length === 0 && snapshot.armies.length === 0 && snapshot.ships.length === 0) return null;
      const allocation = this.allocation(options);
      const production: Partial<Record<'money' | 'food' | 'clothing' | 'weapons' | 'fuel' | 'research', number>> = {};
      const consumption: Partial<Record<'money' | 'food' | 'clothing' | 'weapons' | 'fuel' | 'research', number>> = {};
      // Il fattore di ogni impianto viaggia con l'overlay: chi avanza gli ordini
      // lo riusa invece di ricalcolarlo dopo il prelievo dei materiali.
      const facilityFactors: Record<string, number> = {};
      for (const entry of allocation.facilities) {
        facilityFactors[entry.facilityId] = entry.materialFactor;
      }
      for (const [id, value] of Object.entries(allocation.totalOutputs)) {
        if (id === 'money' || id === 'food' || id === 'clothing' || id === 'weapons' || id === 'fuel' || id === 'research') {
          production[id] = value;
        }
      }
      for (const [id, value] of Object.entries(allocation.totalInputs)) {
        if (id === 'money' || id === 'food' || id === 'clothing' || id === 'weapons' || id === 'fuel' || id === 'research') {
          consumption[id] = value;
        }
      }
      return {
        production,
        consumption,
        militaryNeeds: this.militaryNeeds(),
        // Base di pace: è questa a dimensionare il magazzino, non il fabbisogno
        // del periodo (che cresce con l'ordine senza costruire capacità).
        structuralMilitaryNeeds: this.baseMilitaryNeeds(),
        naturalInputs: allocation.naturalInputs,
        navyFuel: Math.round(this.navyFuel() * 1000) / 1000,
        facilityFactors,
      };
    } catch (error) {
      this.warn('flusso oggetti non calcolabile', error);
      return null;
    }
  }

  private armyObjectsFormations(): number {
    return this.inputs.armyObjects().reduce((total, army) => total + Math.max(0, Math.round(nonNegative(army.formations))), 0);
  }

  /**
   * Riconcilia le armate persistite con gli oggetti reali della mappa: gli
   * oggetti nuovi nascono con i reparti dichiarati, quelli legacy ricalcolano
   * gli uomini dalla dottrina, quelli reali **conservano** uomini ed
   * equipaggiamento trasferiti.
   */
  syncArmies(snapshot: OperationalStateSnapshot): OperationalStateSnapshot {
    const epoch = this.inputs.epoch();
    const menPerFormation = militaryManpower({ population: 0, formations: 1, mobilizedFormations: 0, epoch }).menPerFormation;
    const needsOf = (formations: number, personnel: number, saved?: ArmyOperationalState['monthlyNeeds']): ArmyOperationalState['monthlyNeeds'] => {
      // Un fabbisogno dichiarato vale; se manca o è a zero mentre l'armata ha
      // uomini, si riprende dal motore (`monthlyNeedsPerFormation`) invece di
      // dichiarare che un reparto non consuma nulla.
      if (saved && ((saved.fuel || 0) > 0 || (saved.weapons || 0) > 0 || (saved.food || 0) > 0)) return saved;
      const equivalent = formations > 0 ? formations : personnel / menPerFormation;
      const per = monthlyNeedsPerFormation(epoch);
      const round3 = (value: number) => Math.round(value * 1000) / 1000;
      return {
        fuel: round3(per.fuel * equivalent),
        weapons: round3(per.weapons * equivalent),
        food: round3(per.food * equivalent),
      };
    };
    const seeds = this.inputs.armyObjects();
    const persistedFormationsOf = (list: SeedArmyInput[], armyId: string): number | undefined => {
      const seed = list.find(item => String(item.objectId || item.id) === String(armyId));
      return seed?.persistedFormations;
    };
    const total = Math.max(0, Math.round(this.inputs.totalFormations()));
    const accounted = seeds.reduce((sum, army) => sum + Math.max(0, Math.round(nonNegative(army.formations))), 0);
    const byId = new Map(snapshot.armies.map(army => [String(army.id), army]));
    const next: ArmyOperationalState[] = [];
    for (const seed of seeds) {
      const id = String(seed.objectId || seed.id);
      const existing = byId.get(id);
      const formations = Math.max(0, Math.round(nonNegative(seed.formations)));
      if (existing) {
        const personnel = existing.legacyDerived ? Math.round(formations * menPerFormation) : existing.personnel;
        next.push({
          ...existing,
          name: seed.name || existing.name,
          regionId: seed.regionId ?? existing.regionId,
          regionName: seed.regionName ?? existing.regionName,
          formations,
          personnel,
          monthlyNeeds: needsOf(formations, personnel, existing.monthlyNeeds),
        });
      } else {
        next.push({
          id,
          name: seed.name,
          regionId: seed.regionId,
          regionName: seed.regionName,
          formations,
          personnel: Math.round(formations * menPerFormation),
          equipment: {},
          monthlyNeeds: needsOf(formations, Math.round(formations * menPerFormation)),
          status: 'operational',
          objectId: seed.objectId,
          createdDate: this.inputs.currentDate(),
          legacyDerived: true,
        });
      }
    }
    const leftover = Math.max(0, total - accounted);
    const garrison = snapshot.armies.find(army => !army.objectId);
    if (leftover > 0 || garrison) {
      const previous = garrison ?? {
        id: `${this.inputs.playerPolityId()}-garrison`,
        name: 'Reparti di guarnigione',
        regionId: null,
        regionName: null,
        formations: 0,
        personnel: 0,
        equipment: {},
        monthlyNeeds: { fuel: 0, weapons: 0, food: 0 },
        status: 'operational',
        objectId: null,
        createdDate: this.inputs.currentDate(),
        legacyDerived: true,
      };
      const personnel = previous.legacyDerived ? Math.round(leftover * menPerFormation) : previous.personnel;
      next.push({
        ...previous,
        formations: leftover,
        personnel,
        monthlyNeeds: needsOf(leftover, personnel, previous.monthlyNeeds),
      });
    }
    snapshot.armies = next.sort((a, b) => String(a.id).localeCompare(String(b.id)));

    // ── Reparti: la granularità sotto l'armata (MILITARY-UNITS) ──────────────
    // Materializzazione **lazy e idempotente** (una volta sola; la prima volta
    // divide l'aggregato senza cambiarne la somma) e poi **derivazione**: uomini,
    // pezzi, fabbisogni e numero di reparti dell'armata sono la somma dei suoi
    // reparti. Nessun uomo viene creato dal nulla: il mondo può solo dichiarare
    // reparti in più, che nascono vuoti (`forming`).
    // P4 — si riconciliano **solo** i reparti la cui armata è ancora un oggetto
    // della mappa del giocatore; ogni altro reparto resta intatto:
    // - le unità delle altre polity (mai cancellate da una lettura del player);
    // - i reparti la cui armata non è più fra gli oggetti del giocatore (es. la
    //   provincia dell'armata è stata conquistata): cancellarli era una perdita
    //   di stato silenziosa, ed è la ragione per cui si filtra per `armyId`
    //   **oltre** che per polity.
    const playerPolityId = String(this.inputs.playerPolityId());
    const liveArmyIds = new Set(snapshot.armies.map(army => String(army.id)));
    const foreignUnits = snapshot.units.filter(unit => !liveArmyIds.has(String(unit.armyId)));
    const unitsOf = new Map<string, MilitaryUnitState[]>();
    for (const unit of snapshot.units) {
      if (String(unit.polityId) !== playerPolityId) continue;
      if (!liveArmyIds.has(String(unit.armyId))) continue;
      const list = unitsOf.get(String(unit.armyId));
      if (list) list.push(unit);
      else unitsOf.set(String(unit.armyId), [unit]);
    }
    const reconciled = snapshot.armies.map(army => {
      const existing = unitsOf.get(String(army.id)) || [];
      // MILITARY/WARFRONT INTEGRITY P1-2: il livello dichiarato dalla mappa
      // serve **solo** alla materializzazione iniziale. Quando l'armata ha già
      // reparti persistiti la fonte autorevole è `MilitaryUnit[]`: nessun
      // reparto viene ricreato dal numero della mappa (era la «phantom unit»
      // del reassign). Se i reparti non esistono più, il numero **reale**
      // scritto sull'oggetto della mappa evita di reinventarli al reload.
      const persisted = persistedFormationsOf(seeds, army.id);
      const target = existing.length > 0 ? existing.length : (persisted ?? army.formations);
      const units = materializeUnitsForArmy({
        army,
        epoch,
        date: this.inputs.currentDate(),
        // Le armate sono oggetti della mappa del **giocatore**: i reparti che ne
        // derivano appartengono a lui (P4).
        polityId: this.inputs.playerPolityId(),
        formations: target,
        existing,
      });
      return { army: aggregateArmyFromUnits(army, units), units };
    });
    snapshot.armies = reconciled.map(item => item.army);
    const nextUnits = [...reconciled.flatMap(item => item.units), ...foreignUnits]
      .sort((a, b) => String(a.id).localeCompare(String(b.id)));
    // Si scrive **solo** quando i reparti cambiano: una lettura non riscrive lo
    // stato a ogni chiamata.
    const unitsBefore = JSON.stringify(snapshot.units);
    snapshot.units = nextUnits;
    if (unitsBefore !== JSON.stringify(nextUnits)) this.persist('unit', nextUnits);

    this.state = snapshot;
    return snapshot;
  }

  /** Stato pronto all'uso: legge, semina se serve, riconcilia le armate. */
  snapshot(): OperationalStateSnapshot {
    const snapshot = this.ensureSeeded();
    this.syncArmies(snapshot);
    this.refreshRecipes(snapshot);
    return snapshot;
  }

  personnel(): MilitaryPersonnelState {
    return this.snapshot().personnel;
  }

  /**
   * P5 — personale persistente per polity senza trasformare lo snapshot in una
   * mappa. Il player usa la cache canonica; una polity foreign viene letta per
   * id dal DB e, se assente, resta `null` (il seed lazy appartiene al chiamante).
   */
  personnelForPolity(polityId: string): MilitaryPersonnelState | null {
    if (String(polityId) === String(this.inputs.playerPolityId())) return this.personnel();
    const row = operationalObjectRepository.get(this.inputs.gameId, 'personnel', String(polityId));
    return row ? row.data as unknown as MilitaryPersonnelState : null;
  }

  facilities(): FacilityState[] {
    return this.snapshot().facilities;
  }

  ships(): ShipState[] {
    return this.snapshot().ships;
  }

  fleets(): FleetState[] {
    return this.snapshot().fleets;
  }

  constructions(): ConstructionState[] {
    return this.snapshot().constructions;
  }

  armies(): ArmyOperationalState[] {
    return this.snapshot().armies;
  }

  /** Reparti (unità) persistenti di tutte le armate. */
  units(): MilitaryUnitState[] {
    return this.snapshot().units;
  }

  /**
   * Reparti **già** persistiti, senza materializzazione né scritture: è la
   * lettura pura che serve a decidere *se* il mondo ha uno stato militare
   * proprio. Un mondo che non li ha non deve essere toccato da una lettura.
   */
  persistedUnits(): MilitaryUnitState[] {
    return this.read().units.map(unit => ({ ...unit }));
  }

  /** Reparti di una armata: la somma dell'aggregato dell'armata. */
  unitsOfArmy(armyId: string): MilitaryUnitState[] {
    return this.snapshot().units.filter(unit => String(unit.armyId) === String(armyId));
  }

  /** Fronti di guerra (P6): territorio conteso e pressione, non un wargame. */
  fronts(): WarFrontState[] {
    return this.snapshot().fronts;
  }

  /** Fronti **già** persistiti: lettura pura, senza sincronizzazione. */
  persistedFronts(): WarFrontState[] {
    return this.read().fronts.map(front => ({ ...front }));
  }

  /**
   * Scrive i fronti **e** i reparti in una sola chiamata: lo stato di un fronte
   * (pressione, esito) e quello delle sue unità sono la stessa fotografia, mai
   * due scritture che possono divergere.
   */
  saveFronts(fronts: readonly WarFrontState[], units?: readonly MilitaryUnitState[]): void {
    const snapshot = this.snapshot();
    snapshot.fronts = [...fronts].sort((a, b) => String(a.id).localeCompare(String(b.id)));
    this.persist('front', snapshot.fronts);
    if (units) this.saveUnits(units);
  }

  /**
   * Scrive i reparti **e** riallinea l'aggregato delle armate alla loro somma:
   * una sola transazione, mai uno stato a metà (armata e reparti insieme).
   */
  /**
   * Scrive i reparti **e** riallinea l'aggregato delle armate alla loro somma.
   *
   * P4 — **INVARIANTE CROSS-POLITY**: `persist('unit', …)` è un replace completo
   * del `kind`, quindi `items` deve essere **l'insieme globale** dei reparti
   * (tutte le polity). Passare solo i reparti del giocatore cancellerebbe le
   * unità NPC. L'aggregato delle armate, invece, si calcola **solo** sui reparti
   * del giocatore: le armate sono oggetti della sua mappa.
   */
  saveUnits(items: readonly MilitaryUnitState[]): void {
    const snapshot = this.snapshot();
    snapshot.units = [...items].sort((a, b) => String(a.id).localeCompare(String(b.id)));
    this.persist('unit', snapshot.units);
    const playerPolityId = String(this.inputs.playerPolityId());
    const byArmy = new Map<string, MilitaryUnitState[]>();
    for (const unit of snapshot.units) {
      if (String(unit.polityId) !== playerPolityId) continue;
      const list = byArmy.get(String(unit.armyId));
      if (list) list.push(unit);
      else byArmy.set(String(unit.armyId), [unit]);
    }
    this.saveArmies(snapshot.armies.map(army => aggregateArmyFromUnits(army, byArmy.get(String(army.id)) || [])));
  }

  /**
   * Adotta in **cache** uno stato canonico già persistito altrove (percorso
   * atomico della ricostituzione, `militaryPersistenceRepository`).
   *
   * Non riscrive le righe canoniche — sono già nel database dentro la
   * transazione — e riallinea **solo** ciò che è derivato: l'aggregato delle
   * armate, che è per definizione la somma dei reparti (`aggregateArmyFromUnits`).
   * Se questo refresh non riuscisse, l'aggregato resterebbe un valore vecchio di
   * stato **derivato**: la prossima `saveUnits`/`syncArmies` lo ricalcola dai
   * reparti, che sono l'unica authority.
   */
  adoptPersisted(input: { personnel?: MilitaryPersonnelState; units: readonly MilitaryUnitState[] }): void {
    const snapshot = this.snapshot();
    if (input.personnel) snapshot.personnel = input.personnel;
    snapshot.units = [...input.units].sort((a, b) => String(a.id).localeCompare(String(b.id)));
    const playerPolityId = String(this.inputs.playerPolityId());
    const byArmy = new Map<string, MilitaryUnitState[]>();
    for (const unit of snapshot.units) {
      if (String(unit.polityId) !== playerPolityId) continue;
      const list = byArmy.get(String(unit.armyId));
      if (list) list.push(unit);
      else byArmy.set(String(unit.armyId), [unit]);
    }
    this.saveArmies(snapshot.armies.map(army => aggregateArmyFromUnits(army, byArmy.get(String(army.id)) || [])));
  }

  /** Aggregato nazionale come somma degli oggetti (diagnostica e invarianti). */
  aggregate(): OperationalAggregate {
    const snapshot = this.snapshot();
    return aggregateObjects({
      armies: snapshot.armies,
      facilities: snapshot.facilities,
      ships: snapshot.ships,
      fleets: snapshot.fleets,
      constructions: snapshot.constructions,
      stock: this.inputs.stock() as unknown as Record<string, number>,
      endowment: this.inputs.endowment(),
      activity: this.inputs.activity ? this.inputs.activity() : undefined,
      // Gli stessi numeri del tick: nessun ricalcolo per la lettura.
      allocation: this.allocation(),
    });
  }

  /** Equipaggiamento assegnato agli oggetti (armate + navi). */
  assignedEquipment(): Record<string, number> {
    const snapshot = this.snapshot();
    return aggregateObjects({
      armies: snapshot.armies,
      ships: snapshot.ships,
    }).assigned;
  }

  savePersonnel(state: MilitaryPersonnelState): void {
    const snapshot = this.snapshot();
    snapshot.personnel = state;
    try {
      operationalObjectRepository.upsert(this.inputs.gameId, 'personnel', this.inputs.playerPolityId(), state as unknown as Record<string, unknown>);
    } catch (error) {
      this.warn('salvataggio personale non riuscito', error);
    }
  }

  saveFacilities(items: readonly FacilityState[]): void {
    const snapshot = this.snapshot();
    snapshot.facilities = [...items];
    this.persist('facility', items);
  }

  saveShips(items: readonly ShipState[]): void {
    const snapshot = this.snapshot();
    snapshot.ships = [...items];
    this.persist('ship', items);
  }

  saveFleets(items: readonly FleetState[]): void {
    const snapshot = this.snapshot();
    snapshot.fleets = [...items];
    this.persist('fleet', items);
  }

  saveConstructions(items: readonly ConstructionState[]): void {
    const snapshot = this.snapshot();
    snapshot.constructions = [...items];
    this.persist('construction', items);
  }

  saveArmies(items: readonly ArmyOperationalState[]): void {
    const snapshot = this.snapshot();
    snapshot.armies = [...items];
    this.inputs.saveArmies([...items]);
  }

  /**
   * Una sola transazione per famiglia: upsert degli oggetti presenti e
   * rimozione di quelli scomparsi. Lo stato in memoria cambia solo dopo.
   */
  private persist(kind: OperationalObjectKind, items: readonly { id: string }[]): void {
    try {
      operationalObjectRepository.replaceKind(
        this.inputs.gameId,
        kind,
        items.map(item => ({ id: item.id, data: item as unknown as Record<string, unknown> })),
      );
    } catch (error) {
      this.warn(`salvataggio ${kind} non riuscito`, error);
    }
  }

  /** Aggiorna e chiude i cantieri: a lavori finiti nasce l'impianto. */
  syncConstructions(): void {
    const snapshot = this.snapshot();
    const projects = this.inputs.projects();
    const byId = new Map(projects.map(project => [`construction-${project.id}`, project]));
    // I cantieri noti si allineano al progetto del motore (progresso e scadenza).
    const aligned = snapshot.constructions.map(construction => {
      const project = byId.get(construction.id);
      if (!project) return construction;
      return {
        ...construction,
        progress: round1(nonNegative(project.progress)),
        expectedDate: project.expected_date ?? construction.expectedDate,
      };
    });
    const advance = advanceConstructions({
      polityId: this.inputs.playerPolityId(),
      constructions: aligned,
      ongoingProjectIds: projects.map(project => String(project.id)),
      facilities: snapshot.facilities,
      date: this.inputs.currentDate(),
      activity: this.inputs.activity ? this.inputs.activity() : undefined,
      technologies: this.technologies(),
    });
    if (advance.completed.length === 0) {
      if (aligned.some((item, index) => item.progress !== snapshot.constructions[index]?.progress)) {
        this.saveConstructions(aligned);
      }
      return;
    }
    this.saveConstructions(advance.constructions);
    if (advance.created.length > 0) {
      this.saveFacilities([...snapshot.facilities, ...advance.created]);
    }
  }

  /** Clona lo stato per le anteprime: nessuna scrittura deve passare da qui. */
  previewSnapshot(): OperationalStateSnapshot {
    return clone(this.snapshot());
  }
}

export default OperationalStateStore;
