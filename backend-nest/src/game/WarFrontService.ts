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
 *    seconda contabilità di scorte: i consumi di guerra sono **gli stessi**
 *    `militaryNeeds` del tick materiale (`advanceStock`), moltiplicati per il
 *    coefficiente dell'ordine. Il servizio **non** sottrae nulla dalle scorte
 *    (MILITARY/WARFRONT INTEGRITY P0-2).
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
import type { MaterialFulfillment, ResourceStock } from '../core/simulation/MaterialEconomy';
import {
  DEPLETED_ORGANIC_RATIO, SURRENDER_LOSS_MULTIPLIER,
  frontIdFor, frontNameFor, frontObjectiveFor, frontSideStrength,
  legacyWarConsumptionFactor, npcFrontOrder, resolveFront, retreatRegionFor, supplyCoverage, unitIsActiveOnFront,
  type FrontRegion, type SideSupply,
} from '../core/simulation/WarFronts';
import type { MilitaryEpoch } from '../core/simulation/MilitaryDoctrine';
import {
  FRONT_STATUS_LABEL,
  UNIT_ORDER_DEFAULT,
  UNIT_ORDER_INFO,
  UNIT_ORDER_LABEL,
  equipmentQuantity,
  rifleEquipmentId,
  rifleRequirement,
  unitReadiness,
  unitStatusFromCoverage,
  type MilitaryUnitState,
  type UnitOrder,
  type WarFrontState,
} from '../core/simulation/OperationalState';
import { daysBetween } from '../core/simulation/calendar';
import { militaryManpower } from '../core/simulation/MilitaryDoctrine';
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

/**
 * Cosa il tick materiale ha misurato nel periodo appena vissuto. Il fronte
 * **legge** la copertura già decisa dal material engine, non la ricalcola dalle
 * scorte residue (che sono zero anche quando il fabbisogno è stato coperto).
 */
export interface FrontTickOptions {
  /** Copertura del fabbisogno del periodo, per polity. */
  supply?: Record<string, MaterialFulfillment>;
  /**
   * P0-D — ordine del periodo della forza **dichiarata**, **per fronte e per
   * polity** (`{ [frontId]: { [polityId]: order } }`): è lo **stesso** deciso da
   * `planPeriod()` prima del fabbisogno materiale. L'ordine è legato al singolo
   * fronte: un ordine nazionale applicato a tutti i fronti descriverebbe un
   * piano diverso da quello pagato.
   */
  legacyOrdersByFront?: Record<string, Record<string, UnitOrder>>;
  /**
   * Compatibilità: ordine per sola polity, usato **solo** se il piano per-fronte
   * non ha quel fronte. Il percorso canonico passa `legacyOrdersByFront`.
   */
  legacyOrders?: Record<string, UnitOrder>;
}

const round1 = (value: number) => Math.round(value * 10) / 10;
const round4 = (value: number) => Math.round(value * 10000) / 10000;
const clamp01 = (value: unknown): number => Math.min(1, Math.max(0, Number(value) || 0));
const nonNegative = (value: unknown): number => {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? number : 0;
};

export class WarFrontService {
  constructor(private readonly ctx: WarFrontContext) {}

  /**
   * Ultima copertura del periodo calcolata dal tick materiale, per polity.
   * Dato **transitorio** del tick (non è stato: non entra in nessuna tabella e
   * non sopravvive a un riavvio). Serve alla diagnosi e alla UI: è lo stesso
   * numero che ha deciso la battaglia, non una sua reinterpretazione.
   */
  private periodCoverage = new Map<string, MaterialFulfillment>();

  periodSupply(polityId: string): MaterialFulfillment | null {
    return this.periodCoverage.get(String(polityId)) ?? null;
  }

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

  /**
   * MILITARY/WARFRONT INTEGRITY P0-3 — sgancio dei reparti fuori teatro.
   *
   * Un reparto partecipa a un fronte **solo** se: il fronte esiste, non è
   * chiuso, il reparto è ancora in una provincia del teatro e appartiene ancora
   * a una delle due parti. Altrimenti il `frontId` si azzera: senza questo, un
   * reparto trasferito a Roma continuava a combattere su un fronte in Austria.
   *
   * I reparti **distrutti** non si sganciano: sono inerti (non combattono, non
   * consumano, non si rianimano) e il fronte su cui sono caduti è la loro storia.
   *
   * @returns vero se almeno un reparto è stato sganciato (lo stato va salvato)
   */
  private detachOutOfTheatre(fronts: readonly WarFrontState[], units: MilitaryUnitState[], date: string): boolean {
    const byId = new Map(fronts.map(front => [String(front.id), front]));
    let detached = false;
    for (let index = 0; index < units.length; index += 1) {
      const unit = units[index];
      // I reparti distrutti restano dov'erano: inerti, e quel fronte è la loro storia.
      if (!unit.frontId || unit.status === 'destroyed') continue;
      const front = byId.get(String(unit.frontId));
      if (unitIsActiveOnFront({ unit, front, unitPolityId: this.unitPolityId(unit) })) continue;
      // Lo sgancio è **bookkeeping**: toglie il reparto dal fronte, non cambia il
      // suo stato operativo. `updatedDate` resta quello dell'ultimo fatto reale
      // (la ritirata): è il riferimento con cui PR3 conta i giorni fuori dal
      // fronte, e riscriverlo qui — magari con una data più vecchia del fatto —
      // farebbe rientrare il reparto in anticipo.
      units[index] = { ...unit, frontId: null };
      detached = true;
    }
    return detached;
  }

  private theatreRegions(front: WarFrontState): RegionState[] {
    const regions = this.ctx.regions();
    return front.regionIds.map(id => regions.get(String(id))).filter((region): region is RegionState => Boolean(region));
  }

  /** Potenza **dichiarata** di una polity dentro il teatro di un fronte. */
  private legacyPowerIn(front: WarFrontState, polityId: string): number {
    return this.theatreRegions(front)
      .filter(region => String(region.owner) === String(polityId))
      .reduce((total, region) => total + nonNegative(region.militaryPower), 0);
  }

  /**
   * P0-D — piano **transitorio** del periodo per la forza **dichiarata**
   * (legacy, senza reparti persistenti).
   *
   * L'ordine di una parte senza reparti è anche un **costo**: se lo si decidesse
   * dentro il tick del fronte, il fabbisogno del periodo sarebbe già stato pagato
   * al prezzo sbagliato (tutti a ×1, mentre il player in attacco paga ×1,8).
   * Qui la decisione viene presa **prima** del tick materiale, con la stessa
   * `npcFrontOrder()` del combattimento: nessuna seconda policy.
   *
   * - l'ordine resta legato al **singolo fronte**
   *   (`legacyOrdersByFront[frontId][polityId]`): è quello che `resolveFront`
   *   userà per quel fronte, e nessun ordine nazionale lo sostituisce;
   * - il costo nazionale è la media pesata delle quote impegnate
   *   (`legacyWarConsumptionFactor`), con la parte fuori teatro a ×1;
   * - il **player** è escluso: i suoi reparti pagano già il coefficiente per
   *   unità (`OperationalStateStore.militaryNeeds`), sommarlo sarebbe un doppio
   *   conteggio;
   * - puro e deterministico; transitorio (non entra in nessuna tabella).
   *
   * Presuppone `syncFronts()` già eseguito nel substep: il piano legge lo stato
   * assestato, non quello del periodo precedente.
   */
  planPeriod(stepDays = 30): {
    legacyOrdersByFront: Record<string, Record<string, UnitOrder>>;
    legacyConsumptionFactors: Record<string, number>;
  } {
    const legacyOrdersByFront: Record<string, Record<string, UnitOrder>> = {};
    const legacyConsumptionFactors: Record<string, number> = {};
    if (!this.hasPersistentMilitary()) return { legacyOrdersByFront, legacyConsumptionFactors };
    // **Sola lettura**: il chiamante ha già sincronizzato i fronti (`syncFronts()`
    // è il passo 1 dell'ordine del substep e produce anche gli eventi di cronaca).
    // Qui non si scrive e non si consumano eventi: il piano è aritmetica.
    const snapshot = this.store().snapshot();
    const player = String(this.ctx.playerPolityId());
    const epoch = this.epoch();
    // Potenza dichiarata **nazionale** per polity: è il denominatore delle quote
    // (la forza fuori dal teatro paga ×1). Nessuna seconda lettura del mondo.
    const national = new Map<string, number>();
    for (const region of this.ctx.regions().values()) {
      const owner = String(region.owner || '');
      if (!owner || owner === 'neutral') continue;
      national.set(owner, (national.get(owner) || 0) + nonNegative(region.militaryPower));
    }
    const engagements = new Map<string, Array<{ order: UnitOrder; weight: number }>>();
    for (const front of snapshot.fronts) {
      if (String(front.status) === 'closed') continue;
      const sides = this.sides(front, snapshot.units, stepDays);
      const pre = {
        attacker: frontSideStrength({ units: sides.attacker.units, epoch, supply: sides.attacker.supply, motorized: sides.attacker.motorized, legacyPower: sides.attacker.legacyPower }),
        defender: frontSideStrength({ units: sides.defender.units, epoch, supply: sides.defender.supply, motorized: sides.defender.motorized, legacyPower: sides.defender.legacyPower }),
      };
      const order = {
        attacker: npcFrontOrder({ ownPressure: pre.attacker.pressure, enemyPressure: pre.defender.pressure }),
        defender: npcFrontOrder({ ownPressure: pre.defender.pressure, enemyPressure: pre.attacker.pressure }),
      };
      // **Una sola fonte**: l'ordine di questo fronte per questa polity entra sia
      // nel piano operativo (`legacyOrdersByFront`) sia nel costo nazionale
      // (`engagements`). Costo e combattimento non possono divergere.
      const ordersOfFront: Record<string, UnitOrder> = {};
      for (const side of ['attacker', 'defender'] as const) {
        const polityId = String(side === 'attacker' ? front.attackerPolityId : front.defenderPolityId);
        if (polityId === player) continue;
        ordersOfFront[polityId] = order[side];
      }
      if (Object.keys(ordersOfFront).length === 0) continue;
      legacyOrdersByFront[String(front.id)] = ordersOfFront;
      for (const [polityId, orderOfFront] of Object.entries(ordersOfFront)) {
        const list = engagements.get(polityId) ?? [];
        list.push({ order: orderOfFront, weight: this.legacyPowerIn(front, polityId) });
        engagements.set(polityId, list);
      }
    }
    for (const [polityId, list] of engagements) {
      legacyConsumptionFactors[polityId] =
        legacyWarConsumptionFactor({ engagements: list, nationalPower: national.get(polityId) || 0 }).factor;
    }
    return { legacyOrdersByFront, legacyConsumptionFactors };
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

    // P0-3: dopo che il teatro e gli stati dei fronti si sono assestati, ogni
    // reparto che non è più «sul» fronte viene sganciato (`frontId = null`).
    if (this.detachOutOfTheatre(snapshot.fronts, units, date)) dirty = true;

    if (dirty) store.saveFronts(snapshot.fronts, units);
    return { events, fronts: snapshot.fronts, units };
  }

  /** Fronti noti (con sincronizzazione: lettura e stato non divergono). */
  warFronts(): WarFrontState[] {
    return this.syncFronts().fronts;
  }

  /**
   * Parti di un fronte: reparti per lato, rifornimenti reali e supporto legacy.
   *
   * P0-A — **quale** rifornimento entra nella battaglia. Se il tick materiale
   * ha già misurato la copertura del periodo (`MaterialTick.fulfillment`), il
   * fronte legge **quella**: è la quota del fabbisogno del periodo realmente
   * soddisfatta dal material engine, con la stessa disponibilità che ha usato
   * lui (produzione inclusa, prelievi esclusi). Leggere lo stock **dopo** il
   * tick era sbagliato: un reparto con scorte esattamente pari al fabbisogno
   * pagava tutto e veniva poi misurato a zero (copertura 0% invece di 100%).
   *
   * Il ripiego (`supplyCoverage` sullo stock corrente) resta per i percorsi che
   * **non** hanno un periodo materiale: l'anteprima di un ordine e il battito
   * live da 7 giorni. È un ripiego dichiarato, non la semantica del tick.
   */
  private sides(
    front: WarFrontState, units: readonly MilitaryUnitState[], stepDays: number,
    supplyByPolity?: Record<string, MaterialFulfillment>,
  ) {
    const theatreRegions = this.theatreRegions(front);
    // P0-3/P0-B, difesa in profondità: anche se un `frontId` sbagliato arrivasse
    // da una riga persistita vecchia, un reparto combatte solo se è **davvero**
    // nel teatro del fronte — la regola condivisa `unitIsActiveOnFront`.
    const of = (polityId: string) => units.filter(unit => this.unitPolityId(unit) === polityId
      && unitIsActiveOnFront({ unit, front, unitPolityId: polityId }));
    const stage = (polityId: string, isPlayer: boolean) => {
      const list = of(polityId);
      let stock: ResourceStock | null = null;
      try {
        stock = this.ctx.resourceStock(polityId);
      } catch {
        stock = null;
      }
      const measured = supplyByPolity?.[String(polityId)];
      const supply: SideSupply = measured
        ? { food: clamp01(measured.food), fuel: clamp01(measured.fuel), weapons: clamp01(measured.weapons) }
        : supplyCoverage({
          stock: { food: stock?.food ?? 0, fuel: stock?.fuel ?? 0, weapons: stock?.weapons ?? 0 },
          units: list,
          stepDays,
        });
      const legacyPower = this.legacyPowerIn(front, polityId);
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

  /** Giorni minimi **fuori dal fronte** prima che un reparto in ritirata rientri. */
  static readonly RALLY_DAYS = 30;

  /**
   * PR3 — **recupero** dei reparti in ritirata (rally). Un reparto che ha perso
   * il fronte e si è ripiegato in territorio amico non resta `retreating` per
   * sempre: dopo almeno `RALLY_DAYS` giorni **fuori dal fronte** torna
   * disponibile, con prontezza e stato **ricalcolati dai fatti**.
   *
   * Regole (deterministiche, nessun uomo creato dal nulla):
   * - solo `status = retreating` **senza** `frontId` (chi è ancora nel teatro
   *   segue le regole del fronte: prima il combattimento, poi il rally);
   * - solo in **territorio amico** (del paese giocatore o di un suo alleato);
   * - `personnel` ed `equipment` **invariati**: il rally non è una cura né una
   *   ricostituzione (per quello servono `reinforce`/`reequip` dal deposito);
   * - lo stato nuovo non è mai «operational» per decreto: esce da
   *   `unitStatusFromCoverage` (e resta `degraded` sotto la soglia organica);
   * - i `destroyed` non si rianimano **mai**.
   */
  private rallyRetreatingUnits(units: MilitaryUnitState[], date: string): { units: MilitaryUnitState[]; events: string[] } {
    const events: string[] = [];
    const regions = this.ctx.regions();
    const epoch = this.epoch();
    const menPerFormation = militaryManpower({ population: 0, formations: 1, mobilizedFormations: 0, epoch }).menPerFormation;
    const organic = menPerFormation * DEPLETED_ORGANIC_RATIO;
    const requiredRifles = rifleRequirement(epoch, 1);
    const friendly = (regionId: string | null | undefined): boolean => {
      const region = regionId ? regions.get(String(regionId)) : undefined;
      const owner = String(region?.owner || '');
      if (!owner || owner === 'neutral') return false;
      if (owner === String(this.ctx.playerPolityId())) return true;
      return this.ctx.relationship(owner, this.ctx.playerPolityId()) === 'ally';
    };
    const next = units.map(unit => {
      if (unit.status !== 'retreating' || unit.frontId) return unit;
      if (!friendly(unit.regionId)) return unit;
      if (daysBetween(unit.updatedDate, date) < WarFrontService.RALLY_DAYS) return unit;
      const personnel = Math.max(0, Math.round(Number(unit.personnel) || 0));
      if (personnel <= 0) return unit;
      const equipment = unit.equipment || {};
      const assigned = equipmentQuantity(equipment, rifleEquipmentId());
      const covered = unitStatusFromCoverage({ assigned, required: requiredRifles });
      const status: MilitaryUnitState['status'] = personnel < organic ? 'degraded' : covered;
      const readiness = unitReadiness({ unit: { personnel, equipment, status }, epoch });
      events.push(`🎖️ «${unit.name}» rientra in linea: reparto di nuovo ${status === 'operational' ? 'operativo' : 'inquadrato'} dopo il ripiegamento (uomini e pezzi invariati).`);
      return { ...unit, status, readiness, updatedDate: date };
    });
    return { units: next, events };
  }

  /**
   * Un **periodo** di guerra per ogni fronte aperto: rifornimenti reali, perdite
   * reali sui reparti, ritirata in una provincia amica, conquista solo con
   * sfondamento. Restituisce i dispacci deterministici (nessuna LLM).
   */
  advanceFronts(days: number, dateOverride?: string, options?: FrontTickOptions): FrontTickReport {
    const stepDays = Math.max(0, Math.floor(nonNegative(days)));
    const events: string[] = [];
    if (stepDays <= 0) return { events, fronts: 0, conquests: [] };
    // Copertura del periodo misurata dal tick materiale **prima** di questo
    // tick: è il fatto del periodo, non una deduzione sulle scorte residue.
    const supplyByPolity = options?.supply;
    // Una chiamata è un nuovo periodo: sostituisce **tutta** la cache, non
    // aggiunge alla precedente. Anche se non esistono più reparti persistenti
    // (o AUT non attraversa questo tick), un vecchio «1» non può diventare una
    // supply corrente: `sides()` ricade allora sul fallback dichiarato.
    this.periodCoverage = new Map(Object.entries(supplyByPolity || {})
      .map(([polityId, coverage]) => [String(polityId), coverage] as const));
    if (!this.hasPersistentMilitary()) return { events, fronts: 0, conquests: [] };
    // Lo stato del fronte è già assestato (`syncFronts()` gira **prima** del
    // periodo materiale: P0-B). Questa chiamata è idempotente e copre i percorsi
    // che non passano dal tick materiale (battito live, playback).
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
      const sides = this.sides(front, units, stepDays, supplyByPolity);
      // Policy NPC: la parte non giocante sceglie con la **stessa** formula, in
      // modo deterministico. Il giocatore sceglie dal pannello del reparto.
      const pre = {
        attacker: frontSideStrength({ units: sides.attacker.units, epoch, supply: sides.attacker.supply, motorized: sides.attacker.motorized, legacyPower: sides.attacker.legacyPower }),
        defender: frontSideStrength({ units: sides.defender.units, epoch, supply: sides.defender.supply, motorized: sides.defender.motorized, legacyPower: sides.defender.legacyPower }),
      };
      // P0-D: se il piano del periodo è stato fornito (`planPeriod`, prima del
      // fabbisogno), vale **quello**: costo, pressione e perdite dello stesso
      // periodo parlano dello stesso ordine. Senza piano (battito live,
      // playback legacy) si ricade sulla policy corrente. Il player resta
      // escluso: il suo ordine lo sceglie dal pannello del reparto.
      // INVARIANTE: nessun ordine **nazionale** decide il combattimento. Si legge
      // l'ordine di **questo** fronte e di questa polity (poi, solo per
      // compatibilità, quello per sola polity); l'ultimo ripiego è la policy
      // corrente, per i percorsi senza periodo materiale (live, preview,
      // playback). È l'unico punto in cui un ordine pianificato entra nel fronte.
      const plannedOrder = (polityId: string, isPlayer: boolean): UnitOrder | undefined => {
        if (isPlayer) return undefined;
        const value = options?.legacyOrdersByFront?.[String(front.id)]?.[String(polityId)]
          ?? (options?.legacyOrders || {})[String(polityId)];
        return value && String(value) in UNIT_ORDER_INFO ? value : undefined;
      };
      const npcOrder = {
        attacker: plannedOrder(front.attackerPolityId, sides.attacker.isPlayer)
          ?? npcFrontOrder({ ownPressure: pre.attacker.pressure, enemyPressure: pre.defender.pressure }),
        defender: plannedOrder(front.defenderPolityId, sides.defender.isPlayer)
          ?? npcFrontOrder({ ownPressure: pre.defender.pressure, enemyPressure: pre.attacker.pressure }),
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
      const live = this.sides(front, units, stepDays, supplyByPolity);
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

      // 1) Consumi di guerra: NON si sottraggono qui.
      //
      // MILITARY/WARFRONT INTEGRITY P0-2 — il tick materiale consuma già i
      // `unit.monthlyNeeds` moltiplicati per il coefficiente dell'ordine
      // (`OperationalStateStore.militaryNeeds()` → `materialFlow()` →
      // `advanceStock`): sottrarre di nuovo `resolution.consumption` qui era un
      // **doppio consumo** (attacco = base + 1,8× = 2,8× invece di 1,8×).
      // `warConsumption()` resta la lettura del consumo (fatti del fronte,
      // rifornimenti, `supplyCoverage`), ma l'unico punto che sottrae è
      // `advanceStock`.

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
          // Si ripiega **via** dal fronte: né il teatro conteso, né l'obiettivo
          // dell'attaccante storico, né la provincia appena persa.
          avoid: [
            ...front.regionIds,
            String(front.objectiveRegionId || ''),
            String(resolution.advance?.objectiveRegionId || ''),
          ],
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

      // 4) Conquista: **una sola** authority (`transferRegion`) e una sola via,
      // valida nelle due direzioni. Il motore ha deciso **chi** avanza
      // (`advance.side`): l'attaccante storico o il difensore che contrattacca.
      // Il ruolo storico non decide l'iniziativa, quindi qui non si guarda
      // `front.attackerPolityId`: si guarda il fatto del periodo.
      if (resolution.advance) {
        const advance = resolution.advance;
        const region = regions.get(String(advance.objectiveRegionId));
        // Difesa in profondità: la provincia deve essere **ancora** di chi si
        // ritira (se nel frattempo è cambiata, non si trasferisce nulla).
        if (region && String(region.owner) === String(advance.retreatingPolityId)) {
          const from = this.ctx.polityLabel(advance.retreatingPolityId);
          this.ctx.transferRegion(region, advance.advancingPolityId, this.ctx.regionColorOf(advance.advancingPolityId));
          const verb = advance.side === 'defender' ? 'contrattacca e conquista' : 'conquista';
          const headline = `${this.ctx.polityLabel(advance.advancingPolityId)} ${verb} ${region.name} (era ${from}): il ${front.name} ha sfondato.`;
          conquests.push(headline);
          events.push(`🚩 ${headline}`);
          this.ctx.note(`🚩 ${headline}`);
          // Il teatro lo ricostruisce `syncFronts()` al periodo successivo (dal
          // nuovo confine): qui non si tocca a mano né `regionIds` né l'obiettivo.
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
        // Read model: chi ha l'iniziativa nel periodo (nessun effetto sul gioco).
        momentumPolityId: resolution.attackerPressure === resolution.defenderPressure
          ? null
          : resolution.attackerPressure > resolution.defenderPressure
            ? front.attackerPolityId
            : front.defenderPolityId,
        updatedDate: date,
      });
      touched = true;
      const losses = resolution.outcomes.reduce((total, outcome) => total + outcome.personnelLost, 0);
      const equipmentLost = resolution.outcomes.reduce((total, outcome) => total + outcome.equipmentLost, 0);
      if (losses > 0 || equipmentLost > 0 || resolution.status !== 'active') {
        // Il dispaccio dice **chi** è in difficoltà: "collassato" da solo era
        // ambiguo appena il difensore ha potuto contrattaccare (PR3).
        const collapsed = resolution.collapsedSide
          ? ` (${this.ctx.polityLabel(resolution.collapsedSide === 'attacker' ? front.attackerPolityId : front.defenderPolityId)} non tiene più il fronte)`
          : '';
        events.push(`⚔️ ${front.name}: ${FRONT_STATUS_LABEL[resolution.status].toLowerCase()}${collapsed} — ${losses.toLocaleString('it-IT')} uomini e ${equipmentLost.toLocaleString('it-IT')} pezzi perduti in ${stepDays} giorni (pressione ${round1(resolution.attackerPressure * 100)} contro ${round1(resolution.defenderPressure * 100)}).`);
      }
    }

    // PR3 — recupero dei reparti in ritirata: dopo il combattimento (chi è
    // ancora nel teatro segue le regole del fronte) e nello **stesso** tick in
    // cui si scrive, così il rally non è una seconda passata.
    const rallied = this.rallyRetreatingUnits(units, date);
    units = rallied.units;
    events.push(...rallied.events);

    // Scrittura solo se qualcosa e' cambiato davvero: un tick senza battaglia non
    // deve riscrivere reparti (ne' gli oggetti-armata della mappa).
    const unitsChanged = JSON.stringify(units) !== JSON.stringify(snapshot.units);
    if (touched || unitsChanged) store.saveFronts(fronts, unitsChanged ? units : undefined);
    return { events, fronts: fronts.filter(front => front.status !== 'closed').length, conquests };
  }
}

export default WarFrontService;
