import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const source = fs.readFileSync(path.resolve(__dirname, 'Landing.tsx'), 'utf8');

describe('Landing product promise', () => {
  it('states a concrete promise and elevates Continue above the fold', () => {
    expect(source).toContain('Governa una nazione. Cambia una decisione.');
    expect(source).toContain('Nuova storia');
    expect(source).toContain('landing-continue');
    expect(source).toContain('Impostazioni tecniche');
  });

  it('keeps the native save picker filtered from rewind snapshots', () => {
    expect(source).toContain("s.name !== '__rewind__'");
  });
});