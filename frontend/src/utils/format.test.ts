/**
 * World Story — U03 µ1: test della formattazione condivisa del Dossier Nazione
 * =========================================================================
 * Verifica che denaro, unità e periodi siano formattati in modo coerente e
 * leggibile in italiano, e che i valori non validi non producano "NaN" o
 * "undefined".
 */
import { describe, it, expect } from 'vitest';
import { formatNumber, formatMoney, formatPercent, formatDate, formatPeriod, decimalsForUnit, formatDecimal, formatFigureValue, formatNarratedDecimals } from './format';

describe('format (U03 µ1)', () => {
  describe('formatNumber', () => {
    it('formatta le unità con separatore delle migliaia it-IT', () => {
      expect(formatNumber(1234567)).toBe('1.234.567');
      expect(formatNumber(1000)).toBe('1.000');
    });

    it('gestisce valori null/undefined/non-finiti con «—»', () => {
      expect(formatNumber(null)).toBe('—');
      expect(formatNumber(undefined)).toBe('—');
      expect(formatNumber(NaN)).toBe('—');
      expect(formatNumber(Infinity)).toBe('—');
    });
  });

  describe('formatMoney', () => {
    it('formatta il denaro con separatore it-IT', () => {
      expect(formatMoney(1234567)).toBe('1.234.567');
    });

    it('appende la valuta se richiesta', () => {
      expect(formatMoney(600, { currency: 'TEST' })).toBe('600 TEST');
      expect(formatMoney(1.5, { currency: 'mld', decimals: 1 })).toBe('1,5 mld');
    });

    it('antepone il segno esplicito se richiesto', () => {
      expect(formatMoney(120, { sign: true })).toBe('+120');
      expect(formatMoney(-80, { sign: true })).toBe('−80');
      expect(formatMoney(0, { sign: true })).toBe('0');
    });

    it('gestisce valori non validi con «—»', () => {
      expect(formatMoney(null)).toBe('—');
      expect(formatMoney(undefined)).toBe('—');
      expect(formatMoney(NaN)).toBe('—');
    });
  });

  describe('formatPercent', () => {
    it('formatta la percentuale con separatore it-IT', () => {
      expect(formatPercent(42.5, 1)).toBe('42,5%');
      expect(formatPercent(100)).toBe('100%');
    });

    it('gestisce valori non validi con «—»', () => {
      expect(formatPercent(null)).toBe('—');
      expect(formatPercent(Infinity)).toBe('—');
    });
  });

  describe('formatDate / formatPeriod', () => {
    it('legge la data ISO come calendario di simulazione, non timestamp locale', () => {
      expect(formatDate('1951-01-04')).toBe('4 gen 1951');
      expect(formatDate('1951-12-31')).toBe('31 dic 1951');
    });

    it('formatta un periodo da inizio a fine', () => {
      expect(formatPeriod('1951-01-01', '1951-01-04')).toBe('1 gen 1951 — 4 gen 1951');
    });

    it('gestisce periodi con un solo estremo o assenti', () => {
      expect(formatPeriod('1951-01-01', null)).toBe('1 gen 1951');
      expect(formatPeriod(null, null)).toBe('—');
    });
  });

  /**
   * WS-GOVOFFICE-05B — Il formato delle cifre del ministro.
   * Il motore manda i valori PIENI; qui si difende la resa: 2 decimali per gli
   * assoluti, 1 per le percentuali, virgola italiana, punto per le migliaia.
   * Una cifra ignota non diventa mai 0.
   */
  describe('WS-GOVOFFICE-05B — le cifre del ministro', () => {
    it('decimalsForUnit: 1 decimale per le percentuali, 2 per il resto', () => {
      expect(decimalsForUnit('%')).toBe(1);
      expect(decimalsForUnit('% del PIL')).toBe(1);
      expect(decimalsForUnit('mld')).toBe(2);
      expect(decimalsForUnit('/100')).toBe(2);
    });

    it('formatDecimal: virgola it-IT, migliaia col punto, segno conservato', () => {
      expect(formatDecimal(1234.5)).toBe('1.234,50');
      expect(formatDecimal(-12.345)).toBe('-12,35');
      expect(formatDecimal(0)).toBe('0,00');
      expect(formatDecimal(NaN)).toBe('—');
    });

    it('formatFigureValue: dal valore pieno del motore a 2 decimali', () => {
      // Il caso dell'evidenza: 17 decimali → «0,06».
      expect(formatFigureValue('0.06241708333333345', 'mld')).toBe('0,06 mld');
      expect(formatFigureValue('0.06575272084693667', 'mld')).toBe('0,07 mld');
      // Migliaia col punto, 2 decimali.
      expect(formatFigureValue(1234.5, 'mld')).toBe('1.234,50 mld');
      // Percentuali: 1 decimale.
      expect(formatFigureValue('29.4', '%')).toBe('29,4 %');
      expect(formatFigureValue('0.2', '%')).toBe('0,2 %');
      expect(formatFigureValue('3.2', '%')).toBe('3,2 %');
      expect(formatFigureValue('9.1', '%')).toBe('9,1 %');
      // Una percentuale composta (% del PIL) resta a 1 decimale.
      expect(formatFigureValue('1.7', '% del PIL')).toBe('1,7 % del PIL');
      // Negativi (un deficit) col segno.
      expect(formatFigureValue('-5.5', 'mld')).toBe('-5,50 mld');
      // Non numerico: torna com'era, non diventa 0.
      expect(formatFigureValue('', '')).toBe('');
      expect(formatFigureValue('n/d', 'unità')).toBe('n/d unità');
    });

    it('formatNarratedDecimals: formatta SOLO i decimali, non gli interi', () => {
      // Il «perché» reale del Tesoro: 17 decimali → 2; percentuali → 1.
      expect(formatNarratedDecimals('Il saldo è 0.06575272084693667 mld (0.2% del PIL), al 30.4%.'))
        .toBe('Il saldo è 0,07 mld (0,2% del PIL), al 30,4%.');
      // Gli interi NON si toccano: il conteggio resta «1», non diventa «1,00».
      expect(formatNarratedDecimals('Ho 1 cosa da portare al consiglio.')).toBe('Ho 1 cosa da portare al consiglio.');
      expect(formatNarratedDecimals('Ho 2 cose da portare, 1 urgente.')).toBe('Ho 2 cose da portare, 1 urgente.');
      // Un numero già raggruppato non si spezza.
      expect(formatNarratedDecimals('popolazione di 61.000.000 abitanti')).toBe('popolazione di 61.000.000 abitanti');
      // Testo vuoto: invariato.
      expect(formatNarratedDecimals('')).toBe('');
    });
  });
});
