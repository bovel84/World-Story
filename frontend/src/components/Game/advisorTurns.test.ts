/**
 * WS-GOV-TURN-AWARENESS — La conversazione del Consulente è per turno.
 */
import { describe, expect, it } from 'vitest';
import { archivedTurns, currentTurnMessages, tagLegacyTurns } from './advisorTurns';
import type { AdvisorMessage } from '../../stores/chatStore';

const message = (turn: number | undefined, content: string): AdvisorMessage => ({
  role: 'user', content, ...(turn === undefined ? {} : { turn }),
});

describe('advisorTurns', () => {
  it('la history del turno corrente esclude i turni precedenti', () => {
    const messages = [message(1, 'vecchio'), message(2, 'attuale'), message(3, 'futuro')];
    expect(currentTurnMessages(messages, 2).map(item => item.content)).toEqual(['attuale']);
    expect(currentTurnMessages(messages, 3).map(item => item.content)).toEqual(['futuro']);
  });

  it('i turni precedenti restano archiviati, raggruppati e in ordine', () => {
    const messages = [message(2, 'b'), message(1, 'a1'), message(1, 'a2'), message(3, 'c')];
    const archive = archivedTurns(messages, 3);
    expect(archive.map(group => group.turn)).toEqual([1, 2]);
    expect(archive[0].messages.map(item => item.content)).toEqual(['a1', 'a2']);
    // La storia non si cancella: il turno corrente resta solo fuori dall'archivio.
    expect(archive.flatMap(group => group.messages)).toHaveLength(3);
  });

  it('i messaggi legacy senza turno ricevono il turno corrente una volta sola', () => {
    const legacy = [message(undefined, 'vecchio senza turno'), message(1, 'turno 1')];
    const tagged = tagLegacyTurns(legacy, 4);
    expect(tagged.map(item => item.turn)).toEqual([4, 1]);
    // Già marcati: nessuna nuova copia (idempotente).
    expect(tagLegacyTurns(tagged, 5)).toBe(tagged);
  });
});
