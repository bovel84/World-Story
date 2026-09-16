/**
 * U01 passo 4/5 — disciplina CSS dei moduli migrati (DoD).
 *
 * Il DoD del pacchetto: «nessun nuovo `!important` nei moduli migrati salvo
 * eccezione motivata del vendor; il blocco vendor minificato non va trascinato
 * nel nuovo CSS». Questa guardia blocca le regressioni in modo ripetibile.
 *
 * Nota: i moduli migrati (`nation-dock`, `feasibility-*`, `module-*`,
 * `command-*`) hanno regole scoped distribuite tra `foundations.css`,
 * `index.css` ed `editorial.css`; la guardia li copre tutti. La regola legacy
 * `.order-limits-note` di `editorial.css` è esclusa (tema dispacci preesistente).
 */
import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const read = (rel: string) => fs.readFileSync(path.resolve(__dirname, '..', rel), 'utf8');
const sources: Array<{ file: string; css: string }> = [
  { file: 'styles/foundations.css', css: read('styles/foundations.css') },
  { file: 'index.css', css: read('index.css') },
  { file: 'editorial.css', css: read('editorial.css') },
];
const foundations = sources[0].css;

const MIGRATED_PREFIXES = ['nation-dock', 'feasibility', 'module-', 'command-'];

describe('U01 passo 4/5 — disciplina CSS dei moduli migrati', () => {
  it('nessun !important nei selettori dei moduli migrati', () => {
    for (const prefix of MIGRATED_PREFIXES) {
      const re = new RegExp(`\\.[a-z-]*${prefix}[^{}]*\\{[^{}]*!important`, 'i');
      for (const { file, css } of sources) {
        expect(re.test(css), `!important residuo in ${file} (${prefix})`).toBe(false);
      }
    }
  });

  it('nessun blocco vendor minificato travasato nel CSS dei moduli', () => {
    expect(foundations).not.toMatch(/@import/);
    const maxLine = Math.max(...foundations.split('\n').map(line => line.length));
    expect(maxLine).toBeLessThan(400);
  });

  it('i moduli migrati hanno regole scoped presenti (sanity)', () => {
    const all = sources.map(s => s.css).join('\n');
    for (const cls of ['.nation-dock', '.feasibility-']) {
      expect(all).toContain(cls);
    }
  });
});
