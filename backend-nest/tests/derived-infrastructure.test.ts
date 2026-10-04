/**
 * WS-GOV-PRESET-REALITY-RESIDUALS §1/§2 — materializzazione per tipo e capacità
 * completamente rappresentata (anche oltre il numero di province).
 */
import { describe, expect, it } from 'vitest';
import { derivedInfrastructureObjects } from '../src/core/simulation/DerivedInfrastructure';

const region = (id: string, over: Record<string, unknown> = {}) => ({
  id, name: id, owner: 'KHM', coastal: false, population: 1_000_000, objects: [] as unknown[], ...over,
});
const sumLevels = (objects: readonly unknown[]): number =>
  objects.reduce((total, object) => total + Math.max(1, Number((object as { level?: number }).level ?? 1)), 0);

describe('derivedInfrastructureObjects', () => {
  it('materializza SOLO la parte mancante, per tipo (una strada authored non blocca i porti)', () => {
    const regions = [
      region('coast', { coastal: true, objects: [{ id: 'r1', type: 'ft_road', name: 'Strada' }] }),
      region('inland', { population: 2_000_000 }),
    ];
    const additions = derivedInfrastructureObjects(regions, 'KHM', { ports: 2, factories: 1 });
    const all = [...additions.values()].flat();
    const ports = all.filter(o => (o as { type: string }).type === 'port');
    // Due porti dichiarati su una sola costa: un oggetto con `level` 2, così la
    // capacità è interamente rappresentata (Σ level = capacità).
    expect(ports).toHaveLength(1);
    expect(sumLevels(ports)).toBe(2);
    expect(all.filter(o => (o as { type: string }).type === 'factory')).toHaveLength(1);
  });

  it('un porto authored non impedisce le fabbriche, e la capacità portuale mancante si completa', () => {
    const regions = [region('coast', { coastal: true, objects: [{ id: 'p1', type: 'ft_port', name: 'Porto A', level: 1 }] })];
    const additions = derivedInfrastructureObjects(regions, 'KHM', { ports: 2, factories: 2 });
    const all = [...additions.values()].flat();
    // Porti: 2 dichiarati − 1 authored = 1 materializzato (su una costa senza porto).
    expect(all.filter(o => (o as { type: string }).type === 'port')).toHaveLength(1);
    // Fabbriche: nessuna authored → 2, rappresentate con `level`.
    expect(sumLevels(all.filter(o => (o as { type: string }).type === 'factory'))).toBe(2);
  });

  it('factories > province: Σ level equivale alla capacità dichiarata', () => {
    const regions = [region('solo', { population: 5_000_000 })];
    const additions = derivedInfrastructureObjects(regions, 'KHM', { ports: 0, factories: 5 });
    const factories = [...additions.values()].flat().filter(o => (o as { type: string }).type === 'factory');
    expect(factories).toHaveLength(1);
    expect(sumLevels(factories)).toBe(5);
  });
});
