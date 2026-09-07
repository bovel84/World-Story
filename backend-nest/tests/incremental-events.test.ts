import { describe, expect, it } from 'vitest';
import { PromptEngine } from '../src/prompt-builder';
import {
  extractCompleteJsonObjects,
  parseIncrementalSimulationResponse,
} from '../src/prompts/simulation';
import type { SimulationEvent } from '../src/prompts/types';

describe('eventi progressivi', () => {
  it('estrae record JSON completi anche con oggetti annidati e chunk incompleto', () => {
    const first = '{"type":"event","headline":"Caduta della città","description":"Test","date":"1951-01-03","mapChanges":[{"type":"transfer","regionName":"A","newOwner":"B"}]}';
    const incomplete = '{"type":"event","headline":"Secondo';
    const records = extractCompleteJsonObjects(`${first}\n${incomplete}`);
    expect(records).toHaveLength(1);
    expect(records[0].headline).toBe('Caduta della città');
  });

  it('pubblica il primo evento prima che lo stream sia terminato', async () => {
    const event1 = '{"type":"event","headline":"Crisi di governo","description":"Il governo cade.","date":"1951-01-05","mapChanges":[]}';
    const event2 = '{"type":"event","headline":"Nuovo gabinetto","description":"Nasce un esecutivo.","date":"1951-01-12","mapChanges":[]}';
    const complete = '{"type":"complete","narration":"Due settimane di crisi politica.","voided":[],"startChat":[],"relationshipChanges":[],"worldChanges":{"regionOwners":{},"regionColors":{}}}';
    const published: SimulationEvent[] = [];
    let countSeenInsideStream = 0;

    const llm = {
      async stream(_mechanic: string, _system: string, _user: string, onToken: (n: number, text?: string) => void) {
        onToken(event1.length, event1);
        countSeenInsideStream = published.length;
        const two = `${event1}\n${event2}`;
        onToken(two.length, two);
        const all = `${two}\n${complete}`;
        onToken(all.length, all);
        return { content: all };
      },
    } as any;

    const game = {
      id: 'incremental-test', currentDate: '1951-01-01', currentTurn: 1,
      world: {
        name: 'Test', basePrompt: 'Scenario test', startDate: '1951-01-01',
        prompts: { simulation: 'Simula {{PLAYER_ACTIONS_THIS_ROUND}} da {{ORIGIN_ROUND_DATE}} a {{TARGET_ROUND_DATE}}.' },
        regions: new Map([['r1', { id: 'r1', name: 'Italia', owner: 'ITA', color: '#008000', objects: [] }]]),
      },
      players: [{ id: 'p1', name: 'Italia', regionId: 'r1', polityId: 'ITA' }],
      playerPolityId: 'ITA', actions: [], results: [],
    } as any;

    const result = await new PromptEngine(llm).runSimulation(
      game, ['Osservare'], 30, undefined, false, event => published.push(event),
    );

    expect(countSeenInsideStream).toBe(1);
    expect(published.map(e => e.headline)).toEqual(['Crisi di governo', 'Nuovo gabinetto']);
    expect(result.events).toHaveLength(2);
    expect(result.narration).toBe('Due settimane di crisi politica.');
  });

  it('mantiene la compatibilità con il vecchio JSON batch', () => {
    const result = parseIncrementalSimulationResponse(JSON.stringify({
      events: [{ headline: 'Evento legacy', description: '', date: '1951-01-02', mapChanges: [] }],
      narration: 'Compatibile', worldChanges: {},
    }));
    expect(result.events[0].headline).toBe('Evento legacy');
    expect(result.narration).toBe('Compatibile');
  });
});
