import { describe, expect, it } from 'vitest';
import { diplomaticMessageForDisplay } from './diplomaticOpeningView';

describe('legacy diplomatic opening', () => {
  it('rende una vecchia intestazione una battuta, senza perdere il tema', () => {
    const heading = 'Proposta indiana di cooperazione su trasporti e commercio transfrontaliero';
    const display = diplomaticMessageForDisplay(heading, heading, 'polity');
    expect(display).toMatch(/^Desideriamo sottoporre/);
    expect(display).toContain('commercio transfrontaliero');
  });

  it('non riscrive dichiarazioni reali, messaggi del giocatore o altri testi', () => {
    expect(diplomaticMessageForDisplay('Chiediamo condizioni precise.', 'Chiediamo condizioni precise.', 'polity'))
      .toBe('Chiediamo condizioni precise.');
    expect(diplomaticMessageForDisplay('Proposta di intesa', 'Oggetto differente', 'polity'))
      .toBe('Proposta di intesa');
    expect(diplomaticMessageForDisplay('Proposta di intesa', 'Proposta di intesa', 'player'))
      .toBe('Proposta di intesa');
  });
});
