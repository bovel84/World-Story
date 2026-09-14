/**
 * World Story — NPC Country Agents
 * =============================
 * AI agents for non-player countries with personality traits.
 */

import { LLMRouter } from './llm';

export type NPCPersonality = 'aggressive' | 'diplomatic' | 'neutral' | 'isolationist';
export type NPCStrategicDoctrine =
  | 'security_first'
  | 'coalition_builder'
  | 'commercial_pragmatist'
  | 'strategic_patience'
  | 'sovereignty_guardian'
  | 'domestic_consolidation';

/**
 * Identità strategica stabile della politia. Non contiene alleanze o nemici
 * hard-coded: quelli appartengono allo stato della singola partita. I tratti
 * restano invece identici fra turni, chat e riavvii perché derivano dal codice
 * canonico della politia, con profili istituzionali per gli attori principali.
 */
export interface NPCStrategicProfile {
  personality: NPCPersonality;
  aggression: number;
  doctrine: NPCStrategicDoctrine;
  negotiationStyle: string;
  decisionTempo: 'rapido' | 'misurato' | 'paziente';
  riskTolerance: number;
  allianceReliability: number;
  economicFocus: number;
  sovereigntySensitivity: number;
  baselinePriorities: string[];
  redLines: string[];
}

export interface NPCPriorityContext {
  relationshipToPlayer?: string;
  hostileNeighbours?: number;
  hostileActors?: number;
  alliedActors?: number;
  militaryPower?: number;
  playerMilitaryPower?: number;
  monthlyBalance?: number;
  stability?: number;
  mobilized?: number;
  warEffort?: number;
  socialTension?: number;
}

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
        return `Sei il leader di una potenza assertiva e incline all'uso della forza.
Il tuo obiettivo è proteggere la sicurezza nazionale e ampliare l'influenza, non conquistare territorio senza una causa documentata.
Valuti rapporti di forza, costi e reazioni: ricorri all'azione militare solo contro una minaccia o per un obiettivo strategico già visibile.
Usi la forza come strumento politico: ogni guerra deve avere una causa e uno scopo verificabili.
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
    const profile = strategicProfileForPolity(context.polityId || this.country.regionId);
    const priorities = currentStrategicPriorities(profile, {
      hostileNeighbours: context.neighbors.filter(neighbour => neighbour.relationship === 'hostile').length,
      hostileActors: context.neighbors.filter(neighbour => neighbour.relationship === 'hostile').length,
      alliedActors: context.neighbors.filter(neighbour => neighbour.relationship === 'ally').length,
      militaryPower: context.militaryPower,
    });
    const system = `${this.getPersonalitySystemPrompt()}

Dottrina persistente: ${profile.doctrine}; stile negoziale: ${profile.negotiationStyle}; tempo decisionale: ${profile.decisionTempo}.
Priorità correnti: ${priorities.join('; ')}.
Linee rosse: ${profile.redLines.join('; ')}.
Non cambiare improvvisamente carattere per rendere la storia più movimentata: adegua gli strumenti, non gli interessi fondamentali.`;

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
Tipo di personalità: ${profile.personality}
Propensione alla forza: ${profile.aggression}
Tolleranza del rischio: ${profile.riskTolerance}/100
Affidabilità verso impegni realmente registrati: ${profile.allianceReliability}/100
Sensibilità alla sovranità: ${profile.sovereigntySensitivity}/100

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
  aggressive: 0.78,
  diplomatic: 0.24,
  neutral: 0.45,
  isolationist: 0.12,
};

const DOCTRINE_BY_PERSONALITY: Record<NPCPersonality, NPCStrategicDoctrine> = {
  aggressive: 'security_first',
  diplomatic: 'coalition_builder',
  neutral: 'commercial_pragmatist',
  isolationist: 'domestic_consolidation',
};

const DOCTRINE_TEXT: Record<NPCStrategicDoctrine, Pick<NPCStrategicProfile, 'baselinePriorities' | 'redLines'>> = {
  security_first: {
    baselinePriorities: ['deterrenza e sicurezza delle frontiere', 'libertà operativa delle forze nazionali', 'vantaggio negoziale prima di assumere impegni'],
    redLines: ['incursioni o minacce dirette al territorio', 'perdita unilaterale di capacità difensive'],
  },
  coalition_builder: {
    baselinePriorities: ['preservare gli impegni diplomatici già registrati', 'costruire consenso fra partner', 'contenere le crisi con strumenti graduati'],
    redLines: ['violazione palese di un impegno sottoscritto', 'azione che isoli la politia dai partner'],
  },
  commercial_pragmatist: {
    baselinePriorities: ['continuità dei commerci e accesso alle risorse', 'stabilità interna e crescita', 'equilibrio fra interlocutori rivali'],
    redLines: ['blocco dei flussi economici essenziali', 'costi esterni senza contropartita verificabile'],
  },
  strategic_patience: {
    baselinePriorities: ['accumulare capacità prima di esporsi', 'ottenere concessioni graduali', 'evitare escalation non controllabili'],
    redLines: ['accerchiamento strategico durevole', 'umiliazione pubblica che riduca la capacità negoziale'],
  },
  sovereignty_guardian: {
    baselinePriorities: ['tutela della sovranità e del controllo territoriale', 'riconoscimento politico e libertà decisionale', 'mobilitare sostegno senza cedere autonomia'],
    redLines: ['annessione, occupazione o imposizioni esterne', 'accordi conclusi da altri per conto della politia'],
  },
  domestic_consolidation: {
    baselinePriorities: ['stabilità politica e amministrativa', 'sviluppo delle capacità interne', 'limitare impegni esteri non essenziali'],
    redLines: ['minaccia diretta alla sicurezza interna', 'obblighi esterni incompatibili con le risorse disponibili'],
  },
};

type ProfileOverride = Partial<Omit<NPCStrategicProfile, 'baselinePriorities' | 'redLines'>> & {
  priorities?: string[];
  redLines?: string[];
};

/** Profili istituzionali generali, non relazioni geopolitiche preconfezionate. */
const PROFILE_OVERRIDES: Record<string, ProfileOverride> = {
  ISR: { personality: 'aggressive', doctrine: 'security_first', negotiationStyle: 'diretto, concreto e centrato su garanzie verificabili', decisionTempo: 'rapido', riskTolerance: 78, allianceReliability: 72, economicFocus: 58, sovereigntySensitivity: 96 },
  PSE: { personality: 'diplomatic', doctrine: 'sovereignty_guardian', negotiationStyle: 'fermo sul riconoscimento politico, aperto a mediazioni concrete', decisionTempo: 'misurato', riskTolerance: 52, allianceReliability: 61, economicFocus: 67, sovereigntySensitivity: 98 },
  USA: { personality: 'diplomatic', doctrine: 'coalition_builder', negotiationStyle: 'transazionale ma orientato a coalizioni e garanzie', decisionTempo: 'misurato', riskTolerance: 63, allianceReliability: 82, economicFocus: 72, sovereigntySensitivity: 70 },
  RUS: { personality: 'aggressive', doctrine: 'security_first', negotiationStyle: 'gerarchico, duro e sensibile ai rapporti di forza', decisionTempo: 'rapido', riskTolerance: 72, allianceReliability: 59, economicFocus: 48, sovereigntySensitivity: 91 },
  CHN: { personality: 'neutral', doctrine: 'strategic_patience', negotiationStyle: 'paziente, incrementale e attento alla reciprocità', decisionTempo: 'paziente', riskTolerance: 46, allianceReliability: 65, economicFocus: 88, sovereigntySensitivity: 94 },
  GBR: { personality: 'diplomatic', doctrine: 'coalition_builder', negotiationStyle: 'pragmatico, multilaterale e attento all’equilibrio', decisionTempo: 'misurato', riskTolerance: 55, allianceReliability: 84, economicFocus: 73, sovereigntySensitivity: 68 },
  FRA: { personality: 'diplomatic', doctrine: 'coalition_builder', negotiationStyle: 'assertivo ma orientato ad autonomia e compromesso', decisionTempo: 'misurato', riskTolerance: 52, allianceReliability: 76, economicFocus: 74, sovereigntySensitivity: 79 },
  DEU: { personality: 'diplomatic', doctrine: 'commercial_pragmatist', negotiationStyle: 'procedurale, prevedibile e basato su impegni verificabili', decisionTempo: 'paziente', riskTolerance: 34, allianceReliability: 88, economicFocus: 91, sovereigntySensitivity: 63 },
  JPN: { personality: 'diplomatic', doctrine: 'commercial_pragmatist', negotiationStyle: 'prudente, consensuale e orientato alla continuità', decisionTempo: 'paziente', riskTolerance: 35, allianceReliability: 87, economicFocus: 91, sovereigntySensitivity: 72 },
  IND: { personality: 'neutral', doctrine: 'sovereignty_guardian', negotiationStyle: 'autonomo, pragmatico e favorevole a opzioni multiple', decisionTempo: 'misurato', riskTolerance: 49, allianceReliability: 63, economicFocus: 82, sovereigntySensitivity: 91 },
  IRN: { personality: 'neutral', doctrine: 'sovereignty_guardian', negotiationStyle: 'diffidente, resistente alla pressione e aperto a scambi reciproci', decisionTempo: 'misurato', riskTolerance: 62, allianceReliability: 57, economicFocus: 65, sovereigntySensitivity: 96 },
  CHE: { personality: 'isolationist', doctrine: 'domestic_consolidation', negotiationStyle: 'neutrale, tecnico e strettamente proporzionato', decisionTempo: 'paziente', riskTolerance: 24, allianceReliability: 73, economicFocus: 86, sovereigntySensitivity: 89 },
};

function fnv1a(value: string): number {
  let hash = 0x811c9dc5;
  for (let i = 0; i < value.length; i++) {
    hash ^= value.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}

function canonicalPolityCode(polityId: string): string {
  return String(polityId || 'NPC').trim().toUpperCase().replace(/^AI[-_:]/, '');
}

const clampScore = (value: number) => Math.min(100, Math.max(0, Math.round(value)));

/** Profilo stabile usato da simulazione, chat e vecchio agente NPC. */
export function strategicProfileForPolity(polityId: string): NPCStrategicProfile {
  const code = canonicalPolityCode(polityId);
  const hash = fnv1a(code);
  const override = PROFILE_OVERRIDES[code] || {};
  const personality = override.personality || PERSONALITIES[hash % PERSONALITIES.length];
  const doctrine = override.doctrine || DOCTRINE_BY_PERSONALITY[personality];
  const doctrineText = DOCTRINE_TEXT[doctrine];
  const jitter = ((hash >>> 8) % 21) - 10;
  const defaultTempo: NPCStrategicProfile['decisionTempo'] = personality === 'aggressive'
    ? 'rapido'
    : personality === 'isolationist' ? 'paziente' : 'misurato';

  return {
    personality,
    aggression: Math.min(1, Math.max(0, override.aggression ?? (AGGRESSION_BY_PERSONALITY[personality] + jitter / 100))),
    doctrine,
    negotiationStyle: override.negotiationStyle || ({
      aggressive: 'assertivo e sensibile ai rapporti di forza',
      diplomatic: 'graduale e orientato a compromessi verificabili',
      neutral: 'pragmatico, transazionale e prudente',
      isolationist: 'riservato e concentrato sui costi interni',
    } as Record<NPCPersonality, string>)[personality],
    decisionTempo: override.decisionTempo || defaultTempo,
    riskTolerance: clampScore(override.riskTolerance ?? (personality === 'aggressive' ? 72 + jitter : personality === 'isolationist' ? 24 + jitter : 48 + jitter)),
    allianceReliability: clampScore(override.allianceReliability ?? (personality === 'diplomatic' ? 79 + jitter : personality === 'aggressive' ? 58 + jitter : 64 + jitter)),
    economicFocus: clampScore(override.economicFocus ?? (personality === 'isolationist' ? 84 + jitter : personality === 'aggressive' ? 48 + jitter : 70 + jitter)),
    sovereigntySensitivity: clampScore(override.sovereigntySensitivity ?? (doctrine === 'sovereignty_guardian' || doctrine === 'security_first' ? 90 + jitter / 2 : 70 + jitter)),
    baselinePriorities: [...(override.priorities || doctrineText.baselinePriorities)],
    redLines: [...(override.redLines || doctrineText.redLines)],
  };
}

/** Priorità dinamiche: cambiano con lo stato, senza cancellare la personalità. */
export function currentStrategicPriorities(
  profile: NPCStrategicProfile,
  context: NPCPriorityContext = {},
): string[] {
  const priorities: string[] = [];
  if ((context.hostileNeighbours || 0) > 0) priorities.push(`contenere ${context.hostileNeighbours} frontiere ostili senza escalation gratuita`);
  if ((context.hostileActors || 0) > (context.hostileNeighbours || 0)) priorities.push('gestire le relazioni ostili registrate anche fuori dalle frontiere immediate');
  if ((context.alliedActors || 0) > 0) priorities.push('coordinare gli impegni registrati con gli alleati senza agire al loro posto');
  if (context.relationshipToPlayer === 'hostile') priorities.push('deterrenza e contenimento verso la politia del giocatore');
  if (context.relationshipToPlayer === 'ally') priorities.push('preservare l’alleanza registrata, chiedendo reciprocità proporzionata');
  if ((context.monthlyBalance ?? 0) < 0) priorities.push('ridurre lo squilibrio finanziario prima di nuovi impegni costosi');
  if ((context.stability ?? 100) < 45) priorities.push('stabilizzare il fronte interno prima di assumere rischi esterni');
  if ((context.socialTension ?? 0) >= 55) priorities.push('contenere il malcontento interno senza nuove leve impopolari');
  if ((context.warEffort ?? 0) >= 60) priorities.push('sostenere lo sforzo bellico o cercare una via d’uscita prima del logoramento');
  if ((context.playerMilitaryPower || 0) > 0 && (context.militaryPower || 0) < (context.playerMilitaryPower || 0) * 0.7
      && context.relationshipToPlayer === 'hostile') {
    priorities.push('compensare l’inferiorità militare con difesa, partner o negoziato');
  }
  priorities.push(...profile.baselinePriorities);
  return [...new Set(priorities)].slice(0, 4);
}

/** Compatibilità con i call site legacy che richiedono soltanto due tratti. */
export function personalityForPolity(polityId: string): { personality: NPCPersonality; aggression: number } {
  const { personality, aggression } = strategicProfileForPolity(polityId);
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
