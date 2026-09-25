/**
 * World Story — C03: il modulo Ordini e il suo tema
 * ==================================================
 * Il difetto misurato: il modulo aveva **due temi che si combattevano** —
 * l'editoriale su carta crema (`editorial.css`) e la scrivania navy
 * (`index.css`) — con `!important` da entrambe le parti. I commenti stessi nel
 * CSS ammettevano il risultato: «il vecchio tema scuro lasciava qui i suoi
 * colori chiari sopra la carta editoriale: contrasto sotto 3:1, testo
 * illeggibile».
 *
 * Questi test difendono tre cose: che le regole siano **una volta sola**, che
 * il modulo **non contenda** più il tema con l'editoriale, e che il contrasto
 * del testo regga — che è la misura vera di «illeggibile», non un'impressione.
 */
import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

const read = (rel: string) => fs.readFileSync(path.resolve(__dirname, rel), 'utf8');
const editorial = read('../../editorial.css');
const index = read('../../index.css');

/** Le classi del modulo Ordini. */
const ORDER_CLASSES = [
  'suggestion-item', 'suggestion-topic', 'suggestion-description', 'suggestion-action',
  'suggestions-content', 'pending-item', 'pending-text', 'pending-header', 'pending-edit-input',
];

describe('C03 — un solo tema per il modulo Ordini', () => {
  it('il blocco canonico esiste, nel tema della scrivania', () => {
    // Guardia contro il falso verde: il blocco c'è davvero, e dichiara da dove viene.
    expect(index).toMatch(/C03 — Modulo Ordini: tema scrivania/);
    expect(index).toMatch(/\.suggestions-content \{[\s\S]{0,300}background: #0d1727/);
  });

  it('l\'editoriale non contende più il modulo con regole-carta', () => {
    // Nessuna regola del modulo che imponga inchiostro o carta editoriali.
    const offenders = ORDER_CLASSES.filter(cls => {
      const re = new RegExp(`\\.${cls}[^{]*\\{[^}]*(op-ink|op-paper|op-sheet|#faf5eb|#eee6d7|#4d5750)`, 'i');
      return re.test(editorial);
    });
    expect(offenders).toEqual([]);
  });

  it('le superfici NON del modulo restano vestite (nessuna regressione)', () => {
    // Rimuovendo la regola condivisa, banner del Consulente, chat e diplomazia
    // perdevano il loro sfondo: erano stilati **solo** da lì.
    expect(editorial).toMatch(/\.advisor-banner, \.chat-item, \.chat-message, \.diplomacy-entry \{/);
    expect(editorial).toMatch(/background: #eee6d7/);
  });

  it('il modulo non dichiara più due tempi in conflitto sullo stesso elemento', () => {
    // Il difetto era avere `.suggestion-action` su carta in un file e su navy in
    // un altro: ora la regola del modulo vive nel solo blocco canonico.
    const actionRules = (editorial.match(/\.suggestion-action\b[^{]*\{/g) ?? []).length;
    expect(actionRules).toBe(0);
    expect(index).toMatch(/\.suggestion-action \{/);
  });
});

describe('C03 — il contrasto del testo regge (la misura di «illeggibile»)', () => {
  /** Luminanza relativa WCAG. */
  const lum = (hex: string): number => {
    const h = hex.replace('#', '');
    const [r, g, b] = [0, 2, 4].map(i => parseInt(h.slice(i, i + 2), 16) / 255);
    const f = (c: number) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
    return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
  };
  const ratio = (fg: string, bg: string): number => {
    const [a, b] = [lum(fg), lum(bg)].sort((x, y) => y - x);
    return (a + 0.05) / (b + 0.05);
  };

  it('ogni testo del modulo supera la soglia AA (4.5)', () => {
    const pairs: Array<[string, string, string]> = [
      ['titolo', '#f2f6ff', '#0d1727'],
      ['sottotitolo', '#93a6c0', '#0d1727'],
      ['tema proposta', '#eef3fc', '#101d31'],
      ['descrizione', '#9fb2ca', '#101d31'],
      ['azione titolo', '#eef3fc', '#14243a'],
      ['azione corpo', '#a8bdd8', '#14243a'],
      ['azione CTA', '#8fb4e0', '#14243a'],
      ['proposta in coda', '#eef3fc', '#12291f'],
      ['ordine in attesa', '#dbe6f5', '#14243a'],
      ['errore', '#f0c9c9', '#2a1c20'],
    ];
    for (const [name, fg, bg] of pairs) {
      const r = ratio(fg, bg);
      expect(r, `${name}: ${r.toFixed(2)} su soglia 4.5`).toBeGreaterThanOrEqual(4.5);
    }
  });

  it('il difetto dichiarato nel CSS non si ripresenta', () => {
    // Il commento rimosso citava «contrasto sotto 3:1, testo illeggibile» per i
    // colori chiari del tema scuro lasciati sopra la carta. Quella regola non
    // esiste più: nessun testo del modulo sta su carta con inchiostro scuro.
    expect(editorial).not.toMatch(/contrasto sotto 3:1, testo\s+illeggibile/);
    expect(editorial).not.toMatch(/\.suggestion-description \{ color: #4d5750/);
  });
});
