/**
 * World Story — WarFrontService
 * =============================
 * Il **livello strategico della guerra** applicato al mondo: crea i fronti dal
 * contatto reale (ostilità + confine + reparti), assegna i reparti, scrive gli
 * ordini e risolve **un periodo** di combattimento per volta con il motore puro
 * `core/simulation/WarFronts.ts`.
 *
 * Regole di progetto (MILITARY-UNITS PR2)
 * ---------------------------------------
 * 1. **Un solo motore**: giocatore e NPC passano da `resolveFront`; l'unica
 *    differenza è chi sceglie l'ordine (il giocatore dal pannello, l'NPC dalla
 *    policy deterministica `npcFrontOrder`).
 * 2. **Nessun wargame**: nessuna battaglia tattica, nessun esagono, nessuna
 *    seconda contabilità di scorte: i consumi escono dalle **stesse** scorte
 *    materiali (`applyFlow` sul magazzino della polity).
 * 3. **Perdite reali**: uomini e pezzi si tolgono ai **reparti**, mai solo a
 *    `region.militaryPower`. Il `militaryPower` resta supporto dichiarato.
 * 4. **Territorio**: la conquista è una **decisione** del motore
 *    (`resolution.advance`) applicata con l'unico `transferRegion` esistente,
 *    solo con sfondamento + difensore che non tiene + obiettivo raggiungibile
 *    per adiacenza reale. Nessun testo LLM cambia il proprietario di una provincia.
 * 5. **Un periodo per volta**: il servizio è chiamato dentro il ciclo materiale
 *    (max 30 giorni) o dal battito live (7 giorni). Nessun tick giornaliero
 *    globale e nessun doppio conteggio.
 * 6. **Determinismo**: i tiri vengono da `frontRollSeed({ frontId, date, phase })`
 *    → `stableRoll`: stesso fronte, stessa data, stesso esito.
 */

import { indexPolities } from '../core/simulation/npc-policy';
import { applyFlow, type ResourceStock } from '../core/simulation/MaterialEconomy';
import {
  SURRENDER_LOSS_MULTIPLIER, frontIdFor, frontNameFor, frontObjectiveFor, frontSideStrength,
  npcFrontOrder, resolveFront, retreatRegionFor, supplyCoverage, type FrontRegion,
} from '../core/simulation/WarFronts';
import type { MilitaryEpoch } from '../core/simulation/MilitaryDoctrine';
import {
  FRONT_STATUS_LABEL,
  UNIT_ORDER_DEFAULT,
  UNIT_ORDER_INFO,
  UNIT_ORDER_LABEL,
  type MilitaryUnitState,
  type UnitOrder,
  type WarFrontState,
} from '../core/simulation/OperationalState';
import type { OperationalStateStore } from './OperationalStateStore';
import type { RegionState } from '../game-session';

export interface WarFrontContext {
  gameId: string;
  playerPolityId(): string;
  currentDate(): string;
  epoch(): MilitaryEpoch;
  operationalObjects(): OperationalStateStore;
  regions(): Map<string, RegionState>;
  /** Relazione diplomatica registrata fra due polity (il mondo la possiede). */
  relationship(from: string, to: string): string;
  /** L'**unico** passaggio di proprietà territoriale esistente. */
  transferRegion(region: RegionState, owner: string, color?: string): void;
  regionColorOf(polityId: string): string | undefined;
  resourceStock(polityId: string): ResourceStock;
  saveResourceStock(polityId: string, stock: ResourceStock): void;
  polityLabel(polityId: string): string;
  /** Nota nazionale: il giocatore legge il perché di un fatto, non un silenzio. */
  note(note: string): void;
}

/** Esito (o anteprima) di un ordine di fronte: la tabella PRIMA → DOPO. */
export interface UnitOrderImpact {
  applied: boolean;
  unitId: string;
  unitName: string;
  order: UnitOrder;
  orderLabel: string;
  frontId: string | null;
  frontName: string | null;
  blocked: boolean;
  blockedReason: string | null;
  rows: Array<{ label: string; before: number; after: number; unit: 'pct' | 'numero' }>;
  note: string;
  why: string;
}

/** Un periodo di guerra per ogni fronte aperto. */
export interface FrontTickReport {
  events: string[];
  fronts: number;
  conquests: string[];
}

const round1 = (value: number) => Math.round(value * 10) / 10;
const round4 = (value: number) => Math.round(value * 10000) / 10000;
const nonNegative = (value: unknown): number => {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? number : 0;
};

export class WarFrontService {
  constructor(private readonly ctx: WarFrontContext) {}

  private store(): OperationalStateStore {
    return this.ctx.operationalObjects();
  }

  /**
   * Esiste stato militare persistente? Lettura **pura**: un mondo che non ha mai
   * materializzato reparti non viene toccato (ne' scritto) da una lettura.
   */
  hasPersistentMilitary(): boolean {
    try {
      const store = this.store();
      return store.persistedUnits().length > 0 || store.persistedFronts().length > 0;
    } catch {
      return false;
    }
  }

  /**
   * Vero se la coppia di polity e' **gia'** gestita da un fronte con reparti
   * schierati: da li' in poi la conquista appartiene al `FrontEngine`, e il tick
   * legacy non tiene un secondo sistema in parallelo sulle stesse province.
   */
  frontBetween(a: string, b: string): boolean {
    if (!this.hasPersistentMilitary()) return false;
    const key = [String(a), String(b)].sort().join('|');
    const fronts = this.syncFronts().fronts.filter(front => String(front.status) !== 'closed'
      && [String(front.attackerPolityId), String(front.defenderPolityId)].sort().join('|') === key);
    if (fronts.length === 0) return false;
    const units = this.store().persistedUnits();
    return fronts.some(front => units.some(unit => String(unit.frontId) === String(front.id)
      && unit.status !== 'destroyed'));
  }

  /** Provincia della mappa dove sta il reparto: dice a quale parte appartiene. */
  private unitPolityId(unit: MilitaryUnitState): string {
    const region = unit.regionId ? this.ctx.regions().get(String(unit.regionId)) : undefined;
    return region?.owner || this.ctx.playerPolityId();
  }

  private theatreRegions(front: WarFrontState): RegionState[] {
    const regions = this.ctx.regions();
    return front.regionIds.map(id => regions.get(String(id))).filter((region): region is RegionState => Boolean(region));
  }

  /** Tutte le province note come `FrontRegion` (geografia della mappa, nient'altro). */
  private worldRegions(): FrontRegion[] {
    return [...this.ctx.regions().values()].map(region => ({
      id: region.id,
      name: region.name,
      owner: region.owner,
      borders: region.borders || [],
      militaryPower: region.militaryPower,
    }));
  }

  /**
   * Fronti: **nascita** (due polity ostili + confine reale + reparti coinvolti),
   * aggiornamento del teatro e dell'obiettivo, chiusura quando l'ostilità
   * finisce, assegnazione dei reparti presenti nel teatro.
   */
  syncFronts(): { events: string[]; fronts: WarFrontState[]; units: MilitaryUnitState[] } {
    const store = this.store();
    // Nessuno stato militare proprio: nessun fronte, nessuna scrittura.
    if (!this.hasPersistentMilitary()) {
      return { events: [], fronts: store.persistedFronts(), units: store.persistedUnits() };
    }
    const snapshot = store.snapshot();
    const regions = this.ctx.regions();
    const { owned, frontier } = indexPolities(regions);
    const events: string[] = [];
    const date = this.ctx.currentDate();
    let units = snapshot.units.map(unit => ({ ...unit }));
    let dirty = false;

    /** Coppie confinanti candidate: (a, b) ordinate, con il loro teatro. */
    const pairs = new Map<string, { a: string; b: string; theatre: Set<string> }>();
    for (const a of [...frontier.keys()].sort()) {
      if (!a || a === 'neutral') continue;
      for (const targetId of [...(frontier.get(a) || [])].sort()) {
        const target = regions.get(targetId);
        if (!target || target.status === 'destroyed') continue;
        const b = target.owner;
        if (!b || b === 'neutral' || b === a) continue;
        const key = [a, b].sort().join('|');
        const pair = pairs.get(key) ?? { a, b, theatre: new Set<string>() };
        pair.theatre.add(String(targetId));
        for (const region of owned.get(a) || []) {
          if ((region.borders || []).some(id => regions.get(String(id))?.owner === b)) pair.theatre.add(String(region.id));
        }
        for (const region of owned.get(b) || []) {
          if ((region.borders || []).some(id => regions.get(String(id))?.owner === a)) pair.theatre.add(String(region.id));
        }
        pairs.set(key, pair);
      }
    }

    const byPair = new Map<string, WarFrontState>();
    for (const front of snapshot.fronts) {
      byPair.set([front.attackerPolityId, front.defenderPolityId].sort().join('|'), front);
    }

    const unitsInTheatre = (polityId: string, theatre: ReadonlySet<string>) => units
      .filter(unit => unit.status !== 'destroyed'
        && unit.regionId && theatre.has(String(unit.regionId))
        && this.unitPolityId(unit) === polityId);

    for (const key of [...pairs.keys()].sort()) {
      const pair = pairs.get(key)!;
      const id = frontIdFor(pair.a, pair.b);
      const existing = snapshot.fronts.find(front => String(front.id) === id) ?? byPair.get(key);
      const hostile = this.ctx.relationship(pair.a, pair.b) === 'hostile' || this.ctx.relationship(pair.b, pair.a) === 'hostile';
      const theatreIds = [...pair.theatre].sort();
      if (!hostile) {
        // L'ostilità è finita: il fronte si chiude e i reparti tornano liberi.
        if (existing && existing.status !== 'closed') {
          existing.status = 'closed';
          existing.updatedDate = date;
          existing.attackerPressure = 0;
          existing.defenderPressure = 0;
          units = units.map(unit => (String(unit.frontId) === String(existing.id) ? { ...unit, frontId: null } : unit));
          events.push(`🕊️ Si chiude il ${existing.name}: le parti non sono più in guerra.`);
          dirty = true;
        }
        continue;
      }
      const aUnits = unitsInTheatre(pair.a, pair.theatre);
      const bUnits = unitsInTheatre(pair.b, pair.theatre);
      const already = units.filter(unit => String(unit.frontId) === id && unit.status !== 'destroyed').length;
      // «Unità coinvolte» è una condizione di nascita: un fronte non nasce dal
      // nulla. Il teatro resta conteso anche se una parte resta senza reparti.
      if (!existing && aUnits.length + bUnits.length + already === 0) continue;

      const theatreRegions = theatreIds
        .map(regionId => regions.get(regionId))
        .filter((region): region is RegionState => Boolean(region));
      // Ruolo: attacca chi ha più uomini nel teatro, poi chi ha più potenza
      // dichiarata, poi l'ordine alfabetico. Deterministico, senza LLM.
      const men = (list: MilitaryUnitState[]) => list.reduce((total, unit) => total + nonNegative(unit.personnel), 0);
      const power = (polityId: string) => theatreRegions
        .filter(region => region.owner === polityId)
        .reduce((total, region) => total + nonNegative(region.militaryPower), 0);
      const menA = men(aUnits);
      const menB = men(bUnits);
      // Il ruolo si decide **alla nascita** del fronte: chi ha più uomini nel
      // teatro attacca, poi chi ha più potenza dichiarata, poi l'alfabeto. Un
      // fronte già aperto conserva i suoi ruoli (un fronte che cambia "chi
      // attacca" a ogni periodo non sarebbe una guerra, sarebbe rumore).
      const attackerPolityId = existing
        ? existing.attackerPolityId
        : menA !== menB
          ? (menA > menB ? pair.a : pair.b)
          : power(pair.a) !== power(pair.b)
            ? (power(pair.a) > power(pair.b) ? pair.a : pair.b)
            : (pair.a < pair.b ? pair.a : pair.b);
      const defenderPolityId = attackerPolityId === pair.a ? pair.b : pair.a;
      const objective = frontObjectiveFor({
        theatre: theatreRegions as unknown as FrontRegion[],
        attackerPolityId,
        defenderPolityId,
      });

      if (!existing) {
        const front: WarFrontState = {
          id,
          name: frontNameFor(this.ctx.polityLabel(attackerPolityId), this.ctx.polityLabel(defenderPolityId)),
          attackerPolityId,
          defenderPolityId,
          regionIds: theatreIds,
          status: 'forming',
          objectiveRegionId: objective?.id ?? null,
          attackerPressure: 0,
          defenderPressure: 0,
          createdDate: date,
          updatedDate: date,
        };
        snapshot.fronts.push(front);
        byPair.set(key, front);
        events.push(`⚔️ Si apre il ${front.name}: ${this.ctx.polityLabel(attackerPolityId)} e ${this.ctx.polityLabel(defenderPolityId)} sono in contatto su ${theatreIds.map(regionId => regions.get(regionId)?.name || regionId).join(', ')}.`);
        dirty = true;
      } else {
        const theatreChanged = existing.regionIds.join('|') !== theatreIds.join('|');
        const objectiveChanged = String(existing.objectiveRegionId || '') !== String(objective?.id || '');
        if (theatreChanged || objectiveChanged || existing.defenderPolityId !== defenderPolityId) {
          Object.assign(existing, {
            regionIds: theatreIds,
            objectiveRegionId: objective?.id ?? null,
            updatedDate: date,
          });
          dirty = true;
        }
        if (existing.status === 'closed') {
          existing.status = 'forming';
          existing.updatedDate = date;
          events.push(`⚔️ Il ${existing.name} si riapre: la guerra è ripresa.`);
          dirty = true;
        }
      }

      // Assegnazione: i reparti della coppia presenti nel teatro seguono il fronte
      // (`frontId` è la fonte autorevole: il fronte li deriva, non li possiede).
      const assignable = units.filter(unit => unit.status !== 'destroyed'
        && !unit.frontId
        && unit.regionId && pair.theatre.has(String(unit.regionId))
        && (this.unitPolityId(unit) === attackerPolityId || this.unitPolityId(unit) === defenderPolityId));
      if (assignable.length > 0) {
        const ids = new Set(assignable.map(unit => String(unit.id)));
        units = units.map(unit => (ids.has(String(unit.id)) ? { ...unit, frontId: id, updatedDate: date } : unit));
        dirty = true;
      }
    }

    if (dirty) store.saveFronts(snapshot.fronts, units);
    return { events, fronts: snapshot.fronts, units };
  }

  /** Fronti noti (con sincronizzazione: lettura e stato non divergono). */
  warFronts(): WarFrontState[] {
    return this.syncFronts().fronts;
  }

  /** Parti di un fronte: reparti per lato, rifornimenti reali e supporto legacy. */
  private sides(front: WarFrontState, units: readonly MilitaryUnitState[], stepDays: number) {
    const theatreRegions = this.theatreRegions(front);
    const of = (polityId: string) => units.filter(unit => String(unit.frontId) === String(front.id)
      && this.unitPolityId(unit) === polityId);
    const stage = (polityId: string, isPlayer: boolean) => {
      const list = of(polityId);
      let stock: ResourceStock | null = null;
      try {
        stock = this.ctx.resourceStock(polityId);
      } catch {
        stock = null;
      }
      const supply = supplyCoverage({
        stock: { food: stock?.food ?? 0, fuel: stock?.fuel ?? 0, weapons: stock?.weapons ?? 0 },
        units: list,
        stepDays,
      });
      const legacyPower = theatreRegions
        .filter(region => region.owner === polityId)
        .reduce((total, region) => total + nonNegative(region.militaryPower), 0);
      const motorized = Boolean(stock?.technologies?.includes('motorizzazione'));
      return { polityId, units: list, supply, legacyPower, motorized, isPlayer, stock };
    };
    return {
      theatreRegions,
      attacker: stage(front.attackerPolityId, front.attackerPolityId === this.ctx.playerPolityId()),
      defender: stage(front.defenderPolityId, front.defenderPolityId === this.ctx.playerPolityId()),
    };
  }

  /** Pressione di una parte con un ordine ipotetico (anteprima dell'ordine). */
  private pressureWith(side: ReturnType<WarFrontService['sides']>['attacker'], order: UnitOrder, epoch: MilitaryEpoch) {
    const unit = side.units[0] ?? null;
    const list = unit
      ? [{ ...unit, order }]
      : [];
    const strength = frontSideStrength({
      units: list,
      epoch,
      supply: side.supply,
      motorized: side.motorized,
      legacyPower: side.legacyPower,
      legacyOrder: list.length === 0 ? order : undefined,
    });
    return strength.pressure;
  }

  /**
   * Ordine di un reparto (P7): persistente. Con `dryRun` è l'anteprima: gli
   * stessi numeri del motore (pressione, perdite attese, consumi di guerra) senza
   * scrivere nulla.
   */
  unitOrder(input: { unitId: string; order: UnitOrder; dryRun?: boolean }): UnitOrderImpact {
    const order = input.order;
    if (!(order in UNIT_ORDER_LABEL)) throw new Error(`order_unknown: «${String(order)}» non è un ordine del fronte`);
    const store = this.store();
    const snapshot = input.dryRun ? store.previewSnapshot() : store.snapshot();
    const unit = snapshot.units.find(item => String(item.id) === String(input.unitId));
    if (!unit) throw new Error(`unit_unknown: reparto «${input.unitId}» inesistente`);
    const front = unit.frontId ? snapshot.fronts.find(item => String(item.id) === String(unit.frontId)) ?? null : null;
    const before = { ...unit };
    const info = UNIT_ORDER_INFO[order];
    const rows: UnitOrderImpact['rows'] = [];
    const epoch = this.epoch();
    if (front) {
      const stepDays = 30;
      const sides = this.sides(front, snapshot.units, stepDays);
      const own = unit.armyId && this.unitPolityId(unit) === front.attackerPolityId ? sides.attacker : sides.defender;
      const other = own === sides.attacker ? sides.defender : sides.attacker;
      const ownBefore = this.pressureWith(own, (before.order ?? UNIT_ORDER_DEFAULT) as UnitOrder, epoch);
      const ownAfter = this.pressureWith(own, order, epoch);
      rows.push({ label: 'Pressione della parte', before: round1(ownBefore * 100), after: round1(ownAfter * 100), unit: 'pct' });
      rows.push({
        label: 'Pressione nemica',
        before: round1(this.pressureWith(other, (other.units[0]?.order ?? UNIT_ORDER_DEFAULT) as UnitOrder, epoch) * 100),
        after: round1(this.pressureWith(other, (other.units[0]?.order ?? UNIT_ORDER_DEFAULT) as UnitOrder, epoch) * 100),
        unit: 'pct',
      });
    }
    rows.push({ label: 'Perdite attese', before: round1(UNIT_ORDER_INFO[(before.order ?? UNIT_ORDER_DEFAULT) as UnitOrder].losses * 100), after: round1(info.losses * 100), unit: 'pct' });
    rows.push({ label: 'Consumi di guerra', before: round1(UNIT_ORDER_INFO[(before.order ?? UNIT_ORDER_DEFAULT) as UnitOrder].consumption * 100), after: round1(info.consumption * 100), unit: 'pct' });

    const blockedReason = unit.status === 'destroyed'
      ? 'Reparto distrutto: non ha più ordini da eseguire.'
      : !front
        ? 'Il reparto non è assegnato a un fronte: nessun ordine da dare.'
        : unit.order === order
          ? `Il reparto ha già l'ordine «${UNIT_ORDER_LABEL[order]}».`
          : null;
    const next: MilitaryUnitState = { ...unit, order, updatedDate: this.ctx.currentDate() };
    if (!input.dryRun && !blockedReason) {
      store.saveUnits(snapshot.units.map(item => (String(item.id) === String(unit.id) ? next : item)));
    }
    return {
      applied: !input.dryRun && !blockedReason,
      unitId: next.id,
      unitName: next.name,
      order,
      orderLabel: UNIT_ORDER_LABEL[order],
      frontId: front?.id ?? null,
      frontName: front?.name ?? null,
      blocked: Boolean(blockedReason),
      blockedReason,
      rows,
      note: blockedReason
        ? `Nessun ordine impartito a «${next.name}».`
        : `«${next.name}»: ordine «${UNIT_ORDER_LABEL[order]}»${front ? ` sul ${front.name}` : ''}.`,
      why: `${info.note} Pressione ×${info.pressure} · perdite ×${info.losses} · consumi ×${info.consumption}. L'ordine è persistente: vale per tutti i periodi finché non cambia.`,
    };
  }

  private epoch(): MilitaryEpoch {
    return this.ctx.epoch();
  }

  /**
   * Un **periodo** di guerra per ogni fronte aperto: rifornimenti reali, perdite
   * reali sui reparti, ritirata in una provincia amica, conquista solo con
   * sfondamento. Restituisce i dispacci deterministici (nessuna LLM).
   */
  advanceFronts(days: number, dateOverride?: string): FrontTickReport {
    const stepDays = Math.max(0, Math.floor(nonNegative(days)));
    const events: string[] = [];
    if (stepDays <= 0) return { events, fronts: 0, conquests: [] };
    if (!this.hasPersistentMilitary()) return { events, fronts: 0, conquests: [] };
    const sync = this.syncFronts();
    events.push(...sync.events);
    const store = this.store();
    const snapshot = store.snapshot();
    const date = dateOverride || this.ctx.currentDate();
    const epoch = this.epoch();
    const regions = this.ctx.regions();
    const player = this.ctx.playerPolityId();
    let units = snapshot.units.map(unit => ({ ...unit }));
    const fronts = snapshot.fronts.map(front => ({ ...front }));
    const conquests: string[] = [];
    let touched = false;

    for (const front of fronts) {
      if (front.status === 'closed') continue;
      const sides = this.sides(front, units, stepDays);
      // Policy NPC: la parte non giocante sceglie con la **stessa** formula, in
      // modo deterministico. Il giocatore sceglie dal pannello del reparto.
      const pre = {
        attacker: frontSideStrength({ units: sides.attacker.units, epoch, supply: sides.attacker.supply, motorized: sides.attacker.motorized, legacyPower: sides.attacker.legacyPower }),
        defender: frontSideStrength({ units: sides.defender.units, epoch, supply: sides.defender.supply, motorized: sides.defender.motorized, legacyPower: sides.defender.legacyPower }),
      };
      const npcOrder = {
        attacker: npcFrontOrder({ ownPressure: pre.attacker.pressure, enemyPressure: pre.defender.pressure }),
        defender: npcFrontOrder({ ownPressure: pre.defender.pressure, enemyPressure: pre.attacker.pressure }),
      };
      if (!sides.attacker.isPlayer && sides.attacker.units.length > 0) {
        units = units.map(unit => (String(unit.frontId) === String(front.id) && this.unitPolityId(unit) === front.attackerPolityId
          ? { ...unit, order: npcOrder.attacker, updatedDate: date } : unit));
        touched = true;
      }
      if (!sides.defender.isPlayer && sides.defender.units.length > 0) {
        units = units.map(unit => (String(unit.frontId) === String(front.id) && this.unitPolityId(unit) === front.defenderPolityId
          ? { ...unit, order: npcOrder.defender, updatedDate: date } : unit));
        touched = true;
      }
      const live = this.sides(front, units, stepDays);
      const resolution = resolveFront({
        front,
        epoch,
        date,
        stepDays,
        theatre: this.worldRegions(),
        attacker: {
          units: live.attacker.units,
          legacyPower: live.attacker.legacyPower,
          supply: live.attacker.supply,
          motorized: live.attacker.motorized,
          legacyOrder: live.attacker.isPlayer ? 'defend' : npcOrder.attacker,
        },
        defender: {
          units: live.defender.units,
          legacyPower: live.defender.legacyPower,
          supply: live.defender.supply,
          motorized: live.defender.motorized,
          legacyOrder: live.defender.isPlayer ? 'defend' : npcOrder.defender,
        },
      });

      // 1) Consumi reali dalle scorte delle due parti (stesso magazzino del tick).
      for (const [side, polityId, consumption] of [
        ['attaccante', front.attackerPolityId, resolution.consumption.attacker],
        ['difensore', front.defenderPolityId, resolution.consumption.defender],
      ] as const) {
        if (consumption.food <= 0 && consumption.fuel <= 0 && consumption.weapons <= 0) continue;
        try {
          const stock = this.ctx.resourceStock(polityId);
          const next = applyFlow(stock, { food: -consumption.food, fuel: -consumption.fuel, weapons: -consumption.weapons });
          this.ctx.saveResourceStock(polityId, next);
        } catch (error) {
          console.warn('[WarFrontService] Consumi di guerra non applicati:', side, error);
        }
      }

      // 2) Perdite reali sui reparti + 3) ritirata in provincia amica.
      const outcomeById = new Map(resolution.outcomes.map(outcome => [outcome.unitId, outcome]));
      units = units.map(unit => {
        const outcome = outcomeById.get(String(unit.id));
        if (!outcome) return unit;
        const side = outcome.side === 'attacker' ? front.attackerPolityId : front.defenderPolityId;
        const next: MilitaryUnitState = {
          ...unit,
          personnel: outcome.personnelAfter,
          equipment: outcome.equipmentAfter,
          readiness: outcome.readinessAfter,
          status: outcome.statusAfter,
          order: outcome.order,
          updatedDate: date,
        };
        if (!outcome.routed || next.status === 'destroyed') return next;
        const target = retreatRegionFor({
          unit: next,
          side,
          regions: this.worldRegions(),
          avoid: [...front.regionIds, String(front.objectiveRegionId || '')],
        });
        const liveRegion = target ? regions.get(String(target.id)) : undefined;
        if (!liveRegion) {
          // Nessuna provincia amica valida: la resa costa di più. Le perdite
          // aggiuntive sono **reali** e applicate ai reparti (mai solo alla mappa).
          const extra = Math.round(nonNegative(next.personnel) * (SURRENDER_LOSS_MULTIPLIER - 1));
          const personnel = Math.max(0, next.personnel - extra);
          next.personnel = personnel;
          if (personnel <= 0) {
            next.status = 'destroyed';
            next.equipment = {};
            next.readiness = 0;
          }
          events.push(`🏳️ Nessuna via di ripiegamento per «${next.name}»: ${extra.toLocaleString('it-IT')} uomini persi nella resa.`);
          this.ctx.note(`⚠️ «${next.name}» non ha una provincia amica dove ritirarsi: perdite maggiori (${extra.toLocaleString('it-IT')} uomini).`);
          return next;
        }
        events.push(`↩️ «${next.name}» ripiega da ${unit.regionName || unit.regionId} a ${liveRegion.name}.`);
        return { ...next, regionId: liveRegion.id, regionName: liveRegion.name };
      });

      // 4) Conquista: solo la **decisione** del motore, applicata con `transferRegion`.
      if (resolution.advance) {
        const region = regions.get(String(resolution.advance.objectiveRegionId));
        if (region && region.owner === front.defenderPolityId) {
          const from = this.ctx.polityLabel(front.defenderPolityId);
          this.ctx.transferRegion(region, front.attackerPolityId, this.ctx.regionColorOf(front.attackerPolityId));
          const headline = `${this.ctx.polityLabel(front.attackerPolityId)} conquista ${region.name} (era ${from}): il ${front.name} ha sfondato.`;
          conquests.push(headline);
          events.push(`🚩 ${headline}`);
          this.ctx.note(`🚩 ${headline}`);
        }
      }

      // 4-bis) Attrito della forza **dichiarata**: la stessa quota perduta dai
      // reparti consuma la `militaryPower` delle province in teatro. La mappa
      // resta la fonte (come l'attrito di conquista già fa), quindi una
      // provincia senza reparti non è invulnerabile e il fronte può chiudersi.
      for (const [polityId, lost] of [
        [front.attackerPolityId, resolution.legacyLost.attacker],
        [front.defenderPolityId, resolution.legacyLost.defender],
      ] as const) {
        if (lost <= 0) continue;
        const owned = this.theatreRegions(front).filter(region => String(region.owner) === String(polityId));
        const total = owned.reduce((sum, region) => sum + Math.max(0, Number(region.militaryPower || 0)), 0);
        if (total <= 0) continue;
        const ratio = Math.min(1, lost / total);
        for (const region of owned) {
          const live = regions.get(String(region.id));
          if (!live) continue;
          const power = Math.max(0, Number(live.militaryPower || 0));
          live.militaryPower = Math.max(0, Math.round(power * (1 - ratio)));
        }
        events.push(`💥 ${this.ctx.polityLabel(polityId)}: la forza dichiarata in teatro cala di ${Math.round(lost * ratio * 100) / 100} (attrito del fronte).`);
      }

      // 5) Fronte aggiornato: pressioni, stato e data.
      Object.assign(front, {
        status: resolution.status,
        attackerPressure: round4(resolution.attackerPressure),
        defenderPressure: round4(resolution.defenderPressure),
        updatedDate: date,
      });
      touched = true;
      const losses = resolution.outcomes.reduce((total, outcome) => total + outcome.personnelLost, 0);
      const equipmentLost = resolution.outcomes.reduce((total, outcome) => total + outcome.equipmentLost, 0);
      if (losses > 0 || equipmentLost > 0 || resolution.status !== 'active') {
        events.push(`⚔️ ${front.name}: ${FRONT_STATUS_LABEL[resolution.status].toLowerCase()} — ${losses.toLocaleString('it-IT')} uomini e ${equipmentLost.toLocaleString('it-IT')} pezzi perduti in ${stepDays} giorni (pressione ${round1(resolution.attackerPressure * 100)} contro ${round1(resolution.defenderPressure * 100)}).`);
      }
    }

    // Scrittura solo se qualcosa e' cambiato davvero: un tick senza battaglia non
    // deve riscrivere reparti (ne' gli oggetti-armata della mappa).
    const unitsChanged = JSON.stringify(units) !== JSON.stringify(snapshot.units);
    if (touched || unitsChanged) store.saveFronts(fronts, unitsChanged ? units : undefined);
    return { events, fronts: fronts.filter(front => front.status !== 'closed').length, conquests };
  }
}

export default WarFrontService;
