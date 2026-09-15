/** Thread diplomatici: chiavi canoniche e deduplica (logica pura). */
import { describe, it, expect } from 'vitest';
import {
  canonicalParticipantKey,
  simulationThreadKey,
  reactionThreadKey,
} from '../src/core/chat/threads';

describe('thread diplomatici', () => {
  it('canonicalizza i partecipanti in modo stabile e senza duplicati', () => {
    expect(canonicalParticipantKey(['POL', 'DEU'])).toBe('DEU|POL');
    expect(canonicalParticipantKey(['DEU', 'POL', 'DEU', ''])).toBe('DEU|POL');
    expect(canonicalParticipantKey([])).toBe('');
  });

  it('distingue discussioni per evento, partecipanti e turno', () => {
    const a = simulationThreadKey({ simulationId: 'sim-1', eventHeadline: 'Vertice di frontiera', participantIds: ['POL', 'DEU'] });
    const b = simulationThreadKey({ simulationId: 'sim-1', eventHeadline: 'Vertice di frontiera', participantIds: ['DEU', 'POL'] });
    const c = simulationThreadKey({ simulationId: 'sim-1', eventHeadline: 'Crisi di Danzica', participantIds: ['POL', 'DEU'] });
    const d = simulationThreadKey({ turn: 4, eventHeadline: 'Vertice di frontiera', participantIds: ['POL', 'DEU'] });

    // Stesso evento e stessi partecipanti (ordine diverso) → stessa chiave: niente duplicati.
    expect(a).toBe(b);
    // Evento diverso o turno diverso → chiavi diverse: nuova discussione.
    expect(a).not.toBe(c);
    expect(a).not.toBe(d);
  });

  it('genera una chiave di reazione per nazione e turno', () => {
    expect(reactionThreadKey('POL', 7)).toBe('npc:7:POL');
    expect(reactionThreadKey('POL', 7)).toBe(reactionThreadKey('POL', 7));
    expect(reactionThreadKey('POL', 7)).not.toBe(reactionThreadKey('POL', 8));
  });
});
