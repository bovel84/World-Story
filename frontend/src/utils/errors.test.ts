/**
 * World Story — Fase 2: test dei messaggi d'errore operativi
 * ========================================================
 */
import { describe, it, expect } from 'vitest';
import { simulationErrorMessage } from './errors';

describe('simulationErrorMessage', () => {
  it('mappa gli errori di autenticazione su un invito ad aprire «Modello»', () => {
    expect(simulationErrorMessage(new Error('HTTP 401 unauthorized'))).toMatch(/Chiave API assente/);
    expect(simulationErrorMessage('status - authentication failed')).toMatch(/Chiave API assente/);
  });

  it('estrae il campo error da un payload JSON dopo il separatore " - "', () => {
    expect(simulationErrorMessage('LLM error - {"error":"quota esaurita"}')).toBe('Elaborazione non riuscita: quota esaurita');
  });

  it('usa il dettaglio testuale quando è breve', () => {
    expect(simulationErrorMessage(new Error('connessione rifiutata'))).toBe('Elaborazione non riuscita: connessione rifiutata');
  });

  it('ripiega su un messaggio generico per dettagli lunghi o assenti', () => {
    expect(simulationErrorMessage(new Error('x'.repeat(300)))).toBe('Elaborazione non riuscita. Controlla il modello IA e riprova.');
    expect(simulationErrorMessage(undefined)).toBe('Elaborazione non riuscita. Controlla il modello IA e riprova.');
  });
});
