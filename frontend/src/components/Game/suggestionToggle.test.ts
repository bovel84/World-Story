import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { resolveSuggestionToggle, type PendingActionLike } from './suggestionToggle';

const deskSource = fs.readFileSync(
  path.resolve(__dirname, '..', 'Shell', 'DeskContent.tsx'),
  'utf8',
);

describe('WORLD-ALIVE P1 — toggle delle azioni proposte', () => {
  it('proposta NON in coda → la aggiunge', () => {
    expect(resolveSuggestionToggle([], 'Mobilitare due divisioni')).toEqual({ kind: 'add' });
  });

  it('proposta in coda → restituisce l’id per rimuoverla (nessun percorso nuovo)', () => {
    const queue: PendingActionLike[] = [{ id: 'a1', text: 'Mobilitare due divisioni' }];
    expect(resolveSuggestionToggle(queue, 'Mobilitare due divisioni')).toEqual({ kind: 'remove', id: 'a1' });
  });

  it('ciclo completo aggiungi → rimuovi → ri-aggiungi sulla stessa proposta', () => {
    let queue: PendingActionLike[] = [];
    const text = 'Aprire un corridoio umanitario';

    // 1. non in coda → add → il desk accoda (id assegnato dal server)
    const first = resolveSuggestionToggle(queue, text);
    expect(first.kind).toBe('add');
    if (first.kind === 'add') queue = [...queue, { id: 'server-1', text }];

    // 2. ora è in coda → remove con l'id reale
    const second = resolveSuggestionToggle(queue, text);
    expect(second).toEqual({ kind: 'remove', id: 'server-1' });
    if (second.kind === 'remove') queue = queue.filter(a => a.id !== second.id);
    expect(queue).toHaveLength(0);

    // 3. tornata libera → si può ri-aggiungere
    expect(resolveSuggestionToggle(queue, text)).toEqual({ kind: 'add' });
  });

  it('riconosce i duplicati ignorando gli spazi (stessa normalizzazione di prima)', () => {
    const queue: PendingActionLike[] = [{ id: 'a9', text: '  Ordine con spazi  ' }];
    expect(resolveSuggestionToggle(queue, 'Ordine con spazi')).toEqual({ kind: 'remove', id: 'a9' });
  });

  it('il desk smista l’intento verso le funzioni esistenti, senza nuovi percorsi', () => {
    expect(deskSource).toContain('resolveSuggestionToggle(pendingActions, content)');
    expect(deskSource).toContain('void removeQueuedAction(toggle.id)');
    expect(deskSource).toContain('void queuePlayerAction(content)');
    // il bottone non è più disabilitato quando è già in coda
    expect(deskSource).toContain('disabled={!content}');
    expect(deskSource).not.toContain('disabled={queued');
    // stato attivo comunicato agli screen reader
    expect(deskSource).toContain('aria-pressed={queued}');
    expect(deskSource).toContain("queued ? 'Rimuovi' : 'Usa'");
  });
});
