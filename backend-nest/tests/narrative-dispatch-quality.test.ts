/**
 * WS-NARR-DISPATCH-PAX-QUALITY — RUBRIC SANITY CHECK + contratti.
 *
 * IMPORTANTE: i corpus `weak`/`reference` della fixture sono **mock scritti a
 * mano**. Servono a verificare che la rubrica sappia distinguere un dispaccio
 * debole da uno buono, NON a dimostrare che il nuovo prompt migliori l'output
 * di un modello. Nessun miglioramento narrativo del prompt è misurato su
 * generazioni reali (nessuna chiamata a pagamento autorizzata).
 *
 * Nessuna chiamata LLM reale: i test con il motore usano stub che contano le
 * chiamate.
 */
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import {
  scoreScenario,
  scoreCausality,
  formatScoreLine,
  type EvalDispatch,
  type EvalOrder,
  type EvalScenario,
} from './helpers/narrativeQuality';
import {
  buildSimulationPrompt,
  buildConstrainedSimulationPrompt,
  buildWorldPulsePrompt,
  parseWorldPulseResponse,
  validateWorldPulse,
  selectWorldPulseCandidates,
  buildWorldPulseContext,
  dossierActiveAgendas,
  findMaterialClaim,
  validateNarrativeOnlyWorldPulseEvent,
  detectWorldPulseContradiction,
  mergeTimelineChronologically,
  WORLD_PULSE_MIN_EVENTS,
  WORLD_PULSE_MAX_EVENTS,
  type WorldPulseSelectionInput,
} from '../src/prompts/simulation';
import { buildNarrativeMemory } from '../src/prompts/narrative-memory';
import {
  classifyModel,
  narrativeBudgetsFor,
  CONSTRAINED_NARRATIVE_BUDGETS,
  FULL_NARRATIVE_BUDGETS,
} from '../src/llm/modelTier';
import { resolveNarrativeFlags, DEFAULT_NARRATIVE_FLAGS } from '../src/llm/narrativeFlags';
import { PromptEngine } from '../src/prompt-builder';

const FIXTURE = path.join(__dirname, 'fixtures', 'narrative-eval', 'scenario-millennium-dawn.json');

interface Fixture {
  scenario: { id: string; preset: string; orders: EvalScenario['orders'] };
  weak: EvalDispatch[];
  reference: EvalDispatch[];
}

function loadFixture(): Fixture {
  return JSON.parse(fs.readFileSync(FIXTURE, 'utf8')) as Fixture;
}

function toScenario(fx: Fixture, dispatches: EvalDispatch[]): EvalScenario {
  return { ...fx.scenario, dispatches };
}

/**
 * Punteggi registrati della **rubric sanity-check** sui corpus mockati. Non
 * sono «prima/dopo della PR»: misurano solo la sensibilità della rubrica.
 */
const RECORDED_WEAK = { total: 14.52, max: 26, causality: 0, variety: 0.52 };
const RECORDED_REFERENCE = { total: 26, max: 26, causality: 1, variety: 1 };

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

function minimalGame(overrides: Record<string, unknown> = {}): any {
  return {
    id: 'g1',
    currentDate: '2002-03-01',
    currentTurn: 1,
    world: {
      name: 'Test World',
      basePrompt: 'LORE',
      startDate: '2002-01-01',
      regions: {
        w1_KHM: { id: 'w1_KHM', name: 'Cambogia', owner: 'KHM', color: '#111', objects: [] },
        w1_THA: { id: 'w1_THA', name: 'Thailandia', owner: 'THA', color: '#222', objects: [] },
      },
    },
    players: [{ id: 'p1', name: 'Player', regionId: 'w1_KHM', polityId: 'KHM' }],
    playerPolityId: 'KHM',
    polityNames: { KHM: 'Cambogia', THA: 'Thailandia', VNM: 'Vietnam' },
    actions: [],
    results: [],
    ...overrides,
  };
}

function selection(overrides: Partial<WorldPulseSelectionInput> = {}): WorldPulseSelectionInput {
  return {
    playerPolityId: 'KHM',
    polities: [
      { id: 'KHM', name: 'Cambogia' },
      { id: 'THA', name: 'Thailandia' },
      { id: 'VNM', name: 'Vietnam' },
    ],
    relationships: [],
    commitments: '',
    recentEvents: [],
    npcDossiers: '',
    originDate: '2002-03-01',
    ...overrides,
  };
}

function stubRouter(opts: { narrative?: Record<string, boolean>; generate?: (m: string, s: string, u: string) => Promise<{ content: string }> } = {}) {
  const calls: string[] = [];
  const router = {
    narrative: { texture: false, worldPulse: false, tieredMemory: false, ...(opts.narrative || {}) },
    describe: () => ({ jump: { model: 'gpt-test' }, converter: { model: 'gpt-test' }, suggestions: { model: 'gpt-test' }, npc: { model: 'gpt-test' }, worldPulse: { model: 'gpt-test' } }),
    generate: async (mechanic: string, system: string, user: string) => {
      calls.push(mechanic);
      if (opts.generate) return opts.generate(mechanic, system, user);
      return { content: '{"type":"complete","narration":"nessun evento","actionOutcomes":[],"voided":[],"startChat":[],"relationshipChanges":[],"worldChanges":{"regionOwners":{},"regionColors":{}},"targetDate":"2002-03-31"}' };
    },
  };
  return { router: router as any, calls };
}

describe('RUBRIC SANITY CHECK (corpus mockati — NON output del nuovo prompt)', () => {
  const fx = loadFixture();
  const weak = scoreScenario(toScenario(fx, fx.weak));
  const reference = scoreScenario(toScenario(fx, fx.reference));

  it('la rubrica distingue weak da reference (punteggi registrati)', () => {
    console.log('[rubric-sanity] weak: ' + formatScoreLine(weak));
    console.log('[rubric-sanity] reference: ' + formatScoreLine(reference));
    expect(weak.total).toBe(RECORDED_WEAK.total);
    expect(weak.max).toBe(RECORDED_WEAK.max);
    expect(weak.criteria.causality).toBe(RECORDED_WEAK.causality);
    expect(weak.criteria.variety).toBeCloseTo(RECORDED_WEAK.variety, 3);
    expect(reference.total).toBe(RECORDED_REFERENCE.total);
    expect(reference.criteria.causality).toBe(RECORDED_REFERENCE.causality);
    expect(reference.criteria.variety).toBe(RECORDED_REFERENCE.variety);
  });

  it('il corpus reference non è presentato come output del nuovo prompt', () => {
    const raw = fs.readFileSync(FIXTURE, 'utf8');
    expect(raw).not.toContain('provider');
    expect(raw).not.toContain('generated');
    expect(fx.reference.every(d => typeof d.body === 'string')).toBe(true);
  });
});

describe('Causalità — la causa inventata non prende il massimo', () => {
  const order: EvalOrder = {
    id: 'o1', text: 'x', expectedOutcome: 'accepted', gameDate: '2002-03-31',
    structuredFacts: ['il deficit è crescente'], forbiddenClaims: [],
    allowedCauses: ['deficit crescente', 'deficit'],
  };
  const dispatch = (body: string): EvalDispatch => ({ orderId: 'o1', headline: 'Titolo', body, outcome: 'accepted' });

  it('marker causale + causa inventata → 0', () => {
    expect(scoreCausality(dispatch('A causa di un complotto segreto il governo agisce, con una decisione immediata.'), order)).toBe(0);
  });

  it('marker causale + causa canonica → 1', () => {
    expect(scoreCausality(dispatch('A causa del deficit crescente il governo taglia la spesa e rinvia i cantieri.'), order)).toBe(1);
  });

  it('causa canonica senza struttura causale → 0', () => {
    expect(scoreCausality(dispatch('Il deficit crescente resta il problema principale del paese in questo periodo.'), order)).toBe(0);
  });
});

describe('World pulse — trigger dinamici, non relazioni', () => {
  it('una relazione da sola (hostile/ally) NON crea il candidato', () => {
    const candidates = selectWorldPulseCandidates(selection({
      relationships: [
        { from: 'THA', to: 'VNM', relation: 'hostile' },
        { from: 'VNM', to: 'THA', relation: 'hostile' },
      ],
    }));
    expect(candidates).toEqual([]);
  });

  it('hostile + fatto recente → candidato (relazione come contesto)', () => {
    const candidates = selectWorldPulseCandidates(selection({
      relationships: [{ from: 'THA', to: 'VNM', relation: 'hostile' }],
      recentEvents: [{ date: '2002-02-20', headline: 'Incidenti di frontiera in Thailandia', detail: '' }],
    }));
    expect(candidates.map(c => c.polityId)).toEqual(['THA']);
    expect(candidates[0].triggers.join(' ')).toContain('fatto recente');
    expect(candidates[0].relevantRelations.join(' ')).toContain('hostile');
  });

  it('ally + impegno in vigore → candidato', () => {
    const candidates = selectWorldPulseCandidates(selection({
      relationships: [{ from: 'THA', to: 'VNM', relation: 'ally' }],
      commitments: 'Patto di difesa con la Thailandia',
    }));
    expect(candidates.map(c => c.polityId)).toEqual(['THA']);
    expect(candidates[0].triggers.join(' ')).toContain('impegno in vigore');
  });

  it('un fatto recente è un trigger solo se dentro la finestra', () => {
    const within = selectWorldPulseCandidates(selection({
      recentEvents: [{ date: '2002-02-20', headline: 'La Thailandia mobilita le riserve', detail: '' }],
    }));
    expect(within.map(c => c.polityId)).toEqual(['THA']);
    const tooOld = selectWorldPulseCandidates(selection({
      recentEvents: [{ date: '1999-01-01', headline: 'La Thailandia mobilita le riserve', detail: '' }],
    }));
    expect(tooOld).toEqual([]);
  });

  it('semplice menzione nel dossier NON è agenda attiva; agenda esplicita sì', () => {
    const mentionOnly = selectWorldPulseCandidates(selection({
      npcDossiers: '- Vietnam [VNM] — profilo persistente: cauto.\n  Priorità correnti: difendere il confine.',
    }));
    expect(mentionOnly).toEqual([]);

    const explicit = selectWorldPulseCandidates(selection({
      npcDossiers: '- Thailandia [THA] — profilo persistente: fermo.\n  Agenda strategica: consolidare le difese di frontiera',
    }));
    expect(explicit.map(c => c.polityId)).toEqual(['THA']);
    expect(explicit[0].agendaTriggers).toHaveLength(1);

    const fallback = selectWorldPulseCandidates(selection({
      npcDossiers: '- Thailandia [THA] — profilo persistente: fermo.\n  Agenda strategica: nessun obiettivo attivo registrato: non inventarne uno',
    }));
    expect(fallback).toEqual([]);
  });

  it('dossierActiveAgendas ignora il fallback del motore', () => {
    const agendas = dossierActiveAgendas([
      '- Thailandia [THA] — x',
      '  Agenda strategica: difendere il confine',
      '- Vietnam [VNM] — y',
      '  Agenda strategica: nessun obiettivo attivo registrato: non inventarne uno',
    ].join('\n'));
    expect([...agendas.keys()]).toEqual(['THA']);
  });
});

describe('World pulse — narrativa-only', () => {
  it('respinge materiale, accetta intenzione e atti non materiali', () => {
    expect(findMaterialClaim('Il governo mobilita due divisioni')).toBe('mobilit');
    expect(findMaterialClaim('La flotta occupa il porto')).toBe('occup');
    expect(findMaterialClaim('Il governo costruisce una base militare')).toBeTruthy();
    expect(findMaterialClaim('Il parlamento dichiara guerra al vicino')).toBe('dichiara guerra');
    expect(findMaterialClaim('Il governo annuncia che valuterà una mobilitazione')).toBeNull();
    expect(findMaterialClaim('Il ministero convoca l\'ambasciatore per consultazioni')).toBeNull();
    expect(findMaterialClaim('Il governo apre un dibattito parlamentare')).toBeNull();
    expect(findMaterialClaim('Il governo minaccia sanzioni')).toBeNull();
    expect(findMaterialClaim('Il governo chiede un vertice')).toBeNull();
  });

  it('una counterAction materiale invalida l\'evento', () => {
    const event: any = {
      headline: 'Consultazioni di frontiera', description: 'Il governo convoca l\'ambasciatore.',
      date: '2002-03-10', mapChanges: [],
      reactions: [{ actorId: 'THA', optionId: 'THA:pulse', polityName: 'Thailandia', role: 'neighbour', stance: 'neutral', response: 'convoca l\'ambasciatore', counterAction: 'mobilita 30.000 uomini' }],
    };
    expect(validateNarrativeOnlyWorldPulseEvent(event)).toMatch(/material_counter_action/);
  });
});

describe('World pulse — anti-contraddizione con il turno principale', () => {
  it('dopo una tregua del turno, una ripresa della guerra è una contraddizione', () => {
    const contradiction = detectWorldPulseContradiction(
      { headline: 'Riprende la guerra tra Thailandia e Vietnam', description: 'Nuova offensiva.', date: '2002-03-15', mapChanges: [], reactions: [] },
      { relationshipChanges: [{ from: 'Thailandia', to: 'Vietnam', relationship: 'neutral' }], polityNames: { THA: 'Thailandia', VNM: 'Vietnam' } },
    );
    expect(contradiction).toMatch(/relation_conflict/);
  });

  it('un esito respinto non può ricomparire come compiuto', () => {
    const contradiction = detectWorldPulseContradiction(
      { headline: 'Il governo vara la nazionalizzazione delle piantagioni', description: 'La misura è approvata.', date: '2002-03-15', mapChanges: [], reactions: [] },
      { rejectedOutcomes: ['il governo vara la nazionalizzazione delle piantagioni'] },
    );
    expect(contradiction).toBe('rejected_outcome_reused');
  });
});

describe('World pulse — 0-3 eventi e pipeline di validazione', () => {
  const input = selection({ commitments: 'Patto con la Thailandia' });
  const candidates = selectWorldPulseCandidates(input);
  const context = buildWorldPulseContext(candidates);
  const window = { originDate: '2002-03-01', targetDate: '2002-03-31', context };

  it('zero eventi è una risposta valida', () => {
    expect(WORLD_PULSE_MIN_EVENTS).toBe(0);
    const raw = '{"type":"complete","narration":"nessun evento","actionOutcomes":[],"voided":[],"startChat":[],"relationshipChanges":[],"worldChanges":{"regionOwners":{},"regionColors":{}},"targetDate":"2002-03-31"}';
    const result = validateWorldPulse(parseWorldPulseResponse(raw), window);
    expect(result.accepted).toEqual([]);
  });

  it('accetta un solo evento narrativa-only con data in finestra', () => {
    const raw = [
      '{"type":"event","headline":"La Thailandia convoca consultazioni di frontiera","description":"La Thailandia convoca l\'ambasciatore e chiede consultazioni dopo gli incidenti.","date":"2002-03-10","mapChanges":[],"reactions":[]}',
      '{"type":"complete","narration":"un evento","actionOutcomes":[],"voided":[],"startChat":[],"relationshipChanges":[],"worldChanges":{"regionOwners":{},"regionColors":{}},"targetDate":"2002-03-31"}',
    ].join('\n');
    const result = validateWorldPulse(parseWorldPulseResponse(raw), window);
    expect(result.accepted).toHaveLength(1);
  });

  it('respinge: data fuori finestra, mapChange, materiale, attore non candidato, opzione non ammessa', () => {
    const raw = [
      '{"type":"event","headline":"Fuori finestra","description":"Un fatto prima dell\'inizio del periodo.","date":"2002-02-01","mapChanges":[],"reactions":[]}',
      '{"type":"event","headline":"Mutazione materiale","description":"Un cantiere non autorizzato viene aperto.","date":"2002-03-05","mapChanges":[{"type":"start_construction","regionName":"X","feature":{"type":"factory","name":"F"}}],"reactions":[]}',
      '{"type":"event","headline":"Claim materiale","description":"La Thailandia mobilita due divisioni al confine.","date":"2002-03-06","mapChanges":[],"reactions":[]}',
      '{"type":"event","headline":"Attore estraneo","description":"Una nazione non candidata decide qualcosa.","date":"2002-03-07","mapChanges":[],"reactions":[{"actorId":"BRA","optionId":"BRA:pulse","polityName":"Brasile","role":"observer","stance":"neutral","response":"agisce"}]}',
      '{"type":"event","headline":"Opzione errata","description":"Un candidato sceglie un\'opzione inesistente.","date":"2002-03-08","mapChanges":[],"reactions":[{"actorId":"THA","optionId":"THA:bogus","polityName":"Thailandia","role":"neighbour","stance":"neutral","response":"agisce"}]}',
      '{"type":"complete","narration":"","actionOutcomes":[],"voided":[],"startChat":[],"relationshipChanges":[],"worldChanges":{"regionOwners":{},"regionColors":{}},"targetDate":"2002-03-31"}',
    ].join('\n');
    const result = validateWorldPulse(parseWorldPulseResponse(raw), { ...window, contradictions: { relationshipChanges: [], rejectedOutcomes: [] } });
    const reasons = result.rejected.map(r => r.reason);
    expect(result.accepted).toHaveLength(0);
    expect(reasons).toContain('date_out_of_window');
    expect(reasons.some(r => r.startsWith('unauthorized_map_change'))).toBe(true);
    expect(reasons.some(r => r.startsWith('material_claim'))).toBe(true);
    expect(reasons).toContain('reaction_contract');
  });

  it('non supera il tetto di 3 eventi', () => {
    const events = [1, 2, 3, 4, 5].map(i => `{"type":"event","headline":"Consultazione ${i}","description":"Il governo convoca l\'ambasciatore per una consultazione numero ${i}.","date":"2002-03-0${i}","mapChanges":[],"reactions":[]}`);
    const raw = [...events, '{"type":"complete","narration":"","actionOutcomes":[],"voided":[],"startChat":[],"relationshipChanges":[],"worldChanges":{"regionOwners":{},"regionColors":{}},"targetDate":"2002-03-31"}'].join('\n');
    const result = validateWorldPulse(parseWorldPulseResponse(raw), window);
    expect(WORLD_PULSE_MAX_EVENTS).toBe(3);
    expect(result.accepted.length).toBeLessThanOrEqual(3);
  });

  it('il prompt contiene divergenceDate, eventi del turno e separa relazioni/impegni', () => {
    const prompt = buildWorldPulsePrompt({
      originDate: '2002-03-01', targetDate: '2002-03-31', divergenceDate: '2002-01-01',
      playerPolity: 'Cambogia',
      candidates: [{
        polityId: 'THA', polityName: 'Thailandia',
        triggers: ['agenda NPC attiva: difendere il confine'],
        relevantRelations: ['Thailandia ↔ Vietnam: hostile'],
        activeCommitments: ['Patto con la Thailandia'],
        recentTriggers: [], agendaTriggers: ['difendere il confine'],
      }],
      mainEvents: [{ date: '2002-03-05', headline: 'Tregua tra Thailandia e Vietnam', description: 'Accordo firmato.' }],
      relationshipChanges: [{ from: 'Thailandia', to: 'Vietnam', relationship: 'neutral' }],
      recentChronicle: 'Cronaca.',
    });
    expect(prompt).toContain('[CONFINE TEMPORALE]');
    expect(prompt).toContain('Divergenza: 2002-01-01');
    expect(prompt).toContain('REAL HISTORY < 2002-01-01');
    expect(prompt).toContain('[EVENTI APPENA ACCADUTI NEL PERIODO]');
    expect(prompt).toContain('Tregua tra Thailandia e Vietnam');
    expect(prompt).toContain('[RELAZIONI CORRENTI]');
    expect(prompt).toContain('[IMPEGNI ATTIVI]');
    expect(prompt).toContain('CONTRATTO NARRATIVA-ONLY');
    expect(prompt).toContain('zero è valido');
  });
});

describe('Timeline — merge cronologico stabile', () => {
  it('ordina main e pulse per data; a parità, main prima del pulse', () => {
    const merged = mergeTimelineChronologically([
      { date: '2002-03-10', id: 'main-1' },
      { date: '2002-03-25', id: 'main-2' },
      { date: '2002-03-07', id: 'pulse-1' },
      { date: '2002-03-18', id: 'pulse-2' },
    ]);
    expect(merged.map(e => e.id)).toEqual(['pulse-1', 'main-1', 'pulse-2', 'main-2']);

    const tie = mergeTimelineChronologically([
      { date: '2002-03-10', id: 'main' },
      { date: '2002-03-10', id: 'pulse' },
    ]);
    expect(tie.map(e => e.id)).toEqual(['main', 'pulse']);
  });
});

describe('World pulse — fail-safe e zero chiamate', () => {
  it('flag spento → nessuna chiamata provider', async () => {
    const { router, calls } = stubRouter();
    const engine = new PromptEngine(router);
    const result = await engine.generateWorldPulse(minimalGame());
    expect(result).toBeNull();
    expect(calls).toEqual([]);
  });

  it('nessun candidato → nessuna chiamata provider', async () => {
    const { router, calls } = stubRouter({ narrative: { worldPulse: true } });
    const engine = new PromptEngine(router);
    const result = await engine.generateWorldPulse(minimalGame({ relationships: {}, activeCommitments: '', npcStrategicProfiles: '' }));
    expect(result).toBeNull();
    expect(calls).toEqual([]);
  });

  it('un candidato → una sola chiamata, sul mechanic worldPulse', async () => {
    const { router, calls } = stubRouter({ narrative: { worldPulse: true } });
    const engine = new PromptEngine(router);
    const result = await engine.generateWorldPulse(minimalGame({
      activeCommitments: 'Patto con la Thailandia',
    }));
    expect(calls).toEqual(['worldPulse']);
    expect(result).not.toBeNull();
  });

  it('errore provider → turno principale valido (null, nessun throw)', async () => {
    const { router } = stubRouter({
      narrative: { worldPulse: true },
      generate: async () => { throw new Error('provider down'); },
    });
    const engine = new PromptEngine(router);
    const result = await engine.generateWorldPulse(minimalGame({
      activeCommitments: 'Patto con la Thailandia',
    }));
    expect(result).toBeNull();
  });

  it('abort prima della chiamata → nessuna chiamata', async () => {
    const { router, calls } = stubRouter({ narrative: { worldPulse: true } });
    const engine = new PromptEngine(router);
    const controller = new AbortController();
    controller.abort();
    const result = await engine.generateWorldPulse(minimalGame({ activeCommitments: 'Patto con la Thailandia' }), { signal: controller.signal });
    expect(result).toBeNull();
    expect(calls).toEqual([]);
  });
});

describe('World pulse — integrazione nel run senza toccare il risultato principale', () => {
  it('espone gli eventi in un campo separato e lascia actionOutcomes/targetDate/events invariati', async () => {
    const mainComplete = '{"type":"complete","narration":"Il periodo si chiude.","actionOutcomes":[{"actionId":"a1","status":"accepted","summary":"esito principale"}],"voided":[],"startChat":[],"relationshipChanges":[],"worldChanges":{"regionOwners":{},"regionColors":{}},"targetDate":"1951-01-20"}';
    const mainEvents = [
      '{"type":"event","headline":"Il governo vara la riforma","description":"Il parlamento approva la riforma dopo il voto.","date":"1951-01-10","mapChanges":[],"reactions":[]}',
    ].join('\n');
    const full = `${mainEvents}\n${mainComplete}`;
    const pulseRaw = [
      '{"type":"event","headline":"La Thailandia convoca consultazioni di frontiera","description":"La Thailandia convoca l\'ambasciatore e chiede consultazioni dopo gli incidenti.","date":"1951-01-12","mapChanges":[],"reactions":[{"actorId":"THA","optionId":"THA:pulse","polityName":"Thailandia","role":"neighbour","stance":"neutral","response":"convoca l\'ambasciatore"}]}',
      '{"type":"complete","narration":"un evento","actionOutcomes":[],"voided":[],"startChat":[],"relationshipChanges":[],"worldChanges":{"regionOwners":{},"regionColors":{}},"targetDate":"1951-01-20"}',
    ].join('\n');

    const calls: string[] = [];
    const llm = {
      narrative: { texture: false, worldPulse: true, tieredMemory: false },
      describe: () => ({}),
      async stream(_m: string, _s: string, _u: string, onToken: (n: number, text?: string) => void) {
        onToken(full.length, full);
        return { content: full };
      },
      async generate(mechanic: string) {
        calls.push(mechanic);
        return { content: pulseRaw };
      },
    } as any;

    const game: any = {
      id: 'pulse-turn', currentDate: '1951-01-01', currentTurn: 1,
      world: {
        name: 'Test', basePrompt: 'Scenario test', startDate: '1951-01-01',
        regions: new Map([
          ['r1', { id: 'r1', name: 'Cambogia', owner: 'KHM', color: '#111', objects: [] }],
          ['r2', { id: 'r2', name: 'Thailandia', owner: 'THA', color: '#222', objects: [] }],
        ]),
      },
      players: [{ id: 'p1', name: 'Cambogia', regionId: 'r1', polityId: 'KHM' }],
      playerPolityId: 'KHM',
      polityNames: { KHM: 'Cambogia', THA: 'Thailandia' },
      activeCommitments: 'Patto con la Thailandia',
      actions: [], results: [],
    };

    const result = await new PromptEngine(llm).runSimulation(
      game, [{ actionId: 'a1', text: 'Riformare' } as any], 30, undefined, false,
    );

    expect(calls).toEqual(['worldPulse']);
    expect(result.events.map(e => e.headline)).toEqual(['Il governo vara la riforma']);
    expect(result.actionOutcomes?.[0]?.summary).toBe('esito principale');
    expect(result.targetDate).toBe('1951-01-20');
    expect(result.worldPulseEvents?.map(e => e.headline)).toEqual(['La Thailandia convoca consultazioni di frontiera']);
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

  it('accesa: esempi originali, varietà e gerarchia delle fonti', () => {
    const full = buildSimulationPrompt(baseVars, { texture: true });
    const compact = buildConstrainedSimulationPrompt(baseVars, { texture: true });
    for (const prompt of [full, compact]) {
      expect(prompt).toContain('[TEXTURE NARRATIVA — figure ed eventi documentati]');
      expect(prompt).toContain('[ESEMPI ORIGINALI DI BUON DISPACCIO');
      expect(prompt).toContain('[VARIETÀ DELLE APERTURE]');
      expect(prompt).toContain('STATO CORRENTE > STORIA DELLA PARTITA > STORIA REALE');
      expect(prompt).toContain('NON usare conoscenza storica futura');
    }
  });
});

describe('Passo 5 — memoria per fascia (due sole fasce)', () => {
  it('flag OFF = budget storici; ON constrained = compatto; ON full = più ampio', () => {
    const results = [1, 2, 3, 4, 5].map(turn => ({
      turn,
      date: `2002-0${turn}-01`,
      narration: 'Sintesi di periodo '.repeat(20),
      events: ['Un evento con una descrizione lunga '.repeat(10)],
    }));
    const canonical = 'MEMORIA '.repeat(400);
    const off = buildNarrativeMemory(results, canonical);
    const constrained = buildNarrativeMemory(results, canonical, CONSTRAINED_NARRATIVE_BUDGETS);
    const full = buildNarrativeMemory(results, canonical, FULL_NARRATIVE_BUDGETS);
    expect(off).toBe(constrained);
    expect(full.length).toBeGreaterThan(constrained.length);
    expect(classifyModel('glm-5.3').constrained).toBe(false);
    expect(classifyModel('glm-5.3-flash').constrained).toBe(true);
    expect(narrativeBudgetsFor('glm-5.3')).toBe(FULL_NARRATIVE_BUDGETS);
    expect(narrativeBudgetsFor('glm-5.3-flash')).toBe(CONSTRAINED_NARRATIVE_BUDGETS);
  });

  it('il prompt compatto usa i budget della fascia', () => {
    const constrained = buildConstrainedSimulationPrompt(baseVars, { budgets: CONSTRAINED_NARRATIVE_BUDGETS });
    const full = buildConstrainedSimulationPrompt(baseVars, { budgets: FULL_NARRATIVE_BUDGETS });
    expect(full.length).toBeGreaterThanOrEqual(constrained.length);
  });
});

describe('Flag narrativi — spenti di default', () => {
  it('senza file e senza env sono tutti spenti', () => {
    expect(resolveNarrativeFlags({}, {})).toEqual(DEFAULT_NARRATIVE_FLAGS);
    expect(DEFAULT_NARRATIVE_FLAGS).toEqual({ texture: false, worldPulse: false, tieredMemory: false });
  });

  it('si accendono solo con un valore esplicito (file o env)', () => {
    expect(resolveNarrativeFlags({ texture: true }, {}).texture).toBe(true);
    expect(resolveNarrativeFlags({}, { WS_NARRATIVE_WORLD_PULSE: 'on' }).worldPulse).toBe(true);
    expect(resolveNarrativeFlags({}, { WS_NARRATIVE_TIERED_MEMORY: 'forse' }).tieredMemory).toBe(false);
  });
});
