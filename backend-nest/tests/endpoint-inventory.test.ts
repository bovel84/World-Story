/**
 * Q02 µ2 — Inventario endpoint mutanti e protezione single-owner.
 * Lo snapshot `docs/implementation/q02-endpoint-inventory.json` è generato da
 * questo test (`vitest -u`): se un endpoint nasce o cambia senza aggiornare
 * l'inventario, il test fallisce.
 */
import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  extractRoutes,
  inventorySummary,
  sortRoutes,
  type RouteEntry,
} from '../src/security/route-inventory';

const ROUTES_DIR = path.resolve(__dirname, '../src/routes');
const INVENTORY_FILE = path.resolve(__dirname, '../../docs/implementation/q02-endpoint-inventory.json');

function walk(dir: string): string[] {
  const found: string[] = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) found.push(...walk(full));
    else if (entry.name.endsWith('.routes.ts')) found.push(full);
  }
  return found;
}

const files = walk(ROUTES_DIR).sort();
const entries: RouteEntry[] = sortRoutes(
  files.flatMap((file) =>
    extractRoutes(fs.readFileSync(file, 'utf8'), path.relative(ROUTES_DIR, file)),
  ),
);
const summary = inventorySummary(entries);

describe('Q02 µ2 — inventario endpoint', () => {
  it('lo snapshot dell’inventario è aggiornato (rigenerare con `vitest -u`)', async () => {
    const payload = `${JSON.stringify({ summary, routes: entries }, null, 2)}\n`;
    await expect(payload).toMatchFileSnapshot(INVENTORY_FILE);
  });

  it('l’inventario non è vuoto e distingue letture da mutazioni', () => {
    expect(summary.total).toBeGreaterThan(50);
    expect(summary.mutating).toBeGreaterThan(20);
    expect(summary.reading).toBeGreaterThan(20);
  });

  it('nessun endpoint mutante vive fuori da /api (dove agisce ownerGuard)', () => {
    const mutating = entries.filter((entry) => entry.mutating);
    // L’unico router montato anche fuori da /api è health (/health): solo GET.
    expect(mutating.filter((entry) => entry.file === 'health.routes.ts')).toEqual([]);
    expect(mutating.length).toBeGreaterThan(0);
  });

  it('censisce gli endpoint sensibili richiesti dal piano', () => {
    const keys = new Set(entries.map((entry) => `${entry.method} ${entry.path}`));
    // Settings provider LLM (chiavi API): lettura e scrittura.
    expect(keys.has('get /config')).toBe(true);
    expect(keys.has('post /config')).toBe(true);
    // Mutazioni di partita (save, simulazione, azioni).
    expect([...keys].some((key) => key.startsWith('post /:id/'))).toBe(true);
  });
});
