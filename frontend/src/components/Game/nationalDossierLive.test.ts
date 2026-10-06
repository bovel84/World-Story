/**
 * World Story — Dossier Nazionale vivo: test del read model
 * =========================================================
 * Verifica il principio del Dossier: `CountryInitialProfile` (Turno 0) + stato
 * corrente del motore = DOSSIER ATTUALE. I test usano solo numeri passati a
 * mano: il modulo è puro e non chiama né motore né rete.
 */
import { describe, expect, it } from 'vitest';
import { buildNationalDossierLive, technologyLabel } from './nationalDossierLive';
import type { CountryInitialProfilePayload, ArsenalResponse } from '../../services/api';
import type { NationAccount, NationResources } from './NationDock/types';

function profile(over: Partial<CountryInitialProfilePayload> = {}): CountryInitialProfilePayload {
  return {
    polityId: 'AAA',
    startDate: '1951-01-01',
    population: 48_000_000,
    economy: {
      nominalGdpUsdBillions: 12.7,
      debtRatioPct: 40,
      treasuryUsdBillions: 1.2,
      taxRatePct: 22,
      monthlyRevenue: 0.4,
      monthlyExpenses: 0.35,
    },
    military: {
      activePersonnel: 200_000,
      reservePersonnel: 100_000,
      formations: 10,
      averageFormationSize: 20_000,
      readinessPct: 60,
      defenceBurdenPct: 3.5,
      equipmentProfile: { tank: 300, fighter: 40, destroyer: 6 },
      trainingPct: 55,
      qualityPct: 50,
      logisticsPct: 45,
    },
    society: { stability: 62, socialTension: 28 },
    infrastructure: { factories: 6, ports: 3, universities: 4 },
    resources: { food: 5_000, clothing: 800, weapons: 1_200, fuel: 900, research: 400, technologies: ['radio'] },
    ...over,
  };
}

function account(over: Partial<NationAccount> = {}): NationAccount {
  return {
    population: 48_000_000,
    nominalGdpUsdBillions: 12.7,
    gdpPerCapitaUsd: 264_583,
    factories: 6,
    ports: 3,
    universities: 4,
    monthlyRevenue: 0.4,
    monthlyExpenses: 0.35,
    monthlyBalance: 0.05,
    stability: 62,
    socialTension: 28,
    money: 1.2,
    debt: 5.08,
    debtRatioPct: 40,
    ...over,
  };
}

function resources(over: Partial<NationResources> = {}): NationResources {
  return {
    money: 1.2,
    debt: 5.08,
    debtRatioPct: 40,
    food: 5_000,
    clothing: 800,
    weapons: 1_200,
    fuel: 900,
    research: 400,
    technologies: ['radio'],
    capacity: { food: 8_000, clothing: 2_000, weapons: 3_000, fuel: 2_000 },
    ...over,
  };
}

function arms(over: Partial<ArsenalResponse> = {}): ArsenalResponse {
  return {
    units: { tank: 300, fighter: 40, destroyer: 6 },
    qualityIndex: 50,
    manpower: { activePersonnel: 200_000, reservePersonnel: 100_000, mobilizedPersonnel: 0, formations: 10, mobilizedFormations: 0 },
    readiness: { readinessPct: 60 },
    catalog: [
      { id: 'tank', name: 'Carro armato', domain: 'terra' },
      { id: 'fighter', name: 'Caccia', domain: 'aria' },
      { id: 'destroyer', name: 'Cacciatorpediniere', domain: 'mare' },
    ],
    domains: [
      { domain: 'terra', label: 'Terra' },
      { domain: 'aria', label: 'Aria' },
      { domain: 'mare', label: 'Mare' },
    ],
    ...over,
  } as unknown as ArsenalResponse;
}

const findMetric = (metrics: { key: string }[], key: string) => metrics.find(m => m.key === key);

describe('buildNationalDossierLive — attuale vs inizio', () => {
  it('1. a inizio partita il Dossier coincide con la baseline: variazioni nulle', () => {
    const live = buildNationalDossierLive({
      account: account(), resources: resources(), arms: arms(), initialProfile: profile(),
    });
    expect(live.hasBaseline).toBe(true);
    expect(live.baselineDate).toBe('1951-01-01');
    for (const metric of [...live.state, ...live.capacity]) {
      expect(metric.initial).not.toBeNull();
    }
    expect(findMetric(live.military, 'activePersonnel')!.delta).toBe(0);
    expect(findMetric(live.military, 'formations')!.delta).toBe(0);
    expect(findMetric(live.state, 'population')!.delta).toBe(0);
    expect(findMetric(live.finance, 'money')!.delta).toBe(0);
    expect(findMetric(live.capacity, 'factories')!.delta).toBe(0);
    expect(live.technology.unlockedSinceStart).toEqual([]);
    expect(live.technology.lostSinceStart).toEqual([]);
  });

  it('2. una variazione di tesoreria appare nel Dossier attuale ma non nella baseline', () => {
    const live = buildNationalDossierLive({
      account: account(), resources: resources({ money: 2.2 }), arms: arms(), initialProfile: profile(),
    });
    const money = findMetric(live.finance, 'money')!;
    expect(money.current).toBe(2.2);
    expect(money.initial).toBe(1.2);
    expect(money.delta).toBeCloseTo(1.0, 6);
    expect(live.baselineDate).toBe('1951-01-01');
  });

  it('2b. saldo mensile assente: resta non pubblicato, mai un falso zero', () => {
    // Il difetto: `(revenue ?? 0) - (expenses ?? 0)` trasformava «non
    // pubblicato» in «0,00», cioè inventava un pareggio che il motore non ha
    // dichiarato. Dato assente ≠ zero.
    const live = buildNationalDossierLive({
      account: account({ monthlyBalance: undefined, monthlyRevenue: undefined, monthlyExpenses: undefined }),
      resources: resources(),
      arms: arms(),
      initialProfile: profile(),
    });
    expect(findMetric(live.finance, 'monthlyBalance')!.current).toBeNull();

    // Con entrambe le voci presenti il saldo si deriva; con una sola no.
    const derived = buildNationalDossierLive({
      account: account({ monthlyBalance: undefined, monthlyRevenue: 0.5, monthlyExpenses: 0.35 }),
      resources: resources(), arms: arms(), initialProfile: profile(),
    });
    expect(findMetric(derived.finance, 'monthlyBalance')!.current).toBeCloseTo(0.15, 6);
    const partial = buildNationalDossierLive({
      account: account({ monthlyBalance: undefined, monthlyRevenue: 0.5, monthlyExpenses: undefined }),
      resources: resources(), arms: arms(), initialProfile: profile(),
    });
    expect(findMetric(partial.finance, 'monthlyBalance')!.current).toBeNull();
  });

  it('2c. addestramento e logistica non compaiono senza una fonte corrente', () => {
    // Il motore pubblica solo prontezza e qualità correnti: addestramento e
    // logistica restano nel profilo iniziale e non vanno spacciati per attuali.
    const live = buildNationalDossierLive({ account: account(), resources: resources(), arms: arms(), initialProfile: profile() });
    const keys = live.quality.map(metric => metric.key);
    expect(keys).toEqual(['readinessPct', 'qualityPct']);
    expect(keys).not.toContain('trainingPct');
    expect(keys).not.toContain('logisticsPct');
  });

  it('5. le tecnologie si leggono con l\'etichetta del catalogo, non con l\'ID grezzo', () => {
    expect(technologyLabel('industria_tessile')).toBe('Industria tessile');
    expect(technologyLabel('motorizzazione')).toBe('Motorizzazione');
    expect(technologyLabel('logistica_avanzata')).toBe('Logistica avanzata');
    expect(technologyLabel('')).toBe('');
  });

  it('3. perdita e acquisto di equipaggiamento aggiornano l’arsenale mostrato', () => {
    const lost = buildNationalDossierLive({
      account: account(), resources: resources(), arms: arms({ units: { tank: 250, fighter: 40, destroyer: 6 } }), initialProfile: profile(),
    });
    const tank = lost.equipment.flatMap(g => g.rows).find(r => r.id === 'tank')!;
    expect(tank.current).toBe(250);
    expect(tank.initial).toBe(300);
    expect(tank.delta).toBe(-50);
    const ground = lost.equipment.find(g => g.domain === 'terra')!;
    expect(ground.current).toBe(250);
    expect(ground.initial).toBe(300);

    const bought = buildNationalDossierLive({
      account: account(), resources: resources(), arms: arms({ units: { tank: 320, fighter: 40, destroyer: 6 } }), initialProfile: profile(),
    });
    const tankGain = bought.equipment.flatMap(g => g.rows).find(r => r.id === 'tank')!;
    expect(tankGain.delta).toBe(20);
  });

  it('4. il consumo di carburante abbassa la scorta attuale e ne mostra il riempimento', () => {
    const live = buildNationalDossierLive({
      account: account(), resources: resources({ fuel: 600 }), arms: arms(), initialProfile: profile(),
    });
    const fuel = live.resources.find(r => r.id === 'fuel')!;
    expect(fuel.current).toBe(600);
    expect(fuel.initial).toBe(900);
    expect(fuel.delta).toBe(-300);
    expect(fuel.capacity).toBe(2_000);
    expect(fuel.fillPct).toBe(30);
  });

  it('5. una nuova fabbrica alza il totale corrente rispetto al Turno 0', () => {
    const live = buildNationalDossierLive({
      account: account({ factories: 8 }), resources: resources(), arms: arms(), initialProfile: profile(),
    });
    const factories = findMetric(live.capacity, 'factories')!;
    expect(factories.current).toBe(8);
    expect(factories.initial).toBe(6);
    expect(factories.delta).toBe(2);
  });

  it('6. una tecnologia sbloccata compare tra quelle possedute dall’inizio', () => {
    const live = buildNationalDossierLive({
      account: account(), resources: resources({ technologies: ['radio', 'radar'] }), arms: arms(), initialProfile: profile(),
    });
    expect(live.technology.current).toEqual(['radar', 'radio']);
    expect(live.technology.unlockedSinceStart).toEqual(['radar']);
    expect(live.technology.lostSinceStart).toEqual([]);
  });

  it('7. dopo un reload la baseline resta identica e lo stato corrente è quello nuovo', () => {
    const baseline = profile();
    const before = buildNationalDossierLive({ account: account(), resources: resources(), arms: arms(), initialProfile: baseline });
    const after = buildNationalDossierLive({
      account: account({ factories: 9 }), resources: resources({ money: 0.8 }), arms: arms(), initialProfile: baseline,
    });
    // La baseline non cambia mai: stesso valore iniziale in entrambe le letture.
    expect(findMetric(after.capacity, 'factories')!.initial).toBe(findMetric(before.capacity, 'factories')!.initial);
    expect(findMetric(after.finance, 'money')!.initial).toBe(findMetric(before.finance, 'money')!.initial);
    // Lo stato corrente è quello persistito più di recente.
    expect(findMetric(after.capacity, 'factories')!.current).toBe(9);
    expect(findMetric(after.finance, 'money')!.current).toBe(0.8);
  });

  it('8. un salvataggio legacy senza baseline mostra solo lo stato corrente', () => {
    const live = buildNationalDossierLive({ account: account(), resources: resources(), arms: arms() });
    expect(live.hasBaseline).toBe(false);
    expect(live.baselineDate).toBeNull();
    expect(findMetric(live.state, 'population')!.current).toBe(48_000_000);
    expect(findMetric(live.state, 'population')!.initial).toBeNull();
    expect(findMetric(live.finance, 'money')!.initial).toBeNull();
    expect(live.equipment.flatMap(g => g.rows).find(r => r.id === 'tank')!.current).toBe(300);
  });

  it('raggruppa l’equipaggiamento per dominio e nasconde le quantità a zero', () => {
    const live = buildNationalDossierLive({
      account: account(),
      resources: resources(),
      arms: arms({ units: { tank: 300, fighter: 0, destroyer: 6, obsolete: 0 } }),
      initialProfile: profile({ military: { ...profile().military, equipmentProfile: { tank: 300, fighter: 0, destroyer: 6, obsolete: 0 } } }),
    });
    const domains = live.equipment.map(g => g.domain);
    expect(domains).toEqual(['terra', 'mare']);
    expect(live.equipment.flatMap(g => g.rows).map(r => r.id).sort()).toEqual(['destroyer', 'tank']);
  });

  it('spiega una capacità venuta meno mantenendo a schermo la voce persa', () => {
    const live = buildNationalDossierLive({
      account: account(),
      resources: resources(),
      arms: arms({ units: { tank: 0, fighter: 40, destroyer: 6 } }),
      initialProfile: profile(),
    });
    const tank = live.equipment.flatMap(g => g.rows).find(r => r.id === 'tank')!;
    expect(tank.current).toBe(0);
    expect(tank.initial).toBe(300);
    expect(tank.delta).toBe(-300);
  });
});
