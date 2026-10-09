/**
 * M-APERTURA — La prima risposta del Consulente passa per lo stesso contratto
 * dei turni.
 *
 * Causa del difetto: `AdvisorChat` costruiva il messaggio dell'apertura con i
 * soli `situations`/`issues`, senza mai parsare `opening.reply`. Il blocco
 * `tavola` restava quindi JSON tecnico visibile e non produceva alcuna
 * `GovernmentVisualCard`. Qui si blinda: parsing all'origine, metadati persistiti
 * e rivalidati, `scopeKey` di generazione mai ri-stampato su un mondo nuovo.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import type { Region } from '../../types';
import type { AdvisorSituation, CouncilIssue, RealityAdvisorResponse } from '../../services/api';
import { buildMapContextIndex } from '../Map/mapContext';
import { GovernmentMessageVisuals } from './GovernmentMessageVisuals';
import { buildGovernmentVisualSnapshot, resolveGovernmentVisuals } from './governmentVisual';
import { safeGovernmentVisualText } from './governmentVisualRequest';
import { advisorOpeningMessage, toAdvisorOpening } from './advisorOpening';
import { advisorOpeningKey, loadAdvisorOpening, saveAdvisorOpening, type AdvisorOpening } from './advisorMemory';

const SCOPE = 'game:A:branch:1';
const KEY = advisorOpeningKey('game-1', 'branch-1', 'session');

class MemoryStorage {
  private entries = new Map<string, string>();
  get length(): number { return this.entries.size; }
  clear(): void { this.entries.clear(); }
  getItem(key: string): string | null { return this.entries.get(key) ?? null; }
  key(index: number): string | null { return [...this.entries.keys()][index] ?? null; }
  removeItem(key: string): void { this.entries.delete(key); }
  setItem(key: string, value: string): void { this.entries.set(key, value); }
}

let originalStorage: unknown;
beforeEach(() => { originalStorage = (globalThis as { localStorage?: unknown }).localStorage; (globalThis as { localStorage?: unknown }).localStorage = new MemoryStorage(); });
afterEach(() => { (globalThis as { localStorage?: unknown }).localStorage = originalStorage; });

const issue = (): CouncilIssue => ({ id: 'i1', title: 'Approvvigionamenti', question: 'Come?', createdDate: '2000-06-01', origin: 'advisor', suggestedMinisters: [], sourceRefs: [], verifiedFacts: [], signalKeys: ['hostile-relations:PRK'] }) as unknown as CouncilIssue;
const situation = (): AdvisorSituation => ({ id: 's1', title: 'Il vicino', summary: 'Tensione al confine.', signalKeys: ['hostile-relations:PRK'] }) as unknown as AdvisorSituation;

const REGIONS: Region[] = [
  { id: 'seoul', name: 'Seul', polityName: 'Corea del Sud', owner: 'KOR', color: '#315f87', svgPath: 'M0 0 L60 0 L60 60 Z', objects: [], borders: [], metadata: {} },
] as unknown as Region[];

const snapshot = (scopeKey = SCOPE) => buildGovernmentVisualSnapshot({
  scopeKey, canonicalSnapshotKey: scopeKey, militarySnapshotKey: scopeKey,
  index: buildMapContextIndex({ regions: REGIONS, units: [], fronts: [] }), unavailable: false, playerPolityId: 'KOR',
})!;

const response = (reply: string): RealityAdvisorResponse => ({ reply, issues: [issue()], situations: [situation()], advisorContext: { verifiedWorldSnapshot: { date: '2000-06-01' } } }) as unknown as RealityAdvisorResponse;
const WITH_DIRECTIVE = 'Presidente, ecco dove ci troviamo.\n```tavola\n{"op":"focus","evidence":"mappa"}\n```';

describe('M-APERTURA — il blocco tavola nella risposta iniziale', () => {
  it('estrae la direttiva, ripulisce il testo e lega la richiesta allo scope di generazione', () => {
    const opening = toAdvisorOpening(response(WITH_DIRECTIVE), SCOPE);
    expect(opening.reply).toBe('Presidente, ecco dove ci troviamo.');
    expect(opening.reply).not.toContain('tavola');
    expect(opening.evidence).toHaveLength(1);
    expect(opening.visualRequest?.scopeKey).toBe(SCOPE);
    expect(opening.visualRequest?.intent).toBe('generic');
    // situations/issues non si perdono.
    expect(opening.situations).toHaveLength(1);
    expect(opening.issues).toHaveLength(1);
  });

  it('la card compare sotto l\'apertura e nessun JSON tecnico è visibile', () => {
    const opening = toAdvisorOpening(response(WITH_DIRECTIVE), SCOPE);
    const message = advisorOpeningMessage(opening);
    const html = renderToStaticMarkup(<GovernmentMessageVisuals message={message} snapshot={snapshot()}
      renderText={hasVisual => <p>{safeGovernmentVisualText(message.content ?? '', hasVisual)}</p>} />);
    expect(html).toContain('government-visual-card');
    expect(html).toContain('Presidente, ecco dove ci troviamo.');
    expect(html).not.toContain('tavola');
    expect(html).not.toContain('"op"');
  });

  it('senza direttiva non si inventa una mappa', () => {
    const opening = toAdvisorOpening(response('Solo prosa, nessuna mappa.'), SCOPE);
    expect(opening.evidence).toBeUndefined();
    expect(opening.visualRequest).toBeUndefined();
    expect(renderToStaticMarkup(<GovernmentMessageVisuals message={advisorOpeningMessage(opening)} snapshot={snapshot()} />)).toBe('');
  });
});

describe('M-APERTURA — la cache', () => {
  it('conserva proposte, situazioni e metadati geografici al reload', () => {
    const opening = toAdvisorOpening(response(WITH_DIRECTIVE), SCOPE);
    saveAdvisorOpening(KEY, opening);
    const reloaded = loadAdvisorOpening(KEY)!;
    expect(reloaded.issues).toHaveLength(1);
    expect(reloaded.situations).toHaveLength(1);
    expect(reloaded.evidence).toHaveLength(1);
    expect(reloaded.visualRequest?.scopeKey).toBe(SCOPE);
    expect(reloaded.visualRequest?.intent).toBe('generic');
    // E la mappa ricompare solo sullo scope di generazione.
    expect(resolveGovernmentVisuals(advisorOpeningMessage(reloaded), snapshot())).toHaveLength(1);
  });

  it('un\'apertura salvata NON si ri-attribuisce a uno snapshot nuovo', () => {
    const opening: AdvisorOpening = { reply: 'Testo.', issues: [issue()], date: '2000-06-01',
      evidence: [{ op: 'focus', evidence: 'mappa' }], visualRequest: { requested: true, scopeKey: SCOPE, intent: 'generic', signalKeys: [] } };
    saveAdvisorOpening(KEY, opening);
    const reloaded = loadAdvisorOpening(KEY)!;
    expect(resolveGovernmentVisuals(advisorOpeningMessage(reloaded), snapshot('game:A:branch:2'))).toEqual([]);
    // E, con lo scope corrente noto, non compare nemmeno il falso messaggio di
    // assenza geografica: la richiesta scaduta non viene mostrata affatto.
    const stale = advisorOpeningMessage(reloaded, 'game:A:branch:2');
    expect(stale.visualRequest).toBeUndefined();
    expect(renderToStaticMarkup(<GovernmentMessageVisuals message={stale} snapshot={snapshot('game:A:branch:2')} />)).toBe('');
  });

  it('una cache vecchia (senza metadati) mostra il testo pulito ma nessuna mappa', () => {
    localStorage.setItem(KEY, JSON.stringify({ reply: WITH_DIRECTIVE, issues: [issue()], situations: [situation()], date: '2000-06-01' }));
    const reloaded = loadAdvisorOpening(KEY)!;
    expect(reloaded.evidence).toBeUndefined();
    expect(reloaded.visualRequest).toBeUndefined();
    expect(reloaded.issues).toHaveLength(1);
    expect(reloaded.situations).toHaveLength(1);
    const message = advisorOpeningMessage(reloaded);
    expect(message.content).not.toContain('tavola');
    expect(resolveGovernmentVisuals(message, snapshot())).toEqual([]);
  });
});
