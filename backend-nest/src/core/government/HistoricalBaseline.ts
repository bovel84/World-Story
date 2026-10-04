/**
 * WS-GOV-ADVISOR-HISTORICAL-BASELINE — REAL HISTORY → START DATE → PLAYER HISTORY.
 *
 * Il Consulente non deve trattare la storia reale del paese come una conoscenza
 * implicita del modello: diventa un BLOCCO ESPLICITO del contesto, costruito per
 * il paese selezionato, generato una volta e reso canonico per la partita.
 *
 * Gerarchia delle fonti (nessuna eccezione):
 *   CURRENT STATE  >  PLAYER HISTORY  >  HISTORICAL BASELINE
 * La storia spiega il mondo, non contraddice la simulazione: se un porto
 * esisteva nel 2000 ma la partita lo distrugge, prevale il world state corrente.
 *
 * Taglio temporale rigido: `date < startDate` → storia reale;
 * `date >= startDate` → solo storia della partita. Gli eventi reali successivi
 * alla data iniziale non sono un futuro predeterminato e vengono scartati
 * deterministicamente dal testo generato.
 */
import { hasTechnicalVocabulary } from './RealitySignals';

export interface HistoricalBaselineRequest {
  worldName: string;
  /** Codice canonico del paese (es. `KHM`). */
  polityId: string;
  /** Nome leggibile quando disponibile; altrimenti si usa il codice. */
  countryName: string | null;
  startDate: string;
  /** Premessa del mondo (base_prompt): contesto, NON fonte di fatti sul paese. */
  premise?: string | null;
}

/** Regole di verità: la baseline spiega, il current state decide. */
export const HISTORICAL_BASELINE_RULE = `Gerarchia delle fonti: CURRENT STATE > PLAYER HISTORY > HISTORICAL BASELINE.
La HISTORICAL BASELINE spiega perché il paese è così oggi e può descrivere origine dei problemi, struttura politica, eredità di guerre e crisi, relazioni consolidate, condizioni sociali ed economiche generali, capacità e vincoli storicamente esistenti.
Non colma le lacune del PRESENTE: non inventare nomi, quantità o localizzazioni che non siano forniti, e non trasformare un dato storico in un fatto corrente senza conferma del current state. L'assenza di un dettaglio nel presente NON prova che sia storicamente inesistente.
Se la baseline e il current state si contraddicono, prevale SEMPRE il current state; se la PLAYER HISTORY ha modificato il mondo dopo la data iniziale, quella modifica prevale sulla situazione storica.`;

/** Ruolo del generatore: storico, non narratore di eventi futuri. */
export const HISTORICAL_BASELINE_SYSTEM = `Sei lo storico di riferimento del Primo Consulente in un gioco di storia alternativa. Ricostruisci la storia REALE di un paese fino a una data di partenza. Non produci un'enciclopedia: spieghi ciò che serve a capire perché il paese è così oggi. Nessuna etichetta FACT/INFERENCE/FORECAST/PROPOSAL, nessun elenco di dati grezzi.`;

/** Punti richiesti, nell'ordine: solo se rilevanti per la situazione al via. */
const BASELINE_FACETS = [
  'evoluzione politica recente',
  'guerre e conflitti precedenti',
  'trasformazioni economiche',
  'rapporti regionali',
  'debolezze istituzionali',
  'situazione sociale',
  'infrastrutture e capacità note a livello storico',
  'relazioni diplomatiche principali',
];

const LABEL = (request: HistoricalBaselineRequest): string =>
  (request.countryName?.trim() || request.polityId).toLocaleUpperCase('it');

export function buildHistoricalBaselinePrompt(request: HistoricalBaselineRequest): string {
  const year = String(request.startDate ?? '').slice(0, 4);
  return [
    `Paese: ${request.countryName?.trim() || request.polityId} (${request.polityId}). Mondo: ${request.worldName || 'non indicato'}. Data di partenza della partita: ${request.startDate}.`,
    request.premise ? `Premessa del mondo (contesto, NON fonte di fatti sul paese): ${request.premise.slice(0, 1200)}` : '',
    `Scrivi il background storico REALE di questo paese fino al ${year}.`,
    `Copri, solo se politicamente o strategicamente rilevante: ${BASELINE_FACETS.join(', ')}.`,
    'Lunghezza: 500-1200 token. Prosa asciutta e discorsiva; pochi capoversi, non un elenco puntato. Ogni riga deve aiutare a capire «perché il paese è così oggi».',
    `VINCOLI: non raccontare eventi successivi al ${year}, nemmeno se li conosci; non anticipare crisi, guerre o svolte future. Non inventare nomi propri, cifre o localizzazioni non forniti. Non descrivere il presente della simulazione: quello lo fornisce il world state.`,
  ].filter(Boolean).join('\n\n');
}

const MAX_CHARS = 6_000;
const MIN_CHARS = 200;
const YEAR = /\b(?:1[89]\d{2}|20\d{2})\b/g;

/** Anno reale successivo alla data iniziale: la frase non è storia consentita. */
function hasFutureYear(sentence: string, startYear: number): boolean {
  if (!Number.isFinite(startYear)) return false;
  return [...sentence.matchAll(YEAR)].some(match => Number(match[0]) > startYear);
}

function cutAtSentence(text: string, limit: number): string {
  if (text.length <= limit) return text;
  const head = text.slice(0, limit);
  const lastStop = Math.max(head.lastIndexOf('. '), head.lastIndexOf('\n'));
  return (lastStop > limit / 2 ? head.slice(0, lastStop + 1) : head).trim();
}

/**
 * Ripulisce il testo generato: via blocchi tecnici, etichette di dossier e
 * frasi che citano eventi reali posteriori alla data iniziale. `null` quando
 * non resta un background utilizzabile (meglio nessuna baseline che una falsa).
 */
export function sanitizeHistoricalBaseline(raw: unknown, startDate: string): string | null {
  const startYear = Number(String(startDate ?? '').slice(0, 4));
  const lines = String(raw ?? '').replace(/```[^]*?(?:```|$)/g, '\n').split('\n');
  const kept: string[] = [];
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    if (hasTechnicalVocabulary(trimmed)) continue;
    if (/^(?:[-*#]|\d+\.)?\s*(?:FACT|INFERENCE|FORECAST|PROPOSAL)\s*[—–:-]/i.test(trimmed)) continue;
    const sentences = trimmed.split(/(?<=[.!?])\s+/).filter(sentence => sentence.trim() && !hasFutureYear(sentence, startYear));
    const text = sentences.join(' ').trim();
    if (text) kept.push(text);
  }
  const body = cutAtSentence(kept.join('\n').trim(), MAX_CHARS);
  return body.length >= MIN_CHARS ? body : null;
}

/** Blocco esplicito consegnato al Consulente (e ai ministri). */
export function renderHistoricalBaseline(baseline: string, request: Pick<HistoricalBaselineRequest, 'countryName' | 'polityId' | 'startDate'>): string {
  const year = String(request.startDate ?? '').slice(0, 4);
  return [
    `[HISTORICAL BASELINE — ${LABEL(request as HistoricalBaselineRequest)} — ${year}]`,
    baseline.trim(),
    HISTORICAL_BASELINE_RULE,
  ].join('\n');
}

/**
 * Genera e valida la baseline riusando il provider esistente. Fallisce in modo
 * silenzioso (`null`): senza storia canonica il Consulente non inventa, e la
 * prima apertura ricade sul briefing deterministico.
 */
export async function generateHistoricalBaseline(
  request: HistoricalBaselineRequest,
  generate: (system: string, prompt: string) => Promise<string>,
): Promise<string | null> {
  try {
    const text = await generate(HISTORICAL_BASELINE_SYSTEM, buildHistoricalBaselinePrompt(request));
    return sanitizeHistoricalBaseline(text, request.startDate);
  } catch {
    return null;
  }
}
