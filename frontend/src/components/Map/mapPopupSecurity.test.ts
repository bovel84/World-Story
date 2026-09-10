import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const mapComponent = path.resolve(__dirname, 'MapboxMapView.tsx');

describe('MapboxMapView popup security', () => {
  it('creates object popups with DOM nodes instead of interpolated HTML', () => {
    const source = fs.readFileSync(mapComponent, 'utf8');

    expect(source).not.toContain('.setHTML(');
    expect(source).toContain('.setDOMContent(');
    expect(source).toContain('document.activeElement !== mapContainer.current');
    expect(source).toContain('className="map-keyboard-surface"');
  });
});
