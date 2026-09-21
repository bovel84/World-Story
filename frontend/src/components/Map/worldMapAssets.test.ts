/**
 * MAP P6 — geografia economica canonica mondiale (frontend)
 * ========================================================
 * La mappa e il dossier devono raccontare **lo stesso** oggetto: i giacimenti e
 * gli impianti canonici entrano nel modello P3 già esistente
 * (`buildResourceMapModel` / `buildInfrastructureMapModel`), senza un secondo
 * modello e senza dedurre nulla dal nome.
 */
import { describe, it, expect } from 'vitest';
import type { Region } from '../../types';
import type { WorldMapAssetsPayload } from '../../services/api';
import {
  buildResourceMapModel,
  buildInfrastructureMapModel,
  buildThematicMapModel,
  type CanonicalFacilitySite,
} from './thematicMapModel';
import {
  canonicalFacilitiesFromWorldAssets,
  resourceCandidatesFromWorldAssets,
} from './mapThematicContext';

const region = (patch: Partial<Region> & { id: string }): Region => ({
  name: patch.id, color: '#609f87', owner: 'ITA', population: 1_000_000, gdp: 500,
  militaryPower: 30, objects: [], borders: [], status: 'active', metadata: {},
  ...patch,
} as Region);

const REGIONS: Region[] = [
  region({ id: 'ITA', name: 'Italia', gdp: 1000 }),
  region({ id: 'DEU', name: 'Germania', owner: 'DEU', polityName: 'Germania', gdp: 1200, objects: [
    { id: 'fac-dedupe', type: 'factory', name: 'Fabbrica del territorio' },
  ] as never }),
];

const ASSETS: WorldMapAssetsPayload = {
  canonical: true,
  resources: [
    {
      id: 'dep_coal_deu', resourceId: 'coal', resourceName: 'Carbone', regionId: 'DEU',
      accessibility: 'requires_extraction', known: true, knownQuantity: { resourceId: 'coal', baseUnits: '80000' },
    },
    {
      id: 'dep_iron_ita', resourceId: 'iron_ore', resourceName: 'Minerale di ferro', regionId: 'ITA',
      accessibility: 'open', known: false, knownQuantity: null,
      estimated: { low: '20000', base: '50000', high: '90000' },
    },
    // Fuori mondo: la geografia canonica lo scarta.
    { id: 'dep_ghost', resourceId: 'oil', resourceName: 'Petrolio', regionId: 'GHOST', accessibility: 'open', known: true, knownQuantity: null },
  ],
  facilities: [
    {
      id: 'fac_foundry_deu', typeId: 'ft_foundry', typeName: 'Altoforno', regionId: 'DEU',
      ownerActorId: 'deu_steel', ownerActorName: 'Acciaierie DEU', controllerActorId: 'ita_admin',
      controllerActorName: 'Amministrazione ITA', polityId: 'DEU', controllerPolityId: 'ITA', operational: true,
    },
    // Stesso id di un oggetto del territorio: dedup solo a id esatto.
    { id: 'fac-dedupe', typeId: 'ft_works', typeName: 'Officina', regionId: 'DEU', ownerActorId: 'a', controllerActorId: 'a', polityId: null, controllerPolityId: null, operational: false },
    // Geografia inesistente: esclusa.
    { id: 'fac_ghost', typeId: 'ft_mine', typeName: 'Miniera', regionId: 'GHOST', ownerActorId: 'a', controllerActorId: 'a', polityId: null, controllerPolityId: null, operational: true },
  ],
};

describe('MAP P6 — risorse canoniche mondiali', () => {
  it('il giacimento estero entra nel modello P3 con resourceId e nome dal catalogo', () => {
    const model = buildThematicMapModel({
      regions: REGIONS, playerPolityId: 'ITA',
      resourceCandidates: resourceCandidatesFromWorldAssets(ASSETS),
    });
    expect(model.resources.available).toBe(true);
    expect(model.resources.byRegion.DEU.map(site => site.id)).toEqual(['dep_coal_deu']);
    expect(model.resources.byRegion.DEU[0]).toMatchObject({ kind: 'coal', label: 'Carbone', accessibility: 'requires_extraction' });
    // Lo stesso oggetto è nella mappa e nel dossier: una sola fonte.
    expect(model.resources.sites.map(site => site.id).sort()).toEqual(['dep_coal_deu', 'dep_iron_ita']);
  });

  it('`known: false` non diventa zero e conserva la stima pubblicata', () => {
    const model = buildThematicMapModel({ regions: REGIONS, resourceCandidates: resourceCandidatesFromWorldAssets(ASSETS) });
    expect(model.resources.byRegion.ITA[0]).toMatchObject({
      kind: 'iron_ore', label: 'Minerale di ferro', known: false, estimated: { base: '50000' },
    });
    expect(JSON.stringify(model.resources.byRegion.ITA[0])).not.toMatch(/"knownQuantity"|"baseUnits"/);
  });

  it('una `regionId` inesistente nel mondo resta fuori (nessun marker orfano)', () => {
    const model = buildThematicMapModel({ regions: REGIONS, resourceCandidates: resourceCandidatesFromWorldAssets(ASSETS) });
    expect(model.resources.sites.map(site => site.id)).not.toContain('dep_ghost');
    expect(model.resources.byRegion.GHOST).toBeUndefined();
  });

  it('senza asset canonici (mondo legacy) il modello resta non disponibile', () => {
    const model = buildThematicMapModel({ regions: REGIONS, resourceCandidates: resourceCandidatesFromWorldAssets(null) });
    expect(model.resources.available).toBe(false);
    expect(model.resources.sites).toEqual([]);
  });

  it('fail closed: il motivo esplicito prevale sul messaggio di default', () => {
    const model = buildThematicMapModel({
      regions: REGIONS, resourceCandidates: [],
      resourcesUnavailableReason: 'Dati territoriali non disponibili.',
    });
    expect(model.resources.available).toBe(false);
    expect(model.resources.unavailableReason).toBe('Dati territoriali non disponibili.');
  });

  it('resourceId senza definizione nel catalogo resta tecnico, mai dedotto dal nome', () => {
    const candidates = resourceCandidatesFromWorldAssets({
      canonical: true,
      resources: [{ id: 'dep_x', resourceId: 'unobtainium', resourceName: 'unobtainium', regionId: 'ITA', accessibility: 'open', known: true, knownQuantity: null }],
      facilities: [],
    });
    const model = buildResourceMapModel({ regions: REGIONS, candidates });
    expect(model.byRegion.ITA[0]).toMatchObject({ kind: 'unobtainium', label: 'unobtainium' });
  });
});

describe('MAP P6 — impianti canonici nel layer Infrastrutture', () => {
  it('un impianto estero è infrastruttura, con proprietà economica canonica', () => {
    const model = buildThematicMapModel({
      regions: REGIONS, worldFacilities: canonicalFacilitiesFromWorldAssets(ASSETS),
    });
    const item = model.infrastructure.byRegion.DEU.find(entry => entry.id === 'fac_foundry_deu');
    expect(item).toMatchObject({
      source: 'canonical', type: 'facility', name: 'Altoforno', facilityTypeId: 'ft_foundry',
      operational: true, polityId: 'DEU', controllerPolityId: 'ITA',
      ownerActorName: 'Acciaierie DEU', controllerActorName: 'Amministrazione ITA',
    });
    // `region.owner` (DEU) non viene mai usato per dedurre la proprietà.
    expect(item?.polityId).toBe('DEU');
  });

  it('le opere del territorio restano, e nulla viene duplicato per id identico', () => {
    const model = buildThematicMapModel({ regions: REGIONS, worldFacilities: canonicalFacilitiesFromWorldAssets(ASSETS) });
    const ids = model.infrastructure.byRegion.DEU.map(entry => entry.id);
    expect(ids).toContain('fac-dedupe');
    expect(ids.filter(id => id === 'fac-dedupe')).toHaveLength(1);
    expect(model.infrastructure.byRegion.DEU.find(entry => entry.id === 'fac-dedupe')?.source).toBe('territory');
    expect(ids).toContain('fac_foundry_deu');
  });

  it('la geografia inesistente è esclusa; reparti e fronti non diventano mai opere', () => {
    const model = buildInfrastructureMapModel(REGIONS, [
      ...canonicalFacilitiesFromWorldAssets(ASSETS),
      { id: 'army-1', regionId: 'DEU', typeId: 'army', typeName: '1ª Armata', operational: true } as unknown as CanonicalFacilitySite,
    ]);
    // Solo le regioni che hanno davvero un'opera: nessun bucket fantasma.
    expect(Object.keys(model.byRegion)).toEqual(['DEU']);
    expect(model.byRegion.DEU.some(entry => entry.id === 'army-1')).toBe(false);
    expect(model.byRegion.GHOST).toBeUndefined();
  });
});

describe('MAP P6 — nessuna riscrittura della geografia politica', () => {
  it('il modello tematico non tocca owner/polity delle regioni', () => {
    const before = JSON.stringify(REGIONS);
    buildThematicMapModel({
      regions: REGIONS,
      relationships: { ITA: { DEU: 'hostile' } },
      playerPolityId: 'ITA',
      resourceCandidates: resourceCandidatesFromWorldAssets(ASSETS),
      worldFacilities: canonicalFacilitiesFromWorldAssets(ASSETS),
    });
    expect(JSON.stringify(REGIONS)).toBe(before);
    expect(REGIONS[1].owner).toBe('DEU');
  });
});
