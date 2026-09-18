/**
 * MATERIEL-CLARITY — sintesi dell'arsenale (frontend).
 *
 * «Quanti ne ho e quanti ne sto producendo?»: la riga di sintesi legge solo i
 * dati pubblicati dal motore (`lines`, `production.orders`) e, quando la
 * produzione non è registrata, lo dichiara invece di tacere o inventare.
 */
import { describe, it, expect } from 'vitest';
import {
  arsenalBrief, arsenalBriefText, arsenalLineSummary, arsenalProductionFor,
  arsenalSplit, arsenalSplitText,
  type ProductionOrderLike,
} from './arsenalSummary';

const line = (over: Partial<Parameters<typeof arsenalLineSummary>[0]> = {}) => ({
  id: 'fucili', name: 'Fucili d’assalto', quantity: 37, strength: 13, sharePct: 77.8, ...over,
});

const order = (over: Partial<ProductionOrderLike> = {}): ProductionOrderLike => ({
  equipmentId: 'fucili', quantity: 40, progress: 42, status: 'in_progress', expectedDate: '1951-06-20', ...over,
});

describe('arsenalProductionFor — produzione in corso di un armamento', () => {
  it('somma gli ordini aperti dell’armamento, con completamento ponderato', () => {
    const production = arsenalProductionFor([order(), order({ quantity: 60, progress: 10, expectedDate: '1951-07-01' })], 'fucili')!;
    expect(production.orders).toBe(2);
    expect(production.quantity).toBe(100);
    // (42×40 + 10×60) / 100 = 22,8 → 23
    expect(production.progress).toBe(23);
    // La consegna più vicina è quella che conta per il giocatore.
    expect(production.expectedDate).toBe('1951-06-20');
  });

  it('ignora gli ordini conclusi, falliti e di altri armamenti', () => {
    expect(arsenalProductionFor([order({ status: 'completed' }), order({ status: 'failed' })], 'fucili')).toBeNull();
    expect(arsenalProductionFor([order({ equipmentId: 'apc' })], 'fucili')).toBeNull();
  });

  it('senza ordini (o senza id) non inventa una produzione', () => {
    expect(arsenalProductionFor([], 'fucili')).toBeNull();
    expect(arsenalProductionFor(undefined, 'fucili')).toBeNull();
    expect(arsenalProductionFor([order()], '')).toBeNull();
  });

  it('ordini senza data prevista: nessuna data inventata', () => {
    const production = arsenalProductionFor([order({ expectedDate: null })], 'fucili')!;
    expect(production.expectedDate).toBeNull();
  });
});

describe('arsenalLineSummary — riga scansionabile', () => {
  it('in servizio + in produzione con percentuale e consegna prevista', () => {
    const text = arsenalLineSummary(line(), arsenalProductionFor([order()], 'fucili'));
    expect(text).toBe('×37 in servizio · in produzione ×40 (42%, consegna 20 giu 1951) · forza 13,0 (77,8% dell\'arsenale)');
  });

  it('senza produzione in corso lo dice (non tace)', () => {
    const text = arsenalLineSummary(line(), null);
    expect(text).toContain('nessun ordine in corso');
    expect(text).toContain('×37 in servizio');
  });

  it('senza forza pubblicata la riga resta leggibile', () => {
    const text = arsenalLineSummary(line({ strength: undefined, sharePct: undefined }), null);
    expect(text).toBe('×37 in servizio · nessun ordine in corso');
  });
});

describe('arsenalSplit — deposito vs assegnato (OP-OBJECTS PERSISTENT)', () => {
  it('somma le parti e mostra il totale nazionale', () => {
    const split = arsenalSplit({ fucili: 10_000 }, { fucili: 1_000 }, { fucili: 9_000 })!;
    expect(split).toEqual({ total: 10_000, depot: 1_000, assigned: 9_000 });
    expect(arsenalSplitText(split)).toBe('deposito 1.000 · assegnato 9.000 su 10.000');
  });

  it('senza i campi del motore non inventa la ripartizione', () => {
    expect(arsenalSplit({ fucili: 10_000 }, undefined, undefined)).toBeNull();
    expect(arsenalSplitText(null)).toBe('');
  });

  it('il totale mancante è la somma delle parti', () => {
    const split = arsenalSplit(undefined, { fregate: 2 }, { fregate: 1 })!;
    expect(split.total).toBe(3);
  });
});

describe('arsenalBrief — fotografia dell’arsenale', () => {
  it('conta voci, unità in servizio e produzione in corso', () => {
    const brief = arsenalBrief(
      [line(), line({ id: 'carri_3', quantity: 6 })],
      [order(), order({ equipmentId: 'carri_3', quantity: 12 }), order({ status: 'completed', quantity: 99 })],
    );
    expect(brief).toEqual({ lines: 2, units: 43, openOrders: 2, unitsInProduction: 52 });
    expect(arsenalBriefText(brief)).toBe('2 voci · 43 unità in servizio · 2 ordini in corso (52 pezzi)');
  });

  it('arsenale senza produzione: lo dichiara', () => {
    expect(arsenalBriefText(arsenalBrief([line()], []))).toBe('1 voce · 37 unità in servizio · nessuna produzione in corso');
  });

  it('dati assenti: fotografia vuota, nessun numero inventato', () => {
    expect(arsenalBrief(null, null)).toEqual({ lines: 0, units: 0, openOrders: 0, unitsInProduction: 0 });
    expect(arsenalBriefText(arsenalBrief(null, null))).toBe('0 voci · 0 unità in servizio · nessuna produzione in corso');
  });
});
