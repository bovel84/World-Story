/**
 * RegionGeometryService — test di isolamento della geometria estratta da GameSession.
 * Copre le parti deterministiche: centroide SVG, risoluzione flessibile
 * (random/coastal/direzioni/target), fallback SVG del centro e guardie.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { RegionGeometryService, type GeometryRegion } from '../src/game/RegionGeometryService';
import { RegionResolver } from '../src/utils/name-resolver';

interface TestRegion extends GeometryRegion {
  name: string;
}

function makeService(regions: TestRegion[]) {
  const map = new Map(regions.map(r => [r.id, r]));
  return new RegionGeometryService<TestRegion>(() => map);
}

const east: TestRegion = { id: 'east', name: 'Oriente', owner: 'AAA', svgPath: 'M 2000 0 L 2000 1500' };
const west: TestRegion = { id: 'west', name: 'Occidente', owner: 'BBB', svgPath: 'M 0 0 L 0 1500' };
const port: TestRegion = { id: 'port', name: 'Porto', owner: 'CCC', svgPath: '', objects: [{ type: 'port' }] };

describe('RegionGeometryService', () => {
  it('calcola il centroide SVG come media dei punti', () => {
    const service = makeService([]);
    expect(service.svgCentroid('M 0 0 L 2000 1500')).toEqual({ x: 1000, y: 750 });
    expect(service.svgCentroid(undefined)).toBeNull();
    expect(service.svgCentroid('M 1 2')).toBeNull(); // meno di 4 numeri
  });

  it('risolve per id e per nome (resolver fuzzy)', () => {
    const service = makeService([east, west]);
    const resolver = new RegionResolver([east, west]);
    expect(service.resolveRegionFlexible('east', resolver)?.id).toBe('east');
    expect(service.resolveRegionFlexible('Occidente', resolver)?.id).toBe('west');
    expect(service.resolveRegionFlexible('inesistente', resolver)).toBeUndefined();
  });

  it('sceglie in modo deterministico per "random" (lunghezza della chiave)', () => {
    const service = makeService([east, west]);
    const resolver = new RegionResolver([east, west]);
    // 'random' ha lunghezza 6 → pool[6 % 2] = pool[0]
    expect(service.resolveRegionFlexible('random', resolver)?.id).toBe(east.id);
  });

  it('filtra le regioni costiere e ricade su tutte se non ce ne sono', () => {
    const withPort = makeService([east, port]);
    expect(withPort.resolveRegionFlexible('coastal', new RegionResolver([east, port]))?.id).toBe('port');
    const noPort = makeService([east, west]);
    // 'coastal' ha lunghezza 7 → pool[7 % 2] = pool[1] = west
    expect(noPort.resolveRegionFlexible('coastal', new RegionResolver([east, west]))?.id).toBe(west.id);
  });

  it('ordina per direzione usando i centroidi SVG', () => {
    const service = makeService([east, west]);
    const resolver = new RegionResolver([east, west]);
    expect(service.resolveRegionFlexible('west', resolver)?.id).toBe(west.id);
    expect(service.resolveRegionFlexible('est', resolver)?.id).toBe(east.id);
    expect(service.resolveRegionFlexible('sud', resolver)?.id).toBe(east.id); // y uguale: primo in ordine stabile
  });

  it('supporta il prefisso "target "', () => {
    const service = makeService([east, west]);
    const resolver = new RegionResolver([east, west]);
    expect(service.resolveRegionFlexible('target east', resolver)?.id).toBe('east');
  });

  it('regionCenter ricade sul centroide SVG quando manca la geometria GeoJSON', () => {
    const service = makeService([east]);
    // x=2000,y=750 → lng=180-180? (2000/2000*360-180=180), lat=90-(750/1500*180)=0
    expect(service.regionCenter(east)).toEqual({ lng: 180, lat: 0 });
  });

  it('frontierPosition è null senza geometria GeoJSON (guardia)', () => {
    const service = makeService([east]);
    expect(service.frontierPosition(east, 'BBB')).toBeNull();
  });
});
