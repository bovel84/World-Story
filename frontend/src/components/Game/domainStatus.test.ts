/**
 * COUNTRY-CLARITY — linguaggio comune dei domini.
 * Soglie di stato, autonomia dichiarata, priorità delle attenzioni.
 */
import { describe, it, expect } from 'vitest';
import {
  DOMAIN_STATUS_LABEL, attentionFrom, autonomyMonths, autonomyText, dossierTone, driverPriority,
  finiteOrNull, mergeDrivers, sharePct, statusDossierTone, statusTone, worstStatus,
} from './domainStatus';

describe('COUNTRY-CLARITY · domainStatus', () => {
  it('stato peggiore e tono: il dominio si legge dal punto debole', () => {
    expect(worstStatus(['healthy', 'stable', 'pressure'])).toBe('pressure');
    expect(worstStatus(['critical', 'fragile'])).toBe('critical');
    expect(worstStatus([])).toBe('healthy');
    expect(statusTone('critical')).toBe('critical');
    expect(statusTone('fragile')).toBe('warning');
    expect(statusTone('pressure')).toBe('warning');
    expect(statusTone('healthy')).toBe('positive');
    expect(statusTone('stable')).toBe('neutral');
    expect(DOMAIN_STATUS_LABEL.critical).toBe('Critico');
    expect(dossierTone('critical')).toBe('negative');
    expect(dossierTone('warning')).toBe('warning');
    expect(statusDossierTone('fragile')).toBe('warning');
    expect(statusDossierTone('healthy')).toBe('positive');
    expect(statusDossierTone('stable')).toBe('neutral');
  });

  it('priorità dei driver: prima i problemi, poi le notizie neutre', () => {
    expect(driverPriority('critical')).toBeLessThan(driverPriority('warning'));
    expect(driverPriority('warning')).toBeLessThan(driverPriority('neutral'));
    expect(driverPriority('neutral')).toBeLessThan(driverPriority('positive'));
  });

  it('attenzioni: dal dominio peggiore, senza ripetizioni, entro il limite', () => {
    const attention = attentionFrom([
      { id: 'a', label: 'Economia', status: 'stable', drivers: [{ tone: 'positive', label: 'avanzo' }] },
      { id: 'b', label: 'Risorse', status: 'fragile', drivers: [{ tone: 'warning', label: 'carburante' }, { tone: 'critical', label: 'cibo' }] },
      { id: 'c', label: 'Governo', status: 'critical', drivers: [{ tone: 'critical', label: 'rivolta' }, { tone: 'warning', label: 'carburante' }] },
    ], 5);
    expect(attention.map(item => item.label)).toEqual(['rivolta', 'carburante', 'cibo']);
    expect(attention[0].domain).toBe('Governo');
    expect(attention).toHaveLength(3);
    expect(attentionFrom([{ id: 'x', label: 'Economia', status: 'stable', drivers: [{ tone: 'positive', label: 'avanzo' }] }])).toEqual([]);
  });

  it('mergeDrivers ordina per gravità mantenendo l’ordine a parità di tono', () => {
    const merged = mergeDrivers([[{ tone: 'positive', label: 'p1' }], [{ tone: 'critical', label: 'c1' }, { tone: 'warning', label: 'w1' }]]);
    expect(merged.map(driver => driver.label)).toEqual(['c1', 'w1', 'p1']);
  });

  it('autonomia: saldo negativo, positivo, zero e dato mancante', () => {
    expect(autonomyMonths(82, -19).text).toBe('4,3 mesi');
    expect(autonomyMonths(82, -19).months).toBeCloseTo(4.3, 1);
    expect(autonomyMonths(200, -5).text).toBe('>12 mesi');
    expect(autonomyMonths(10, -5).text).toBe('2,0 mesi');
    expect(autonomyMonths(3, 3)).toEqual({ months: null, selfSustaining: true, text: 'non critica' });
    expect(autonomyMonths(5, 0)).toEqual({ months: null, selfSustaining: true, text: 'non critica' });
    expect(autonomyMonths(0, 0).text).toBe('dato non disponibile');
    expect(autonomyMonths(null, -5).text).toBe('dato non disponibile');
    expect(autonomyMonths(4, null).text).toBe('dato non disponibile');
    expect(autonomyMonths(0, -3).text).toBe('esaurita');
    expect(autonomyText(2, -1)).toBe('2,0 mesi');
    // Nessun numero infinito o ingannevole, qualunque sia l'input.
    for (const [stock, net] of [[1e9, -0.0001], [0, -0.0001], [-5, -2], [Number.NaN, -2]] as const) {
      const reading = autonomyMonths(stock as number, net as number);
      expect(Number.isFinite(reading.months ?? 0)).toBe(true);
      expect(reading.text.length).toBeGreaterThan(0);
    }
  });

  it('guardie numeriche: zero ≠ dato mancante', () => {
    expect(finiteOrNull(0)).toBe(0);
    expect(finiteOrNull('')).toBeNull();
    expect(finiteOrNull(undefined)).toBeNull();
    expect(finiteOrNull(Number.NaN)).toBeNull();
    expect(finiteOrNull('12.5')).toBe(12.5);
    expect(sharePct(1, 4)).toBe(25);
    expect(sharePct(1, 0)).toBeNull();
    expect(sharePct(null, 4)).toBeNull();
    expect(sharePct(9, 4)).toBe(100);
  });
});
