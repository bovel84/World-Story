/**
 * DELETE SAVES — contratto HTTP di `savesApi.remove`.
 * ==================================================
 * Il servizio non decide nulla: manda `DELETE /api/saves/<id>` (id codificato) e
 * restituisce il payload del backend. Gli snapshot riservati sono rifiutati dal
 * server (`403 reserved_save`); qui si prova solo la richiesta, senza eccezioni
 * lato client.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { savesApi } from './api';

afterEach(() => {
  vi.unstubAllGlobals();
});

const stubFetch = (payload: unknown, status = 200) => {
  const calls: Array<{ url: string; init?: RequestInit }> = [];
  const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
    calls.push({ url, init });
    return new Response(JSON.stringify(payload), {
      status,
      headers: { 'content-type': 'application/json' },
    });
  });
  vi.stubGlobal('fetch', fetchMock);
  return calls;
};

describe('DELETE SAVES — savesApi.remove', () => {
  it('invia DELETE su /api/saves/:id e restituisce l’esito del backend', async () => {
    const calls = stubFetch({ ok: true, deleted: 'save-user' });

    const result = await savesApi.remove('save-user');

    expect(result).toEqual({ ok: true, deleted: 'save-user' });
    expect(calls.length).toBe(1);
    expect(calls[0].url).toBe('/api/saves/save-user');
    expect(calls[0].init?.method).toBe('DELETE');
  });

  it('codifica l’id nel percorso (nessun id interpolato grezzo)', async () => {
    const calls = stubFetch({ ok: true, deleted: 'a/b' });
    await savesApi.remove('a/b c');
    expect(calls[0].url).toBe('/api/saves/a%2Fb%20c');
  });

  it('propaga l’errore del backend senza cancellare nulla lato client', async () => {
    stubFetch({ error: 'Salvataggio riservato: non cancellabile', code: 'reserved_save' }, 403);
    await expect(savesApi.remove('save-rewind')).rejects.toThrow(/403/);
  });
});
