/**
 * MilitaryDoctrine — epoca, uomini, dotazioni, prontezza, seed.
 *
 * Verifica le regole strutturali che prima vivevano solo nella UI (o non
 * esistevano): l'epoca decide cosa si chiede a una nazione, il manpower parte
 * dai **reparti reali** del motore e i numeri restano coerenti per costruzione.
 */
import { describe, it, expect } from 'vitest';
import {
  ESTABLISHMENT_BY_EPOCH, MANPOWER_PROFILES, MOBILITY_EQUIPMENT_ID, OPERATION_MONTHS,
  RIFLES_PER_FORMATION, RIFLES_PER_MOBILIZED_FORMATION,
  arsenalSeedUnits, epochForDate, equipmentCoverage, establishmentFor, militaryManpower,
  militaryReadiness, readinessStatusFor, untrainedPool, type MilitaryEpoch,
} from '../src/core/simulation/MilitaryDoctrine';

const epochs: MilitaryEpoch[] = ['pre_industriale', 'grande_guerra', 'seconda_guerra', 'guerra_fredda', 'moderno'];

describe('epoca militare', () => {
  it('riconosce le epoche dalle date di scenario', () => {
    expect(epochForDate('1815-06-18')).toBe('pre_industriale');
    expect(epochForDate('1860-12-31')).toBe('pre_industriale');
    expect(epochForDate('1861-03-17')).toBe('grande_guerra');
    expect(epochForDate('1914-07-28')).toBe('grande_guerra');
    expect(epochForDate('1936-05-09')).toBe('seconda_guerra');
    expect(epochForDate('1945-09-02')).toBe('seconda_guerra');
    expect(epochForDate('1951-01-01')).toBe('guerra_fredda');
    expect(epochForDate('1989-11-09')).toBe('guerra_fredda');
    expect(epochForDate('1990-01-01')).toBe('moderno');
    expect(epochForDate('2026-04-10')).toBe('moderno');
  });

  it('senza data valida ricade sulla guerra fredda (data di partenza del gioco)', () => {
    expect(epochForDate(null)).toBe('guerra_fredda');
    expect(epochForDate('')).toBe('guerra_fredda');
    expect(epochForDate('boh')).toBe('guerra_fredda');
  });

  it('la stessa data dà sempre la stessa epoca (funzione pura)', () => {
    for (const date of ['1815-06-18', '1914-07-28', '1936-05-09', '1951-01-01', '2026-04-10']) {
      expect(epochForDate(date)).toBe(epochForDate(date));
    }
  });
});

describe('manpower', () => {
  const input = { population: 50_000_000, formations: 6, mobilizedFormations: 0, epoch: 'moderno' as MilitaryEpoch };

  it('conta gli uomini dai reparti reali del motore', () => {
    const manpower = militaryManpower(input);
    expect(manpower.formations).toBe(6);
    expect(manpower.menPerFormation).toBe(MANPOWER_PROFILES.moderno.menPerFormation);
    expect(manpower.activePersonnel).toBe(6 * MANPOWER_PROFILES.moderno.menPerFormation);
    expect(manpower.eligiblePopulation).toBe(Math.round(50_000_000 * 0.14));
    expect(manpower.totalMilitaryPool).toBe(manpower.eligiblePopulation);
  });

  it('mantiene le invarianti anche con numeri estremi', () => {
    for (const epoch of epochs) {
      for (const [formations, mobilized] of [[0, 0], [1, 0], [24, 12], [200, 500]]) {
        for (const population of [0, 1_000, 50_000_000]) {
          const manpower = militaryManpower({ population, formations, mobilizedFormations: mobilized, epoch });
          expect(manpower.activePersonnel + manpower.reservePersonnel)
            .toBeLessThanOrEqual(Math.max(manpower.activePersonnel, manpower.totalMilitaryPool));
          expect(manpower.reservePersonnel).toBeGreaterThanOrEqual(manpower.mobilizedPersonnel);
          expect(manpower.availableReserve).toBeGreaterThanOrEqual(0);
          expect(manpower.availableReserve + manpower.mobilizedPersonnel).toBe(manpower.reservePersonnel);
          expect(untrainedPool(manpower)).toBeGreaterThanOrEqual(0);
        }
      }
    }
  });

  it('la riserva non è mai negativa né doppia i richiamati', () => {
    const manpower = militaryManpower({ population: 2_000_000, formations: 4, mobilizedFormations: 3, epoch: 'moderno' });
    expect(manpower.mobilizedPersonnel).toBe(3 * MANPOWER_PROFILES.moderno.menPerFormation);
    expect(manpower.reservePersonnel).toBeGreaterThanOrEqual(manpower.mobilizedPersonnel);
    expect(manpower.availableReserve).toBeLessThanOrEqual(manpower.reservePersonnel);
  });

  it('una popolazione piccola limita la riserva invece di creare uomini dal nulla', () => {
    const manpower = militaryManpower({ population: 100_000, formations: 4, mobilizedFormations: 0, epoch: 'moderno' });
    expect(manpower.activePersonnel).toBe(48_000);
    // Bacino 14.000: la riserva non può esistere, e i richiamati nemmeno.
    expect(manpower.totalMilitaryPool).toBe(14_000);
    expect(manpower.reservePersonnel).toBe(0);
    expect(manpower.availableReserve).toBe(0);
  });

  it('dati mancanti o negativi non producono uomini', () => {
    const manpower = militaryManpower({ population: -5, formations: -1, mobilizedFormations: -3, epoch: 'moderno' });
    expect(manpower.activePersonnel).toBe(0);
    expect(manpower.reservePersonnel).toBe(0);
    expect(manpower.mobilizedPersonnel).toBe(0);
  });
});

describe('establishment per epoca', () => {
  it('nessuna categoria anacronistica nelle epoche antiche', () => {
    const ancient = establishmentFor('pre_industriale').map(entry => entry.id);
    expect(ancient).toEqual(['individualWeapons']);
    expect(establishmentFor('grande_guerra').map(entry => entry.id)).not.toContain('armoredMobility');
    expect(establishmentFor('grande_guerra').map(entry => entry.id)).not.toContain('airSupport');
    expect(establishmentFor('seconda_guerra').map(entry => entry.id)).toContain('armoredMobility');
    expect(establishmentFor('guerra_fredda').map(entry => entry.id)).toContain('supportWeapons');
    expect(establishmentFor('moderno').map(entry => entry.id)).toContain('drones');
  });

  it('i pesi di ogni epoca sommano a uno', () => {
    for (const epoch of epochs) {
      const total = establishmentFor(epoch).reduce((sum, entry) => sum + entry.weight, 0);
      expect(Math.round(total * 100)).toBe(100);
    }
  });

  it('le armi individuali conservano le costanti del seed del motore', () => {
    for (const epoch of epochs) {
      const entry = ESTABLISHMENT_BY_EPOCH[epoch].find(item => item.id === 'individualWeapons')!;
      expect(entry.perFormation).toBe(RIFLES_PER_FORMATION);
      expect(entry.perMobilized).toBe(RIFLES_PER_MOBILIZED_FORMATION);
      expect(entry.source).toBe('engine_seed');
    }
  });

  it('solo le categorie navali richiedono il mare', () => {
    for (const epoch of epochs) {
      const naval = establishmentFor(epoch).filter(entry => entry.requiresPorts);
      for (const entry of naval) expect(entry.id).toBe('navalSupport');
    }
  });
});

describe('copertura', () => {
  const manpower = militaryManpower({ population: 50_000_000, formations: 6, mobilizedFormations: 0, epoch: 'moderno' });

  it('il fabbisogno nasce dagli uomini effettivi, non dal numero di reparti', () => {
    const coverage = equipmentCoverage({ units: {}, manpower, epoch: 'moderno', ports: 3 });
    const individual = coverage.find(row => row.category === 'individualWeapons')!;
    expect(individual.required).toBe(6 * RIFLES_PER_FORMATION);
    expect(individual.items).toEqual([]);
  });

  it('i richiamati alzano il fabbisogno di armi individuali', () => {
    const called = militaryManpower({ population: 50_000_000, formations: 6, mobilizedFormations: 2, epoch: 'moderno' });
    const coverage = equipmentCoverage({ units: {}, manpower: called, epoch: 'moderno', ports: 3 });
    const individual = coverage.find(row => row.category === 'individualWeapons')!;
    expect(individual.required).toBe(6 * RIFLES_PER_FORMATION + 2 * RIFLES_PER_MOBILIZED_FORMATION);
  });

  it('conta il possesso reale e calcola la copertura', () => {
    const coverage = equipmentCoverage({
      units: { fucili: 120, apc: 9 },
      manpower, epoch: 'moderno', ports: 3,
    });
    const individual = coverage.find(row => row.category === 'individualWeapons')!;
    expect(individual.available).toBe(120);
    expect(individual.coveragePct).toBe(50);
    expect(individual.missing).toBe(120);
    expect(individual.items).toEqual(['Fucili d’assalto ×120']);
    const armor = coverage.find(row => row.category === 'armoredMobility')!;
    expect(armor.available).toBe(9);
    expect(armor.coveragePct).toBe(100);
  });

  it('la copertura non supera il 100% nemmeno con arsenali enormi', () => {
    const coverage = equipmentCoverage({ units: { fucili: 10_000 }, manpower, epoch: 'moderno', ports: 3 });
    const individual = coverage.find(row => row.category === 'individualWeapons')!;
    expect(individual.coveragePct).toBe(100);
    expect(individual.missing).toBe(0);
  });

  it('un paese senza porti non ha requisiti navali (assenza ≠ zero)', () => {
    const landlocked = equipmentCoverage({ units: {}, manpower, epoch: 'moderno', ports: 0 });
    expect(landlocked.map(row => row.category)).not.toContain('navalSupport');
    // Dato assente: la categoria navale resta nel fabbisogno.
    const unknown = equipmentCoverage({ units: {}, manpower, epoch: 'moderno' });
    expect(unknown.map(row => row.category)).toContain('navalSupport');
    const absent = equipmentCoverage({ units: {}, manpower, epoch: 'moderno', ports: null });
    expect(absent.map(row => row.category)).toContain('navalSupport');
  });

  it('nessuna richiesta di carri armati in un mondo del 1815', () => {
    const ancient = militaryManpower({ population: 20_000_000, formations: 4, mobilizedFormations: 0, epoch: 'pre_industriale' });
    const coverage = equipmentCoverage({ units: { apc: 100 }, manpower: ancient, epoch: 'pre_industriale', ports: 2 });
    expect(coverage.map(row => row.category)).toEqual(['individualWeapons']);
    // I mezzi posseduti non entrano in nessuna riga: non sono pertinenti.
    expect(coverage[0].available).toBe(0);
  });

  it('a un reparto senza nulla corrisponde copertura zero, non un errore', () => {
    const coverage = equipmentCoverage({ units: {}, manpower, epoch: 'moderno', ports: 2 });
    expect(coverage.every(row => row.coveragePct === 0)).toBe(true);
    expect(coverage.every(row => row.missing === row.required)).toBe(true);
  });
});

describe('prontezza operativa', () => {
  const manpower = militaryManpower({ population: 50_000_000, formations: 6, mobilizedFormations: 0, epoch: 'moderno' });
  const full = equipmentCoverage({ units: { fucili: 1000, apc: 30 }, manpower, epoch: 'moderno', ports: 2 });

  it('senza dati di carburante e scorte non punisce (fattore neutro)', () => {
    const readiness = militaryReadiness({ coverage: full, manpower });
    expect(readiness.readinessPct).toBeGreaterThan(0);
    expect(readiness.drivers.some(driver => driver.label.startsWith('Carburante'))).toBe(false);
  });

  it('il carburante scarso abbassa la prontezza e lo dice', () => {
    const rich = militaryReadiness({ coverage: full, manpower, fuel: { stock: 60, need: 2 } });
    const poor = militaryReadiness({ coverage: full, manpower, fuel: { stock: 1, need: 2 } });
    expect(poor.readinessPct).toBeLessThan(rich.readinessPct);
    expect(poor.drivers.some(driver => driver.label.includes('Carburante'))).toBe(true);
    expect(poor.drivers.find(driver => driver.label.includes('Carburante'))!.tone).toBe('critical');
  });

  it('sotto i mesi di operazioni richiesti il carburante è un problema dichiarato', () => {
    const readiness = militaryReadiness({ coverage: full, manpower, fuel: { stock: OPERATION_MONTHS - 1, need: 1 } });
    const driver = readiness.drivers.find(item => item.label.startsWith('Carburante'))!;
    expect(driver.tone).toBe('warning');
  });

  it('la qualità dell’arsenale sposta la prontezza', () => {
    const low = militaryReadiness({ coverage: full, manpower, qualityIndex: 0 });
    const high = militaryReadiness({ coverage: full, manpower, qualityIndex: 100 });
    expect(high.readinessPct).toBeGreaterThan(low.readinessPct);
  });

  it('i richiamati consumano prontezza finché non sono in linea', () => {
    const called = militaryManpower({ population: 50_000_000, formations: 6, mobilizedFormations: 4, epoch: 'moderno' });
    const coverage = equipmentCoverage({ units: { fucili: 1000, apc: 30 }, manpower: called, epoch: 'moderno', ports: 2 });
    const readiness = militaryReadiness({ coverage, manpower: called });
    expect(readiness.drivers.some(driver => driver.label.includes('richiamati'))).toBe(true);
  });

  it('la copertura bassa è il primo driver critico', () => {
    const empty = equipmentCoverage({ units: {}, manpower, epoch: 'moderno', ports: 2 });
    const readiness = militaryReadiness({ coverage: empty, manpower });
    expect(readiness.status).toBe('critical');
    expect(readiness.drivers[0].label).toContain('Copertura');
  });

  it('le soglie di stato sono dichiarate', () => {
    expect(readinessStatusFor(100)).toBe('healthy');
    expect(readinessStatusFor(80)).toBe('healthy');
    expect(readinessStatusFor(65)).toBe('stable');
    expect(readinessStatusFor(64)).toBe('pressure');
    expect(readinessStatusFor(50)).toBe('pressure');
    expect(readinessStatusFor(49)).toBe('fragile');
    expect(readinessStatusFor(35)).toBe('fragile');
    expect(readinessStatusFor(34)).toBe('critical');
  });
});

describe('seed dell’arsenale', () => {
  it('usa le costanti della copertura', () => {
    expect(arsenalSeedUnits('moderno', 6, 2)).toEqual({
      fucili: 6 * RIFLES_PER_FORMATION + 2 * RIFLES_PER_MOBILIZED_FORMATION,
      [MOBILITY_EQUIPMENT_ID]: 9,
    });
  });

  it('non dota di corazzati un mondo che non li ha', () => {
    expect(arsenalSeedUnits('pre_industriale', 6, 2)).toEqual({
      fucili: 6 * RIFLES_PER_FORMATION + 2 * RIFLES_PER_MOBILIZED_FORMATION,
    });
    expect(arsenalSeedUnits('grande_guerra', 6, 0)).toEqual({ fucili: 240 });
  });

  it('senza reparti non semina nulla', () => {
    expect(arsenalSeedUnits('moderno', 0, 0)).toEqual({});
  });

  it('il seed copre esattamente il fabbisogno di armi individuali', () => {
    const manpower = militaryManpower({ population: 50_000_000, formations: 6, mobilizedFormations: 2, epoch: 'moderno' });
    const seed = arsenalSeedUnits('moderno', 6, 2);
    const coverage = equipmentCoverage({ units: seed, manpower, epoch: 'moderno', ports: 0 });
    expect(coverage.find(row => row.category === 'individualWeapons')!.coveragePct).toBe(100);
  });
});
