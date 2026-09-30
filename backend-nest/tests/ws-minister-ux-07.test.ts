/**
 * WS-MINISTER-UX-07 — Copertura di verifica (B)
 * =============================================
 * Questa fase non costruisce meccaniche: verifica e rifinisce. Qui stanno i
 * casi di copertura chiesti dalla roadmap che non erano già difesi altrove:
 *
 *  - **eventi fuori ordine**: un evento tardivo o duplicato non rompe lo stato
 *    né duplica il ricordo (l'`id` è la chiave, l'ultima scrittura vince);
 *  - **fonti dei numeri**: il blocco di prompt della memoria non porta cifre e
 *    dichiara il confine con i fatti aggiornati (le altre fonti sono difese nei
 *    test dei read model e in `p02b-minister-chat.test.ts`).
 *
 * Gli altri punti di B sono già coperti e sono citati nel report:
 * schema direttive (`presentation.test.ts`), isolamento ministri
 * (`ws-minister-ux-05*.test.ts`, P04c), persistenza/rewind (innesto UX-05),
 * ordini duplicati (`actDraft.test.ts`, P06), firma/esito (P06).
 */
import { describe, expect, it } from 'vitest';
import {
  emptyMinisterMemory, memorySection, pruneMinisterMemory, recordMinisterMemory,
  type MinisterMemoryRecord, type MinisterMemoryScope,
} from '../src/core/government/MinisterMemory';

const scope: MinisterMemoryScope = {
  gameId: 'g1', branchId: 'main', seat: 'tesoro', mandate: 'Ministro del Tesoro, I legislatura',
};

function record(overrides: Partial<MinisterMemoryRecord> = {}): MinisterMemoryRecord {
  return {
    id: 'evt-1',
    kind: 'proposal-discussed',
    state: 'discussed',
    summary: 'Ospedale del sud',
    refs: { gameDate: '1951-03-01', turn: 3 },
    ...overrides,
  };
}

describe('WS-MINISTER-UX-07 (B) — eventi fuori ordine e duplicati', () => {
  it('un evento duplicato non duplica il ricordo: l’ultima scrittura vince', () => {
    let memory = emptyMinisterMemory(scope);
    memory = recordMinisterMemory(memory, record());
    memory = recordMinisterMemory(memory, record({ state: 'queued', kind: 'queued-decision' }));
    memory = recordMinisterMemory(memory, record({ state: 'queued', kind: 'queued-decision' }));
    expect(memory.records).toHaveLength(1);
    expect(memory.records[0].state).toBe('queued');
  });

  it('un evento tardivo (turno più vecchio) non riscrive il futuro', () => {
    let memory = emptyMinisterMemory(scope);
    memory = recordMinisterMemory(memory, record({ id: 'futuro', refs: { gameDate: '1951-06-01', turn: 12 } }));
    memory = recordMinisterMemory(memory, record({ id: 'passato', refs: { gameDate: '1951-02-01', turn: 2 } }));
    // Entrambi restano: il sistema non riordina la storia, la conserva.
    expect(memory.records.map(r => r.id).sort()).toEqual(['futuro', 'passato']);
    // E il rewind pota solo il futuro, non il tardivo.
    const pruned = pruneMinisterMemory(memory, { turn: 5 });
    expect(pruned.records.map(r => r.id)).toEqual(['passato']);
  });

  it('non porta cifre: il blocco di prompt dichiara che i fatti aggiornati vincono', () => {
    let memory = emptyMinisterMemory(scope);
    memory = recordMinisterMemory(memory, record());
    const section = memorySection(memory);
    expect(section).toContain('MEMORIA DELLA SEDUTA');
    expect(section).toContain('non contiene cifre nuove');
    expect(section).toContain('vincono i fatti aggiornati');
  });
});
