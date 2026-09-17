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
  /** Degrada la relazione (matrix.degrade): apre il conflitto fra due politie. */
  degradeRelationship?: (from: string, to: string) => void;
}

export class NpcTurnService {
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
   * Apply random events (15% chance)
   */
  applyRandomEvents(): string[] {
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
