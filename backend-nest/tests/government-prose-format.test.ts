import { describe, expect, it } from 'vitest';
import { buildAgenda, type GovernmentAgendaInput } from '../src/core/government/GovernmentAgenda';
import { composeCabinet } from '../src/core/government/Cabinet';
import { briefingFor } from '../src/core/government/MinisterChat';
import { buildMinisterOpeningBrief, composeMinisterOpeningPrompt, validateMinisterOpening } from '../src/core/government/MinisterOpening';
import type { MinisterWorldContext } from '../src/prompts/national-context';

const world: MinisterWorldContext = {
  worldName: 'Test', country: 'Paese', currentDate: '1951-01-01', scenarioPremise: '',
  simulationRules: '', nationalContext: '', recentHistory: '', activeCommitments: '', ongoingProcesses: '',
};
const base: GovernmentAgendaInput = {
  deficits: [], factions: [], reserves: [], buildable: [], currencyId: 'TEST',
  budget: { balance: '7.60987654321', unit: 'mld', effectiveTaxRatePct: 24.123456789 },
  debt: { ratioPct: 110.123456789, servicePct: 14.123456789 },
  cashFlow: { balance: '7.60987654321', balancePct: 1.23456789, unit: 'mld', revenuePct: 30 },
};
const noLongDecimals = (text: string) => expect(text).not.toMatch(/\d+[.,]\d{3,}/);

function frozen<T>(value: T): T {
  if (value && typeof value === 'object') {
    Object.values(value).forEach(frozen);
    Object.freeze(value);
  }
  return value;
}

describe('Government display precision, not engine rounding', () => {
  it.each([
    ['7.60987654321', 1.23456789, '7,61', 'avanzo'],
    ['-7.60987654321', -1.23456789, '-7,61', 'disavanzo'],
  ])('bounds treasury need, because and opening for balance %s', (balance, balancePct, display, need) => {
    const input = frozen({ ...base, cashFlow: { ...base.cashFlow!, balance, balancePct } });
    const before = structuredClone(input);
    const agenda = buildAgenda(input);
    const treasury = agenda.voices.find(voice => voice.id === 'treasury_condition')!;
    const address = composeCabinet(agenda).addresses.find(item => item.seat === 'tesoro')!;

    expect(treasury.need).toContain(need);
    expect(treasury.because).toContain(`${display} mld`);
    expect(treasury.because).toContain(`${balancePct < 0 ? '-' : ''}1,2% del PIL`);
    expect(treasury.because).toContain('24,1%');
    expect(treasury.because).toContain('110,1%');
    expect(treasury.because).toContain('14,1%');
    expect(address.opening).toContain(`${display} mld`);
    for (const prose of [treasury.need, treasury.because, address.opening]) noLongDecimals(prose);
    expect(input).toEqual(before);
    expect(input.debt.ratioPct).toBe(110.123456789);
    expect(input.cashFlow.balance).toBe(balance);
    expect(input.cashFlow.balancePct).toBe(balancePct);
  });

  it('bounds figures in opening/dialogue prompts without making their values locale-dependent', () => {
    const agenda = buildAgenda(base);
    const address = composeCabinet(agenda).addresses.find(item => item.seat === 'tesoro')!;
    const brief = buildMinisterOpeningBrief('tesoro', world, address.items);
    noLongDecimals(composeMinisterOpeningPrompt(brief));
    noLongDecimals(briefingFor(address, agenda).context);
    expect(address.items[0].figures.find(figure => figure.label === 'Saldo di bilancio')?.value).toBe('7.61');
    expect(address.items.flatMap(item => item.figures).every(figure => Number.isFinite(Number(figure.value)))).toBe(true);
    expect(validateMinisterOpening('Presidente, abbiamo 7,61 mld di avanzo e un debito al 110,1% del PIL. Io non impegnerei tutto il margine. Confrontiamo le coperture?', brief)).toBe(true);
  });

  it('formats percent, scores and counts in all generated condition prose', () => {
    const input = frozen({
      ...base,
      debt: { ratioPct: 110.123456789, servicePct: 25.123456789 },
      factions: [{ id: 'f', name: 'Comandi', powerPct: 9.23456789, satisfaction: 34.987654321,
        stance: 'critico', demandTitle: 'Più riserve', demandDetail: 'Servono riserve.', urgency: 60.123456789 }],
      defence: { burdenPct: 1.23456789, forces: 200.123456789, mobilized: 1200.987654321, factionSatisfaction: 34.987654321 },
      education: { burdenPct: 3.456789, universities: 12.123456789, socialTension: 41.23456789 },
      health: { socialBurdenPct: 8.123456789, population: 50000000.123456, stability: 62.987654321 },
    });
    const before = structuredClone(input);
    const agenda = buildAgenda(input);
    const voice = (id: string) => agenda.voices.find(item => item.id === id)!;
    expect(voice('debt_service').because).toContain('25,1%');
    expect(voice('faction_f').because).toContain('9,2%');
    expect(voice('faction_f').because).toContain('35/100');
    expect(voice('defence_condition').because).toContain('200 reparti in forza e 1201 mobilitati');
    expect(voice('education_condition').need).toContain('3,5%');
    expect(voice('education_condition').because).toContain('12 atenei e una tensione sociale di 41,2/100');
    expect(voice('health_condition').need).toContain('8,1%');
    expect(voice('health_condition').because).toContain('50000000 e una stabilità di 63/100');
    for (const item of agenda.voices) {
      noLongDecimals(item.need);
      noLongDecimals(item.because);
    }
    for (const address of composeCabinet(agenda).addresses) noLongDecimals(address.opening);
    expect(input).toEqual(before);
  });

  it('keeps decisions based on unrounded facts and ledger integer strings exact', () => {
    const input = frozen({
      ...base,
      cashFlow: { ...base.cashFlow!, balancePct: -4.999999 },
      debt: { ratioPct: 100, servicePct: 14.999999 },
      deficits: [{ code: 'INSUFFICIENT_CASH' as const, id: 'TEST', unit: 'unità minime',
        required: '900719925474099312345', available: '0', missing: '900719925474099312345' }],
    });
    const agenda = buildAgenda(input);
    const treasury = agenda.voices.find(voice => voice.id === 'treasury_condition')!;
    expect(treasury.urgency).toBe('ordinaria');
    expect(treasury.paths.find(path => path.id === 'invest')?.recommended).toBe(true);
    expect(agenda.voices.some(voice => voice.id === 'debt_service')).toBe(false);
    expect(agenda.voices[0].figures.map(figure => figure.value)).toEqual(['900719925474099312345', '0', '900719925474099312345']);
    expect(input.debt.servicePct).toBe(14.999999);
  });
});
