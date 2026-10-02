/**
 * WS-GAME-OPENING — La narrativa dell'apertura (read-only, deterministica)
 * =======================================================================
 * Quando una partita inizia, il giocatore riceve un prologo dal **preset** e le
 * prime voci del **consiglio**. Questo modulo le compone senza chiamare il
 * modello e senza inventare nulla:
 *
 *  - i paragrafi del mondo sono estratti dal testo del preset
 *    (`world.basePrompt` = `base_prompt` + `lore.md`), tagliati a poche frasi;
 *  - le voci del consiglio sono il **ritratto della sedia** (`personaFor()`:
 *    `signature`) per le sedie che il **motore** dichiara occupate
 *    (`readCabinetSession` tace dove non ci sono fatti).
 *
 * Gerarchia (§23): il mondo viene dal preset, la selezione delle sedie dal
 * motore, le parole dalla persona. Nessun numero nuovo, nessuna scrittura:
 * è una proiezione di sola lettura. Se serve la prosa migliore, il renderer
 * narrativo arriverà dopo (§24) — qui c'è il **fallback deterministico**
 * obbligatorio.
 *
 * Modulo **puro**: nessun I/O, nessuno stato, nessuna chiamata al modello.
 */
import { personaFor } from './MinisterPersona';
import type { CabinetAddress, CabinetSeat } from './Cabinet';

export interface OpeningCouncilLine {
  seat: CabinetSeat;
  /** Titolo della sedia, es. «Ministro dei Lavori». */
  label: string;
  /** La voce della sedia, dalla persona: nessuna cifra. */
  line: string;
}

export interface OpeningNarrative {
  /** Non generato da un modello: proiezione deterministica. */
  generated: false;
  deterministic: true;
  world: {
    name: string;
    date: string;
    /** 2–4 paragrafi brevi estratti dal preset. */
    paragraphs: string[];
  };
  /** Al massimo tre sedie, quelle che il motore dichiara occupate. */
  council: OpeningCouncilLine[];
}

const MAX_PARAGRAPHS = 4;
const MAX_WORDS = 220;
const MIN_BLOCK_CHARS = 24;

/** Ripulisce il testo del preset: via titoli markdown, elenchi, enfasi. */
function cleanPremise(value: string): string {
  return String(value ?? '')
    .replace(/\r\n?/g, '\n')
    .replace(/^#{1,6}\s*/gm, '')
    .replace(/^\s*(?:[-*•]|\d+[.)])\s+/gm, '')
    .replace(/\*\*|__|`/g, '')
    .trim();
}

function words(text: string): string[] {
  return text.split(/\s+/).filter(Boolean);
}

function clipWords(text: string, maxWords: number): string {
  const tokens = words(text);
  if (tokens.length <= maxWords) return text;
  return `${tokens.slice(0, maxWords).join(' ').replace(/[,;:]$/, '')}…`;
}

/**
 * Estrae 2–4 paragrafi dal testo del preset, entro un limite di parole.
 * Deterministica: stesso preset → stesso prologo.
 */
export function extractOpeningParagraphs(
  premise: string,
  options: { maxParagraphs?: number; maxWords?: number } = {},
): string[] {
  const maxParagraphs = options.maxParagraphs ?? MAX_PARAGRAPHS;
  const maxWords = options.maxWords ?? MAX_WORDS;
  const text = cleanPremise(premise);
  if (!text) return [];

  const blocks = text
    .split(/\n\s*\n+/)
    .map(block => block.replace(/\s*\n\s*/g, ' ').trim())
    .filter(block => block.length >= MIN_BLOCK_CHARS);
  const source = blocks.length > 0 ? blocks : [text.replace(/\s+/g, ' ')];

  const out: string[] = [];
  let usedWords = 0;
  for (const block of source) {
    if (out.length >= maxParagraphs || usedWords >= maxWords) break;
    const sentences = block.split(/(?<=[.!?])\s+/).filter(Boolean);
    const kept = sentences.slice(0, 2).join(' ');
    const candidate = clipWords(kept, Math.max(24, maxWords - usedWords));
    if (!candidate) continue;
    out.push(candidate);
    usedWords += words(candidate).length;
  }
  return out;
}

/**
 * La voce di una sedia per l'apertura: **persona + verified state**, in una riga
 * breve e senza cifre inventate. Usa la firma di stile di `MinisterPersona`
 * (persona) e la prima questione che il motore attribuisce alla sedia
 * (`CabinetItem.need`). La questione entra solo se è breve e priva di cifre:
 * così il testo non introduce mai numeri, ma riflette ciò che il motore vede.
 * Se la questione non è "pulita", resta la sola firma della persona.
 *
 * Non restituisce virgolette: le aggiunge il renderer, che mostra `«…»`.
 */
export function openingCouncilLine(address: CabinetAddress): string {
  const signature = personaFor(address.seat).signature
    .replace(/^[«"]\s*/, '')
    .replace(/\s*[»"]$/, '')
    .replace(/[.]$/, '');
  const issue = String(address.items[0]?.need ?? '').trim();
  const safeIssue = issue.length > 0 && issue.length <= 80 && !/\d/.test(issue);
  if (!safeIssue) return `${signature}.`;
  const lower = issue[0].toLowerCase() + issue.slice(1);
  return `${signature} — ${lower.replace(/[.]$/, '')}.`;
}

/**
 * Costruisce la narrativa dell'apertura. Le sedie sono scelte dal motore
 * (presenza e urgenza delle voci) e parlano con la persona, mai con cifre.
 */
export function buildOpeningNarrative(input: {
  worldName?: string | null;
  date?: string | null;
  premise?: string | null;
  addresses?: readonly CabinetAddress[] | null;
}): OpeningNarrative {
  const ranked = [...(input.addresses ?? [])]
    .filter(address => address.items.length > 0)
    .map((address, index) => ({
      address,
      index,
      rank: address.items.some(item => item.urgency === 'critica') ? 0 : 1,
    }))
    .sort((a, b) => a.rank - b.rank || a.index - b.index)
    .slice(0, 3)
    .map(({ address }) => ({
      seat: address.seat,
      label: address.label,
      line: openingCouncilLine(address),
    }));

  return {
    generated: false,
    deterministic: true,
    world: {
      name: String(input.worldName ?? '').trim(),
      date: String(input.date ?? '').trim(),
      paragraphs: extractOpeningParagraphs(input.premise ?? ''),
    },
    council: ranked,
  };
}
