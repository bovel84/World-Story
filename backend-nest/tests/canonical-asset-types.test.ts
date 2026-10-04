/**
 * WS-GOV-REALITY-ADVISOR-HARDENING — P5/P15: UNICA fonte dei tipi asset.
 *
 * Per ogni alias supportato, `VerifiedWorldSnapshot` e `CanonicalOrderSafety`
 * devono concordare: se il motore vede l'asset, il Consulente non può dire che
 * manca — e viceversa.
 */
import { describe, expect, it } from 'vitest';
import { canonicalAssetKind, type CanonicalAssetKind } from '../src/core/simulation/CanonicalAssetTypes';
import { buildVerifiedWorldSnapshot } from '../src/core/government/VerifiedWorldSnapshot';
import { canonicalOrderBlockers } from '../src/core/feasibility/CanonicalOrderSafety';

const game = (objects: unknown[], coastal = false) => ({
  id: 'consistency', playerPolityId: 'UGA', playerPolityName: 'Uganda', currentDate: '1951-01-01', currentTurn: 1,
  world: { regions: { ug: { id: 'ug', name: 'Uganda', owner: 'UGA', coastal, borders: [], objects } } },
  worldState: { resources: { stock: { money: 10 } }, arsenal: { units: {} } },
});

const world = (objects: unknown[]) => ({ regions: [{ id: 'ug', name: 'Uganda', owner: 'UGA', objects }], operationalObjects: [] });

const CASES: Array<{ kind: CanonicalAssetKind; aliases: string[]; bucket: keyof ReturnType<typeof buildVerifiedWorldSnapshot>['infrastructure']; order: string }> = [
  { kind: 'port', aliases: ['port', 'ft_port'], bucket: 'ports', order: 'Usa il porto di Porto A' },
  { kind: 'railway', aliases: ['railway', 'ft_railway'], bucket: 'railways', order: 'Usa la ferrovia esistente' },
  { kind: 'road', aliases: ['road', 'ft_road'], bucket: 'roads', order: 'Usa la strada esistente' },
  { kind: 'airfield', aliases: ['airbase', 'ft_airbase'], bucket: 'airfields', order: "Usa l'aeroporto esistente" },
  { kind: 'factory', aliases: ['factory', 'ft_factory', 'ft_works', 'ft_foundry', 'steel_mill'], bucket: 'factories', order: 'Usa la fabbrica esistente' },
  { kind: 'fleet', aliases: ['fleet', 'ship'], bucket: 'other', order: 'Mandiamo la flotta' },
];

describe('CanonicalAssetTypes — coerenza snapshot ↔ order safety', () => {
  it.each(CASES)('$kind: tutti gli alias sono riconosciuti', ({ aliases, kind }) => {
    for (const alias of aliases) expect(canonicalAssetKind(alias)).toBe(kind);
  });

  it.each(CASES.filter(entry => entry.kind !== 'fleet'))('$kind: snapshot e order safety concordano', ({ kind, aliases, bucket, order }) => {
    for (const alias of aliases) {
      const objects = [{ id: 'a1', type: alias, name: 'Porto A' }];
      const snapshot = buildVerifiedWorldSnapshot({ gameData: game(objects) as never, commitments: [], operationalRows: [] });
      expect(snapshot.infrastructure[bucket] ?? [], `${alias} deve comparire nello snapshot`).toHaveLength(1);
      // Nessun blocco di esistenza: il motore conosce l'asset.
      const blockers = canonicalOrderBlockers(order, 'UGA', world(objects));
      expect(blockers.filter(blocker => blocker.code === 'INFRASTRUCTURE_MISSING'), `${alias} non deve essere bloccato`).toEqual([]);
    }
  });

  it('ft_port con nome proprio: il motore lo vede e l’atto non è bloccato', () => {
    const objects = [{ id: 'p1', type: 'ft_port', name: 'Porto A' }];
    const snapshot = buildVerifiedWorldSnapshot({ gameData: game(objects) as never, commitments: [], operationalRows: [] });
    expect(snapshot.infrastructure.ports).toHaveLength(1);
    expect(snapshot.facts.ports.value).toContain('Porto A');
    expect(canonicalOrderBlockers('Usa Porto A', 'UGA', world(objects))).toEqual([]);
  });

  it('P6: Uganda senza porti resta corretta', () => {
    const snapshot = buildVerifiedWorldSnapshot({ gameData: game([], false) as never, commitments: [], operationalRows: [] });
    expect(snapshot.infrastructure.ports).toEqual([]);
    expect(snapshot.geography).toMatchObject({ coastal: false, landlocked: true });
    expect(snapshot.facts.ports.value).toBe('Porti posseduti: nessuno');
    const blockers = canonicalOrderBlockers('Usa il porto di Kampala', 'UGA', world([]));
    expect(blockers.some(blocker => blocker.code === 'INFRASTRUCTURE_MISSING')).toBe(true);
  });
});
