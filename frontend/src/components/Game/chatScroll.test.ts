/**
 * WS-MINISTER-UX-07 (C) — Autoscroll della chat del ministro
 * ==========================================================
 * La chat segue il fondo solo se il giocatore era già in fondo; chi risale la
 * cronologia resta dove sta anche durante lo streaming.
 */
import { describe, expect, it } from 'vitest';
import { isNearBottom } from './chatScroll';

describe('isNearBottom (C)', () => {
  it('un contenitore in fondo resta agganciato', () => {
    expect(isNearBottom({ scrollTop: 900, scrollHeight: 1000, clientHeight: 100 })).toBe(true);
    expect(isNearBottom({ scrollTop: 970, scrollHeight: 1000, clientHeight: 100 })).toBe(true);
  });

  it('chi risale la cronologia NON viene riportato in basso', () => {
    expect(isNearBottom({ scrollTop: 200, scrollHeight: 1000, clientHeight: 100 })).toBe(false);
    expect(isNearBottom({ scrollTop: 800, scrollHeight: 1000, clientHeight: 100 })).toBe(false);
  });

  it('il contenuto più corto del riquadro è sempre «in fondo»', () => {
    expect(isNearBottom({ scrollTop: 0, scrollHeight: 80, clientHeight: 100 })).toBe(true);
  });
});
