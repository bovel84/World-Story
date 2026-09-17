/**
 * Crisi nazionale e fine partita: le tre strade del collasso sono calcolate
 * dagli indicatori reali, non inventate. Stessi numeri → stesso esito.
 */
import { describe, it, expect } from 'vitest';
import {
  advanceCrisis,
  assessCrisis,
  CRISIS_ABRUPT_DAYS,
  CRISIS_COLLAPSE_DAYS,
  persistenceBonus,
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

describe('progressione verso il collasso (tempo di calendario)', () => {
  const critical: CrisisInput = {
    ...base,
    stability: 20,
    socialTension: 85,
    foodCoverageMonths: 0.5,
    annualGrowthRate: -0.05,
    monthlyBalance: -4,
  };

  it('una settimana di criticità non chiude la partita', () => {
    const state = advanceCrisis(critical, {}, { turn: 1, date: '1951-10-08', days: 7 });
    expect(state.level).toBe('critical');
    expect(state.ending).toBeNull();
    expect(state.criticalDays.revolt).toBe(7);
    expect(state.episodes.revolt).toBe(1);
    // Il pericolo è visibile: 7 giorni su 90.
    expect(state.criticalDays.revolt).toBeLessThan(CRISIS_COLLAPSE_DAYS);
    expect(state.risks.find(risk => risk.dimension === 'revolt')!.drivers.join(' ')).toMatch(/criticità da 7 giorni/);
  });

  it('sette giorni e centottanta giorni NON pesano uguale (P0 tempo)', () => {
    const week = advanceCrisis(critical, {}, { turn: 1, date: '1951-10-08', days: 7 });
    const halfYear = advanceCrisis(critical, {}, { turn: 1, date: '1951-10-08', days: 180 });
    // B progredisce molto più di A…
    expect(halfYear.criticalDays.revolt).toBeGreaterThan(week.criticalDays.revolt * 10);
    expect(persistenceBonus(halfYear.criticalDays.revolt))
      .toBeGreaterThan(persistenceBonus(week.criticalDays.revolt));
    // …e mezzo anno di criticità ininterrotta non lascia scampo.
    expect(week.ending).toBeNull();
    expect(halfYear.ending).not.toBeNull();
    expect(halfYear.ending!.kind).toBe('revolution');
    expect(halfYear.ending!.turn).toBe(1);
  });

  it('accumula giorni critici fino alla soglia: tre turni mensili come prima', () => {
    let state = advanceCrisis(critical, {}, { turn: 1, date: '1951-10-01', days: 30 });
    expect(state.criticalDays.revolt).toBe(30);
    expect(state.ending).toBeNull();
    state = advanceCrisis(critical, state, { turn: 2, date: '1951-10-31', days: 30 });
    expect(state.criticalDays.revolt).toBe(60);
    expect(state.ending).toBeNull();
    state = advanceCrisis(critical, state, { turn: 3, date: '1951-11-30', days: 30 });
    expect(state.criticalDays.revolt).toBe(CRISIS_COLLAPSE_DAYS);
    expect(state.ending).not.toBeNull();
    expect(state.ending!.dimension).toBe('revolt');
    expect(state.ending!.turn).toBe(3);
  });

  it('un solo avanzamento non basta al collasso: l’avvertimento è sempre osservabile', () => {
    // 89 giorni critici in un colpo solo: sotto la soglia, nessun collasso.
    const almost = advanceCrisis(critical, {}, { turn: 2, date: '1952-01-01', days: 89 });
    expect(almost.ending).toBeNull();
    // Anche superando la soglia, serve un secondo avanzamento critico osservato.
    const over = advanceCrisis(critical, { criticalDays: { revolt: 60 }, episodes: {} }, { turn: 2, date: '1952-01-01', days: 31 });
    expect(over.criticalDays.revolt).toBe(91);
    expect(over.episodes.revolt).toBe(1);
    expect(over.ending).toBeNull();
    const next = advanceCrisis(critical, over, { turn: 3, date: '1952-02-01', days: 1 });
    expect(next.episodes.revolt).toBe(2);
    expect(next.ending).not.toBeNull();
  });

  it('mezzo anno di criticità continua in un solo avanzamento non lascia scampo', () => {
    const state = advanceCrisis(critical, {}, { turn: 1, date: '1952-07-01', days: CRISIS_ABRUPT_DAYS });
    expect(state.ending).not.toBeNull();
    expect(state.ending!.summary).toMatch(/180 giorni/);
  });

  it('un salto di un anno è diverso da un passo piccolo', () => {
    const day = advanceCrisis(critical, {}, { turn: 1, date: '1951-10-02', days: 1 });
    const year = advanceCrisis(critical, {}, { turn: 1, date: '1952-10-01', days: 365 });
    expect(day.criticalDays.revolt).toBe(1);
    expect(day.ending).toBeNull();
    expect(year.criticalDays.revolt).toBe(365);
    expect(year.ending).not.toBeNull();
  });

  it('senza tempo trascorso la scala non si muove (nessun collasso a sorpresa)', () => {
    const state = advanceCrisis(critical, { criticalDays: { revolt: 90 }, episodes: { revolt: 2 } }, { turn: 4, date: '1952-02-01', days: 0 });
    expect(state.criticalDays.revolt).toBe(90);
    expect(state.episodes.revolt).toBe(2);
    expect(state.ending).toBeNull();
  });

  it('l’allarme accumula più lentamente della criticità', () => {
    const watch: CrisisInput = { ...base, stability: 42, socialTension: 58 };
    const state = advanceCrisis(watch, {}, { turn: 1, date: '1951-10-31', days: 30 });
    const risk = state.risks.find(item => item.dimension === 'revolt')!;
    expect(risk.level).toBe('watch');
    expect(state.criticalDays.revolt).toBe(9); // 30 giorni × 0.3
    expect(state.ending).toBeNull();
  });

  it('reagire in tempo consuma l’arretrato e salva la nazione', () => {
    let state = advanceCrisis(critical, {}, { turn: 1, date: '1951-10-01', days: 30 });
    state = advanceCrisis(critical, state, { turn: 2, date: '1951-10-31', days: 30 });
    expect(state.criticalDays.revolt).toBe(60);
    // Il governo corregge la rotta: stabilità e consenso tornano.
    const saved = advanceCrisis(base, state, { turn: 3, date: '1951-11-30', days: 30 });
    expect(saved.criticalDays.revolt).toBe(24); // 60 - 30 × 1.2
    expect(saved.episodes.revolt).toBe(0);
    expect(saved.ending).toBeNull();
    expect(saved.level).toBe('calm');
    const healed = advanceCrisis(base, saved, { turn: 4, date: '1951-12-30', days: 30 });
    expect(healed.criticalDays.revolt).toBe(0);
  });

  it('una lettura pura non fa avanzare la scala né può chiudere la partita', () => {
    const state = advanceCrisis(critical, { criticalDays: { revolt: 60 }, episodes: { revolt: 1 } } as any,
      { turn: 3, date: '1951-12-01', advance: false, days: 365 });
    expect(state.criticalDays.revolt).toBe(60);
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
    let state = advanceCrisis(both, {}, { turn: 1, date: '1951-10-01', days: 180 });
    expect(state.ending).not.toBeNull();
    expect(state.ending!.criticalDimensions.length).toBeGreaterThanOrEqual(2);
    const worst = state.risks
      .filter(risk => risk.level === 'critical')
      .sort((left, right) => right.score - left.score)[0];
    expect(state.ending!.dimension).toBe(worst.dimension);
    // Due dimensioni oltre la soglia restano elencate nell'epilogo.
    void state;
  });

  it('è compatibile con i vecchi salvataggi: giorni piccoli, nessun collasso immediato', () => {
    // Un salvataggio precedente aveva «3 turni» di serie: ora sono 3 giorni.
    const legacy = advanceCrisis(critical, { criticalDays: { revolt: 3 } } as any, { turn: 4, date: '1952-02-01', days: 30 });
    expect(legacy.ending).toBeNull();
    expect(legacy.criticalDays.revolt).toBe(33);
  });
});

describe('descrizione per il prompt', () => {
  it('riassume le tre dimensioni con livello e giorni di criticità', () => {
    const state = advanceCrisis(base, {}, { turn: 1, date: '1951-10-01', days: 30 });
    const text = describeCrisis(state);
    expect(text).toMatch(/Rischio di rivolta/);
    expect(text).toMatch(/Rischio di default/);
    expect(text).toMatch(/Rischio di invasione/);
    expect(text).toMatch(/0\/90 giorni di criticità/);
  });
});
