/**
 * Q02 µ2/µ3 — Token single-owner lato client e nessun URL di tunnel nel bundle.
 */
import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { getOwnerToken, ownerHeaders, withOwnerToken } from './ownerToken';

const src = (rel: string) => fs.readFileSync(path.resolve(__dirname, rel), 'utf8');

/** Costruito a pezzi per non auto-rilevarsi nel sorgente del test. */
const TUNNEL_PATTERN = new RegExp(['trycloud' + 'flare', 'ngrok\\.io', 'localtunnel\\.me'].join('|'), 'i');

describe('Q02 µ2 — token single-owner (client)', () => {
  it('fuori dal browser non inventa un token', () => {
    expect(getOwnerToken()).toBeNull();
    expect(ownerHeaders()).toEqual({});
    expect(withOwnerToken('/api/games/g1/events')).toBe('/api/games/g1/events');
  });

  it('legge il token una volta da ?owner_token= e lo conserva', () => {
    const source = src('ownerToken.ts');
    expect(source).toContain("params.get('owner_token')");
    expect(source).toContain("localStorage.setItem(STORAGE_KEY, fromUrl)");
    expect(source).toContain("localStorage.getItem(STORAGE_KEY)");
    expect(source).toContain('replaceState');
  });

  it('api.ts invia X-Owner-Token su ogni richiesta', () => {
    const source = src('api.ts');
    expect(source).toContain('ownerHeaders');
    expect(source).toMatch(/\.\.\.ownerHeaders\(\)/);
  });

  it('gli SSE portano il token in query (EventSource non ha header)', () => {
    const source = src('sse.ts');
    expect(source).toContain('withOwnerToken');
  });
});

describe('Q02 µ3 — nessun URL di tunnel nel bundle', () => {
  const distDir = path.resolve(__dirname, '../../dist');
  const hasDist = fs.existsSync(distDir);

  it('il sorgente non incorpora quick-tunnel/ngrok', () => {
    const offenders: string[] = [];
    const root = path.resolve(__dirname, '../..');
    const walk = (dir: string) => {
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        if (entry.name === 'node_modules' || entry.name === 'dist') continue;
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) walk(full);
        else if (/\.(ts|tsx|js|jsx|html|json)$/.test(entry.name)) {
          const text = fs.readFileSync(full, 'utf8');
          if (TUNNEL_PATTERN.test(text)) {
            offenders.push(path.relative(root, full));
          }
        }
      }
    };
    walk(root);
    expect(offenders).toEqual([]);
  });

  it.skipIf(!hasDist)('il bundle pubblicato non incorpora quick-tunnel/ngrok', () => {
    const offenders: string[] = [];
    const walk = (dir: string) => {
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) walk(full);
        else if (/\.(js|css|html|json|txt)$/.test(entry.name)) {
          const text = fs.readFileSync(full, 'utf8');
          if (TUNNEL_PATTERN.test(text)) offenders.push(path.relative(distDir, full));
        }
      }
    };
    walk(distDir);
    expect(offenders).toEqual([]);
  });
});
