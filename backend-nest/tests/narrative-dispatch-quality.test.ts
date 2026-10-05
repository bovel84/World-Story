/**
 * WS-NARR-DISPATCH-PAX-QUALITY — harness offline + contratti.
 *
 * Nessuna chiamata LLM: valuta corpus mockati con la rubrica di
 * `helpers/narrativeQuality` e verifica i contratti dei Passi 2-5.
 */
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import {
  scoreScenario,
  formatScoreLine,
  type EvalDispatch,
  type EvalScenario,
} from './helpers/narrativeQuality';
import {
  buildSimulationPrompt,
  buildConstrainedSimulationPrompt,
  buildWorldPulsePrompt,
  parseWorldPulseResponse,
  validateWorldPulse,
  shouldRunWorldPulse,
  WORLD_PULSE_MIN_EVENTS,
  WORLD_PULSE_MAX_EVENTS,
} from '../src/prompts/simulation';
import { buildNarrativeMemory } from '../src/prompts/narrative-memory';
import {
  classifyModel,
  narrativeBudgetsFor,
  CONSTRAINED_NARRATIVE_BUDGETS,
  FULL_NARRATIVE_BUDGETS,
} from '../src/llm/modelTier';
import { resolveNarrativeFlags, DEFAULT_NARRATIVE_FLAGS } from '../src/llm/narrativeFlags';
import type { ReactionContext } from '../src/core/simulation/ReactionContext';

const FIXTURE = path.join(__dirname, 'fixtures', 'narrative-eval', 'scenario-millennium-dawn.json');

interface Fixture {
  scenario: { id: string; preset: string; orders: EvalScenario['orders'] };
  baseline: EvalDispatch[];
  enhanced: EvalDispatch[];
}

function loadFixture(): Fixture {
  return JSON.parse(fs.readFileSync(FIXTURE, 'utf8')) as Fixture;
}

function toScenario(fx: Fixture, dispatches: EvalDispatch[]): EvalScenario {
  return { ...fx.scenario, dispatches };
}

/**
 * Punteggio di partenza registrato con i corpus mockati (nessuna chiamata
 * provider). È la misura di riferimento del Passo 6: se cambia, il test lo
 * segnala.
 */
const RECORDED_BASELINE = {
  total: 14.52,
  max: 26,
  facts: 2 / 5,
  success: 3 / 5,
  causality: 0 / 5,
  language: 5 / 5,
  future: 4 / 5,
  variety: 0.52,
};

const RECORDED_ENHANCED = {
  total: 26,
  max: 26,
  facts: 5 / 5,
  success: 5 / 5,
  causality: 5 / 5,
  language: 5 / 5,
  future: 5 / 5,
  variety: 1,
};

const baseVars: any = {
  PLAYER_POLITY: 'Cambogia',
  LANGUAGE: 'italian',
  DIFFICULTY_DESCRIPTION_JUMP_FORWARD: 'Difficoltà: normale',
  WORLD_BEFORE_ROUND_ONE_TEXT: 'Il paese esce da decenni di conflitto.',
  HISTORICAL_PRESET_SIMULATION_RULES: 'Regole del preset.',
  GRAND_MAP_DESCRIPTION_NO_CITY: 'Provincia "Sihanoukville" [KHM]\nCambogia',
  GRAND_MAP_DESCRIPTION: 'mappa',
  ALL_EVENTS_WITH_CONSOLIDATION: 'Cronaca recente.',
  CHATS_NON_CONSOLIDATED_ROUNDS: '',
  STARTING_ROUND_DATE: '2002-01-01',
  ORIGIN_ROUND_DATE: '2002-03-01',
  TARGET_ROUND_DATE: '2002-03-31',
  ORIGIN_ROUND_GRAMMATICAL_DATE: '1 marzo 2002',
  TARGET_ROUND_GRAMMATICAL_DATE: '31 marzo 2002',
  CURRENT_ROUND_NUMBER: 1,
  PLAYER_ACTIONS_THIS_ROUND: '',
  PLAYER_EVERY_ACTION_NOT_PREVIOUS: '',
  STRATEGIC_STATE: 'Stato strategico.',
  NPC_STRATEGIC_PROFILES: 'Obiettivi NPC.',
  ACTIVE_COMMITMENTS: '(Nessun impegno)',
  REACTION_CONTEXT: '',
};

function minimalContext(): ReactionContext {
  return {
    trigger: { kind: 'prior_event', summary: 'scontri di frontiera' },
    actors: [
      {
        id: 'THA', name: 'Thailandia', role: 'neighbour', because: 'confine conteso',
        interests: ['sicurezza'], options: [{ id: 'THA:defend', label: 'Difendere il confine' }],
      },
    ],
    constraints: [],
    allowedOptionIds: ['THA:defend'],
    maxReactions: 1,
  };
}

describe('Passo 1 — harness offline (corpus mockati, nessun provider)', () => {
  const fx = loadFixture();
  const baseline = scoreScenario(toScenario(fx, fx.baseline));
  const enhanced = scoreScenario(toScenario(fx, fx.enhanced));

  it('salva e riproduce il punteggio di partenza', () => {
    // Stampa la tabella prima/dopo (utile nei log della CI).
    console.log('[narrative-eval] baseline: ' + formatScoreLine(baseline));
    console.log('[narrative-eval] enhanced: ' + formatScoreLine(enhanced));

    expect(baseline.total).toBe(RECORDED_BASELINE.total);
    expect(baseline.max).toBe(RECORDED_BASELINE.max);
    expect(baseline.criteria.facts).toBeCloseTo(RECORDED_BASELINE.facts, 5);
    expect(baseline.criteria.success).toBeCloseTo(RECORDED_BASELINE.success, 5);
    expect(baseline.criteria.causality).toBeCloseTo(RECORDED_BASELINE.causality, 5);
    expect(baseline.criteria.language).toBeCloseTo(RECORDED_BASELINE.language, 5);
    expect(baseline.criteria.future).toBeCloseTo(RECORDED_BASELINE.future, 5);
    expect(baseline.criteria.variety).toBeCloseTo(RECORDED_BASELINE.variety, 3);
  });

  it('il corpus «dopo» migliora tutti i criteri misurabili', () => {
    expect(enhanced.total).toBe(RECORDED_ENHANCED.total);
    expect(enhanced.total).toBeGreaterThan(baseline.total);
    for (const key of ['facts', 'success', 'causality', 'language', 'future', 'variety'] as const) {
      expect(enhanced.criteria[key]).toBeGreaterThanOrEqual(baseline.criteria[key]);
    }
    expect(enhanced.criteria.causality).toBe(1);
    expect(enhanced.criteria.variety).toBeGreaterThan(baseline.criteria.variety);
  });
});

describe('Passo 2 — unica fonte di verità per il tetto eventi e formato', () => {
  it('il prompt standard deriva il tetto dagli eventi e non usa più «25-30»', () => {
    const prompt = buildSimulationPrompt(baseVars);
    expect(prompt).toContain('MAI più di 12 per turno');
    expect(prompt).not.toContain('25-30');
  });

  it('il budget passato dal motore vince sul default', () => {
    expect(buildSimulationPrompt(baseVars, { eventBudget: 5 })).toContain('MAI più di 5 per turno');
  });

  it('il prompt chiuso non contraddice il protocollo NDJSON', () => {
    const prompt = buildSimulationPrompt(baseVars);
    expect(prompt).not.toContain('Rispondi SOLO con JSON valido');
    expect(prompt).toContain('JSON Lines');
  });
});

describe('Passo 3 — texture narrativa dietro flag', () => {
  it('spenta di default: nessun blocco texture', () => {
    expect(buildSimulationPrompt(baseVars)).not.toContain('[TEXTURE NARRATIVA');
    expect(buildConstrainedSimulationPrompt(baseVars)).not.toContain('[TEXTURE NARRATIVA');
  });

  it('accesa: esempi originali e regola di varietà nel compatto e nello standard', () => {
    const full = buildSimulationPrompt(baseVars, { texture: true });
    const compact = buildConstrainedSimulationPrompt(baseVars, { texture: true });
    for (const prompt of [full, compact]) {
      expect(prompt).toContain('[TEXTURE NARRATIVA — figure ed eventi documentati]');
      expect(prompt).toContain('[ESEMPI ORIGINALI DI BUON DISPACCIO');
      expect(prompt).toContain('[VARIETÀ DELLE APERTURE]');
    }
  });
});

describe('Passo 4 — world pulse dietro flag', () => {
  it('spento: non parte senza obiettivi o senza flag', () => {
    expect(shouldRunWorldPulse(false, 'Obiettivi')).toBe(false);
    expect(shouldRunWorldPulse(true, '')).toBe(false);
    expect(shouldRunWorldPulse(true, 'Obiettivi')).toBe(true);
  });

  it('accendo: prompt dedicato con 3-6 eventi di nazioni lontane', () => {
    const prompt = buildWorldPulsePrompt({
      originDate: '2002-03-01', targetDate: '2002-03-31', playerPolity: 'Cambogia',
      npcAgenda: 'Thailandia: sicurezza di confine', relationships: 'Cambogia-Thailandia tese',
      strategicState: 'Due battaglioni a nord.', recentChronicle: 'Scontri di frontiera.',
    });
    expect(prompt).toContain('RESPIRO DEL MONDO');
    expect(prompt).toContain(`da ${WORLD_PULSE_MIN_EVENTS} a ${WORLD_PULSE_MAX_EVENTS} eventi`);
    expect(prompt).toContain('NAZIONI LONTANE');
    expect(prompt).toContain('causa verificabile');
  });

  it('le reazioni fuori contratto vengono respinte, quelle valide accettate', () => {
    const raw = [
      '{"type":"event","headline":"La Thailandia rafforza il confine","description":"La Thailandia schiera rinforzi dopo gli scontri.","date":"2002-03-10","mapChanges":[],"reactions":[]}',
      '{"type":"event","headline":"Un attore inventato agisce","description":"Una nazione non ammessa decide qualcosa.","date":"2002-03-12","mapChanges":[],"reactions":[{"actorId":"XXX","optionId":"XXX:do","polityName":"Ignota","role":"observer","stance":"neutral","response":"agisce"}]}',
      '{"type":"complete","narration":"due eventi","actionOutcomes":[],"voided":[],"startChat":[],"relationshipChanges":[],"worldChanges":{"regionOwners":{},"regionColors":{}},"targetDate":"2002-03-31"}',
    ].join('\n');
    const parsed = parseWorldPulseResponse(raw);
    expect(parsed.events).toHaveLength(2);
    const validation = validateWorldPulse(parsed, minimalContext());
    expect(validation.accepted).toHaveLength(1);
    expect(validation.rejected).toHaveLength(1);
  });
});

describe('Passo 5 — memoria per fascia di modello dietro flag', () => {
  it('classifyModel distingue le fasce e i budget forti sono maggiori', () => {
    expect(classifyModel('glm-5.3').constrained).toBe(false);
    expect(classifyModel('glm-5.3-flash').constrained).toBe(true);
    expect(FULL_NARRATIVE_BUDGETS.recentMemoryChars).toBeGreaterThan(CONSTRAINED_NARRATIVE_BUDGETS.recentMemoryChars);
    expect(FULL_NARRATIVE_BUDGETS.canonicalMemoryChars).toBeGreaterThan(CONSTRAINED_NARRATIVE_BUDGETS.canonicalMemoryChars);
    expect(narrativeBudgetsFor('glm-5.3')).toBe(FULL_NARRATIVE_BUDGETS);
    expect(narrativeBudgetsFor('glm-5.3-flash')).toBe(CONSTRAINED_NARRATIVE_BUDGETS);
  });

  it('a parità di cronaca, la fascia piena riceve più testo', () => {
    const results = [1, 2, 3, 4, 5].map(turn => ({
      turn,
      date: `2002-0${turn}-01`,
      narration: 'Sintesi di periodo '.repeat(20),
      events: ['Un evento con una descrizione lunga '.repeat(10)],
    }));
    const constrained = buildNarrativeMemory(results, 'MEMORIA '.repeat(400), CONSTRAINED_NARRATIVE_BUDGETS);
    const full = buildNarrativeMemory(results, 'MEMORIA '.repeat(400), FULL_NARRATIVE_BUDGETS);
    expect(full.length).toBeGreaterThan(constrained.length);
  });

  it('il prompt compatto usa i budget della fascia', () => {
    const constrained = buildConstrainedSimulationPrompt(baseVars, { budgets: CONSTRAINED_NARRATIVE_BUDGETS });
    const full = buildConstrainedSimulationPrompt(baseVars, { budgets: FULL_NARRATIVE_BUDGETS });
    expect(full.length).toBeGreaterThanOrEqual(constrained.length);
  });
});

describe('Flag narrativi — spenti di default', () => {
  it('senza file e senza env sono tutti spenti', () => {
    // L'env di test non deve contenere WS_NARRATIVE_*.
    expect(resolveNarrativeFlags({}, {})).toEqual(DEFAULT_NARRATIVE_FLAGS);
    expect(DEFAULT_NARRATIVE_FLAGS).toEqual({ texture: false, worldPulse: false, tieredMemory: false });
  });

  it('si accendono solo con un valore esplicito (file o env)', () => {
    expect(resolveNarrativeFlags({ texture: true }, {}).texture).toBe(true);
    expect(resolveNarrativeFlags({}, { WS_NARRATIVE_WORLD_PULSE: 'on' }).worldPulse).toBe(true);
    // Un refuso non accende nulla.
    expect(resolveNarrativeFlags({}, { WS_NARRATIVE_TIERED_MEMORY: 'forse' }).tieredMemory).toBe(false);
  });
});
