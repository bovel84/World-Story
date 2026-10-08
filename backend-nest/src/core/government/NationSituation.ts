/**
 * World Story — Situazione iniziale della nazione (H05).
 * ======================================================
 * La **seconda fonte** del contesto del mondo. Il primo (i filoni del preset)
 * è **curato** e **regionale**; questa è **generata dall'IA** e copre **ogni**
 * nazione, anche quella che il preset non nomina — «la storia della nazione che
 * ho scelto deve essere conosciuta a prescindere dal preset».
 *
 * Modello copiato da `HistoricalBaseline`, con tre differenze sostanziali:
 *  - copre il **presente e la traiettoria** (cosa la nazione affronta alla data
 *    di partenza), non il passato;
 *  - è **subordinata ai filoni del preset** (H-I11): sui nodi che il preset ha
 *    fissato, non li contraddice;
 *  - la `trajectory` è una **tendenza**, mai una profezia (H-I12).
 *
 * Regola di gating ereditata: solo le voci `confidence: "high"` persistono;
 * fail-closed — meglio nessuna voce che una inventata.
 *
 * Il modulo è **puro**: prompt, parsing e regole si provano senza provider.
 */
import type { Storyline } from '../../scenario/storylines';

/** Il caso limite della `sanitizeHistoricalBaseline` che qui riusiamo per il testo. */
export const NATION_SITUATION_MAX_CHARS = 6_000;
export const NATION_SITUATION_MIN_CHARS = 80;

/** Una riga persistita: immutabile per `(game, polity, start_date)`. */
export interface NationSituationRecord {
  polityId: string;
  countryName: string;
  startDate: string;
  situation: string;
  generatedAt: string;
  version: number;
}

export interface NationSituationRequest {
  worldName: string;
  polityId: string;
  countryName: string | null;
  startDate: string;
  /** La premessa del mondo: informa, non è una fonte di fatti. */
  premise?: string | null;
  /** I filoni del preset che toccano questa nazione: vincolano la generazione. */
  storylines?: readonly Storyline[];
}

/**
 * La gerarchia delle verità, con la situazione iniziale al suo posto. Il filone
 * del preset **vince** sui nodi che ha fissato; fuori da quelli, la situazione
 * generata è libera. Non è una profezia: è una tendenza.
 */
export const NATION_SITUATION_RULE = `[GERARCHIA DEL CONTESTO — vale sempre]
STATO CORRENTE DEL MOTORE > STORIA DELLA PARTITA > FILONE DEL PRESET > CONTESTO DELLA NAZIONE > STORIA REALE.
Il CONTESTO DELLA NAZIONE descrive dove sta la nazione alla data di partenza e **dove punta ad andare**.
Se un FILONE DEL PRESET fissa un nodo che riguarda questa nazione, il contesto **non lo contraddice**: lo segue, e resta libero solo fuori da quei nodi.
Il futuro qui è una **TENDENZA**, mai un fatto: puoi dire «la nazione punta a…», «la strada porta verso…», «pesa la questione di…», ma **non** «nel 2001 accadrà X». Nessuna data futura come fatto già accaduto.
Non introdurre cifre precise che non siano largamente documentate. Niente asset correnti inventati: il contesto spiega la posizione e le questioni, non certifica forze o infrastrutture.`;

export const NATION_SITUATION_SYSTEM = `Sei l'analista di riferimento di un gioco di storia alternativa. Descrivi la SITUAZIONE di una nazione alla data di partenza: dove sta, quali questioni affronta e dove punta ad andare. Scrivi in italiano.
Usa SOLO fatti storici solidi e largamente noti a quella data; non inventare e non riempire le lacune con dettagli plausibili. Se una cosa non la conosci con certezza, omettila.
Rispondi SOLO con JSON {"entries":[{"text":"...","confidence":"high"|"medium"|"low"}]}.
Assegna "high" solo a una situazione che conosci con certezza e che è ben documentata a quella data: situazioni politiche, conflitti in corso, crisi economiche, coalizioni, questioni territoriali o religiose realmente esistenti. Usa "medium"/"low" per tutto ciò che è incerto.
Verranno usate SOLO le voci "high". Preferisci poche voci concrete a molte generiche: se non conosci abbastanza, restituisci meno voci o nessuna.`;

/** Costruisce il prompt: la situazione al presente e la traiettoria, con i vincoli dei filoni. */
export function buildNationSituationPrompt(request: NationSituationRequest): string {
  const storylines = (request.storylines ?? []).map(s =>
    `- ${s.title} [${s.id}] (${s.state}, pressione ${s.pressure}): ${s.summary}` +
    (s.trajectory ? `\n  Direzione dichiarata dal preset: ${s.trajectory}` : '')
  ).join('\n');
  return [
    `Nazione: ${request.countryName?.trim() || request.polityId} (${request.polityId}). Mondo: ${request.worldName || 'non indicato'}. Data di partenza: ${request.startDate}.`,
    request.premise ? `Premessa del mondo (informa, non è fonte di fatti): ${request.premise.slice(0, 1200)}` : '',
    'Descrivi la SITUAZIONE della nazione a questa data: situazione politica interna, questioni economiche o sociali aperte, tensioni regionali, crisi o conflitti in corso, e verso dove la nazione punta ad andare. NON raccontare il passato: quello è già noto. Descrivi il PRESENTE e la DIREZIONE.',
    'Usa fatti concreti e identificabili: nomi di capi di Stato o di governo, partiti, regioni, crisi realmente in corso a quella data. Una frase che potrebbe descrivere quasi qualsiasi nazione NON è accettata.',
    storylines
      ? `\n[FILONI DEL PRESET CHE TOCCHIAMO — NON contraddirli]\n${storylines}\nSui nodi qui elencati la situazione deve SEGUIRE il filone, non riscriverlo. Fuori da questi nodi sei libero.`
      : '',
    NATION_SITUATION_RULE,
  ].filter(Boolean).join('\n\n');
}

/**
 * Estrae le voci `high` da una risposta JSON e ne compone un testo puro.
 * Ritorna `null` se non resta nulla di abbastanza solido (fail-closed).
 */
export function composeNationSituation(raw: unknown): string | null {
  let parsed: unknown = raw;
  if (typeof raw === 'string') {
    const json = raw.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '');
    if (!json.startsWith('{')) return null;
    try { parsed = JSON.parse(json); } catch { return null; }
  }
  if (!parsed || typeof parsed !== 'object' || !('entries' in parsed)) return null;
  const entries = (parsed as { entries?: unknown }).entries;
  if (!Array.isArray(entries)) return null;
  const texts = entries.slice(0, 24).flatMap((entry: unknown) => {
    if (!entry || typeof entry !== 'object') return [];
    const { text, confidence } = entry as { text?: unknown; confidence?: unknown };
    if (typeof text !== 'string' || typeof confidence !== 'string') return [];
    if (confidence.toLowerCase() !== 'high') return [];
    const trimmed = text.trim();
    return trimmed.length >= 12 ? [trimmed] : [];
  });
  const body = texts.join(' ').trim().slice(0, NATION_SITUATION_MAX_CHARS);
  if (body.length < NATION_SITUATION_MIN_CHARS) return null;
  return body;
}

/**
 * Genera la situazione; `generate` è iniettato (provider) per restare puro e
 * testabile. Nessuna eccezione sfugge: fail-closed → `null`.
 */
export async function generateNationSituation(
  request: NationSituationRequest,
  generate: (system: string, prompt: string) => Promise<string>,
): Promise<string | null> {
  try {
    const raw = await generate(NATION_SITUATION_SYSTEM, buildNationSituationPrompt(request));
    return composeNationSituation(raw);
  } catch { return null; }
}

/** La situazione è registrabile? Un profilo troppo generico non si persiste. */
export function isUsableNationSituation(text: string): boolean {
  return typeof text === 'string' && text.trim().length >= NATION_SITUATION_MIN_CHARS;
}

/** Il blocco pronto per il prompt del Consulente. */
export function renderNationSituation(
  situation: string,
  request: Pick<NationSituationRequest, 'countryName' | 'polityId' | 'startDate'>,
): string {
  const name = (request.countryName?.trim() || request.polityId).toLocaleUpperCase('it');
  return `[SITUAZIONE DELLA NAZIONE — ${name} — ${request.startDate}]\n${situation.trim()}\n${NATION_SITUATION_RULE}`;
}

/**
 * H06 — Le situazioni delle **altre** nazioni (gli NPC del teatro). Stessa
 * regola di `renderPolityHistoricalBaselines`: la situazione della nazione del
 * giocatore ha già il suo blocco; qui stanno le altre. Ogni riga dichiara che è
 * **contesto**, non un fatto del presente.
 */
export function renderPolityNationSituations(
  situations: readonly (NationSituationRecord & { excerpt?: string })[],
  query = '',
  limit = 1_200,
): string {
  if (!situations.length) return '';
  return [
    '[SITUAZIONI DELLE ALTRE NAZIONI — contesto del mondo, non fatti del presente]',
    ...situations.slice(0, 5).map(situation => {
      const body = (situation.excerpt ?? situation.situation).slice(0, limit);
      return `[${situation.countryName} (${situation.polityId}) — al ${situation.startDate}]\n${body}`;
    }),
    NATION_SITUATION_RULE,
  ].join('\n');
}
