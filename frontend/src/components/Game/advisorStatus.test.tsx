/**
 * WS-GOV-ADVISOR-STATUS — Lo stato «sta pensando» del Consulente è testo
 * visibile, non solo `aria-label`; nel solo Governo il loading è bianco.
 * Le altre chat (pannello flottante) non cambiano.
 */
import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';

// Zustand v5 usa lo STATO INIZIALE come snapshot SSR: si mocka lo store per
// rendere lo stato di streaming in markup statico.
vi.mock('../../stores', () => ({
  useChatStore: () => ({
    advisorMessages: [],
    advisorStreaming: true,
    addAdvisorMessage: () => {},
    setAdvisorStreaming: () => {},
    tagAdvisorTurns: () => {},
    setAdvisorMessages: () => {},
  }),
}));

import { AdvisorChat, ADVISOR_LOADING_TEXT, ADVISOR_THINKING_TEXT } from './AdvisorChat';

const css = fs.readFileSync(path.resolve(__dirname, 'councilRoom.css'), 'utf8');

describe('AdvisorChat status', () => {
  it('shows «Il Consulente sta pensando…» as visible text while streaming, next to the dots', () => {
    const html = renderToStaticMarkup(<AdvisorChat gameId="game-1" scopeKey="game-1" currentTurn={1} />);
    expect(ADVISOR_THINKING_TEXT).toBe('Il Consulente sta pensando…');
    expect(html).toContain('Il Consulente sta pensando…');
    expect(html).toContain('advisor-thinking-text');
    expect((html.match(/<i><\/i>/g) ?? [])).toHaveLength(3);
  });

  it('keeps the loading text white inside the Government scope only', () => {
    expect(ADVISOR_LOADING_TEXT).toBe('Il Consulente sta preparando la prima valutazione…');
    const scope = css.slice(css.indexOf('.government-advisor .advisor-loading'));
    expect(scope).toMatch(/\.government-advisor \.advisor-loading[^}]*color:\s*#f2f6ff/);
    expect(scope).toMatch(/\.government-advisor \.advisor-typing[^}]*color:\s*#f2f6ff/);
    // Nessuna regola globale sui nuovi stati: il tema delle altre chat non cambia.
    expect(css).not.toMatch(/(^|\n)\.advisor-loading\s*\{/);
    expect(css).not.toMatch(/(^|\n)\.advisor-typing\s*\{/);
  });
});
