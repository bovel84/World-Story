/**
 * WS-MINISTER-UX-07 (A2) — La voce di spesa discussa, scelta in locale
 * ====================================================================
 * Difende la scelta **deterministica** della voce da evidenziare quando la
 * conversazione parla di spesa. Le etichette arrivano dal read model del
 * bilancio: qui si prova solo la scelta, mai una cifra.
 */
import { describe, expect, it } from 'vitest';
import { matchSpendingVoice } from './spendingFocus';

const LABELS = [
  'Difesa',
  'Amministrazione pubblica',
  'Istruzione e ricerca',
  'Sanità e assistenza',
  'Infrastrutture e trasporti',
  'Sostegno sociale e lavoro',
  'Altre uscite',
];

describe('matchSpendingVoice (A2)', () => {
  it('una domanda sulla sanità punta alla voce sanitaria', () => {
    expect(matchSpendingVoice('Mi mostri dove va la spesa per la sanità?', LABELS)).toBe('Sanità e assistenza');
    expect(matchSpendingVoice('Gli ospedali chiedono fondi', LABELS)).toBe('Sanità e assistenza');
  });

  it('una domanda sulle opere punta alle infrastrutture', () => {
    expect(matchSpendingVoice('E per i cantieri e le strade?', LABELS)).toBe('Infrastrutture e trasporti');
    expect(matchSpendingVoice('Quanto spendiamo per le opere pubbliche?', LABELS)).toBe('Infrastrutture e trasporti');
  });

  it('una domanda sulle scuole punta all’istruzione', () => {
    expect(matchSpendingVoice('La spesa per gli atenei e la ricerca', LABELS)).toBe('Istruzione e ricerca');
  });

  it('una domanda sulla guerra punta alla difesa, non al saldo', () => {
    expect(matchSpendingVoice('Quanto costa la guerra e i militari?', LABELS)).toBe('Difesa');
  });

  it('una voce è scelta se e solo se una parola combacia: mai a caso', () => {
    // Nessun aggancio: si torna `null` e la tavola mostra l'insieme.
    expect(matchSpendingVoice('Mostrami il saldo del bilancio', LABELS)).toBeNull();
    expect(matchSpendingVoice('', LABELS)).toBeNull();
    // Testo vuoto o solo spazi non sceglie nulla.
    expect(matchSpendingVoice('   ', LABELS)).toBeNull();
  });

  it('è stabile e senza stato: stesso testo, stessa voce', () => {
    const text = 'La sanità e gli ospedali';
    expect(matchSpendingVoice(text, LABELS)).toBe(matchSpendingVoice(text, LABELS));
  });
});
