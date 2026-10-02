/**
 * WS-GOVUX-P4 — L'evidenza in linea (funzioni pure)
 * ==================================================
 * Difende le regole della fase:
 *  - la card è un **riferimento** all'evidenza reale: stesso id e stesso titolo
 *    del blocco, nessuna card per un'evidenza che la sedia non ha;
 *  - solo le direttive che **mostrano** producono una card (`show`/`focus` e il
 *    confronto), non `annotate`/`dismiss`;
 *  - il **badge** è un fatto di visione: si spegne quando l'evidenza è vista.
 */
import { describe, expect, it } from 'vitest';
import {
  inlineEvidenceCards, shouldShowEvidenceBadge, type EvidenceCardIndex,
} from './inlineEvidence';
import type { PresentationDirective } from './presentation';

const index: EvidenceCardIndex = {
  spesa: { id: 'bilancio', title: 'Dove va il denaro', kind: 'chart' },
  piano: { id: 'piano', title: 'Il piano del Tesoro', kind: 'strategy' },
};

describe('P4 — le card dell’evidenza in linea', () => {
  it('riferisce l’evidenza reale: stesso id e stesso titolo del blocco', () => {
    const cards = inlineEvidenceCards({
      directives: [{ op: 'focus', evidence: 'spesa' }],
      messageId: 'tesoro#2',
      index,
    });
    expect(cards).toHaveLength(1);
    expect(cards[0]).toMatchObject({
      kind: 'evidence',
      evidence: 'spesa',
      blockId: 'bilancio',
      title: 'Dove va il denaro',
      messageId: 'tesoro#2',
    });
  });

  it('una chiave senza blocco reale non produce una card fantasma', () => {
    const cards = inlineEvidenceCards({
      directives: [{ op: 'show', evidence: 'idee' }],
      messageId: 'tesoro#3',
      index,
    });
    expect(cards).toEqual([]);
  });

  it('solo `show`/`focus` e il confronto portano una card', () => {
    const cards = inlineEvidenceCards({
      directives: [
        { op: 'annotate', evidence: 'spesa', note: 'letta' },
        { op: 'dismiss', evidence: 'piano' },
        { op: 'focus', evidence: 'piano' },
      ],
      messageId: 'tesoro#4',
      index,
    });
    expect(cards.map(card => card.evidence)).toEqual(['piano']);
  });

  it('il confronto è una card a parte, con l’ancora `comparison`', () => {
    const cards = inlineEvidenceCards({
      directives: [{ op: 'compare' }],
      messageId: 'tesoro#5',
      index,
    });
    expect(cards).toEqual([
      expect.objectContaining({ kind: 'comparison', evidence: null, blockId: 'comparison' }),
    ]);
  });

  it('deduplica per evidenza e conserva l’ordine del lotto', () => {
    const cards = inlineEvidenceCards({
      directives: [
        { op: 'show', evidence: 'spesa' },
        { op: 'focus', evidence: 'piano' },
        { op: 'focus', evidence: 'spesa' },
      ],
      messageId: 'tesoro#6',
      index,
    });
    expect(cards.map(card => card.blockId)).toEqual(['bilancio', 'piano']);
  });
});

describe('P4 — il badge novità', () => {
  it('niente evidenza, niente badge', () => {
    expect(shouldShowEvidenceBadge({ hasEvidence: false, canvasVersion: 1, seenVersion: 0, pane: 'dialogo' })).toBe(false);
  });

  it('evidenza non vista mentre si legge il dialogo: badge acceso', () => {
    expect(shouldShowEvidenceBadge({ hasEvidence: true, canvasVersion: 1, seenVersion: 0, pane: 'dialogo' })).toBe(true);
  });

  it('sulla tavola non c’è badge da mostrare', () => {
    expect(shouldShowEvidenceBadge({ hasEvidence: true, canvasVersion: 1, seenVersion: 0, pane: 'tavola' })).toBe(false);
  });

  it('vista l’evidenza, tornare al dialogo NON riaccende il badge', () => {
    // Il difetto del P0: il badge derivava dalla pane, non dalla visione.
    expect(shouldShowEvidenceBadge({ hasEvidence: true, canvasVersion: 1, seenVersion: 1, pane: 'dialogo' })).toBe(false);
  });

  it('una nuova evidenza riaccende il badge', () => {
    expect(shouldShowEvidenceBadge({ hasEvidence: true, canvasVersion: 2, seenVersion: 1, pane: 'dialogo' })).toBe(true);
  });
});
