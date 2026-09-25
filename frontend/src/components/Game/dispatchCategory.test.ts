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

  it('riconosce le notizie di servizio come Amministrazione (§11.3)', () => {
    // Sono i dispacci che il motore compone in `dispatchComposer.ts`: devono
    // restare distinguibili da una svolta politica (§11.3 della SPEC).
    expect(classifyDispatch('Il Tesoro rifinanzia il debito in scadenza nel 2029').key).toBe('administration');
    expect(classifyDispatch('Si esaurisce il giacimento di oil').key).toBe('administration');
    expect(classifyDispatch('Carenza di carburante: la produzione rallenta').key).toBe('administration');
  });

  it('una vera svolta politica NON diventa amministrazione', () => {
    // Guardia contro un pattern troppo largo: la parola «governo» compare in
    // entrambe le famiglie, ma un cambio di regime resta politica.
    expect(classifyDispatch('Un colpo di Stato rovescia la monarchia').key).toBe('politics');
    expect(classifyDispatch('Il parlamento approva la nuova costituzione').key).toBe('politics');
    // E una battaglia resta uno scontro, non un fatto di logistica.
    expect(classifyDispatch('Offensiva sul fronte orientale').key).toBe('war');
  });
});
