/**
 * WS-MINISTER-UX-05 — La memoria del ministro (contratto e motore, puri)
 * =====================================================================
 * Difende il contratto della memoria: identità per partita/ramo/sedia/mandato,
 * un riferimento per ogni ricordo, selezione dei ricordi pertinenti, copia al
 * fork e potatura al rewind. E difende il confine: la memoria non batte i fatti
 * aggiornati e non introduce cifre proprie.
 *
 * La **persistenza** server-side è bloccata dal freeze (schema/DB, repository,
 * `GameSession`): l'innesto preciso è nel report. Qui si prova la parte pura, che
 * è quella che l'innesto userà senza riscritture.
 */
import { describe, expect, it } from 'vitest';
import {
  MINISTER_MEMORY_LIMIT, emptyMinisterMemory, forkMinisterMemory, isMinisterMemoryEmpty,
  memorySection, pruneMinisterMemory, recordMinisterMemory, relevantMinisterMemory,
  type MinisterMemory, type MinisterMemoryRecord, type MinisterMemoryScope,
} from '../src/core/government/MinisterMemory';
import { briefingFor } from '../src/core/government/MinisterChat';
import { SEAT_LABEL, SEAT_READS, type CabinetAddress, type CabinetItem } from '../src/core/government/Cabinet';
import type { GovernmentAgenda } from '../src/core/government/GovernmentAgenda';

const scope: MinisterMemoryScope = {
  gameId: 'g1', branchId: 'main', seat: 'tesoro', mandate: 'Ministro del Tesoro, I legislatura',
};
const emptyAgenda: GovernmentAgenda = { voices: [], headline: '', canonicalMutation: false };

function record(overrides: Partial<MinisterMemoryRecord> = {}): MinisterMemoryRecord {
  return {
    id: 'm1',
    kind: 'proposal-discussed',
    summary: 'Copertura dell’ospedale del sud',
    state: 'discussed',
    refs: { messageId: 'tesoro#2', gameDate: '1951-03-01', turn: 4 },
    ...overrides,
  };
}

describe('WS-MINISTER-UX-05 — contratto della memoria', () => {
  it('parte vuota e si riconosce come tale', () => {
    const memory = emptyMinisterMemory(scope);
    expect(isMinisterMemoryEmpty(memory)).toBe(true);
    expect(memorySection(memory)).toBe('');
  });

  it('un ricordo senza sintesi o senza data non entra', () => {
    let memory = emptyMinisterMemory(scope);
    memory = recordMinisterMemory(memory, record({ summary: '   ' }));
    memory = recordMinisterMemory(memory, record({ id: 'm2', refs: { gameDate: '' } }));
    expect(memory.records).toHaveLength(0);
    expect(isMinisterMemoryEmpty(memory)).toBe(true);
  });

  it('lo stesso id aggiorna il ricordo, non lo duplica', () => {
    let memory = emptyMinisterMemory(scope);
    memory = recordMinisterMemory(memory, record());
    memory = recordMinisterMemory(memory, record({
      kind: 'queued-decision', state: 'queued', refs: { orderId: 'o1', gameDate: '1951-03-02', turn: 5 },
    }));
    expect(memory.records).toHaveLength(1);
    expect(memory.records[0].kind).toBe('queued-decision');
    expect(memory.records[0].state).toBe('queued');
    expect(memory.records[0].refs.orderId).toBe('o1');
  });

  it('la memoria conserva il mandato oltre la sedia', () => {
    const other = emptyMinisterMemory({ ...scope, mandate: 'Ministro del Tesoro, II legislatura' });
    expect(other.scope.mandate).not.toBe(scope.mandate);
    expect(other.scope.seat).toBe('tesoro');
  });

  it('due partite restano isolate: i ricordi di una non entrano nell’altra', () => {
    const g1 = recordMinisterMemory(emptyMinisterMemory(scope), record());
    const g2 = emptyMinisterMemory({ ...scope, gameId: 'g2' });
    expect(g1.scope.gameId).toBe('g1');
    expect(g2.scope.gameId).toBe('g2');
    expect(g2.records).toHaveLength(0);
  });
});

describe('WS-MINISTER-UX-05 — selezione dei ricordi pertinenti', () => {
  it('respinte, accodate e verificate precedono obiettivi e discussioni', () => {
    let memory = emptyMinisterMemory(scope);
    memory = recordMinisterMemory(memory, record({ id: 'a', kind: 'proposal-discussed' }));
    memory = recordMinisterMemory(memory, record({ id: 'b', kind: 'objective' }));
    memory = recordMinisterMemory(memory, record({ id: 'c', kind: 'verified-outcome', state: 'verified' }));
    memory = recordMinisterMemory(memory, record({ id: 'd', kind: 'queued-decision', state: 'queued' }));
    memory = recordMinisterMemory(memory, record({ id: 'e', kind: 'proposal-rejected', state: 'rejected', reason: 'la distinta non è coperta' }));
    expect(relevantMinisterMemory(memory).map(r => r.kind)).toEqual([
      'proposal-rejected', 'queued-decision', 'verified-outcome', 'objective', 'proposal-discussed',
    ]);
  });

  it('il limite non mostra tutta la cronologia', () => {
    let memory = emptyMinisterMemory(scope);
    for (let i = 0; i < 12; i++) memory = recordMinisterMemory(memory, record({ id: `m${i}` }));
    expect(relevantMinisterMemory(memory, 5)).toHaveLength(5);
  });
});

describe('WS-MINISTER-UX-05 — il blocco di prompt', () => {
  it('dichiara il confine e non batte i fatti aggiornati', () => {
    let memory = emptyMinisterMemory(scope);
    memory = recordMinisterMemory(memory, record({ kind: 'proposal-rejected', state: 'rejected', reason: 'manca l’acciaio' }));
    const section = memorySection(memory);
    expect(section).toContain('MEMORIA DELLA SEDUTA');
    expect(section).toContain('non è una seconda contabilità');
    expect(section).toContain('vincono i fatti aggiornati');
  });

  it('un ricordo porta la sua etichetta, il motivo e la provenienza', () => {
    let memory = emptyMinisterMemory(scope);
    memory = recordMinisterMemory(memory, record({ kind: 'proposal-rejected', state: 'rejected', reason: 'manca l’acciaio' }));
    const section = memorySection(memory);
    expect(section).toContain('[respinta · respinta]');
    expect(section).toContain('motivo: manca l’acciaio');
    expect(section).toContain('messaggio tesoro#2');
    expect(section).toContain('turno 4');
    expect(section).toContain('1951-03-01');
  });
});

describe('WS-MINISTER-UX-05 — fork e rewind', () => {
  it('al fork i ricordi si portano con sé, l’identità cambia', () => {
    let memory = emptyMinisterMemory(scope);
    memory = recordMinisterMemory(memory, record());
    const forked = forkMinisterMemory(memory, { ...scope, branchId: 'branch-2' });
    expect(forked.scope.branchId).toBe('branch-2');
    expect(forked.records).toHaveLength(1);
    // Il ramo originale non cambia.
    expect(memory.scope.branchId).toBe('main');
  });

  it('al rewind si potano i ricordi del futuro', () => {
    let memory = emptyMinisterMemory(scope);
    memory = recordMinisterMemory(memory, record({ id: 'past', refs: { gameDate: '1951-01-01', turn: 2 } }));
    memory = recordMinisterMemory(memory, record({ id: 'future-turn', refs: { gameDate: '1951-06-01', turn: 9 } }));
    memory = recordMinisterMemory(memory, record({ id: 'future-date', refs: { gameDate: '1951-06-01' } }));

    const rewound = pruneMinisterMemory(memory, { turn: 5, gameDate: '1951-03-01' });
    expect(rewound.records.map(r => r.id)).toContain('past');
    expect(rewound.records.map(r => r.id)).not.toContain('future-turn');
    // Un ricordo senza turno si giudica sulla data.
    expect(rewound.records.map(r => r.id)).not.toContain('future-date');
    // La sola data basta, quando il turno non c'è.
    const byDate = pruneMinisterMemory(memory, { gameDate: '1951-03-01' });
    expect(byDate.records.map(r => r.id)).not.toContain('future-date');
    expect(byDate.records.map(r => r.id)).toContain('past');
  });

  it('la potatura al limite tiene i ricordi più significativi', () => {
    let memory = emptyMinisterMemory(scope);
    for (let i = 0; i < MINISTER_MEMORY_LIMIT; i++) {
      memory = recordMinisterMemory(memory, record({ id: `discussa-${i}` }));
    }
    memory = recordMinisterMemory(memory, record({ id: 'respinta', kind: 'proposal-rejected', state: 'rejected' }));
    expect(memory.records.length).toBeLessThanOrEqual(MINISTER_MEMORY_LIMIT);
    expect(memory.records.some(r => r.id === 'respinta')).toBe(true);
  });
});

describe('WS-MINISTER-UX-05 — la memoria nel briefing', () => {
  const item: CabinetItem = {
    voiceId: 'debt_service',
    need: 'Coprire il disavanzo',
    because: 'Le uscite superano le entrate',
    urgency: 'critica',
    figures: [{ label: 'Fabbisogno', value: '12', unit: 'mld', basis: { kind: 'measured', source: 'conti nazionali' } }],
    paths: [{ id: 'a', title: 'Via A', detail: 'd', prerequisites: [], expected: 'e', recommended: true }],
  };
  const address: CabinetAddress = {
    seat: 'tesoro', label: SEAT_LABEL.tesoro, reads: SEAT_READS.tesoro, items: [item], opening: 'Apertura.',
  };

  it('senza memoria il briefing resta quello di prima', () => {
    const context = briefingFor(address, emptyAgenda).context;
    expect(context).not.toContain('MEMORIA DELLA SEDUTA');
  });

  it('con la memoria il briefing porta i ricordi e il loro confine', () => {
    const memory = recordMinisterMemory(
      emptyMinisterMemory(scope),
      record({ kind: 'proposal-rejected', state: 'rejected', reason: 'la distinta non è coperta' }),
    );
    const context = briefingFor(address, emptyAgenda, memory).context;
    expect(context).toContain('MEMORIA DELLA SEDUTA');
    expect(context).toContain('motivo: la distinta non è coperta');
    expect(context).toContain('vincono i fatti aggiornati');
  });

  it('una memoria vuota non aggiunge rumore al briefing', () => {
    const context = briefingFor(address, emptyAgenda, emptyMinisterMemory(scope) as MinisterMemory).context;
    expect(context).not.toContain('MEMORIA DELLA SEDUTA');
  });
});
