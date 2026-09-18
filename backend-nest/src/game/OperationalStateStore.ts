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
import { marginalProduction } from '../core/simulation/OperationalObjects';
import type { ResourceStock } from '../core/simulation/MaterialEconomy';
import {
  advanceConstructions,
  aggregateObjects,
  emptyOperationalState,
  seedArmies,
  seedConstructions,
  seedFacilities,
  seedPersonnel,
  seedShips,
  type ArmyOperationalState,
  type ConstructionState,
  type FacilityState,
  type FleetState,
  type MilitaryPersonnelState,
  type OperationalAggregate,
  type OperationalStateSnapshot,
  type SeedArmyInput,
  type SeedRegion,
  type ShipState,
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
          case 'personnel': snapshot.personnel = data as unknown as MilitaryPersonnelState; break;
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
    snapshot.ships.sort((a, b) => String(a.id).localeCompare(String(b.id)));
    snapshot.fleets.sort((a, b) => String(a.id).localeCompare(String(b.id)));
    snapshot.constructions.sort((a, b) => String(a.id).localeCompare(String(b.id)));
    this.state = snapshot;
    return snapshot;
  }

  /** Il seed è avvenuto? La riga di personale è la sentinella. */
  seeded(): boolean {
    if (this.seedChecked) return this.seedDone;
    try {
      this.seedDone = operationalObjectRepository.idsOfKind(this.inputs.gameId, 'personnel').length > 0;
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
      const technologies = this.inputs.stock().technologies || [];
      // Output per impianto dal **motore**: la somma degli impianti è la
      // produzione nazionale (nessuna formula riscritta nello store).
      const profileOf = (kind: string): Record<string, number> | undefined => {
        if (kind === 'mine') return undefined;
        const profile = kind === 'shipyard'
          ? marginalProduction({ ports: 1 }, endowment, technologies)
          : kind === 'research_center'
            ? marginalProduction({ universities: 1 }, endowment, technologies)
            : marginalProduction({ factories: 1 }, endowment, technologies);
        return { ...profile } as unknown as Record<string, number>;
      };
      const facilities = seedFacilities({
        polityId,
        factories: this.inputs.factories(),
        ports: this.inputs.ports(),
        universities: this.inputs.universities(),
        regions,
        date,
        endowment,
        profileOf,
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
      this.state = { personnel, armies, facilities, ships, fleets, constructions };
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
    const seeds = this.inputs.armyObjects();
    const total = Math.max(0, Math.round(this.inputs.totalFormations()));
    const accounted = seeds.reduce((sum, army) => sum + Math.max(0, Math.round(nonNegative(army.formations))), 0);
    const byId = new Map(snapshot.armies.map(army => [String(army.id), army]));
    const next: ArmyOperationalState[] = [];
    for (const seed of seeds) {
      const id = String(seed.objectId || seed.id);
      const existing = byId.get(id);
      const formations = Math.max(0, Math.round(nonNegative(seed.formations)));
      if (existing) {
        next.push({
          ...existing,
          name: seed.name || existing.name,
          regionId: seed.regionId ?? existing.regionId,
          regionName: seed.regionName ?? existing.regionName,
          formations,
          personnel: existing.legacyDerived ? Math.round(formations * menPerFormation) : existing.personnel,
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
          monthlyNeeds: { fuel: 0, weapons: 0, food: 0 },
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
      next.push({
        ...previous,
        formations: leftover,
        personnel: previous.legacyDerived ? Math.round(leftover * menPerFormation) : previous.personnel,
      });
    }
    snapshot.armies = next.sort((a, b) => String(a.id).localeCompare(String(b.id)));
    this.state = snapshot;
    return snapshot;
  }

  /** Stato pronto all'uso: legge, semina se serve, riconcilia le armate. */
  snapshot(): OperationalStateSnapshot {
    const snapshot = this.ensureSeeded();
    this.syncArmies(snapshot);
    return snapshot;
  }

  personnel(): MilitaryPersonnelState {
    return this.snapshot().personnel;
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
    try {
      for (const existing of operationalObjectRepository.idsOfKind(this.inputs.gameId, 'facility')) {
        if (!items.some(item => item.id === existing)) operationalObjectRepository.remove(this.inputs.gameId, existing);
      }
    } catch (error) {
      this.warn('pulizia impianti non riuscita', error);
    }
  }

  saveShips(items: readonly ShipState[]): void {
    const snapshot = this.snapshot();
    snapshot.ships = [...items];
    this.persist('ship', items);
    try {
      for (const existing of operationalObjectRepository.idsOfKind(this.inputs.gameId, 'ship')) {
        if (!items.some(item => item.id === existing)) operationalObjectRepository.remove(this.inputs.gameId, existing);
      }
    } catch (error) {
      this.warn('pulizia navi non riuscita', error);
    }
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
    try {
      for (const existing of operationalObjectRepository.idsOfKind(this.inputs.gameId, 'construction')) {
        if (!items.some(item => item.id === existing)) operationalObjectRepository.remove(this.inputs.gameId, existing);
      }
    } catch (error) {
      this.warn('pulizia cantieri non riuscita', error);
    }
  }

  saveArmies(items: readonly ArmyOperationalState[]): void {
    const snapshot = this.snapshot();
    snapshot.armies = [...items];
    this.inputs.saveArmies([...items]);
  }

  private persist(kind: OperationalObjectKind, items: readonly { id: string }[]): void {
    try {
      operationalObjectRepository.upsertMany(
        this.inputs.gameId,
        items.map(item => ({ kind, id: item.id, data: item as unknown as Record<string, unknown> })),
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
