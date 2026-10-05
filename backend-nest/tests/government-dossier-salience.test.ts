import { describe, expect, it } from 'vitest';
import { buildAgenda, type GovernmentAgendaInput, type GovernmentSalienceContext } from '../src/core/government/GovernmentAgenda';
import { ownedLedgerMovement } from '../src/core/government/GovernmentDossier';

// USA2000-like amounts, not an identity switch: monthly balance / annual nominal GDP.
const normal: GovernmentAgendaInput = {
  deficits: [], factions: [], reserves: [], currencyId: 'USD',
  budget: { balance: '30', unit: 'mld', effectiveTaxRatePct: 30 },
  debt: { ratioPct: 55, servicePct: 10 },
  cashFlow: { balancePct: 30 / 10252 * 100, balance: '30', unit: 'mld', revenuePct: 30 },
  defence: { burdenPct: 3, forces: 1_400_000, mobilized: 0, factionSatisfaction: 65 },
  education: { burdenPct: 4, universities: 120, socialTension: 30 },
  health: { socialBurdenPct: 8, population: 280_000_000, stability: 70 },
  buildable: [{ workId: 'road', name: 'Strada', missing: [] }, { workId: 'port', name: 'Porto', missing: ['steel'] }],
};
const ids = (input: GovernmentAgendaInput) => buildAgenda(input).voices.map(v => v.id);
const withContext = (salience: GovernmentSalienceContext): GovernmentAgendaInput => ({ ...normal, salience });

function freezeDeep<T>(value: T): T {
  if (value && typeof value === 'object') {
    Object.freeze(value);
    for (const child of Object.values(value)) freezeDeep(child);
  }
  return value;
}

describe('Government dossier salience — pure evidence, not normal bookkeeping', () => {
  it('a USA2000-like normal state with large forces and debt55 has no agenda', () => {
    expect(ids(normal)).toEqual([]);
  });

  it.each([-0.3, 0, 0.3])('a slight monthly balance %s does not demand Council', balancePct => {
    expect(ids({ ...normal, cashFlow: { ...normal.cashFlow!, balancePct } })).toEqual([]);
  });

  it('catalogue coverage alone, or surplus without a covered candidate, is not an opportunity', () => {
    expect(ids(normal)).not.toContain('build_road');
    expect(ids({ ...normal, cashFlow: { ...normal.cashFlow!, balancePct: 2 }, buildable: [] })).toEqual([]);
    expect(ids({ ...normal, cashFlow: { ...normal.cashFlow!, balancePct: 2 }, buildable: [normal.buildable[1]] })).toEqual([]);
  });

  it('a meaningful surplus and a fully covered candidate invite a conditional investment choice', () => {
    const agenda = buildAgenda({ ...normal, cashFlow: { ...normal.cashFlow!, balancePct: 1.2 } });
    expect(agenda.voices.map(v => v.id)).toEqual(['treasury_condition', 'build_road']);
    expect(agenda.voices.find(v => v.id === 'build_road')?.work?.workId).toBe('road');
    expect(agenda.voices.every(v => v.paths.length >= 2)).toBe(true);
    expect(agenda.voices.every(v => v.paths.every(p => /se |potrebbe|proposta/i.test(p.expected)))).toBe(true);
  });

  it.each([-1, -3])('a severe monthly/annual-GDP deficit %s raises Treasury with documented horizon', balancePct => {
    const agenda = buildAgenda({ ...normal, cashFlow: { ...normal.cashFlow!, balancePct, balance: '-300' } });
    expect(agenda.voices.map(v => v.id)).toEqual(['treasury_condition']);
    expect(agenda.voices[0].because).toContain('mensile');
    expect(agenda.voices[0].because).toContain('annuo');
    expect(agenda.voices[0].figures.some(f => f.value === '-300' && f.basis.kind === 'measured')).toBe(true);
    if (balancePct === -3) expect(agenda.voices[0].urgency).toBe('critica');
  });

  it('high debt service has exactly one fiscal voice with and without cash flow', () => {
    for (const cashFlow of [normal.cashFlow, undefined]) {
      const agenda = buildAgenda({ ...normal, cashFlow, debt: { ratioPct: 55, servicePct: 26 } });
      expect(agenda.voices).toHaveLength(1);
      expect(['treasury_condition', 'debt_service']).toContain(agenda.voices[0].id);
      expect(agenda.voices[0].urgency).toBe('critica');
      expect(agenda.voices[0].figures.some(f => f.label === 'Interessi su entrate' && f.value === '26')).toBe(true);
    }
  });

  it('fiscal deltas need a real baseline and expose both measured endpoints', () => {
    for (const previous of [{ balancePct: -1 }, { debtServicePct: 3 }]) {
      const agenda = buildAgenda(withContext({ previous }));
      expect(agenda.voices.map(v => v.id)).toEqual(['treasury_condition']);
      expect(agenda.voices[0].because).toContain('precedente');
      expect(agenda.voices[0].figures.some(f => f.label.includes('precedent') && f.basis.kind === 'measured')).toBe(true);
    }
    expect(ids(withContext({ previous: {} }))).toEqual([]);
    expect(ids(withContext({ previous: { balancePct: 0.2, debtServicePct: 9 } }))).toEqual([]);
  });

  it.each([0.1, 1, 12])('defence burden %s and standing forces alone never imply a readiness problem', burdenPct => {
    expect(ids({ ...normal, defence: { ...normal.defence!, burdenPct } })).toEqual([]);
  });

  it.each([
    { readinessPct: 35 }, { hostileRelations: 1 }, { activeConflicts: 1 },
    { ongoingMilitaryOrders: 1 }, { supplyCoverageMonths: 0.5 },
  ])('actual military evidence %j raises Defence and is sourced', salience => {
    const agenda = buildAgenda(withContext(salience));
    expect(agenda.voices.map(v => v.id)).toEqual(['defence_condition']);
    expect(agenda.voices[0].figures.every(f => f.basis.kind === 'measured')).toBe(true);
    expect(agenda.voices[0].figures.some(f => f.basis.kind === 'measured' && f.basis.source.includes('salience.'))).toBe(true);
    expect(agenda.voices[0].paths.every(p => /se |potrebbe|proposta/i.test(p.expected))).toBe(true);
  });

  it('ERI2000-like explicit war and readiness35 mobilization lead to distinct priorities, not identity rules', () => {
    const war = buildAgenda(withContext({ activeConflicts: 1, hostileRelations: 1 })).voices[0];
    const readiness = buildAgenda({ ...normal, defence: { ...normal.defence!, mobilized: 50_000 }, salience: { readinessPct: 35 } }).voices[0];
    expect(war.id).toBe('defence_condition');
    expect(readiness.id).toBe('defence_condition');
    expect(war.need).not.toBe(readiness.need);
    expect(war.paths[0].id).not.toBe(readiness.paths[0].id);
    expect(readiness.because).toContain('35');
    expect(readiness.because).toContain('50000');
  });

  it('meaningful mobilization and observed military changes matter, tiny changes do not', () => {
    expect(ids({ ...normal, defence: { ...normal.defence!, mobilized: 50_000 } })).toEqual(['defence_condition']);
    expect(ids(withContext({ previous: { forces: 1_000_000 } }))).toEqual(['defence_condition']);
    expect(ids(withContext({ readinessPct: 75, previous: { readinessPct: 90 } }))).toEqual(['defence_condition']);
    expect(ids(withContext({ previous: { forces: 1_399_999, mobilized: 0 }, readinessPct: 80 }))).toEqual([]);
  });

  it('an explicit zero baseline is real evidence, not an unknown baseline', () => {
    expect(ids(withContext({ previous: { forces: 0 } }))).toEqual(['defence_condition']);
    const agenda = buildAgenda({ ...normal, cashFlow: undefined, salience: { previous: { debtServicePct: 20 } } });
    expect(agenda.voices.map(v => v.id)).toEqual(['debt_service']);
    expect(agenda.voices[0].need).toContain('cambiato');
    expect(agenda.voices[0].figures.some(f => f.value === '20')).toBe(true);
  });

  it('a cash-runway-only Treasury review tells the truth instead of claiming a debt-service change', () => {
    const agenda = buildAgenda({ ...normal, cashFlow: undefined, salience: { cashRunwayMonths: 1.5 } });
    expect(agenda.voices.map(v => v.id)).toEqual(['debt_service']);
    expect(agenda.voices[0].need).toContain('cassa');
    expect(agenda.voices[0].need).not.toContain('servizio del debito è cambiato');
    expect(agenda.voices[0].urgency).toBe('critica');
    // A real debt-service change keeps its own headline even with cash runway.
    const changed = buildAgenda({ ...normal, cashFlow: undefined, salience: { cashRunwayMonths: 1.5, previous: { debtServicePct: 20 } } });
    expect(changed.voices[0].need).toContain('cambiato');
  });

  it('treats only a movement touching the player actor refs as the player dossier', () => {
    // A shared branch ledger contains beta actors: bootstrap and foreign
    // transfers must not masquerade as the player's applied effects.
    const refs = new Set(['alpha_treasury', 'alpha_steel_co']);
    expect(ownedLedgerMovement({ fromRef: 'alpha_steel_co', toRef: 'site:1', ownerRef: 'alpha_steel_co' }, refs)).toBe(true);
    expect(ownedLedgerMovement({ fromRef: null, toRef: 'alpha_treasury', ownerRef: null }, refs)).toBe(true);
    expect(ownedLedgerMovement({ fromRef: null, toRef: 'beta_treasury', ownerRef: 'beta_treasury' }, refs)).toBe(false);
    expect(ownedLedgerMovement({ fromRef: 'outside', toRef: 'unknown', ownerRef: null }, refs)).toBe(false);
  });

  it('unknown readiness/baseline/supply and missing conflicts never imply zero, peace, or a delta', () => {
    const agenda = buildAgenda(withContext({ readinessPct: null, supplyCoverageMonths: null, previous: { readinessPct: null } }));
    expect(agenda.voices).toEqual([]);
    const threat = buildAgenda({ ...normal, defence: undefined, salience: { hostileRelations: 2 } });
    expect(threat.voices.map(v => v.id)).toEqual(['defence_condition']);
    expect(threat.voices[0].figures.map(f => f.label)).not.toContain('Prontezza');
    expect(threat.voices[0].because).not.toMatch(/pace|nessun conflitto|0 conflitti/);
    expect(threat.voices[0].figures.map(f => f.label)).not.toContain('Reparti in forza');
    expect(ids(withContext({ readinessPct: Number.NaN, supplyCoverageMonths: Infinity,
      previous: { balancePct: Number.NaN, readinessPct: Number.NaN, forces: Infinity },
    }))).toEqual([]);
    expect(ids(withContext({ readinessPct: 80, activeConflicts: 0, hostileRelations: 0,
      ongoingMilitaryOrders: 0, supplyCoverageMonths: 3,
    }))).toEqual([]);
  });

  it('civil distress and meaningful changes, not ordinary sector budgets, justify education/health', () => {
    const agenda = buildAgenda({ ...normal,
      education: { ...normal.education!, socialTension: 75 },
      health: { ...normal.health!, stability: 30 },
    });
    expect(agenda.voices.map(v => v.id)).toEqual(['education_condition', 'health_condition']);
    for (const voice of agenda.voices) {
      expect(voice.figures[0].basis.kind).toBe('estimated');
      expect(voice.figures.slice(1).every(f => f.basis.kind === 'measured')).toBe(true);
    }
    expect(ids(withContext({ previous: { socialTension: 10, stability: 90 } }))).toEqual(['education_condition', 'health_condition']);
  });

  it('blocked-project deficits and material political demands remain visible without catalogue spam', () => {
    const agenda = buildAgenda({ ...normal,
      deficits: [{ code: 'MATERIAL_SHORTAGE', id: 'steel', required: '12', available: '4', missing: '8', unit: 'kg' }],
      factions: [{ id: 'workers', name: 'Operai', powerPct: 20, satisfaction: 20, stance: 'critico', demandTitle: 'Salari', demandDetail: 'Aumento', urgency: 80 }],
    });
    expect(agenda.voices.map(v => v.id)).toEqual(['deficit_MATERIAL_SHORTAGE_steel', 'faction_workers']);
    expect(agenda.voices.every(v => v.paths.length >= 2)).toBe(true);
    expect(agenda.voices.every(v => v.paths.every(p => /se |potrebbe|proposta/i.test(p.expected)))).toBe(true);
  });

  it('is deterministic and never mutates deeply frozen inputs, baselines, or catalogue', () => {
    const input = freezeDeep({ ...normal, salience: { readinessPct: 35, previous: { readinessPct: 70, balancePct: -1 } } });
    const before = JSON.stringify(input);
    expect(buildAgenda(input)).toEqual(buildAgenda(input));
    expect(JSON.stringify(input)).toBe(before);
    expect(buildAgenda(input).canonicalMutation).toBe(false);
  });
});
