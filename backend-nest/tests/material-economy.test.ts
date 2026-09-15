/**
 * Test del magazzino materiale (percorso legacy). Verifica:
 *  - seed proporzionato all'economia;
 *  - produzione/consumo e carenze per cibo, vestiario, armamenti, carburante;
 *  - sblocco tecnologie con prerequisiti;
 *  - costo di movimento a piedi vs motorizzato e pagamento con carenza.
 */
import { describe, it, expect } from 'vitest';
import {
  DEBT_MONTHLY_INTEREST, TECHNOLOGIES, advanceStock, annualDebtServiceMld, applyFlow, capStock, creditHeadroom, creditLimit, debtOf,
  describeStock, developmentClass, dropRegistryInheritedDebt, financePurchase, issueSovereignDebt, materialNeeds, movementCost, normalizeStock, overdraftOf, payMovement, seedStock,
  storageCapacity, technologyById, unlockTechnologies, type ResourceStock,
} from '../src/core/simulation/MaterialEconomy';
import { debtPrincipal } from '../src/core/simulation/SovereignDebt';
import type { NationalAccount } from '../src/core/simulation/WorldStateEngine';

function account(overrides: Partial<NationalAccount> = {}): NationalAccount {
  return {
    polityId: 'DEU', provinces: 3, population: 10_000_000, gdp: 500, militaryPower: 300,
    factories: 4, ports: 2, universities: 3, forces: 6, mobilized: 2,
    monthlyRevenue: 1, monthlyExpenses: 0.8, monthlyBalance: 0.2, annualGrowthRate: 0.02,
    stability: 60, defenceBurdenPct: 2.4, warEffort: 30, socialTension: 20,
    nominalGdpUsdBillions: 40, gdpPerCapitaUsd: 4000, government: 'Repubblica',
    ...overrides,
  };
}

function stock(overrides: Partial<ResourceStock> = {}): ResourceStock {
  return { money: 10, debts: [], food: 100, clothing: 100, weapons: 100, fuel: 100, research: 0, technologies: [], ...overrides };
}

describe('MaterialEconomy', () => {
  it('normalizza scorte sporche e scarta tecnologie inesistenti', () => {
    const clean = normalizeStock({ money: '3', food: -5, fuel: 'x', technologies: ['motorizzazione', 'inesistente', 'motorizzazione'] });
    expect(clean).toMatchObject({ money: 3, food: 0, fuel: 0, technologies: ['motorizzazione'] });
  });

  it('semina scorte operative proporzionate all’economia', () => {
    const seeded = seedStock(account());
    expect(seeded.money).toBeGreaterThan(0);
    expect(seeded.food).toBeGreaterThan(0);
    expect(seeded.fuel).toBeGreaterThan(0);
    expect(seeded.weapons).toBeGreaterThan(0);
    expect(seeded.technologies).toEqual([]);
  });

  it('non nasce mai con tesoreria zero, nemmeno con un conto incompleto', () => {
    // Un conto senza PIL (o con valori non numerici) non deve produrre NaN,
    // che normalizzato diventerebbe una tesoreria a zero.
    const missing = seedStock({ ...account(), nominalGdpUsdBillions: undefined as unknown as number });
    expect(Number.isFinite(missing.money)).toBe(true);
    expect(missing.money).toBeGreaterThan(0);
    const broken = seedStock({
      ...account(),
      nominalGdpUsdBillions: Number.NaN, population: undefined as unknown as number,
      forces: 'x' as unknown as number, factories: null as unknown as number,
    });
    expect(Object.values(broken).filter(value => typeof value === 'number').every(Number.isFinite)).toBe(true);
    expect(broken.money).toBeGreaterThan(0);
    // Una nazione ricca parte con una riserva proporzionata al PIL.
    expect(seedStock(account({ nominalGdpUsdBillions: 1000 })).money).toBe(20);
    // Una nazione piccolissima non parte con una tesoreria più grande del PIL.
    expect(seedStock(account({ nominalGdpUsdBillions: 3 })).money).toBeLessThan(3);
  });

  it('il magazzino è proporzionato alla realtà: un paese fragile ha scorte sottili', () => {
    // Afghanistan-like: reddito basso, terra fertile scarsa.
    const fragile = account({ population: 42_647_492, forces: 12, mobilized: 0, factories: 2, nominalGdpUsdBillions: 17.8, gdpPerCapitaUsd: 417 });
    const rich = account({ population: 60_000_000, forces: 12, mobilized: 0, factories: 2, nominalGdpUsdBillions: 2000, gdpPerCapitaUsd: 45000 });
    expect(developmentClass(fragile)).toBe('low');
    expect(developmentClass(rich)).toBe('high');
    expect(storageCapacity(fragile).food).toBeLessThan(storageCapacity(rich).food);
    const seededFragile = seedStock(fragile, { fertile_land: 2, coal: 2, copper: 3, iron: 2, gold: 1, lithium: 3, rare_earths: 2 });
    const seededRich = seedStock(rich, {});
    // Niente dispense da dieci anni: un paese fragile ha poche settimane/mesi.
    const fragileMonths = seededFragile.food / materialNeeds(fragile).food;
    expect(fragileMonths).toBeLessThan(3);
    expect(seededRich.food / materialNeeds(rich).food).toBeGreaterThan(fragileMonths);
  });

  it('capStock riporta al tetto e segnala il materiale perso', () => {
    const acc = account();
    const capacity = storageCapacity(acc);
    const { stock: capped, spoiled } = capStock(stock({ food: capacity.food + 5, clothing: capacity.clothing + 3 }), acc);
    expect(capped.food).toBeCloseTo(capacity.food, 3);
    expect(spoiled.food).toBeCloseTo(5, 3);
    expect(spoiled.clothing).toBeCloseTo(3, 3);
    expect(capStock(stock({ food: 1, clothing: 1, weapons: 1, fuel: 1 }), acc).spoiled).toEqual({});
  });

  it('nasce con il debito pubblico ereditato, non a zero', () => {
    const indebtedAccount = account({ nominalGdpUsdBillions: 40, debtBurdenPct: 120 });
    const indebted = seedStock(indebtedAccount);
    // Il debito è un portafoglio di titoli: cassa e riserve restano operabili.
    expect(indebted.money).toBeGreaterThan(0);
    expect(indebted.debts.length).toBeGreaterThan(0);
    expect(debtOf(indebted)).toBeCloseTo(48, 0);
    // Il tetto di credito lascia comunque un margine del 15% del PIL.
    expect(creditHeadroom(indebted, indebtedAccount)).toBeGreaterThan(5);
    // Senza debito registrato (mondo legacy) la nazione nasce senza passività.
    expect(seedStock(account({ nominalGdpUsdBillions: 40 })).debts.length).toBe(0);
  });

  it('produce cibo e consuma per popolazione e truppe, accumulando il saldo', () => {
    // Nazione agricola: terra fertile, produce più di quanto consuma.
    const fertile = { fertile_land: 4 };
    const seeded = seedStock(account({ population: 20_000_000, forces: 4, mobilized: 0, factories: 2, nominalGdpUsdBillions: 80 }), fertile);
    const rich = advanceStock(seeded, account({ population: 20_000_000, forces: 4, mobilized: 0, factories: 2 }), 30, fertile);
    expect(rich.flow.food).toBeGreaterThan(0);
    // Nazione povera, popolosa e arida: consuma più di quanto produce.
    const poor = advanceStock(seeded, account({ population: 40_000_000, forces: 20, mobilized: 10, factories: 0, gdpPerCapitaUsd: 400 }), 30, {});
    expect(poor.flow.food).toBeLessThan(0);
    // Con riserve quasi esaurite la carenza viene segnalata.
    const drained = advanceStock(stock({ food: 1 }), account({ population: 40_000_000, forces: 20, mobilized: 10, factories: 0, gdpPerCapitaUsd: 400 }), 30, {});
    expect(drained.flow.shortages.join(' ')).toMatch(/Cibo|Armamenti|Carburante/);
  });

  it('il denaro segue il saldo mensile (revenue − spese) del periodo', () => {
    const tick = advanceStock(stock({ money: 10 }), account({ monthlyBalance: 1.2 }), 30);
    expect(tick.stock.money).toBeCloseTo(11.2, 5);
    const deficit = advanceStock(stock({ money: 10 }), account({ monthlyBalance: -2 }), 30);
    expect(deficit.stock.money).toBeCloseTo(8, 5);
  });

  it('sblocca le tecnologie in ordine, rispettando i prerequisiti', () => {
    const textile = technologyById('industria_tessile')!;
    const unlocked = unlockTechnologies(stock({ research: textile.cost }));
    expect(unlocked.unlocked.map(tech => tech.id)).toContain('industria_tessile');
    expect(unlocked.stock.research).toBe(0);
    // Senza tessile non si può sbloccare l'industria bellica anche con i punti.
    const blocked = unlockTechnologies(stock({ research: 10_000, technologies: [] }));
    const ids = blocked.unlocked.map(tech => tech.id);
    expect(ids.indexOf('industria_tessile')).toBeLessThan(ids.indexOf('industria_bellica'));
    // Idempotente: chi ha già tutto non risblocca.
    const all = TECHNOLOGIES.map(tech => tech.id);
    const none = unlockTechnologies(stock({ research: 10_000, technologies: all }));
    expect(none.unlocked).toEqual([]);
  });

  it('la carenza è segnalata solo quando il fabbisogno non è coperto', () => {
    const short = advanceStock(stock({ food: 0 }), account({ population: 60_000_000, forces: 30, factories: 0, gdpPerCapitaUsd: 400 }), 30, {});
    expect(short.flow.shortages.join(' ')).toMatch(/Cibo/);
    // Nessuna carenza: scorte in linea con il fabbisogno e produzione coperta.
    const ok = advanceStock(seedStock(account({ population: 1_000_000, forces: 1, factories: 5 })), account({ population: 1_000_000, forces: 1, factories: 5 }), 30, { fertile_land: 3 });
    expect(ok.flow.shortages).toEqual([]);
    // Oltre la capacità il surplus si perde (deperimento), non si accumula.
    const overfull = advanceStock(stock({ food: 10_000 }), account({ population: 1_000_000, forces: 1, factories: 5 }), 30, { fertile_land: 3 });
    expect(overfull.stock.food).toBeLessThanOrEqual(storageCapacity(account({ population: 1_000_000, forces: 1, factories: 5 })).food);
    expect(overfull.spoiled.food).toBeGreaterThan(0);
  });

  it('a piedi non serve carburante; con Motorizzazione sì e costa meno con Logistica', () => {
    const foot = movementCost(stock());
    expect(foot.motorized).toBe(false);
    expect(foot.fuel).toBe(0);
    expect(foot.food).toBeGreaterThan(0);
    const motor = movementCost(stock({ technologies: ['industria_tessile', 'industria_bellica', 'motorizzazione'] }));
    expect(motor.motorized).toBe(true);
    expect(motor.fuel).toBeGreaterThan(0);
    const advanced = movementCost(stock({ technologies: ['motorizzazione', 'logistica_avanzata'] }));
    expect(advanced.food).toBeLessThan(motor.food);
    expect(advanced.fuel).toBeLessThan(motor.fuel);
  });

  it('paga il movimento consumando le scorte e segnala la carenza senza andare in negativo', () => {
    const cost = movementCost(stock({ technologies: ['motorizzazione'] }));
    const poor = stock({ food: 0, fuel: 0, money: 0 });
    const paid = payMovement(poor, cost);
    expect(paid.covered).toBe(false);
    expect(paid.stock.food).toBe(0);
    expect(paid.stock.fuel).toBe(0);
    expect(paid.shortages.length).toBeGreaterThanOrEqual(2);
    const rich = payMovement(stock({ food: 50, fuel: 50, money: 50 }), cost);
    expect(rich.covered).toBe(true);
    expect(rich.stock.fuel).toBeLessThan(50);
  });

  it('applyFlow non lascia mai materiali negativi ma consente il debito in denaro', () => {
    const result = applyFlow(stock({ money: 1, food: 1 }), { money: -5, food: -3 });
    expect(result.money).toBe(-4);
    expect(result.food).toBe(0);
  });

  it('describeStock elenca scorte, tecnologie e pressione militare', () => {
    const text = describeStock(stock({ technologies: ['motorizzazione'] }), account());
    expect(text).toMatch(/Tesoreria/);
    expect(text).toMatch(/Motorizzazione/);
    expect(text).toMatch(/Fabbisogno militare/);
    expect(text).toMatch(/Nessun debito/);
  });

  it('il debito è la tesoreria negativa, con interessi e tetto di credito', () => {
    expect(debtOf(stock({ money: 10 }))).toBe(0);
    expect(debtOf(stock({ money: -7.5 }))).toBe(7.5);
    const limit = creditLimit(account());
    expect(limit).toBeGreaterThanOrEqual(5);
    expect(creditHeadroom(stock({ money: 0 }), account())).toBeCloseTo(limit, 2);
    expect(creditHeadroom(stock({ money: -limit }), account())).toBe(0);
    // Il debito matura interessi nel tick.
    const tick = advanceStock(stock({ money: -100 }), account(), 30);
    expect(tick.stock.money).toBeLessThan(-100);
    expect(tick.stock.money).toBeCloseTo(-100 - 100 * DEBT_MONTHLY_INTEREST + 0.2, 2);
    expect(describeStock(stock({ money: -50 }), account())).toMatch(/Debito pubblico/);
  });

  it('financePurchase copre con cassa e credito, e rifiuta oltre il tetto', () => {
    const limit = creditLimit(account());
    const cash = financePurchase(stock({ money: 10 }), account(), 4);
    expect(cash).toEqual({ ok: true, cashUsed: 4, debtUsed: 0 });
    const mixed = financePurchase(stock({ money: 1 }), account(), 4);
    expect(mixed.ok).toBe(true);
    expect(mixed.cashUsed).toBe(1);
    expect(mixed.debtUsed).toBe(3);
    const over = financePurchase(stock({ money: 0 }), account(), limit + 1);
    expect(over.ok).toBe(false);
    expect(over.error).toBe('credit_exhausted');
    // Con il debito già al tetto non c'è spazio.
    const maxed = financePurchase(stock({ money: -limit }), account(), 1);
    expect(maxed.error).toBe('credit_exhausted');
  });

  it('la nazione fa debito: incassa cassa, registra titolo, interessi e scadenza', () => {
    const nation = account({ nominalGdpUsdBillions: 40 });
    const issued = issueSovereignDebt(stock({ money: 0 }), nation, { amountMld: 20, termYears: 10, date: '2024-01-01' });
    expect(issued.ok).toBe(true);
    expect(issued.stock.money).toBe(20);
    expect(debtPrincipal(issued.stock.debts)).toBe(20);
    expect(issued.tranche?.maturityDate).toBe('2034-01-01');
    // Gli interessi annui sono il capitale per il tasso di mercato.
    expect(annualDebtServiceMld(issued.stock)).toBeCloseTo(20 * issued.tranche!.annualRatePct / 100, 2);
    expect(debtOf(issued.stock)).toBeCloseTo(20, 2);
    // Oltre il tetto di credito il mercato non presta.
    const tooMuch = issueSovereignDebt(stock({ money: 0 }), nation, { amountMld: creditLimit(nation) + 1, termYears: 5, date: '2024-01-01' });
    expect(tooMuch.ok).toBe(false);
    expect(tooMuch.error).toBe('credit_exhausted');
    // Importo non positivo rifiutato.
    expect(issueSovereignDebt(stock({ money: 0 }), nation, { amountMld: 0, termYears: 5, date: '2024-01-01' }).error).toBe('amount_invalid');
    // Lo scoperto di cassa resta distinto dai titoli emessi.
    expect(overdraftOf(stock({ money: -3, debts: [] }))).toBe(3);
    expect(overdraftOf(issued.stock)).toBe(0);
  });

  it('alla scadenza il titolo si rifinanzia al tasso di mercato (rollover)', () => {
    const nation = account({ nominalGdpUsdBillions: 40 });
    const issued = issueSovereignDebt(stock({ money: 0 }), nation, { amountMld: 20, termYears: 2, date: '2024-01-01' });
    // Un tick prima della scadenza: nessun rollover.
    const before = advanceStock(issued.stock, nation, 30, {}, '2025-12-01');
    expect(before.rolledDebts).toEqual([]);
    // Alla scadenza il titolo torna: stesso capitale, nuova scadenza.
    const at = advanceStock(issued.stock, nation, 30, {}, '2026-01-15');
    expect(at.rolledDebts).toHaveLength(1);
    expect(debtPrincipal(at.stock.debts)).toBe(20);
    expect(at.rolledDebts[0].issuedDate).toBe('2026-01-15');
    expect(at.rolledDebts[0].maturityDate).toBe('2028-01-15');
  });

  it('nei mondi storici elimina il debito ereditato dal registro 2024', () => {
    const withInherited = stock({
      debts: [
        { id: 'debt-inherited-1', label: 'Debito ereditato 3 anni', principal: 120, annualRatePct: 2.7, termYears: 3, issuedDate: '1951-01-01', maturityDate: '1954-01-01' },
        { id: 'debt-1951-01-01-1', label: 'Titolo emesso', principal: 30, annualRatePct: 3, termYears: 5, issuedDate: '1951-06-01', maturityDate: '1956-06-01' },
      ],
    });
    const cleaned = dropRegistryInheritedDebt(withInherited);
    // Il finto debito ereditato sparisce, quello emesso in partita resta.
    expect(cleaned.debts.map(d => d.id)).toEqual(['debt-1951-01-01-1']);
    expect(withInherited.debts).toHaveLength(2); // stock originale immutato
    // Senza debito ereditato la funzione restituisce lo stesso oggetto.
    expect(dropRegistryInheritedDebt(cleaned)).toBe(cleaned);
  });
});
