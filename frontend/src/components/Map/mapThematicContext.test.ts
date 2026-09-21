/**
 * MAP P5 — contesto tematico: la mappa spiega sé stessa senza inventare nulla.
 * Ogni test fissa un confine preciso: che cosa è territoriale e che cosa è
 * soltanto contesto della potenza.
 */
import { describe, expect, it } from 'vitest';
import type { Commitment, MapObject, Region } from '../../types';
import type { Commitment as ApiCommitment } from '../../services/api';
import {
  buildRegionThematicContext,
  infrastructureGroupOf,
  layerHasThematicSection,
  polityLabel,
  resourceCandidatesFromOperatingPicture,
  RESOURCE_SITE_KIND,
  showsPolityContext,
  type BuildRegionThematicContextInput,
} from './mapThematicContext';
import {
  buildThematicMapModel,
  DIPLOMACY_COLORS,
  economyColorForBucket,
  economyLegendRanges,
  THEMATIC_NO_DATA_COLOR,
  type ThematicMapModel,
} from './thematicMapModel';

const object = (id: string, type: string, name: string, metadata?: Record<string, unknown>): MapObject =>
  ({ id, type, name, ...(metadata ? { metadata } : {}) });

const region = (patch: Partial<Region> & { id: string }): Region => ({
  name: patch.id, color: '#609f87', owner: 'ITA', population: 1_000_000, gdp: 500,
  militaryPower: 30, objects: [], borders: [], status: 'active', metadata: {},
  ...patch,
} as Region);

const REGIONS: Region[] = [
  region({ id: 'ROM', name: 'Roma', polityName: 'Italia', gdp: 900, borders: ['FIR', 'BOL'], metadata: { surface_type: 'Pianura', tags: ['capitale'] },
    objects: [object('fac-1', 'factory', 'Acciaierie'), object('site-1', 'construction_site', 'Porto nuovo', { phase: 'fondamenta' }), object('army-1', 'army', '1ª Armata')] }),
  region({ id: 'FIR', name: 'Firenze', polityName: 'Italia', gdp: 300 }),
  region({ id: 'BOL', name: 'Bologna', polityName: 'Italia', gdp: 150 }),
  region({ id: 'AUT', name: 'Vienna', polityName: 'Austria', owner: 'AUT', gdp: 700,
    objects: [object('radar-1', 'radar', 'Stazione radar')], metadata: { terrain: 'Alpino' } }),
  region({ id: 'NEU', name: 'Terra di nessuno', owner: 'neutral', gdp: 0, polityName: undefined }),
];

/**
 * MAP P5.1 — la geografia delle risorse arriva dagli oggetti operativi `mine`
 * con `regionId` pubblicato dal motore. `NaturalResourceSummary` (riserve
 * nazionali) non ha e non deve avere un `regionId`.
 */
const operatingObject = (patch: Record<string, unknown>) => ({
  id: 'x', kind: 'mine', label: 'Miniera', status: 'operational', statusLabel: 'Operativo',
  parentId: null, regionId: null, regionName: null, facts: [], problems: [], actions: [], ...patch,
});
const RESOURCE_PICTURE = ({
  counts: { mine: 3 }, conventions: [], chains: [],
  objects: [
    operatingObject({ id: 'mine-oil-rom', label: 'Miniera di petrolio (Roma)', regionId: 'ROM', regionName: 'Roma' }),
    operatingObject({ id: 'mine-no-region', label: 'Miniera senza regione', regionId: null }),
    operatingObject({ id: 'mine-ghost', label: 'Miniera fuori mondo', regionId: 'GHOST' }),
    operatingObject({ id: 'fac-rom', kind: 'facility', label: 'Acciaierie', regionId: 'ROM' }),
    operatingObject({ id: 'unit-rom', kind: 'unit', label: '1° Reparto', regionId: 'ROM' }),
    operatingObject({ id: 'front-rom', kind: 'front', label: 'Fronte', regionId: 'ROM' }),
  ],
}) as unknown as Parameters<typeof resourceCandidatesFromOperatingPicture>[0];

const CANDIDATES = resourceCandidatesFromOperatingPicture(RESOURCE_PICTURE);
/** Riserva nazionale: nessun `regionId` nel contratto, quindi nessun sito. */
const NATIONAL_RESERVES = [{ kind: 'coal', label: 'Riserva nazionale di carbone' }];

const model: ThematicMapModel = buildThematicMapModel({
  regions: REGIONS,
  relationships: { ITA: { AUT: 'hostile', FIR: 'ally' } },
  playerPolityId: 'ITA',
  resourceCandidates: CANDIDATES,
});

const COMMITMENTS: ApiCommitment[] = [
  { id: 'c-1', type: 'treaty', actor: 'AUT', counterparty: 'ITA', description: 'Patto alpino', createdDate: '1951-01-01', createdTurn: 1, status: 'active', deadline: '1951-06-01', sourceEventId: null, importance: 3, updatedDate: '1951-02-01', updatedTurn: 2, note: '' },
  { id: 'c-2', type: 'loan', actor: 'AUT', counterparty: 'HUN', description: 'Prestito', createdDate: '1950-01-01', createdTurn: 1, status: 'fulfilled', deadline: null, sourceEventId: null, importance: 1, updatedDate: '1951-01-15', updatedTurn: 1, note: '' },
  { id: 'c-3', type: 'treaty', actor: 'HUN', counterparty: 'ITA', description: 'Non riguarda AUT', createdDate: '1950-01-01', createdTurn: 1, status: 'active', deadline: null, sourceEventId: null, importance: 2, updatedDate: '1950-12-01', updatedTurn: 1, note: '' },
];

/**
 * Il modello tematico è **uno solo**: se il caso sovrascrive le relazioni, il
 * modello viene ricostruito dalle stesse relazioni, così il dossier non può
 * divergere dalla mappa per un input disallineato nel test.
 */
const build = (patch: Partial<BuildRegionThematicContextInput> = {}): ReturnType<typeof buildRegionThematicContext> => {
  const relationships = patch.relationships === undefined ? { ITA: { AUT: 'hostile', FIR: 'ally' } } : patch.relationships;
  const playerPolityId = patch.playerPolityId === undefined ? 'ITA' : patch.playerPolityId;
  return buildRegionThematicContext({
    region: REGIONS[0], activeLayer: 'political', model, regions: REGIONS,
    playerPolityId, relationships, changedRegionIds: ['ROM'], strategicAgenda: null, commitments: COMMITMENTS,
    ...patch,
    model: patch.model ?? buildThematicMapModel({ regions: REGIONS, relationships, playerPolityId, resourceCandidates: CANDIDATES }),
  });
};

describe('MAP P5 — layer attivo', () => {
  it('riporta etichetta e descrizione canoniche del layer e non tocca la selezione', () => {
    for (const layer of ['political', 'economy', 'resources', 'infrastructure', 'diplomacy', 'changes', 'terrain'] as const) {
      const context = build({ activeLayer: layer });
      expect(context.layer).toBe(layer);
      expect(context.layerLabel.length).toBeGreaterThan(0);
      expect(context.layerDescription.length).toBeGreaterThan(0);
      expect(context.regionId).toBe('ROM');
      expect(layerHasThematicSection(layer)).toBe(true);
    }
    // Il layer militare resta dell'esperienza P4: nessuna sezione tematica.
    expect(layerHasThematicSection('military')).toBe(false);
  });
});

describe('MAP P5 — POLITICAL', () => {
  it('mostra il proprietario canonico e il rapporto con il player', () => {
    const context = build();
    expect(context.political.ownerId).toBe('ITA');
    expect(context.political.ownerName).toBe('Italia');
    expect(context.political.isPlayer).toBe(true);
    expect(context.political.borders).toBe(2);
    expect(context.political.changedRecently).toBe(true);
  });

  it('un territorio neutrale non inventa un proprietario', () => {
    const context = build({ region: REGIONS[4], changedRegionIds: [] });
    expect(context.political.ownerId).toBeNull();
    expect(context.political.ownerName).toBe('Neutrale');
    expect(context.political.isPlayer).toBe(false);
    expect(context.polity).toBeNull();
    expect(context.political.changedRecently).toBe(false);
  });
});

describe('MAP P5 — ECONOMY', () => {
  it('usa esattamente il bucket e le soglie del modello P3', () => {
    const context = build({ activeLayer: 'economy' });
    const p3 = model.economy.byRegion.ROM;
    expect(context.economy.gdp).toBe(900);
    expect(context.economy.bucket).toBe(p3.bucket);
    expect(context.economy.edges).toEqual(model.economy.edges);
    expect(context.economy.bucketCount).toBe(model.economy.bucketCount);
    // Il colore e l'intervallo del dossier sono quelli del layer, non una palette parallela.
    expect(context.economy.range).toEqual(economyLegendRanges(model.economy)[p3.bucket]);
    expect(context.economy.color).toBe(economyColorForBucket(p3.bucket));
  });

  it('senza PIL territoriale non inventa un valore', () => {
    const context = build({ region: REGIONS[4], activeLayer: 'economy' });
    expect(context.economy.gdp).toBeNull();
    expect(context.economy.bucket).toBeNull();
    expect(context.economy.range).toBeNull();
    expect(context.economy.color).toBe(THEMATIC_NO_DATA_COLOR);
  });
});

describe('MAP P5.1 — RESOURCES', () => {
  it('un oggetto operativo `mine` con regione valida è un sito geografico', () => {
    const context = build({ activeLayer: 'resources' });
    expect(context.resources.sites.map(site => site.id)).toEqual(['mine-oil-rom']);
    expect(context.resources.sites[0]).toMatchObject({
      regionId: 'ROM', label: 'Miniera di petrolio (Roma)', status: 'Operativo', kind: RESOURCE_SITE_KIND,
    });
    expect(context.resources.unavailableReason).toBeNull();
  });

  it('una miniera senza `regionId` non diventa un sito', () => {
    expect(CANDIDATES.map(candidate => candidate.id)).not.toContain('mine-no-region');
    expect(JSON.stringify(build({ activeLayer: 'resources' }).resources)).not.toContain('Miniera senza regione');
  });

  it('una `regionId` inesistente nel mondo viene scartata dalla geografia canonica', () => {
    // La proiezione dagli oggetti operativi riporta il `regionId` pubblicato; è
    // il modello P3 (`canonicalResourceSites`) a scartarlo se non esiste nel mondo.
    expect(model.resources.sites.map(site => site.id)).not.toContain('mine-ghost');
    for (const region of REGIONS) {
      expect(build({ region, activeLayer: 'resources' }).resources.sites.map(site => site.id)).not.toContain('mine-ghost');
    }
    expect(JSON.stringify(build({ activeLayer: 'resources' }).resources)).not.toContain('Miniera fuori mondo');
  });

  it('facility, reparti e fronti non sono siti di risorsa', () => {
    const ids = JSON.stringify(build({ activeLayer: 'resources' }).resources);
    expect(ids).not.toContain('fac-rom');
    expect(ids).not.toContain('unit-rom');
    expect(ids).not.toContain('front-rom');
    // La geografia non viene mai dedotta dal nome della risorsa o della miniera.
    expect(JSON.stringify(CANDIDATES)).not.toContain('"oil"');
  });

  it('le riserve nazionali senza sito restano fuori dalla provincia', () => {
    const nationalOnly = buildThematicMapModel({
      regions: REGIONS, playerPolityId: 'ITA',
      resourceCandidates: resourceCandidatesFromOperatingPicture({ objects: [] } as any),
    });
    const context = build({ activeLayer: 'resources', model: nationalOnly });
    expect(context.resources.sites).toEqual([]);
    expect(context.resources.unavailableReason).toBeTruthy();
    expect(JSON.stringify(context.resources)).not.toContain('carbone');
    expect(JSON.stringify(NATIONAL_RESERVES)).not.toContain('regionId');
  });

  it('l’assenza di quadro operativo non produce candidati', () => {
    expect(resourceCandidatesFromOperatingPicture(null)).toEqual([]);
    expect(resourceCandidatesFromOperatingPicture(undefined)).toEqual([]);
  });
});

describe('MAP P5 — INFRASTRUCTURE', () => {
  it('mostra le opere territoriali e non i reparti', () => {
    const context = build({ activeLayer: 'infrastructure' });
    expect(context.infrastructure.items.map(item => item.id)).toEqual(['fac-1', 'site-1']);
    expect(context.infrastructure.items.map(item => item.id)).not.toContain('army-1');
    expect(context.infrastructure.operative.map(item => item.id)).toEqual(['fac-1']);
    expect(context.infrastructure.strategic).toEqual([]);
  });

  it('un `construction_site` resta un cantiere con lo stato pubblicato dal motore', () => {
    const context = build({ activeLayer: 'infrastructure' });
    const [site] = context.infrastructure.underConstruction;
    expect(site.id).toBe('site-1');
    expect(site.underConstruction).toBe(true);
    expect(site.report.length).toBeGreaterThan(0);
  });

  it('le installazioni strategiche restano infrastrutture, distinguibili', () => {
    const context = build({ region: REGIONS[3], activeLayer: 'infrastructure', playerPolityId: 'AUT' });
    expect(context.infrastructure.items.map(item => item.id)).toEqual(['radar-1']);
    expect(context.infrastructure.strategic.map(item => item.id)).toEqual(['radar-1']);
  });
});

/**
 * MAP P6.2 — un impianto canonico **fermo** non è «operativo».
 * Prima di P6.2 la classificazione metteva in «Operative» tutto ciò che non era
 * cantiere o installazione strategica: `operational: false` del catalogo veniva
 * quindi cancellato dalla UI. Il campo è l'unica affermazione sullo stato di
 * esercizio, e `undefined` (legacy) non è `false`.
 */
describe('MAP P6.2 — infrastrutture: «Non operative»', () => {
  const canonical = (id: string, operational: boolean, patch: Record<string, unknown> = {}) => ({
    id, regionId: 'ROM', typeId: 'ft-1', typeName: 'Raffineria', operational,
    ownerActorId: 'act-owner', ownerActorName: 'Raffinazione di Stato',
    controllerActorId: 'act-ctrl', controllerActorName: 'Gestore portuale',
    polityId: 'ITA', controllerPolityId: 'NLD', ...patch,
  });
  const withFacilities = (facilities: ReturnType<typeof canonical>[]) => build({
    activeLayer: 'infrastructure',
    model: buildThematicMapModel({
      regions: REGIONS, relationships: { ITA: {} }, playerPolityId: 'ITA',
      resourceCandidates: CANDIDATES, worldFacilities: facilities,
    }),
  });

  it('canonical `operational:false` → gruppo «Non operative», mai «Operative»', () => {
    const context = withFacilities([canonical('fac-fermo', false)]);
    expect(context.infrastructure.operative.map(item => item.id)).not.toContain('fac-fermo');
    expect(context.infrastructure.inactive.map(item => item.id)).toEqual(['fac-fermo']);
    // Resta visibile e conserva la semantica: nessun asset nascosto.
    expect(context.infrastructure.items.map(item => item.id)).toEqual(['fac-1', 'site-1', 'fac-fermo']);
  });

  it('canonical `operational:true` → «Operative»', () => {
    const context = withFacilities([canonical('fac-attivo', true)]);
    expect(context.infrastructure.operative.map(item => item.id)).toEqual(['fac-1', 'fac-attivo']);
    expect(context.infrastructure.inactive).toEqual([]);
  });

  it('legacy senza `operational` → comportamento invariato (Operative)', () => {
    // Gli oggetti del territorio non pubblicano lo stato di esercizio.
    const context = build({ activeLayer: 'infrastructure' });
    const legacy = context.infrastructure.items.find(item => item.id === 'fac-1');
    expect(legacy?.operational).toBeUndefined();
    expect(context.infrastructure.inactive).toEqual([]);
    expect(context.infrastructure.operative.map(item => item.id)).toContain('fac-1');
    // `undefined` non è `false`: la regola è esplicita.
    expect(infrastructureGroupOf({ ...legacy!, source: 'canonical' })).toBe('operative');
  });

  it('la precedenza è mutuamente esclusiva: cantiere → strategica → non operativa → operativa', () => {
    const context = withFacilities([
      canonical('fac-fermo', false),
      canonical('fac-cantiere', false, { source: 'canonical' }),
      canonical('fac-strategica', false),
    ]);
    // Un solo gruppo per voce, sempre.
    const groups = [context.infrastructure.operative, context.infrastructure.inactive,
      context.infrastructure.underConstruction, context.infrastructure.strategic];
    const ids = groups.flat().map(item => item.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(context.infrastructure.inactive.map(item => item.id)).toEqual(['fac-fermo', 'fac-cantiere', 'fac-strategica']);
    expect(context.infrastructure.operative.map(item => item.id)).toEqual(['fac-1']);
    expect(context.infrastructure.underConstruction.map(item => item.id)).toEqual(['site-1']);
  });

  it('un impianto non operativo conserva proprietario, controllore e potenza', () => {
    const context = withFacilities([canonical('fac-fermo', false)]);
    const [item] = context.infrastructure.inactive;
    expect(item).toMatchObject({
      source: 'canonical', operational: false, facilityTypeId: 'ft-1',
      ownerActorId: 'act-owner', ownerActorName: 'Raffinazione di Stato',
      controllerActorId: 'act-ctrl', controllerActorName: 'Gestore portuale',
      polityId: 'ITA', controllerPolityId: 'NLD',
    });
    // Proprietà ≠ controllo: la UI mostra entrambe (polity diverse).
    expect(item.controllerPolityId).not.toBe(item.polityId);
  });
});

describe('MAP P5.1 — DIPLOMACY (una sola classificazione)', () => {
  it('matrice assente → unknown, e il layer non è disponibile', () => {
    const context = build({ region: REGIONS[3], activeLayer: 'diplomacy', relationships: null });
    expect(context.diplomacy.status).toBe('unknown');
    expect(context.diplomacy.available).toBe(false);
    expect(context.diplomacy.relationshipValue).toBeNull();
  });

  it('entry `ally` → ally', () => {
    // Una regione di una potenza alleata: il modello è costruito sullo stesso mondo.
    const allied = region({ id: 'FIR', name: 'Firenze', polityName: 'Firenze', owner: 'FIR', gdp: 300 });
    const world = REGIONS.map(item => (item.id === 'FIR' ? allied : item));
    const relationships = { ITA: { FIR: 'ally', AUT: 'hostile' } };
    const context = build({
      region: allied, regions: world, activeLayer: 'diplomacy', relationships,
      model: buildThematicMapModel({ regions: world, relationships, playerPolityId: 'ITA', resourceCandidates: CANDIDATES }),
    });
    expect(context.diplomacy.status).toBe('ally');
    expect(context.diplomacy.relationshipValue).toBe('ally');
  });

  it('entry `hostile` → hostile', () => {
    const context = build({ region: REGIONS[3], activeLayer: 'diplomacy', relationships: { ITA: { AUT: 'hostile' } } });
    expect(context.diplomacy.status).toBe('hostile');
  });

  it('il proprietario è il player → player', () => {
    const context = build({ region: REGIONS[0], activeLayer: 'diplomacy' });
    expect(context.diplomacy.status).toBe('player');
    expect(context.diplomacy.label).toBe('Il tuo Stato');
  });

  it('matrice disponibile ma nessuna entry → neutral (mai unknown)', () => {
    const context = build({ region: REGIONS[3], activeLayer: 'diplomacy', relationships: { ITA: { FIR: 'ally' } } });
    expect(context.diplomacy.status).toBe('neutral');
    expect(context.diplomacy.label).toBe('Neutrale');
    expect(context.diplomacy.available).toBe(true);
  });

  it('lo stato è **identico** a quello del modello che colora la mappa', () => {
    const cases: Array<Record<string, Record<string, string>> | null> = [
      null,
      { ITA: { AUT: 'hostile', FIR: 'ally' } },
      { ITA: { FIR: 'ally' } },
      {},
    ];
    for (const relationships of cases) {
      const scenario = buildThematicMapModel({
        regions: REGIONS, relationships, playerPolityId: 'ITA',
        resourceCandidates: CANDIDATES,
      });
      for (const region of REGIONS) {
        const context = build({ region, activeLayer: 'diplomacy', model: scenario, relationships });
        const shared = scenario.diplomacy.byRegion[region.id];
        expect(context.diplomacy.status).toBe(shared);
        // Anche il colore è lo stesso che la mappa scrive nel feature-state.
        expect(context.diplomacy.color).toBe(DIPLOMACY_COLORS[shared]);
      }
    }
  });
});

describe('MAP P5.1 — priorità del contesto della potenza', () => {
  it('compare solo nei layer dove è semanticamente utile', () => {
    expect(showsPolityContext('diplomacy')).toBe(true);
    expect(showsPolityContext('political')).toBe(true);
    for (const layer of ['military', 'economy', 'resources', 'infrastructure', 'changes', 'terrain'] as const) {
      expect(showsPolityContext(layer)).toBe(false);
    }
  });

  it('il layer militare resta territoriale: nessun blocco nazionale davanti a P4', () => {
    // Il contesto della potenza è calcolato comunque (read model puro), ma la
    // UI lo mostra solo su Diplomazia/Politica: qui si fissa la regola.
    const military = build({ activeLayer: 'military', strategicAgenda: { powers: [{ polityId: 'ITA', name: 'Italia', objectives: [{ id: 'o-1', description: 'Obiettivo', type: 'x', priority: 1, progress: 0, since: '', reviewDate: '', reason: '' }] }] } });
    expect(military.layer).toBe('military');
    expect(layerHasThematicSection('military')).toBe(false);
    expect(showsPolityContext(military.layer)).toBe(false);
  });
});

describe('MAP P5 — CHANGES e TERRAIN', () => {
  it('i cambiamenti vengono solo da `changedRegionIds`', () => {
    expect(build({ changedRegionIds: ['ROM'] }).changes.changed).toBe(true);
    expect(build({ changedRegionIds: ['FIR'] }).changes.changed).toBe(false);
    expect(build({ changedRegionIds: [] }).changes.changed).toBe(false);
  });

  it('il terreno mostra solo metadati fisici già presenti', () => {
    const pianura = build().terrain;
    expect(pianura.surfaceType).toBe('Pianura');
    expect(pianura.facts).toEqual([]);
    // `tags` non è un metadato fisico: non compare fra i fatti del terreno.
    expect(JSON.stringify(pianura)).not.toContain('capitale');
    const alpino = build({ region: REGIONS[3], playerPolityId: 'AUT' }).terrain;
    expect(alpino.facts).toEqual([{ label: 'Terreno', value: 'Alpino' }]);
  });
});

describe('MAP P5 — CONTESTO DELLA POTENZA', () => {
  it('l’agenda è della polity e si aggancia solo con polityId esatto', () => {
    const agenda = { powers: [
      { polityId: 'AUT', name: 'Austria', objectives: [{ id: 'o-1', description: 'Rafforzare l’influenza nei Balcani', type: 'influence', priority: 2, progress: 35, since: '1950-06-01', reviewDate: '1951-06-01', reason: 'Sicurezza dei confini' }] },
      { polityId: 'HUN', name: 'Ungheria', objectives: [{ id: 'o-2', description: 'Obiettivo ungherese', type: 'defence', priority: 1, progress: 10, since: '1950-01-01', reviewDate: '1951-01-01', reason: '' }] },
    ] };
    const austria = build({ region: REGIONS[3], activeLayer: 'diplomacy', strategicAgenda: agenda, playerPolityId: 'ITA' });
    expect(austria.polity?.agenda?.polityId).toBe('AUT');
    expect(austria.polity?.agenda?.objectives.map(item => item.id)).toEqual(['o-1']);
    expect(JSON.stringify(austria.polity?.agenda)).not.toContain('Obiettivo ungherese');
    // L'agenda non entra mai nei fatti del territorio.
    expect(JSON.stringify({ political: austria.political, economy: austria.economy, terrain: austria.terrain }))
      .not.toContain('Balcani');
  });

  it('senza agenda per quella polity non inventa obiettivi', () => {
    const context = build({ region: REGIONS[3], strategicAgenda: { powers: [{ polityId: 'HUN', name: 'Ungheria', objectives: [] }] } });
    expect(context.polity?.agenda).toBeNull();
  });

  it('gli impegni coinvolgono la polity come actor o counterparty, gli altri restano fuori', () => {
    const context = build({ region: REGIONS[3] });
    expect(context.polity?.commitments.active.map(item => item.id)).toEqual(['c-1']);
    expect(context.polity?.commitments.recent.map(item => item.id)).toEqual(['c-2']);
    expect(JSON.stringify(context.polity?.commitments)).not.toContain('c-3');
  });

  it('un territorio neutrale non ha contesto di potenza', () => {
    expect(build({ region: REGIONS[4], playerPolityId: 'ITA' }).polity).toBeNull();
  });

  it('il nome della polity usa i campi canonici del mondo', () => {
    expect(polityLabel('ITA', REGIONS)).toBe('Italia');
    expect(polityLabel('AUT', REGIONS)).toBe('Austria');
    expect(polityLabel('neutral', REGIONS)).toBe('Neutrale');
    expect(polityLabel('XYZ', REGIONS)).toBe('XYZ');
  });
});

// Il tipo `Commitment` è importato dai tipi di gioco: qui si fissa il contratto.
describe('MAP P5 — contratto dati', () => {
  it('gli impegni sono tipizzati come nel registro del motore', () => {
    const entry: Commitment = { id: 'x', type: 'treaty', actor: 'A', counterparty: null, description: '', status: 'active' };
    expect(Object.keys(entry)).toContain('actor');
  });
});
