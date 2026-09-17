/**
 * DECISION-IMPACT — il giocatore deve vedere **quanto** ha inciso una decisione.
 *
 * Turno 8 dell'utente: cassa in calo, nessun modo di attribuire la variazione
 * alle proprie scelte. Il motore conosce l'addebito di ogni ordine eseguito
 * (`settleOrderCosts`) e registra la variazione per turno (storico conti); qui
 * i due dati vengono composti, senza inventare nulla.
 */
import { describe, expect, it } from 'vitest';
import { deriveDecisionImpact, type DecisionRecord } from './decisionImpact';
import { deriveCheckpointImpact } from './checkpointImpact';

const TURN_IMPACT = deriveCheckpointImpact(
  { account: { money: 7.61, monthlyBalance: 0.132, stability: 42.7, socialTension: 42.7, gdp: 10.119, warEffort: 15 } },
  { account: { money: -3.08, monthlyBalance: 0.13, stability: 42.2, socialTension: 44.4, gdp: 10.127, warEffort: 15 } },
);

function decision(action: string, settlement: DecisionRecord['settlement']): DecisionRecord {
  return { turn: 6, action, settlement };
}

describe('DECISION-IMPACT — effetto misurato di ogni decisione', () => {
  it('mostra l’addebito per ordine con segno negativo e categoria', () => {
    const impact = deriveDecisionImpact(
      [decision('Costruire una ferrovia verso il confine', { kind: 'charged', requestedMld: 0.28, chargedMld: 0.28, label: 'Infrastrutture' })],
      TURN_IMPACT,
    );
    expect(impact.available).toBe(true);
    expect(impact.effects).toHaveLength(1);
    expect(impact.effects[0].effectText).toBe('−0,28 mld');
    expect(impact.effects[0].detail).toContain('Infrastrutture');
    expect(impact.effects[0].tone).toBe('negative');
  });

  it('somma gli addebiti e calcola la quota NON attribuibile dal delta registrato', () => {
    const impact = deriveDecisionImpact([
      decision('Richiamare due battaglioni di riserva', { kind: 'charged', requestedMld: 0.2, chargedMld: 0.2, label: 'Difesa' }),
      decision('Aprire un negoziato commerciale', { kind: 'charged', requestedMld: 0.08, chargedMld: 0.08, label: 'Diplomazia' }),
    ], TURN_IMPACT);

    expect(impact.attributedMld).toBeCloseTo(0.28, 6);
    expect(impact.attributedText).toBe('−0,28 mld');
    // Variazione del turno −10,69 mld registrata dal motore: il residuo è ciò
    // che le decisioni non spiegano (gestione ordinaria, debito, ciclo).
    expect(impact.turnMoneyDelta).toBeCloseTo(-10.69, 6);
    expect(impact.unattributedMld).toBeCloseTo(-10.41, 2);
    expect(impact.unattributedText).toBe('−10,41 mld');
  });

  it('un ordine annullato per cassa: nessuna spesa, ma la decisione è visibile', () => {
    const impact = deriveDecisionImpact(
      [decision('Costruire un ponte sul fiume', { kind: 'unfunded', requestedMld: 0.4, chargedMld: 0, label: 'Infrastrutture' })],
      TURN_IMPACT,
    );
    expect(impact.available).toBe(true);
    expect(impact.attributedMld).toBe(0);
    expect(impact.attributedText).toBe('0,00 mld');
    expect(impact.effects[0].tone).toBe('warning');
    expect(impact.effects[0].detail).toContain('nessuna spesa registrata');
    // Il residuo resta l'intera variazione: nulla è stato speso.
    expect(impact.unattributedMld).toBeCloseTo(-10.69, 6);
  });

  it('copertura parziale: dichiara quanto è stato addebitato su quanto richiesto', () => {
    const impact = deriveDecisionImpact(
      [decision('Riformare l’esercito', { kind: 'partial', requestedMld: 2, chargedMld: 0.5, label: 'Difesa' })],
      TURN_IMPACT,
    );
    expect(impact.effects[0].effectText).toBe('−0,50 mld');
    expect(impact.effects[0].detail).toContain('dei 2 mld stimati');
    expect(impact.effects[0].tone).toBe('warning');
  });

  it('gli indicatori registrati solo per turno NON sono attribuiti alla decisione', () => {
    const impact = deriveDecisionImpact(
      [decision('Sopprimere una guarnigione', { kind: 'charged', requestedMld: 2, chargedMld: 2, label: 'Difesa' })],
      TURN_IMPACT,
    );
    const labels = impact.notAttributable.map(delta => delta.label);
    expect(labels).toContain('Stabilità');
    expect(labels).toContain('Tensione sociale');
    expect(labels).not.toContain('Tesoreria');
    expect(impact.note).toContain('non per singola decisione');
  });

  it('senza addebito registrato lo dichiara invece di inventare un importo', () => {
    const impact = deriveDecisionImpact([{ turn: 3, action: 'Ordine del passato', settlement: null }], TURN_IMPACT);
    expect(impact.available).toBe(false);
    expect(impact.effects).toEqual([]);
    expect(impact.attributedMld).toBe(0);
    // La variazione del turno resta leggibile: è il motore ad averla registrata.
    expect(impact.turnMoneyDelta).toBeCloseTo(-10.69, 6);
    expect(impact.note).toContain('non registra l\'addebito dei singoli ordini');
  });

  it('senza delta del turno non inventa la quota non attribuibile', () => {
    const impact = deriveDecisionImpact(
      [decision('Ordine qualunque', { kind: 'charged', requestedMld: 1, chargedMld: 1, label: 'Difesa' })],
      null,
    );
    expect(impact.turnMoneyDelta).toBeNull();
    expect(impact.unattributedMld).toBeNull();
    expect(impact.unattributedText).toBeNull();
    expect(impact.attributedText).toBe('−1,00 mld');
  });

  it('una decisione senza addebito (ordine respinto) non produce effetto', () => {
    const impact = deriveDecisionImpact([{ turn: 6, action: 'Dichiarare guerra al mondo intero' }], TURN_IMPACT);
    expect(impact.available).toBe(false);
    expect(impact.effects).toEqual([]);
  });

  it('valori non numerici non entrano nei conti', () => {
    const impact = deriveDecisionImpact(
      [decision('Ordine corrotto', { kind: 'charged', requestedMld: NaN, chargedMld: NaN, label: 'X' })],
      TURN_IMPACT,
    );
    expect(impact.effects).toEqual([]);
    expect(impact.attributedMld).toBe(0);
  });
});
