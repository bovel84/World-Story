/** Runtime evidence for the advisor's political interpretation. No persistence,
 * inferred crises or extra model calls: the existing completion composes threads. */
import { createHash } from 'node:crypto';
import type { VerifiedRecentEvent, VerifiedWorldSnapshot } from './VerifiedWorldSnapshot';

export interface StrategicThreadContext {
  historicalBaseline?: string;
  temporalScope?: { initialDate: string | null; currentDate: string | null };
  strategicHistory?: readonly VerifiedRecentEvent[];
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

export function buildStrategicThreadEvidence(snapshot: VerifiedWorldSnapshot, context: StrategicThreadContext = {}): StrategicThreadEvidence[] {
  const evidence: StrategicThreadEvidence[] = [];
  const add = (kind: StrategicThreadEvidence['kind'], sourceRef: string, text: string) => {
    const key = `${kind}:${createHash('sha256').update(`${sourceRef}\n${text}`).digest('hex').slice(0, 16)}`;
    if (!evidence.some(item => item.key === key)) evidence.push({ key, kind, text, sourceRef });
  };
  const start = context.temporalScope?.initialDate;
  const history = [...(context.strategicHistory ?? []), ...snapshot.recent.events]
    .filter(event => event.date && snapshot.date && event.date <= snapshot.date && (!start || event.date >= start));
  for (const event of history) add('history', event.sourceRef, `${event.date}: ${event.headline}. ${event.detail ?? ''}`);
  for (const fact of Object.values(snapshot.facts)) add('current', `facts.${fact.key}`, `${fact.label}: ${fact.value}`);
  for (const project of snapshot.economy.ongoingProjects ?? []) add('current', `ongoingProjects.${project.id}`, JSON.stringify(project));
  for (const commitment of snapshot.diplomacy.commitments ?? []) add('current', `commitments.${commitment.id}`, JSON.stringify(commitment));
  for (const front of snapshot.military.fronts) add('current', front.sourceRef, JSON.stringify(front.raw));
  for (const act of snapshot.recent.signedActs) add('current', `signedActs.${act.id}`, `Decisione presa, NON effetto eseguito: ${act.text}`);
  for (const decision of snapshot.recent.decisions ?? []) add('current', `decisions.${decision.id}`, JSON.stringify(decision));

  // Historical continuity is an opening-only permission, not a claim that a
  // past war/asset exists in the engine. Any intervening game record disables
  // baseline-only grounding, conservatively including incomplete histories.
  // Thus even an old resolution outside the bounded history window cannot be
  // undone merely by citing the immutable baseline again years later.
  const atOpening = !!start && snapshot.date === start && snapshot.turn !== null && snapshot.turn <= 1;
  const interveningState = history.length || snapshot.recent.orders.length || snapshot.recent.consequences.length
    || snapshot.recent.signedActs.length || (snapshot.recent.decisions?.length ?? 0) || snapshot.changes.available;
  if (atOpening && !interveningState && context.historicalBaseline) {
    const passages = context.historicalBaseline.split(/\n+|(?<=[.!?])\s+/).map(text => text.trim()).filter(Boolean).slice(0, 24);
    for (const text of passages) add('historical', 'historicalBaseline', text);
  }
  return evidence;
}

export function resolveStrategicThreadEvidence(snapshot: VerifiedWorldSnapshot, keys: readonly string[], context: StrategicThreadContext): StrategicThreadEvidence[] {
  const registry = new Map(buildStrategicThreadEvidence(snapshot, context).map(item => [item.key, item]));
  return [...new Set(keys)].map(key => {
    const evidence = registry.get(key);
    if (!evidence) throw new Error('Unknown or stale strategic evidence key');
    return evidence;
  });
}

export function renderStrategicThreadEvidence(snapshot: VerifiedWorldSnapshot, context: StrategicThreadContext): string {
  return [
    '[STRATEGIC THREAD EVIDENCE — riferimenti server-side per problemi e opportunità]',
    JSON.stringify(buildStrategicThreadEvidence(snapshot, context)),
    'Prima interpreta un STRATEGIC THREAD: cosa accade, attori/luoghi documentati, posta politica, vincoli e alternative. Poi rendilo advisor_situation nella STESSA risposta; non emettere un secondo elenco o una seconda chiamata. Chat e card devono raccontare lo stesso mondo.',
    'Le evidenceKeys citano SOLO questo registro. I segnali pertinenti vanno comunque collegati: sono prove e vincoli, NON il nome o l’identità del problema. Non inventare chiavi, fatti, attori o capacità.',
    'All’apertura una prova historical pertinente può sostenere la continuità politica immediata se CURRENT STATE non la contraddice, anche senza signalKeys. Non trasforma guerre storiche in guerre registrate, né crea forze, territori, accordi, infrastrutture o risorse. Un evento remoto o concluso non è una crisi attuale.',
    'CURRENT STATE > PLAYER HISTORY > HISTORICAL BASELINE. Se una crisi è risolta, un programma concluso o un’alleanza cambiata, NON riproporre la vecchia situazione: descrivi semmai conseguenze o opportunità attuali provate. Gli atti firmati non sono effetti eseguiti.',
    'Dopo l’apertura o in presenza di storia/decisioni della partita le prove historical non sono ammesse come base di una scheda: la baseline resta solo contesto remoto. Servono prove current/history pertinenti al problema, non un indicatore generico usato per resuscitare la vecchia crisi. Una cronaca di risoluzione NON prova una crisi attiva.',
  ].join('\n');
}
