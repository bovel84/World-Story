import { describe, expect, it } from 'vitest';
import { buildHistoricalBaselinePrompt, sanitizeHistoricalBaseline, generateHistoricalBaseline } from '../src/core/government/HistoricalBaseline';
import { advisorOpeningRequest, ADVISOR_OPENING_REQUEST } from '../src/core/government/RealityAdvisor';

const past = 'Nel 1993 il processo di pace e il ripristino delle istituzioni aprirono una fase di ricostruzione. L’eredità del conflitto pesava sull’amministrazione, sulla fiducia pubblica e sui rapporti regionali; queste condizioni spiegano le priorità politiche del paese senza determinare i risultati della partita.';

describe('polity historical baseline cutoff', () => {
  it('allows concrete real names and events, not speculative precise inventories', () => {
    const prompt = buildHistoricalBaselinePrompt({ worldName: 'Millennium Dawn', polityId: 'KHM', countryName: 'Cambogia', startDate: '2000-01-01' });
    expect(prompt).toContain('nomi propri');
    expect(prompt).toContain('sufficientemente certo');
    expect(prompt).not.toContain('nomi propri, cifre o localizzazioni non forniti');
    expect(prompt).toContain('entries');
  });
  it('excludes same-year October and ambiguous year at a January divergence', () => {
    const result = sanitizeHistoricalBaseline(`${past} Nell’ottobre 2000 si tenne EVENTO_FUTURO. Nel 2000 venne approvato EVENTO_AMBIGUO. Il 2000-01-01 si tenne EVENTO_AL_CONFINE. Nel 2002 si tenne EVENTO_SUCCESSIVO.`, '2000-01-01');
    expect(result).toBe(past);
  });
  it('accepts an exact earlier date in the same year but rejects later and uncertain dates', () => {
    const result = sanitizeHistoricalBaseline(`${past} Il 2000-02-01 si tenne EVENTO_PRECEDENTE. Il 2000-07-01 si tenne EVENTO_FUTURO. A ottobre 2000 si tenne EVENTO_AUTUNNO. Nel 2000 si tenne EVENTO_AMBIGUO.`, '2000-06-01')!;
    expect(result).toContain('EVENTO_PRECEDENTE');
    expect(result).not.toMatch(/EVENTO_FUTURO|EVENTO_AUTUNNO|EVENTO_AMBIGUO/);
  });
  it('filters dated generation entries before persisting any text', async () => {
    const result = await generateHistoricalBaseline({ worldName: 'Test', polityId: 'KHM', countryName: 'Cambogia', startDate: '2000-01-01' }, async () => JSON.stringify({ entries: [
      { date: '1993', text: past },
      { date: '2000-10-01', text: 'EVENTO_FUTURO' },
      { date: '2000', text: 'EVENTO_AMBIGUO' },
      { date: '2000-01-01', text: 'EVENTO_AL_CONFINE' },
      { date: '1999-02-30', text: 'DATA_INVALIDA' },
      { text: 'NON_DATATO' },
    ] }));
    expect(result).toBe(past);
  });
  it('selects the opening server-side, not from browser cache presence', () => {
    expect(advisorOpeningRequest({ turn: 1, date: '2000-01-01' }, '2000-01-01')).toBe(ADVISOR_OPENING_REQUEST);
    const later = advisorOpeningRequest({ turn: 2, date: '2002-01-01' }, '2000-01-01');
    expect(later).toContain('TURN BRIEFING');
    expect(later).not.toContain('primo intervento del mandato');
    expect(advisorOpeningRequest({ turn: 1, date: '2002-01-01' }, '2000-01-01')).toBe(later);
  });
});
