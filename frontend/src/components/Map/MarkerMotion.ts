import type { Marker } from 'maplibre-gl';
import { interpolateCoordinate, type Coordinate } from './tacticalModel';

/** One short-lived RAF for all moving units; no camera/GeoJSON animation. */
export class MarkerMotion {
  private active = new Map<string, { marker: Marker; from: Coordinate; to: Coordinate; start: number }>();
  private frame = 0;
  constructor(private onFrame: () => void) {}

  move(id: string, marker: Marker, to: Coordinate): void {
    const from = marker.getLngLat().toArray() as Coordinate;
    this.active.delete(id); // A correction supersedes even a not-yet-started leg.
    if (from[0] === to[0] && from[1] === to[1]) return;
    this.active.set(id, { marker, from, to, start: performance.now() });
    if (!this.frame) this.frame = requestAnimationFrame(this.tick);
  }
  cancel(id: string): void { this.active.delete(id); }
  finish(): void {
    for (const item of this.active.values()) item.marker.setLngLat(item.to);
    this.dispose();
    this.onFrame();
  }
  dispose(): void {
    cancelAnimationFrame(this.frame);
    this.frame = 0;
    this.active.clear();
  }
  private tick = (now: number) => {
    this.frame = 0;
    for (const [id, item] of this.active) {
      const t = Math.min(1, (now - item.start) / 1400);
      const ease = t * t * (3 - 2 * t);
      item.marker.setLngLat(t === 1 ? item.to : interpolateCoordinate(item.from, item.to, ease));
      if (t === 1) this.active.delete(id);
    }
    this.onFrame();
    if (this.active.size) this.frame = requestAnimationFrame(this.tick);
  };
}
