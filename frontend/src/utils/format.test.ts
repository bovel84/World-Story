/**
 * World Story — U03 µ1: test della formattazione condivisa del Dossier Nazione
 * =========================================================================
 * Verifica che denaro, unità e periodi siano formattati in modo coerente e
 * leggibile in italiano, e che i valori non validi non producano "NaN" o
 * "undefined".
 */
import { describe, it, expect } from 'vitest';
import { formatNumber, formatMoney, formatPercent, formatDate, formatPeriod } from './format';

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
});
