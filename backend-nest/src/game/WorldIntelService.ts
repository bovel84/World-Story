/**
 * World Story — WorldIntelService
 * ===============================
 * Intelligenza sul mondo derivata da regioni, diplomazia e cronaca, estratta
 * da `game-session.ts` (Fase 1). Pura lettura (nessuna mutazione di sessione):
 *  - risoluzione nomi ↔ polityId/regione (`buildResolvers`);
 *  - individuazione delle politie citate/pertinenti a una crisi;
 *  - potenza militare di mappa ed effettiva, vicini ostili;
 *  - memoria strategica verificabile e dossier NPC per il simulatore;
 *  - contratto mappa per le misure materiali delle controparti.
 *
 * Tutto lo stato vivo è fornito tramite `WorldIntelContext`.
 */

import { chatRepository } from '../repositories';
import { countryRepository } from '../repositories/country.repository';
import { RegionResolver, PolityResolver, normalizeName } from '../utils/name-resolver';
import { polityDisplayNameIt, polityNameAliases } from '../utils/country-facts';
import { currentStrategicPriorities, strategicProfileForPolity } from '../npc-agents';
import { arsenalCombatFactor } from '../core/simulation/MilitaryIndustry';
import { measureMaterialCategory, reactionAllowsMaterialCategory } from '../core/simulation/ReactionDecisions';
import { WorldStateEngine, type NationalAccount } from '../core/simulation/WorldStateEngine';
import type { SimulationEvent, MapChange, MapFeature } from '../prompts/types';
import type { RegionState, TurnResultRecord } from '../game-session';

export interface WorldIntelContext {
  gameId: string;
  regions(): Map<string, RegionState>;
  playerPolityId(): string;
  publicPolityName(polityId: string): string;
  results(): TurnResultRecord[];
  /** Stance registrata tra due politie (matrice diplomatica). */
  relationship(from: string, to: string): string;
  arsenalUnits(polityId: string): Record<string, number>;
  worldStateOptions(): { modernFacts: boolean; startDate: string; taxRateByPolity?: Record<string, number> };
}

export class WorldIntelService {
  constructor(private readonly ctx: WorldIntelContext) {}

  buildResolvers(): { regions: RegionResolver; polities: PolityResolver } {
    const all = Array.from(this.ctx.regions().values());
    const polityAliases: Record<string, string[]> = {};
    for (const owner of new Set(all.map(region => region.owner))) {
      if (!owner || owner === 'neutral') continue;
      // Stessa fonte degli alias usati dal resolver: code, registro, italiano.
      polityAliases[owner] = polityNameAliases(owner, countryRepository.findByCode(owner)?.name);
    }
    return {
      regions: new RegionResolver(all),
      polities: new PolityResolver(all, this.ctx.playerPolityId(), polityAliases),
    };
  }

  /**
   * Individua le politie nominate esplicitamente in ordini e dispacci. È il
   * fallback deterministico quando un provider omette il campo reactions:
   * almeno le controparti riconoscibili ricevono una presa di posizione in chat.
   */
  mentionedNpcPolityIds(texts: string[]): string[] {
    const owners = [...new Set(Array.from(this.ctx.regions().values()).map(region => region.owner))]
      .filter(owner => owner && owner !== 'neutral' && owner !== this.ctx.playerPolityId());
    const found: string[] = [];
    for (const text of texts) {
      const normalizedText = ` ${normalizeName(text)} `;
      for (const owner of owners) {
        if (found.includes(owner)) continue;
        const registeredName = countryRepository.findByCode(owner)?.name;
        const aliases = [
          registeredName,
          polityDisplayNameIt(owner, registeredName),
          ...Array.from(this.ctx.regions().values()).filter(region => region.owner === owner).map(region => region.name),
        ]
          .filter((name): name is string => !!name)
          .map(normalizeName)
          .filter(alias => alias.length >= 3);
        const words = normalizedText.trim().split(/\s+/);
        const named = aliases.some(alias =>
          normalizedText.includes(` ${alias} `)
          || (!alias.includes(' ') && alias.length >= 5 && words.some(word => word.startsWith(alias)))
          // Forme aggettivali italiane ("cecoslovacca", "botswane"): radice condivisa.
          || (!alias.includes(' ') && alias.length >= 6
            && words.some(word => word.length >= 6 && word.startsWith(alias.slice(0, 6))))
        );
        const escapedOwner = owner.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        const coded = new RegExp(`(^|[^A-Z])${escapedOwner}([^A-Z]|$)`).test(text);
        if (named || coded) found.push(owner);
      }
    }
    return found;
  }

  /** Vicini geografici (proprietari dei territori confinanti) di una politia. */
  private frontierOwnerIds(polityId: string, cache?: Map<string, Set<string>>): Set<string> {
    const cached = cache?.get(polityId);
    if (cached) return cached;
    const owners = new Set<string>();
    for (const region of this.ctx.regions().values()) {
      if (region.owner !== polityId) continue;
      for (const borderId of region.borders || []) {
        const other = this.ctx.regions().get(borderId)?.owner;
        if (other && other !== 'neutral' && other !== polityId) owners.add(other);
      }
    }
    cache?.set(polityId, owners);
    return owners;
  }

  /** Il mondo fornisce informazioni di adiacenza? Se no, nessun filtro geografico è applicabile. */
  hasGeographicAdjacency(): boolean {
    for (const region of this.ctx.regions().values()) {
      if ((region.borders || []).length > 0) return true;
    }
    return false;
  }

  /**
   * Politie pertinenti a una crisi: quelle nominate nei testi, i vicini
   * geografici del giocatore e dei soggetti in scena, e le politie con un
   * rapporto registrato. Esclude le potenze lontane senza interesse
   * documentato: una crisi di confine non deve generare note di comodo da
   * capitali irrilevanti. `seedPolityIds` espande soltanto la geografia e i
   * rapporti, non rende automaticamente pertinente chi lo propone.
   */
  crisisRelevantPolityIds(texts: string[], seedPolityIds: string[] = []): Set<string> {
    const relevant = new Set<string>(this.mentionedNpcPolityIds(texts));
    const cache = new Map<string, Set<string>>();
    const seeds = [this.ctx.playerPolityId(), ...seedPolityIds, ...relevant];
    for (const seed of seeds) {
      for (const neighbour of this.frontierOwnerIds(seed, cache)) {
        if (neighbour !== this.ctx.playerPolityId()) relevant.add(neighbour);
      }
    }
    for (const region of this.ctx.regions().values()) {
      const owner = region.owner;
      if (!owner || owner === 'neutral' || owner === this.ctx.playerPolityId() || relevant.has(owner)) continue;
      if (this.ctx.relationship(owner, this.ctx.playerPolityId()) !== 'neutral') { relevant.add(owner); continue; }
      for (const seed of seeds) {
        if (this.ctx.relationship(owner, seed) !== 'neutral') { relevant.add(owner); break; }
      }
    }
    return relevant;
  }

  /** Regione di una politia dove collocare una misura materiale: quella
   * nominata nel testo, altrimenti la capitale, altrimenti la più popolosa. */
  private npcMeasureRegion(polityId: string, texts: string[]): RegionState | undefined {
    const owned = [...this.ctx.regions().values()]
      .filter(region => region.owner === polityId && region.status !== 'destroyed');
    if (owned.length === 0) return undefined;
    const normalized = texts.map(text => ` ${normalizeName(text)} `);
    const named = owned.find(region =>
      normalized.some(text => text.includes(` ${normalizeName(region.name)} `)));
    if (named) return named;
    const capital = owned.find(region =>
      (region.objects || []).some((object: any) => object.type === 'capital'));
    return capital || owned.sort((a, b) => (b.population || 0) - (a.population || 0))[0];
  }

  /**
   * Riconosce una misura materiale avviata nel testo di una controazione NPC.
   * Conservativo: solo formulazioni inequivocabili di mobilitazione o cantiere.
   */
  private detectNpcMaterialMeasure(
    text: string,
  ): { type: MapChange['type']; featureType: MapFeature['type']; label: string } | null {
    const lower = text.toLowerCase();
    const rules: Array<{ re: RegExp; type: MapChange['type']; featureType: MapFeature['type']; label: string }> = [
      { re: /\b(flotta|navale|marina militare|squadra navale)/, type: 'start_mobilization', featureType: 'fleet', label: 'Flotta mobilitata' },
      { re: /\b(missil|batteria costiera)/, type: 'start_mobilization', featureType: 'missile', label: 'Batteria missilistica mobilitata' },
      { re: /\b(mobilit|reclut|richiam|leva|riserve)/, type: 'start_mobilization', featureType: 'battalion', label: 'Riserve mobilitate' },
      { re: /\b(base aerea|aeroporto|airbase)/, type: 'start_construction', featureType: 'airbase', label: 'Base aerea' },
      { re: /\b(base navale|porto militare|arsenale)/, type: 'start_construction', featureType: 'naval_base', label: 'Base navale' },
      { re: /\b(radar|sorveglianza aerea)/, type: 'start_construction', featureType: 'radar', label: 'Stazione radar' },
      { re: /\b(fortific|trince|bunker|linea difensiva)/, type: 'start_construction', featureType: 'fortification', label: 'Fortificazioni' },
      { re: /\b(universit)/, type: 'start_construction', featureType: 'university', label: 'Università' },
      { re: /\b(fabbrica|acciaieria|impianto industriale)/, type: 'start_construction', featureType: 'factory', label: 'Impianto industriale' },
      { re: /\b(ferrovia|strada|corridoio|infrastruttur|oleodotto)/, type: 'start_construction', featureType: 'infrastructure', label: 'Opera infrastrutturale' },
      { re: /\b(centrale (elettrica|energetica)|diga)/, type: 'start_construction', featureType: 'power_plant', label: 'Centrale elettrica' },
      { re: /\b(cantiere|costru|edifica)/, type: 'start_construction', featureType: 'base', label: 'Nuova opera' },
    ];
    for (const rule of rules) {
      if (rule.re.test(lower)) return { type: rule.type, featureType: rule.featureType, label: rule.label };
    }
    return null;
  }

  /**
   * Contratto mappa per gli NPC: se una controazione attestata avvia una
   * misura materiale (mobilitazione, cantieri, difese) e il modello ha
   * dimenticato la mapChange, il motore la materializza nel territorio della
   * politia, senza inventare nulla che il testo non affermi già.
   */
  reconcileNpcMaterialMeasures(event: SimulationEvent): SimulationEvent {
    const reactions = event.reactions || [];
    if (reactions.length === 0) return event;
    const resolver = this.buildResolvers();
    const existing = event.mapChanges || [];
    const existingRegionIds = new Set<string>();
    for (const change of existing) {
      const key = change.regionName || change.regionId;
      if (!key) continue;
      const direct = this.ctx.regions().get(key);
      const resolved = direct || resolver.regions.resolve(key);
      const regionId = direct?.id || (resolved ? (this.ctx.regions().get(resolved.id)?.id) : undefined);
      if (regionId) existingRegionIds.add(regionId);
    }
    const additions: MapChange[] = [];
    for (const reaction of reactions) {
      const resolution = resolver.polities.resolve(reaction.polityName);
      if (!resolution || resolution.isNew || resolution.polityId === this.ctx.playerPolityId()) continue;
      const text = `${reaction.response || ''} ${reaction.counterAction || ''}`;
      const measure = this.detectNpcMaterialMeasure(text);
      if (!measure) continue;
      // §7: la controazione resta narrativa, ma non può materializzare una
      // categoria che l'opzione scelta non ammette (un negoziato non mobilita
      // unità). Reazioni legacy senza optionId: comportamento invariato.
      if (!reactionAllowsMaterialCategory(reaction, measureMaterialCategory(measure.type))) continue;
      const region = this.npcMeasureRegion(resolution.polityId, [text, event.headline, event.description]);
      if (!region || existingRegionIds.has(region.id)) continue;
      additions.push({
        type: measure.type,
        regionName: region.name,
        feature: { type: measure.featureType, name: `${measure.label} ${this.ctx.publicPolityName(resolution.polityId)}` },
      });
      existingRegionIds.add(region.id);
    }
    if (additions.length === 0) return event;
    return { ...event, mapChanges: [...existing, ...additions] };
  }

  nationalMilitaryPower(polityId: string): number {
    return Array.from(this.ctx.regions().values())
      .filter(region => region.owner === polityId)
      .reduce((total, region) => total + (Number(region.militaryPower) || 0), 0);
  }

  /**
   * Potenza militare effettiva di una politia: potenza di mappa × fattore
   * dell'arsenale (qualità e copertura delle armi). Vale per il giocatore e per
   * tutte le nazioni NPC, così le decisioni dell'IA tengono conto dell'arsenale.
   */
  nationalEffectiveMilitaryPower(polityId: string, accounts?: Record<string, NationalAccount>): number {
    const base = this.nationalMilitaryPower(polityId);
    const arsenal = this.ctx.arsenalUnits(polityId);
    const book = accounts || WorldStateEngine.accounts(this.ctx.regions().values(), this.ctx.worldStateOptions());
    const forces = Number(book[polityId]?.forces || 0) + Number(book[polityId]?.mobilized || 0);
    return Math.round(base * arsenalCombatFactor(arsenal, forces) * 10) / 10;
  }

  hostileNeighbourCount(polityId: string): number {
    const hostile = new Set<string>();
    for (const region of this.ctx.regions().values()) {
      if (region.owner !== polityId) continue;
      for (const borderId of region.borders || []) {
        const other = this.ctx.regions().get(borderId)?.owner;
        if (other && other !== polityId && other !== 'neutral'
            && this.ctx.relationship(polityId, other) === 'hostile') hostile.add(other);
      }
    }
    return hostile.size;
  }

  /**
   * Memoria strategica verificabile: recupera soltanto eventi canonici già
   * persistiti che nominano la politia. Nessun riassunto LLM separato può
   * quindi inventare un precedente o sopravvivere a un rewind illegittimo.
   */
  recentStrategicMemory(polityId: string, limit = 3): string[] {
    const candidates: Array<{ date: string; turn: number; text: string }> = [];
    for (const result of this.ctx.results()) {
      for (const event of result.timelineEvents || []) {
        const text = `${event.headline} ${event.detail || ''}`;
        if (!this.mentionedNpcPolityIds([text]).includes(polityId)) continue;
        const detail = String(event.detail || '').replace(/\s+/g, ' ').trim();
        const compactDetail = detail.length > 180 ? `${detail.slice(0, 179).trimEnd()}…` : detail;
        candidates.push({
          date: event.date || result.date || '',
          turn: result.turn,
          text: `${event.date || result.date || ''}: ${event.headline}${compactDetail ? ` — ${compactDetail}` : ''}`,
        });
      }
    }
    // Anche promesse, rifiuti e condizioni nelle chat sono memoria canonica:
    // provengono da righe persistite, non da un riassunto inventato ad hoc.
    for (const chat of chatRepository.getChatsByGame(this.ctx.gameId, true)) {
      if (!chat.participants.some(participant => participant.id === polityId)) continue;
      for (const message of chatRepository.getMessages(chat.id).slice(-6)) {
        const content = String(message.content || '').replace(/\s+/g, ' ').trim();
        if (!content) continue;
        const compactContent = content.length > 180 ? `${content.slice(0, 179).trimEnd()}…` : content;
        const speaker = message.role === 'player'
          ? this.ctx.publicPolityName(this.ctx.playerPolityId())
          : (message.senderName || chat.polityName);
        candidates.push({
          date: message.gameDate || '',
          turn: message.turn,
          text: `${message.gameDate || `turno ${message.turn}`}: ${speaker} in diplomazia — ${compactContent}`,
        });
      }
    }
    return candidates
      .sort((a, b) => b.date.localeCompare(a.date) || b.turn - a.turn)
      .map(candidate => candidate.text)
      .filter((text, index, all) => all.indexOf(text) === index)
      .slice(0, limit);
  }

  /**
   * Dossier passati al simulatore globale. Prima vengono le controparti
   * nominate negli ordini, poi attori della memoria recente, confinanti e
   * relazioni non neutrali. Il limite evita di trasformare il prompt in un
   * atlante di personalità irrilevanti.
   */
  buildNpcStrategicDossiers(
    focusTexts: string[],
    accounts: ReturnType<typeof WorldStateEngine.accounts>,
  ): string {
    const owners = [...new Set(Array.from(this.ctx.regions().values()).map(region => region.owner))]
      .filter(owner => owner && owner !== 'neutral' && owner !== this.ctx.playerPolityId());
    if (owners.length === 0) return 'Nessuna politia non giocante presente.';

    const recentTexts = this.ctx.results().slice(-8).flatMap(result =>
      (result.timelineEvents || []).map(event => `${event.headline} ${event.detail || ''}`)
    );
    const recentOwners = this.mentionedNpcPolityIds(recentTexts);
    const focusedOwners = this.mentionedNpcPolityIds(focusTexts);
    const chatOwners = chatRepository.getChatsByGame(this.ctx.gameId, true)
      .flatMap(chat => chat.participants.map(participant => participant.id))
      .filter(owner => owners.includes(owner));
    const frontierOwners = new Set<string>();
    for (const region of this.ctx.regions().values()) {
      if (region.owner !== this.ctx.playerPolityId()) continue;
      for (const borderId of region.borders || []) {
        const owner = this.ctx.regions().get(borderId)?.owner;
        if (owner && owner !== 'neutral' && owner !== this.ctx.playerPolityId()) frontierOwners.add(owner);
      }
    }
    const relatedOwners = owners.filter(owner => this.ctx.relationship(this.ctx.playerPolityId(), owner) !== 'neutral');
    const strongestOwners = [...owners].sort((a, b) => (accounts[b]?.militaryPower || 0) - (accounts[a]?.militaryPower || 0));
    // Il dossier copre il teatro della crisi, non l'intero globo. Ancore fisse:
    // gli ordini del turno e i rapporti registrati. Da lì si espande ai vicini;
    // le potenze lontane entrano solo con un ruolo documentato, non perché sono
    // potenti, e le vecchie menzioni non riportano in scena un attore estraneo.
    const anchors = new Set<string>([...focusedOwners, ...relatedOwners]);
    const regionalOwners = new Set<string>();
    for (const owner of [this.ctx.playerPolityId(), ...anchors]) {
      for (const neighbour of this.frontierOwnerIds(owner)) {
        if (neighbour !== this.ctx.playerPolityId()) regionalOwners.add(neighbour);
      }
    }
    const theatreOwners = new Set<string>([
      ...focusedOwners,
      ...frontierOwners,
      ...regionalOwners,
      ...relatedOwners,
    ]);
    const relevantOwners = [...new Set([
      ...focusedOwners,
      ...regionalOwners,
      ...frontierOwners,
      ...relatedOwners,
      ...recentOwners.filter(owner => theatreOwners.has(owner)),
      ...chatOwners.filter(owner => theatreOwners.has(owner)),
    ])];
    // Solo se il mondo non offre alcun aggancio geografico o diplomatico il
    // dossier ripiega sulle potenze più forti, per non restare vuoto.
    const selected = (relevantOwners.length > 0 ? relevantOwners : strongestOwners).slice(0, 10);
    const playerMilitaryPower = Number(accounts[this.ctx.playerPolityId()]?.effectiveMilitaryPower) || this.nationalEffectiveMilitaryPower(this.ctx.playerPolityId(), accounts);
    const displayName = (polityId: string): string => {
      const owned = Array.from(this.ctx.regions().values()).filter(region => region.owner === polityId);
      const registeredName = countryRepository.findByCode(polityId)?.name;
      return owned.length > 1
        ? (registeredName || polityId)
        : (owned[0]?.name || registeredName || polityId);
    };
    const allPolityIds = [this.ctx.playerPolityId(), ...owners];

    return selected.map(polityId => {
      const owned = Array.from(this.ctx.regions().values()).filter(region => region.owner === polityId);
      const name = displayName(polityId);
      const account = accounts[polityId];
      const relationship = this.ctx.relationship(polityId, this.ctx.playerPolityId());
      const profile = strategicProfileForPolity(polityId);
      const registeredRelations = allPolityIds
        .filter(otherId => otherId !== polityId)
        .map(otherId => ({ otherId, value: this.ctx.relationship(polityId, otherId) }))
        .filter(entry => entry.value !== 'neutral');
      const priorities = currentStrategicPriorities(profile, {
        relationshipToPlayer: relationship,
        hostileNeighbours: this.hostileNeighbourCount(polityId),
        hostileActors: registeredRelations.filter(entry => entry.value === 'hostile').length,
        alliedActors: registeredRelations.filter(entry => entry.value === 'ally').length,
        militaryPower: this.nationalEffectiveMilitaryPower(polityId, accounts),
        playerMilitaryPower,
        monthlyBalance: account?.monthlyBalance,
        stability: account?.stability,
        mobilized: account?.mobilized,
        warEffort: account?.warEffort,
        socialTension: account?.socialTension,
      });
      const memory = this.recentStrategicMemory(polityId, 3);
      return [
        `- ${name} [${polityId}] — profilo persistente: ${profile.personality}, dottrina ${profile.doctrine}, stile negoziale ${profile.negotiationStyle}, decisione ${profile.decisionTempo}.`,
        `  Tratti: propensione alla forza ${Math.round(profile.aggression * 100)}/100; rischio ${profile.riskTolerance}/100; affidabilità verso impegni registrati ${profile.allianceReliability}/100; focus economico ${profile.economicFocus}/100; sensibilità alla sovranità ${profile.sovereigntySensitivity}/100.`,
        `  Priorità correnti: ${priorities.join('; ')}. Linee rosse: ${profile.redLines.join('; ')}.`,
        ...(account ? [`  Economia e sforzo: saldo mensile ${Math.round(account.monthlyBalance * 10) / 10}, stabilità ${account.stability}/100, spesa militare ${account.defenceBurdenPct}% del PIL, riserve mobilitate ${account.mobilized}, sforzo bellico ${account.warEffort}/100, tensione sociale ${account.socialTension}/100.`] : []),
        `  Rapporti registrati: ${registeredRelations.length ? registeredRelations.slice(0, 8).map(entry => `${displayName(entry.otherId)} [${entry.otherId}] ${entry.value}`).join('; ') : 'nessun rapporto non neutrale'}.`,
        `  Memoria strategica: ${memory.length ? memory.join(' | ') : 'nessun precedente specifico registrato: non inventarne uno'}.`,
      ].join('\n');
    }).join('\n');
  }

  /** Colore canonico di una politia: colore più frequente tra i territori posseduti. */
  polityColor(polityId: string, excludeRegionId?: string): string | undefined {
    const counts = new Map<string, number>();
    for (const r of this.ctx.regions().values()) {
      if (r.id === excludeRegionId || r.owner !== polityId || !r.color) continue;
      counts.set(r.color, (counts.get(r.color) || 0) + 1);
    }
    return [...counts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0];
  }
}
