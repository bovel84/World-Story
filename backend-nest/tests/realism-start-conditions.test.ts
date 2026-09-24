/**
 * Condizioni di partenza realistiche — debito ereditato e scala storica.
 * =====================================================================
 * Due difetti di realismo misurati il 2026-09-24 (vedi
 * `docs/ANALISI_REALISMO_SIMULAZIONE_2026-09-24.md`) e chiusi qui con test di
 * **accettazione**: il criterio è un fatto osservabile del gioco, non un numero
 * interno del motore.
 *
 * 1. **Debito ereditato al tasso sbagliato.** La semina valorizzava tutto lo
 *    stock al tasso di mercato corrente, premio di rischio incluso. Il Giappone
 *    arrivava al 275% delle entrate in interessi e — misurato eseguendo
 *    `assessCrisis` con i dati reali — risultava già in criticità `critical`,
 *    con default sovrano dopo tre mesi di gioco senza che il giocatore potesse
 *    intervenire. Stessa sorte per Singapore, Grecia, Italia e Stati Uniti. Uno
 *    stock di debito pubblico non è emesso al prezzo di oggi: è un portafoglio
 *    costruito in decenni, e solo la quota che scade si rifinanzia al corrente.
 *
 * 2. **Scala storica assente.** `HISTORICAL_GDP_BY_YEAR` copriva solo il 1939 e
 *    il 1951, e `historicalGdpYear` sceglie l'anno più vicino: un mondo del 1989
 *    leggeva i dati del **1951** (USA 346 mld contro ~5.660 reali) e un mondo del
 *    2000 leggeva i fatti **2024** (Cina 18.730 contro ~1.211). La soglia
 *    booleana del 1990 non era il problema: mancavano le righe.
 */
import { describe, it, expect } from 'vitest';
import {
  HISTORICAL_GDP_BY_YEAR,
  HISTORICAL_GDP_PER_CAPITA_BY_YEAR,
  estimatedNominalGdpUsdBillions,
  historicalGdpYear,
  historicalNominalGdpUsdBillions,
  referenceDebtToGdpPct,
  referenceGdpUsdBillions,
  referencePopulation,
} from '../src/utils/country-facts';
import {
  inheritedCarryRatePct,
  marketRatePct,
  normalizeInheritedDebtRates,
  type SovereignDebt,
} from '../src/core/simulation/SovereignDebt';
import {
  assessCrisis,
  CRISIS_CRITICAL_SCORE,
  type CrisisInput,
} from '../src/core/simulation/NationCrisis';
import {
  DEBT_HEADROOM_RATIO,
  hasUnnormalizedInheritedDebt,
  normalizeInheritedDebtStock,
  seedStock,
  type ResourceStock,
} from '../src/core/simulation/MaterialEconomy';
import { WorldStateEngine } from '../src/core/simulation/WorldStateEngine';

/** L'aliquota di riferimento del gioco, su cui si misurano le entrate. */
const REFERENCE_TAX_PCT = 10;

/** Il rapporto debito/PIL sotto il quale il canale default di crisi resta spento. */
const CRISIS_DEBT_FLOOR_PCT = 20;

/** Le nazioni del registro con debito pubblico sopra il 90% del PIL. */
const HIGH_DEBT_POLITIES = [
  'JPN', 'SGP', 'GRC', 'ITA', 'USA', 'FRA', 'PRT', 'ESP', 'GBR', 'BEL', 'CAN',
];

/**
 * L'ingresso di crisi per l'insolvenza, costruito **dagli stessi numeri che il
 * gioco usa**: rapporto debito/PIL dal registro, servizio dagli interessi del
 * portafoglio sulle entrate di riferimento. Gli indicatori sociali restano ai
 * valori di riposo del motore, perché il criterio è «la nazione cade senza che
 * il giocatore abbia fatto nulla».
 */
function insolvencyInput(polityId: string, debts: readonly SovereignDebt[], gdp: number): CrisisInput {
  const principal = debts.reduce((total, debt) => total + Math.max(0, debt.principal), 0);
  const interest = debts.reduce(
    (total, debt) => total + Math.max(0, debt.principal) * Math.max(0, debt.annualRatePct) / 100,
    0,
  );
  const revenue = gdp * REFERENCE_TAX_PCT / 100;
  const baseline = referenceDebtToGdpPct(polityId);
  return {
    stability: 48,
    socialTension: 16,
    annualGrowthRate: 0.02,
    monthlyBalance: 0,
    nominalGdpUsdBillions: gdp,
    debtRatioPct: gdp > 0 ? (principal / gdp) * 100 : 0,
    debtServicePct: revenue > 0 ? (interest / revenue) * 100 : 0,
    baselineDebtRatioPct: baseline,
    overdraftMld: 0,
    foodCoverageMonths: 6,
    taxRatePct: REFERENCE_TAX_PCT,
    militaryPower: 150,
    hostileNeighbours: [],
    atWar: false,
  };
}

/** Un conto nazionale minimo: al motore servono la scala e nessun altro fatto. */
function stubAccount(polityId: string, gdp: number) {
  return {
    polityId,
    provinces: 1,
    population: referencePopulation(polityId) ?? 1_000_000,
    gdp: 0,
    militaryPower: 0,
    factories: 0,
    ports: 0,
    universities: 0,
    forces: 0,
    mobilized: 0,
    monthlyRevenue: gdp * REFERENCE_TAX_PCT / 100 / 12,
    monthlyExpenses: gdp * 0.04 / 12,
    monthlyBalance: gdp * (REFERENCE_TAX_PCT / 100 - 0.04) / 12,
    annualGrowthRate: 0.02,
    stability: 48,
    defenceBurdenPct: 2,
    debtBurdenPct: referenceDebtToGdpPct(polityId),
    warEffort: 0,
    socialTension: 16,
    nominalGdpUsdBillions: gdp,
    gdpPerCapitaUsd: 0,
    government: 'Forma di governo non registrata',
  };
}

describe('debito ereditato — tasso effettivo di carry', () => {
  it('è più basso del tasso di mercato perché non tutto lo stock si rifinanzia', () => {
    for (const polityId of HIGH_DEBT_POLITIES) {
      const ratio = referenceDebtToGdpPct(polityId);
      expect(ratio).toBeGreaterThan(90);
      expect(inheritedCarryRatePct(ratio)).toBeLessThan(marketRatePct(ratio, 8));
    }
  });

  it('cresce col debito e resta limitato', () => {
    expect(inheritedCarryRatePct(200)).toBeGreaterThan(inheritedCarryRatePct(80));
    expect(inheritedCarryRatePct(400)).toBeLessThanOrEqual(8);
    expect(inheritedCarryRatePct(0)).toBeGreaterThan(0);
  });

  it('non supera la metà delle entrate nemmeno per i paesi più indebitati', () => {
    for (const polityId of HIGH_DEBT_POLITIES) {
      const ratio = referenceDebtToGdpPct(polityId);
      const interestPctGdp = ratio / 100 * inheritedCarryRatePct(ratio);
      expect(
        interestPctGdp / REFERENCE_TAX_PCT,
        `${polityId}: interessi ${interestPctGdp.toFixed(1)}% del PIL su entrate ${REFERENCE_TAX_PCT}%`,
      ).toBeLessThan(0.5);
    }
  });
  it('la scaletta del debito ereditato usa il carry, non il tasso di mercato', () => {
    for (const polityId of ['JPN', 'ITA', 'USA']) {
      const gdp = referenceGdpUsdBillions(polityId);
      expect(gdp).not.toBeNull();
      const stock = seedStock(stubAccount(polityId, gdp!), {}, '2026-01-01');
      expect(stock.debts.length).toBeGreaterThan(0);
      const carry = inheritedCarryRatePct(referenceDebtToGdpPct(polityId));
      for (const debt of stock.debts) {
        expect(String(debt.id)).toMatch(/^debt-inherited-/);
        expect(debt.annualRatePct).toBe(carry);
      }
    }
  });
});

describe('debito ereditato — nessuna nazione parte in crisi critica', () => {
  // Il criterio che il difetto violava: nessuna nazione del registro può
  // risultare a rischio di default per il solo fatto di esistere.
  it('con gli indicatori di riposo, nessun paese ad alto debito è critico', () => {
    for (const polityId of HIGH_DEBT_POLITIES) {
      const gdp = referenceGdpUsdBillions(polityId);
      expect(gdp, `${polityId} senza PIL di registro`).not.toBeNull();
      const stock = seedStock(stubAccount(polityId, gdp!), {}, '2026-01-01');
      const { risks } = assessCrisis(insolvencyInput(polityId, stock.debts, gdp!));
      const insolvency = risks.find(risk => risk.dimension === 'insolvency')!;
      expect(
        insolvency.score,
        `${polityId}: insolvenza ${insolvency.score} (${insolvency.level})`,
      ).toBeLessThan(CRISIS_CRITICAL_SCORE);
    }
  });

  it('nessun paese ad alto debito entra in allarme di insolvenza senza indebitarsi', () => {
    for (const polityId of HIGH_DEBT_POLITIES) {
      const gdp = referenceGdpUsdBillions(polityId);
      const stock = seedStock(stubAccount(polityId, gdp!), {}, '2026-01-01');
      const { risks } = assessCrisis(insolvencyInput(polityId, stock.debts, gdp!));
      const insolvency = risks.find(risk => risk.dimension === 'insolvency')!;
      // Un margine di guardia: il debito ereditato non è una colpa del giocatore.
      expect(insolvency.level, `${polityId}: ${insolvency.score}`).toBe('calm');
    }
  });
});

describe('debito ereditato — bonifica dei salvataggi scritti prima', () => {
  const legacy: ResourceStock = {
    money: 12,
    debts: [
      // Semina vecchia: tasso di mercato pieno sui tre scalini.
      { id: 'debt-inherited-1', label: 'Titolo 3 anni', principal: 30, annualRatePct: marketRatePct(134.7, 3), issuedDate: '2026-01-01', maturityDate: '2029-01-01', termYears: 3 },
      { id: 'debt-inherited-2', label: 'Titolo 8 anni', principal: 40, annualRatePct: marketRatePct(134.7, 8), issuedDate: '2026-01-01', maturityDate: '2034-01-01', termYears: 8 },
      { id: 'debt-issued-by-player', label: 'Titolo 10 anni', principal: 5, annualRatePct: 4.2, issuedDate: '2026-02-01', maturityDate: '2036-02-01', termYears: 10 },
    ],
    food: 1, clothing: 1, weapons: 1, fuel: 1, research: 0, technologies: [],
  };

  it('corregge il tasso delle sole tranche ereditate', () => {
    expect(hasUnnormalizedInheritedDebt(legacy, 134.7)).toBe(true);
    const fixed = normalizeInheritedDebtStock(legacy, 134.7);
    const carry = inheritedCarryRatePct(134.7);
    for (const debt of fixed.debts.filter(d => d.id.startsWith('debt-inherited-'))) {
      expect(debt.annualRatePct).toBe(carry);
      expect(debt.label).toMatch(/^Debito ereditato \d+ anni$/);
    }
    // Il debito del giocatore non si tocca.
    expect(fixed.debts.find(d => d.id === 'debt-issued-by-player')!.annualRatePct).toBe(4.2);
    // Si corregge il tasso, non lo stock.
    expect(fixed.debts.reduce((total, debt) => total + debt.principal, 0)).toBe(75);
  });

  it('è idempotente', () => {
    const once = normalizeInheritedDebtStock(legacy, 134.7);
    expect(normalizeInheritedDebtStock(once, 134.7)).toBe(once);
    expect(hasUnnormalizedInheritedDebt(once, 134.7)).toBe(false);
  });

  it('non tocca un portafoglio senza debito ereditato', () => {
    const clean: ResourceStock = { ...legacy, debts: [legacy.debts[2]] };
    expect(hasUnnormalizedInheritedDebt(clean, 134.7)).toBe(false);
    expect(normalizeInheritedDebtStock(clean, 134.7)).toBe(clean);
  });

  it('le tranche corrette non risultano più da correggere', () => {
    const fixed = normalizeInheritedDebtStock(legacy, 134.7);
    expect(normalizeInheritedDebtRates(fixed.debts, 134.7).changed).toBe(false);
  });
});

describe('margine di credito coerente con la soglia di crisi', () => {
  it('il tetto di credito supera la soglia che fa scattare la crisi', () => {
    // La soglia di `NationCrisis` è `max(70, baseline + 20)` punti di PIL; il
    // tetto è `max(0,60, baseline + margine)`. Se il margine è minore di 20, il
    // debito massimo legalmente raggiungibile resta sotto la soglia e il canale
    // «debito nuovo» non può mai attivarsi.
    expect(DEBT_HEADROOM_RATIO).toBeGreaterThan(CRISIS_DEBT_FLOOR_PCT / 100);
  });

  it('per ogni paese ad alto debito il credito residuo è positivo ma finito', () => {
    for (const polityId of HIGH_DEBT_POLITIES) {
      const gdp = referenceGdpUsdBillions(polityId)!;
      const stock = seedStock(stubAccount(polityId, gdp), {}, '2026-01-01');
      const baseline = referenceDebtToGdpPct(polityId) / 100;
      const limit = Math.max(0.6 * gdp, baseline * gdp + DEBT_HEADROOM_RATIO * gdp);
      const debt = stock.debts.reduce((total, tranche) => total + tranche.principal, 0);
      expect(limit).toBeGreaterThan(debt);
    }
  });
});

describe('scala storica — la tabella copre le epoche dei preset', () => {
  it('gli anni dei preset hanno una riga propria', () => {
    for (const year of [1815, 1914, 1939, 1951, 1989, 2000]) {
      expect(HISTORICAL_GDP_BY_YEAR[year], `manca la riga ${year}`).toBeDefined();
      expect(Object.keys(HISTORICAL_GDP_BY_YEAR[year]).length).toBeGreaterThan(5);
    }
  });

  it('ogni riga usa codici polity validi e valori positivi', () => {
    for (const [year, table] of Object.entries(HISTORICAL_GDP_BY_YEAR)) {
      for (const [polityId, gdp] of Object.entries(table)) {
        expect(polityId, `${year}: codice non valido`).toMatch(/^[A-Z]{3}$/);
        expect(Number.isFinite(gdp), `${year}/${polityId}`).toBe(true);
        expect(gdp, `${year}/${polityId}`).toBeGreaterThan(0);
      }
    }
  });

  it('la selezione sceglie la riga giusta per ogni preset', () => {
    expect(historicalGdpYear('1815-06-09')).toBe(1815);
    expect(historicalGdpYear('1914-06-28')).toBe(1914);
    expect(historicalGdpYear('1936-01-01')).toBe(1939);
    expect(historicalGdpYear('1939-09-01')).toBe(1939);
    expect(historicalGdpYear('1951-01-01')).toBe(1951);
    expect(historicalGdpYear('1989-06-04')).toBe(1989);
    expect(historicalGdpYear('2000-01-01')).toBe(2000);
    expect(historicalGdpYear('2026-01-01')).toBe(2000);
  });

  it('le righe non calano mai, tranne il calo post-bellico del 1951', () => {
    // Il 1951 è escluso dal confronto col 1939: India 25 → 22 è un fatto reale
    // (partizione e povertà post-bellica), non un errore di tabella.
    for (const polityId of ['USA', 'GBR', 'FRA', 'ITA', 'JPN', 'CHN', 'IND']) {
      let previous = 0;
      for (const year of [1815, 1914, 1939, 1989, 2000]) {
        const value = HISTORICAL_GDP_BY_YEAR[year]?.[polityId];
        if (value === undefined) continue;
        expect(value, `${polityId} ${year} cala rispetto all'epoca precedente`).toBeGreaterThanOrEqual(previous);
        previous = value;
      }
    }
  });

  it('le grandi economie crescono di due ordini di grandezza fra il 1815 e il 2000', () => {
    for (const polityId of ['USA', 'GBR']) {
      const early = HISTORICAL_GDP_BY_YEAR[1815][polityId];
      const late = HISTORICAL_GDP_BY_YEAR[2000][polityId];
      expect(early, `manca la riga 1815 per ${polityId}`).toBeDefined();
      expect(late / early, `${polityId}: da ${early} a ${late}`).toBeGreaterThan(1_000);
    }
  });

  it('il reddito pro capite di ripiego cresce con l\'epoca', () => {
    let previous = 0;
    for (const year of [1815, 1914, 1939, 1951, 1989, 2000]) {
      const value = HISTORICAL_GDP_PER_CAPITA_BY_YEAR[year];
      expect(value, `manca il reddito di ripiego per ${year}`).toBeDefined();
      expect(value).toBeGreaterThan(previous);
      previous = value;
    }
  });

  it('un mondo del 1989 non usa i fatti 2024', () => {
    const population = referencePopulation('USA')!;
    const modern = estimatedNominalGdpUsdBillions('USA', population, { modernFacts: true, startDate: '1989-06-04' });
    const historical = estimatedNominalGdpUsdBillions('USA', population, { modernFacts: false, startDate: '1989-06-04' });
    // Il PIL del 1989 è circa un quinto di quello del 2024, non un centesimo.
    expect(historical / modern).toBeGreaterThan(0.1);
    expect(historical / modern).toBeLessThan(0.5);
  });

  it('un mondo del 2000 non eredita il PIL del 1951', () => {
    // Il percorso moderno del 2000 usa i fatti 2024 (soglia 1990), ma la riga
    // storica esiste: il percorso storico non ricade più sul 1951.
    expect(historicalNominalGdpUsdBillions('CHN', 1_200_000_000, { startDate: '2000-01-01' }))
      .toBe(HISTORICAL_GDP_BY_YEAR[2000].CHN);
    expect(historicalNominalGdpUsdBillions('CHN', 1_200_000_000, { startDate: '2000-01-01' }))
      .toBeGreaterThan(HISTORICAL_GDP_BY_YEAR[1951].CHN ?? 0);
  });

  it('un mondo del 1815 non riceve il PIL del 1939', () => {
    const gbr = historicalNominalGdpUsdBillions('GBR', 10_000_000, { startDate: '1815-06-09' });
    expect(gbr).toBe(HISTORICAL_GDP_BY_YEAR[1815].GBR);
    expect(gbr).toBeLessThan((HISTORICAL_GDP_BY_YEAR[1939].GBR ?? 0) / 10);
  });

  it('i mondi moderni restano sul registro reale', () => {
    const usa = estimatedNominalGdpUsdBillions('USA', 340_000_000, { modernFacts: true, startDate: '2026-01-01' });
    expect(usa).toBe(referenceGdpUsdBillions('USA'));
    expect(usa).toBeGreaterThan(25_000);
  });
});

describe('scala storica — i conti nazionali restano coerenti', () => {
  it('il PIL nominale non dipende dai fatti moderni nei mondi storici', () => {
    const regions = [{ id: 'r1', owner: 'USA', population: 150_000_000, gdp: 100, militaryPower: 50 }];
    const modern = WorldStateEngine.accounts(regions, { modernFacts: true, startDate: '2026-01-01' });
    const historical = WorldStateEngine.accounts(regions, { modernFacts: false, startDate: '1989-06-04' });
    expect(historical.USA.nominalGdpUsdBillions).toBeLessThan(modern.USA.nominalGdpUsdBillions);
    // Nessun debito ereditato dove è anacronistico.
    expect(historical.USA.debtBurdenPct).toBe(0);
    expect(modern.USA.debtBurdenPct).toBeGreaterThan(0);
  });
});
