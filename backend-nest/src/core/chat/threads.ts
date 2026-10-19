/**
 * World Story — Thread diplomatici (logica pura)
 * ===========================================
 * Una chat è una DISCUSSIONE: gli sviluppi dello stesso negoziato proseguono
 * nel suo thread anche nei turni successivi; questioni diverse restano separate.
 * Qui vivono le regole deterministiche condivise da repository, sessione e UI,
 * così il comportamento è testabile senza database.
 */

/** Insieme canonico dei partecipanti: ordine stabile, niente duplicati. */
export function canonicalParticipantKey(ids: string[]): string {
  return [...new Set(ids.filter(Boolean))].sort().join('|');
}

/**
 * Chiave di deduplicazione per una discussione avviata dalla simulazione.
 * Lo stesso evento (o salto) non deve generare due canali se il provider
 * ritenta la risposta. Per un evento diverso, il servizio può prima riusare
 * la conversazione pertinente e conservare la cronologia del negoziato.
 */
export function simulationThreadKey(parts: {
  simulationId?: string;
  turn?: number;
  eventHeadline?: string;
  participantIds: string[];
}): string {
  const ref = (parts.simulationId || `turn-${parts.turn ?? 0}`).trim();
  const headline = (parts.eventHeadline || '').trim().toLocaleLowerCase('it');
  return `sim:${ref}:${canonicalParticipantKey(parts.participantIds)}:${headline}`;
}

/** Chiave per la reazione autonoma di una nazione in un turno. */
export function reactionThreadKey(polityId: string, turn: number): string {
  return `npc:${turn}:${polityId}`;
}

