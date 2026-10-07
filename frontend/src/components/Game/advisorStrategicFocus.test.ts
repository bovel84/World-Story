/**
 * fix/advisor-strategic-focus-continuity — Il focus del Consulente conserva
 * TUTTE le fonti canoniche (segnali + prove), non solo il primo segnale, e la
 * memoria non le perde nel giro salva/carica.
 *
 * Defende tre cose:
 *  - il payload reale inviato al server (`focusSituation`) con id, signalKeys ed
 *    evidenceKeys, senza titolo/sintesi come campi autorevoli;
 *  - un focus evidence-only (nessuna signalKey) viene comunque trasmesso;
 *  - apertura e chat in `localStorage` preservano evidenceKeys, kind e situationId.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { advisorApi, type AdvisorSituation, type CouncilIssue } from '../../services/api';
import { buildSituationFocusMessage, buildSituationFocusPayload } from './AdvisorSituationsPanel';
import { advisorBucketKey, advisorOpeningKey, loadAdvisorMessages, loadAdvisorOpening, saveAdvisorMessages, saveAdvisorOpening } from './advisorMemory';

function fakeStorage(): Storage {
  const map = new Map<string, string>();
  return {
    get length() { return map.size; },
    clear: () => map.clear(),
    getItem: (key: string) => map.get(key) ?? null,
    key: (index: number) => Array.from(map.keys())[index] ?? null,
    removeItem: (key: string) => { map.delete(key); },
    setItem: (key: string, value: string) => { map.set(key, value); },
  };
}

const situation = (over: Partial<AdvisorSituation> = {}): AdvisorSituation => ({
  id: 'integrazione',
  title: 'Integrazione economica regionale',
  summary: 'La cooperazione regionale offre una direzione politica.',
  signalKeys: ['hostile-relations:SDN', 'food-coverage'],
  evidenceKeys: ['historical:abc123'],
  kind: 'opportunity',
  importance: 1,
  ...over,
});

const issue = (): CouncilIssue => ({
  id: 'i1', title: 'Mandato commerciale',
  question: 'Autorizzare Esteri a proporre un negoziato regionale?',
  situationId: 'integrazione',
  signalKeys: ['hostile-relations:SDN'],
  verifiedFacts: [],
  suggestedMinisters: ['esteri', 'tesoro'], origin: 'advisor',
  sourceRefs: ['diplomacy.relations.SDN'], createdDate: '2000-01-01',
});

const okFetch = () => {
  const fetch = vi.fn().mockResolvedValue(
    new Response(JSON.stringify({ reply: 'Ok', issues: [], situations: [] }), { status: 200 }),
  );
  vi.stubGlobal('fetch', fetch);
  return fetch;
};

afterEach(() => vi.unstubAllGlobals());

describe('advisor strategic focus continuity', () => {
  it('invia TUTTI i riferimenti canonici nel payload, mai titolo o sintesi', async () => {
    const fetch = okFetch();
    const focus = buildSituationFocusPayload(situation());
    await advisorApi.reality('g1', buildSituationFocusMessage(situation()), [], undefined, undefined, focus);

    const payload = JSON.parse(fetch.mock.calls[0][1].body);
    expect(payload.focusSituation).toEqual({
      id: 'integrazione',
      signalKeys: ['hostile-relations:SDN', 'food-coverage'],
      evidenceKeys: ['historical:abc123'],
    });
    // Titolo e sintesi restano presentazione: non entrano come campi autorevoli.
    expect(payload.focusSituation.title).toBeUndefined();
    expect(payload.focusSituation.summary).toBeUndefined();
    // Il messaggio visibile è solo conversazione.
    expect(payload.message).toBe('Approfondiamo la situazione «Integrazione economica regionale».');
    expect(payload.message).not.toContain('La cooperazione regionale');
  });

  it('un focus evidence-only viene trasmesso anche senza signalKeys', async () => {
    const fetch = okFetch();
    const evidenceOnly = situation({ signalKeys: undefined, evidenceKeys: ['current:fact-1'] });
    const focus = buildSituationFocusPayload(evidenceOnly);
    expect(focus).toEqual({ id: 'integrazione', evidenceKeys: ['current:fact-1'] });

    await advisorApi.reality('g1', 'Approfondiamo', [], undefined, undefined, focus);
    const payload = JSON.parse(fetch.mock.calls[0][1].body);
    expect(payload.focusSituation).toEqual({ id: 'integrazione', evidenceKeys: ['current:fact-1'] });
    expect(payload.focusSituation.signalKey).toBeUndefined();
  });

  it('senza alcun riferimento canonico non produce un focus vuoto', () => {
    expect(buildSituationFocusPayload(situation({ signalKeys: undefined, evidenceKeys: undefined }))).toBeUndefined();
  });

  it('la memoria conserva evidenceKeys, kind e situationId nel giro chat e apertura', () => {
    (globalThis as { localStorage?: Storage }).localStorage = fakeStorage();
    const bucket = advisorBucketKey('g1', 'main', 'g1|main|1');
    saveAdvisorMessages(bucket, [
      { role: 'assistant', content: 'Quadro', turn: 1, situations: [situation()], issues: [issue()] },
    ]);
    const restored = loadAdvisorMessages(bucket)[0];
    expect(restored.situations?.[0].signalKeys).toEqual(['hostile-relations:SDN', 'food-coverage']);
    expect(restored.situations?.[0].evidenceKeys).toEqual(['historical:abc123']);
    expect(restored.situations?.[0].kind).toBe('opportunity');
    expect(restored.issues?.[0].situationId).toBe('integrazione');

    const openingKey = advisorOpeningKey('g1', 'main', 'g1|main|1');
    saveAdvisorOpening(openingKey, {
      reply: 'Presidente, una direzione possibile è la cooperazione regionale.',
      issues: [issue()], situations: [situation()], date: '2000-01-01',
    });
    const restoredOpening = loadAdvisorOpening(openingKey)!;
    expect(restoredOpening.situations?.[0].evidenceKeys).toEqual(['historical:abc123']);
    expect(restoredOpening.situations?.[0].kind).toBe('opportunity');
    expect(restoredOpening.issues[0].situationId).toBe('integrazione');
  });
});
