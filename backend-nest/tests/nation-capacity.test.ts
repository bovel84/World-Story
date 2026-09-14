/**
 * Capacità nazionale di base: le disponibilità di un paese devono dipendere dai
 * suoi dati reali (PIL, popolazione, costa, forze), non essere zero per tutti.
 */
import { describe, expect, it, beforeEach } from 'vitest';
import {
  CAPACITY_LIMITS, baselineCapacity, coastalFromGeojson, economicScaleFor, resetCoastalCache, wealthTierFor,
} from '../src/core/simulation/NationCapacity';
import { WorldStateEngine } from '../src/core/simulation/WorldStateEngine';

const capacityOf = (polityId: string, population: number, coastal = 0, militaryPower = 100) =>
  baselineCapacity({ polityId, population, coastalProvinces: coastal, militaryPower });

describe('capacità nazionale di base', () => {
  it('un paese ricco ha più industria di uno povero a parità di abitanti', () => {
    const rich = capacityOf('DEU', 60_000_000);
    const poor = capacityOf('AFG', 60_000_000);
    expect(rich.factories).toBeGreaterThan(poor.factories);
    expect(rich.universities).toBeGreaterThan(poor.universities);
    expect(rich.wealthTier).toBeGreaterThan(poor.wealthTier);
  });

  it('un paese grande ha più atenei di uno piccolo a parità di reddito pro capite', () => {
    const big = capacityOf('ITA', 60_000_000);
    const small = capacityOf('LUX', 1_200_000);
    expect(big.universities).toBeGreaterThan(small.universities);
  });

  it('i porti sono geografia: senza sbocco al mare non esistono', () => {
    expect(capacityOf('BWA', 8_700_000, 0).ports).toBe(0);
    expect(capacityOf('CHE', 1_800_000, 0).ports).toBe(0);
    expect(capacityOf('ITA', 59_000_000, 60).ports).toBeGreaterThan(3);
    expect(capacityOf('GBR', 68_000_000, 75).ports).toBeGreaterThanOrEqual(9);
    // Un arcipelago non diventa una flotta: la radice delle coste.
    expect(capacityOf('IDN', 270_000_000, 86).ports).toBeLessThanOrEqual(CAPACITY_LIMITS.ports);
  });

  it('la base resta nei limiti dichiarati e non esplode', () => {
    const huge = capacityOf('USA', 5_000_000_000, 500, 1_000_000);
    expect(huge.factories).toBe(CAPACITY_LIMITS.factories);
    expect(huge.universities).toBe(CAPACITY_LIMITS.universities);
    expect(huge.ports).toBe(CAPACITY_LIMITS.ports);
    expect(huge.forces).toBeLessThanOrEqual(CAPACITY_LIMITS.forces);
    expect(huge.forces).toBeGreaterThan(20);
    const empty = capacityOf('XXX', 0, 0, 0);
    expect(empty.factories).toBe(0);
    expect(empty.universities).toBe(0);
    expect(empty.forces).toBe(0);
    expect(empty.sources).toContain('abitanti');
  });

  it('è deterministica e monotona nella potenza militare', () => {
    expect(capacityOf('ITA', 59_000_000, 60, 100)).toEqual(capacityOf('ITA', 59_000_000, 60, 100));
    expect(capacityOf('ITA', 59_000_000, 60, 10_000).forces)
      .toBeGreaterThanOrEqual(capacityOf('ITA', 59_000_000, 60, 1).forces);
    // I dati non numerici non producono NaN.
    const broken = baselineCapacity({ polityId: 'ITA', population: NaN, coastalProvinces: NaN, militaryPower: NaN });
    for (const value of [broken.factories, broken.ports, broken.universities, broken.forces]) {
      expect(Number.isFinite(value)).toBe(true);
    }
  });

  it('riconosce la costa dal GeoJSON e non la inventa', () => {
    resetCoastalCache();
    expect(coastalFromGeojson('r1', '{"properties":{"surface_type":"Coastal"}}')).toBe(true);
    expect(coastalFromGeojson('r2', '{"properties":{"surface_type":"Land"}}')).toBe(false);
    expect(coastalFromGeojson('r3', '{"properties":{"surface_type": "Strait"}}')).toBe(true);
    expect(coastalFromGeojson('r4', undefined)).toBe(false);
  });

  it('misura la scala economica sul PIL reale, non sul numero di province', () => {
    expect(economicScaleFor(0)).toBe(0);
    expect(economicScaleFor(100)).toBe(1);
    expect(economicScaleFor(10_000)).toBe(10);
    expect(wealthTierFor(50_000)).toBeGreaterThan(wealthTierFor(1_000));
  });
});

describe('gli account nazionali usano la base del paese', () => {
  it('due nazioni con gli stessi oggetti ma dati diversi non hanno la stessa disponibilità', () => {
    const regions = [
      { id: 'de-1', owner: 'DEU', population: 40_000_000, gdp: 100, militaryPower: 100, coastal: true },
      { id: 'af-1', owner: 'AFG', population: 40_000_000, gdp: 100, militaryPower: 100 },
    ];
    const accounts = WorldStateEngine.accounts(regions);
    expect(accounts.DEU.factories).toBeGreaterThan(accounts.AFG.factories);
    expect(accounts.DEU.ports).toBeGreaterThan(0);
    expect(accounts.AFG.ports).toBe(0);
  });

  it('la base si somma agli impianti costruiti sulla mappa', () => {
    const base = WorldStateEngine.accounts([
      { id: 'x', owner: 'ITA', population: 50_000_000, gdp: 100, militaryPower: 100, coastal: true },
    ]).ITA;
    const built = WorldStateEngine.accounts([
      { id: 'x', owner: 'ITA', population: 50_000_000, gdp: 100, militaryPower: 100, coastal: true,
        objects: [{ type: 'factory', level: 3 }, { type: 'university', level: 2 }, { type: 'port', level: 1 }] },
    ]).ITA;
    expect(built.factories).toBe(base.factories + 3);
    expect(built.universities).toBe(base.universities + 2);
    expect(built.ports).toBe(base.ports + 1);
  });

  it('il conto dichiara da dove viene la disponibilità (profilo del paese)', () => {
    const account = WorldStateEngine.accounts([
      { id: 'bw-1', owner: 'BWA', population: 2_700_000, gdp: 40, militaryPower: 20 },
      { id: 'bw-2', owner: 'BWA', population: 2_700_000, gdp: 40, militaryPower: 20, coastal: true,
        objects: [{ type: 'factory', level: 2 }] },
    ]).BWA;
    // La base è quella del profilo: il totale è base + oggetti della mappa.
    expect(account.capacityBase).toBeDefined();
    expect(account.factories).toBe((account.capacityBase?.factories || 0) + 2);
    expect(account.capacityBase?.ports).toBe(account.ports);
    expect(account.capacitySources).toContain('PIL');
    expect(account.capacitySources).toContain('milioni di abitanti');
    // Grammatica: una sola provincia costiera è singolare.
    expect(account.capacitySources).toContain('1 provincia costiera');
    const landlocked = WorldStateEngine.accounts([
      { id: 'ch-1', owner: 'CHE', population: 8_000_000, gdp: 100, militaryPower: 100 },
    ]).CHE;
    expect(landlocked.capacitySources).toContain('nessuno sbocco al mare');
    expect(landlocked.capacityBase?.ports).toBe(0);
  });

  it('la costa si deduce dal GeoJSON quando la mappa non la dichiara', () => {
    resetCoastalCache();
    const withGeo = WorldStateEngine.accounts([
      { id: 'geo-1', owner: 'GRC', population: 10_000_000, gdp: 100, militaryPower: 100,
        geojson: '{"properties":{"surface_type":"Coastal"}}' },
    ]).GRC;
    const land = WorldStateEngine.accounts([
      { id: 'geo-2', owner: 'GRC', population: 10_000_000, gdp: 100, militaryPower: 100,
        geojson: '{"properties":{"surface_type":"Land"}}' },
    ]).GRC;
    expect(withGeo.ports).toBeGreaterThan(land.ports);
    expect(land.ports).toBe(0);
  });
});
