/**
 * Completamento deterministico del contratto reactions (motore → LLM).
 * ==================================================================
 * Difetto osservato in produzione: il provider reale (MiniMax) ometteva
 * `actorId`/`optionId` nelle reactions e il turno falliva chiuso
 * (`reactions fuori contratto dopo un repair (missing_actor_id…)`), nonostante
 * l'attore fosse **già deciso dal motore** nel CONTESTO DI REAZIONE.
 *
 * Qui si verifica che il motore completi gli ID che il contesto determina in
 * modo univoco, e che NON completi nulla quando la scelta non è determinabile
 * (in quel caso resta il repair, e poi l'errore: il contratto non si allarga).
 */
import { describe, expect, it, vi } from 'vitest';
import type { ReactionContext } from '../src/core/simulation/ReactionContext';
import {
  completeEventReactions,
  completeEventReactionsList,
  completeReactionDecision,
} from '../src/core/simulation/ReactionDecisions';
import { PromptEngine } from '../src/prompt-builder';

function context(overrides: Partial<ReactionContext> = {}): ReactionContext {
  return {
    trigger: { kind: 'current_action', summary: 'Attacco a Gwanda', sourceRef: 'a1' },
    actors: [
      {
        id: 'ZWE',
        name: 'Zimbabwe',
        role: 'counterparty',
        because: 'controparte diretta',
        interests: [],
        options: [
          { id: 'ZWE:counter', label: 'Controagire' },
          { id: 'ZWE:negotiate', label: 'Negoziare' },
        ],
      },
      {
        id: 'ZAF',
        name: 'Sudafrica',
        role: 'mediator',
        because: 'mediatore regionale',
        interests: [],
        options: [{ id: 'ZAF:mediate', label: 'Mediare' }],
      },
    ],
    constraints: [],
    allowedOptionIds: ['ZWE:counter', 'ZWE:negotiate', 'ZAF:mediate'],
    maxReactions: 3,
    ...overrides,
  };
}

describe('completamento del contratto reactions da parte del motore', () => {
  it('non tocca una reaction che ha già actorId (stesso riferimento)', () => {
    const reaction = { actorId: 'ZWE', optionId: 'ZWE:counter', polityName: 'Zimbabwe' };
    expect(completeReactionDecision(reaction, context())).toBe(reaction);
  });

  it('deriva actorId dall\'optionId quando appartiene a un solo attore', () => {
    const completed = completeReactionDecision(
      { optionId: 'ZWE:counter', polityName: 'Zimbabwe', response: 'Harare mobilita le riserve.' },
      context(),
    );
    expect(completed.actorId).toBe('ZWE');
    expect(completed.optionId).toBe('ZWE:counter');
  });

  it('deriva actorId dal polityName e forza l\'optionId quando l\'attore ne ha una sola', () => {
    const completed = completeReactionDecision(
      { polityName: 'Sudafrica', response: 'Pretoria offre mediazione.' },
      context(),
    );
    expect(completed.actorId).toBe('ZAF');
    expect(completed.optionId).toBe('ZAF:mediate');
  });

  it('deriva solo actorId se l\'attore ha più opzioni: la scelta resta all\'LLM', () => {
    const completed = completeReactionDecision(
      { polityName: 'Zimbabwe', response: 'Harare valuta la risposta.' },
      context(),
    );
    expect(completed.actorId).toBe('ZWE');
    expect(completed.optionId).toBeUndefined();
  });

  it('riconosce il nome dentro una frase («la Polonia»)', () => {
    const completed = completeReactionDecision(
      { polityName: 'la Zimbabwe', response: 'Harare mobilita.' },
      context(),
    );
    expect(completed.actorId).toBe('ZWE');
  });

  it('NON completa un attore fuori dal contesto', () => {
    const reaction = { polityName: 'Malaysia', response: 'Kuala Lumpur invia una nota.' };
    expect(completeReactionDecision(reaction, context())).toBe(reaction);
  });

  it('NON completa se nome e opzione indicano attori diversi (input incoerente)', () => {
    const reaction = { optionId: 'ZAF:mediate', polityName: 'Zimbabwe', response: 'Ambigua.' };
    expect(completeReactionDecision(reaction, context())).toBe(reaction);
  });

  it('NON completa se l\'optionId non appartiene a nessun attore del contesto', () => {
    const reaction = { optionId: 'MYS:negotiate', polityName: 'Zimbabwe', response: 'Fuori contesto.' };
    expect(completeReactionDecision(reaction, context())).toBe(reaction);
  });

  it('completa gli eventi indicando quanti sono cambiati (e preserva gli altri)', () => {
    const untouched = { headline: 'Nessuna reazione', reactions: [] };
    const event = {
      headline: 'Attacco a Gwanda',
      reactions: [{ optionId: 'ZWE:counter', polityName: 'Zimbabwe', response: 'Harare mobilita.' }],
    };
    const { events, completedEvents } = completeEventReactionsList([untouched, event], context());
    expect(completedEvents).toBe(1);
    expect(events[0]).toBe(untouched);
    expect(events[1].reactions?.[0].actorId).toBe('ZWE');
  });

  it('completeEventReactions restituisce lo stesso riferimento quando non c\'è nulla da completare', () => {
    const event = { headline: 'X', reactions: [{ actorId: 'ZWE', optionId: 'ZWE:counter' }] };
    expect(completeEventReactions(event, context())).toBe(event);
  });
});

describe('completamento nel percorso reale di simulazione', () => {
  const gameData = (reactionContextData: ReactionContext): any => ({
    id: 'completion-game',
    currentDate: '1951-01-01',
    currentTurn: 1,
    strictMode: false,
    difficulty: 'normal',
    prompts: {},
    world: {
      name: 'Mondo test',
      basePrompt: 'Scenario alternativo.',
      startDate: '1951-01-01',
      regions: {
        gwa: { id: 'gwa', name: 'Gwanda', owner: 'ZWE', color: '#111', population: 1, gdp: 1, militaryPower: 1, borders: [], objects: [] },
        bwa: { id: 'bwa', name: 'Botswana', owner: 'BWA', color: '#222', population: 1, gdp: 1, militaryPower: 1, borders: [], objects: [] },
      },
    },
    players: [{ id: 'p1', name: 'Botswana', regionId: 'bwa', polityId: 'BWA' }],
    playerPolityId: 'BWA',
    playerPolityName: 'Botswana',
    polityNames: { BWA: 'Botswana', ZWE: 'Zimbabwe', ZAF: 'Sudafrica' },
    relationships: {},
    npcStrategicProfiles: 'Zimbabwe [ZWE] — priorità: difendere la frontiera.',
    ongoingProcesses: [],
    actions: [],
    results: [],
    chatTranscripts: '',
    reactionContextData,
  });

  it('un turno con actorId omesso NON richiede il repair e viene normalizzato', async () => {
    const ndjson = JSON.stringify({
      type: 'event',
      headline: 'Botswana attacca le posizioni zimbabwesi a Gwanda',
      description: 'Le forze botswane aprono le ostilità lungo la frontiera.',
      date: '1951-02-01',
      mapChanges: [],
      // Il modello omette `actorId` ma indica opzione e politia: il motore li risolve.
      reactions: [{
        optionId: 'ZWE:counter',
        polityName: 'Zimbabwe',
        role: 'counterparty',
        stance: 'opposed',
        response: 'Harare mobilita le riserve e rinforza Gwanda.',
      }],
      sourceActionIds: ['a1'],
    });
    const llm: any = {
      describe: () => ({ jump: { model: 'vendor/test' } }),
      stream: vi.fn(async (_m: string, _s: string, _p: string, onToken: any) => {
        onToken(ndjson.length, ndjson + '\n');
        return { content: ndjson + '\n' };
      }),
      generate: vi.fn(async () => ({ content: '{}' })),
    };

    const result = await new PromptEngine(llm).runSimulation(
      gameData(context()),
      [{ actionId: 'a1', text: 'Attaccare le posizioni dello Zimbabwe a Gwanda' }],
      30,
    );

    // Nessuna chiamata di repair: il completamento è deterministico.
    expect(llm.generate).not.toHaveBeenCalled();
    expect(result.events[0].reactions?.[0]).toMatchObject({
      actorId: 'ZWE',
      optionId: 'ZWE:counter',
      polityName: 'Zimbabwe',
    });
  });

  it('una reaction non determinabile resta fuori contratto (il contratto non si allarga)', async () => {
    const ndjson = JSON.stringify({
      type: 'event',
      headline: 'Botswana attacca le posizioni zimbabwesi a Gwanda',
      description: 'Le forze botswane aprono le ostilità lungo la frontiera.',
      date: '1951-02-01',
      mapChanges: [],
      // Attore fuori dal CONTESTO DI REAZIONE: nessun ID da derivare.
      reactions: [{ polityName: 'Malaysia', response: 'Kuala Lumpur invia una nota di comodo.' }],
      sourceActionIds: ['a1'],
    });
    const llm: any = {
      describe: () => ({ jump: { model: 'vendor/test' } }),
      stream: vi.fn(async (_m: string, _s: string, _p: string, onToken: any) => {
        onToken(ndjson.length, ndjson + '\n');
        return { content: ndjson + '\n' };
      }),
      // Il repair non corregge: la reazione resta fuori contratto.
      generate: vi.fn(async () => ({ content: ndjson + '\n' })),
    };

    await expect(new PromptEngine(llm).runSimulation(
      gameData(context()),
      [{ actionId: 'a1', text: 'Attaccare le posizioni dello Zimbabwe a Gwanda' }],
      30,
    )).rejects.toThrow(/fuori contratto/);
    expect(llm.generate).toHaveBeenCalledTimes(1);
  });

  it('il repair compatto (fixes/omit) corregge l\'optionId senza riscrivere gli eventi', async () => {
    const ndjson = JSON.stringify({
      type: 'event',
      headline: 'Botswana attacca le posizioni zimbabwesi a Gwanda',
      description: 'Le forze botswane aprono le ostilità lungo la frontiera.',
      date: '1951-02-01',
      mapChanges: [],
      // Attore ammesso ma optionId assente: il repair deve sceglierlo senza
      // rigenerare l'evento (era il fallimento reale: «3 → 1 eventi»).
      reactions: [{ actorId: 'ZWE', polityName: 'Zimbabwe', stance: 'opposed', response: 'Harare mobilita le riserve.' }],
      sourceActionIds: ['a1'],
    });
    const llm: any = {
      describe: () => ({ jump: { model: 'vendor/test' } }),
      stream: vi.fn(async (_m: string, _s: string, _p: string, onToken: any) => {
        onToken(ndjson.length, ndjson + '\n');
        return { content: ndjson + '\n' };
      }),
      generate: vi.fn(async () => ({
        content: JSON.stringify({ fixes: [{ eventIndex: 0, reactionIndex: 0, actorId: 'ZWE', optionId: 'ZWE:counter' }] }),
      })),
    };

    const result = await new PromptEngine(llm).runSimulation(
      gameData(context()),
      [{ actionId: 'a1', text: 'Attaccare le posizioni dello Zimbabwe a Gwanda' }],
      30,
    );

    expect(llm.generate).toHaveBeenCalledTimes(1);
    expect(result.events[0].headline).toBe('Botswana attacca le posizioni zimbabwesi a Gwanda');
    expect(result.events[0].reactions?.[0]).toMatchObject({ actorId: 'ZWE', optionId: 'ZWE:counter' });
  });

  it('il repair legacy a eventi completi viene riconciliato: si adottano solo le reactions', async () => {
    const ndjson = JSON.stringify({
      type: 'event',
      headline: 'Botswana attacca le posizioni zimbabwesi a Gwanda',
      description: 'Le forze botswane aprono le ostilità lungo la frontiera.',
      date: '1951-02-01',
      mapChanges: [],
      reactions: [{ actorId: 'ZWE', polityName: 'Zimbabwe', stance: 'opposed', response: 'Harare mobilita le riserve.' }],
      sourceActionIds: ['a1'],
    });
    const llm: any = {
      describe: () => ({ jump: { model: 'vendor/test' } }),
      stream: vi.fn(async (_m: string, _s: string, _p: string, onToken: any) => {
        onToken(ndjson.length, ndjson + '\n');
        return { content: ndjson + '\n' };
      }),
      // Il modello riscrive l'evento con la stessa headline: la cronaca resta
      // quella originale, si adottano soltanto le reactions corrette.
      generate: vi.fn(async () => ({
        content: JSON.stringify({ events: [{
          headline: 'Botswana attacca le posizioni zimbabwesi a Gwanda',
          description: 'DESCRIZIONE RISCRITTA DAL REPAIR.',
          date: '1951-02-01',
          reactions: [{ actorId: 'ZWE', optionId: 'ZWE:negotiate', polityName: 'Zimbabwe', role: 'counterparty', stance: 'opposed', response: 'Harare apre un negoziato.' }],
        }] }),
      })),
    };

    const result = await new PromptEngine(llm).runSimulation(
      gameData(context()),
      [{ actionId: 'a1', text: 'Attaccare le posizioni dello Zimbabwe a Gwanda' }],
      30,
    );

    expect(result.events[0].description).toBe('Le forze botswane aprono le ostilità lungo la frontiera.');
    expect(result.events[0].reactions?.[0]).toMatchObject({ actorId: 'ZWE', optionId: 'ZWE:negotiate' });
  });
});
