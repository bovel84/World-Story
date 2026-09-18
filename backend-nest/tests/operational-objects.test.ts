/**
 * OP-OBJECTS — oggetti operativi concreti
 * ======================================
 * Test dei requisiti obbligatori:
 *  - **esercito**: creare un reparto consuma manpower, alza il fabbisogno di
 *    equipaggiamento, alza il consumo di risorse e il costo mensile;
 *  - **fabbrica**: input insufficiente ⇒ output ridotto; impianto fermo ⇒
 *    output zero; industria satura ⇒ produzione rallentata;
 *  - **costruzione**: consuma capacità e materiali ma **non produce beneficio
 *    prima del completamento**;
 *  - **navi**: nessuna nave prima del completamento; nave operativa ⇒ consumo e
 *    costo; manutenzione ⇒ nave non pienamente operativa;
 *  - **catene**: input giù ⇒ produzione giù ⇒ output giù.
 */
import { describe, it, expect } from 'vitest';
import {
  CATEGORY_EQUIPMENT, STAFF_PER_LINE, STAFF_PER_MINE_POINT, endowmentContribution, formationImpact, formationPlan,
  marginalProduction, navalInventory, navalShips, operatingPicture, plantAllocatedLines, plantOrders, shortTitle,
  type IndustrialOrderLike, type OperationalInput, type OperationalRegion, type OperatingObject,
} from '../src/core/simulation/OperationalObjects';
import {
  industrialCapacityOf, militaryOrderAllocation, projectAllocation,
} from '../src/core/simulation/IndustrialCapacity';
import { materialNeeds, type ResourceStock } from '../src/core/simulation/MaterialEconomy';
import { arsenalSeedUnits, equipmentCoverage, militaryManpower, militaryReadiness } from '../src/core/simulation/MilitaryDoctrine';
import { WorldStateEngine, type NationalAccount, type WorldStateRegion } from '../src/core/simulation/WorldStateEngine';
import { equipmentStrength } from '../src/core/simulation/MilitaryIndustry';

const STOCK: ResourceStock = {
  money: 12, food: 40, clothing: 30, weapons: 200, fuel: 260, research: 0, technologies: [], debts: [],
};

const REGIONS: WorldStateRegion[] = [
  { id: 'w_ITA', owner: 'ITA', population: 47_000_000, gdp: 2400, militaryPower: 110, objects: [{ type: 'factory', level: 3 }] },
  { id: 'w_SAR', owner: 'ITA', population: 1_600_000, gdp: 60, militaryPower: 4, objects: [] },
];

const PLAYER_REGIONS: OperationalRegion[] = [
  { id: 'w_ITA', name: 'Italia', population: 47_000_000, coastal: true, objects: [] },
  { id: 'w_SAR', name: 'Sardegna', population: 1_600_000, coastal: true, objects: [] },
];

/** Mondo con uno schieramento ampio: i fabbisogni non finiscono nel pavimento. */
const BIG_REGIONS: WorldStateRegion[] = [
  { ...REGIONS[0], objects: [{ type: 'factory', level: 3 }, { type: 'army', level: 60 }] },
  REGIONS[1],
];

/** Conto nazionale del giocatore, dal motore, sul mondo di prova. */
function accounts(regions: WorldStateRegion[] = REGIONS): NationalAccount {
  return WorldStateEngine.accounts(regions, { modernFacts: false, startDate: '1951-01-01' }).ITA;
}

/** Quadro militare coerente: ufficiale, così i test partono dagli aggregati veri. */
function militaryContext(epoch: Parameters<typeof militaryManpower>[0]['epoch'] = 'guerra_fredda', units?: Record<string, number>) {
  const account = accounts();
  // Arsenale di partenza del motore: la nazione nasce armata al 100%.
  units ??= arsenalSeedUnits(epoch, account.forces, account.mobilized);
  const manpower = militaryManpower({
    population: account.population, formations: account.forces, mobilizedFormations: account.mobilized, epoch,
  });
  const needs = materialNeeds(account);
  const coverage = equipmentCoverage({ units, manpower, epoch, ports: account.ports });
  const readiness = militaryReadiness({
    coverage, fuel: { stock: STOCK.fuel, need: needs.fuel }, weapons: { stock: STOCK.weapons, need: needs.weapons },
    qualityIndex: 40, manpower,
  });
  return { account, manpower, needs, coverage, readiness, units, epoch };
}

function picture(overrides: Partial<OperationalInput> = {}) {
  const { account, manpower, needs, coverage, readiness, units, epoch } = militaryContext(
    overrides.epoch ?? 'guerra_fredda',
    overrides.units ?? arsenalSeedUnits(overrides.epoch ?? 'guerra_fredda', accounts().forces, 0),
  );
  const orders = overrides.orders ?? [
    { id: 'ord-1', equipmentId: 'carri_3', name: 'Carri armati di 3ª generazione', quantity: 48, progress: 63, status: 'in_progress' },
  ];
  const projects = overrides.projects ?? [{
    id: 'p1', title: 'Nuova acciaieria a Taranto', started_date: '1951-01-01', expected_date: '1952-03-01', progress: 54,
  }];
  const capacity = overrides.capacity ?? industrialCapacityOf({
    factories: account.factories, ports: account.ports, universities: account.universities,
    orders, projects, maintenance: [],
  });
  return operatingPicture({
    polityId: 'ITA',
    epoch,
    date: '1951-06-01',
    account,
    manpower,
    coverage,
    readiness,
    units,
    qualityIndex: 40,
    stock: STOCK,
    needs,
    balance: [],
    capacity,
    orders,
    projects,
    maintenance: [],
    regions: PLAYER_REGIONS,
    endowment: { iron: 5, coal: 4, oil: 2, fertile_land: 4 },
    technologies: [],
    ...overrides,
  });
}

const byKind = (objects: OperatingObject[], kind: OperatingObject['kind']) => objects.filter(object => object.kind === kind);
const factOf = (object: OperatingObject, label: string) => object.facts.find(item => item.label === label);

describe('OP-OBJECTS — esercito: creare un reparto (piano)', () => {
  it('chiede la dotazione dell\'epoca: armi individuali dalla quota degli uomini, mezzi per reparto', () => {
    const plan = formationPlan({ epoch: 'guerra_fredda', units: { fucili: 100_000, apc: 20 } });
    const rifles = plan.items.find(item => item.equipmentId === 'fucili')!;
    const apc = plan.items.find(item => item.equipmentId === 'apc')!;
    // guerra_fredda: 11.000 uomini per reparto, 80% con arma individuale.
    expect(plan.men).toBe(11_000);
    expect(rifles.required).toBe(8_800);
    expect(apc.required).toBe(2); // 1,5 per reparto, arrotondato in eccesso
  });

  it('non forma un reparto senza fucili e lo dice', () => {
    const plan = formationPlan({ epoch: 'guerra_fredda', units: { fucili: 400 } });
    expect(plan.blocked).toBe(true);
    expect(plan.blockedReason).toContain('Mancano');
    expect(plan.riflesAvailable).toBe(400);
    expect(plan.riflesRequired).toBe(8_800);
  });

  it('valorizza il materiale preso dal deposito al costo di catalogo', () => {
    const plan = formationPlan({ epoch: 'guerra_fredda', units: { fucili: 100_000, apc: 20, artiglieria: 5 } });
    // Il costo è la somma dei pezzi consumati al prezzo di catalogo.
    const expected = plan.items.reduce((total, item) => total + item.consumed * item.unitCostMln, 0);
    expect(plan.initialCostMln).toBe(Math.round(expected * 100) / 100);
    expect(plan.items.find(item => item.equipmentId === 'fucili')!.consumed).toBe(8_800);
    expect(plan.initialCostMln).toBeGreaterThan(8_800 * 4);
  });
});

describe('OP-OBJECTS — esercito: impatto PRIMA → DOPO', () => {
  it('consuma manpower, alza fabbisogno, consumi e costo mensile: tutti numeri del motore', () => {
    const account = accounts(BIG_REGIONS);
    const impact = formationImpact({
      epoch: 'guerra_fredda',
      account,
      units: arsenalSeedUnits('guerra_fredda', account.forces, account.mobilized),
      stock: STOCK,
      qualityIndex: 40,
      regions: BIG_REGIONS,
      options: { modernFacts: false, startDate: '1951-01-01' },
      targetRegionId: 'w_ITA',
      armyName: '1ª Armata',
    });
    // Manpower: gli uomini in armi crescono di un reparto.
    expect(impact.after.activePersonnel).toBe(impact.before.activePersonnel + 11_000);
    expect(impact.after.formations).toBe(impact.before.formations + 1);
    // Il fabbisogno di equipaggiamento cresce (copertura in calo).
    expect(impact.after.individualCoveragePct).toBeLessThan(impact.before.individualCoveragePct);
    // Consumo di risorse e costo mensile crescono.
    expect(impact.after.fuelNeed).toBeGreaterThan(impact.before.fuelNeed);
    expect(impact.after.weaponsNeed).toBeGreaterThan(impact.before.weaponsNeed);
    expect(impact.after.monthlyMilitaryMld).toBeGreaterThan(impact.before.monthlyMilitaryMld);
    expect(impact.after.monthlyExpenses).toBeGreaterThan(impact.before.monthlyExpenses);
    // Le righe PRIMA → DOPO sono già del motore.
    const rifles = impact.deltas.find(delta => delta.label === 'Copertura armi individuali')!;
    expect(rifles.after).toBe(impact.after.individualCoveragePct);
    expect(rifles.before).toBe(impact.before.individualCoveragePct);
    const expenses = impact.deltas.find(delta => delta.label === 'Spese dello Stato')!;
    expect(expenses.after).toBeGreaterThan(expenses.before);
    expect(impact.deltas.some(delta => delta.label === 'Saldo mensile')).toBe(true);
    // La quota di difesa pubblicata è arrotondata allo 0,1%: un reparto non la
    // muove, quindi non si mostra una riga che resterebbe ferma.
    expect(impact.deltas.some(delta => delta.label === 'Spesa militare')).toBe(false);
    expect(impact.why).toContain('Spese dello Stato');
  });

  it('conta il reparto in più solo nella provincia scelta, senza toccare le altre', () => {
    const before = accounts();
    const after = accounts([
      { ...REGIONS[0], objects: [...(REGIONS[0].objects || []), { type: 'army', level: 1 }] },
      REGIONS[1],
    ]);
    expect(after.forces).toBe(before.forces + 1);
    expect(after.defenceBurdenPct).toBeGreaterThan(before.defenceBurdenPct);
  });
});

describe('OP-OBJECTS — esercito: oggetti concreti', () => {
  it('le armate sommano esattamente i reparti del motore', () => {
    const result = picture();
    const armies = byKind(result.objects, 'army');
    const total = armies.reduce((value, army) => value + Number(factOf(army, 'Reparti')!.value), 0);
    const account = accounts();
    expect(armies.length).toBeGreaterThan(0);
    expect(total).toBe(Math.round(account.forces));
  });

  it('un\'armata reale sulla mappa prende il nome e la provincia del mondo', () => {
    const result = picture({
      regions: [{ ...PLAYER_REGIONS[0], objects: [{ id: 'army-1', type: 'army', name: '1ª Armata', level: 3 }] }, PLAYER_REGIONS[1]],
    });
    const named = byKind(result.objects, 'army').find(army => army.label === '1ª Armata')!;
    expect(named).toBeTruthy();
    expect(named.subtitle).toContain('Italia');
    expect(Number(factOf(named, 'Reparti')!.value)).toBe(3);
    // Il resto dei reparti resta nei reparti di guarnigione.
    expect(byKind(result.objects, 'army').some(army => army.label === 'Reparti di guarnigione')).toBe(true);
  });

  it('porta il problema delle armi mancanti sulla singola armata', () => {
    const result = picture({ units: { fucili: 2_000 } });
    const army = byKind(result.objects, 'army')[0];
    expect(army.problems.some(problem => /Mancano/.test(problem.label))).toBe(true);
    expect(army.status).toBe('critical');
  });
});

describe('OP-OBJECTS — fabbrica: produzione reale', () => {
  it('impianto fermo (nessuna linea) ⇒ output zero', () => {
    const account = accounts();
    const capacity = industrialCapacityOf({ factories: account.factories, ports: account.ports, universities: account.universities, orders: [], projects: [], maintenance: [] });
    const result = picture({ capacity, orders: [], projects: [] });
    const factory = byKind(result.objects, 'facility').find(object => object.label.startsWith('Acciaieria'))!;
    expect(factory.status).toBe('idle');
    expect(factOf(factory, 'Armamenti')!.value).toBe(0);
    expect(factOf(factory, 'Ritmo di lavoro')!.value).toBe(0);
    expect(factory.problems.some(problem => /Impianto fermo/.test(problem.label))).toBe(true);
  });

  it('industria satura ⇒ produzione rallentata per tutti gli impianti', () => {
    const account = accounts();
    const orders: IndustrialOrderLike[] = Array.from({ length: 12 }, (_, index) => ({
      id: `ord-${index}`, equipmentId: 'carri_3', name: 'Carri armati di 3ª generazione', quantity: 400, progress: 10, status: 'in_progress',
    }));
    const capacity = industrialCapacityOf({ factories: account.factories, ports: account.ports, universities: account.universities, orders, projects: [], maintenance: [] });
    expect(capacity.saturated).toBe(true);
    const result = picture({ capacity, orders, projects: [] });
    const factory = byKind(result.objects, 'facility').find(object => object.label.startsWith('Acciaieria'))!;
    const normal = picture();
    const normalFactory = byKind(normal.objects, 'facility').find(object => object.label.startsWith('Acciaieria'))!;
    const saturated = Number(factOf(factory, 'Armamenti')!.value);
    const reference = Number(factOf(normalFactory, 'Armamenti')!.value);
    expect(saturated).toBeLessThan(reference);
    expect(factOf(factory, 'Ritmo di lavoro')!.value).toBeLessThan(100);
    expect(factory.problems.some(problem => /satura/.test(problem.label))).toBe(true);
  });

  it('input insufficiente (nessun giacimento di ferro) ⇒ produzione più bassa', () => {
    const withIron = marginalProduction({ factories: 1 }, { iron: 5, coal: 5 });
    const withoutIron = marginalProduction({ factories: 1 }, {});
    expect(withIron.weapons).toBeGreaterThan(withoutIron.weapons);
    expect(endowmentContribution('iron')).toEqual({ weapons: 0.12 });
    expect(endowmentContribution('oil')).toEqual({ fuel: 0.7 });
  });

  it('senza capacità industriale la produzione è bloccata (output zero, fattore zero)', () => {
    const result = picture({
      account: { ...accounts(), factories: 0, ports: 0, universities: 0 },
      capacity: industrialCapacityOf({ factories: 0, ports: 0, universities: 0, orders: [{ id: 'o', equipmentId: 'apc', quantity: 10, status: 'in_progress' }] }),
      regions: [{ ...PLAYER_REGIONS[0], objects: [] }],
    });
    expect(result.objects.some(object => object.kind === 'facility')).toBe(false);
    const construction = byKind(result.objects, 'construction')[0];
    expect(construction.problems.some(problem => problem.severity === 'critical')).toBe(true);
  });

  it('attribuisce le linee occupate agli impianti in ordine, senza superare le linee dell\'impianto', () => {
    const allocation = militaryOrderAllocation({ id: 'o', equipmentId: 'carri_3', quantity: 48 });
    expect(plantAllocatedLines([allocation], 10, 0)).toBe(Math.min(10, allocation.capacityDemand));
    expect(plantAllocatedLines([allocation], 10, 40)).toBe(0);
  });
});

describe('OP-OBJECTS — costruzione: nessun beneficio prima del completamento', () => {
  it('occupa capacità e materiali ma non aumenta gli impianti del paese', () => {
    const withSite: WorldStateRegion[] = [
      { ...REGIONS[0], objects: [...(REGIONS[0].objects || []), { type: 'construction_site', level: 1 }] },
      REGIONS[1],
    ];
    const base = WorldStateEngine.accounts(REGIONS, { modernFacts: false, startDate: '1951-01-01' }).ITA;
    const building = WorldStateEngine.accounts(withSite, { modernFacts: false, startDate: '1951-01-01' }).ITA;
    // Il cantiere NON è una fabbrica: nessun beneficio prima del completamento.
    expect(building.factories).toBe(base.factories);
    expect(building.monthlyRevenue).toBe(base.monthlyRevenue);
    // Ma occupa linee di lavorazione.
    const allocation = projectAllocation({ id: 'p1', title: 'Nuova acciaieria', started_date: '1951-01-01', expected_date: '1952-03-01', progress: 54 });
    expect(allocation.capacityDemand).toBeGreaterThan(0);
  });

  it('l\'oggetto costruzione dichiara beneficio zero e il tempo residuo', () => {
    const result = picture();
    const construction = byKind(result.objects, 'construction')[0];
    expect(construction.status).toBe('under_construction');
    expect(Number(factOf(construction, 'Beneficio')!.value)).toBe(0);
    expect(factOf(construction, 'Beneficio')!.text).toMatch(/Nessuno prima del completamento/);
    expect(Number(factOf(construction, 'Linee occupate dai lavori')!.value)).toBeGreaterThan(0);
    expect(Number(factOf(construction, 'Mesi al completamento')!.value)).toBeGreaterThan(0);
  });

  it('un cantiere senza capacità industriale è un problema critico', () => {
    const result = picture({
      account: { ...accounts(), factories: 0, ports: 0, universities: 0 },
      capacity: industrialCapacityOf({ factories: 0, ports: 0, universities: 0, projects: [{ id: 'p1', title: 'Opera', started_date: '1951-01-01', expected_date: '1952-01-01', progress: 20 }] }),
    });
    const construction = byKind(result.objects, 'construction')[0];
    expect(construction.problems[0].severity).toBe('critical');
  });
});

describe('OP-OBJECTS — navi: prima del completamento non esistono', () => {
  it('le navi sono solo quelle consegnate all\'arsenale; gli scafi in costruzione restano separati', () => {
    const orders: IndustrialOrderLike[] = [
      { id: 'ord-fr', equipmentId: 'fregate', name: 'Fregate multiruolo', quantity: 2, progress: 40, status: 'in_progress' },
    ];
    const result = picture({ units: { fregate: 1, antinave: 12 }, orders, projects: [] });
    const navy = byKind(result.objects, 'navy')[0];
    expect(Number(factOf(navy, 'Navi in servizio')!.value)).toBe(1);
    expect(Number(factOf(navy, 'In costruzione')!.value)).toBe(2);
    // Nessuna fregata in più compare fra gli scafi in servizio.
    expect(navalShips({ fregate: 1 })).toBe(1);
    expect(byKind(result.objects, 'ship').length).toBe(1);
  });

  it('una nave operativa consuma carburante e costa', () => {
    const result = picture({ units: { cacciatorpediniere: 2, antinave: 16 }, orders: [], projects: [] });
    const ship = byKind(result.objects, 'ship')[0];
    expect(ship.status).toBe('operational');
    expect(Number(factOf(ship, 'Equipaggio')!.value)).toBe(320);
    expect(Number(factOf(ship, 'Carburante')!.value)).toBeGreaterThan(0);
    expect(Number(factOf(ship, 'Costo operativo')!.value)).toBeGreaterThan(0);
    expect(Number(factOf(ship, 'Armamento — missili')!.value)).toBeGreaterThan(0);
  });

  it('la manutenzione rende la nave non pienamente operativa', () => {
    const account = accounts();
    const capacity = industrialCapacityOf({
      factories: account.factories, ports: account.ports, universities: account.universities,
      maintenance: [{ facilityId: 'fac-1', typeName: 'Bacino di carenaggio', baseUnits: 40, periodDays: 180, operational: true }],
    });
    expect(capacity.byKind.maintenance).toBeGreaterThan(0);
    const result = picture({ units: { fregate: 1 }, orders: [], projects: [], capacity });
    const ship = byKind(result.objects, 'ship')[0];
    expect(ship.status).toBe('maintenance');
    expect(ship.problems.some(problem => /manutenzione/i.test(problem.label))).toBe(true);
    expect(factOf(ship, 'Manutenzione')!.text).toMatch(/non pienamente operativa/i);
    const navy = byKind(result.objects, 'navy')[0];
    expect(Number(factOf(navy, 'In manutenzione')!.value)).toBe(1);
    expect(Number(factOf(navy, 'Operative')!.value)).toBe(0);
  });

  it('la catena delle navi resta rotta finché non c\'è una nave in servizio', () => {
    const result = picture({ units: { fregate: 0, antinave: 4 }, orders: [{ id: 'o', equipmentId: 'fregate', quantity: 1, progress: 10, status: 'in_progress' }] });
    const chain = result.chains.find(item => item.id === 'navale')!;
    expect(chain.broken).toBe(true);
    expect(chain.steps.find(step => step.label === 'Scafi in costruzione')!.value).toBe(1);
    expect(chain.steps.find(step => step.label === 'Navi in servizio')!.value).toBe(0);
  });
});

describe('OP-OBJECTS — catene: input giù → produzione giù → output giù', () => {
  it('senza giacimenti la catena degli armamenti è rotta e lo dice', () => {
    const rich = picture({ endowment: { iron: 5, coal: 5 } });
    const poor = picture({ endowment: {} });
    const richChain = rich.chains.find(item => item.id === 'armamenti')!;
    const poorChain = poor.chains.find(item => item.id === 'armamenti')!;
    expect(poorChain.broken).toBe(true);
    expect(poorChain.steps[0].tone).toBe('critical');
    expect(poorChain.steps[1].value).toBeLessThan(richChain.steps[1].value);
    expect(poorChain.summary).toMatch(/Anello debole/);
  });

  it('la catena segue il magazzino: l\'esercito è l\'ultimo anello e ne dichiara la copertura', () => {
    const result = picture();
    const chain = result.chains.find(item => item.id === 'armamenti')!;
    const army = chain.steps[chain.steps.length - 1];
    expect(army.label).toContain('esercito');
    expect(army.value).toBeGreaterThanOrEqual(0);
    expect(army.unit).toBe('pct');
  });
});

describe('OP-OBJECTS — quadro completo e convenzioni', () => {
  it('conta gli oggetti e dichiara le attribuzioni applicate', () => {
    const result = picture();
    expect(result.counts.force).toBe(1);
    expect(result.counts.army).toBeGreaterThan(0);
    expect(result.counts.facility).toBeGreaterThan(0);
    expect(result.counts.construction).toBe(1);
    expect(result.conventions.length).toBeGreaterThanOrEqual(3);
    expect(result.conventions.join(' ')).toContain('900 addetti per linea di fabbrica');
  });

  it('ogni oggetto usa la stessa grammatica: sezioni ammesse e problemi con severità', () => {
    const result = picture();
    const allowed = new Set(['stato', 'capacita', 'personale', 'input', 'output', 'costi', 'autonomia']);
    for (const object of result.objects) {
      expect(object.label.length).toBeGreaterThan(0);
      for (const item of object.facts) {
        expect(allowed.has(item.section)).toBe(true);
        if (item.unit !== 'testo') expect(Number.isFinite(item.value)).toBe(true);
      }
      for (const problem of object.problems) {
        expect(['critical', 'warning']).toContain(problem.severity);
      }
      for (const action of object.actions) {
        expect(typeof action.enabled).toBe('boolean');
        if (!action.enabled) expect(action.blockedReason).toBeTruthy();
      }
    }
  });

  it('le miniere esistono solo per i giacimenti dichiarati dal registro', () => {
    const result = picture({ endowment: { oil: 3, iron: 2 } });
    const mines = byKind(result.objects, 'mine');
    expect(mines.length).toBe(2);
    expect(mines.map(mine => mine.label).join(' ')).toMatch(/petrolio/);
    expect(mines.map(mine => mine.label).join(' ')).toMatch(/ferro/);
  });

  it('l\'inventario navale legge solo le voci navali dell\'arsenale', () => {
    const inventory = navalInventory({ fucili: 500, fregate: 2, sottomarini: 1, antinave: 9 });
    expect(inventory.map(item => item.equipmentId).sort()).toEqual(['fregate', 'sottomarini']);
    expect(inventory.find(item => item.equipmentId === 'fregate')!.crew).toBe(180);
    expect(navalShips({ fregate: 2, sottomarini: 1 })).toBe(3);
    expect(equipmentStrength('fregate', 2)).toBeGreaterThan(0);
  });

  it('la dotazione di un reparto copre tutte le categorie con equipaggiamento nel catalogo', () => {
    const plan = formationPlan({ epoch: 'moderno', units: {} });
    expect(Object.keys(CATEGORY_EQUIPMENT).length).toBe(8);
    expect(plan.items.length).toBeGreaterThan(4);
    expect(plan.items.every(item => item.required > 0)).toBe(true);
  });

  it('ogni impianto porta la lavorazione che gli è assegnata (ordine, avanzamento, consegna)', () => {
    // Due impianti, due ordini di terra: uno per impianto, somma invariata.
    const orders: IndustrialOrderLike[] = [
      { id: 'o1', equipmentId: 'fucili', name: 'Fucili d’assalto', quantity: 40, deliveredUnits: 10, progress: 42, status: 'in_progress', expectedDate: '1951-06-20' },
      { id: 'o2', equipmentId: 'carri_3', name: 'Carri armati', quantity: 12, deliveredUnits: 0, progress: 18, status: 'in_progress' },
    ];
    const account = { ...accounts(), factories: 2 };
    const result = picture({
      account,
      orders,
      projects: [],
      capacity: industrialCapacityOf({ factories: 2, ports: 0, universities: 0, orders, projects: [], maintenance: [] }),
    });
    const plants = byKind(result.objects, 'facility').filter(object => object.subtitle === 'Impianto industriale');
    expect(plants.length).toBe(2);
    const assigned = plants.map(plant => factOf(plant, 'Ordine in lavorazione'));
    expect(assigned.every(Boolean)).toBe(true);
    const texts = assigned.map(fact => String(fact?.text));
    // Il materiale in lavorazione è quello non ancora consegnato.
    expect(texts.join(' ')).toContain('Fucili d’assalto ×30 · 42%');
    expect(texts.join(' ')).toContain('Carri armati ×12 · 18%');
    // La consegna prevista è una data, non un numero.
    const delivery = plants[0].facts.find(fact => fact.label === 'Consegna prevista');
    expect(delivery?.unit).toBe('data');
    expect(delivery?.text).toBe('1951-06-20');
  });

  it('gli addetti di un impianto sono per linea: mai frazioni di popolazione', () => {
    const result = picture();
    const factories = byKind(result.objects, 'facility').filter(object => object.subtitle === 'Impianto industriale');
    for (const factory of factories) {
      expect(Number(factOf(factory, 'Addetti')!.value)).toBe(900 * 10);
    }
    const university = byKind(result.objects, 'facility').find(object => object.subtitle === 'Ricerca e formazione tecnica')!;
    expect(Number(factOf(university, 'Addetti')!.value)).toBe(STAFF_PER_LINE.university * 2);
    const mine = byKind(result.objects, 'mine')[0];
    // Gli addetti di una miniera seguono il giacimento dichiarato dal registro.
    const endowment = Number(factOf(mine, 'Giacimento')!.value);
    expect(Number(factOf(mine, 'Addetti')!.value)).toBe(Math.max(120, Math.round(endowment * STAFF_PER_MINE_POINT)));
    // Nessun impianto assorbe più persone di quante ne ha il paese.
    const total = result.objects.flatMap(object => object.facts)
      .filter(item => item.label === 'Addetti')
      .reduce((sum, item) => sum + Number(item.value), 0);
    expect(total).toBeLessThan(accounts().population / 10);
  });

  it('il titolo di un’opera lunga è abbreviato; il testo completo resta nel «Perché?»', () => {
    const long = 'Presentiamo alla Dieta di Francoforte un piano di riarmo federale che porti la spesa militare al livello richiesto dallo Stato maggiore, con riserve addestrate per coscrizione';
    const short = shortTitle(long);
    expect(short.length).toBeLessThanOrEqual(79);
    expect(short.endsWith('…')).toBe(true);
    expect(shortTitle('Ferrovia transnazionale')).toBe('Ferrovia transnazionale');
    const result = picture({ projects: [{ id: 'p2', title: long, started_date: '1951-01-01', expected_date: '1952-01-01', progress: 20 }], orders: [] });
    const construction = byKind(result.objects, 'construction')[0];
    expect(construction.label).toBe(short);
    expect(construction.why).toContain('Opera: Presentiamo alla Dieta');
  });

  it('la rotazione degli ordini non duplica il lavoro fra impianti', () => {
    expect(plantOrders(['a', 'b', 'c'], 0, 2)).toEqual(['a', 'c']);
    expect(plantOrders(['a', 'b', 'c'], 1, 2)).toEqual(['b']);
    // Un impianto che non esiste non riceve lavoro: la rotazione non inventa sedi.
    expect(plantOrders(['a'], 3, 1)).toEqual([]);
  });
});
