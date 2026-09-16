/**
 * F06 µ3 — il reset canonico del ramo (branchReplace) deve conservare gli
 * oggetti mappa. I due call-site reali (restore checkpoint e caricamento save)
 * devono entrambi popolare `objects` nello snapshot: senza, il ramo nuovo
 * azzera silenziosamente gli oggetti della mappa.
 */
import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const read = (rel: string) => fs.readFileSync(path.resolve(__dirname, '..', rel), 'utf8');

describe('F06 µ3 — i call-site di branchReplace passano gli objects mappa', () => {
  it('restore checkpoint e caricamento save popolano objects nello snapshot', () => {
    for (const rel of ['hooks/useResumeSave.ts', 'hooks/useWorldAdvance.ts']) {
      const src = read(rel);
      expect(src, `${rel} deve chiamare branchReplace`).toContain('.branchReplace(');
      expect(src, `${rel} deve passare objects nel mapRegions dello snapshot`).toContain('objects: region.objects || []');
    }
  });
});
