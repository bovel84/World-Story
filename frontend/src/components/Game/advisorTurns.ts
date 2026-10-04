/**
 * WS-GOV-TURN-AWARENESS — La conversazione del Consulente è PER TURNO.
 *
 * La storia non si cancella: i messaggi vecchi restano archiviati e la chat
 * attiva (e la history inviata al modello) contiene solo il turno corrente.
 * I messaggi legacy senza `turn` ricevono il turno corrente una volta sola,
 * così al cambio turno successivo risultano già archiviati.
 */
import type { AdvisorMessage } from '../../stores/chatStore';

/** Assegna il turno ai messaggi legacy che non lo hanno (una volta sola). */
export function tagLegacyTurns(messages: AdvisorMessage[], turn: number): AdvisorMessage[] {
  let changed = false;
  const tagged = messages.map(message => {
    if (message.turn !== undefined) return message;
    changed = true;
    return { ...message, turn };
  });
  // Nessun messaggio legacy: stessa referenza, così lo store non ri-renderizza.
  return changed ? tagged : messages;
}

/** Solo il turno corrente: è l'unica storia inviata al modello e mostrata in chat. */
export function currentTurnMessages(messages: readonly AdvisorMessage[], turn: number): AdvisorMessage[] {
  return messages.filter(message => message.turn === turn);
}

/** I turni precedenti, raggruppati per turno e in ordine cronologico. */
export function archivedTurns(messages: readonly AdvisorMessage[], turn: number): Array<{ turn: number; messages: AdvisorMessage[] }> {
  const grouped = new Map<number, AdvisorMessage[]>();
  for (const message of messages) {
    if (message.turn === undefined || message.turn === turn) continue;
    const bucket = grouped.get(message.turn);
    if (bucket) bucket.push(message);
    else grouped.set(message.turn, [message]);
  }
  return [...grouped.entries()]
    .sort((left, right) => left[0] - right[0])
    .map(([previousTurn, bucket]) => ({ turn: previousTurn, messages: bucket }));
}
