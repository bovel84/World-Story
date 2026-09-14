/**
 * Risorse naturali dinamiche: estrazione, esaurimento, rinnovabili e mercato.
 * Funzioni pure, deterministiche e senza effetti collaterali.
 */
import { describe, it, expect } from 'vitest';
import {
  BUY_MARKUP, RESERVE_PER_POINT, RESOURCE_VALUE, SELL_DISCOUNT,
  advanceLedger, applyGlobalExtraction, describeLedger, effectiveEndowment, emptyMarket,
  executeTrade, extractionRate, isRenewable, marketQuote, seedLedger, seedMarket,
  summarizeLedger, tradePressureDelta,
} from '../src/core/simulation/ResourceMarket';
import type { NationalAccount } from '../src/core/simulation/WorldStateEngine';
import { seedStock } from '../src/core/simulation/MaterialEconomy';

const account = (over: Partial<NationalAccount> = {}): NationalAccount => ({
  polityId: 'TST', provinces: 1, population: 10_000_000, gdp: 100, militaryPower: 50,
  factories: 0, ports: 0, universities: 0, forces: 1, mobilized: 0,
  monthlyRevenue: 1, monthlyExpenses: 1, monthlyBalance: 0, annualGrowthRate: 0,
  stability: 50, defenceBurdenPct: 1, warEffort: 5, socialTension: 5,
  nominalGdpUsdBillions: 100, gdpPerCapitaUsd: 10_000, government: 'repubblica',
  ...over,
});

describe('seedLedger ed estrazione', () => {
  it('semina la riserva dal giacimento e ignora le risorse assenti', () => {
    const ledger = seedLedger({ oil: 5, iron: 2 });
    expect(ledger.oil?.reserve).toBe(5 * RESERVE_PER_POINT);
    expect(ledger.oil?.maxReserve).toBe(5 * RESERVE_PER_POINT);
    expect(ledger.oil?.stockpile).toBe(0);
    expect(ledger.iron?.reserve).toBe(2 * RESERVE_PER_POINT);
    expect(ledger.gold).toBeUndefined();
  });

  it('l’estrazione cresce con le infrastrutture ed è limitata dalla riserva', () => {
    const node = { endowment: 5, reserve: 20, maxReserve: 120, stockpile: 0, extractedTotal: 0 };
    const bare = extractionRate(node, account());
    const industrial = extractionRate(node, account({ factories: 5, ports: 3 }));
    expect(industrial).toBeGreaterThan(bare);
    const tiny = extractionRate({ ...node, reserve: 0.1 }, account());
    expect(tiny).toBeLessThanOrEqual(0.1);
  });

  it('avanza le riserve: estrae, accumula e registra l’esaurimento', () => {
    const ledger = seedLedger({ oil: 5 });
    const first = advanceLedger(ledger, account(), 30);
    expect(first.extracted.oil).toBeGreaterThan(0);
    expect(first.ledger.oil!.reserve).toBeLessThan(ledger.oil!.reserve);
    expect(first.ledger.oil!.stockpile).toBeGreaterThan(0);
    expect(first.depleted).toEqual([]);

    // Con riserva minima l'estrazione la esaurisce e la segnala.
    const almostEmpty = { oil: { endowment: 5, reserve: 0.1, maxReserve: 120, stockpile: 0, extractedTotal: 0 } };
    const drained = advanceLedger(almostEmpty, account({ factories: 9 }), 30);
    expect(drained.ledger.oil!.reserve).toBe(0);
    expect(drained.depleted).toContain('oil');
    expect(drained.extracted.oil).toBe(0.1);
    // Nessuna estrazione oltre la riserva disponibile.
    const beyond = advanceLedger({ oil: { endowment: 5, reserve: 0, maxReserve: 120, stockpile: 3, extractedTotal: 3 } }, account(), 30);
    expect(beyond.extracted.oil).toBeUndefined();
    expect(beyond.ledger.oil!.stockpile).toBe(3);
  });

  it('rigenera solo le risorse rinnovabili', () => {
    expect(isRenewable('timber')).toBe(true);
    expect(isRenewable('oil')).toBe(false);
    const ledger = seedLedger({ timber: 5, oil: 5 });
    // Consuma un po' di riserva prima di testare la rigenerazione.
    const consumed = {
      timber: { ...ledger.timber!, reserve: 60 },
      oil: { ...ledger.oil!, reserve: 60 },
    };
    const advanced = advanceLedger(consumed, account(), 30);
    // Il legname si rigenera più di quanto estrae; il petrolio no.
    expect(advanced.ledger.timber!.reserve).toBeGreaterThanOrEqual(60 - advanced.extracted.timber!);
    expect(advanced.ledger.oil!.reserve).toBeLessThan(60);
  });

  it('l’endowment effettivo perde le risorse esaurite', () => {
    const ledger = seedLedger({ oil: 5, iron: 2 });
    const alive = effectiveEndowment(ledger, { oil: 5, iron: 2 });
    expect(alive).toEqual({ oil: 5, iron: 2 });
    const exhausted = effectiveEndowment(
      { ...ledger, oil: { ...ledger.oil!, reserve: 0 } },
      { oil: 5, iron: 2 },
    );
    expect(exhausted.oil).toBeUndefined();
    expect(exhausted.iron).toBe(2);
  });

  it('riassume e descrive il magazzino naturale', () => {
    const ledger = seedLedger({ gold: 4 });
    const summary = summarizeLedger(ledger, account())[0];
    expect(summary.kind).toBe('gold');
    expect(summary.depleted).toBe(false);
    expect(describeLedger(ledger, account())).toMatch(/Oro/);
    expect(describeLedger({}, account())).toMatch(/Nessuna risorsa/);
  });
});

describe('mercato delle risorse', () => {
  it('il prezzo sale con la scarsità globale ed è limitato', () => {
    const market = seedMarket({ A: { oil: 5 }, B: { oil: 5 } });
    const full = marketQuote(market, 'oil');
    applyGlobalExtraction(market, { oil: (market.initialReserves.oil || 0) * 0.7 });
    const scarce = marketQuote(market, 'oil');
    expect(scarce.mid).toBeGreaterThan(full.mid);
    expect(scarce.scarcityPct).toBeGreaterThan(50);
    // Limite superiore: non supera 3× il valore base.
    applyGlobalExtraction(market, { oil: market.initialReserves.oil });
    expect(marketQuote(market, 'oil').mid).toBeLessThanOrEqual(RESOURCE_VALUE.oil * 3);
  });

  it('bid e ask hanno uno spread coerente e il valore base è rispettato', () => {
    const market = emptyMarket();
    const quote = marketQuote(market, 'gold');
    expect(quote.ask).toBeCloseTo(quote.mid * BUY_MARKUP, 3);
    expect(quote.bid).toBeCloseTo(quote.mid * SELL_DISCOUNT, 3);
  });

  it('la pressione degli scambi muove il prezzo', () => {
    const market = emptyMarket();
    const before = marketQuote(market, 'iron').mid;
    market.pressure.iron = tradePressureDelta('iron', 40, 'buy');
    const after = marketQuote(market, 'iron').mid;
    expect(after).toBeGreaterThan(before);
    market.pressure.iron = tradePressureDelta('iron', 40, 'sell');
    expect(marketQuote(market, 'iron').mid).toBeLessThan(before);
  });

  it('vende scorte incassando denaro e compra pagando', () => {
    const ledger = { ...seedLedger({ oil: 5 }), oil: { endowment: 5, reserve: 100, maxReserve: 120, stockpile: 10, extractedTotal: 10 } };
    const stock = { ...seedStock(account()), money: 100 };
    const market = seedMarket({ A: { oil: 5 } });

    const sale = executeTrade(ledger, stock, market, 'oil', 4, 'sell');
    expect(sale.ok).toBe(true);
    expect(sale.ledger.oil!.stockpile).toBe(6);
    expect(sale.stock.money).toBeGreaterThan(stock.money);
    expect(sale.total).toBeCloseTo(sale.unitPrice * 4, 2);

    const purchase = executeTrade(sale.ledger, sale.stock, market, 'oil', 2, 'buy');
    expect(purchase.ok).toBe(true);
    expect(purchase.ledger.oil!.stockpile).toBe(8);
    expect(purchase.stock.money).toBeLessThan(sale.stock.money);
  });

  it('rifiuta scambi non validi senza mutare lo stato', () => {
    const ledger = seedLedger({ oil: 5 });
    const stock = seedStock(account());
    const market = seedMarket({ A: { oil: 5 } });
    expect(executeTrade(ledger, stock, market, 'oil', 1, 'sell').error).toBe('insufficient_stockpile');
    expect(executeTrade(ledger, stock, market, 'oil', 0, 'buy').error).toBe('quantity_invalid');
    expect(executeTrade(ledger, stock, market, 'gold', 1, 'buy').error).toBe('resource_not_held');
    expect(executeTrade(ledger, { ...stock, money: 0 }, market, 'oil', 5, 'buy').error).toBe('insufficient_money');
    expect(executeTrade(ledger, stock, market, 'kryptonite' as any, 1, 'buy').error).toBe('unknown_resource');
  });
});
