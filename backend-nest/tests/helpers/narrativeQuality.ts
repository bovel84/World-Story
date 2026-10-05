/**
 * World Story — Rubrica offline della qualità dei dispacci
 * (WS-NARR-DISPATCH-PAX-QUALITY, Passo 1)
 * ========================================================
 * Valuta **risposte LLM salvate o mockate** con sei criteri misurabili. Non
 * chiama alcun provider: è un punteggio deterministico e ripetibile, pensato per
 * confrontare un corpus «prima» e un corpus «dopo» sullo stesso scenario.
 *
 * Le metriche sono volutamente prudenti: misurano ciò che si può osservare nel
 * testo (contraddizioni a fatti dichiarati, fughe di futuro, varietà delle
 * aperture), non la verità storica complessiva. Il report dice cosa non è stato
 * possibile verificare con un provider reale.
 */

export type EvalOutcome = 'accepted' | 'partial' | 'rejected';

/** Un ordine dello scenario, con i fatti canonici che il dispaccio non può contraddire. */
export interface EvalOrder {
  id: string;
  text: string;
  /** Esito deciso dal motore: il dispaccio non può raccontarne un altro. */
  expectedOutcome: EvalOutcome;
  /** Data di gioco del turno (nessun riferimento oltre questa). */
  gameDate: string;
  /** Sostanza canonica: serve solo come documentazione nel corpus. */
  structuredFacts: string[];
  /** Frasi la cui presenza contraddice un fatto strutturato. */
  forbiddenClaims: string[];
  /**
   * Cause canoniche ammesse per questo ordine: la causalità vale solo se il
   * dispaccio ne cita almeno una. Una frase causale elegante ma inventata non
   * prende il massimo.
   */
  allowedCauses?: string[];
  /** Ancore testuali obbligatorie (es. nomi/atti documentati). */
  requiredAnchors?: string[];
}

/** Un dispaccio generato (mock o salvato) per un ordine. */
export interface EvalDispatch {
  orderId: string;
  headline: string;
  body: string;
  /** Esito raccontato dal testo; deve coincidere con quello atteso. */
  outcome: EvalOutcome;
}

export interface EvalScenario {
  id: string;
  preset: string;
  orders: EvalOrder[];
  dispatches: EvalDispatch[];
}

export type CriterionKey = 'facts' | 'success' | 'causality' | 'language' | 'future' | 'variety';

export const CRITERIA: Record<CriterionKey, string> = {
  facts: 'Fatti strutturati',
  success: 'Successo',
  causality: 'Causalità',
  language: 'Lingua',
  future: 'Futuro',
  variety: 'Varietà',
};

// --- euristiche (parole/frasi italiane) ------------------------------------

const CAUSE_MARKERS = [
  'perché', 'poiché', 'a causa', 'in risposta', 'dopo che', 'a seguito',
  'in seguito', 'come conseguenza', 'dal momento che', 'per via di',
  'costretta da', 'costretto da', 'spinto da', 'provocato da', 'dopo la',
  'dopo il', 'dopo tre', 'dopo due', 'sulla scia',
];

const FREE_SUCCESS_MARKERS = [
  'conquista', 'conquistò', 'annette', 'annetté', 'sottomette', 'schiaccia',
  'vittoria totale', 'senza sforzo', 'in una settimana', 'facilmente',
  'definitivamente sconfitto', 'capitola subito',
];

const ITALIAN_STOPWORDS = [
  'il', 'la', 'lo', 'gli', 'le', 'un', 'una', 'che', 'di', 'del', 'della',
  'per', 'con', 'nel', 'nella', 'si', 'sono', 'ha', 'hanno', 'governo',
  'nazione', 'dopo', 'entro', 'oltre', 'anche',
];

const wordCount = (text: string): number =>
  String(text || '').trim().split(/\s+/).filter(Boolean).length;

const lower = (text: string): string => String(text || '').toLowerCase();

const containsAny = (text: string, needles: readonly string[]): boolean =>
  needles.some(n => lower(text).includes(lower(n)));

function openingKey(dispatch: EvalDispatch): string {
  return lower(dispatch.headline).split(/\s+/).slice(0, 3).join(' ');
}

/** Anni e date ISO nel testo, per il criterio «nessuna fuga di futuro». */
function referencedYears(text: string): number[] {
  const years = new Set<number>();
  for (const m of text.matchAll(/\b(1[89]\d{2}|20\d{2}|21\d{2})\b/g)) years.add(Number(m[1]));
  for (const m of text.matchAll(/\b(\d{4})-(\d{2})-(\d{2})\b/g)) years.add(Number(m[1]));
  return [...years];
}

function isoDates(text: string): string[] {
  return [...text.matchAll(/\b(\d{4}-\d{2}-\d{2})\b/g)].map(m => m[1]);
}

// --- punteggi --------------------------------------------------------------

/** 1 = nessun fatto strutturato contraddetto. */
export function scoreFacts(dispatch: EvalDispatch, order: EvalOrder): number {
  const text = `${dispatch.headline} ${dispatch.body}`;
  return containsAny(text, order.forbiddenClaims) ? 0 : 1;
}

/**
 * 1 = nessun successo gratuito: se il motore ha deciso partial/rejected, il
 * dispaccio non può raccontare una vittoria piena.
 */
export function scoreSuccess(dispatch: EvalDispatch, order: EvalOrder): number {
  if (order.expectedOutcome === 'accepted') return 1;
  const text = lower(`${dispatch.headline} ${dispatch.body}`);
  const claimsFullSuccess = containsAny(text, FREE_SUCCESS_MARKERS);
  // Un rejected che racconta comunque un esito pieno è un successo gratuito.
  return claimsFullSuccess || dispatch.outcome === 'accepted' ? 0 : 1;
}

/**
 * 1 = la notizia espone una causa specifica **canonica**, non solo l'esito.
 *
 * Deve esserci una struttura causale linguistica E almeno una causa/ancora
 * ammessa dall'ordine. «A causa di X» con X inventato vale 0: la rubrica non
 * premia la causalità dichiarata, solo quella supportata dalla fixture.
 */
export function scoreCausality(dispatch: EvalDispatch, order: EvalOrder): number {
  const text = `${dispatch.headline} ${dispatch.body}`;
  if (!containsAny(text, CAUSE_MARKERS)) return 0;
  const allowed = [...(order.allowedCauses || []), ...(order.requiredAnchors || [])];
  if (allowed.length === 0) return 0;
  return containsAny(text, allowed) ? 1 : 0;
}

/** 1 = italiano chiaro: parole italiane presenti e corpo entro una misura leggibile. */
export function scoreLanguage(dispatch: EvalDispatch): number {
  const text = `${dispatch.headline} ${dispatch.body}`;
  const words = wordCount(text);
  const hasItalian = containsAny(text, ITALIAN_STOPWORDS);
  return hasItalian && words >= 20 && words <= 110 ? 1 : 0;
}

/** 1 = nessuna data/anno oltre la data di gioco. */
export function scoreFuture(dispatch: EvalDispatch, order: EvalOrder): number {
  const gameYear = Number(order.gameDate.slice(0, 4));
  const text = `${dispatch.headline} ${dispatch.body}`;
  const futureYear = referencedYears(text).some(y => y > gameYear);
  const futureDate = isoDates(text).some(d => d > order.gameDate);
  return futureYear || futureDate ? 0 : 1;
}

export interface DispatchScore {
  orderId: string;
  facts: number;
  success: number;
  causality: number;
  language: number;
  future: number;
}

export function scoreDispatch(dispatch: EvalDispatch, order: EvalOrder): DispatchScore {
  return {
    orderId: dispatch.orderId,
    facts: scoreFacts(dispatch, order),
    success: scoreSuccess(dispatch, order),
    causality: scoreCausality(dispatch, order),
    language: scoreLanguage(dispatch),
    future: scoreFuture(dispatch, order),
  };
}

/**
 * Varietà del corpus (0..1): media fra la quota di aperture distinte e la
 * ricchezza lessicale (type-token ratio) dei dispacci. Due dispacci che iniziano
 * con le stesse tre parole abbassano il punteggio.
 */
export function scoreVariety(scenario: EvalScenario): number {
  const dispatches = scenario.dispatches;
  if (dispatches.length === 0) return 0;
  const openings = new Set(dispatches.map(openingKey));
  const openingRatio = openings.size / dispatches.length;
  const tokens: string[] = [];
  for (const d of dispatches) {
    tokens.push(...lower(`${d.headline} ${d.body}`).split(/[^a-zàèéìòù]+/).filter(t => t.length > 2));
  }
  const types = new Set(tokens);
  const ttr = tokens.length ? types.size / tokens.length : 0;
  // Normalizza il TTR: sotto 0.5 è già discreto per testi brevi.
  const richness = Math.min(1, ttr / 0.6);
  return Number(((openingRatio * 0.6) + (richness * 0.4)).toFixed(3));
}

export interface ScenarioScore {
  scenarioId: string;
  preset: string;
  criteria: Record<CriterionKey, number>;
  /** Totale su 5 criteri × ordini + varietà. */
  total: number;
  max: number;
  perDispatch: DispatchScore[];
}

/** Punteggio complessivo e per criterio di uno scenario valutato. */
export function scoreScenario(scenario: EvalScenario): ScenarioScore {
  const byOrder = new Map(scenario.orders.map(o => [o.id, o]));
  const perDispatch: DispatchScore[] = [];
  for (const dispatch of scenario.dispatches) {
    const order = byOrder.get(dispatch.orderId);
    if (!order) continue;
    perDispatch.push(scoreDispatch(dispatch, order));
  }
  const sum = (key: keyof DispatchScore): number =>
    perDispatch.reduce((acc, s) => acc + Number(s[key]), 0);
  const n = perDispatch.length;
  const criteria: Record<CriterionKey, number> = {
    facts: n ? sum('facts') / n : 0,
    success: n ? sum('success') / n : 0,
    causality: n ? sum('causality') / n : 0,
    language: n ? sum('language') / n : 0,
    future: n ? sum('future') / n : 0,
    variety: scoreVariety(scenario),
  };
  const perOrderTotal = perDispatch.reduce(
    (acc, s) => acc + s.facts + s.success + s.causality + s.language + s.future,
    0,
  );
  const total = Number((perOrderTotal + criteria.variety).toFixed(3));
  return { scenarioId: scenario.id, preset: scenario.preset, criteria, total, max: n * 5 + 1, perDispatch };
}

/** Riga leggibile per la tabella del report. */
export function formatScoreLine(score: ScenarioScore): string {
  const pct = (v: number) => `${Math.round(v * 100)}%`;
  return [
    score.scenarioId,
    `facts ${pct(score.criteria.facts)}`,
    `success ${pct(score.criteria.success)}`,
    `causality ${pct(score.criteria.causality)}`,
    `language ${pct(score.criteria.language)}`,
    `future ${pct(score.criteria.future)}`,
    `variety ${pct(score.criteria.variety)}`,
    `total ${score.total}/${score.max}`,
  ].join(' | ');
}
