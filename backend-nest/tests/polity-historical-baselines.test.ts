import { describe, expect, it } from 'vitest';
import { buildHistoricalBaselinePrompt, sanitizeHistoricalBaseline, generateHistoricalBaseline, isGenericHistoricalBaseline } from '../src/core/government/HistoricalBaseline';
import { advisorOpeningRequest, ADVISOR_OPENING_REQUEST } from '../src/core/government/RealityAdvisor';
import { ADVISOR_BRIEFING_SITUATION_PROTOCOL } from '../src/core/government/CouncilIssue';

const past = 'Nel 1993 il processo di pace e il ripristino delle istituzioni aprirono una fase di ricostruzione. L’eredità del conflitto pesava sull’amministrazione, sulla fiducia pubblica e sui rapporti regionali; queste condizioni spiegano le priorità politiche del paese senza determinare i risultati della partita.';

const cambodia = 'La Cambogia usciva dal regime dei Khmer Rossi e da un lungo conflitto civile. Gli accordi di Parigi del 1991 e le elezioni del 1993 avviarono la ricostruzione istituzionale. L’ingresso nell’ASEAN nel 1999 aprì nuove prospettive di integrazione regionale, senza cancellare le fragilità amministrative e le sensibilità nei rapporti con il Vietnam.';

const generic = 'Il paese arriva al nuovo millennio dopo decenni difficili e importanti trasformazioni. La transizione economica e le relazioni regionali restano fragili, mentre le istituzioni cercano stabilità e la società chiede risposte senza poter contare su risorse certe.';

const request = { worldName: 'Millennium Dawn', polityId: 'KHM', countryName: 'Cambogia', startDate: '2000-01-01' };
const generate = (entries: unknown[]) => generateHistoricalBaseline(request, async () => JSON.stringify({ entries }));

describe('polity historical baseline cutoff', () => {
  it('allows concrete real names and events, not speculative precise inventories', () => {
    const prompt = buildHistoricalBaselinePrompt(request);
    expect(prompt).toContain('nomi propri');
    expect(prompt).toContain('sufficientemente certo');
    expect(prompt).not.toContain('nomi propri, cifre o localizzazioni non forniti');
    expect(prompt).toContain('confidence');
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
    const result = await generate([
      { date: '1993', text: cambodia, confidence: 'high' },
      { date: '2000-10-01', text: 'EVENTO_FUTURO', confidence: 'high' },
      { date: '2000', text: 'EVENTO_AMBIGUO', confidence: 'high' },
      { date: '2000-01-01', text: 'EVENTO_AL_CONFINE', confidence: 'high' },
      { date: '1999-02-30', text: 'DATA_INVALIDA', confidence: 'high' },
      { text: 'NON_DATATO', confidence: 'high' },
    ]);
    expect(result).toBe(cambodia);
  });

  it('1 — Cambodia 2000 keeps high-confidence facts before the divergence', async () => {
    const result = await generate([
      { date: '1991', text: 'Gli accordi di Parigi del 1991 avviarono il processo di pace in Cambogia.', confidence: 'high' },
      { date: '1993', text: 'Le elezioni del 1993 insediarono un governo di coalizione sostenuto dalle Nazioni Unite.', confidence: 'high' },
      { date: '1999', text: 'La Cambogia entrò nell’ASEAN nel 1999.', confidence: 'high' },
    ]);
    expect(result).toContain('Parigi');
    expect(result).toContain('elezioni del 1993');
    expect(result).toContain('ASEAN');
  });

  it('2 — an event equal to or later than the divergence date is discarded', async () => {
    const result = await generate([
      { date: '1993', text: cambodia, confidence: 'high' },
      { date: '2000-01-01', text: 'EVENTO_AL_CONFINE', confidence: 'high' },
      { date: '2000-06-01', text: 'EVENTO_FUTURO', confidence: 'high' },
      { date: '2002', text: 'EVENTO_SUCCESSIVO', confidence: 'high' },
    ]);
    expect(result).not.toMatch(/EVENTO_AL_CONFINE|EVENTO_FUTURO|EVENTO_SUCCESSIVO/);
  });

  it('3 — medium/low confidence entries are not accepted', async () => {
    const result = await generate([
      { date: '1993', text: cambodia, confidence: 'high' },
      { date: '1991', text: 'FATTO_INCERTO_MEDIUM', confidence: 'medium' },
      { date: '1990', text: 'FATTO_INCERTO_LOW', confidence: 'low' },
      { date: '1989', text: 'FATTO_SENZA_CONFIDENCE' },
    ]);
    expect(result).not.toMatch(/FATTO_INCERTO_MEDIUM|FATTO_INCERTO_LOW|FATTO_SENZA_CONFIDENCE/);
  });

  it('4 — a generic baseline that could describe almost any country is rejected', async () => {
    expect(isGenericHistoricalBaseline(generic)).toBe(true);
    expect(isGenericHistoricalBaseline(cambodia)).toBe(false);
    expect(await generate([{ date: '1990', text: generic, confidence: 'high' }])).toBeNull();
  });

  it('5 — after the divergence the game history dominates the opening prompt', () => {
    expect(ADVISOR_OPENING_REQUEST).toContain('come il paese arriva');
    expect(ADVISOR_OPENING_REQUEST).toContain('problemi presenti');
    // WS-CONSULENTE-SITUAZIONI — l'istruzione sulle situazioni vive nel BRIEFING MODE.
    expect(ADVISOR_OPENING_REQUEST).toContain('BRIEFING MODE');
    expect(ADVISOR_BRIEFING_SITUATION_PROTOCOL).toContain('senza un numero fisso');
    expect(ADVISOR_BRIEFING_SITUATION_PROTOCOL).toContain('council_issue');
    expect(advisorOpeningRequest({ turn: 1, date: '2000-01-01' }, '2000-01-01')).toBe(ADVISOR_OPENING_REQUEST);
    const later = advisorOpeningRequest({ turn: 2, date: '2002-01-01' }, '2000-01-01');
    expect(later).toContain('TURN BRIEFING');
    expect(later).not.toContain('primo intervento del mandato');
    expect(advisorOpeningRequest({ turn: 1, date: '2002-01-01' }, '2000-01-01')).toBe(later);
  });
});
