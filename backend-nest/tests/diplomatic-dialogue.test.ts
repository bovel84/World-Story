import { describe, it, expect } from 'vitest';
import { addressedDelegations, sameDiplomaticTopic } from '../src/core/chat/dialogue';

const delegates = [{ id: 'POL', name: 'Polonia' }, { id: 'CZE', name: 'Cecoslovacchia' }];
describe('interlocutori e continuità politica', () => {
  it('distingue domande individuali, proposte comuni e codici senza corrispondenze parziali', () => {
    expect(addressedDelegations('Polonia, accettereste osservatori?', delegates)).toEqual(['Polonia']);
    expect(addressedDelegations('POL: accettereste?', delegates)).toEqual(['Polonia']);
    expect(addressedDelegations('La politica commerciale va discussa insieme.', delegates)).toEqual([]);
    expect(addressedDelegations('Polonia e Cecoslovacchia, discutiamone.', delegates)).toHaveLength(2);
  });
  it('riconosce uno sviluppo del medesimo tema senza fondere commercio e sicurezza', () => {
    expect(sameDiplomaticTopic('Osservatori al valico di Praga', 'Controlli al valico di Praga')).toBe(true);
    expect(sameDiplomaticTopic('Transiti commerciali', 'Sicurezza dei confini')).toBe(false);
    expect(sameDiplomaticTopic('', 'Sicurezza dei confini')).toBe(false);
  });
});
