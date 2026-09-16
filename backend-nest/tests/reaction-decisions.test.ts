/**
 * Contratto motore ↔ LLM per le reazioni NPC — test A–J.
 * ======================================================
 * Il motore decide chi può reagire e quali opzioni sono ammesse; il validator
 * deterministico rifiuta (fail-closed) un output fuori da quello spazio, con un
 * solo repair di formato e senza mai rigenerare la simulazione.
 */
import { describe, expect, it, vi } from 'vitest';
import type { ReactionContext } from '../src/core/simulation/ReactionContext';
import { buildReactionContext } from '../src/core/simulation/ReactionContext';
import {
  describeReactionShape,
  measureMaterialCategory,
  optionMaterialScope,
  reactionAllowsMaterialCategory,
  repairReactionDecisions,
  validateReactionDecisions,
  type ReactionEventLike,
} from '../src/core/simulation/ReactionDecisions';
import { LLMContractError } from '../src/llm/contract-error';
import { parseSimulationResponse } from '../src/prompts/simulation/parse';

function context(overrides: Partial<ReactionContext> = {}): ReactionContext {
  return {
    trigger: { kind: 'player_action', summary: 'Invia ultimatum alla Germania', sourceRef: 'A9' },
    actors: [
      {
        id: 'FRA', name: 'Francia', role: 'counterparty', because: 'nominata', interests: ['sicurezza'],
        options: [
          { id: 'FRA:negotiate', label: 'Negozia' },
          { id: 'FRA:reject', label: 'Respinge' },
          { id: 'FRA:condition', label: 'Accetta con condizioni' },
          { id: 'FRA:mobilize', label: 'Mobilita' },
        ],
      },
      {
        id: 'GER', name: 'Germania', role: 'rival', because: 'nominata', interests: ['sicurezza'],
        options: [{ id: 'GER:mobilize', label: 'Mobilita' }],
      },
      {
        id: 'CHE', name: 'Svizzera', role: 'mediator', because: 'confina', interests: ['neutralità'],
        options: [{ id: 'CHE:mediate', label: 'Media' }],
      },
    ],
    constraints: [],
    allowedOptionIds: ['FRA:negotiate', 'FRA:reject', 'FRA:condition', 'FRA:mobilize', 'GER:mobilize', 'CHE:mediate'],
    maxReactions: 4,
    ...overrides,
  };
}

const withReactions = (reactions: any[], headline = 'Ultimatum a Berlino'): ReactionEventLike[] => [
  { headline, date: '1951-03-01', description: 'La crisi si apre.', reactions },
];

describe('validator reactions — fail-closed', () => {
  // A è coperto in reaction-context.test.ts (trigger del turno corrente).

  it('B — un actorId estraneo al contesto è invalido', () => {
    const issues = validateReactionDecisions([{ actorId: 'ITA', optionId: 'ITA:negotiate' }], context());
    expect(issues.map(issue => issue.code)).toContain('unknown_actor');
  });

  it('C — l’opzione deve appartenere a QUEL attore, non solo a allowedOptionIds', () => {
    const ctx = context();
    // L'id esiste nell'unione, ma è un'opzione della Germania.
    expect(ctx.allowedOptionIds).toContain('GER:mobilize');
    const issues = validateReactionDecisions([{ actorId: 'FRA', optionId: 'GER:mobilize' }], ctx);
    expect(issues.map(issue => issue.code)).toEqual(['option_not_owned_by_actor']);
  });

  it('D — un’opzione inesistente è invalida', () => {
    const issues = validateReactionDecisions([{ actorId: 'FRA', optionId: 'FRA:invade-world' }], context());
    expect(issues.map(issue => issue.code)).toEqual(['unknown_option']);
  });

  it('E — una reazione valida passa senza rilievi', () => {
    expect(validateReactionDecisions([{ actorId: 'FRA', optionId: 'FRA:condition' }], context())).toEqual([]);
  });

  it('E2 — un attore nominato solo con l’alias italiano resta ammesso dal motore', () => {
    // Il contesto è l'unica fonte degli attori ammessi: gli alias con cui il
    // giocatore nomina la controparte devono produrre lo stesso actorId.
    const ctx = buildReactionContext({
      playerPolityId: 'BWA',
      playerPolityName: 'Botswana',
      focusTexts: ['Negoziare con la Polonia'],
      polityNames: { POL: 'Польша' },
      polityAliases: { POL: ['POL', 'Polonia'] },
      regions: { r1: { id: 'r1', name: 'Польша', owner: 'POL' } },
    });
    expect(ctx.actors.map(actor => actor.id)).toEqual(['POL']);
    expect(validateReactionDecisions([{ actorId: 'POL', optionId: 'POL:negotiate' }], ctx)).toEqual([]);
  });

  it('F — più reactions del tetto del motore sono invalide', () => {
    const ctx = context({ maxReactions: 2 });
    const issues = validateReactionDecisions([
      { actorId: 'FRA', optionId: 'FRA:condition' },
      { actorId: 'GER', optionId: 'GER:mobilize' },
      { actorId: 'CHE', optionId: 'CHE:mediate' },
    ], ctx);
    expect(issues.map(issue => issue.code)).toContain('too_many_reactions');
  });

  it('F2 — gli attori interni non consumano il tetto delle reazioni diplomatiche', () => {
    // Il motore calcola `maxReactions` sulle sole politie: il validator deve
    // contare allo stesso modo, o segnalerebbe un output che il motore ammette.
    const ctx = context({
      maxReactions: 1,
      actors: [
        ...context().actors,
        {
          id: 'faction:esercito', name: 'Stato maggiore', role: 'internal_faction', because: 'interna',
          interests: ['difesa'], options: [{ id: 'faction:esercito:oppose', label: 'Opporsi' }],
        },
      ],
    });
    const withInternal = validateReactionDecisions([
      { actorId: 'FRA', optionId: 'FRA:condition' },
      { actorId: 'faction:esercito', optionId: 'faction:esercito:oppose' },
    ], ctx);
    expect(withInternal).toEqual([]);
    // Due politie con tetto 1 restano un errore.
    const twoPolities = validateReactionDecisions([
      { actorId: 'FRA', optionId: 'FRA:condition' },
      { actorId: 'GER', optionId: 'GER:mobilize' },
    ], ctx);
    expect(twoPolities.map(issue => issue.code)).toEqual(['too_many_reactions']);
  });

  it('G — una reaction legacy (senza actorId/optionId) resta leggibile ma non è output valido', () => {
    // Dati persistiti: la forma senza actorId/optionId deve restare leggibile.
    const legacyPayload = JSON.stringify({
      narration: 'Cronaca',
      events: [{
        headline: 'Vertice di frontiera', date: '1951-03-02', description: 'Le delegazioni si incontrano.',
        mapChanges: [], reactions: [{ polityName: 'Francia', role: 'counterparty', stance: 'conditional', response: 'Accetta con riserve.' }],
      }],
    });
    const parsed = parseSimulationResponse(legacyPayload);
    const reaction = parsed.events[0].reactions?.[0];
    expect(reaction).toBeDefined();
    expect(reaction?.polityName).toBe('Francia');
    expect(reaction?.actorId).toBeUndefined();
    expect(reaction?.optionId).toBeUndefined();

    // Lo stesso dato non è accettabile come NUOVO output del contratto.
    const issues = validateReactionDecisions([{ polityName: 'Francia' }], context());
    expect(issues.map(issue => issue.code)).toEqual(['missing_actor_id']);
  });

  it('I — l’LLM non può inserire una potenza non prevista dal contesto', () => {
    const ctx = context();
    const issues = validateReactionDecisions([{ actorId: 'USA', optionId: 'USA:negotiate' }], ctx);
    expect(issues.map(issue => issue.code)).toEqual(['unknown_actor']);
    expect(ctx.actors.map(actor => actor.id)).not.toContain('USA');
  });

  it('J — reactions: [] è valido (nessuna reaction forzata per un fatto interno)', () => {
    expect(validateReactionDecisions([], context())).toEqual([]);
    expect(validateReactionDecisions(undefined, context())).toEqual([]);
  });
});

describe('validator reactions — repair (un solo tentativo)', () => {
  it('H — la risposta valida non chiama il repair', async () => {
    const repair = vi.fn();
    const events = withReactions([{ actorId: 'FRA', optionId: 'FRA:condition' }]);
    const result = await repairReactionDecisions({ events, context: context(), repair });
    expect(repair).not.toHaveBeenCalled();
    expect(result.repaired).toBe(false);
  });

  it('H2 — opzione di un altro attore: un solo repair, poi valido', async () => {
    const repair = vi.fn(async ({ events }: any) => [
      { ...events[0], reactions: [{ actorId: 'FRA', optionId: 'FRA:condition' }] },
    ]);
    const events = withReactions([{ actorId: 'FRA', optionId: 'GER:mobilize' }]);
    const result = await repairReactionDecisions({ events, context: context(), repair });
    expect(repair).toHaveBeenCalledTimes(1);
    expect(result.repaired).toBe(true);
    expect(result.events[0].reactions).toEqual([{ actorId: 'FRA', optionId: 'FRA:condition' }]);
  });

  it('H3 — repair ancora invalido: LLMContractError, nessun fallback vuoto', async () => {
    const repair = vi.fn(async ({ events }: any) => events);
    const events = withReactions([{ actorId: 'FRA', optionId: 'GER:mobilize' }]);
    await expect(repairReactionDecisions({ events, context: context(), repair }))
      .rejects.toBeInstanceOf(LLMContractError);
    expect(repair).toHaveBeenCalledTimes(1);
  });

  it('H4 — il repair non può rigenerare la simulazione (eventi alterati)', async () => {
    const repair = vi.fn(async () => [
      { headline: 'Un altro fatto mai emesso', date: '1951-04-01', description: 'Rigenerato.', reactions: [{ actorId: 'FRA', optionId: 'FRA:condition' }] },
    ]);
    const events = withReactions([{ actorId: 'FRA', optionId: 'GER:mobilize' }]);
    await expect(repairReactionDecisions({ events, context: context(), repair }))
      .rejects.toThrow(/non va rigenerata|alterato/);
    expect(repair).toHaveBeenCalledTimes(1);
  });

  it('H5 — il repair non può cambiare il numero di eventi', async () => {
    const repair = vi.fn(async () => []);
    const events = withReactions([{ actorId: 'FRA', optionId: 'GER:mobilize' }]);
    await expect(repairReactionDecisions({ events, context: context(), repair }))
      .rejects.toBeInstanceOf(LLMContractError);
  });

  it('H6 — il repair non può toccare gli effetti materiali né la descrizione', async () => {
    const original = withReactions([{ actorId: 'FRA', optionId: 'GER:mobilize' }]);
    original[0].description = 'La crisi si apre.';
    original[0].mapChanges = [{ type: 'start_mobilization' }];

    const addEffect = vi.fn(async () => [{
      ...original[0],
      mapChanges: [{ type: 'start_mobilization' }, { type: 'spawn_unit' }],
      reactions: [{ actorId: 'FRA', optionId: 'FRA:condition' }],
    }]);
    await expect(repairReactionDecisions({ events: original, context: context(), repair: addEffect }))
      .rejects.toThrow(/cronaca/);

    const rewriteChronicle = vi.fn(async () => [{
      ...original[0],
      description: 'Testo riscritto dal repair.',
      reactions: [{ actorId: 'FRA', optionId: 'FRA:condition' }],
    }]);
    await expect(repairReactionDecisions({ events: original, context: context(), repair: rewriteChronicle }))
      .rejects.toThrow(/cronaca/);
  });

  it('H7 — il repair non può perdere la reaction di un attore ammesso dal motore', async () => {
    const events = withReactions([
      { actorId: 'FRA', optionId: 'FRA:condition' },
      { actorId: 'USA', optionId: 'USA:negotiate' },
    ]);
    // Il modello “corregge” eliminando anche la reazione legittima di FRA.
    const repair = vi.fn(async () => [{ ...events[0], reactions: [] }]);
    await expect(repairReactionDecisions({ events, context: context(), repair }))
      .rejects.toThrow(/attore ammesso/);
  });

  it('H8 — l’attore fuori contesto può invece essere omesso (degradazione esplicita)', async () => {
    const events = withReactions([
      { actorId: 'FRA', optionId: 'FRA:condition' },
      { actorId: 'USA', optionId: 'USA:negotiate' },
    ]);
    const repair = vi.fn(async () => [{
      ...events[0],
      reactions: [{ actorId: 'FRA', optionId: 'FRA:condition' }],
    }]);
    const result = await repairReactionDecisions({ events, context: context(), repair });
    expect(repair).toHaveBeenCalledTimes(1);
    expect(result.repaired).toBe(true);
    expect(result.events[0].reactions).toEqual([{ actorId: 'FRA', optionId: 'FRA:condition' }]);
  });

  it('H9 — con too_many_reactions il repair può ridurre anche reazioni di attori ammessi', async () => {
    const ctx = context({ maxReactions: 1 });
    const events = withReactions([
      { actorId: 'FRA', optionId: 'FRA:condition' },
      { actorId: 'GER', optionId: 'GER:mobilize' },
    ]);
    const repair = vi.fn(async () => [{ ...events[0], reactions: [{ actorId: 'FRA', optionId: 'FRA:condition' }] }]);
    const result = await repairReactionDecisions({ events, context: ctx, repair });
    expect(result.repaired).toBe(true);
    expect(result.events[0].reactions).toHaveLength(1);
  });
});

describe('validator reactions — effetti materiali (relazione minima)', () => {
  it('mobilitare/controagire ammette effetti militari, negoziare no', () => {
    expect(optionMaterialScope('FRA:mobilize')).toEqual(['military', 'construction']);
    expect(optionMaterialScope('GER:counter')).toEqual(['military', 'construction']);
    expect(optionMaterialScope('FRA:embargo')).toEqual(['trade']);
    expect(optionMaterialScope('FRA:negotiate')).toEqual([]);
    expect(optionMaterialScope('FRA:condition')).toEqual([]);
    expect(optionMaterialScope('FRA:reject')).toEqual([]);
    expect(optionMaterialScope('CHE:mediate')).toEqual([]);
  });

  it('un negoziato non può giustificare una nuova unità o un’offensiva', () => {
    expect(reactionAllowsMaterialCategory({ optionId: 'FRA:negotiate' }, measureMaterialCategory('spawn_unit'))).toBe(false);
    expect(reactionAllowsMaterialCategory({ optionId: 'FRA:condition' }, measureMaterialCategory('start_mobilization'))).toBe(false);
    expect(reactionAllowsMaterialCategory({ optionId: 'FRA:mobilize' }, measureMaterialCategory('start_mobilization'))).toBe(true);
    expect(reactionAllowsMaterialCategory({ optionId: 'FRA:counter' }, measureMaterialCategory('start_construction'))).toBe(true);
    expect(reactionAllowsMaterialCategory({ optionId: 'FRA:embargo' }, measureMaterialCategory('move_unit'))).toBe(false);
  });

  it('una reaction legacy senza optionId conserva il comportamento precedente', () => {
    expect(optionMaterialScope(undefined)).toBeUndefined();
    expect(reactionAllowsMaterialCategory({}, measureMaterialCategory('spawn_unit'))).toBe(true);
  });
});

describe('describeReactionShape (diagnostica dei fallimenti reali)', () => {
  it('mostra le chiavi presenti e i valori identificativi troncati', () => {
    const shape = describeReactionShape([
      {
        headline: 'Evento',
        reactions: [
          { polityName: 'Polonia', actorID: 'POL', optionId: null, response: 'x'.repeat(200) },
        ] as never,
      },
    ]);
    expect(shape).toContain('e0{keys=[polityName,actorID,optionId,response]');
    expect(shape).toContain('actorId=assente');
    expect(shape).toContain('optionId=null');
    expect(shape).toContain('polityName="Polonia"');
    // La narrazione non entra mai nel digest.
    expect(shape).not.toContain('xxxx');
  });

  it('segnala un attore senza actorId e resta limitato', () => {
    const shape = describeReactionShape([
      { reactions: [{ polityName: 'A' }, { polityName: 'B' }, { polityName: 'C' }] as never },
      { reactions: [{ polityName: 'D' }] as never },
    ]);
    expect(shape).toContain('actorId=assente');
    expect(shape.length).toBeLessThanOrEqual(601);
  });

  it('descrive esplicitamente il caso senza reaction', () => {
    expect(describeReactionShape([{ reactions: [] }])).toBe('(nessuna reaction)');
  });
});
