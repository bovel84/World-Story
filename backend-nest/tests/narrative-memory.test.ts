import { describe, expect, it } from 'vitest';
import { buildNarrativeMemory } from '../src/prompts/narrative-memory';
import { parseIncrementalSimulationRecord } from '../src/prompts/simulation';

describe('Narrative memory budgets', () => {
  it('keeps the latest event before summaries and long historical memory', () => {
    const turns = Array.from({ length: 12 }, (_, i) => ({
      turn: i + 1, date: '1951-01-01', narration: 'Sintesi lunga. '.repeat(300),
      timelineEvents: Array.from({ length: 8 }, (_, j) => ({
        date: '1951-01-01', headline: `Evento ${i}:${j}`, detail: `CONTESTO_${i}_${j} ${'Storia verificata. '.repeat(400)}`,
      })),
    }));
    const copy = JSON.stringify(turns);
    const memory = buildNarrativeMemory(turns, `CANONE ${'Cronaca remota. '.repeat(2000)}`);
    expect(memory.length).toBeLessThanOrEqual(4500);
    expect(memory).toContain('CONTESTO_11_7');
    expect(memory).toContain('CANONE');
    expect(memory.indexOf('CONTESTO_11_7')).toBeLessThan(memory.indexOf('CANONE'));
    expect(memory).not.toContain('CONTESTO_0_0');
    expect(JSON.stringify(turns)).toBe(copy);
  });
  it('works with empty history and old saves without detailed events', () => {
    expect(buildNarrativeMemory([])).toBe('');
    expect(buildNarrativeMemory([], 'Solo premessa storica')).toContain('Solo premessa storica');
    const memory = buildNarrativeMemory([{ turn: 1, narration: 'Rifornimenti interrotti.', events: ['Il porto chiude'] }]);
    expect(memory).toContain('Il porto chiude');
    expect(memory).toContain('Rifornimenti interrotti.');
  });
  it('retains the two context paragraphs through the actual streaming parser', () => {
    const description = 'Il porto rifornisce il territorio e resta chiuso dopo i danni documentati. Le forniture dipendono dalla sua riapertura.\n\nIl governo autorizza i lavori già pianificati. Il cantiere non è ancora operativo.';
    const event = parseIncrementalSimulationRecord({ type: 'event', headline: 'Al porto iniziano i lavori', description, date: '1951-01-02', mapChanges: [], reactions: [] });
    expect(event?.type).toBe('event');
    if (event?.type === 'event') expect(event.event.description).toBe(description);
  });
});
