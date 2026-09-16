/**
 * LLMContractError definitivo — contratto di simulazione
 * ======================================================
 * Requisiti (blocco 2, punto 1):
 *  - una risposta totalmente fuori contratto NON degrada mai in una
 *    simulazione vuota «valida» (`events: []` + narrativa inventata);
 *  - una risposta parzialmente valida viene recuperata (alias, elementi
 *    invalidi scartati) senza nascondere il guasto;
 *  - al più UN repair: se anche quello fallisce, si propaga `LLMContractError`.
 */
import { describe, expect, it } from 'vitest';
import { parseSimulationResponse, parseIncrementalSimulationResponse } from '../src/prompts/simulation';
import { PromptEngine } from '../src/prompt-builder';
import { LLMContractError } from '../src/llm';

function makeGame(): any {
  return {
    id: 'contract-test-game',
    currentDate: '1951-01-01',
    currentTurn: 1,
    world: {
      name: 'Test World',
      basePrompt: 'Lore di prova',
      startDate: '1951-01-01',
      prompts: { simulation: 'Simula la storia a partire da ${ORIGIN_ROUND_DATE}.' },
      regions: {
        w_DEU: { id: 'w_DEU', name: 'Germania', owner: 'DEU', color: '#FF0000', objects: [] },
        w_FRA: { id: 'w_FRA', name: 'Francia', owner: 'FRA', color: '#0000FF', objects: [] },
      },
    },
    players: [{ id: 'p1', name: 'Player', regionId: 'w_DEU', polityId: 'DEU' }],
    playerPolityId: 'DEU',
    actions: [],
    results: [],
  };
}

describe('parseSimulationResponse — contratto severo', () => {
  it('lancia LLMContractError su testo non JSON, `{}` e array', () => {
    expect(() => parseSimulationResponse('nessun json qui')).toThrow(LLMContractError);
    expect(() => parseSimulationResponse('{}')).toThrow(LLMContractError);
    expect(() => parseSimulationResponse('[1,2,3]')).toThrow(LLMContractError);
    expect(() => parseSimulationResponse('{"foo":1,"bar":2}')).toThrow(LLMContractError);
  });

  it('recupera una risposta parzialmente valida scartando i singoli elementi corrotti', () => {
    const result = parseSimulationResponse(JSON.stringify({
      events: [
        { headline: 'Riforma agraria approvata', description: 'Il parlamento vota.', date: '1951-01-10', mapChanges: [{ type: 'non_esiste' }] },
        { senza: 'headline' },
      ],
      actionOutcomes: [
        { actionId: 'a1', status: 'accepted', summary: 'Fatto' },
        { actionId: 'a2', status: 'boh', summary: 'ambiguo' },
      ],
      narration: 'Il governo procede.',
      worldChanges: { regionOwners: {}, regionColors: {} },
    }));
    expect(result.events).toHaveLength(1);
    expect(result.events[0].mapChanges).toEqual([]);
    expect(result.narration).toBe('Il governo procede.');
    expect(result.actionOutcomes.map(o => o.actionId)).toContain('a1');
  });

  it('il protocollo incrementale incompleto resta incompleto, senza narrativa di ripiego', () => {
    const ndjson = [
      JSON.stringify({ type: 'event', headline: 'Vertice convocato', date: '1951-01-05', description: 'Le delegazioni arrivano.' }),
    ].join('\n');
    const result = parseIncrementalSimulationResponse(ndjson);
    expect(result.events).toHaveLength(1);
    expect(result.incomplete).toBe(true);
    expect(result.narration).toBe('');
  });

  it('il rumore non produce mai una simulazione vuota valida', () => {
    expect(() => parseIncrementalSimulationResponse('La nazione prospera, tutto bene.')).toThrow(LLMContractError);
  });
});

describe('PromptEngine.runSimulation — repair unico', () => {
  it('un solo repair converte la risposta fuori contratto nello schema', async () => {
    let generateCalls = 0;
    const llm: any = {
      consolidation: { startRound: 25, chunkSize: 5, keepRawTail: 10 },
      async stream() {
        return { content: 'La nazione prospera, ma nessun JSON da nessuna parte.' };
      },
      async generate(_mechanic: string, _system: string, user: string) {
        generateCalls++;
        expect(user).toContain('Converti la risposta precedente');
        expect(user).not.toContain('KASTOM_ASSENTE');
        return {
          content: JSON.stringify({
            events: [{ headline: 'Riforma approvata', date: '1951-01-10', description: 'Il parlamento vota.', mapChanges: [], reactions: [] }],
            narration: 'La riforma passa.',
            actionOutcomes: [],
            voided: [],
            startChat: [],
            relationshipChanges: [],
            worldChanges: { regionOwners: {}, regionColors: {} },
          }),
        };
      },
      clearCache() {},
    };
    const engine = new PromptEngine(llm);
    const result = await engine.runSimulation(makeGame(), ['Riforma agraria'], 30);
    expect(generateCalls).toBe(1);
    expect(result.events[0].headline).toBe('Riforma approvata');
    expect(result.events).toHaveLength(1);
  });

  it('se il repair fallisce propaga LLMContractError (mai un turno vuoto)', async () => {
    let generateCalls = 0;
    const llm: any = {
      consolidation: { startRound: 25, chunkSize: 5, keepRawTail: 10 },
      async stream() {
        return { content: 'Risposta completamente fuori formato.' };
      },
      async generate() {
        generateCalls++;
        return { content: 'Anche il repair non è JSON.' };
      },
      clearCache() {},
    };
    const engine = new PromptEngine(llm);
    await expect(engine.runSimulation(makeGame(), ['Riforma'], 30))
      .rejects.toThrow(LLMContractError);
    expect(generateCalls).toBe(1);
  });
});
