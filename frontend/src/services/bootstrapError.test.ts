/**
 * BOOTSTRAP-FAIL-CLOSED — il messaggio d'errore della creazione partita.
 * =====================================================================
 * Il bootstrap del Dossier nazionale risponde 503 con un `error` leggibile:
 * il client deve mostrarlo, non nasconderlo dietro il generico «Riprova».
 * Quando non c'è un messaggio utile (HTML del proxy, errori non HTTP) resta
 * il fallback generico, senza riversare dettagli tecnici.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { gameApi, readableApiError, ReadableJobError, worldApi } from './api';

afterEach(() => {
  vi.unstubAllGlobals();
});

const stubFetch = (payload: unknown, status = 200) => {
  vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify(payload), {
    status,
    headers: { 'content-type': 'application/json' },
  })));
};

const GENERIC = 'Generazione del mondo fallita. Riprova.';

describe('BOOTSTRAP-FAIL-CLOSED — messaggio d’errore in creazione partita', () => {
  it('espone il messaggio leggibile del backend invece del generico', async () => {
    stubFetch({ error: 'Impossibile stimare il profilo iniziale del paese: tempo limite di 60 secondi superato. Partita non creata.' }, 503);

    const error = await gameApi.create({} as never).catch(cause => cause);

    expect(readableApiError(error, GENERIC)).toBe('Impossibile stimare il profilo iniziale del paese: tempo limite di 60 secondi superato. Partita non creata.');
  });

  it('senza messaggio utile resta il fallback generico', async () => {
    stubFetch('<html>Bad gateway</html>', 502);
    const httpError = await gameApi.create({} as never).catch(cause => cause);

    expect(readableApiError(httpError, GENERIC)).toBe(GENERIC);
    expect(readableApiError(new Error('boom'), GENERIC)).toBe(GENERIC);
    expect(readableApiError(new ReadableJobError('boom\n    at fn (/app/index.js:1:2)'), GENERIC)).toBe(GENERIC);
  });

  it('mostra il job.error leggibile quando il job di generazione mondo fallisce', async () => {
    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
      const body = String(url).endsWith('/worlds/generate')
        ? { jobId: 'j1', status: 'queued' }
        : { status: 'failed', error: 'Impossibile inizializzare il Dossier nazionale: il modello non ha risposto in tempo. Riprova.' };
      return new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } });
    }));

    const error = await worldApi.generateFromTemplate('template-1', 'IT').catch(cause => cause);

    expect(error).toBeInstanceOf(ReadableJobError);
    expect(readableApiError(error, GENERIC)).toBe('Impossibile inizializzare il Dossier nazionale: il modello non ha risposto in tempo. Riprova.');
  });
});
