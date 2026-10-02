/**
 * WS-GOV-MOBILE-FOCUS (A6/A7) — La voce della riunione, read-only
 * ==============================================================
 * La narrativa di una riunione è **solo prosa**: interpreta i fatti del motore,
 * non li crea. Il percorso normale del ministro (`government/minister`) riusa
 * correttamente la persona, ma **può scrivere memoria/JEV** e può contenere
 * direttive (`decision`, `tavola`). Qui si compone il messaggio della sola voce
 * e si ripulisce la risposta: la rotta non persiste nulla e non applica direttive.
 *
 * Non è un secondo sistema di persona: la voce autorevole resta
 * `MinisterPersona.ts` (`personaFor` / `personaSection`), che questo modulo
 * riusa. Il modello parla con quella voce; i numeri restano quelli del brief.
 *
 * Modulo **puro**: nessun I/O, nessuna chiamata al modello, nessuno stato.
 */
import { personaFor, personaSection } from './MinisterPersona';
import type { CabinetSeat } from './Cabinet';

/** Il contratto narrativo: materiale **verificato** dal motore, mai cifre nuove. */
export interface MeetingNarrativeFact {
  readonly label: string;
  readonly value?: string;
  readonly status?: string;
  readonly source: string;
}

export interface MinisterMeetingBrief {
  readonly seat: CabinetSeat;
  readonly facts: readonly MeetingNarrativeFact[];
  readonly blockers: readonly string[];
  readonly politicalContext: readonly string[];
  readonly meetingObjective: string;
  readonly previousContributions: readonly string[];
}

const SEATS: readonly CabinetSeat[] = ['tesoro', 'lavori', 'istruzione', 'sanita', 'esteri', 'interno', 'guerra'];

function isSeat(value: unknown): value is CabinetSeat {
  return typeof value === 'string' && (SEATS as readonly string[]).includes(value);
}

function asStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is string => typeof item === 'string' && item.trim().length > 0).map(item => item.trim());
}

/**
 * Normalizza il brief ricevuto dal client: un payload non valido non è un brief
 * (la rotta risponde con un errore, non con una narrativa su dati non verificati).
 */
export function normalizeMinisterMeetingBrief(raw: unknown): MinisterMeetingBrief | null {
  if (!raw || typeof raw !== 'object') return null;
  const value = raw as Record<string, unknown>;
  if (!isSeat(value.seat)) return null;
  const factsRaw = Array.isArray(value.facts) ? value.facts : [];
  const facts: MeetingNarrativeFact[] = [];
  for (const item of factsRaw) {
    if (!item || typeof item !== 'object') continue;
    const fact = item as Record<string, unknown>;
    if (typeof fact.label !== 'string' || typeof fact.source !== 'string') continue;
    facts.push({
      label: fact.label.trim(),
      ...(typeof fact.value === 'string' ? { value: fact.value } : {}),
      ...(typeof fact.status === 'string' ? { status: fact.status } : {}),
      source: fact.source.trim(),
    });
  }
  return {
    seat: value.seat,
    facts,
    blockers: asStringArray(value.blockers),
    politicalContext: asStringArray(value.politicalContext),
    meetingObjective: typeof value.meetingObjective === 'string' ? value.meetingObjective.trim() : '',
    previousContributions: asStringArray(value.previousContributions),
  };
}

/**
 * Il messaggio della voce: i fatti verificati, la persona della sedia e la regola
 * «non aggiungere cifre, non produrre direttive». La rotta aggiunge il briefing
 * della sedia e instrada al provider esistente.
 */
export function composeMeetingNarrativeMessage(brief: MinisterMeetingBrief): string {
  const persona = personaFor(brief.seat);
  const facts = brief.facts.length > 0
    ? brief.facts.map(fact => `- ${fact.label}: ${fact.value ?? fact.status ?? 'da verificare'} (fonte: ${fact.source})`).join('\n')
    : '- (nessun dato di competenza in questa riunione)';
  const blockers = brief.blockers.length > 0 ? brief.blockers.join('; ') : 'nessuno';
  const political = brief.politicalContext.length > 0 ? brief.politicalContext.join('; ') : 'nessuna';
  const previous = brief.previousContributions.length > 0
    ? brief.previousContributions.map(item => `- ${item}`).join('\n')
    : '- (nessun intervento precedente)';
  return [
    'RIUNIONE DI GOVERNO — parli come il titolare della tua sedia. Materiale verificato: non aggiungere né modificare cifre.',
    personaSection(persona),
    `Obiettivo: ${brief.meetingObjective}`,
    'Dati della tua competenza:',
    facts,
    `Blocchi tecnici: ${blockers}`,
    `Questioni politiche: ${political}`,
    'Hanno già parlato:',
    previous,
    'Scrivi un breve intervento in prima persona: commenta i dati, dichiara la tua lettura e la tua proposta. Non elencare, non usare titoli e NON produrre blocchi tecnici (niente ```decision```, niente ```tavola```, niente JSON): la Tavola la aggiorna il motore, non tu. Non decidere al posto del Presidente.',
  ].join('\n');
}

/**
 * Rimuove le direttive tecniche da una risposta: la voce della riunione è solo
 * prosa. Il testo fuori dai blocchi resta; i blocchi `decision`/`tavola`/
 * `presentation` spariscono, così la Tavola e il workspace non vengono alterati.
 */
export function stripNarrativeDirectives(text: string): string {
  const raw = String(text ?? '');
  return raw
    .replace(/```(?:decision|tavola|presentation|presentazione)[\s\S]*?```/gi, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}
