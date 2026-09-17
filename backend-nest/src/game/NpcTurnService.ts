/**
 * World Story — NpcTurnService
 * ============================
 * Turni delle nazioni non giocanti e eventi casuali, estratti da
 * `game-session.ts` (Fase 1). Possiede il cursore round-robin (`npcCursor`) e
 * l'insieme delle politie con una chiamata NPC in volo (`npcInFlight`).
 *
 * Le regioni sono mutate IN PLACE sulla Map viva; le conquiste passano dal
 * callback `transferRegion` di `GameSession`.
 */

import { withinDeadline } from '../core/simulation/deadline';
import { canNpcCapture, indexPolities, npcRepresentatives } from '../core/simulation/npc-policy';
import { stableRoll } from '../core/simulation/MilitaryProduction';
import { RegionResolver } from '../utils/name-resolver';
import { polityDisplayNameIt } from '../utils/country-facts';
import { countryRepository } from '../repositories/country.repository';
import type { RegionState, TurnResultRecord } from '../game-session';

export interface NpcTurnContext {
  regions(): Map<string, RegionState>;
  playerPolityId(): string;
  currentTurn(): number;
  results(): TurnResultRecord[];
  /** Controller del gioco: fornisce le nazioni NPC e il turno per una di esse. */
  gameController: {
    getNPCCountries(): any;
    processNPCTurn(regionId: string, context: any): Promise<any>;
  };
  relationship(from: string, to: string): string;
  transferRegion(region: RegionState, owner: string, color?: string): void;
  /** Identificativo stabile della partita: seme del PRNG dei conflitti. */
  seed?: () => string;
  /** Nome pubblico di una polity (eventi causali, GAMEPLAY-LONG). */
  publicPolityName?(polityId: string): string;
  /** Potenza militare effettiva di una polity (eventi causali, GAMEPLAY-LONG). */
  nationalMilitaryPower?(polityId: string): number;
  /** Degrada la relazione (matrix.degrade): apre il conflitto fra due politie. */
  degradeRelationship?: (from: string, to: string) => void;
}

export class NpcTurnService {
  /** Turni minimi fra due registrazioni della stessa condizione sistemica. */
  static readonly CAUSAL_EVENT_COOLDOWN_TURNS = 4;

  /** Ultimo turno in cui una condizione sistemica è stata registrata. */
  private causalEventLog = new Map<string, number>();

  private static readonly TURN_NPC_LIMIT = 3;
  private static readonly NPC_TURN_TIMEOUT_MS = 12_000;

  /** Probabilità (per tick) che il mondo apra una nuova guerra fra NPC. */
  private static readonly WAR_OPEN_CHANCE = 0.05;
  /** Probabilità (per tick) che un conflitto reale produca una conquista. */
  private static readonly CONQUEST_CHANCE = 0.08;
  /** Vantaggio militare minimo per aprire un nuovo conflitto. */
  private static readonly WAR_OPEN_ADVANTAGE = 1.4;

  private npcCursor = 0;
  private readonly npcInFlight = new Set<string>();

  constructor(private readonly ctx: NpcTurnContext) {}

  /** Nome leggibile della polity: dal contesto se disponibile, altrimenti il codice. */
  private polityLabel(polityId: string): string {
    return this.ctx.publicPolityName?.(polityId) || polityId;
  }

  async processNPCTurns(limit = NpcTurnService.TURN_NPC_LIMIT, days = 30): Promise<string[]> {
    const npcEvents: string[] = [];
    const allNpcRegionIds = npcRepresentatives(this.ctx.gameController.getNPCCountries(), this.ctx.regions(), this.ctx.playerPolityId())
      .filter(id => !this.npcInFlight.has(this.ctx.regions().get(id)!.owner));
    const { owned, frontier } = indexPolities(this.ctx.regions());

    // Round-robin: con un limite, processa solo un sottoinsieme rotante di
    // paesi NPC (usato dalla simulazione live per limitare il costo LLM).
    let npcRegionIds = allNpcRegionIds;
    if (Number.isFinite(limit) && limit < allNpcRegionIds.length) {
      const n = allNpcRegionIds.length;
      npcRegionIds = [];
      for (let i = 0; i < limit; i++) {
        npcRegionIds.push(allNpcRegionIds[(this.npcCursor + i) % n]);
      }
      this.npcCursor = (this.npcCursor + limit) % n;
    }

    const regionResolver = new RegionResolver(Array.from(this.ctx.regions().values()));
    const scheduledOwners = new Map(npcRegionIds.map(id => [id, this.ctx.regions().get(id)!.owner]));

    for (const npcRegionId of npcRegionIds) {
      const npcRegion = this.ctx.regions().get(npcRegionId);
      if (!npcRegion) continue;

      const owner = npcRegion.owner;
      if (owner !== scheduledOwners.get(npcRegionId) || owner === this.ctx.playerPolityId() || this.npcInFlight.has(owner)) continue;
      // Representatives may have been conquered earlier in this batch.
      const nationalRegions = (owned.get(owner) || []).filter(r => r.owner === owner);
      const frontierIds = frontier.get(owner) || new Set<string>();
      const neighbors = [...frontierIds].map(id => this.ctx.regions().get(id)!)
        .filter(r => r.owner !== owner && r.status !== 'destroyed')
        .slice(0, 24).map(r => ({
          id: r.id, name: r.name, owner: r.owner,
          militaryPower: r.militaryPower, gdp: r.gdp,
          relationship: this.ctx.relationship(owner, r.owner),
        }));
      const sum = (key: 'population' | 'gdp' | 'militaryPower') =>
        nationalRegions.reduce((total, region) => total + region[key], 0);
      const npcContext = {
        polityId: owner,
        polityName: polityDisplayNameIt(owner, countryRepository.findByCode(owner)?.name),
        turn: this.ctx.currentTurn(),
        population: sum('population'), gdp: sum('gdp'), militaryPower: sum('militaryPower'),
        neighbors,
        recentEvents: this.ctx.results().slice(-3).map(r => r.narration.slice(0, 600)),
      };

      try {
        // Un singolo provider NPC indisponibile non può trattenere il lock del
        // gioco: allo scadere continuiamo con la prossima politia/tick.
        this.npcInFlight.add(owner);
        const request = this.ctx.gameController.processNPCTurn(npcRegionId, npcContext)
          .finally(() => this.npcInFlight.delete(owner));
        const npcAction = await withinDeadline(request, NpcTurnService.NPC_TURN_TIMEOUT_MS);
        if (npcAction) {
          // Publish only accepted effects. Unsupported proposals must not
          // appear as completed alliances/trade deals in the world memory.
          if (npcAction.type === 'develop') {
            for (const region of nationalRegions) {
              region.gdp *= Math.pow(1.05, days / 365);
              region.militaryPower *= Math.pow(1.03, days / 365);
            }
            npcEvents.push(`${npcContext.polityName} attua misure di sviluppo interno`);
          } else if (npcAction.type === 'war' && npcAction.targetRegionId) {
            // LLM может вернуть как id, так и ИМЯ региона — резолвим оба варианта
            const resolved = this.ctx.regions().get(npcAction.targetRegionId)
              || regionResolver.resolve(npcAction.targetRegionId);
            const targetRegion = resolved ? this.ctx.regions().get(resolved.id) : undefined;
            // Re-check the live border after earlier captures in the batch.
            const liveFrontier = new Set(nationalRegions.flatMap(r => r.borders || []));
            if (targetRegion && (targetRegion.borders || []).some(id => this.ctx.regions().get(id)?.owner === owner)) {
              liveFrontier.add(targetRegion.id);
            }
            const attackingPower = nationalRegions
              .filter(r => (r.borders || []).includes(targetRegion?.id || '') || (targetRegion?.borders || []).includes(r.id))
              .reduce((total, r) => total + r.militaryPower, 0);
            if (canNpcCapture(owner, targetRegion, liveFrontier,
              targetRegion ? this.ctx.relationship(owner, targetRegion.owner) : 'neutral')
              && targetRegion.militaryPower < attackingPower * 0.7) {
              this.ctx.transferRegion(targetRegion, owner, npcRegion.color);
              npcEvents.push(`${npcContext.polityName} conquista ${targetRegion.name}`);
            }
          }
        } else {
          console.warn(`[NpcTurnService] NPC ${npcRegion.name}: nessuna risposta entro ${NpcTurnService.NPC_TURN_TIMEOUT_MS / 1000}s`);
        }
      } catch (e) {
        console.error(`NPC turn error for ${npcRegionId}:`, e);
      }
    }

    return npcEvents;
  }

  /**
   * WORLD-ALIVE P3 — battito deterministico dei conflitti del mondo.
   * =================================================================
   * Il mondo vive anche senza ordini del giocatore e senza attendere la LLM:
   *
   *  1. **Escalation** — al più una nuova guerra per tick, solo fra politie
   *     NPC, quando il rapporto è `neutral`, l'attaccante ha un vantaggio
   *     militare reale e il tiro deterministico passa. Usa
   *     `degradeRelationship` (matrix.degrade già esistente);
   *  2. **Continuazione** — al più una conquista per tick, su un conflitto
   *     realmente `hostile` e su un confine reale, con le stesse politiche del
   *     percorso LLM (`canNpcCapture` + rapporto di forze) e lo stesso
   *     `transferRegion`.
   *
   * Tutto è **deterministico** per partita e turno (`stableRoll`), quindi
   * riproducibile e verificabile: nessun `Math.random`, nessun nuovo motore.
   * Non modifica `core/simulation`: ne usa solo le funzioni pure esportate.
   */
  processWorldConflictTick(days = 7): string[] {
    const events: string[] = [];
    const regions = this.ctx.regions();
    const player = this.ctx.playerPolityId();
    const { owned, frontier } = indexPolities(regions);

    // Coppie confinanti fra politie reali, ordinate per determinismo.
    type Candidate = { attacker: string; defender: string; targetId: string; target: RegionState };
    const candidates: Candidate[] = [];
    for (const attacker of [...frontier.keys()].sort()) {
      if (attacker === player || attacker === 'neutral') continue;
      for (const targetId of [...(frontier.get(attacker) || [])].sort()) {
        const target = regions.get(targetId);
        if (!target || target.status === 'destroyed' || !target.owner || target.owner === attacker) continue;
        candidates.push({ attacker, defender: target.owner, targetId, target });
      }
    }
    if (candidates.length === 0) return events;

    const seed = this.ctx.seed?.() ?? 'world';
    const turn = this.ctx.currentTurn();
    const power = (owner: string) => (owned.get(owner) || []).reduce((total, region) => total + region.militaryPower, 0);

    // 1) Escalation — una sola apertura per tick, NPC contro NPC.
    if (this.ctx.degradeRelationship
      && stableRoll(`${seed}|war-open|${turn}`) < NpcTurnService.WAR_OPEN_CHANCE) {
      const opening = candidates
        .filter(c => c.defender !== player && this.ctx.relationship(c.attacker, c.defender) === 'neutral')
        .filter(c => power(c.attacker) > power(c.defender) * NpcTurnService.WAR_OPEN_ADVANTAGE)
        .sort((a, b) => power(b.attacker) / Math.max(1, power(b.defender)) - power(a.attacker) / Math.max(1, power(a.defender)))[0];
      if (opening) {
        this.ctx.degradeRelationship(opening.attacker, opening.defender);
        events.push(`${this.polityName(opening.attacker)} rompe gli indugi e dichiara guerra a ${this.polityName(opening.defender)}`);
      }
    }

    // 2) Continuazione — una sola conquista per tick, su un fronte reale.
    if (stableRoll(`${seed}|conquest|${turn}`) < NpcTurnService.CONQUEST_CHANCE) {
      for (const c of candidates) {
        if (this.ctx.relationship(c.attacker, c.defender) !== 'hostile') continue;
        const liveFrontier = new Set((owned.get(c.attacker) || []).flatMap(region => region.borders || []));
        if (!canNpcCapture(c.attacker, c.target, liveFrontier, 'hostile')) continue;
        const attackingPower = (owned.get(c.attacker) || [])
          .filter(region => (region.borders || []).includes(c.targetId) || (c.target.borders || []).includes(region.id))
          .reduce((total, region) => total + region.militaryPower, 0);
        if (c.target.militaryPower >= attackingPower * 0.7) continue;
        const representative = (owned.get(c.attacker) || [])[0];
        this.ctx.transferRegion(c.target, c.attacker, representative?.color);
        events.push(`${this.polityName(c.attacker)} conquista ${c.target.name}`);
        break;
      }
    }

    return events;
  }

  private polityName(polityId: string): string {
    return polityDisplayNameIt(polityId, countryRepository.findByCode(polityId)?.name);
  }

  /**
   * Eventi del mondo senza ordini del giocatore (GAMEPLAY-LONG).
   *
   * Prima **causa**, poi rumore: un evento nasce dallo stato reale (carestia
   * dove il PIL per abitante è insufficiente, sforzo militare insostenibile,
   * escalation fra confinanti ostili, tensioni territoriali, innovazione dove
   * c'è ricchezza diffusa). Solo se lo stato non offre alcuna causa si ricade
   * sull'evento casuale legacy, che resta **rumore secondario**: non è più il
   * motore della storia.
   */
  applyRandomEvents(): string[] {
    const causal = this.stateDrivenEvents();
    if (causal.length > 0) return causal;
    return this.randomWorldEvent();
  }

  /**
   * Cause sistemiche e **di sola lettura**: nessun dado e nessuna mutazione.
   * Le cifre le muove già il motore (`WorldStateEngine`, economia, conflitti);
   * qui si registra ciò che quello stato significa, così il narratore non deve
   * inventare. Ripetizione evitata con un tempo di raffreddamento in turni.
   */
  private stateDrivenEvents(): string[] {
    const conditions = this.stateConditions();
    const turn = this.ctx.currentTurn();
    const due = conditions.filter(condition => {
      const last = this.causalEventLog.get(condition.key);
      return last === undefined || turn - last >= NpcTurnService.CAUSAL_EVENT_COOLDOWN_TURNS;
    });
    for (const condition of due) this.causalEventLog.set(condition.key, turn);
    // Al massimo due fatti per battito: il dispaccio resta leggibile.
    return due.slice(0, 2).map(condition => condition.text);
  }

  /** Condizioni sistemiche osservate sullo stato, in ordine di gravità. */
  private stateConditions(): { key: string; text: string }[] {
    const conditions: { key: string; text: string }[] = [];
    const byOwner = new Map<string, RegionState[]>();
    for (const region of this.ctx.regions().values()) {
      if (!region.owner || region.owner === 'neutral') continue;
      const list = byOwner.get(region.owner) ?? [];
      list.push(region);
      byOwner.set(region.owner, list);
    }
    const owners = [...byOwner.keys()].sort();
    const totals = (regions: RegionState[]) => ({
      population: regions.reduce((sum, r) => sum + (r.population || 0), 0),
      gdp: regions.reduce((sum, r) => sum + (r.gdp || 0), 0),
      military: regions.reduce((sum, r) => sum + (r.militaryPower || 0), 0),
    });

    // 1. Carestia: il PIL per abitante non basta a sfamare la nazione.
    for (const owner of owners) {
      const regions = byOwner.get(owner)!;
      const { population, gdp } = totals(regions);
      if (population <= 0 || gdp / population >= 0.6) continue;
      conditions.push({
        key: `famine:${owner}`,
        text: `Carestia in ${this.polityLabel(owner)}: la popolazione è allo stremo e i prezzi salgono`,
      });
      break;
    }

    // 2. Sforzo militare insostenibile: la spesa militare mangia il PIL.
    for (const owner of owners) {
      const regions = byOwner.get(owner)!;
      const { gdp, military } = totals(regions);
      if (gdp <= 0 || military / gdp <= 1.2) continue;
      conditions.push({
        key: `militarization:${owner}`,
        text: `${this.polityLabel(owner)}: lo sforzo militare pesa sulle casse, tagli alle spese civili`,
      });
      break;
    }

    // 3. Escalation fra confinanti ostili con forte squilibrio di forze.
    for (const owner of owners) {
      const regions = byOwner.get(owner)!;
      const ownPower = totals(regions).military;
      for (const borderId of regions.flatMap(region => region.borders || [])) {
        const neighbour = this.ctx.regions().get(borderId);
        if (!neighbour?.owner || neighbour.owner === 'neutral' || neighbour.owner === owner) continue;
        if (this.ctx.relationship(owner, neighbour.owner) !== 'hostile') continue;
        const otherPower = this.ctx.nationalMilitaryPower?.(neighbour.owner) ?? 0;
        if (otherPower <= 0 || ownPower < otherPower * 1.25) continue;
        conditions.push({
          key: `escalation:${owner}:${neighbour.owner}`,
          text: `Manovre al confine fra ${this.polityLabel(owner)} e ${this.polityLabel(neighbour.owner)}: le forze si schierano`,
        });
        break;
      }
    }

    // 4. Tensioni territoriali: molte province e poca ricchezza per abitarle.
    for (const owner of owners) {
      const regions = byOwner.get(owner)!;
      const { population, gdp } = totals(regions);
      if (regions.length < 5 || population <= 0 || gdp / population >= 1.2) continue;
      conditions.push({
        key: `territorial:${owner}`,
        text: `Tensioni provinciali in ${this.polityLabel(owner)}: presidi e richieste locali`,
      });
      break;
    }

    // 5. Innovazione: dove c'è ricchezza diffusa e nessuna ostilità aperta.
    for (const owner of owners) {
      const regions = byOwner.get(owner)!;
      const { population, gdp } = totals(regions);
      if (population <= 0 || gdp / population < 2.5) continue;
      if (this.hasHostileRelationship(owner, byOwner)) continue;
      conditions.push({
        key: `innovation:${owner}`,
        text: `Innovazione in ${this.polityLabel(owner)}: la produzione cresce`,
      });
      break;
    }

    return conditions;
  }

  /** Esiste una relazione ostile registrata fra questa polity e un vicino? */
  private hasHostileRelationship(owner: string, byOwner: Map<string, RegionState[]>): boolean {
    for (const region of byOwner.get(owner) ?? []) {
      for (const borderId of region.borders || []) {
        const neighbourOwner = this.ctx.regions().get(borderId)?.owner;
        if (!neighbourOwner || neighbourOwner === 'neutral' || neighbourOwner === owner) continue;
        if (this.ctx.relationship(owner, neighbourOwner) === 'hostile') return true;
      }
    }
    return false;
  }

  /**
   * Evento casuale legacy (15%): rumore secondario, usato solo quando lo stato
   * del mondo non offre alcuna causa sistemica.
   */
  private randomWorldEvent(): string[] {
    const randomEvents: string[] = [];

    if (Math.random() < 0.15) {
      const eventTypes = [
        { name: 'Disastro naturale', effects: ['terremoto', 'alluvione', 'siccità', 'uragano'] },
        { name: 'Crisi economica', effects: ['recessione', 'inflazione', 'carestia'] },
        { name: 'Progresso tecnologico', effects: ['invenzione', 'scoperta', 'innovazione'] },
        { name: 'Disordini sociali', effects: ['protesthe', 'sciopero generale', 'rivolta'] },
        { name: 'Epidemia', effects: ['peste', 'influenza', 'virus'] },
      ];

      const event = eventTypes[Math.floor(Math.random() * eventTypes.length)];
      const effect = event.effects[Math.floor(Math.random() * event.effects.length)];
      const regionsArray = Array.from(this.ctx.regions().values()).filter(r => r.status !== 'destroyed');
      if (regionsArray.length === 0) return [];
      const targetRegion = regionsArray[Math.floor(Math.random() * regionsArray.length)];

      const eventText = `${effect.charAt(0).toUpperCase() + effect.slice(1)} colpisce ${targetRegion.name}`;
      randomEvents.push(eventText);

      // Apply effects
      if (event.name === 'Disastro naturale') {
        targetRegion.population = Math.floor(targetRegion.population * 0.95);
        targetRegion.gdp *= 0.9;
      } else if (event.name === 'Crisi economica') {
        targetRegion.gdp *= 0.85;
      } else if (event.name === 'Progresso tecnologico') {
        targetRegion.gdp *= 1.15;
        targetRegion.militaryPower *= 1.1;
      } else if (event.name === 'Disordini sociali') {
        targetRegion.militaryPower *= 0.9;
      } else if (event.name === 'Epidemia') {
        targetRegion.population = Math.floor(targetRegion.population * 0.9);
        targetRegion.militaryPower *= 0.85;
      }
    }

    return randomEvents;
  }

}
