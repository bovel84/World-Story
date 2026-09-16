/**
 * OutboxService — durabilità degli eventi canonici (nessun DB necessario per
 * i percorsi a vuoto).
 */
import { describe, it, expect } from 'vitest';
import { OutboxService } from '../src/game/OutboxService';

function makeService(hasClient: boolean) {
  const events: Array<{ type: any; data: any }> = [];
  const svc = new OutboxService({
    gameId: 'outbox-game',
    hasClient: () => hasClient,
    broadcast: (type, data) => { events.push({ type, data }); return true; },
  });
  return { svc, events };
}

describe('OutboxService', () => {
  it('non pubblica nulla senza client SSE', () => {
    const { svc, events } = makeService(false);
    expect(svc.publishPendingOutbox()).toBe(0);
    expect(events).toHaveLength(0);
  });

  it('enqueueOutboxRows ignora lotti vuoti', () => {
    const { svc } = makeService(true);
    expect(() => svc.enqueueOutboxRows('run-1', 'cp-1', 1, 1, [])).not.toThrow();
  });
});
