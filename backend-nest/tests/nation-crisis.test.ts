/**
 * Crisi nazionale e fine partita: le tre strade del collasso sono calcolate
 * dagli indicatori reali, non inventate. Stessi numeri → stesso esito.
 */
import { describe, it, expect } from 'vitest';
import {
  advanceCrisis,
  assessCrisis,
  CRISIS_COLLAPSE_STREAK,
  CRISIS_CRITICAL_SCORE,
  CRISIS_WATCH_SCORE,
  describeCrisis,
  type CrisisInput,
} from '../src/core/simulation/NationCrisis';

const base: CrisisInput = {
  stability: 72,
  socialTension: 18,
  annualGrowthRate: 0.021,
  monthlyBalance: 0.4,
  nominalGdpUsdBillions: 120,
  debtRatioPct: 30,
  debtServicePct: 6,
  baselineDebtRatioPct: 0,
  overdraftMld: 0,
  foodCoverageMonths: 4,
  taxRatePct: 10,
  militaryPower: 120,
  hostileNeighbours: [{ polityId: 'FRA', name: 'Francia', militaryPower: 150 }],
  atWar: false,
};

describe('valutazione della crisi', () => {
  it('una nazione sana non rischia nulla', () => {
    const { level, risks } = assessCrisis(base);
    expect(level).toBe('calm');
    for (const risk of risks) {
      expect(risk.level).toBe('calm');
      expect(risk.score).toBeLessThan(CRISIS_WATCH_SCORE);
    }
  });

  it('la rivolta cresce con tensione, fame e disavanzo', () => {
    const { risks } = assessCrisis({
      ...base,
      stability: 24,
      socialTension: 82,
      foodCoverageMonths: 0.4,
      annualGrowthRate: -0.04,
      monthlyBalance: -3.5,
    });
    const revolt = risks.find(risk => risk.dimension === 'revolt')!;
    expect(revolt.level).toBe('critical');
    expect(revolt.score).toBeGreaterThanOrEqual(CRISIS_CRITICAL_SCORE);
    expect(revolt.drivers.join(' ')).toMatch(/cibo/);
  });

  it('un prelievo oltre il 28% del PIL alimenta la rivolta', () => {
    const { risks } = assessCrisis({ ...base, stability: 30, socialTension: 55, taxRatePct: 42 });
    const revolt = risks.find(risk => risk.dimension === 'revolt')!;
    expect(revolt.level).toBe('critical');
    expect(revolt.drivers.join(' ')).toMatch(/pressione fiscale 42/);
  });

  it('il default cresce con debito, servizio e scoperto di cassa', () => {
    const { risks } = assessCrisis({
      ...base,
      debtRatioPct: 165,
      debtServicePct: 44,
      overdraftMld: 30,
      nominalGdpUsdBillions: 60,
    });
    const insolvency = risks.find(risk => risk.dimension === 'insolvency')!;
    expect(insolvency.level).toBe('critical');
    expect(insolvency.drivers.join(' ')).toMatch(/scoperto/);
  });

  it('un debito ereditato alto non è di per sé un default', () => {
    // Italia o Giappone moderni: partono indebitati ma non stanno fallendo.
    const { risks } = assessCrisis({
      ...base,
      debtRatioPct: 137,
      debtServicePct: 36,
      baselineDebtRatioPct: 137,
    });
    const insolvency = risks.find(risk => risk.dimension === 'insolvency')!;
    expect(insolvency.level).toBe('calm');
    // È il debito NUOVO a far scattare l'allarme.
    const deteriorated = assessCrisis({
      ...base,
      debtRatioPct: 210,
      debtServicePct: 58,
      baselineDebtRatioPct: 137,
    }).risks.find(risk => risk.dimension === 'insolvency')!;
    expect(deteriorated.level).not.toBe('calm');
    expect(deteriorated.score).toBeGreaterThan(insolvency.score);
  });

  it('l’invasione cresce con la sproporzione militare e la fragilità interna', () => {
    const { risks } = assessCrisis({
      ...base,
      stability: 30,
      militaryPower: 40,
      hostileNeighbours: [{ polityId: 'RUS', name: 'Unione Sovietica', militaryPower: 300 }],
      atWar: true,
    });
    const invasion = risks.find(risk => risk.dimension === 'invasion')!;
    expect(invasion.level).toBe('critical');
    expect(invasion.drivers.join(' ')).toMatch(/vicino ostile/);
  });

  it('vivere accanto a un gigante ostile non è di per sé un’invasione', () => {
    // Una nazione piccola accanto a una grande potenza: allarme, non collasso.
    const { risks } = assessCrisis({
      ...base,
      stability: 22,
      militaryPower: 1,
      hostileNeighbours: [{ polityId: 'RUS', name: 'Russia', militaryPower: 70 }],
      atWar: false,
    });
    const invasion = risks.find(risk => risk.dimension === 'invasion')!;
    expect(invasion.level).not.toBe('critical');
    expect(invasion.score).toBeLessThan(CRISIS_CRITICAL_SCORE);
  });

  it('è deterministica: stessi indicatori, stesso punteggio', () => {
    const first = assessCrisis({ ...base, stability: 33, socialTension: 71 });
    const second = assessCrisis({ ...base, stability: 33, socialTension: 71 });
    expect(second).toEqual(first);
  });
});

describe('progressione verso il collasso', () => {
  const critical: CrisisInput = {
    ...base,
    stability: 20,
    socialTension: 85,
    foodCoverageMonths: 0.5,
    annualGrowthRate: -0.05,
    monthlyBalance: -4,
  };
  it('un solo turno critico non chiude la partita', () => {
    const state = advanceCrisis(critical, {}, { turn: 4, date: '1952-02-01' });
    expect(state.level).toBe('critical');
    expect(state.ending).toBeNull();
    expect(state.streaks.revolt).toBe(1);
  });

  it(`dopo ${CRISIS_COLLAPSE_STREAK} turni critici la nazione cade`, () => {
    let streaks = {};
    let state = advanceCrisis(critical, streaks, { turn: 1, date: '1951-10-01' });
    for (let turn = 2; turn <= CRISIS_COLLAPSE_STREAK; turn++) {
      streaks = state.streaks;
      state = advanceCrisis(critical, streaks, { turn, date: `1952-0${turn}-01` });
    }
    expect(state.streaks.revolt).toBe(CRISIS_COLLAPSE_STREAK);
    expect(state.ending).not.toBeNull();
    expect(state.ending!.kind).toBe('revolution');
    expect(state.ending!.dimension).toBe('revolt');
    expect(state.ending!.turn).toBe(CRISIS_COLLAPSE_STREAK);
  });

  it('reagire in tempo azzera la serie e salva la nazione', () => {
    let state = advanceCrisis(critical, {}, { turn: 1, date: '1951-10-01' });
    state = advanceCrisis(critical, state.streaks, { turn: 2, date: '1951-11-01' });
    expect(state.streaks.revolt).toBe(2);
    // Il governo corregge la rotta: stabilità e consenso tornano.
    const saved = advanceCrisis(base, state.streaks, { turn: 3, date: '1951-12-01' });
    expect(saved.streaks.revolt).toBe(0);
    expect(saved.ending).toBeNull();
    expect(saved.level).toBe('calm');
  });

  it('una lettura pura non fa avanzare la scala né può chiudere la partita', () => {
    const state = advanceCrisis(critical, { revolt: 2 } as any, { turn: 3, date: '1951-12-01', advance: false });
    expect(state.streaks.revolt).toBe(2);
    expect(state.ending).toBeNull();
  });

  it('il collasso sceglie la dimensione col punteggio peggiore', () => {
    const both: CrisisInput = {
      ...critical,
      stability: 10,
      socialTension: 95,
      debtRatioPct: 220,
      debtServicePct: 60,
      overdraftMld: 50,
      nominalGdpUsdBillions: 40,
    };
    let state = advanceCrisis(both, {}, { turn: 1, date: '1951-10-01' });
    for (let turn = 2; turn <= CRISIS_COLLAPSE_STREAK; turn++) {
      state = advanceCrisis(both, state.streaks, { turn, date: `1952-0${turn}-01` });
    }
    expect(state.ending).not.toBeNull();
    expect(state.ending!.criticalDimensions.length).toBeGreaterThanOrEqual(2);
    // L'epilogo è quello col punteggio più alto fra i critici.
    const worst = state.risks
      .filter(risk => risk.level === 'critical')
      .sort((left, right) => right.score - left.score)[0];
    expect(state.ending!.dimension).toBe(worst.dimension);
  });
});

describe('descrizione per il prompt', () => {
  it('riassume le tre dimensioni con livello e serie', () => {
    const state = advanceCrisis(base, {}, { turn: 1, date: '1951-10-01' });
    const text = describeCrisis(state);
    expect(text).toMatch(/Rischio di rivolta/);
    expect(text).toMatch(/Rischio di default/);
    expect(text).toMatch(/Rischio di invasione/);
    expect(text).toMatch(/serie 0\/3/);
  });
});
