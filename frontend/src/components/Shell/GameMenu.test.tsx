/**
 * BUG 2 — il menu ⚙ della barra HUD.
 * ==================================
 * Riproduzione reale (smartphone Android, `millennium_dawn`, turno 3): toccando
 * l'ingranaggio il menu (Salva / Carica / Mondo / Modello) non si apriva.
 *
 * La logica di `GameMenu` è corretta (stato `open`, chiusura su click esterno
 * ed Esc): il difetto era **CSS**. A ≤480px `.hud-bar` aveva `overflow: hidden`
 * e il popover `position: absolute` dentro `.hud-left` veniva ritagliato
 * all'altezza della barra (~54px): `open=true` ma menu invisibile e non
 * cliccabile.
 *
 * Il repository non ha jsdom (la suite frontend gira in `node` con
 * `renderToStaticMarkup`): qui si fissano struttura, contratto di
 * accessibilità, stato `disabled` e le **invarianti CSS** che rendono il
 * popover visibile. L'interazione reale e il non-clipping sono verificati nel
 * browser (Playwright) in `e2e/tests/hud-mobile.spec.mjs`, l'unico posto dove
 * il layout esiste davvero.
 */
import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { GameMenu } from './GameMenu';

const css = fs.readFileSync(path.resolve(__dirname, '..', '..', 'index.css'), 'utf8');
const hudBar = fs.readFileSync(path.resolve(__dirname, '..', 'Game', 'HudBar.tsx'), 'utf8');
const gameScreen = fs.readFileSync(path.resolve(__dirname, '..', 'Game', 'GameScreen.tsx'), 'utf8');

/** Contenuto del primo blocco `@media (max-width: 480px) { … }`, senza commenti. */
function mobile480Block(): string {
  const start = css.indexOf('@media (max-width: 480px)');
  expect(start).toBeGreaterThanOrEqual(0);
  const from = css.indexOf('{', start);
  let depth = 0;
  let raw = '';
  for (let i = from; i < css.length; i++) {
    if (css[i] === '{') depth += 1;
    else if (css[i] === '}') {
      depth -= 1;
      if (depth === 0) { raw = css.slice(from, i + 1); break; }
    }
  }
  if (!raw) raw = css.slice(from);
  return raw.replace(/\/\*[\s\S]*?\*\//g, '');
}

const noop = () => {};
const render = (disabled = false) =>
  renderToStaticMarkup(
    <GameMenu onSave={noop} onLoad={noop} onEditWorld={noop} onEditModel={noop} disabled={disabled} />,
  );

describe('BUG 2 — GameMenu: struttura e stato chiuso', () => {
  it('a menu chiuso mostra solo l’ingranaggio, con aria-expanded=false', () => {
    const html = render();
    expect(html).toContain('⚙');
    expect(html).toContain('aria-haspopup="menu"');
    expect(html).toContain('aria-expanded="false"');
    // Condizionale `{open && …}`: il dropdown non esiste finché non si apre.
    expect(html).not.toContain('game-menu-dropdown');
  });

  it('a partita ferma l’ingranaggio è abilitato (non `disabled`)', () => {
    const html = render(false);
    expect(html).not.toMatch(/<button[^>]*game-menu-btn[^>]*disabled/);
  });

  it('con `disabled` il bottone è davvero disabilitato (e non apre nulla)', () => {
    const html = render(true);
    expect(html).toMatch(/<button[^>]*game-menu-btn[^>]*disabled/);
  });
});

describe('BUG 2 — GameMenu: le quattro voci del menu', () => {
  it('Salva / Carica / Mondo / Modello sono tutte presenti nel sorgente', () => {
    const source = fs.readFileSync(path.resolve(__dirname, 'GameMenu.tsx'), 'utf8');
    for (const label of ['Salva', 'Carica', 'Mondo', 'Modello']) {
      expect(source).toMatch(new RegExp(`${label}\\s*</button>`));
    }
    // Il popover è condizionato all'apertura e chiuso da click esterno ed Esc.
    expect(source).toContain('{open && (');
    expect(source).toContain("document.addEventListener('mousedown'");
    expect(source).toContain("event.key === 'Escape'");
  });
});

describe('BUG 2 — CSS: il popover deve sfuggire alla barra HUD', () => {
  it('il dropdown è ancorato e sopra la mappa', () => {
    expect(css).toMatch(/\.game-menu-dropdown\s*\{[^}]*position:\s*absolute/);
    expect(css).toMatch(/\.game-menu-dropdown\s*\{[^}]*z-index:\s*1600/);
  });

  it('a ≤480px la barra HUD non ritaglia il popover (overflow non hidden)', () => {
    const block = mobile480Block();
    const hudBarRule = block.slice(block.indexOf('.hud-bar'), block.indexOf('}', block.indexOf('.hud-bar')));
    expect(hudBarRule).not.toContain('overflow: hidden');
    expect(hudBarRule).toMatch(/overflow:\s*visible/);
  });

  it('l’ingranaggio disabilitato è visibilmente disabilitato', () => {
    expect(css).toMatch(/\.hud-icon-btn:disabled\s*\{[^}]*opacity/);
    expect(css).toMatch(/\.hud-icon-btn:disabled\s*\{[^}]*cursor:\s*not-allowed/);
  });
});

describe('BUG 2 — montaggio nell’HUD', () => {
  it('GameMenu vive in .hud-left', () => {
    const left = hudBar.slice(hudBar.indexOf('className="hud-left"'), hudBar.indexOf('className="hud-center"'));
    expect(left).toContain('{menu}');
  });

  it('GameScreen lo abilita finché il turno non è in elaborazione', () => {
    const mount = gameScreen.slice(gameScreen.indexOf('<GameMenu'), gameScreen.indexOf('/>', gameScreen.indexOf('<GameMenu')));
    expect(mount).toContain('disabled={shell.isProcessingTurn}');
  });
});
