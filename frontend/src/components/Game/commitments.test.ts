/**
 * Registro degli impegni: il client traduce tipo, stato e scadenza già calcolati
 * dal motore. Nessun conteggio di giorni inventato e nessuno stato dedotto.
 */
import { describe, expect, it } from 'vitest';
import {
  activeCommitmentsOf, commitmentBriefingLine, commitmentPartiesText, commitmentStatusLabel,
  commitmentTimingText, commitmentTone, commitmentTypeLabel, daysUntil, formatCommitmentDate,
  sortCommitments,
} from './commitments';
import type { Commitment } from '../../services/api';

const commitment = (over: Partial<Commitment> = {}): Commitment => ({
  id: 'ITA|FRA|treaty|patto', type: 'treaty', actor: 'ITA', counterparty: 'FRA',
  description: 'Patto di non aggressione', createdDate: '1951-01-01', createdTurn: 1,
  status: 'active', deadline: null, sourceEventId: null, importance: 3,
  updatedDate: '1951-01-01', updatedTurn: 1, note: '', ...over,
});

describe('GAMEPLAY-LONG — registro degli impegni', () => {
  it('traduce tipi e stati, senza inventare etichette', () => {
    expect(commitmentTypeLabel('treaty')).toBe('Trattato');
    expect(commitmentTypeLabel('ultimatum')).toBe('Ultimatum');
    expect(commitmentTypeLabel('boh')).toBe('boh');
    expect(commitmentStatusLabel('broken')).toBe('tradito');
    expect(commitmentStatusLabel('active')).toBe('in vigore');
    expect(commitmentStatusLabel('strano')).toBe('strano');
  });

  it('il tono segue lo stato e l’importanza del motore', () => {
    expect(commitmentTone(commitment({ status: 'broken' }))).toBe('critical');
    expect(commitmentTone(commitment({ status: 'fulfilled' }))).toBe('positive');
    expect(commitmentTone(commitment({ status: 'expired' }))).toBe('warning');
    expect(commitmentTone(commitment({ status: 'superseded' }))).toBe('neutral');
    expect(commitmentTone(commitment({ importance: 3 }))).toBe('warning');
    expect(commitmentTone(commitment({ importance: 1 }))).toBe('neutral');
  });

  it('conta i giorni residui solo con date leggibili', () => {
    expect(daysUntil('1951-01-31', '1951-01-01')).toBe(30);
    expect(daysUntil('1951-01-01', '1951-01-31')).toBe(-30);
    expect(daysUntil(null, '1951-01-01')).toBeNull();
    expect(daysUntil('non-data', '1951-01-01')).toBeNull();
  });

  it('racconta la scadenza con le date del motore', () => {
    expect(commitmentTimingText(commitment({ deadline: '1951-01-31' }), '1951-01-19')).toBe('scade fra 12 giorni');
    expect(commitmentTimingText(commitment({ deadline: '1951-01-20' }), '1951-01-19')).toBe('scade fra 1 giorno');
    expect(commitmentTimingText(commitment({ deadline: '1951-01-19' }), '1951-01-19')).toBe('scade oggi');
    expect(commitmentTimingText(commitment({ deadline: '1951-01-10' }), '1951-01-19')).toBe('scaduto il 10 gen 1951');
    expect(commitmentTimingText(commitment(), '1951-03-01')).toBe('dal 1 gen 1951');
  });

  it('mostra le parti e l’impegno interno', () => {
    expect(commitmentPartiesText(commitment())).toBe('ITA → FRA');
    expect(commitmentPartiesText(commitment({ counterparty: null }))).toBe('ITA (interno)');
  });

  it('ordina per urgenza reale: prima ciò che stringe', () => {
    const today = '1951-01-10';
    const sorted = sortCommitments([
      commitment({ id: 'storia', status: 'fulfilled', importance: 3 }),
      commitment({ id: 'lontano', importance: 3, deadline: '1952-01-01' }),
      commitment({ id: 'vicino', importance: 1, deadline: '1951-01-20' }),
      commitment({ id: 'tradito', status: 'broken', importance: 2 }),
      commitment({ id: 'vigore', importance: 2 }),
    ], today);
    expect(sorted.map(item => item.id)).toEqual(['vicino', 'lontano', 'vigore', 'tradito', 'storia']);
    // A parità di rango conta l'importanza, poi il turno: nessun ordine casuale.
    const tied = sortCommitments([
      commitment({ id: 'b', importance: 1, createdTurn: 5 }),
      commitment({ id: 'a', importance: 1, createdTurn: 5 }),
      commitment({ id: 'c', importance: 3, createdTurn: 2 }),
    ], today);
    expect(tied.map(item => item.id)).toEqual(['c', 'a', 'b']);
  });

  it('tiene solo gli impegni in vigore', () => {
    expect(activeCommitmentsOf([
      commitment({ id: 'a' }), commitment({ id: 'b', status: 'broken' }),
    ]).map(item => item.id)).toEqual(['a']);
    expect(activeCommitmentsOf(null)).toEqual([]);
  });

  it('la riga del briefing è completa ma breve', () => {
    const line = commitmentBriefingLine(commitment({ type: 'ultimatum', counterparty: 'AUT', deadline: '1951-01-22' }), '1951-01-10');
    expect(line).toBe('Ultimatum ITA → AUT: Patto di non aggressione · scade fra 12 giorni');
    expect(formatCommitmentDate('1815-09-08')).toBe('8 set 1815');
  });
});
