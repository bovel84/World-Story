import { describe, it, expect } from 'vitest';
import { classifyDispatch, dispatchCategoryLabel } from './dispatchCategory';

describe('classifyDispatch', () => {
  it('riconosce una notizia di scontro armato', () => {
    expect(classifyDispatch('Terza battaglia di Kharkiv', 'Le truppe aprono un varco sul fronte.').key).toBe('war');
    expect(classifyDispatch('La flotta giapponese bombarda le isole').key).toBe('war');
  });

  it('riconosce diplomazia ed economia senza confonderle', () => {
    expect(classifyDispatch('Vertice di Ginevra', 'Le delegazioni firmano un trattato di non aggressione.').key).toBe('diplomacy');
    expect(classifyDispatch('Il marco perde valore', 'L’inflazione erode il bilancio industriale.').key).toBe('economy');
  });

  it('considera anche il dettaglio del dispaccio', () => {
    expect(classifyDispatch('Comunicato del governo', 'Il ministro degli esteri apre un negoziato.').key).toBe('diplomacy');
  });

  it('ricade sulla politica per i testi generici', () => {
    expect(classifyDispatch('Un nuovo gabinetto entra in carica').key).toBe('politics');
    expect(classifyDispatch('').key).toBe('politics');
    expect(dispatchCategoryLabel('war')).toBe('Scontri');
  });
});
