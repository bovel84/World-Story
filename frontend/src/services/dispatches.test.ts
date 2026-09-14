import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { normalizeWorldEventPayload } from './dispatches';

const apiSource = fs.readFileSync(path.resolve(__dirname, 'api.ts'), 'utf8');
const appSource = fs.readFileSync(path.resolve(__dirname, '..', 'App.tsx'), 'utf8');

describe('normalizzazione dispacci SSE', () => {
  it('legge il formato canonico dell’outbox a evento singolo', () => {
    expect(normalizeWorldEventPayload({
      eventId: 'event-1',
      runId: 'run-1',
      date: '2026-01-10',
      headline: 'Tavolo diplomatico',
      detail: 'Le delegazioni si incontrano.',
      source: 'world',
      sourceActionIds: ['action-1'],
    })).toEqual([{
      eventId: 'event-1',
      date: '2026-01-10',
      headline: 'Tavolo diplomatico',
      detail: 'Le delegazioni si incontrano.',
      source: 'world',
      regionIds: [],
    }]);
  });

  it('mantiene la compatibilità con il vecchio formato aggregato', () => {
    expect(normalizeWorldEventPayload({
      events: ['Titolo legacy'],
      eventDetails: [{ id: 'legacy-1', date: '2026-02-01', headline: 'Titolo dettagliato', detail: 'Corpo.', source: 'diplomacy' }],
      newDate: '2026-02-02',
      changedRegions: [{ id: 'region-1' }],
    })).toEqual([{
      eventId: 'legacy-1',
      date: '2026-02-01',
      headline: 'Titolo dettagliato',
      detail: 'Corpo.',
      source: 'diplomacy',
      regionIds: ['region-1'],
    }]);
  });

  it('ignora payload senza titoli utilizzabili', () => {
    expect(normalizeWorldEventPayload({ events: [] })).toEqual([]);
  });

  it('il frontend inoltra il formato canonico al feed visibile', () => {
    expect(appSource).toContain('normalizeWorldEventPayload(data)');
    expect(appSource).toContain('dispatch.eventId');
    expect(appSource).toContain('dispatch.detail');
    expect(appSource).toContain('publishEventDetails(details)');
  });
});

describe('avanzamento asincrono attraverso Cloudflare', () => {
  it('accetta un job breve, ne interroga lo stato e recupera il risultato', () => {
    expect(apiSource).toContain('/simulation-jobs`');
    expect(apiSource).toContain('/simulation-jobs/${accepted.jobId}`');
    expect(apiSource).toContain('/simulation-jobs/${accepted.jobId}/result`');
    expect(apiSource).toContain('window.setTimeout(resolve, 1500)');
  });
});
