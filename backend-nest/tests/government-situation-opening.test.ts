/**
 * WS-GOV-SITUATIONS-LOOP P0.2 — L'apertura del ministro quando la seduta nasce
 * da una `GovernmentSituation`: il prompt riceve la situazione STRUTTURATA, e la
 * validazione ammette solo i numeri che il motore ha già verificato.
 */
import { describe, expect, it } from 'vitest';
import {
  buildMinisterOpeningBrief,
  composeMinisterOpeningPrompt,
  parseSituationBrief,
  validateMinisterOpening,
  type SituationBrief,
} from '../src/core/government/MinisterOpening';
import type { MinisterWorldContext } from '../src/prompts/national-context';

const world: MinisterWorldContext = {
  worldName: 'Test', country: 'Paese', currentDate: '1951-01-01', scenarioPremise: '',
  simulationRules: '', nationalContext: '', recentHistory: '', activeCommitments: '', ongoingProcesses: '',
};

const situation: SituationBrief = {
  title: 'Incidente di frontiera con Serbia',
  briefing: 'Due militari uccisi e accuse incrociate con Serbia.',
  source: 'Comando di frontiera',
  daysLeft: 12,
  severity: 3,
  verifiedFacts: ['Forze mobilitate 35', 'Tensione sociale 48/100'],
  decisionQuestion: 'Come rispondiamo all’incidente?',
  inactionNote: 'La tensione al confine aumenta.',
  options: [{ id: 'retaliate', label: 'Rafforzare il settore', detail: 'Un battaglione per novanta giorni.' }],
  suggestedMinisters: ['esteri', 'tesoro'],
  originType: 'state',
};

describe('MinisterOpening con situazione', () => {
  it('il prompt riceve la situazione strutturata, non solo la domanda', () => {
    const brief = buildMinisterOpeningBrief('guerra', world, [], undefined, situation);
    const prompt = composeMinisterOpeningPrompt(brief);
    expect(prompt).toContain('Incidente di frontiera con Serbia');
    expect(prompt).toContain('FATTI VERIFICATI');
    expect(prompt).toContain('Forze mobilitate 35');
    expect(prompt).toContain('DECISIONE RICHIESTA: Come rispondiamo all’incidente?');
    expect(prompt).toContain('SE NON SI DECIDE: La tensione al confine aumenta.');
    expect(prompt).toContain('CORSI D’AZIONE CHE IL MOTORE CONOSCE');
    expect(prompt).toContain('Rafforzare il settore');
    expect(prompt).toContain('COLLEGHI UTILI DA SENTIRE: esteri, tesoro');
  });

  it('accetta un’apertura che cita i fatti della situazione ma non un fatto inventato', () => {
    const brief = buildMinisterOpeningBrief('guerra', world, [], undefined, situation);
    expect(validateMinisterOpening('Presidente, stanotte c’è stato un attacco al confine: due morti. Restano 12 giorni e le forze mobilitate sono 35. Propongo di rafforzare il settore; sentirei Esteri e Tesoro.', brief)).toBe(true);
    expect(validateMinisterOpening('Presidente, ho già spostato 250 carri armati al confine.', brief)).toBe(false);
  });

  it('senza situazione il prompt resta quello di prima', () => {
    const brief = buildMinisterOpeningBrief('guerra', world, [], undefined);
    expect(composeMinisterOpeningPrompt(brief)).not.toContain('SITUAZIONE IN SEDUTA');
  });

  it('sanifica ciò che arriva dal client e rifiuta un payload senza titolo o briefing', () => {
    const parsed = parseSituationBrief({
      title: '  Incidente  ', briefing: 'Due morti.', daysLeft: 12.6, severity: 3,
      verifiedFacts: ['Forze mobilitate 35', 123, ''],
      inaction: { note: 'Peggiora.' }, origin: { type: 'inaction', sourceId: 'p#1' },
      options: [{ id: 'retaliate', label: 'Rafforzare', detail: 'Un battaglione.' }, { id: '', label: 'x' }],
      extra: 'ignorato',
    });
    expect(parsed?.title).toBe('Incidente');
    expect(parsed?.daysLeft).toBe(13);
    expect(parsed?.verifiedFacts).toEqual(['Forze mobilitate 35']);
    expect(parsed?.inactionNote).toBe('Peggiora.');
    expect(parsed?.originType).toBe('inaction');
    expect(parsed?.options).toEqual([{ id: 'retaliate', label: 'Rafforzare', detail: 'Un battaglione.' }]);
    expect(parseSituationBrief({ title: 'Solo titolo' })).toBeUndefined();
    expect(parseSituationBrief(null)).toBeUndefined();
  });
});
