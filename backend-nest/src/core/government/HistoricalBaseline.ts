/** Real history < startDate; game history >= startDate. Never a source of current assets/effects. */
import { hasTechnicalVocabulary } from './RealitySignals';

export interface HistoricalBaselineRequest {
  worldName: string;
  polityId: string;
  countryName: string | null;
  startDate: string;
  premise?: string | null;
}

export interface PolityHistoricalBaseline {
  polityId: string;
  countryName: string;
  startDate: string;
  historicalBackground: string;
  generatedAt: string;
  version: number;
}

export const HISTORICAL_BASELINE_RULE = `Gerarchia delle fonti: CURRENT STATE > PLAYER HISTORY > HISTORICAL BASELINE.
PLAYER HISTORY indica l'intera GAME HISTORY: decisioni, eventi ed esiti del giocatore E degli NPC dopo la divergenza, non solo le azioni del Presidente.
La HISTORICAL BASELINE è materiale di ragionamento interno, non un testo da recitare: non elencarla come Wikipedia, non ripeterne date e fatti in sequenza, non usare intestazioni tecniche, non dire continuamente «storicamente» e non ricominciare dalle origini del paese dopo il primo turno.
La HISTORICAL BASELINE spiega il passato, non fornisce asset o effetti attuali. Puoi usare nomi propri, luoghi, governi, organizzazioni, guerre, trattati ed eventi storici REALI anteriori allo startDate quando ne sei sufficientemente certo. Non inventare dettagli per riempire lacune: niente cifre precise incerte, infrastrutture non note, unità specifiche inaffidabili, trattati inesistenti o eventi non reali.
Un fatto storico non prova che qualcosa esista ancora: un porto, un'alleanza o un'unità presenti nel passato non autorizzano ad affermarli nel presente. L'assenza di un dettaglio nel presente NON prova che sia storicamente inesistente. Per il presente servono conferme del current state: non ripristinare alleanze, confini o beni distrutti dalla storia alternativa.
REAL HISTORY < START DATE; START DATE = divergenza; GAME HISTORY >= START DATE. La relazione CORRENTE prevale sulle relazioni storiche. La baseline influenza l'interpretazione e non determina eventi futuri.`;

export const HISTORICAL_BASELINE_SYSTEM = `Sei lo storico di riferimento del mondo di un gioco di storia alternativa. Ricostruisci il passato REALE della polity prima della data di divergenza. Usa SOLO fatti storici solidi e largamente noti; non inventare e non riempire le lacune con dettagli plausibili.
Rispondi SOLO con JSON {"entries":[{"date":"YYYY-MM-DD oppure YYYY-MM oppure YYYY","text":"background politico e strategico","confidence":"high"|"medium"|"low"}]}.
Assegna "high" solo a un fatto che conosci con certezza e che è largamente documentato: nomi propri, eventi, guerre, trattati e istituzioni realmente esistiti. Usa "medium"/"low" per tutto ciò che è incerto, approssimativo o troppo specifico. Verranno usate SOLO le entry "high".
Ogni entry deve avere una data reale, o l'ultimo periodo sicuramente anteriore alla divergenza cui si riferisce. Non retrodatare eventi successivi. Non aggiungere un riepilogo non datato.
Preferisci poche entry concrete a molte frasi generiche: se non conosci abbastanza fatti affidabili, restituisci meno entry o nessuna.`;

export function buildHistoricalBaselinePrompt(request: HistoricalBaselineRequest): string {
  return [
    `Paese: ${request.countryName?.trim() || request.polityId} (${request.polityId}). Mondo: ${request.worldName || 'non indicato'}. Punto di divergenza: ${request.startDate}.`,
    request.premise ? `Premessa del mondo (non una fonte di eventi storici): ${request.premise.slice(0, 1200)}` : '',
    'Racconta come il paese è arrivato alla data di divergenza: evoluzione politica, conflitti, istituzioni, economia, società, alleanze e rapporti regionali realmente accaduti prima di quella data.',
    'Usa SOLO fatti storici solidi e largamente noti, con elementi identificativi concreti: nomi propri di persone, luoghi, istituzioni, partiti, guerre, trattati ed eventi realmente esistiti. Una frase che potrebbe descrivere quasi qualsiasi paese NON è accettata: evita «decenni difficili», «importanti trasformazioni» o «rapporti regionali» senza nomi.',
    'Per ogni entry indica "confidence": "high" solo se il fatto è certo e largamente documentato; usa "medium" o "low" per informazioni incerte, approssimative o troppo specifiche. Verranno usate SOLO le entry "high". Di norma 4-10 entry per circa 500-1200 token, non un\'enciclopedia: se non conosci abbastanza fatti affidabili per questo paese, restituisci poche entry o nessuna. Meglio una baseline corta che una generica.',
    `Ogni date deve essere STRETTAMENTE anteriore a ${request.startDate}. Non raccontare eventi successivi al punto di divergenza o coincidenti con esso, nemmeno se li conosci. Se sai solo l'anno/mese, l'intero periodo deve essere anteriore: nello stesso anno della divergenza servono date chiaramente precedenti.`,
    HISTORICAL_BASELINE_RULE,
  ].filter(Boolean).join('\n\n');
}

export const HISTORICAL_BASELINE_TIMEOUT_MS = 12_000;

/** Optional history must not stall play; cancellation belongs to this waiter only. */
export function awaitHistoricalBaseline<T>(promise: Promise<T>, signal?: AbortSignal, timeoutMs = HISTORICAL_BASELINE_TIMEOUT_MS, onTimeout?: () => void): Promise<T | null> {
  return new Promise(resolve => {
    let settled = false;
    const finish = (value: T | null) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      signal?.removeEventListener('abort', abort);
      resolve(value);
    };
    const abort = () => finish(null);
    const timer = setTimeout(() => { onTimeout?.(); finish(null); }, timeoutMs);
    void promise.then(finish, () => finish(null));
    if (signal?.aborted) { finish(null); return; }
    signal?.addEventListener('abort', abort, { once: true });
  });
}

const MAX_CHARS = 6_000;
const MIN_CHARS = 200;

/** Words that are capitalized for grammar, not because they identify the country. */
const GENERIC_STOPWORDS = new Set(['il', 'lo', 'la', 'i', 'gli', 'le', 'un', 'uno', 'una', 'nel', 'nella', 'negli', 'nelle',
  'questo', 'questa', 'questi', 'queste', 'dopo', 'prima', 'durante', 'anche', 'ma', 'però', 'tuttavia', 'inoltre', 'quindi',
  'the', 'a', 'an', 'in', 'after', 'before', 'during', 'but', 'however', 'also', 'this', 'these', 'those']);
const YEAR = /\b(?:1[89]\d{2}|20\d{2})\b/g;

/**
 * A baseline that could plausibly describe almost any country is not valid.
 * Counts concrete anchors: unambiguous years and proper nouns (not sentence-initial,
 * not generic function words). Two or more anchors are required.
 */
export function isGenericHistoricalBaseline(text: string): boolean {
  const body = text.normalize('NFKC');
  const years = new Set(body.match(YEAR) ?? []);
  const proper = new Set<string>();
  for (const sentence of body.split(/(?<=[.!?;:])\s+/)) {
    const words = sentence.replace(/^[\s"'«(]+/, '').split(/\s+/);
    for (let index = 1; index < words.length; index += 1) {
      const token = words[index].replace(/^[«"'(]+|[»"'.,;:)\]]+$/g, '');
      if (token.length < 3 || !/^[A-ZÀ-Ý]/u.test(token)) continue;
      // Elided articles (L’eredità) are capitalized by grammar, not identity.
      if (/^[A-ZÀ-Ý][\p{L}]*['’][\p{Ll}]/u.test(token)) continue;
      const key = token.toLocaleLowerCase('it');
      if (!GENERIC_STOPWORDS.has(key)) proper.add(key);
    }
  }
  return years.size + proper.size < 2;
}

/** Last possible date of a dated fact: unknown day/month is handled conservatively. */
function latestDate(raw: string): string | null {
  if (!/^\d{4}(?:-\d{2})?(?:-\d{2})?$/.test(raw)) return null;
  const [year, month, day] = raw.split('-').map(Number);
  if (year < 1 || (month !== undefined && (month < 1 || month > 12))) return null;
  if (month !== undefined && day === undefined) {
    const end = new Date(`${raw}-01T00:00:00Z`);
    end.setUTCMonth(end.getUTCMonth() + 1);
    end.setUTCDate(0);
    return end.toISOString().slice(0, 10);
  }
  const full = day !== undefined ? raw : `${raw}-12-31`;
  const parsed = new Date(`${full}T00:00:00Z`);
  return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === full ? full : null;
}

const MONTHS = ['gennaio|january', 'febbraio|february', 'marzo|march', 'aprile|april', 'maggio|may', 'giugno|june',
  'luglio|july', 'agosto|august', 'settembre|september', 'ottobre|october', 'novembre|november', 'dicembre|december'];
const NAMED_DATE = new RegExp(`\\b(?:(\\d{1,2})\\s+)?(${MONTHS.join('|')})\\s+(\\d{4})\\b`, 'gi');

/** Explicit dates and ambiguous same-year facts are rejected, including legacy prose. */
function outsideCutoff(sentence: string, startDate: string): boolean {
  let blocked = false;
  const check = (raw: string) => { const last = latestDate(raw); if (!last || last >= startDate) blocked = true; };
  let remaining = sentence.replace(/\b\d{4}-\d{2}(?:-\d{2})?\b/g, raw => { check(raw); return ''; });
  remaining = remaining.replace(NAMED_DATE, (_raw, day: string | undefined, name: string, year: string) => {
    const month = MONTHS.findIndex(pattern => new RegExp(`^(?:${pattern})$`, 'i').test(name)) + 1;
    check(`${year}-${String(month).padStart(2, '0')}${day ? `-${String(day).padStart(2, '0')}` : ''}`);
    return '';
  });
  for (const match of remaining.matchAll(/\b\d{4}\b/g)) check(match[0]);
  return blocked;
}

function cutAtSentence(text: string, limit: number): string {
  if (text.length <= limit) return text;
  const head = text.slice(0, limit);
  const lastStop = Math.max(head.lastIndexOf('. '), head.lastIndexOf('\n'));
  return (lastStop > limit / 2 ? head.slice(0, lastStop + 1) : head).trim();
}

/** Fail closed on unknown cutoff; no assertion that this is a universal historical fact checker. */
export function sanitizeHistoricalBaseline(raw: unknown, startDate: string, options: { requireSpecific?: boolean } = {}): string | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(startDate) || latestDate(startDate) !== startDate) return null;
  const lines = String(raw ?? '').replace(/```[^]*?(?:```|$)/g, '\n').split('\n');
  const kept = lines.flatMap(line => {
    if (hasTechnicalVocabulary(line) || /^\s*(?:[-*#]|\d+\.)?\s*(?:FACT|INFERENCE|FORECAST|PROPOSAL)\s*[—–:-]/i.test(line)) return [];
    return line.split(/(?<=[.!?])\s+/).filter(sentence => sentence.trim() && !outsideCutoff(sentence, startDate));
  });
  const body = cutAtSentence(kept.join(' ').trim(), MAX_CHARS);
  if (body.length < MIN_CHARS) return null;
  if (options.requireSpecific && isGenericHistoricalBaseline(body)) return null;
  return body;
}

/** Short relevant excerpt for NPC/minister/late-game contexts, with no new model call. */
export function historicalBaselineExcerpt(text: string, query = '', limit = 1_800): string {
  const parts = text.split(/(?<=[.!?])\s+|\n/).filter(Boolean);
  const terms = [...new Set(query.toLocaleLowerCase().match(/[\p{L}]{4,}/gu) ?? [])].slice(0, 20);
  const ranked = parts.map((part, index) => ({ part, index, score: terms.filter(term => part.toLocaleLowerCase().includes(term)).length }))
    .sort((a, b) => b.score - a.score || a.index - b.index);
  const picked: typeof ranked = [];
  let length = 0;
  for (const item of ranked) {
    if (length + item.part.length > limit) continue;
    picked.push(item); length += item.part.length + 1;
  }
  return picked.sort((a, b) => a.index - b.index).map(item => item.part).join(' ');
}

export function renderHistoricalBaseline(baseline: string, request: Pick<HistoricalBaselineRequest, 'countryName' | 'polityId' | 'startDate'>): string {
  return `[HISTORICAL BASELINE — ${(request.countryName?.trim() || request.polityId).toLocaleUpperCase('it')} — ${request.startDate}]\n${baseline.trim()}\n${HISTORICAL_BASELINE_RULE}`;
}

export function renderPolityHistoricalBaselines(baselines: readonly PolityHistoricalBaseline[], query = ''): string {
  if (!baselines.length) return '';
  return ['[POLITY HISTORICAL BASELINES — spiegano il passato, non definiscono il presente]',
    ...baselines.slice(0, 5).map(baseline => `[${baseline.countryName} (${baseline.polityId}) — prima di ${baseline.startDate}]\n${historicalBaselineExcerpt(baseline.historicalBackground, query)}`),
    HISTORICAL_BASELINE_RULE].join('\n');
}

/** New generations require dated, high-confidence entries; legacy prose is supported only by the read guard. */
export async function generateHistoricalBaseline(request: HistoricalBaselineRequest, generate: (system: string, prompt: string) => Promise<string>): Promise<string | null> {
  try {
    const raw = (await generate(HISTORICAL_BASELINE_SYSTEM, buildHistoricalBaselinePrompt(request))).trim();
    const json = raw.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '');
    if (json.startsWith('{')) {
      const parsed: unknown = JSON.parse(json);
      if (!parsed || typeof parsed !== 'object' || !('entries' in parsed) || !Array.isArray(parsed.entries)) return null;
      const texts = parsed.entries.slice(0, 32).flatMap((entry: unknown) => {
        if (!entry || typeof entry !== 'object' || !('date' in entry) || !('text' in entry) || !('confidence' in entry)) return [];
        const { date, text, confidence } = entry as { date?: unknown; text?: unknown; confidence?: unknown };
        if (typeof date !== 'string' || typeof text !== 'string') return [];
        // Only explicitly high-confidence facts are persisted; medium/low are dropped.
        if (typeof confidence !== 'string' || confidence.toLowerCase() !== 'high') return [];
        const last = latestDate(date);
        return last && last < request.startDate ? [text] : [];
      });
      return sanitizeHistoricalBaseline(texts.join(' '), request.startDate, { requireSpecific: true });
    }
    return null;
  } catch { return null; }
}
