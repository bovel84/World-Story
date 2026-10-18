import { describe, expect, it } from 'vitest';
import { compactEventText } from './compactEventText';

describe('compactEventText', () => {
  it('keeps short dispatches unchanged', () => {
    const value = 'L’Egitto apre negoziati al Cairo.';
    expect(compactEventText(value)).toEqual({ text: value, shortened: false });
  });
  it('prefers a complete sentence, preserving source text elsewhere', () => {
    const full = 'Il governo convoca i negoziatori a Roma. La controparte chiede garanzie e decide di rinviare il voto al prossimo consiglio.';
    const summary = compactEventText(full, 65);
    expect(summary).toEqual({ text: 'Il governo convoca i negoziatori a Roma.', shortened: true });
    expect(full).toContain('La controparte chiede');
  });
  it('never exceeds the character limit or cuts mid-word when possible', () => {
    const full = 'La delegazione negoziale annuncia condizioni diplomatiche provvisorie per tutta la regione senza un accordo definitivo.';
    const summary = compactEventText(full, 55);
    expect(summary.text.length).toBeLessThanOrEqual(55);
    expect(summary.text).toMatch(/…$/);
    expect(full.startsWith(summary.text.slice(0, -1))).toBe(true);
    expect(summary.text.slice(0, -1).endsWith(' ')).toBe(false);
  });
  it('handles empty inputs and multiple spaces', () => {
    expect(compactEventText('   ')).toEqual({ text: '', shortened: false });
    expect(compactEventText(' A    B ')).toEqual({ text: 'A B', shortened: false });
  });
});
