import { describe, expect, it } from 'vitest';
import { publicNarrativeText } from './publicNarrative';

describe('publicNarrativeText', () => {
  it('ripulisce anche i dispacci legacy prima di mostrarli', () => {
    const result = publicNarrativeText(
      'Partecipanti: Player, Israele [ISR]. Il giocatore riceve un outcome rejected.',
      'Palestina',
    );
    expect(result).toContain('Palestina');
    expect(result).toContain('Israele');
    expect(result).toContain('respinta');
    expect(result).not.toMatch(/Player|giocatore|\[ISR\]|rejected/i);
  });
});
