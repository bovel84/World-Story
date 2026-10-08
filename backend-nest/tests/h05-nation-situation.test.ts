/**
 * H05 — La situazione iniziale della nazione.
 *
 * Difende le invarianti:
 *  - la nazione è conosciuta a prescindere dal preset (H-I10): la situazione è
 *    per-nazione, non per-preset, e copre anche chi il preset non nomina;
 *  - è **subordinata ai filoni** (H-I11): il prompt la vincola sui nodi fissati;
 *  - la `trajectory` è una **tendenza**, mai una profezia (H-I12): la regola lo
 *    dichiara nel testo del prompt;
 *  - gating di confidenza: solo le voci `high` sopravvivono; fail-closed.
 */
import { describe, it, expect } from 'vitest';
import {
  buildNationSituationPrompt, composeNationSituation, generateNationSituation,
  isUsableNationSituation, renderNationSituation, renderPolityNationSituations,
  NATION_SITUATION_RULE, NATION_SITUATION_MIN_CHARS,
} from '../src/core/government/NationSituation';
import type { Storyline } from '../src/scenario/storylines';

const base = {
  worldName: 'Millennium Dawn', polityId: 'ISR', countryName: 'Stato d\'Israele',
  startDate: '2000-01-01', premise: 'Il mondo entra nel nuovo millennio.',
};

const filone: Storyline = {
  id: 'levante-disarmo-hamas', title: 'Il disarmo di Hamas', domain: 'esteri',
  parties: ['ISR', 'PSE', 'USA'], region: 'Levante', state: 'aperto', pressure: 3,
  summary: 'Israele e gli USA premono per il disarmo.', trajectory: 'Scivola verso lo scontro.',
  triggers: ['attentato'],
};

describe('H05 — il prompt', () => {
  it('chiede presente e direzione, non il passato', () => {
    const p = buildNationSituationPrompt(base);
    expect(p).toContain('PRESENTE');
    expect(p).toContain('DIREZIONE');
    expect(p).toContain('NON raccontare il passato');
  });

  it('vincola la generazione sui filoni che toccano la nazione (H-I11)', () => {
    const p = buildNationSituationPrompt({ ...base, storylines: [filone] });
    expect(p).toContain('[FILONI DEL PRESET CHE TOCCHIAMO — NON contraddirli]');
    expect(p).toContain('levante-disarmo-hamas');
    expect(p).toContain('Direzione dichiarata dal preset: Scivola verso lo scontro.');
    expect(p).toContain('deve SEGUIRE il filone');
  });

  it('senza filoni non aggiunge il blocco di vincolo', () => {
    expect(buildNationSituationPrompt(base)).not.toContain('NON contraddirli');
  });

  it('dichiara che il futuro è una tendenza, mai un fatto (H-I12)', () => {
    const p = buildNationSituationPrompt(base);
    expect(p).toContain('TENDENZA');
    expect(p).toContain('mai un fatto');
    // E il divieto esplicito di una data futura come fatto.
    expect(p).toMatch(/non.*nel 2001 accadrà/si);
  });
});

describe('H05 — gating di confidenza (fail-closed)', () => {
  it('tiene SOLO le voci high', () => {
    const raw = JSON.stringify({ entries: [
      { text: 'Israele affronta la seconda intifada e un governo di coalizione fragile, con il negoziato di Camp David bloccato da mesi.', confidence: 'high' },
      { text: 'Forse Israele ha un programma nucleare non dichiarato e segreto, ma non è documentato con certezza.', confidence: 'low' },
      { text: 'Qualcosa di incerto sulla politica interna israeliana del 2000 che non è ben documentato in modo chiaro.', confidence: 'medium' },
    ] });
    const out = composeNationSituation(raw)!;
    expect(out).toContain('seconda intifada');
    expect(out).not.toContain('nucleare');
    expect(out).not.toContain('Qualcosa di incerto');
  });

  it('senza voci high → null (non un profilo inventato)', () => {
    const raw = JSON.stringify({ entries: [{ text: 'Una frase lunga a sufficienza ma incerta.', confidence: 'low' }] });
    expect(composeNationSituation(raw)).toBeNull();
  });

  it('JSON non valido → null', () => {
    expect(composeNationSituation('non è json')).toBeNull();
    expect(composeNationSituation('{"entries": "no"}')).toBeNull();
  });

  it('una risposta troppo corta → null (MIN_CHARS)', () => {
    const raw = JSON.stringify({ entries: [{ text: 'Corta.', confidence: 'high' }] });
    expect(composeNationSituation(raw)).toBeNull();
    expect(isUsableNationSituation('x'.repeat(NATION_SITUATION_MIN_CHARS - 1))).toBe(false);
    expect(isUsableNationSituation('x'.repeat(NATION_SITUATION_MIN_CHARS))).toBe(true);
  });

  it('generateNationSituation è fail-closed se il provider lancia', async () => {
    const out = await generateNationSituation(base, async () => { throw new Error('boom'); });
    expect(out).toBeNull();
  });

  it('generateNationSituation compone dal provider', async () => {
    const out = await generateNationSituation(base, async () =>
      JSON.stringify({ entries: [{ text: 'La nazione entra nel 2000 con una coalizione fragile, il negoziato di pace bloccato e la pressione degli Stati Uniti sul disarmo delle milizie.', confidence: 'high' }] }));
    expect(out).toContain('coalizione fragile');
  });
});

describe('H05 — il blocco nel prompt del Consulente', () => {
  it('rende la situazione con la data di partenza e la gerarchia', () => {
    const block = renderNationSituation('Israele affronta la seconda intifada.', { countryName: 'Israele', polityId: 'ISR', startDate: '2000-01-01' });
    expect(block).toContain('[SITUAZIONE DELLA NAZIONE — ISRAELE — 2000-01-01]');
    expect(block).toContain(NATION_SITUATION_RULE);
  });

  it('la gerarchia mette il filone sopra il contesto (H-I11) e lo stato sopra tutto', () => {
    expect(NATION_SITUATION_RULE).toContain('STATO CORRENTE DEL MOTORE > STORIA DELLA PARTITA > FILONE DEL PRESET > CONTESTO DELLA NAZIONE');
  });
});

describe('H06 — le situazioni delle altre nazioni (gli NPC del teatro)', () => {
  const record = (polityId: string, countryName: string, situation: string) =>
    ({ polityId, countryName, startDate: '2000-01-01', situation, generatedAt: 'x', version: 1 });

  it('rende i blocchi delle altre nazioni con la loro data e la gerarchia', () => {
    const block = renderPolityNationSituations([
      record('ISR', 'Israele', 'Israele affronta la seconda intifada e un governo di coalizione fragile.'),
      record('USA', 'Stati Uniti', 'Washington è in surplus e concentrata sul Medio Oriente.'),
    ])!;
    expect(block).toContain('[SITUAZIONI DELLE ALTRE NAZIONI');
    expect(block).toContain('Israele (ISR)');
    expect(block).toContain('Stati Uniti (USA)');
    expect(block).toContain(NATION_SITUATION_RULE);
  });

  it('senza situazioni non emette un blocco vuoto', () => {
    expect(renderPolityNationSituations([])).toBe('');
  });
});
