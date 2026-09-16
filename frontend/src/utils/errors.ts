/**
 * World Story — Fase 2: messaggi d'errore operativi
 * ================================================
 * Traduce gli errori tecnici del provider LLM (e del motore) in un messaggio
 * breve e azionabile per il giocatore. Funzione pura, testata: nessuna
 * dipendenza da React o dal DOM.
 */

/** Traduce gli errori tecnici del provider in un messaggio operativo breve. */
export function simulationErrorMessage(error: unknown): string {
  const raw = error instanceof Error ? error.message : String(error || '');
  const marker = raw.indexOf(' - ');
  const payload = marker >= 0 ? raw.slice(marker + 3) : raw;
  let detail = payload;
  try {
    const parsed = JSON.parse(payload);
    if (parsed?.error) detail = String(parsed.error);
  } catch { /* risposta non JSON */ }
  if (/\b401\b|unauthori[sz]ed|authentication/i.test(detail)) {
    return 'Chiave API assente o non valida: apri “Modello”, inserisci la chiave del provider e salva.';
  }
  return detail && detail.length < 240
    ? `Elaborazione non riuscita: ${detail}`
    : 'Elaborazione non riuscita. Controlla il modello IA e riprova.';
}
