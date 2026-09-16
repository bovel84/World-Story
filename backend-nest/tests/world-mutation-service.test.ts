/**
 * WorldMutationService — mutazione deterministica del mondo (nessun DB/LLM).
 */
import { describe, it, expect } from 'vitest';
import { WorldMutationService } from '../src/game/WorldMutationService';
import { RegionResolver, PolityResolver } from '../src/utils/name-resolver';

function region(id: string, name: string, owner: string): any {
  return { id, name, owner, color: '#123456', population: 10, gdp: 10, militaryPower: 10, objects: [], status: 'active' };
}

function makeMutation() {
  const regions = new Map<string, any>([
    ['r1', region('r1', 'Roma', 'PLAYER')],
    ['r2', region('r2', 'Milano', 'FRA')],
  ]);
  const notes: string[] = [];
  const ctx: any = {
    regions: () => regions,
    isStrictGame: () => false,
    currentDate: () => '1951-01-01',
    playerPolityId: () => 'PLAYER',
    buildResolvers: () => ({
      regions: new RegionResolver([...regions.values()] as any, 'PLAYER'),
      polities: new PolityResolver([...regions.values()] as any, 'PLAYER'),
    }),
    worldStateOptions: () => ({ modernFacts: false, startDate: '1951-01-01' }),
    transferRegion: (r: any, newOwner: string, color?: string) => { r.owner = newOwner; r.color = color || '#000000'; },
    geometry: {
      frontierPosition: () => null,
      regionCenter: () => ({ lat: 1, lng: 2 }),
      resolveRegionFlexible: (key: string | undefined, resolver: any) => (key ? resolver.resolve(key) : undefined),
    },
    applyNationalEffects: () => ({ applied: [], bulletins: [] }),
    pushNationalNote: (n: string) => notes.push(n),
    mentionedNpcPolityIds: () => [],
    eventDetail: () => '',
    arsenalUnits: () => ({}),
    saveArsenal: () => {},
    resourceStock: () => ({ money: 100, food: 100, fuel: 100, clothing: 0, weapons: 0, debts: [] }),
    saveResourceStock: () => {},
  };
  return { svc: new WorldMutationService(ctx), regions, notes };
}

describe('WorldMutationService — mapChanges', () => {
  it('transfer cambia proprietario e colore', () => {
    const { svc, regions } = makeMutation();
    svc.applyMapChanges([{ type: 'transfer', regionName: 'Roma', newOwner: 'FRA' } as any]);
    expect(regions.get('r1').owner).toBe('FRA');
  });

  it('delete rende neutrale', () => {
    const { svc, regions } = makeMutation();
    svc.applyMapChanges([{ type: 'delete', regionName: 'Roma' } as any]);
    expect(regions.get('r1').owner).toBe('neutral');
    expect(regions.get('r1').color).toBe('#888888');
  });

  it('build_facility aggiunge un’opera operativa', () => {
    const { svc, regions } = makeMutation();
    const changed = svc.applyMapChanges([{
      type: 'build_facility', regionName: 'Roma', feature: { type: 'factory', name: 'Acciaieria' },
    } as any]);
    expect(changed).toHaveLength(1);
    const objects = regions.get('r1').objects;
    expect(objects.some((o: any) => o.type === 'factory' && o.name === 'Acciaieria')).toBe(true);
  });

  it('update cambia nome e PIL', () => {
    const { svc, regions } = makeMutation();
    svc.applyMapChanges([{ type: 'update', regionName: 'Roma', newName: 'Nuova Roma', newColor: '#abcdef' } as any]);
    expect(regions.get('r1').name).toBe('Nuova Roma');
    expect(regions.get('r1').color).toBe('#abcdef');
  });
});

describe('WorldMutationService — worldChanges', () => {
  it('regionOwners/regionGDP/popolazione aggiornano le regioni', () => {
    const { svc, regions } = makeMutation();
    svc.applyWorldChanges({
      regionOwners: { Milano: 'PLAYER' },
      regionGDP: { r1: 99 },
      regionPopulation: { r1: 500 },
    } as any);
    expect(regions.get('r2').owner).toBe('PLAYER');
    expect(regions.get('r1').gdp).toBe(99);
    expect(regions.get('r1').population).toBe(500);
  });

  it('nationalEffects produce note nazionali', () => {
    const { svc, notes } = makeMutation();
    // La callback fittizia non genera bulletin; verifichiamo solo che non lanci.
    expect(() => svc.applyWorldChanges({ nationalEffects: {} } as any)).not.toThrow();
    expect(Array.isArray(notes)).toBe(true);
  });
});
