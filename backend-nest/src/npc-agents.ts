/**
 * World Story — NPC Country Agents
 * =============================
 * AI agents for non-player countries with personality traits.
 */

import { LLMRouter } from './llm';

export type NPCPersonality = 'aggressive' | 'diplomatic' | 'neutral' | 'isolationist';

export interface NPCCountry {
  regionId: string;
  regionName: string;
  personality: NPCPersonality;
  aggression: number; // 0-1, how likely to start conflicts
  resources: number; // 0-1, economic/military strength
}

export interface NPCAction {
  type: 'expand' | 'ally' | 'war' | 'develop' | 'neutral' | 'trade' | 'defense';
  targetRegionId?: string;
  description: string;
  priority: number; // 1-10
}

export class NPCCountryAgent {
  private provider: LLMRouter;
  private country: NPCCountry;

  constructor(provider: LLMRouter, country: NPCCountry) {
    this.provider = provider;
    this.country = country;
  }

  get regionId(): string {
    return this.country.regionId;
  }

  get personality(): NPCPersonality {
    return this.country.personality;
  }

  private getPersonalitySystemPrompt(): string {
    switch (this.country.personality) {
      case 'aggressive':
        return `Sei il leader di una potenza militare aggressiva.
Il tuo obiettivo è l'espansione dell'influenza e del territorio.
Cerchi costantemente occasioni per l'azione militare, ma non sei uno stolto: valuti i rapporti di forza e colpisci dove il nemico è debole.
Usi la forza come strumento politico: ogni guerra deve avere uno scopo strategico.
Preferisci decisioni rapide e audaci.
Rispondi in modo asciutto, sicuro, militare.`;

      case 'diplomatic':
        return `Sei il leader di uno Stato diplomatico.
Preferisci la negoziazione e le alleanze all'uso delle armi.
Cerchi compromessi e accordi di reciproco vantaggio, e coltivi con pazienza la tua rete di alleati.
Un trattato ben costruito vale più di una battaglia: costruisci la tua influenza con la diplomazia.
Preferisci uno sviluppo pacifico del tuo paese.
Rispondi in tono diplomatico, ponderato.`;

      case 'neutral':
        return `Sei il leader di uno Stato neutrale.
Ti muovi con equilibrio tra le grandi potenze, senza legarti a nessun blocco.
Difendi i tuoi interessi ma non ti immischi nei conflitti altrui.
Sei un pragmatista: agisci secondo la situazione, mai per principio cieco.
Rispondi in modo pragmatico e prudente.`;

      case 'isolationist':
        return `Sei il leader di uno Stato isolazionista.
Gli affari esteri non ti interessano se non quando minacciano direttamente il tuo territorio.
Sei concentrato sullo sviluppo interno: economia, infrastrutture, benessere della popolazione.
Eviti ogni alleanza e ogni conflitto.
Rispondi in modo breve e essenziale.`;

      default:
        return `Sei il leader di un paese in una storia alternativa.
Agisci in modo logico e razionale, secondo gli interessi nazionali del tuo paese.`;
    }
  }

  async think(context: NPCCountryContext): Promise<NPCAction> {
    const system = this.getPersonalitySystemPrompt();

    const neighborsInfo = context.neighbors
      .map(n => `- ${n.name} [${n.id}]: forza=${n.militaryPower}, PIL=${n.gdp}, proprietario=${n.owner}, rapporto=${n.relationship || 'neutral'}`)
      .join('\n');

    const recentEvents = context.recentEvents
      .map(e => `- ${e}`)
      .join('\n') || 'Ancora nessun evento';

    const user = `Paese: ${context.polityName || this.country.regionName} [${context.polityId || this.country.regionId}]
Rappresenti l'intera nazione, non la singola provincia dell'agente.
Non attaccare province della tua nazione. "war" è ammesso solo contro vicini con rapporto "hostile" già registrato; non dichiarare nuove guerre.
Le risposte "ally" e "trade" sono proposte, non accordi conclusi.
Tipo di personalità: ${this.country.personality}
Aggressività: ${this.country.aggression}

Stato attuale:
- Popolazione: ${context.population}
- PIL: ${context.gdp}
- Potenza militare: ${context.militaryPower}

Vicini:
${neighborsInfo}

Eventi recenti nel mondo:
${recentEvents}

Turno attuale: ${context.turn}

Analizza la situazione e decidi quale azione intraprendere.
Rispondi in formato JSON:
{
  "type": "expand|ally|war|develop|neutral|trade|defense",
  "targetRegionId": "id_della_regione_se_necessario",
  "description": "descrizione dell'azione",
  "priority": 1-10
}

Scegli UNA sola azione, quella più coerente con la tua personalità e la situazione attuale. Agisci secondo gli interessi nazionali: nessuna decisione arbitraria o gratuita.`;

    try {
      const result = await this.provider.generate('npc', system, user, {
        temperature: 0.7,
        // MiniMax-M2.5 — reasoning-модель: «мысли» съедают ~500-1500 токенов
        // до начала ответа; лимит 500 приводил к finish_reason=length и пустому content.
        maxTokens: 2500,
      });

      // Parse JSON from response
      const jsonMatch = result.content.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        const action = JSON.parse(jsonMatch[0]) as NPCAction;
        return {
          type: action.type || 'neutral',
          targetRegionId: action.targetRegionId,
          description: action.description || 'Inazione',
          priority: action.priority || 5,
        };
      }

      // Invalid output is not an instruction to invent a war or investment.
      return { type: 'neutral', description: '', priority: 0 };
    } catch (error) {
      console.error('NPC agent error:', error);
      return { type: 'neutral', description: '', priority: 0 };
    }
  }

}

export interface NPCCountryContext {
  polityId?: string;
  polityName?: string;
  turn: number;
  population: number;
  gdp: number;
  militaryPower: number;
  neighbors: {
    id: string;
    name: string;
    owner: string;
    militaryPower: number;
    gdp: number;
    relationship?: string;
  }[];
  recentEvents: string[];
}

/**
 * Create NPC countries from world configuration
 */
const PERSONALITIES: NPCPersonality[] = ['aggressive', 'diplomatic', 'neutral', 'isolationist'];
const AGGRESSION_BY_PERSONALITY: Record<NPCPersonality, number> = {
  aggressive: 0.9,
  diplomatic: 0.2,
  neutral: 0.5,
  isolationist: 0.1,
};

/**
 * Детерминированная личность по polityId (FNV-1a hash). Раньше личности были
 * захардкожены под 'ai-1'..'ai-4', поэтому шаблонные страны ('USA', 'RUS', ...)
 * всегда получали 'neutral'/0.5.
 */
export function personalityForPolity(polityId: string): { personality: NPCPersonality; aggression: number } {
  let hash = 0x811c9dc5;
  for (let i = 0; i < polityId.length; i++) {
    hash ^= polityId.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  const personality = PERSONALITIES[(hash >>> 0) % PERSONALITIES.length];
  // Небольшой детерминированный разброс агрессии вокруг базовой
  const jitter = (((hash >>> 8) % 21) - 10) / 100; // ±0.10
  const aggression = Math.min(1, Math.max(0, AGGRESSION_BY_PERSONALITY[personality] + jitter));
  return { personality, aggression };
}

export function createNPCCountries(
  provider: LLMRouter,
  regionConfigs: {
    id: string;
    name: string;
    owner: string;
  }[]
): Map<string, NPCCountryAgent> {
  const npcAgents = new Map<string, NPCCountryAgent>();

  for (const config of regionConfigs) {
    // Caller передаёт уже отфильтрованные NPC-политии (не игрок, не neutral).
    if (config.owner === 'neutral') continue;

    const { personality, aggression } = personalityForPolity(config.owner);

    const country: NPCCountry = {
      regionId: config.id,
      regionName: config.name,
      personality,
      aggression,
      resources: 0.5, // Could be calculated from region stats
    };

    npcAgents.set(config.id, new NPCCountryAgent(provider, country));
  }

  return npcAgents;
}
