/**
 * World Story — Simulation parsing
 * ===============================
 * Parsing e normalizzazione delle risposte LLM della simulazione: risposta
 * completa (`parseSimulationResponse`), record incrementali e loro estrazione da
 * testo parzialmente in streaming.
 *
 * Estratto da `prompts/simulation.ts` (Fase 3): comportamento invariato.
 */
import {
  SimulationResult,
  SimulationEvent,
  SimulationChatStart,
  VoidedAction,
  ActionOutcome,
  type MapChange,
  type SimulationPolityReaction,
} from '../types';
import { parseJsonLoose } from '../../utils/json-repair';
import { LLMContractError } from '../../llm/contract-error';
import { DomainContractError, parseActionOutcome } from '../../domain/contracts';

export type IncrementalSimulationRecord =
  | { type: 'event'; event: SimulationEvent }
  | { type: 'complete'; result: SimulationResult };

/** Chiavi che rendono riconoscibile un payload di simulazione. */
const SIMULATION_SHAPE_KEYS = [
  'events', 'eventi', 'narration', 'narrazione', 'summary',
  'actionOutcomes', 'action_outcomes', 'voided', 'rejected',
  'startChat', 'start_chat', 'relationshipChanges', 'relationship_changes',
  'diplomacy', 'worldChanges', 'world_changes', 'targetDate', 'target_date', 'effects',
  'commitments', 'commitmentUpdates', 'commitment_updates',
] as const;

/**
 * Una risposta è «di simulazione» solo se contiene almeno una delle chiavi del
 * contratto. Un oggetto JSON valido ma estraneo (o `{}`) non è accettabile: non
 * deve mai degradare in una simulazione vuota che sembra riuscita.
 */
function hasRecognizableSimulationShape(parsed: unknown): boolean {
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return false;
  return SIMULATION_SHAPE_KEYS.some(key => key in (parsed as Record<string, unknown>));
}

/** Risultato vuoto *deliberato*: usato solo per basi interne, mai come fallback. */
export function emptySimulationResult(): SimulationResult {
  return {
    events: [],
    narration: '',
    diplomacy: [],
    worldChanges: { regionOwners: {}, regionColors: {}, newFeatures: [], deletedFeatures: [] },
    voided: [],
  };
}

/** Estrae oggetti JSON completi anche se il modello li formatta su più righe. */
export function extractCompleteJsonObjects(text: string): any[] {
  const records: any[] = [];
  let start = -1, depth = 0, inString = false, escaped = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (start < 0) {
      if (ch === '{') { start = i; depth = 1; }
      continue;
    }
    if (inString) {
      if (escaped) escaped = false;
      else if (ch === '\\') escaped = true;
      else if (ch === '"') inString = false;
      continue;
    }
    if (ch === '"') inString = true;
    else if (ch === '{') depth++;
    else if (ch === '}' && --depth === 0) {
      const candidate = text.slice(start, i + 1);
      try {
        records.push(JSON.parse(candidate));
      } catch {
        try { records.push(parseJsonLoose(candidate, { mechanic: 'jump' })); }
        catch (e) { if (!(e instanceof LLMContractError)) throw e; /* record non riparabile */ }
      }
      start = -1;
    }
  }
  return records;
}

/** Normalizza un record dello stream usando lo stesso validatore del formato batch. */
export function parseIncrementalSimulationRecord(raw: any): IncrementalSimulationRecord | null {
  if (!raw || typeof raw !== 'object') return null;
  const recordType = normalizedToken(raw.type || raw.recordType || raw.kind);
  const looksLikeEvent = ['event', 'evento'].includes(recordType)
    || (!recordType && typeof firstString(raw.headline, raw.title, raw.titolo) === 'string'
      && (typeof raw.date === 'string' || typeof raw.eventDate === 'string' || typeof raw.data === 'string'));
  if (looksLikeEvent) {
    const candidate = raw.event && typeof raw.event === 'object' ? raw.event : raw;
    const event = parseSimulationResponse(JSON.stringify({ events: [candidate] })).events[0];
    return event ? { type: 'event', event } : null;
  }
  const looksLikeCompletion = ['complete', 'completion', 'final', 'result', 'risultato'].includes(recordType)
    || (!recordType && !Array.isArray(raw.events) && !Array.isArray(raw.eventi)
      && typeof raw.narration === 'string' && (Array.isArray(raw.actionOutcomes) || Array.isArray(raw.action_outcomes)));
  if (looksLikeCompletion) {
    const result = parseSimulationResponse(JSON.stringify({ ...raw, events: [] }));
    return { type: 'complete', result };
  }
  return null;
}

/** Converte l'intero NDJSON in SimulationResult; accetta anche il vecchio JSON batch. */
export function parseIncrementalSimulationResponse(text: string): SimulationResult {
  const records = extractCompleteJsonObjects(text)
    .map(parseIncrementalSimulationRecord)
    .filter((r): r is IncrementalSimulationRecord => !!r);
  if (records.length === 0) return parseSimulationResponse(text);

  const events = records.filter((r): r is Extract<IncrementalSimulationRecord, { type: 'event' }> => r.type === 'event')
    .map(r => r.event);
  const complete = [...records].reverse().find((r): r is Extract<IncrementalSimulationRecord, { type: 'complete' }> => r.type === 'complete');
  // §9.2/T36: eventi emessi ma nessuna chiusura del periodo = budget esaurito
  // prima della destinazione. Il chiamante non può dichiarare il salto
  // completato sulla parola di una risposta troncata.
  return { ...(complete?.result || emptySimulationResult()), events, incomplete: records.length > 0 && !complete };
}

const MAP_CHANGE_TYPES = new Set<MapChange['type']>([
  'transfer', 'create', 'update', 'delete', 'spawn_battalion', 'move_battalion',
  'spawn_unit', 'move_unit', 'remove_unit', 'start_mobilization', 'complete_mobilization',
  'cancel_mobilization', 'create_polity', 'build_facility', 'start_construction',
  'update_construction', 'complete_construction', 'cancel_construction',
]);

const MAP_TYPE_ALIASES: Record<string, { type: MapChange['type']; featureType?: string }> = {
  create_army: { type: 'spawn_unit', featureType: 'army' },
  spawn_army: { type: 'spawn_unit', featureType: 'army' },
  add_army: { type: 'spawn_unit', featureType: 'army' },
  create_battalion: { type: 'spawn_unit', featureType: 'battalion' },
  add_battalion: { type: 'spawn_unit', featureType: 'battalion' },
  create_fleet: { type: 'spawn_unit', featureType: 'fleet' },
  move_army: { type: 'move_unit', featureType: 'army' },
  move_fleet: { type: 'move_unit', featureType: 'fleet' },
  move_troops: { type: 'move_unit', featureType: 'army' },
  move_troop: { type: 'move_unit', featureType: 'army' },
  relocate_unit: { type: 'move_unit' },
  relocate_army: { type: 'move_unit', featureType: 'army' },
  transfer_unit: { type: 'move_unit' },
  occupy: { type: 'transfer' },
  occupied: { type: 'transfer' },
  occupation: { type: 'transfer' },
  occupy_region: { type: 'transfer' },
  annex: { type: 'transfer' },
  annex_region: { type: 'transfer' },
  conquer_region: { type: 'transfer' },
  capture_region: { type: 'transfer' },
  destroy_unit: { type: 'remove_unit' },
  disband_unit: { type: 'remove_unit' },
  mobilize: { type: 'start_mobilization' },
  mobilise: { type: 'start_mobilization' },
  start_recruitment: { type: 'start_mobilization' },
  finish_mobilization: { type: 'complete_mobilization' },
  finish_mobilisation: { type: 'complete_mobilization' },
  start_building: { type: 'start_construction' },
  finish_construction: { type: 'complete_construction' },
  build_fortification: { type: 'complete_construction', featureType: 'fortification' },
  build_base: { type: 'complete_construction', featureType: 'base' },
};

const FEATURE_TYPE_ALIASES: Record<string, string> = {
  troops: 'army', unit: 'battalion', division: 'battalion', brigade: 'battalion',
  fort: 'fortification', fortress: 'fortification', military_base: 'base',
  air_base: 'airbase', airfield: 'airbase', navalbase: 'naval_base',
  naval_base: 'naval_base', missilebase: 'missile_site', missile_base: 'missile_site',
  powerplant: 'power_plant', power_station: 'power_plant', construction: 'construction_site',
};

function normalizedToken(value: unknown): string {
  return typeof value === 'string'
    ? value.trim().toLowerCase().replace(/[\s-]+/g, '_')
    : '';
}

function firstString(...values: unknown[]): string | undefined {
  const found = values.find(value => typeof value === 'string' && value.trim());
  return typeof found === 'string' ? found.trim() : undefined;
}

/** Adapter tollerante per errori di schema tipici dei modelli piccoli. */
function normalizeMapChange(raw: any): MapChange | null {
  if (!raw || typeof raw !== 'object') return null;
  const rawType = normalizedToken(raw.type || raw.changeType || raw.action);
  const alias = MAP_TYPE_ALIASES[rawType];
  const type = alias?.type || rawType as MapChange['type'];
  if (!MAP_CHANGE_TYPES.has(type)) return null;

  const rawFeature = raw.feature && typeof raw.feature === 'object' ? raw.feature : {};
  const featureTypeToken = normalizedToken(
    rawFeature.type || raw.featureType || raw.unitType || raw.facilityType || alias?.featureType,
  );
  const featureType = FEATURE_TYPE_ALIASES[featureTypeToken] || featureTypeToken;
  const featureName = firstString(rawFeature.name, raw.featureName, raw.unitName, raw.facilityName);
  const featureId = firstString(rawFeature.id, raw.featureId, raw.unitId);
  const feature = featureType || featureName || featureId
    ? {
        type: featureType as NonNullable<MapChange['feature']>['type'],
        name: featureName || '',
        ...(featureId ? { id: featureId } : {}),
        ...(rawFeature.metadata && typeof rawFeature.metadata === 'object' && !Array.isArray(rawFeature.metadata)
          ? { metadata: rawFeature.metadata }
          : {}),
      }
    : undefined;

  return {
    type,
    regionName: firstString(raw.regionName, raw.region, raw.province, raw.location),
    regionId: firstString(raw.regionId),
    newOwner: firstString(raw.newOwner, raw.owner, raw.targetOwner),
    newColor: firstString(raw.newColor, raw.color),
    newName: firstString(raw.newName),
    targetRegionName: firstString(raw.targetRegionName, raw.targetRegion, raw.destination, raw.toRegion),
    feature,
  };
}

function normalizeReaction(raw: any): SimulationPolityReaction | null {
  if (!raw || typeof raw !== 'object') return null;
  const polityName = firstString(raw.polityName, raw.polity, raw.country, raw.nation, raw.actor);
  const counterAction = firstString(raw.counterAction, raw.counter_action, raw.measure, raw.actionTaken);
  const response = firstString(raw.response, raw.decision, raw.message, raw.statement, raw.text, counterAction);
  const note = firstString(raw.note, raw.diplomaticNote, raw.chatMessage, raw.messaggio, raw.directMessage);
  if (!polityName || !response) return null;

  const roleAliases: Record<string, SimulationPolityReaction['role']> = {
    counterparty: 'counterparty', controparte: 'counterparty', ally: 'ally', alleato: 'ally',
    mediator: 'mediator', mediatore: 'mediator', observer: 'observer', osservatore: 'observer',
  };
  const stanceAliases: Record<string, SimulationPolityReaction['stance']> = {
    supportive: 'supportive', favorevole: 'supportive', support: 'supportive', accepted: 'supportive',
    opposed: 'opposed', contraria: 'opposed', contrario: 'opposed', rejected: 'opposed',
    conditional: 'conditional', condizionata: 'conditional', condizionato: 'conditional',
    neutral: 'neutral', neutrale: 'neutral', pending: 'neutral',
  };
  return {
    actorId: firstString(raw.actorId, raw.actor_id)?.substring(0, 120),
    optionId: firstString(raw.optionId, raw.option_id)?.substring(0, 160),
    polityName: polityName.substring(0, 200),
    role: roleAliases[normalizedToken(raw.role)] || 'counterparty',
    stance: stanceAliases[normalizedToken(raw.stance || raw.position)] || 'neutral',
    response: response.substring(0, 2_000),
    note: note?.substring(0, 800),
    priority: firstString(raw.priority, raw.interest)?.substring(0, 300),
    counterAction: counterAction?.substring(0, 800),
  };
}

export function parseSimulationResponse(text: string): SimulationResult {
  const emptyWorldChanges = { regionOwners: {}, regionColors: {}, newFeatures: [], deletedFeatures: [] };
  try {
    const parsed = parseJsonLoose<any>(text, { mechanic: 'jump' });
    // Contratto totalmente incompatibile: meglio un errore esplicito che una
    // simulazione vuota presentata come valida.
    if (!hasRecognizableSimulationShape(parsed)) {
      throw new LLMContractError('LLM response does not match the simulation contract', {
        mechanic: 'jump',
        excerpt: text,
      });
    }

    // Normalizzazione severa degli eventi: gli elementi corrotti vengono
    // scartati invece di far fallire il parse
    const events: SimulationEvent[] = [];
    const rawEvents = Array.isArray(parsed.events) ? parsed.events : Array.isArray(parsed.eventi) ? parsed.eventi : [];
    for (const raw of rawEvents) {
      const headline = firstString(raw?.headline, raw?.title, raw?.titolo);
      if (!raw || !headline) continue;
      const reactions = (Array.isArray(raw.reactions) ? raw.reactions : Array.isArray(raw.reazioni) ? raw.reazioni : [])
        .map(normalizeReaction)
        .filter((reaction: SimulationPolityReaction | null): reaction is SimulationPolityReaction => reaction !== null)
        .slice(0, 6);
      events.push({
        headline: headline.substring(0, 500),
        description: firstString(raw.description, raw.detail, raw.descrizione) || '',
        date: firstString(raw.date, raw.eventDate, raw.data) || '',
        mapChanges: (Array.isArray(raw.mapChanges) ? raw.mapChanges : Array.isArray(raw.map_changes) ? raw.map_changes : [])
          .map(normalizeMapChange)
          .filter((change: MapChange | null): change is MapChange => change !== null)
          .slice(0, 40),
        reactions,
      });
    }

    const actionOutcomes: ActionOutcome[] = [];
    const rawOutcomes = Array.isArray(parsed.actionOutcomes)
      ? parsed.actionOutcomes
      : Array.isArray(parsed.action_outcomes) ? parsed.action_outcomes : [];
    const statusAliases: Record<string, ActionOutcome['status']> = {
      accepted: 'accepted', accettato: 'accepted', approved: 'accepted', completed: 'accepted',
      partial: 'partial', parziale: 'partial', pending: 'partial', in_progress: 'partial',
      rejected: 'rejected', rifiutato: 'rejected', denied: 'rejected', voided: 'rejected',
    };
    for (const raw of rawOutcomes) {
      try {
        const normalizedRaw = {
          ...raw,
          actionId: firstString(raw?.actionId, raw?.action_id, raw?.orderId, raw?.order_id),
          action: firstString(raw?.action, raw?.order, raw?.text),
          status: statusAliases[normalizedToken(raw?.status || raw?.esito)] || raw?.status,
          summary: firstString(raw?.summary, raw?.result, raw?.reason, raw?.sintesi) || 'Esito non specificato dal modello.',
          expectedDate: firstString(raw?.expectedDate, raw?.expected_date),
          eventHeadlines: Array.isArray(raw?.eventHeadlines)
            ? raw.eventHeadlines
            : Array.isArray(raw?.event_headlines) ? raw.event_headlines : [],
          completesProjectId: firstString(raw?.completesProjectId, raw?.completes_project_id),
        };
        // Le proprietà opzionali vuote vanno omesse: il contratto distingue
        // assente da stringa vuota.
        if (!normalizedRaw.actionId) delete normalizedRaw.actionId;
        if (!normalizedRaw.action) delete normalizedRaw.action;
        if (!normalizedRaw.expectedDate) delete normalizedRaw.expectedDate;
        if (!normalizedRaw.completesProjectId) delete normalizedRaw.completesProjectId;
        const outcome = parseActionOutcome(normalizedRaw, { allowLegacyText: true });
        actionOutcomes.push({
          ...outcome,
          action: outcome.action || '',
          // Conservato unicamente nel DTO legacy/audit: GameSession non lo usa
          // per chiudere un processo nel percorso canonico.
          completesProcess: typeof raw?.completesProcess === 'string' && raw.completesProcess.trim()
            ? raw.completesProcess.trim().substring(0, 300)
            : undefined,
        });
      } catch (error) {
        if (!(error instanceof DomainContractError)) throw error;
        // Un record individuale corrotto non rende valido un esito inventato.
      }
    }

    const voided: VoidedAction[] = [];
    const rawVoided = Array.isArray(parsed.voided) ? parsed.voided : Array.isArray(parsed.rejected) ? parsed.rejected : [];
    for (const raw of rawVoided) {
      if (!raw || typeof raw.action !== 'string') continue;
      voided.push({ action: raw.action, reason: typeof raw.reason === 'string' ? raw.reason : '' });
    }

    const allowedChatKinds = new Set(['meeting', 'summit', 'negotiation', 'conference', 'ultimatum', 'technical', 'statement']);
    const rawStartChat = Array.isArray(parsed.startChat) ? parsed.startChat : Array.isArray(parsed.start_chat) ? parsed.start_chat : [];
    const startChat: SimulationChatStart[] = rawStartChat
      .filter((c: any) => c && typeof c === 'object')
      .map((c: any) => {
        const legacyName = firstString(c.polityName, c.polity, c.country) || '';
        const rawParticipants = Array.isArray(c.participants)
          ? c.participants
          : Array.isArray(c.countries) ? c.countries : Array.isArray(c.nations) ? c.nations : [];
        const participants = rawParticipants
          .filter((name: unknown): name is string => typeof name === 'string')
          .map((name: string) => name.trim())
          .filter(Boolean);
        if (legacyName && !participants.some((name: string) => name.toLocaleLowerCase('it') === legacyName.toLocaleLowerCase('it'))) {
          participants.unshift(legacyName);
        }
        const uniqueParticipants = participants
          .filter((name: string, index: number, all: string[]) =>
            all.findIndex((candidate: string) => candidate.toLocaleLowerCase('it') === name.toLocaleLowerCase('it')) === index)
          .slice(0, 8);
        if (uniqueParticipants.length === 0) return null;
        const normalizedKind = normalizedToken(c.kind);
        const kindAliases: Record<string, string> = {
          riunione: 'meeting', vertice: 'summit', negoziato: 'negotiation',
          conferenza: 'conference', ultimatum: 'ultimatum', tecnico: 'technical', nota: 'statement',
        };
        const canonicalKind = kindAliases[normalizedKind] || normalizedKind;
        const kind = allowedChatKinds.has(canonicalKind)
          ? canonicalKind as NonNullable<SimulationChatStart['kind']>
          : undefined;
        return {
          // Compatibilità con il percorso/provider precedente.
          polityName: legacyName || uniqueParticipants[0],
          participants: uniqueParticipants,
          topic: (firstString(c.topic, c.message, c.argomento) || '').substring(0, 2_000),
          kind,
          eventHeadline: firstString(c.eventHeadline, c.event_headline, c.eventTitle)?.substring(0, 300),
        };
      })
      .filter((chat: SimulationChatStart | null): chat is SimulationChatStart => chat !== null);
    const rawRelationshipChanges = Array.isArray(parsed.relationshipChanges)
      ? parsed.relationshipChanges
      : Array.isArray(parsed.relationship_changes) ? parsed.relationship_changes : [];
    const relationshipAliases: Record<string, 'ally' | 'neutral' | 'hostile'> = {
      ally: 'ally', allied: 'ally', alleato: 'ally', alleata: 'ally',
      neutral: 'neutral', neutrale: 'neutral',
      hostile: 'hostile', ostile: 'hostile', enemy: 'hostile', nemico: 'hostile',
    };
    const relationshipChanges = rawRelationshipChanges
      .map((c: any) => ({
        from: firstString(c?.from, c?.actor, c?.source),
        to: firstString(c?.to, c?.target, c?.destination),
        relationship: relationshipAliases[normalizedToken(c?.relationship || c?.relation || c?.rapporto)],
        reason: firstString(c?.reason, c?.motivation, c?.motivo),
      }))
      .filter((change: any) => !!change.from && !!change.to && !!change.relationship);

    // M06 µ3: gli effetti strict (ledger/project_tick/shipment/qualitative)
    // sono conservati dal parser e validati nel percorso run strict. Un
    // effetto malformato resta nel risultato: il validatore lo rifiuta.
    const effects = (Array.isArray(parsed.effects) ? parsed.effects : [])
      .filter((e: any) => e && typeof e === 'object')
      .map((e: any) => ({
        kind: e.kind,
        effectId: typeof e.effectId === 'string' ? e.effectId : '',
        cause: typeof e.cause === 'string' ? e.cause : undefined,
        account: typeof e.account === 'string' ? e.account : undefined,
        currency: typeof e.currency === 'string' ? e.currency : undefined,
        amount: typeof e.amount === 'string' ? e.amount : undefined,
        resource: typeof e.resource === 'string' ? e.resource : undefined,
        quantity: typeof e.quantity === 'string' ? e.quantity : undefined,
        projectId: typeof e.projectId === 'string' ? e.projectId : undefined,
        date: typeof e.date === 'string' ? e.date : undefined,
      }));

    return {
      events,
      narration: firstString(parsed.narration, parsed.narrazione, parsed.summary) || 'Il mondo è cambiato...',
      diplomacy: Array.isArray(parsed.diplomacy) ? parsed.diplomacy : [],
      worldChanges: { ...emptyWorldChanges, ...((parsed.worldChanges ?? parsed.world_changes) || {}) },
      actionOutcomes,
      voided,
      startChat,
      // GAMEPLAY-LONG: il registro degli impegni è facoltativo e viene
      // validato dal motore; qui si mantiene solo ciò che è un oggetto.
      ...(Array.isArray(parsed.commitments)
        ? { commitments: parsed.commitments.filter((item: unknown) => item && typeof item === 'object' && !Array.isArray(item)).slice(0, 8) as Array<Record<string, unknown>> }
        : {}),
      ...(Array.isArray(parsed.commitmentUpdates || parsed.commitment_updates)
        ? {
            commitmentUpdates: (parsed.commitmentUpdates || parsed.commitment_updates)
              .filter((item: unknown) => item && typeof item === 'object' && !Array.isArray(item))
              .slice(0, 8) as Array<Record<string, unknown>>,
          }
        : {}),
      relationshipChanges,
      targetDate: firstString(parsed.targetDate, parsed.target_date),
      effects,
    };
  } catch (e) {
    if (e instanceof LLMContractError) {
      console.error(`[PARSER] Contratto LLM violato (${e.mechanic ?? 'jump'}):`, e.message);
      throw e;
    }
    console.error('[PARSER] Failed to parse simulation response:', e);
    throw new LLMContractError('LLM response is not a usable simulation payload', {
      mechanic: 'jump',
      excerpt: text,
    });
  }
}
