/**
 * Test-contratto del collegamento dispaccio ↔ ordine
 * ==================================================
 * Difende la regola §6.2 della SPEC (collegamento per ID, mai per confronto di
 * testo) e il §3.2 punto 8 del piano maestro («Perché è accaduto: ordine, fase,
 * effetti»).
 *
 * Il difetto misurato: il motore indicizzava gli ordini **con il titolo come
 * chiave** e li cercava con un'uguaglianza di stringa esatta. Il modello scrive
 * lo stesso titolo due volte e le due copie differiscono spesso di uno spazio o
 * di una maiuscola — nella partita reale, 0 dispacci su 21 portavano l'ordine.
 *
 * Il test verifica che le differenze che il modello produce per sbaglio **non**
 * rompano il collegamento, e che due titoli realmente diversi restino diversi
 * (guardia contro un normalizzatore troppo aggressivo, che attribuirebbe a un
 * ordine un dispaccio che non gli appartiene: peggio di nessun collegamento).
 */
import { describe, it, expect } from 'vitest';
import { buildActionLinkIndex, headlineKey, lookupActionIds } from './dispatchLink';

describe('headlineKey — normalizza senza cambiare il senso', () => {
  it('pareggia maiuscole, spazi e punteggiatura di bordo', () => {
    const varianti = [
      'Roma ordina la mobilitazione generale',
      'roma ordina la mobilitazione generale',
      '  Roma  ordina la mobilitazione generale  ',
      'Roma ordina la mobilitazione generale.',
      '«Roma ordina la mobilitazione generale»',
      'Evento 3: Roma ordina la mobilitazione generale',
    ];
    const chiavi = new Set(varianti.map(headlineKey));
    // Guardia: tutte le varianti devono essere state lette.
    expect(varianti.length).toBe(6);
    expect(chiavi.size).toBe(1);
  });

  it('NON confonde due dispacci diversi', () => {
    const a = headlineKey('La Germania occupa la Renania');
    const b = headlineKey('La Germania occupa il Ruhr');
    expect(a).not.toBe(b);
  });

  it('un titolo vuoto non produce una chiave', () => {
    expect(headlineKey('')).toBe('');
    expect(headlineKey(undefined)).toBe('');
    expect(headlineKey('   ')).toBe('');
  });
});

describe('buildActionLinkIndex + lookupActionIds', () => {
  it('collega un dispaccio al suo ordine anche se il modello scrive il titolo in modo diverso', () => {
    // L'esito dell'ordine porta il titolo con una virgoletta; l'evento senza.
    const index = buildActionLinkIndex([
      { headline: '«Roma ordina la mobilitazione generale»', actionId: 'a1' },
    ]);
    expect(lookupActionIds(index, 'roma ordina la mobilitazione generale.')).toEqual(['a1']);
  });

  it('due ordini diversi su uno stesso dispaccio restano entrambi', () => {
    const index = buildActionLinkIndex([
      { headline: 'Vertice di Ginevra', actionId: 'a1' },
      { headline: 'VERTICE DI GINEVRA.', actionId: 'a2' },
    ]);
    expect(lookupActionIds(index, 'Vertice di Ginevra')).toEqual(['a1', 'a2']);
  });

  it('un dispaccio del mondo, senza ordine, resta senza collegamento', () => {
    const index = buildActionLinkIndex([
      { headline: 'Roma ordina la mobilitazione generale', actionId: 'a1' },
    ]);
    // «Lunga deriva» è un fatto del mondo: non deve ricevere un ordine a caso.
    expect(lookupActionIds(index, 'Lunga deriva')).toEqual([]);
    expect(lookupActionIds(index, undefined)).toEqual([]);
    expect(lookupActionIds(undefined, 'Lunga deriva')).toEqual([]);
  });

  it('un indice salvato prima della correzione (chiavi non normalizzate) continua a funzionare', () => {
    // Compatibilità: i salvataggi esistenti hanno chiavi esatte.
    const vecchio = { 'Vertice di Ginevra': ['a9'] };
    expect(lookupActionIds(vecchio, 'Vertice di Ginevra')).toEqual(['a9']);
  });

  it('non duplica lo stesso ordine se compare due volte', () => {
    const index = buildActionLinkIndex([
      { headline: 'Vertice di Ginevra', actionId: 'a1' },
      { headline: 'vertice di ginevra', actionId: 'a1' },
    ]);
    expect(lookupActionIds(index, 'Vertice di Ginevra')).toEqual(['a1']);
  });
});
