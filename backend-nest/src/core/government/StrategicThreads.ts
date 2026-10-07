/** Runtime evidence for the advisor's political interpretation. No persistence,
 * inferred crises or extra model calls: the existing completion composes threads.
 *
 * Historical evidence is identity/context, not proof that a past actor is still
 * active. It is admitted alone only at the opening; after that it needs current
 * or game-history continuity. An explicit resolution retires only the passages it
 * names, never the whole baseline because some unrelated event occurred. */
import { createHash } from 'node:crypto';
import type { VerifiedRecentEvent, VerifiedWorldSnapshot } from './VerifiedWorldSnapshot';

export interface StrategicThreadContext {
  historicalBaseline?: string;
  temporalScope?: { initialDate: string | null; currentDate: string | null };
  strategicHistory?: readonly VerifiedRecentEvent[];
  /** Full eligible chronicle (server-only): keeps evidence keys stable across queries. */
  fullStrategicHistory?: readonly VerifiedRecentEvent[];
  resolveFullHistory?: boolean;
  /** Server-only projection from the full chronicle, before its prompt window is bounded. */
  supersededHistoricalEvidenceKeys?: readonly string[];
}
export interface StrategicThreadEvidence {
  key: string;
  kind: 'historical' | 'history' | 'current';
  text: string;
  sourceRef: string;
}
/** The model interprets a problem/opportunity, not an indicator. Evidence keys
 * are resolved against the server registry before this becomes a UI situation. */
export interface StrategicThread {
  title: string;
  summary: string;
  signalKeys: string[];
  evidenceKeys?: string[];
  kind?: 'problem' | 'opportunity';
}

export const HISTORICAL_CONTINUITY_RULE = 'Dopo l’apertura historical resta utilizzabile per identità, origine, attori e luoghi, ma richiede anche segnali canonici o prove current/history PERTINENTI di continuità. Spiega la relazione. Una signal generica dimostra una condizione attuale, non dimostra da sola che uno specifico attore storico sia ancora responsabile. Usa HistoricalBaseline per identità solo quando current/history rende plausibile la continuità e nulla la contraddice. Una cronaca di risoluzione NON prova una crisi attiva: non resuscitare gruppi disarmati, guerre concluse, programmi terminati o alleanze cambiate. Eventi indipendenti non cancellano altre crisi. Non promuovere intenzioni o atti firmati a esiti.';

function evidenceKey(kind: StrategicThreadEvidence['kind'], sourceRef: string, text: string): string {
  return `${kind}:${createHash('sha256').update(`${sourceRef}\n${text}`).digest('hex').slice(0, 16)}`;
}

function historicalEvidence(context: StrategicThreadContext): StrategicThreadEvidence[] {
  if (!context.temporalScope?.initialDate || !context.historicalBaseline) return [];
  return context.historicalBaseline.split(/\n+|(?<=[.!?])\s+/).map(text => text.trim()).filter(Boolean).slice(0, 24)
    .map(text => ({ key: evidenceKey('historical', 'historicalBaseline', text), kind: 'historical', text, sourceRef: 'historicalBaseline' }));
}

function threadHistory(snapshot: VerifiedWorldSnapshot, context: StrategicThreadContext): VerifiedRecentEvent[] {
  const start = context.temporalScope?.initialDate;
  const chronicle = context.resolveFullHistory && context.fullStrategicHistory ? context.fullStrategicHistory : context.strategicHistory ?? [];
  return [...chronicle, ...snapshot.recent.events]
    .filter(event => !!event.date && !!snapshot.date && event.date <= snapshot.date && (!start || event.date >= start));
}

/**
 * Narrow lexical veto for explicit resolutions tied to a NAMED subject, not
 * semantic inference. Unrelated events, negations and pending orders don't
 * retire a passage; ambiguous prose stays the model's concern.
 */
export function computeSupersededHistoricalEvidenceKeys(snapshot: VerifiedWorldSnapshot, context: StrategicThreadContext): string[] {
  const outcomes = [
    ...threadHistory(snapshot, context).map(event => `${event.headline}\n${event.detail ?? ''}`),
    ...(snapshot.recent.decisions ?? []).filter(decision => decision.status === 'resolved' && decision.resolvedDate
      && snapshot.date && decision.resolvedDate <= snapshot.date).map(decision => decision.resolution ?? ''),
  ].flatMap(text => text.split(/[.!?;\n]+/))
    .filter(text => !/\b(?:non|mai|not|never|potrebbe|dovrebbe|obiettivo|proposta|intende|would|could)\b/i.test(text));
  const retired = new Set(context.supersededHistoricalEvidenceKeys ?? []);
  for (const item of historicalEvidence(context)) {
    const names = item.text.match(/\b[\p{Lu}][\p{L}\p{N}_-]{2,}\b/gu) ?? [];
    const resolved = names.some(name => {
      const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const pattern = new RegExp(`\\b${escaped}\\b(?:\\s+[\\p{L}'’]+){0,3}\\s+(?:ha(?:nno)?\\s+deposto\\s+le\\s+armi|disarmat[oi]|sconfitt[oi]|conclus[oaie]|terminat[oaie]|risolt[oaie]|sciolt[oaie]|cessat[oaie]|cambiat[oaie]|disarmed|defeated|ended|completed|terminated|dissolved|surrendered)\\b`, 'iu');
      return outcomes.some(text => pattern.test(text));
    });
    if (resolved) retired.add(item.key);
  }
  return [...retired];
}

export function buildStrategicThreadEvidence(snapshot: VerifiedWorldSnapshot, context: StrategicThreadContext = {}): StrategicThreadEvidence[] {
  const evidence: StrategicThreadEvidence[] = [];
  const add = (kind: StrategicThreadEvidence['kind'], sourceRef: string, text: string) => {
    const key = evidenceKey(kind, sourceRef, text);
    if (!evidence.some(item => item.key === key)) evidence.push({ key, kind, text, sourceRef });
  };
  for (const event of threadHistory(snapshot, context)) add('history', event.sourceRef, `${event.date}: ${event.headline}. ${event.detail ?? ''}`);
  for (const fact of Object.values(snapshot.facts)) add('current', `facts.${fact.key}`, `${fact.label}: ${fact.value}`);
  for (const project of snapshot.economy.ongoingProjects ?? []) add('current', `ongoingProjects.${project.id}`, JSON.stringify(project));
  for (const commitment of snapshot.diplomacy.commitments ?? []) add('current', `commitments.${commitment.id}`, JSON.stringify(commitment));
  for (const front of snapshot.military.fronts) add('current', front.sourceRef, JSON.stringify(front.raw));
  for (const act of snapshot.recent.signedActs) add('current', `signedActs.${act.id}`, `Decisione presa, NON effetto eseguito: ${act.text}`);
  for (const decision of snapshot.recent.decisions ?? []) add('current', `decisions.${decision.id}`, JSON.stringify(decision));
  // Keep identity/context across turns; retire only passages with a matching
  // resolution, never the whole baseline because some unrelated event occurred.
  const retired = new Set(computeSupersededHistoricalEvidenceKeys(snapshot, context));
  evidence.push(...historicalEvidence(context).filter(item => !retired.has(item.key)));
  return evidence;
}

/**
 * Fail closed on any unknown key. After the opening, a thread may use historical
 * evidence only together with a pertinent canonical signal or with current /
 * game-history continuity: historical identity alone cannot revive a crisis.
 */
export function resolveStrategicThreadEvidence(snapshot: VerifiedWorldSnapshot, keys: readonly string[], context: StrategicThreadContext, hasCurrentSignals = false): StrategicThreadEvidence[] {
  // Risoluzione su tutta la cronaca eleggibile: una card citata in un briefing
  // deve restare risolvibile anche se la finestra del prompt cambia con la query.
  const registry = new Map(buildStrategicThreadEvidence(snapshot, context.fullStrategicHistory ? { ...context, resolveFullHistory: true } : context).map(item => [item.key, item]));
  const resolved = [...new Set(keys)].map(key => {
    const evidence = registry.get(key);
    if (!evidence) throw new Error('Unknown or stale strategic evidence key');
    return evidence;
  });
  const atOpening = !!context.temporalScope?.initialDate && snapshot.date === context.temporalScope.initialDate
    && snapshot.turn !== null && snapshot.turn <= 1;
  if (!atOpening && resolved.some(item => item.kind === 'historical') && !hasCurrentSignals
    && !resolved.some(item => item.kind === 'current' || item.kind === 'history')) {
    throw new Error('Historical evidence requires current/history continuity after opening');
  }
  return resolved;
}

export function renderStrategicThreadEvidence(snapshot: VerifiedWorldSnapshot, context: StrategicThreadContext): string {
  return [
    '[STRATEGIC THREAD EVIDENCE — riferimenti server-side per problemi e opportunità]',
    JSON.stringify(buildStrategicThreadEvidence(snapshot, context)),
    'Prima interpreta un STRATEGIC THREAD: cosa accade, attori/luoghi documentati, posta politica, vincoli e alternative. Poi rendilo advisor_situation nella STESSA risposta; non emettere un secondo elenco o una seconda chiamata. Chat e card devono raccontare lo stesso mondo.',
    'Le evidenceKeys citano SOLO questo registro. I segnali pertinenti vanno comunque collegati: sono prove e vincoli, NON il nome o l’identità del problema. Non inventare chiavi, fatti, attori o capacità.',
    'All’apertura una prova historical pertinente può sostenere la continuità politica immediata se CURRENT STATE non la contraddice, anche senza signalKeys. Non trasforma guerre storiche in guerre registrate, né crea forze, territori, accordi, infrastrutture o risorse. Un evento remoto o concluso non è una crisi attuale.',
    'CURRENT STATE > PLAYER HISTORY > HISTORICAL BASELINE. Se una crisi è risolta, un programma concluso o un’alleanza cambiata, NON riproporre la vecchia situazione: descrivi semmai conseguenze o opportunità attuali provate. Gli atti firmati non sono effetti eseguiti.',
    HISTORICAL_CONTINUITY_RULE,
  ].join('\n');
}
