/**
 * HOTFIX HUD mobile — invarianti di struttura.
 * ============================================
 * Su mobile il pulsante impostazioni (⚙, dentro il menù di partita) usciva
 * dalla colonna di sinistra e copriva il badge «TURNO N». La colonna di
 * sinistra ora si dimensiona sul contenuto (`auto`), quindi le tre icone
 * restano nel loro riquadro e il badge resta libero. Qui si bloccano le
 * invarianti nel markup e nel CSS, senza snapshot.
 *
 * La verifica geometrica reale vive in `e2e/tests/hud-mobile.spec.mjs`.
 */
import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const hudBar = fs.readFileSync(path.resolve(__dirname, 'HudBar.tsx'), 'utf8');
const css = fs.readFileSync(path.resolve(__dirname, '..', '..', 'index.css'), 'utf8');

/** Contenuto del blocco `@media (max-width: 480px) { … }` (parentesi bilanciate). */
function mobile480Block(): string {
  const start = css.indexOf('@media (max-width: 480px)');
  expect(start).toBeGreaterThanOrEqual(0);
  let depth = 0;
  let i = css.indexOf('{', start);
  const from = i;
  for (; i < css.length; i++) {
    if (css[i] === '{') depth += 1;
    else if (css[i] === '}') {
      depth -= 1;
      if (depth === 0) return css.slice(from, i + 1);
    }
  }
  return css.slice(from);
}

describe('Hotfix HUD mobile — struttura', () => {
  it('le tre icone stanno in .hud-left e il badge in .hud-center', () => {
    const left = hudBar.slice(hudBar.indexOf('className="hud-left"'), hudBar.indexOf('className="hud-center"'));
    expect(left).toContain('☰');                      // menu
    expect(left).toContain('hud-dispatch-toggle');    // dispacci
    expect(left).toContain('{menu}');                 // impostazioni ⚙ (GameMenu)

    const center = hudBar.slice(hudBar.indexOf('className="hud-center"'), hudBar.indexOf('className="hud-right"'));
    expect(center).toContain('hud-turn-badge');
    expect(center).not.toContain('{menu}');
  });

  it('a ≤480px la colonna sinistra si dimensiona sul contenuto', () => {
    const block = mobile480Block();
    expect(block).toMatch(/\.hud-bar\s*{[^}]*grid-template-columns:\s*auto auto minmax\(0,\s*1fr\)/);
    expect(block).not.toContain('76px 62px');
    expect(block).toMatch(/\.hud-turn-badge\s*{[^}]*min-width:\s*52px/);
  });

  it('a ≤370px resta solo il toggle dispacci a cedere spazio', () => {
    const start = css.indexOf('@media (max-width: 370px)');
    const block = css.slice(start, css.indexOf('}', css.indexOf('{', start) + 1) + 1);
    expect(block).toContain('.hud-dispatch-toggle');
    expect(block).toContain('display: none');
  });
});
