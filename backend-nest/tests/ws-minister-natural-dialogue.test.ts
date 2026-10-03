import { describe, expect, it } from 'vitest';
import { firstMessage, personaFor } from '../src/core/government/MinisterPersona';
import {
  buildMinisterOpeningBrief, groupOpeningIssues, composeMinisterOpeningPrompt,
  validateMinisterOpening, renderMinisterOpening,
} from '../src/core/government/MinisterOpening';
import type { CabinetItem, CabinetSeat } from '../src/core/government/Cabinet';
import type { MinisterWorldContext } from '../src/prompts/national-context';

const world: MinisterWorldContext = {
  worldName: 'Ricostruzione', country: 'Paese', currentDate: '1946-01-01',
  scenarioPremise: 'Il paese si sta ricostruendo dopo la guerra.', simulationRules: '',
  nationalContext: '', recentHistory: '', activeCommitments: '', ongoingProcesses: '',
};
const figures = [
  ['Saldo di bilancio', '7.60', 'mld'], ['Saldo su PIL', '0.3', '%'],
  ['Prelievo effettivo', '9.5', '%'], ['Debito su PIL', '110', '%'], ['Interessi su entrate', '15.1', '%'],
].map(([label, value, unit]) => ({ label, value, unit, basis: { kind: 'measured' as const, source: 'conti nazionali' } }));
const items: CabinetItem[] = [
  { voiceId: 'treasury_condition', need: 'Decidere che fare dell’avanzo', because: 'Il debito pesa sui conti', urgency: 'urgente', figures,
    paths: [{ id: 'repay', title: 'Ridurre il debito', detail: 'Usare l’avanzo', expected: 'Meno interessi', prerequisites: [], recommended: true },
      { id: 'invest', title: 'Investire l’avanzo', detail: 'Opere', expected: 'Crescita', prerequisites: [], recommended: false }] },
  { voiceId: 'debt_service', need: 'Gli interessi pesano', because: 'Il debito pesa sui conti', urgency: 'critica', figures: figures.slice(3), paths: [] },
];
const brief = (seat: CabinetSeat = 'tesoro') => buildMinisterOpeningBrief(seat, world, items);
const prose = 'Presidente, il saldo è di 7,60 miliardi, pari allo 0,3% del PIL. Il prelievo è al 9,5%, ma il debito al 110% del PIL e gli interessi al 15,1% delle entrate mi consigliano prudenza.\n\nIo ridurrei il debito prima di impegnare tutto il margine. Vuoi confrontare questa strada con gli investimenti?';

describe('WS-MINISTER-NATURAL-DIALOGUE', () => {
  it('il fallback non recita mandato, conteggio o cuciture del dossier e non ripete il debito', () => {
    const text = firstMessage('tesoro', items);
    expect(text).not.toContain(personaFor('tesoro').mandate);
    expect(text).not.toMatch(/Ho \d+ cose|La strada è una scelta:|Tocca a te decidere|Dimmi tu qual è la priorità| — /);
    expect(text.match(/110/g)).toHaveLength(1);
    expect(text.match(/15[.,]1/g)).toHaveLength(1);
  });
  it('raggruppa gli aspetti del Tesoro senza modificare o perdere le voci', () => {
    const before = JSON.stringify(items);
    const opening = brief();
    const groups = groupOpeningIssues(opening.issues);
    expect(groups).toHaveLength(1);
    expect(groups[0].voiceIds).toEqual(['treasury_condition', 'debt_service']);
    expect(groups[0].figures).toHaveLength(5);
    expect(opening.issues).toHaveLength(2);
    expect(JSON.stringify(items)).toBe(before);
  });
  it('il prompt usa persona e mondo come istruzioni, i fatti come struttura, senza direttive', () => {
    const prompt = composeMinisterOpeningPrompt(brief());
    expect(prompt).toContain(personaFor('tesoro').priorities);
    expect(prompt).toContain(world.scenarioPremise);
    expect(prompt).toContain('"voiceIds"');
    expect(prompt).toContain('persistMemory: false');
    expect(prompt).toContain('allowDirectives: false');
    expect(prompt).toContain('raramente');
  });
  it('conserva tutte le cifre esatte se usate e rifiuta arrotondamenti, numeri nuovi e duplicazioni', () => {
    expect(validateMinisterOpening(prose, brief())).toBe(true);
    for (const [from, to] of [['7,60', '7'], ['0,3', '0,4'], ['9,5', '12'], ['110', '100'], ['15,1', '15']]) {
      expect(validateMinisterOpening(prose.replace(from, to), brief())).toBe(false);
    }
    expect(validateMinisterOpening(prose.replace('7,60', '-7,60'), brief())).toBe(false);
    expect(validateMinisterOpening(`${prose} Il debito è al 110%.`, brief())).toBe(false);
    expect(validateMinisterOpening('Ho 2 cose da portare al consiglio.', brief())).toBe(false);
  });
  it('il renderer è primario, ripulisce le direttive e conserva la prosa verificata', async () => {
    const result = await renderMinisterOpening(brief(), async () => `${prose}\n\`\`\`decision\n{"op":"accept-proposal"}\n\`\`\``);
    expect(result).toEqual({ reply: prose, source: 'llm' });
  });
  it('errore, timeout e cifre alterate portano al fallback naturale', async () => {
    const fallback = firstMessage('tesoro', items);
    for (const generate of [async () => { throw new Error('offline'); }, async () => 'Il debito è al 100%.', () => new Promise<string>(() => {})]) {
      expect(await renderMinisterOpening(brief(), generate, undefined, 5)).toEqual({ reply: fallback, source: 'deterministic' });
    }
  });
  it('stessi fatti, registri diversi: conti, cantieri e persone', () => {
    const texts = (['tesoro', 'lavori', 'sanita'] as const).map(seat => firstMessage(seat, items));
    expect(new Set(texts).size).toBe(3);
    expect(texts[0]).toMatch(/conti|debito/);
    expect(texts[1]).toMatch(/materiali|cantier/);
    expect(texts[2]).toMatch(/persone|cure/);
    for (const seat of ['tesoro', 'lavori', 'sanita'] as const) {
      expect(composeMinisterOpeningPrompt(brief(seat))).toContain(personaFor(seat).voice);
    }
  });
});
