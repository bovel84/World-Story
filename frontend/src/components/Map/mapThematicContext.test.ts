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
  layerHasThematicSection,
  polityLabel,
  resourceCandidatesFromNational,
  type BuildRegionThematicContextInput,
} from './mapThematicContext';
import {
  buildThematicMapModel,
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

const CANDIDATES = [
  { id: 'oil-rom', kind: 'oil', label: 'Giacimento di Roma', regionId: 'ROM', status: 'active' },
  { id: 'stock-1', kind: 'coal', label: 'Riserva nazionale di carbone' },
];

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

const build = (patch: Partial<BuildRegionThematicContextInput> = {}): ReturnType<typeof buildRegionThematicContext> =>
  buildRegionThematicContext({
    region: REGIONS[0], activeLayer: 'political', model, regions: REGIONS,
    playerPolityId: 'ITA', relationships: { ITA: { AUT: 'hostile', FIR: 'ally' } },
    changedRegionIds: ['ROM'], strategicAgenda: null, commitments: COMMITMENTS,
    ...patch,
  });

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

describe('MAP P5 — RESOURCES', () => {
  it('mostra solo i siti con localizzazione canonica', () => {
    const context = build({ activeLayer: 'resources' });
    expect(context.resources.sites.map(site => site.id)).toEqual(['oil-rom']);
    expect(context.resources.sites[0]).toMatchObject({ regionId: 'ROM', kind: 'oil', label: 'Giacimento di Roma' });
    expect(context.resources.unavailableReason).toBeNull();
  });

  it('le riserve nazionali senza `regionId` restano fuori dalla provincia', () => {
    const nationalOnly = buildThematicMapModel({
      regions: REGIONS, playerPolityId: 'ITA',
      resourceCandidates: resourceCandidatesFromNational([{ kind: 'coal', label: 'Riserva nazionale di carbone' }]),
    });
    const context = build({ activeLayer: 'resources', model: nationalOnly });
    expect(context.resources.sites).toEqual([]);
    expect(context.resources.unavailableReason).toBeTruthy();
    // Nessuna riserva nazionale distribuita su una provincia arbitraria.
    expect(JSON.stringify(context.resources)).not.toContain('carbone');
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

describe('MAP P5 — DIPLOMACY', () => {
  it('spiega il colore con lo stato canonico relativo al player', () => {
    expect(build({ region: REGIONS[0], activeLayer: 'diplomacy' }).diplomacy).toMatchObject({ status: 'player', available: true });
    expect(build({ region: REGIONS[3], activeLayer: 'diplomacy' }).diplomacy).toMatchObject({ status: 'hostile', relationshipValue: 'hostile' });
    const neutral = build({
      region: REGIONS[3], activeLayer: 'diplomacy',
      relationships: { ITA: { FIR: 'ally' } },
    }).diplomacy;
    expect(neutral.status).toBe('unknown');
    expect(neutral.label).not.toBe('Neutrale');
  });

  it('fail closed: senza matrice diplomatica lo stato resta sconosciuto', () => {
    const context = build({ region: REGIONS[3], activeLayer: 'diplomacy', relationships: null });
    expect(context.diplomacy.available).toBe(false);
    expect(context.diplomacy.status).toBe('unknown');
    expect(context.diplomacy.relationshipValue).toBeNull();
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
