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
  arsenalSeedUnits, epochForDate, equipmentCoverage, establishmentFor,
  individualWeaponDemand, individualWeaponShareFor, militaryManpower,
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

  it('le armi individuali si misurano sul personale, non sul numero di reparti', () => {
    // P10: 72.000 uomini non possono essere armati da 240 fucili.
    const modern = militaryManpower({ population: 50_000_000, formations: 6, mobilizedFormations: 0, epoch: 'moderno' });
    const demand = individualWeaponDemand('moderno', modern.formations, modern.mobilizedFormations);
    expect(modern.activePersonnel).toBe(72_000);
    expect(demand).toBe(54_000);
    expect(demand).not.toBe(240);
    expect(demand).toBe(Math.round(72_000 * individualWeaponShareFor('moderno')));
    expect(individualWeaponShareFor('moderno')).toBeLessThan(1);
    expect(individualWeaponShareFor('seconda_guerra')).toBeGreaterThan(individualWeaponShareFor('moderno'));
    // Con 240 fucili la copertura è quasi nulla, non il 100%.
    const coverage = equipmentCoverage({ units: { fucili: 240 }, manpower: modern, epoch: 'moderno', ports: 0 });
    const individual = coverage.find(row => row.category === 'individualWeapons')!;
    expect(individual.required).toBe(54_000);
    expect(individual.available).toBe(240);
    expect(individual.coveragePct).toBe(0.4);
    expect(individual.missing).toBe(53_760);
    const readiness = militaryReadiness({ coverage, manpower: modern });
    expect(readiness.readinessPct).toBeLessThan(30);
    expect(readiness.drivers.some(driver => driver.label.includes('armi individuali'))).toBe(true);
    // Le voci di catalogo che non sono armi individuali restano per reparto.
    for (const epoch of epochs) {
      const entry = ESTABLISHMENT_BY_EPOCH[epoch].find(item => item.id === 'individualWeapons')!;
      expect(entry.demand?.kind).toBe('personnel_share');
      expect(entry.perFormation).toBeUndefined();
      const others = ESTABLISHMENT_BY_EPOCH[epoch].filter(item => item.id !== 'individualWeapons');
      for (const other of others) expect(other.demand?.kind ?? 'per_formation').toBe('per_formation');
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

  it('il fabbisogno di armi individuali nasce dagli uomini in armi', () => {
    const coverage = equipmentCoverage({ units: {}, manpower, epoch: 'moderno', ports: 3 });
    const individual = coverage.find(row => row.category === 'individualWeapons')!;
    expect(individual.required).toBe(individualWeaponDemand('moderno', 6, 0));
    expect(individual.required).toBe(54_000);
    expect(individual.items).toEqual([]);
  });

  it('i richiamati alzano il fabbisogno di armi individuali', () => {
    const called = militaryManpower({ population: 50_000_000, formations: 6, mobilizedFormations: 2, epoch: 'moderno' });
    const coverage = equipmentCoverage({ units: {}, manpower: called, epoch: 'moderno', ports: 3 });
    const individual = coverage.find(row => row.category === 'individualWeapons')!;
    expect(individual.required).toBe(individualWeaponDemand('moderno', 6, 2));
    expect(individual.required).toBeGreaterThan(individualWeaponDemand('moderno', 6, 0));
  });

  it('conta il possesso reale e calcola la copertura', () => {
    const coverage = equipmentCoverage({
      units: { fucili: 27_000, apc: 9 },
      manpower, epoch: 'moderno', ports: 3,
    });
    const individual = coverage.find(row => row.category === 'individualWeapons')!;
    expect(individual.available).toBe(27_000);
    expect(individual.coveragePct).toBe(50);
    expect(individual.missing).toBe(27_000);
    expect(individual.items).toEqual(['Fucili d’assalto ×27000']);
    const armor = coverage.find(row => row.category === 'armoredMobility')!;
    expect(armor.available).toBe(9);
    expect(armor.coveragePct).toBe(100);
  });

  it('la copertura non supera il 100% nemmeno con arsenali enormi', () => {
    const coverage = equipmentCoverage({ units: { fucili: 200_000 }, manpower, epoch: 'moderno', ports: 3 });
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
  const full = equipmentCoverage({ units: { fucili: 54_000, apc: 30 }, manpower, epoch: 'moderno', ports: 2 });

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
    const coverage = equipmentCoverage({ units: { fucili: 90_000, apc: 30 }, manpower: called, epoch: 'moderno', ports: 2 });
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
  it('usa la stessa regola della copertura (P11: seed completo → 100%)', () => {
    expect(arsenalSeedUnits('moderno', 6, 2)).toEqual({
      fucili: individualWeaponDemand('moderno', 6, 2),
      [MOBILITY_EQUIPMENT_ID]: 9,
    });
    for (const epoch of epochs) {
      const formations = 6;
      const mobilized = 2;
      expect(arsenalSeedUnits(epoch, formations, mobilized).fucili)
        .toBe(individualWeaponDemand(epoch, formations, mobilized));
    }
  });

  it('non dota di corazzati un mondo che non li ha', () => {
    expect(arsenalSeedUnits('pre_industriale', 6, 2)).toEqual({
      fucili: individualWeaponDemand('pre_industriale', 6, 2),
    });
    expect(arsenalSeedUnits('grande_guerra', 6, 0)).toEqual({ fucili: 43_200 });
  });

  it('senza reparti non semina nulla', () => {
    expect(arsenalSeedUnits('moderno', 0, 0)).toEqual({});
  });

  it('il seed copre esattamente il fabbisogno di armi individuali', () => {
    const manpower = militaryManpower({ population: 50_000_000, formations: 6, mobilizedFormations: 2, epoch: 'moderno' });
    const seed = arsenalSeedUnits('moderno', 6, 2);
    const coverage = equipmentCoverage({ units: seed, manpower, epoch: 'moderno', ports: 0 });
    expect(coverage.find(row => row.category === 'individualWeapons')!.coveragePct).toBe(100);
    // Senza trucchi: il seed è il fabbisogno, non un numero «comodo».
    expect(seed.fucili).toBe(coverage.find(row => row.category === 'individualWeapons')!.required);
  });
});

describe('non regressione storica (P16)', () => {
  it('1815 e 1914 non chiedono nulla che non esista ancora', () => {
    const napoleon = militaryManpower({ population: 20_000_000, formations: 5, mobilizedFormations: 1, epoch: 'pre_industriale' });
    const ancient = equipmentCoverage({ units: { carri_4: 10, caccia_5: 2 }, manpower: napoleon, epoch: 'pre_industriale', ports: 2 });
    expect(ancient.map(row => row.category)).toEqual(['individualWeapons']);
    const ww1 = establishmentFor('grande_guerra').map(entry => entry.id);
    expect(ww1).not.toContain('armoredMobility');
    expect(ww1).not.toContain('airSupport');
    expect(ww1).not.toContain('missiles');
    expect(ww1).not.toContain('drones');
    expect(arsenalSeedUnits('pre_industriale', 5, 1)).toEqual({ fucili: individualWeaponDemand('pre_industriale', 5, 1) });
  });

  it('un paese senza porti non ha requisiti navali in nessuna epoca', () => {
    for (const epoch of epochs) {
      const manpower = militaryManpower({ population: 30_000_000, formations: 3, mobilizedFormations: 1, epoch });
      const coverage = equipmentCoverage({ units: {}, manpower, epoch, ports: 0 });
      expect(coverage.map(row => row.category)).not.toContain('navalSupport');
      const withSea = equipmentCoverage({ units: {}, manpower, epoch, ports: 4 });
      if (establishmentFor(epoch).some(entry => entry.requiresPorts)) {
        expect(withSea.map(row => row.category)).toContain('navalSupport');
      }
    }
  });
});

describe('manpower su tutte le epoche (P15)', () => {
  it('regge popolazioni piccole e grandi, mobilitazione zero e alta', () => {
    for (const epoch of epochs) {
      const profile = MANPOWER_PROFILES[epoch];
      for (const population of [0, 900_000, 60_000_000]) {
        for (const [formations, mobilized] of [[0, 0], [2, 0], [8, 4], [30, 40]]) {
          const manpower = militaryManpower({ population, formations, mobilizedFormations: mobilized, epoch });
          expect(manpower.activePersonnel).toBe(formations * profile.menPerFormation);
          expect(manpower.mobilizationCap).toBe(Math.round(manpower.totalMilitaryPool * profile.maxMobilizedShare));
          expect(manpower.mobilizationHeadroom).toBeGreaterThanOrEqual(0);
          expect(manpower.availableReserve + manpower.mobilizedPersonnel).toBe(manpower.reservePersonnel);
          expect(manpower.overMobilized).toBe(Math.round(mobilized * profile.menPerFormation) > manpower.mobilizationCap);
        }
      }
    }
  });

  it('il tetto di richiamo non è una costante morta: limita la testa disponibile', () => {
    // 60 milioni, guerra fredda: bacino 10.200.000, tetto 70% → 7.140.000.
    const manpower = militaryManpower({ population: 60_000_000, formations: 10, mobilizedFormations: 0, epoch: 'guerra_fredda' });
    expect(manpower.totalMilitaryPool).toBe(Math.round(60_000_000 * 0.17));
    expect(manpower.mobilizationCap).toBe(Math.round(manpower.totalMilitaryPool * 0.7));
    expect(manpower.mobilizationHeadroom).toBe(manpower.mobilizationCap);
    expect(manpower.overMobilized).toBe(false);
    // Con l’intero bacino sotto le armi il tetto viene superato e si dichiara.
    const over = militaryManpower({ population: 60_000_000, formations: 10, mobilizedFormations: 2_000, epoch: 'guerra_fredda' });
    expect(over.overMobilized).toBe(true);
    expect(over.mobilizedPersonnel).toBeGreaterThan(over.mobilizationCap);
    // Il fatto canonico non viene cancellato: i richiamati restano quelli.
    expect(over.mobilizedFormations).toBe(2_000);
    expect(over.mobilizedPersonnel).toBe(Math.max(0, over.totalMilitaryPool - over.activePersonnel));
  });

  it('l’over-mobilization è un driver critico della prontezza', () => {
    const over = militaryManpower({ population: 60_000_000, formations: 10, mobilizedFormations: 2_000, epoch: 'guerra_fredda' });
    const coverage = equipmentCoverage({ units: { fucili: 8_000_000 }, manpower: over, epoch: 'guerra_fredda', ports: 0 });
    const readiness = militaryReadiness({ coverage, manpower: over });
    const driver = readiness.drivers.find(item => item.label.includes('tetto d’epoca'))!;
    expect(driver).toBeTruthy();
    expect(driver.tone).toBe('critical');
  });
});
