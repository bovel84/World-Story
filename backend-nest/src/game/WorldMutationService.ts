/**
 * World Story — WorldMutationService
 * ==================================
 * Applicazione deterministica delle modifiche al mondo, estratta da
 * `game-session.ts` (Fase 1). Copre `applyMapChanges`, `applyUnitChange`,
 * `applyWorldChanges`, `applyFrontierPlacements` e `applyConquestAttrition`.
 *
 * Le regioni sono mutate IN PLACE sulla Map viva fornita da `GameSession`;
 * trasferimenti, conti e nota nazionale passano da callback.
 */

import { WorldStateEngine, type NationalAccount } from '../core/simulation/WorldStateEngine';
import { arsenalCombatFactor, combatAttrition } from '../core/simulation/MilitaryIndustry';
import { movementCost, payMovement, type ResourceStock } from '../core/simulation/MaterialEconomy';
import { validateStrictMapChanges, validateStrictWorldChanges } from '../core/simulation/EffectValidator';
import { exactMovementRegion, resolveMovementRegion, UNIT_TYPES, unitMatchesType, unitNameMatchesPrefix } from '../utils/movement-orders';
import { constructionProgressPatch } from '../utils/construction-progress';
import { normalizeName, type PolityResolver, type RegionResolver } from '../utils/name-resolver';
import { shortId } from '../utils/short-id';
import type { MapChange, SimulationEvent } from '../prompts/types';
import type { NationalEffect } from '../core/simulation/NationalEffects';
import type { GeoPoint } from './RegionGeometryService';
import type { RegionState, WorldChanges } from '../game-session';

export interface WorldMutationContext {
  regions(): Map<string, RegionState>;
  isStrictGame(): boolean;
  currentDate(): string;
  playerPolityId(): string;
  buildResolvers(): { regions: RegionResolver; polities: PolityResolver };
  worldStateOptions(): { modernFacts: boolean; startDate: string; taxRateByPolity?: Record<string, number> };
  transferRegion(region: RegionState, newOwner: string, explicitColor?: string): void;
  geometry: {
    frontierPosition(region: RegionState, targetPolityId: string): GeoPoint | null;
    regionCenter(region: RegionState): GeoPoint | null;
    resolveRegionFlexible(key: string | undefined, resolver: RegionResolver): RegionState | undefined;
  };
  applyNationalEffects(raw: unknown): { applied: NationalEffect[]; bulletins: string[] };
  pushNationalNote(note: string): void;
  mentionedNpcPolityIds(texts: string[]): string[];
  eventDetail(event: SimulationEvent): string;
  arsenalUnits(polityId: string): Record<string, number>;
  saveArsenal(polityId: string, units: Record<string, number>): void;
  resourceStock(polityId: string): ResourceStock;
  saveResourceStock(polityId: string, stock: ResourceStock): void;
}

export class WorldMutationService {
  constructor(private readonly ctx: WorldMutationContext) {}

  /**
   * Attrito di conquista: ogni volta che una provincia passa di mano tra due
   * nazioni reali, il vincitore consuma equipaggiamento e prontezza in
   * proporzione alla difesa incontrata. È il modo in cui l'arsenale materiale
   * pesa sulla guerra, indipendentemente dallo stato diplomatico registrato:
   * anche un'occupazione "pacifica" logora chi la esegue.
   */
  private applyConquestAttrition(
    region: RegionState, previousOwner: string, newOwner: string,
    accounts: Record<string, NationalAccount>,
  ): void {
    if (!previousOwner || previousOwner === newOwner) return;
    if (previousOwner === 'neutral' || newOwner === 'neutral') return;
    const defender = accounts[previousOwner];
    const winner = accounts[newOwner];
    const winnerBase = Math.max(0, Number(winner?.militaryPower || 0));
    const winnerFactor = arsenalCombatFactor(this.ctx.arsenalUnits(newOwner),
      Number(winner?.forces || 0) + Number(winner?.mobilized || 0));
    const effective = Math.max(1, winnerBase * winnerFactor);
    const defence = Math.max(0, region.militaryPower) + Math.max(0, Number(defender?.militaryPower || 0)) * 0.15;
    const intensity = Math.min(0.3, (defence / effective) * 0.18);
    if (intensity <= 0.005) return;
    const { units, lost } = combatAttrition(this.ctx.arsenalUnits(newOwner), intensity);
    if (lost > 0) {
      this.ctx.saveArsenal(newOwner, units);
      console.log(`[GameSession] Attrito di conquista: ${newOwner} perde ${lost} equipaggiamenti a ${region.name}.`);
    }
    region.militaryPower = Math.max(1, Math.round(region.militaryPower * (1 - Math.min(0.5, intensity * 1.5))));
  }

  /**
   * Apply world changes from simulation.
   * Keys могут быть как regionId (legacy), так и ИМЕНА регионов/политий —
   * резолвим оба варианта.
   */
  applyWorldChanges(changes: WorldChanges): void {
    if (this.ctx.isStrictGame()) validateStrictWorldChanges(changes);
    const resolvers = this.ctx.buildResolvers();

    if (changes.regionOwners) {
      // Attrito di conquista: conti calcolati una sola volta per il lotto.
      const accounts = this.ctx.isStrictGame() ? undefined : WorldStateEngine.accounts(this.ctx.regions().values(), this.ctx.worldStateOptions());
      for (const [regionKey, newOwner] of Object.entries(changes.regionOwners)) {
        const region = this.ctx.regions().get(regionKey) || resolvers.regions.resolve(regionKey);
        if (!region) {
          console.warn('[GameSession] worldChanges: region not found for key:', regionKey);
          continue;
        }
        const liveRegion = this.ctx.regions().get(region.id);
        if (!liveRegion) continue;

        const ownerResolution = resolvers.polities.resolve(newOwner);
        const ownerId = ownerResolution?.polityId || newOwner;
        const explicitColor = changes.regionColors?.[regionKey] || changes.regionColors?.[region.id];
        const previousOwner = liveRegion.owner;
        this.ctx.transferRegion(liveRegion, ownerId, explicitColor || resolvers.polities.colorOf(ownerId));
        if (accounts) this.applyConquestAttrition(liveRegion, previousOwner, ownerId, accounts);
      }
    }

    if (changes.regionGDP) {
      for (const [regionKey, gdp] of Object.entries(changes.regionGDP)) {
        const region = this.ctx.regions().get(regionKey) || resolvers.regions.resolve(regionKey);
        const liveRegion = region && this.ctx.regions().get(region.id);
        if (liveRegion && Number.isFinite(gdp) && gdp >= 0) liveRegion.gdp = gdp;
      }
    }

    if (changes.regionMilitary) {
      for (const [regionKey, military] of Object.entries(changes.regionMilitary)) {
        const region = this.ctx.regions().get(regionKey) || resolvers.regions.resolve(regionKey);
        const liveRegion = region && this.ctx.regions().get(region.id);
        if (liveRegion && Number.isFinite(military) && military >= 0) liveRegion.militaryPower = military;
      }
    }

    if (changes.regionPopulation) {
      for (const [regionKey, pop] of Object.entries(changes.regionPopulation)) {
        const region = this.ctx.regions().get(regionKey) || resolvers.regions.resolve(regionKey);
        const liveRegion = region && this.ctx.regions().get(region.id);
        if (liveRegion && Number.isFinite(pop) && pop >= 0) liveRegion.population = pop;
      }
    }

    if (changes.nationalEffects) {
      const { bulletins } = this.ctx.applyNationalEffects(changes.nationalEffects);
      for (const bulletin of bulletins) this.ctx.pushNationalNote(bulletin);
    }
  }

  /**
   * Materializza "di frontiera" come posizione, non solo come nome: se una
   * formazione creata o mobilitata si chiama o è descritta come di frontiera
   * verso una politia nominata, il marker viene spostato sul confine.
   */
  applyFrontierPlacements(
    event: SimulationEvent,
    changed: RegionState[],
    actionTexts: string[] = [],
  ): RegionState[] {
    if (changed.length === 0) return changed;
    const formationTypes = new Set(['mobilization', 'battalion', 'army', 'fleet', 'missile']);
    const texts = [event.headline || '', this.ctx.eventDetail(event) || '', ...actionTexts];
    const namedInEvent = this.ctx.mentionedNpcPolityIds(texts).filter(id => id !== this.ctx.playerPolityId());
    for (const region of changed) {
      if (!region.objects?.length) continue;
      for (const object of region.objects as any[]) {
        if (!formationTypes.has(object.type)) continue;
        const name = String(object.name || '');
        if (!/frontier|frontiera|di confine|confine|border/i.test(name)) continue;
        const direct = this.ctx.mentionedNpcPolityIds([name]).filter(id => id !== this.ctx.playerPolityId());
        const target = direct[0] || namedInEvent[0];
        if (!target) continue;
        const position = this.ctx.geometry.frontierPosition(region, target);
        if (!position) continue;
        object.lat = position.lat;
        object.lng = position.lng;
      }
    }
    return changed;
  }

  /**
   * Apply mapChanges from a single simulation event (transfer/create/update/delete).
   * Регионы и политии адресуются ИМЕНАМИ (так их видит LLM в описании карты).
   */
  applyMapChanges(mapChanges: MapChange[] | undefined, movedDate = this.ctx.currentDate()): RegionState[] {
    if (this.ctx.isStrictGame()) validateStrictMapChanges(mapChanges);
    if (!mapChanges || mapChanges.length === 0) return [];
    const resolvers = this.ctx.buildResolvers();
    const changed = new Map<string, RegionState>();
    // Attrito di conquista (solo legacy): i conti si calcolano una volta per lotto.
    let conquestAccounts: Record<string, NationalAccount> | null = null;
    const conquestAttrition = (region: RegionState, previousOwner: string, newOwner: string) => {
      if (this.ctx.isStrictGame() || previousOwner === newOwner) return;
      conquestAccounts ??= WorldStateEngine.accounts(this.ctx.regions().values(), this.ctx.worldStateOptions());
      this.applyConquestAttrition(region, previousOwner, newOwner, conquestAccounts);
    };
    const facilityTypes = new Set([
      'factory', 'port', 'university', 'base', 'airbase', 'naval_base',
      'fortification', 'radar', 'missile_site', 'infrastructure', 'power_plant',
    ]);
    const unitTypes = new Set(['battalion', 'army', 'fleet', 'missile']);
    const objectChangeTypes = new Set([
      'build_facility', 'start_construction', 'update_construction', 'complete_construction', 'cancel_construction',
      'start_mobilization', 'complete_mobilization', 'cancel_mobilization',
      'spawn_battalion', 'move_battalion', 'spawn_unit', 'move_unit', 'remove_unit',
    ]);
    const exactRegion = (key: string | undefined): RegionState | undefined =>
      exactMovementRegion([...this.ctx.regions().values()], key);
    const validFeatureName = (feature: MapChange['feature']): string | null => {
      if (!feature || typeof feature.name !== 'string' || !feature.name.trim()) return null;
      return feature.name.trim().slice(0, 160);
    };

    for (const change of mapChanges) {
      const regionKey = change.regionId || change.regionName;
      // Movement/removal can locate a unique unit even with an omitted or stale origin.
      if (change.type === 'move_unit' || change.type === 'move_battalion' || change.type === 'remove_unit') {
        for (const region of this.applyUnitChange(change, movedDate)) changed.set(region.id, region);
        continue;
      }
      // Oggetti e opere richiedono destinazioni reali. Mai interpretare
      // "random"/"coastal" come una provincia e collocare il marker a caso.
      const liveRegion = objectChangeTypes.has(change.type)
        ? exactRegion(regionKey)
        : this.ctx.geometry.resolveRegionFlexible(regionKey, resolvers.regions);
      if (!liveRegion) {
        console.warn('[GameSession] mapChange: region not resolved:', regionKey);
        continue;
      }
      let mutated = false;

      switch (change.type) {
        case 'transfer': {
          const ownerResolution = resolvers.polities.resolve(change.newOwner);
          if (!ownerResolution) break;
          const previous = `${liveRegion.owner}:${liveRegion.color}`;
          const previousOwner = liveRegion.owner;
          this.ctx.transferRegion(
            liveRegion,
            ownerResolution.polityId,
            change.newColor || resolvers.polities.colorOf(ownerResolution.polityId),
          );
          conquestAttrition(liveRegion, previousOwner, ownerResolution.polityId);
          mutated = `${liveRegion.owner}:${liveRegion.color}` !== previous;
          break;
        }
        case 'update': {
          // Un `update` con un nuovo proprietario è di fatto un passaggio
          // territoriale: lo trattiamo come tale, così la provincia occupata
          // prende il colore dell'occupante anche se il modello ha scelto il
          // tipo sbagliato.
          if (change.newOwner) {
            const ownerResolution = resolvers.polities.resolve(change.newOwner);
            if (ownerResolution) {
              const previous = `${liveRegion.owner}:${liveRegion.color}`;
              const previousOwner = liveRegion.owner;
              this.ctx.transferRegion(
                liveRegion,
                ownerResolution.polityId,
                change.newColor || resolvers.polities.colorOf(ownerResolution.polityId),
              );
              conquestAttrition(liveRegion, previousOwner, ownerResolution.polityId);
              mutated ||= `${liveRegion.owner}:${liveRegion.color}` !== previous;
            }
          } else if (change.newColor && change.newColor !== liveRegion.color) {
            liveRegion.color = change.newColor;
            mutated = true;
          }
          if (change.newName && change.newName !== liveRegion.name) {
            liveRegion.name = change.newName;
            mutated = true;
          }
          break;
        }
        case 'delete': {
          mutated = liveRegion.owner !== 'neutral' || liveRegion.color !== '#888888';
          liveRegion.owner = 'neutral';
          liveRegion.color = '#888888';
          break;
        }
        case 'create_polity':
        case 'create': {
          const ownerResolution = resolvers.polities.resolve(change.newOwner || change.newName);
          if (ownerResolution) {
            const previous = `${liveRegion.owner}:${liveRegion.color}`;
            this.ctx.transferRegion(
              liveRegion,
              ownerResolution.polityId,
              change.newColor || resolvers.polities.colorOf(ownerResolution.polityId),
            );
            mutated = `${liveRegion.owner}:${liveRegion.color}` !== previous;
          }
          break;
        }
        case 'start_construction': {
          const feature = change.feature;
          const name = validFeatureName(feature);
          if (!feature || !name || !facilityTypes.has(feature.type) || liveRegion.status === 'destroyed') break;
          liveRegion.objects ||= [];
          const duplicate = liveRegion.objects.some((object: any) =>
            normalizeName(object.name) === normalizeName(name)
            && (object.type === feature.type
              || (object.type === 'construction_site' && object.metadata?.plannedType === feature.type))
          );
          const center = this.ctx.geometry.regionCenter(liveRegion);
          if (duplicate || !center) break;
          liveRegion.objects.push({
            id: feature.id || shortId(),
            type: 'construction_site',
            name,
            level: 1,
            owner: liveRegion.owner,
            lat: center.lat,
            lng: center.lng,
            metadata: {
              ...constructionProgressPatch(feature.metadata),
              status: 'under_construction',
              plannedType: feature.type,
              startedDate: this.ctx.currentDate(),
            },
          });
          mutated = true;
          break;
        }
        case 'update_construction': {
          const feature = change.feature;
          if (!feature || liveRegion.status === 'destroyed') break;
          const name = validFeatureName(feature);
          const site = (liveRegion.objects || []).find((object: any) =>
            object.type === 'construction_site'
            && object.metadata?.plannedType === feature.type
            && (feature.id ? object.id === feature.id : !!name && normalizeName(object.name) === normalizeName(name)));
          if (!site) break; // Never create a missing site or alter an operational facility.
          const patch = constructionProgressPatch(feature.metadata);
          mutated = Object.entries(patch).some(([key, value]) => site.metadata?.[key] !== value);
          if (mutated) site.metadata = { ...site.metadata, ...patch, lastUpdatedDate: this.ctx.currentDate() };
          break;
        }
        case 'build_facility':
        case 'complete_construction': {
          const feature = change.feature;
          const name = validFeatureName(feature);
          if (!feature || !name || !facilityTypes.has(feature.type) || liveRegion.status === 'destroyed') break;
          liveRegion.objects ||= [];
          const existingFinal = liveRegion.objects.find((object: any) =>
            object.type === feature.type && normalizeName(object.name) === normalizeName(name));
          if (existingFinal) break;
          const siteIndex = liveRegion.objects.findIndex((object: any) =>
            object.type === 'construction_site'
            && ((feature.id && object.id === feature.id) || normalizeName(object.name) === normalizeName(name))
            && (!object.metadata?.plannedType || object.metadata.plannedType === feature.type));
          const center = this.ctx.geometry.regionCenter(liveRegion);
          if (!center) break;
          if (siteIndex >= 0) {
            const site = liveRegion.objects[siteIndex];
            liveRegion.objects[siteIndex] = {
              ...site,
              type: feature.type,
              name,
              owner: site.owner || liveRegion.owner,
              level: Math.max(1, Number(site.level) || 1),
              lat: site.lat ?? center.lat,
              lng: site.lng ?? center.lng,
              metadata: {
                ...(site.metadata || {}),
                ...(feature.metadata || {}),
                status: 'operational',
                phase: 'completed',
                blocker: '',
                nextStep: '',
                plannedType: undefined,
                completedDate: this.ctx.currentDate(),
              },
            };
          } else {
            // Compatibilità: un evento può attestare direttamente un'opera già
            // terminata senza che i turni storici avessero un marker cantiere.
            liveRegion.objects.push({
              id: feature.id || shortId(), type: feature.type, name, level: 1,
              owner: liveRegion.owner, lat: center.lat, lng: center.lng,
              metadata: { ...(feature.metadata || {}), status: 'operational', completedDate: this.ctx.currentDate() },
            });
          }
          mutated = true;
          break;
        }
        case 'cancel_construction': {
          const feature = change.feature;
          const name = validFeatureName(feature);
          if (!feature || (!feature.id && !name)) break;
          liveRegion.objects ||= [];
          const before = liveRegion.objects.length;
          liveRegion.objects = liveRegion.objects.filter((object: any) =>
            object.type !== 'construction_site'
            || (feature.id ? object.id !== feature.id : normalizeName(object.name) !== normalizeName(name || '')));
          mutated = liveRegion.objects.length !== before;
          break;
        }
        case 'start_mobilization': {
          const feature = change.feature;
          const name = validFeatureName(feature);
          if (!feature || !name || !unitTypes.has(feature.type) || liveRegion.status === 'destroyed') break;
          liveRegion.objects ||= [];
          const duplicate = liveRegion.objects.some((object: any) =>
            normalizeName(object.name) === normalizeName(name)
            && (object.type === feature.type
              || (object.type === 'mobilization' && object.metadata?.plannedType === feature.type))
          );
          const center = this.ctx.geometry.regionCenter(liveRegion);
          if (duplicate || !center) break;
          liveRegion.objects.push({
            id: feature.id || shortId(),
            type: 'mobilization',
            name,
            level: 1,
            owner: liveRegion.owner,
            lat: center.lat,
            lng: center.lng,
            metadata: {
              ...(feature.metadata || {}),
              status: 'forming',
              plannedType: feature.type,
              startedDate: this.ctx.currentDate(),
            },
          });
          mutated = true;
          break;
        }
        case 'complete_mobilization': {
          const feature = change.feature;
          const name = validFeatureName(feature);
          if (!feature || !name || !unitTypes.has(feature.type) || liveRegion.status === 'destroyed') break;
          liveRegion.objects ||= [];
          if (liveRegion.objects.some((object: any) => object.type === feature.type
              && normalizeName(object.name) === normalizeName(name))) break;
          const mobilizationIndex = liveRegion.objects.findIndex((object: any) =>
            object.type === 'mobilization'
            && ((feature.id && object.id === feature.id) || normalizeName(object.name) === normalizeName(name))
            && (!object.metadata?.plannedType || object.metadata.plannedType === feature.type));
          const center = this.ctx.geometry.regionCenter(liveRegion);
          if (!center) break;
          if (mobilizationIndex >= 0) {
            const mobilization = liveRegion.objects[mobilizationIndex];
            liveRegion.objects[mobilizationIndex] = {
              ...mobilization,
              type: feature.type,
              name,
              owner: mobilization.owner || liveRegion.owner,
              lat: mobilization.lat ?? center.lat,
              lng: mobilization.lng ?? center.lng,
              metadata: {
                ...(mobilization.metadata || {}),
                ...(feature.metadata || {}),
                status: 'operational',
                plannedType: undefined,
                deployedDate: this.ctx.currentDate(),
              },
            };
          } else {
            liveRegion.objects.push({
              id: feature.id || shortId(), type: feature.type, name, level: 1,
              owner: liveRegion.owner, lat: center.lat, lng: center.lng,
              metadata: { ...(feature.metadata || {}), status: 'operational', deployedDate: this.ctx.currentDate() },
            });
          }
          mutated = true;
          break;
        }
        case 'cancel_mobilization': {
          const feature = change.feature;
          const name = validFeatureName(feature);
          if (!feature || (!feature.id && !name)) break;
          liveRegion.objects ||= [];
          const before = liveRegion.objects.length;
          liveRegion.objects = liveRegion.objects.filter((object: any) =>
            object.type !== 'mobilization'
            || (feature.id ? object.id !== feature.id : normalizeName(object.name) !== normalizeName(name || '')));
          mutated = liveRegion.objects.length !== before;
          break;
        }
        case 'spawn_battalion':
        case 'spawn_unit': {
          const feature = change.feature;
          const requestedType = change.type === 'spawn_battalion' ? 'battalion' : feature?.type;
          if (!requestedType || !unitTypes.has(requestedType) || liveRegion.status === 'destroyed') break;
          liveRegion.objects ||= [];
          const name = validFeatureName(feature)
            || `${requestedType === 'army' ? 'Armata' : requestedType === 'fleet' ? 'Flotta' : requestedType === 'missile' ? 'Batteria' : 'Battaglione'} ${liveRegion.name} ${liveRegion.objects.filter((object: any) => object.type === requestedType).length + 1}`;
          if (liveRegion.objects.some((object: any) => object.type === requestedType
              && normalizeName(object.name) === normalizeName(name))) break;
          const center = this.ctx.geometry.regionCenter(liveRegion);
          if (!center) break;
          liveRegion.objects.push({
            id: feature?.id || shortId(),
            type: requestedType,
            name,
            level: 1,
            owner: liveRegion.owner,
            lat: center.lat,
            lng: center.lng,
            metadata: { ...(feature?.metadata || {}), status: 'operational', deployedDate: this.ctx.currentDate() },
          });
          mutated = true;
          break;
        }
      }
      if (mutated) changed.set(liveRegion.id, liveRegion);
    }
    return [...changed.values()];
  }

  /** Resolve identity before mutating: IDs never fall back to names; ambiguous names never guess. */
  private applyUnitChange(change: MapChange, movedDate: string): RegionState[] {
    const feature = change.feature;
    const name = feature?.name ? normalizeName(feature.name) : '';
    const requestedType = change.type === 'move_battalion' ? 'battalion' : feature?.type;
    if (requestedType && !UNIT_TYPES.has(requestedType)) return [];
    const regions = [...this.ctx.regions().values()];
    const origin = resolveMovementRegion(regions, change.regionId || change.regionName);
    const movable = regions.flatMap(region => (region.objects || [])
      .filter(unit => UNIT_TYPES.has(unit.type))
      .map(unit => ({ region, unit })));
    const allowed = movable.filter(candidate => unitMatchesType(candidate.unit, requestedType));
    let candidates = feature?.id
      ? allowed.filter(candidate => candidate.unit.id === feature.id)
      : name ? allowed.filter(candidate => normalizeName(candidate.unit.name || '') === name) : [];
    // Il modello cita spesso il nome breve («3° Battaglione») di un reparto con
    // nome lungo: accettiamo un prefisso distintivo solo se identifica UNA unità.
    if (candidates.length === 0 && !feature?.id && name) {
      const tolerant = allowed.filter(candidate => unitNameMatchesPrefix(feature!.name!, candidate.unit.name || ''));
      if (tolerant.length === 1) candidates = tolerant;
    }
    // The legacy unnamed command is safe only with one battalion at an exact origin.
    if (!feature?.id && !name && change.type === 'move_battalion' && origin) {
      candidates.push(...(origin.objects || []).filter(unit => unit.type === 'battalion')
        .map(unit => ({ region: origin, unit })));
    }
    if (candidates.length !== 1) {
      if (change.type === 'move_unit' || change.type === 'move_battalion' || change.type === 'remove_unit') {
        console.warn('[GameSession]', change.type, 'non applicato: unità non identificata in modo univoco',
          { nome: feature?.name, id: feature?.id, tipo: requestedType, candidati: candidates.length });
      }
      return [];
    }
    const { region: source, unit } = candidates[0];
    if (change.type === 'remove_unit') {
      source.objects = source.objects.filter(object => object !== unit);
      return [source];
    }
    const target = resolveMovementRegion(regions, change.targetRegionName);
    if (!target || target.status === 'destroyed' || source.id === target.id) {
      console.warn('[GameSession]', change.type, 'non applicato: destinazione non risolta',
        { destinazione: change.targetRegionName, origine: source.name, unità: unit.name });
      return [];
    }
    const center = this.ctx.geometry.regionCenter(target);
    if (!center) return [];
    // Il movimento ha un costo materiale: cibo, carburante (se motorizzato) e
    // denaro. Non blocca il gioco, ma registra carenze e consuma le scorte.
    const payer = unit.owner || source.owner || this.ctx.playerPolityId();
    const cost = movementCost(this.ctx.resourceStock(payer));
    const payment = payMovement(this.ctx.resourceStock(payer), cost);
    this.ctx.saveResourceStock(payer, payment.stock);
    if (!payment.covered) {
      console.warn('[GameSession] Movimento con scorte insufficienti:', payment.shortages.join('; '),
        { unita: unit.name, polity: payer });
    }
    const previous = this.ctx.geometry.regionCenter(source);
    unit.metadata = {
      ...(unit.metadata || {}), status: unit.metadata?.status || 'operational', movedDate,
      previousRegionId: source.id, previousRegionName: source.name,
      previousLng: Number.isFinite(unit.lng) ? unit.lng : previous?.lng,
      previousLat: Number.isFinite(unit.lat) ? unit.lat : previous?.lat,
      logistics: { food: cost.food, fuel: cost.fuel, money: cost.money,
        motorized: cost.motorized, covered: payment.covered },
    };
    if (!unit.owner) unit.owner = source.owner;
    unit.lat = center.lat;
    unit.lng = center.lng;
    source.objects = source.objects.filter(object => object !== unit);
    target.objects ||= [];
    target.objects.push(unit);
    return [source, target];
  }

}
