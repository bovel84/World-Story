/**
 * COUNTRY-CLARITY ENGINE — scheda Forze armate (read model).
 *
 * Il read model non calcola più nessuna regola militare: epoca, uomini,
 * dotazioni, copertura e prontezza arrivano dal motore. Questi test verificano
 * che li **legga e li formatti senza alterarli**, che dichiari ciò che manca e
 * che non reintroduca di nascosto le regole spostate nel motore (filtro navale
 * per i paesi senza porti, categorie anacronistiche, consegne stimate).
 */
import { describe, it, expect } from 'vitest';
import {
  establishmentRows, equipmentCoverage, manpowerPayload, militaryOperatingPicture,
  orderRatePerMonth, procurementRows, projectedDeliveredUnits, readinessPicture,
} from './militaryOperatingPicture';
import type {
  ArsenalResponse, EquipmentCoveragePayload, EstablishmentCategoryPayload,
  MilitaryManpowerPayload, MilitaryReadinessPayload, ProductionOrder,
} from '../../services/api';

/** Uomini come li pubblica il motore per una nazione moderna. */
function manpowerPayloadFixture(overrides: Partial<MilitaryManpowerPayload> = {}): MilitaryManpowerPayload {
  return {
    population: 59_000_000,
    eligiblePopulation: 8_260_000,
    totalMilitaryPool: 8_260_000,
    activePersonnel: 72_000,
    reservePersonnel: 64_800,
    mobilizedPersonnel: 0,
    availableReserve: 64_800,
    formations: 6,
    mobilizedFormations: 0,
    menPerFormation: 12_000,
    mobilizationCap: 4_130_000,
    mobilizationHeadroom: 4_130_000,
    overMobilized: false,
    ...overrides,
  };
}

function coverageRow(overrides: Partial<EquipmentCoveragePayload> = {}): EquipmentCoveragePayload {
  return { category: 'individualWeapons', label: 'Armi individuali', required: 54_000, available: 54_000, coveragePct: 100, missing: 0, items: ['Fucili d’assalto ×54000'], weight: 0.3, ...overrides };
}

const ESTABLISHMENT: EstablishmentCategoryPayload[] = [
  {
    category: 'individualWeapons', label: 'Armi individuali',
    // Le armi individuali non si contano per reparto: sono una quota degli uomini.
    perFormation: null, perMobilized: null, personnelSharePct: 75, demand: 'personnel_share',
    weight: 0.3, source: 'engine_seed', basis: 'Il singolo soldato è la base di ogni reparto appiedato.',
  },
  { category: 'armoredMobility', label: 'Mobilità corazzata', perFormation: 1.5, perMobilized: 1.5, personnelSharePct: null, demand: 'per_formation', weight: 0.2, source: 'doctrine', basis: 'Trasporto protetto e manovra.' },
];

const READINESS: MilitaryReadinessPayload = {
  readinessPct: 76,
  status: 'stable',
  drivers: [
    { tone: 'warning', label: 'Copertura artiglieria 0%', detail: '0 in servizio su 3 della dotazione di riferimento.' },
    { tone: 'positive', label: 'Carburante: >12 mesi', detail: 'Copertura piena delle operazioni.' },
  ],
};

function arsenal(overrides: Partial<ArsenalResponse> = {}): Partial<ArsenalResponse> {
  return {
    epoch: 'moderno',
    epochLabel: 'Era moderna',
    establishment: ESTABLISHMENT,
    manpower: manpowerPayloadFixture(),
    coverage: [coverageRow(), coverageRow({ category: 'armoredMobility', label: 'Mobilità corazzata', required: 9, available: 9, coveragePct: 100, missing: 0, items: ['Veicoli corazzati ×9'], weight: 0.2 })],
    readiness: READINESS,
    catalog: [],
    units: {},
    qualityIndex: 60,
    combatFactor: 1.1,
    effectiveMilitaryPower: 4200,
    baseMilitaryPower: 3800,
    ...overrides,
  };
}

const ORDER: ProductionOrder = {
  id: 'o1', equipmentId: 'carri_3', name: 'Carri di 3ª generazione', domain: 'terra', quantity: 12,
  progress: 0, spentMln: 0, startedTurn: 1, startedDate: '2026-01-01', expectedDate: '2026-02-01',
  status: 'in_progress', note: '', qualityLoss: 0, updatedDate: '2026-01-15',
} as unknown as ProductionOrder;

const CATALOG = [
  { id: 'carri_3', name: 'Carri di 3ª generazione', domain: 'terra', category: 'Corazzati', quality: 62, tier: 'moderno', costMln: 8000, weaponsCost: 26, role: '', description: '', specs: [], canBuild: true, canBuy: true, buildCostMln: 8000, buyCostMln: 12800, reasons: [] },
  { id: 'caccia_5', name: 'Caccia di 5ª generazione', domain: 'aria', category: 'Aerei', quality: 80, tier: 'avanzato', costMln: 12000, weaponsCost: 30, role: '', description: '', specs: [], canBuild: false, canBuy: true, buildCostMln: null, buyCostMln: 24000, reasons: ['Tecnologia non disponibile'] },
] as unknown as ArsenalResponse['catalog'];

describe('COUNTRY-CLARITY ENGINE · forze armate', () => {
  it('legge il manpower del motore senza inventare uomini', () => {
    const payload = manpowerPayload(arsenal());
    expect(payload).toMatchObject({
      active: 6, mobilized: 0, standing: 6,
      activePersonnel: 72_000, reservePersonnel: 64_800, mobilizedPersonnel: 0,
      availableReserve: 64_800, menPerFormation: 12_000, mobilizedPct: 0,
    });
    // Quota della popolazione in età utile: aritmetica fra due numeri del motore.
    expect(payload?.eligibleSharePct).toBeCloseTo(14, 1);
  });

  it('i richiamati sono dentro la riserva e contano nella quota', () => {
    const payload = manpowerPayload(arsenal({
      manpower: manpowerPayloadFixture({ mobilizedFormations: 2, mobilizedPersonnel: 24_000, reservePersonnel: 96_000, availableReserve: 72_000 }),
    }));
    expect(payload?.standing).toBe(8);
    expect(payload?.mobilizedPct).toBeCloseTo(25, 1);
    expect(payload?.availableReserve).toBe(72_000);
  });

  it('senza manpower pubblicato il dato è assente, non zero', () => {
    expect(manpowerPayload({})).toBeNull();
    expect(manpowerPayload(null)).toBeNull();
    expect(manpowerPayload(arsenal({ manpower: undefined }))).toBeNull();
  });

  it('la copertura è quella del motore, con la motivazione dell’epoca', () => {
    const coverage = equipmentCoverage(arsenal());
    expect(coverage).toHaveLength(2);
    const armor = coverage.find(row => row.id === 'armoredMobility')!;
    expect(armor).toMatchObject({ required: 9, actual: 9, missing: 0, pct: 100, tone: 'positive' });
    expect(armor.basis).toBe('Trasporto protetto e manovra.');
    const individual = coverage.find(row => row.id === 'individualWeapons')!;
    expect(individual.items[0]).toContain('Fucili');
  });

  it('la copertura debole è segnalata senza toccare i numeri', () => {
    const coverage = equipmentCoverage(arsenal({
      coverage: [coverageRow({ required: 340, available: 240, coveragePct: 70.6, missing: 100 })],
    }));
    expect(coverage[0]).toMatchObject({ required: 340, actual: 240, missing: 100, pct: 70.6, tone: 'warning' });
  });

  it('nessuna categoria viene aggiunta o tolta dal read model', () => {
    // Il filtro per i paesi senza porti è del motore: qui si verifica che il
    // read model non reintroduca la regola (e non tolga righe legittime).
    const landlocked = equipmentCoverage(arsenal({
      coverage: [coverageRow(), coverageRow({ category: 'armoredMobility', label: 'Mobilità corazzata' })],
    }));
    expect(landlocked.map(row => row.id)).toEqual(['individualWeapons', 'armoredMobility']);
    // Un'epoca senza corazzati ha una sola categoria: resta una.
    const ancient = equipmentCoverage(arsenal({
      epoch: 'pre_industriale',
      establishment: [ESTABLISHMENT[0]],
      coverage: [coverageRow()],
    }));
    expect(ancient).toHaveLength(1);
    expect(equipmentCoverage({})).toEqual([]);
  });

  it('la prontezza è quella del motore, driver compresi', () => {
    const readiness = readinessPicture(arsenal())!;
    expect(readiness.readinessPct).toBe(76);
    expect(readiness.status).toBe('stable');
    expect(readiness.drivers[0]).toMatchObject({ tone: 'warning', label: 'Copertura artiglieria 0%' });
    expect(readinessPicture({})).toBeNull();
  });

  it('le dotazioni di riferimento conservano origine e motivo', () => {
    const rows = establishmentRows(arsenal());
    expect(rows[0]).toMatchObject({
      id: 'individualWeapons',
      perFormation: null,
      personnelSharePct: 75,
      demand: 'personnel_share',
      source: 'engine_seed',
    });
    expect(rows[1].source).toBe('doctrine');
    expect(rows[1].demand).toBe('per_formation');
    expect(rows[1].perFormation).toBe(1.5);
    expect(rows[0].basis).toContain('reparto appiedato');
  });

  it('il tetto di richiamo è un dato del motore, non una formula della UI', () => {
    const payload = manpowerPayload(arsenal({
      manpower: manpowerPayloadFixture({ mobilizationCap: 4_130_000, mobilizationHeadroom: 1_130_000, overMobilized: true }),
    }))!;
    expect(payload.mobilizationCap).toBe(4_130_000);
    expect(payload.mobilizationHeadroom).toBe(1_130_000);
    expect(payload.overMobilized).toBe(true);
    // Senza il dato pubblicato il read model non inventa un tetto.
    expect(manpowerPayload(arsenal({ manpower: manpowerPayloadFixture({ mobilizationCap: undefined as unknown as number }) }))!.mobilizationCap).toBe(0);
    expect(manpowerPayload(arsenal({ manpower: manpowerPayloadFixture({ overMobilized: undefined as unknown as boolean }) }))!.overMobilized).toBe(false);
  });

  it('produzione in casa contro acquisto: ordini, ritmo e motivi del motore', () => {
    const rows = procurementRows(arsenal({ catalog: CATALOG, units: { caccia_5: 5 }, production: { orders: [ORDER], inProgress: 1 } }));
    const fighter = rows.find(row => row.id === 'caccia_5')!;
    const tank = rows.find(row => row.id === 'carri_3')!;
    expect(rows[0].id).toBe('caccia_5'); // in servizio: prima di tutto
    expect(fighter.available).toBe(5);
    expect(fighter.canBuild).toBe(false);
    expect(fighter.canBuy).toBe(true);
    expect(fighter.domestic).toBe(false);
    expect(fighter.imported).toBeNull(); // il motore non traccia le importazioni
    expect(tank.inProduction).toBe(12);
    expect(tank.domestic).toBe(true);
    expect(tank.productionPerMonth).toBeCloseTo(11.6, 1);
    expect(tank.reasons).toEqual([]);
    expect(orderRatePerMonth(ORDER)).toBeCloseTo(11.6, 1);
    expect(orderRatePerMonth({ ...ORDER, expectedDate: null })).toBeNull();
  });

  it('le unità consegnate seguono la formula del motore, non il progresso', () => {
    // Il motore consegna a lavori finiti: al 50% di avanzamento ha consegnato 0.
    expect(projectedDeliveredUnits({ ...ORDER, progress: 50 })).toBe(12);
    expect(projectedDeliveredUnits({ ...ORDER, qualityLoss: 25 })).toBe(9);
    expect(projectedDeliveredUnits({ ...ORDER, qualityLoss: 100 })).toBe(0);
  });

  it('quadro completo: uomini, prontezza, scorte e sistemi in casa', () => {
    const picture = militaryOperatingPicture({
      resources: { weapons: 200, fuel: 4, needs: { weapons: 4, fuel: 2 } as never },
      arsenal: arsenal({ catalog: CATALOG }),
    });
    expect(picture.manpower?.standing).toBe(6);
    expect(picture.epoch).toBe('moderno');
    expect(picture.epochLabel).toBe('Era moderna');
    expect(picture.headline).toContain('72.000 uomini in armi');
    expect(picture.headline).toContain('sistemi prodotti in casa');
    expect(picture.qualityIndex).toBe(60);
    expect(picture.combatFactor).toBe(1.1);
    expect(picture.stock.find(row => row.id === 'weapons')?.tone).toBe('positive');
    expect(picture.stock.find(row => row.id === 'fuel')?.tone).toBe('warning');
    expect(picture.stock.find(row => row.id === 'fuel')?.text).toBe('2,0 mesi');
    expect(picture.drivers.some(driver => driver.label.startsWith('72.000 uomini sotto le armi'))).toBe(true);
    expect(picture.drivers.some(driver => /^Prontezza operativa/.test(driver.label))).toBe(true);
    expect(picture.status).toBe('stable'); // la prontezza del motore comanda
    // Una scorta critica abbassa un dominio che il motore dà per sano.
    const dry = militaryOperatingPicture({
      resources: { weapons: 0, fuel: 0, needs: { weapons: 4, fuel: 2 } as never },
      arsenal: arsenal({ readiness: { readinessPct: 88, status: 'healthy', drivers: [] } }),
    });
    expect(dry.stock.every(row => row.tone === 'critical')).toBe(true);
    expect(dry.status).toBe('pressure');
  });

  it('i richiamati compaiono fra i driver', () => {
    const picture = militaryOperatingPicture({
      arsenal: arsenal({ manpower: manpowerPayloadFixture({ mobilizedFormations: 3, mobilizedPersonnel: 36_000, reservePersonnel: 108_000, availableReserve: 72_000 }) }),
    });
    expect(picture.drivers.some(driver => driver.label.includes('richiamati alle armi'))).toBe(true);
  });

  it('dati mancanti: il quadro lo dichiara invece di inventare numeri', () => {
    const picture = militaryOperatingPicture({});
    expect(picture.manpower).toBeNull();
    expect(picture.readiness).toBeNull();
    expect(picture.epoch).toBeNull();
    expect(picture.coverage).toEqual([]);
    expect(picture.headline).not.toContain('uomini in armi');
    expect(picture.drivers.some(driver => driver.label === 'Forze non pubblicate dal motore')).toBe(true);
    expect(picture.stock.every(row => row.stock === null && row.text === 'dato non disponibile')).toBe(true);
    expect(picture.procurement).toEqual([]);
    expect(picture.status).toBe('stable');
  });

  it('scenario storico: reparti a piedi, nessuna categoria moderna inventata', () => {
    const picture = militaryOperatingPicture({
      arsenal: {
        epoch: 'pre_industriale',
        epochLabel: 'Eserciti pre-industriali',
        establishment: [ESTABLISHMENT[0]],
        manpower: manpowerPayloadFixture({ formations: 20, mobilizedFormations: 80, activePersonnel: 16_000, mobilizedPersonnel: 64_000, reservePersonnel: 64_000, availableReserve: 0, menPerFormation: 800 }),
        coverage: [coverageRow({ required: 4800, available: 800, coveragePct: 16.7, missing: 4000 })],
        readiness: { readinessPct: 12, status: 'critical', drivers: [{ tone: 'critical', label: 'Copertura armi individuali 16,7%' }] },
        qualityIndex: 22,
        catalog: [],
      },
    });
    const individual = picture.coverage.find(row => row.id === 'individualWeapons')!;
    expect(individual.required).toBe(4800);
    expect(individual.pct).toBe(16.7);
    expect(picture.coverage).toHaveLength(1); // l'epoca ha una sola categoria
    expect(picture.readiness?.readinessPct).toBe(12);
    expect(picture.status).toBe('critical');
    expect(picture.procurement).toEqual([]);
  });
});
