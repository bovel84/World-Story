/** Contesto del ministro: dossier strutturato, stile discorsivo e protocollo separati. Puro, nessuna persistenza. */
import { z } from 'zod';
import { CABINET_SEATS, SEAT_LABEL, SEAT_READS, type CabinetAddress, type CabinetItem, type CabinetSeat } from './Cabinet';
import { firstMessage, personaFor, personaSection } from './MinisterPersona';
import { memorySection, type MinisterMemory } from './MinisterMemory';
import type { GovernmentAgenda } from './GovernmentAgenda';
import { MINISTER_DATA_RULES, MINISTER_DIALOGUE_STYLE, MINISTER_DIALOGUE_PROTOCOL } from './MinisterDialogueRules';

export interface MinisterBriefing {
  readonly seat: CabinetSeat;
  readonly label: string;
  readonly reads: string;
  readonly context: string;
  readonly hasNeeds: boolean;
}

/** Compatibilità per le altre viste: la provenienza rimane disponibile nel dossier. */
export function figureLine(figure: { label: string; value: string; unit: string; basis: unknown }): string {
  const basis = figure.basis as { kind?: string; source?: string; method?: string; missing?: string };
  const value = figure.value ? `${figure.value} ${figure.unit}`.trim() : 'non disponibile';
  if (basis?.kind === 'measured') return `- ${figure.label}: ${value} (misurato da: ${basis.source})`;
  if (basis?.kind === 'estimated') return `- ${figure.label}: ${value} (stimato con: ${basis.method})`;
  if (basis?.kind === 'unknown') return `- ${figure.label}: DATO MANCANTE (${basis.missing}) — dichiaralo, non inventarlo`;
  return `- ${figure.label}: ${value}`;
}

export const SEAT_TOPICS: Record<CabinetSeat, readonly string[]> = {
  tesoro: ['bilancio', 'debito', 'cassa', 'tasse', 'imposte', 'credito', 'spesa', 'finanz'],
  lavori: ['fabbrica', 'fabbriche', 'cantiere', 'cantieri', 'opera', 'opere', 'strada', 'porto', 'acciaio', 'material', 'costru', 'industri', 'infrastruttur'],
  istruzione: ['scuola', 'scuole', 'ateneo', 'atenei', 'universit', 'istruz', 'ricerca', 'studenti', 'formazione'],
  sanita: ['sanit', 'ospedal', 'salute', 'malatt', 'welfare', 'sussidi', 'assistenza', 'sostegno sociale'],
  esteri: ['estero', 'esteri', 'diplomaz', 'trattat', 'contratto', 'relazion', 'confine', 'alleat'],
  interno: ['fazione', 'fazioni', 'polizia', 'protesta', 'coesione', 'consenso', 'ordine pubblico'],
  guerra: ['esercito', 'militar', 'armi', 'arsenal', 'difesa', 'repart', 'truppe', 'fronte'],
};

export function seatForQuestion(question: string): CabinetSeat | null {
  const text = question.toLowerCase();
  let best: CabinetSeat | null = null;
  let bestScore = 0;
  for (const seat of CABINET_SEATS) {
    // «spesa sanitaria» è della Sanità, non del Tesoro solo perché contiene «spesa».
    const score = SEAT_TOPICS[seat].reduce((n, topic) => n + (text.includes(topic) ? (topic === 'spesa' ? 0.5 : 1) : 0), 0);
    if (score > bestScore) { bestScore = score; best = seat; }
  }
  return best;
}

export interface ColleagueRedirectContext {
  readonly targetSeat: CabinetSeat;
  readonly targetLabel: string;
  readonly targetReads: string;
  readonly currentSeat: CabinetSeat;
  readonly currentAngle: string;
}

/** Angoli di competenza, non un secondo profilo/persona e non fatti del mondo. */
const CURRENT_ANGLE: Record<CabinetSeat, string> = {
  tesoro: 'Io guarderei se finanziariamente possiamo permettercelo e quanto margine lascia ai conti.',
  lavori: 'Io posso valutare cosa serve per renderlo cantierabile: materiali, collegamenti e prossimo passo.',
  istruzione: 'Io guarderei cosa significa per la formazione e per il paese che stiamo preparando.',
  sanita: 'Io guarderei le conseguenze per chi ha bisogno di cure e sostegno.',
  esteri: 'Io posso valutare se cambia i rapporti con i partner o gli impegni già presi.',
  interno: 'Io guarderei chi sostiene la scelta e chi rischia di restarne fuori.',
  guerra: 'Io guarderei le conseguenze per la difesa e quello che possiamo sostenere con forze e scorte.',
};

export function currentSeatAngle(seat: CabinetSeat): string { return CURRENT_ANGLE[seat]; }

export function colleagueRedirectContext(from: CabinetSeat, question: string): ColleagueRedirectContext | null {
  const targetSeat = seatForQuestion(question);
  if (!targetSeat || targetSeat === from) return null;
  return { targetSeat, targetLabel: SEAT_LABEL[targetSeat], targetReads: SEAT_READS[targetSeat], currentSeat: from, currentAngle: CURRENT_ANGLE[from] };
}

/** Fallback semplice: nomina il collega e aggiunge la propria lettura senza rimbalzare. */
export function colleagueRedirect(from: CabinetSeat, question: string): string | null {
  const redirect = colleagueRedirectContext(from, question);
  if (!redirect) return null;
  return `La scelta la valuterei con ${redirect.targetLabel.replace(/^Ministro /, 'il ministro ')}. ${redirect.currentAngle}`;
}

/** API compatibile col percorso congelato GameSession. Non inietta WORLD: lo possiede PromptBuilder/JEV. */
export function briefingFor(address: CabinetAddress, _agenda: GovernmentAgenda, memory?: MinisterMemory | null): MinisterBriefing {
  const colleagues = CABINET_SEATS.filter(seat => seat !== address.seat).map(seat => ({ seat, label: SEAT_LABEL[seat], reads: SEAT_READS[seat] }));
  const unknown = address.items.flatMap(item => item.figures.filter(figure => figure.basis.kind === 'unknown').map(figureLine));
  const context = [
    // Prefix di compatibilità per la detection del percorso ministeriale senza JEV.
    `Sei il ${SEAT_LABEL[address.seat]} del governo.`,
    '[IDENTITY]',
    `La tua competenza: ${SEAT_READS[address.seat]}.`,
    personaSection(personaFor(address.seat)),
    `I TUOI COLLEGHI (directory interna): ${JSON.stringify(colleagues)}`,
    '[VERIFIED FACTS]',
    JSON.stringify({ seat: address.seat, issues: address.items }),
    MINISTER_DATA_RULES,
    ...(unknown.length ? unknown : []),
    ...(address.items.length ? [] : ['Non hai nulla da portare al consiglio in questo momento.']),
    '[MEMORY]',
    memory ? memorySection(memory) : '',
    '[DIALOGUE STYLE]',
    MINISTER_DIALOGUE_STYLE,
    '[PROTOCOL]',
    MINISTER_DIALOGUE_PROTOCOL,
  ].filter(Boolean).join('\n');
  return { seat: address.seat, label: SEAT_LABEL[address.seat], reads: SEAT_READS[address.seat], context, hasNeeds: address.items.length > 0 };
}

/** Verifica solo la forma del contratto JSON interno; non aggiunge una fonte/fact checker. */
const dossierSchema = z.object({
  seat: z.string().refine(seat => CABINET_SEATS.includes(seat as CabinetSeat)),
  issues: z.array(z.object({
    voiceId: z.string(), need: z.string(), because: z.string(), urgency: z.string(),
    figures: z.array(z.object({ label: z.string(), value: z.string(), unit: z.string(), basis: z.discriminatedUnion('kind', [
      z.object({ kind: z.literal('measured'), source: z.string() }),
      z.object({ kind: z.literal('estimated'), method: z.string() }),
      z.object({ kind: z.literal('unknown'), missing: z.string() }),
    ]) })),
    paths: z.array(z.object({ id: z.string(), title: z.string(), detail: z.string(), prerequisites: z.array(z.string()), expected: z.string(), recommended: z.boolean() })),
  })),
});

/** Decode del contratto prodotto sopra, non parsing di prosa o di fatti del giocatore. */
export function ministerDossierFrom(context: string): { seat: CabinetSeat; issues: readonly CabinetItem[] } | null {
  const line = /\[VERIFIED FACTS\]\n([^\n]+)/.exec(context)?.[1];
  if (!line) return null;
  try {
    const value = JSON.parse(line);
    if (!dossierSchema.safeParse(value).success) return null;
    return { seat: value.seat, issues: value.issues };
  } catch { return null; }
}

export function openingMessage(briefing: MinisterBriefing, items: readonly CabinetItem[]): string {
  return firstMessage(briefing.seat, items);
}
export function seatsWithNeeds(_agenda: GovernmentAgenda, cabinet: { addresses: readonly CabinetAddress[] }): readonly CabinetSeat[] {
  return cabinet.addresses.filter(address => address.items.length > 0).map(address => address.seat);
}
