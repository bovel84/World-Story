/**
 * Test del registro dei fatti nazionali reali.
 *
 * La base di partenza di una nazione moderna (PIL, PIL pro capite, tesoreria)
 * deve essere coerente con il mondo reale: un paese piccolo non può ereditare
 * la scala economica di una grande potenza solo perché il modello ha stimato
 * male la popolazione. Il registro è la fonte, non l'LLM.
 */
import { describe, it, expect } from 'vitest';
import {
  estimatedNominalGdpUsdBillions,
  hasModernReferenceFacts,
  historicalNominalGdpUsdBillions,
  polityNameAliases,
  referenceDebtToGdpPct,
  referenceGdpUsdBillions,
  referencePopulation,
} from '../src/utils/country-facts';

describe('country-facts — registro reale 2024', () => {
  it('usa il PIL pubblicato, non una stima dalla popolazione', () => {
    // Tanzania reale: ~68,5 M di abitanti, ~79 mld di PIL. La vecchia stima
    // (popolazione × 9.500 $) produceva ~640 mld, dieci volte tanto.
    expect(estimatedNominalGdpUsdBillions('TZA', 67_000_000)).toBeCloseTo(79, 0);
    expect(estimatedNominalGdpUsdBillions('EGY', 10_000_000)).toBeGreaterThan(300);
    expect(estimatedNominalGdpUsdBillions('ITA', 12_000_000)).toBeCloseTo(2383, -1);
    expect(estimatedNominalGdpUsdBillions('USA', 336_000_000)).toBeGreaterThan(25_000);
  });

  it('espone popolazione e PIL di riferimento coerenti', () => {
    expect(referencePopulation('TZA')!).toBeGreaterThan(60_000_000);
    expect(referencePopulation('TZA')!).toBeLessThan(80_000_000);
    expect(referenceGdpUsdBillions('GHA')!).toBeGreaterThan(60);
    expect(referenceGdpUsdBillions('GHA')!).toBeLessThan(120);
    expect(referencePopulation('ITA')!).toBeGreaterThan(55_000_000);
    expect(referenceGdpUsdBillions('TWN')).toBeGreaterThan(500);
  });

  it('per i micro territori senza serie stima dal reddito pro capite', () => {
    const estimated = estimatedNominalGdpUsdBillions('ATA', 1_000);
    expect(Number.isFinite(estimated)).toBe(true);
    expect(estimated).toBeGreaterThanOrEqual(1);
  });

  it('espone il debito pubblico reale in % del PIL', () => {
    // Il Giappone e l'Italia sono tra i più indebitati; la Tanzania è moderata.
    expect(referenceDebtToGdpPct('JPN')).toBeGreaterThan(180);
    expect(referenceDebtToGdpPct('ITA')).toBeGreaterThan(110);
    expect(referenceDebtToGdpPct('USA')).toBeGreaterThan(90);
    expect(referenceDebtToGdpPct('TZA')).toBeGreaterThan(20);
    expect(referenceDebtToGdpPct('TZA')).toBeLessThan(90);
    // Un territorio senza serie non nasce a debito zero: resta il valore prudente.
    expect(referenceDebtToGdpPct('ATA')).toBe(50);
  });

  it('applica i fatti moderni solo dal 1990 in poi', () => {
    expect(hasModernReferenceFacts('2026-01-01')).toBe(true);
    expect(hasModernReferenceFacts('2024-01-01')).toBe(true);
    expect(hasModernReferenceFacts('1951-01-01')).toBe(false);
    expect(hasModernReferenceFacts('1939-09-01')).toBe(false);
    expect(hasModernReferenceFacts(undefined)).toBe(false);
  });

  it('esclude i fatti 2024 dai mondi storici e usa la tabella di conversione', () => {
    // Tabella: USA 1951 = 346 mld (non i ~29.000 dei fatti 2024).
    expect(historicalNominalGdpUsdBillions('USA', 153_000_000, { startDate: '1951-01-01' })).toBe(346);
    expect(historicalNominalGdpUsdBillions('USA', 153_000_000, { startDate: '1939-09-01' })).toBe(92);
    // Un anno senza riga usa la più vicina.
    expect(historicalNominalGdpUsdBillions('GBR', 50_000_000, { startDate: '1948-01-01' })).toBe(40);
    // Paese non in tabella: ripiego su popolazione × reddito pro capite d'epoca,
    // mai sui fatti 2024.
    const fallback = historicalNominalGdpUsdBillions('NZL', 2_000_000, { startDate: '1951-01-01' });
    expect(fallback).toBeGreaterThan(0);
    expect(fallback).toBeLessThan(10);
    // Senza popolazione né tabella: ancora sull'indice di mappa.
    expect(historicalNominalGdpUsdBillions('ZZZ', 0, { gdpIndex: 5 })).toBe(5);
    // Il percorso moderno continua a usare il registro reale.
    expect(estimatedNominalGdpUsdBillions('USA', 153_000_000)).toBeGreaterThan(25_000);
    // E il percorso storico instrada la tabella anche via `estimated`.
    expect(estimatedNominalGdpUsdBillions('USA', 153_000_000, { modernFacts: false, startDate: '1951-01-01' })).toBe(346);
  });

  it('gli alias di una politia sono codice, nome del registro e nome italiano', () => {
    // Unica fonte condivisa con il resolver dei nomi e col ReactionContext:
    // il contratto fail-closed elenca la controparte solo se la riconosce.
    const aliases = polityNameAliases('POL', 'Poland');
    expect(aliases).toContain('POL');
    expect(aliases).toContain('Poland');
    expect(aliases).toContain('Polonia');
    // Nessun duplicato quando il registro coincide col nome italiano.
    expect(polityNameAliases('ITA', 'Italia')).toEqual(['ITA', 'Italia']);
    // Paese fuori tabella: resta il codice, più il nome del registro se c'è.
    expect(polityNameAliases('ZZZ')).toEqual(['ZZZ']);
    expect(polityNameAliases('ZZZ', 'Zedland')).toEqual(['ZZZ', 'Zedland']);
  });
});
