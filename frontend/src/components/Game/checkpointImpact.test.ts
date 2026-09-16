/**
 * LW02 — Impatto dei checkpoint: delta deterministici before → after.
 */
import { describe, expect, it } from 'vitest';
import { deriveCheckpointImpact, impactsByTurn } from './checkpointImpact';

describe('LW02 — deriveCheckpointImpact', () => {
  it('calcola i delta del conto e li formatta con segno', () => {
    const impact = deriveCheckpointImpact(
      { account: { money: 10, stability: 60, socialTension: 30 } },
      { account: { money: 9.7, stability: 56, socialTension: 36 } },
    );
    const byId = Object.fromEntries(impact.deltas.map(d => [d.id, d]));
    expect(byId.money.text).toBe('−0.30 mld');
    expect(byId.money.tone).toBe('negative');
    expect(byId.stability.text).toBe('−4 pt');
    expect(byId.stability.tone).toBe('negative');
    expect(byId.socialTension.text).toBe('+6 pt');
    expect(byId.socialTension.tone).toBe('negative'); // scendere è positivo
  });

  it('non mostra variazioni sotto la soglia di rumore', () => {
    const impact = deriveCheckpointImpact(
      { account: { money: 10, stability: 50 } },
      { account: { money: 10, stability: 50.001 } },
    );
    expect(impact.hasChanges).toBe(false);
    expect(impact.deltas).toHaveLength(0);
  });

  it('segna come positivo ciò che migliora nella giusta direzione', () => {
    const impact = deriveCheckpointImpact(
      { account: { socialTension: 60, debtRatioPct: 55 } },
      { account: { socialTension: 52, debtRatioPct: 48 } },
    );
    const byId = Object.fromEntries(impact.deltas.map(d => [d.id, d]));
    expect(byId.socialTension.tone).toBe('positive');
    expect(byId.debtRatioPct.text).toBe('−7.0 pt');
    expect(byId.debtRatioPct.tone).toBe('positive');
  });

  it('confronta anche il magazzino materiale quando presente', () => {
    const impact = deriveCheckpointImpact(
      { resources: { food: 12, weapons: 4 } },
      { resources: { food: 9, weapons: 7 } },
    );
    const ids = impact.deltas.map(d => d.id);
    expect(ids).toContain('res-food');
    expect(ids).toContain('res-weapons');
  });

  it('ignora le metriche che il motore non ha pubblicato', () => {
    const impact = deriveCheckpointImpact({ account: { money: 1 } }, { account: { money: 2 } });
    expect(impact.deltas.map(d => d.id)).toEqual(['money']);
  });
});

describe('LW02 — impactsByTurn', () => {
  it('associa a ogni turno il delta rispetto al punto precedente', () => {
    const impacts = impactsByTurn([
      { date: '1951-01-01', turn: 1, account: { money: 10, stability: 60 } },
      { date: '1951-02-01', turn: 2, account: { money: 9, stability: 58 } },
      { date: '1951-03-01', turn: 3, account: { money: 9.5, stability: 61 } },
    ]);
    expect(impacts.get(1)).toBeUndefined(); // nessun punto precedente
    expect(impacts.get(2)?.deltas.find(d => d.id === 'money')?.text).toBe('−1.00 mld');
    expect(impacts.get(3)?.deltas.find(d => d.id === 'stability')?.tone).toBe('positive');
  });

  it('usa l’indice quando il turno non è disponibile', () => {
    const impacts = impactsByTurn([
      { date: '1951-01-01', account: { money: 1 } },
      { date: '1951-02-01', account: { money: 2 } },
    ]);
    expect(impacts.get(1)?.deltas[0].delta).toBe(1);
  });
});
