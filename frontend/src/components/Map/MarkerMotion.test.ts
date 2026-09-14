import { afterEach, describe, expect, it, vi } from 'vitest';
import { MarkerMotion } from './MarkerMotion';

/** Controllable RAF: proves the superseding rule without real timers. */
const frameQueue: FrameRequestCallback[] = [];
const fakeMarker = (lng: number, lat: number) => {
  let point: [number, number] = [lng, lat];
  return {
    getLngLat: () => ({ toArray: () => point }),
    setLngLat: (next: [number, number]) => { point = next; return undefined; },
    position: () => point,
  };
};
const runFrame = (time: number) => {
  const pending = frameQueue.splice(0, frameQueue.length);
  for (const callback of pending) callback(time);
};

afterEach(() => {
  vi.unstubAllGlobals();
  frameQueue.length = 0;
});

describe('MarkerMotion', () => {
  it('moves a marker to its destination and then stops', () => {
    let now = 0;
    vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => { frameQueue.push(cb); return frameQueue.length; });
    vi.stubGlobal('cancelAnimationFrame', () => {});
    vi.spyOn(performance, 'now').mockImplementation(() => now);
    const motion = new MarkerMotion(() => {});
    const marker = fakeMarker(10, 40) as any;
    motion.move('u', marker, [14, 44]);
    now = 0; runFrame(0);
    now = 700; runFrame(700);
    expect(marker.position()[0]).toBeGreaterThan(10);
    expect(marker.position()[0]).toBeLessThan(14);
    now = 1400; runFrame(1400);
    expect(marker.position()).toEqual([14, 44]);
    expect(frameQueue).toHaveLength(0);
  });

  it('a correction back to the origin cancels a not-yet-started leg', () => {
    let now = 0;
    vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => { frameQueue.push(cb); return frameQueue.length; });
    vi.stubGlobal('cancelAnimationFrame', () => {});
    vi.spyOn(performance, 'now').mockImplementation(() => now);
    const motion = new MarkerMotion(() => {});
    const marker = fakeMarker(10, 40) as any;
    motion.move('u', marker, [14, 44]);
    motion.move('u', marker, [10, 40]);
    now = 5000; runFrame(5000);
    expect(marker.position()).toEqual([10, 40]);
    expect(frameQueue).toHaveLength(0);
  });
});
