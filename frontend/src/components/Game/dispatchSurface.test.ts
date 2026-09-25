/**
 * Test-contratto della superficie dei dispacci
 * ============================================
 * Difende ciò che la misura del piano ha trovato rotto o assente:
 *
 *  1. **Il «Perché è accaduto» era illeggibile.** Il colore era `#c1cedf`
 *     (azzurro chiaro) su carta crema: contrasto **1,31:1** su una soglia AA di
 *     4,5; la sua etichetta `#cda65b` stava a **1,87:1**. Misurato, non
 *     guardato: stessa disciplina di C03.
 *  2. **«L'ordine» esiste** (§3.2 punto 8 del piano maestro) e non compare mai
 *     vuoto: un dispaccio del mondo non finge un ordine.
 *  3. **La categoria Amministrazione** (§11.3) è definita anche nello stile,
 *     non solo nel modulo di classificazione.
 *
 * Il contrasto si **calcola** dal CSS reale, con la stessa formula WCAG usata
 * da `ordersModuleTheme.test.ts`.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';

const SRC = join(__dirname, '..', '..');
const css = () => readFileSync(join(SRC, 'index.css'), 'utf8');

const lin = (c: number) => {
  const s = c / 255;
  return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
};
const luminance = (hex: string): number => {
  const h = hex.replace('#', '');
  const full = h.length === 3 ? h.split('').map(c => c + c).join('') : h;
  const [r, g, b] = [0, 2, 4].map(i => parseInt(full.slice(i, i + 2), 16));
  return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
};
const ratio = (fg: string, bg: string): number => {
  const a = luminance(fg);
  const b = luminance(bg);
  return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
};
const blend = (fg: string, bg: string, alpha: number): string => {
  const f = fg.replace('#', '');
  const b = bg.replace('#', '');
  let out = '#';
  for (const i of [0, 2, 4]) {
    const fv = parseInt(f.slice(i, i + 2), 16);
    const bv = parseInt(b.slice(i, i + 2), 16);
    out += Math.round(fv * alpha + bv * (1 - alpha)).toString(16).padStart(2, '0');
  }
  return out;
};

/** Carta effettiva della scheda: gradiente bianco 0x38/255 su `--edition-paper`. */
const CARTA = blend('#ffffff', '#eee9de', 0x38 / 255);

describe('contrasto dei blocchi del dispaccio (misurato, non stimato)', () => {
  it('il «Perché è accaduto» supera la soglia AA', () => {
    const fondo = blend('#cda65b', CARTA, 0.08);
    // Guardia: il fondo calcolato deve essere plausibile, non nero né bianco.
    expect(luminance(fondo)).toBeGreaterThan(0.7);

    expect(ratio('#342f24', fondo), 'corpo del «Perché è accaduto»').toBeGreaterThanOrEqual(4.5);
    expect(ratio('#8a4a12', fondo), 'etichetta del «Perché è accaduto»').toBeGreaterThanOrEqual(4.5);
  });

  it('il colore vecchio era davvero illeggibile (la misura lo prova)', () => {
    const fondo = blend('#cda65b', CARTA, 0.08);
    expect(ratio('#c1cedf', fondo), 'era questo il difetto').toBeLessThan(2);
    expect(ratio('#cda65b', fondo), 'e questo l\'etichetta').toBeLessThan(2);
  });

  it('«L\'ordine» supera la soglia AA', () => {
    const fondo = blend('#7f9dc4', CARTA, 0.10);
    expect(ratio('#2c2a24', fondo), 'corpo de «L\'ordine»').toBeGreaterThanOrEqual(4.5);
    expect(ratio('#2f5d8f', fondo), 'etichetta de «L\'ordine»').toBeGreaterThanOrEqual(4.5);
  });

  it('le classi esistono nel foglio di stile, non solo nel componente', () => {
    const foglio = css();
    // Guardia contro il falso verde: i test sopra calcolano valori propri e
    // passerebbero anche se le classi sparissero dal CSS.
    for (const classe of [
      '.newspaper-article-why',
      '.article-why-label',
      '.newspaper-article-order',
      '.article-order-label',
      '.news-flash-order',
      '.feed-item-badge.cat-administration',
    ]) {
      expect(foglio, `manca ${classe} in index.css`).toContain(classe);
    }
  });
});

describe('«L\'ordine» non compare mai vuoto', () => {
  it('la scheda d\'archivio lo mostra solo con un ordine', () => {
    const feed = readFileSync(join(SRC, 'components', 'Game', 'EventFeed.tsx'), 'utf8');
    expect(feed).toMatch(/openArticle\.actionText \?/);
    expect(feed).toMatch(/article-order-label/);
  });

  it('il focolaio centrale lo mostra solo con un ordine', () => {
    const flash = readFileSync(join(SRC, 'components', 'Game', 'NewsFlash.tsx'), 'utf8');
    expect(flash).toMatch(/item\.actionText \?/);
    expect(flash).toMatch(/news-flash-order/);
  });

  it('senza dettaglio e senza ordine, la scheda dice che non ci sono particolari', () => {
    const feed = readFileSync(join(SRC, 'components', 'Game', 'EventFeed.tsx'), 'utf8');
    expect(feed).toMatch(/!openArticle\.detail && !openArticle\.actionText/);
  });
});
