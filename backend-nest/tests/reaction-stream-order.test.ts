/**
 * Ordine di pubblicazione degli eventi quando un evento dello stream non
 * rispetta il contratto delle reactions (rilievo B2 della revisione
 * indipendente).
 *
 * Un evento con reactions fuori contesto non deve mai essere pubblicato, ma la
 * pubblicazione live non può nemmeno "saltarlo" e continuare: gli eventi
 * successivi arriverebbero prima dell'evento riparato e in auto-jump la mappa
 * verrebbe applicata fuori ordine cronologico. Con la sospensione della
 * pubblicazione live, dopo l'unico repair tutti gli eventi escono in ordine.
 */
import { describe, expect, it, vi } from 'vitest';
import { PromptEngine } from '../src/prompt-builder';
import { validateReactionDecisions, type ReactionEventLike } from '../src/core/simulation/ReactionDecisions';
import type { ReactionContext } from '../src/core/simulation/ReactionContext';

const CONTEXT: ReactionContext = {
  trigger: { kind: 'player_action', summary: 'Mobilitare il confine', sourceRef: 'a1' },
  actors: [{
    id: 'ISR', name: 'Israele', role: 'counterparty', because: 'nominata', interests: ['sicurezza'],
    options: [{ id: 'ISR:negotiate', label: 'Negozia' }, { id: 'ISR:mobilize', label: 'Mobilita' }],
  }],
  constraints: [],
  allowedOptionIds: ['ISR:negotiate', 'ISR:mobilize'],
  maxReactions: 2,
};

function gameData(): any {
  return {
    id: 'stream-order-game',
    currentDate: '2024-01-01',
    currentTurn: 2,
    strictMode: false,
    difficulty: 'normal',
    prompts: {},
    world: {
      name: 'Mondo test',
      basePrompt: 'Scenario alternativo.',
      startDate: '2024-01-01',
      regions: {
        gaza: { id: 'gaza', name: 'Gaza', owner: 'PSE', color: '#111', population: 1, gdp: 1, militaryPower: 1, borders: ['israel'], objects: [] },
        israel: { id: 'israel', name: 'Israele', owner: 'ISR', color: '#222', population: 8, gdp: 20, militaryPower: 30, borders: ['gaza'], objects: [] },
      },
    },
    players: [{ id: 'p1', name: 'Palestina', regionId: 'gaza', polityId: 'PSE' }],
    playerPolityId: 'PSE',
    playerPolityName: 'Palestina',
    polityNames: { PSE: 'Palestina', ISR: 'Israele' },
    relationships: { PSE: { ISR: 'hostile' }, ISR: { PSE: 'hostile' } },
    reactionContext: 'ATTORI RILEVANTI E OPZIONI AMMESSE:\n[ISR] Israele\n  - ISR:negotiate\n  - ISR:mobilize',
    reactionContextData: CONTEXT,
    npcStrategicProfiles: 'Israele [ISR] — priorità: sicurezza.',
    ongoingProcesses: [],
    actions: [],
    results: [],
    chatTranscripts: '',
  };
}

const eventLine = (headline: string, date: string, reactions: ReactionEventLike['reactions']): string =>
  JSON.stringify({ type: 'event', headline, date, description: `${headline}: cronaca del fatto.`, mapChanges: [], reactions });

const completeLine = JSON.stringify({
  type: 'complete',
  narration: 'Sintesi del periodo.',
  actionOutcomes: [{ actionId: 'a1', status: 'accepted', summary: 'Ordine eseguito.' }],
  voided: [],
  startChat: [],
  relationshipChanges: [],
  worldChanges: { regionOwners: {}, regionColors: {} },
  targetDate: '2024-01-31',
});

/**
 * NDJSON completo del protocollo (tre eventi + chiusura): il secondo evento ha
 * una reaction fuori dal contesto. La chiusura è inclusa perché nel protocollo
 * reale arriva nello stream e non deve attivare la chiamata ausiliaria di
 * chiusura: così l'unica chiamata ausiliaria misurata è quella di repair.
 */
function streamLines(): string[] {
  return [
    eventLine('Primo fatto', '2024-01-05', [{ actorId: 'ISR', optionId: 'ISR:negotiate', polityName: 'Israele', response: 'Israele apre un canale.' }]),
    eventLine('Secondo fatto', '2024-01-12', [{ actorId: 'USA', optionId: 'USA:negotiate', polityName: 'Stati Uniti', response: 'Washington commenta.' }]),
    eventLine('Terzo fatto', '2024-01-20', [{ actorId: 'ISR', optionId: 'ISR:mobilize', polityName: 'Israele', response: 'Israele mobilizza le riserve.' }]),
    completeLine,
  ];
}

function llmFor(lines: string[], repairContent: string | null): any {
  let accumulated = '';
  return {
    describe: () => ({ jump: { model: 'vendor/tiny-2b:free' } }),
    stream: vi.fn(async (_mechanic: string, _system: string, _prompt: string, onToken: any) => {
      for (const line of lines) {
        accumulated = accumulated ? `${accumulated}\n${line}` : line;
        onToken(accumulated.length, accumulated);
      }
      return { content: accumulated };
    }),
    generate: vi.fn(async () => ({ content: repairContent ?? accumulated })),
  };
}

describe('ordine di pubblicazione con reactions fuori contratto', () => {
  it('sospende la pubblicazione live e ripubblica in ordine dopo l’unico repair', async () => {
    const lines = streamLines();
    const fixed = JSON.stringify({ ...JSON.parse(lines[1]), reactions: [] });
    const llm = llmFor(lines, `${lines[0]}\n${fixed}\n${lines[2]}\n${lines[3]}`);

    const emitted: Array<{ headline: string; index: number }> = [];
    const result = await new PromptEngine(llm).runSimulation(
      gameData(),
      [{ actionId: 'a1', text: 'Mobilitare il confine' }],
      // 90 giorni → maxEvents 5: il budget eventi non deve tagliare gli eventi
      // che questo test vuole osservare.
      90,
      () => {},
      false,
      (event, index) => emitted.push({ headline: event.headline, index }),
    );

    // Nessun evento fuori ordine: l'ordine di pubblicazione è quello cronologico.
    expect(emitted.map(item => item.headline)).toEqual(['Primo fatto', 'Secondo fatto', 'Terzo fatto']);
    expect(emitted.map(item => item.index)).toEqual([0, 1, 2]);
    // Una sola chiamata ausiliaria: nessun retry.
    expect(llm.generate).toHaveBeenCalledTimes(1);
    // Nessun evento pubblicato ha reactions fuori contratto.
    expect(result.events.every(event => validateReactionDecisions(event.reactions, CONTEXT).length === 0)).toBe(true);
  });

  it('se il repair non corregge, fallisce chiuso e non pubblica mai l’evento invalido', async () => {
    const lines = streamLines();
    const llm = llmFor(lines, lines.join('\n'));

    const emitted: string[] = [];
    await expect(new PromptEngine(llm).runSimulation(
      gameData(),
      [{ actionId: 'a1', text: 'Mobilitare il confine' }],
      90,
      () => {},
      false,
      event => emitted.push(event.headline),
    )).rejects.toThrow(/fuori contratto/);

    expect(llm.generate).toHaveBeenCalledTimes(1);
    // Il primo evento (valido) era già stato pubblicato live; l'evento fuori
    // contratto non esce e la pubblicazione live si ferma: gli eventi
    // successivi non vengono pubblicati in un ordine sbagliato.
    expect(emitted).toEqual(['Primo fatto']);
    // La sessione ripristina lo stato dello stream fallito (rollback a monte).
    expect(emitted).not.toContain('Secondo fatto');
  });
});
