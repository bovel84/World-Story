/**
 * WS-GOV-ADVISOR-CHIEF-OF-STAFF — la conversazione del Consulente per turno
 * sopravvive al reload, senza mescolare i turni.
 */
import { describe, expect, it } from 'vitest';
import { advisorBucketKey, loadAdvisorMessages, mergeAdvisorMessages, saveAdvisorMessages } from './advisorMemory';
import type { AdvisorMessage } from '../../stores/chatStore';

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

const scope = (turn: number, branch = 'main') => `g1|${branch}|${turn}`;

describe('advisorMemory', () => {
  it('salva e ricarica il turno; bucket diversi non si mescolano', () => {
    (globalThis as { localStorage?: Storage }).localStorage = fakeStorage();
    const first: AdvisorMessage[] = [
      { role: 'user', content: 'Come sta la cassa?', turn: 3 },
      { role: 'assistant', content: 'Il margine si assottiglia.', turn: 3 },
    ];
    saveAdvisorMessages(advisorBucketKey('g1', scope(3)), first);
    expect(loadAdvisorMessages(advisorBucketKey('g1', scope(3)))).toEqual(first);
    // Un altro turno (e un altro ramo) restano vuoti: nessuna contaminazione.
    expect(loadAdvisorMessages(advisorBucketKey('g1', scope(4)))).toEqual([]);
    expect(loadAdvisorMessages(advisorBucketKey('g1', scope(3, 'fork')))).toEqual([]);
  });

  it('lo storage rotto non rompe la conversazione e il merge non duplica', () => {
    (globalThis as { localStorage?: Storage }).localStorage = {
      ...fakeStorage(),
      getItem: () => '{non json',
      setItem: () => { throw new Error('quota'); },
    } as Storage;
    expect(loadAdvisorMessages('qualsiasi')).toEqual([]);
    expect(() => saveAdvisorMessages('qualsiasi', [{ role: 'user', content: 'x', turn: 1 }])).not.toThrow();

    const existing: AdvisorMessage[] = [{ role: 'user', content: 'già in chat', turn: 2 }];
    const restored: AdvisorMessage[] = [{ role: 'user', content: 'già in chat', turn: 2 }, { role: 'assistant', content: 'nuovo', turn: 2 }];
    expect(mergeAdvisorMessages(existing, restored).map(item => item.content)).toEqual(['già in chat', 'nuovo']);
  });
});
