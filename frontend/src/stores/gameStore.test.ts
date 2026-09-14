import { afterEach, describe, expect, it } from 'vitest';
import { useGameStore } from './gameStore';
import type { World } from '../types';

afterEach(() => useGameStore.getState().reset());

describe('World snapshots from the real API', () => {
  it('indexes array snapshots by canonical ID so subsequent checkpoints can find the province', () => {
    const region = { id: 'world-uige', name: 'Uíge', owner: 'AGO', objects: [] };
    const wire = { id: 'world', regions: [region] };
    useGameStore.getState().setCurrentWorld(wire as unknown as World);
    const loaded = useGameStore.getState().currentWorld!;
    expect(Array.isArray(loaded.regions)).toBe(false);
    expect(loaded.regions['world-uige']).toBe(region);
    expect(loaded.regions['0']).toBeUndefined();
    expect(wire.regions).toEqual([region]);
    const delta = { id: region.id, owner: 'COG', color: '#ff4400', objects: [{ id: 'unit', type: 'mobilization', name: 'Eroi', lat: -7, lng: 15 }] };
    useGameStore.getState().setCurrentWorld({ ...loaded, regions: { ...loaded.regions, [delta.id]: { ...loaded.regions[delta.id], ...delta } } });
    expect(useGameStore.getState().currentWorld!.regions[region.id]).toMatchObject(delta);
  });

  it('keeps already indexed worlds stable and accepts clearing the session', () => {
    const world = { id: 'world', regions: {} } as World;
    useGameStore.getState().setCurrentWorld(world);
    expect(useGameStore.getState().currentWorld).toBe(world);
    useGameStore.getState().setCurrentWorld(null);
    expect(useGameStore.getState().currentWorld).toBeNull();
  });
});
