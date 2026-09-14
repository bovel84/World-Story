import { describe, expect, it, vi } from 'vitest';
import { PromptEngine } from '../src/prompt-builder';
import type { SimulationResult } from '../src/prompts/types';

function gameData(strictMode = false): any {
  return {
    id: 'free-model-game',
    currentDate: '2024-01-01',
    currentTurn: 2,
    strictMode,
    difficulty: 'normal',
    prompts: { simulation: 'Regola preset breve e verificabile.' },
    world: {
      name: 'Mondo test',
      basePrompt: 'Scenario contemporaneo alternativo.',
      startDate: '2024-01-01',
      regions: {
        gaza: {
          id: 'gaza', name: 'Gaza', owner: 'PSE', color: '#111', population: 1,
          gdp: 1, militaryPower: 1, borders: ['israel'], objects: [],
        },
        israel: {
          id: 'israel', name: 'Israele', owner: 'ISR', color: '#222', population: 8,
          gdp: 20, militaryPower: 30, borders: ['gaza'], objects: [],
        },
      },
    },
    players: [{ id: 'p1', name: 'Palestina', regionId: 'gaza', polityId: 'PSE' }],
    playerPolityId: 'PSE',
    playerPolityName: 'Palestina',
    polityNames: { PSE: 'Palestina', ISR: 'Israele' },
    relationships: { PSE: { ISR: 'hostile' }, ISR: { PSE: 'hostile' } },
    npcStrategicProfiles: 'Israele [ISR] — priorità: sicurezza delle frontiere; memoria: nessun accordo.',
    ongoingProcesses: [],
    actions: [],
    results: [],
    chatTranscripts: '',
  };
}

describe('resilienza con modelli free/piccoli', () => {
  it('ritenta una risposta illeggibile, normalizza lo schema e ripara il solo ID non ambiguo', async () => {
    let capturedPrompt = '';
    const repaired = [
      JSON.stringify({
        type: 'event',
        title: 'Mobilitazione limitata a Gaza',
        description: 'L’ordine avvia un reclutamento circoscritto. La formazione non è ancora operativa. Israele monitora lo sviluppo.',
        date: '2024-01-10',
        map_changes: [{ type: 'mobilize', region: 'Gaza', unitType: 'army', unitName: 'I Forza territoriale' }],
        reactions: [{ country: 'Israele', position: 'neutral', decision: 'Avvia un monitoraggio prudente.' }],
      }),
      JSON.stringify({
        type: 'complete',
        narration: 'La mobilitazione è iniziata senza produrre una forza operativa.',
        actionOutcomes: [{
          actionId: 'id-inventato-dal-modello',
          status: 'partial',
          summary: 'Il reclutamento è materialmente iniziato.',
          completesProjectId: 'progetto-inesistente',
          eventHeadlines: ['Mobilitazione limitata a Gaza'],
        }],
        voided: [], startChat: [], relationshipChanges: [],
        worldChanges: { regionOwners: {}, regionColors: {} },
        targetDate: '2024-01-10',
      }),
    ].join('\n');
    const llm: any = {
      describe: () => ({ jump: { model: 'vendor/tiny-2b:free' } }),
      stream: vi.fn(async (_mechanic: string, _system: string, prompt: string, onToken: any) => {
        capturedPrompt = prompt;
        onToken(18, 'risposta non JSON');
        return { content: 'risposta non JSON' };
      }),
      generate: vi.fn(async () => ({ content: repaired })),
    };

    const result = await new PromptEngine(llm).runSimulation(
      gameData(),
      [{ actionId: 'ordine-canonico', text: 'Avviare una mobilitazione limitata a Gaza' }],
      30,
    );

    expect(capturedPrompt).toContain('PROTOCOLLO COMPATTO');
    expect(llm.generate).toHaveBeenCalledTimes(1);
    expect(result.events[0].mapChanges[0]).toMatchObject({
      type: 'start_mobilization',
      regionName: 'Gaza',
      feature: { type: 'army', name: 'I Forza territoriale' },
    });
    expect(result.events[0].reactions?.[0]).toMatchObject({
      polityName: 'Israele',
      stance: 'neutral',
    });
    expect(result.actionOutcomes).toEqual([
      expect.objectContaining({
        actionId: 'ordine-canonico',
        status: 'partial',
        completesProjectId: undefined,
      }),
    ]);
  });

  it('non perde ordini se il convertitore batch restituisce un array illeggibile', async () => {
    const llm: any = {
      describe: () => ({ converter: { model: 'vendor/tiny:free' } }),
      generate: vi.fn(async () => ({ content: 'testo non JSON' })),
    };
    const engine = new PromptEngine(llm);
    const converted = await engine.convertActionsBatch(gameData(), [
      { actionId: 'a1', text: 'Primo ordine originale' },
      { actionId: 'a2', text: 'Secondo ordine originale' },
    ]);
    expect(converted).toEqual([
      { actionId: 'a1', type: 'action', text: 'Primo ordine originale' },
      { actionId: 'a2', type: 'action', text: 'Secondo ordine originale' },
    ]);
  });

  it('restituisce proposte conservative se due risposte free sono vuote', async () => {
    const llm: any = {
      describe: () => ({ suggestions: { model: 'vendor/tiny:free', provider: 'stub' } }),
      generate: vi.fn(async () => ({ content: '{"suggestions":[]}' })),
      invalidateCache: vi.fn(),
    };
    const suggestions = await new PromptEngine(llm).getSuggestions(gameData());
    expect(llm.generate).toHaveBeenCalledTimes(2);
    expect(suggestions).toHaveLength(3);
    expect(suggestions[0].actions[0].content).toContain('censire risorse');
    expect(suggestions.flatMap(item => item.actions).every(action => !/garantiamo|conquistiamo/i.test(action.content))).toBe(true);
  });

  it('non ripara gli ID nel percorso strict fail-closed', () => {
    const engine: any = new PromptEngine({});
    const raw: SimulationResult = {
      events: [], narration: 'x', diplomacy: [], voided: [],
      worldChanges: { regionOwners: {}, regionColors: {}, newFeatures: [], deletedFeatures: [] },
      actionOutcomes: [{
        actionId: 'sbagliato', action: '', status: 'accepted', summary: 'x', eventHeadlines: [],
      }],
    };
    const strict = engine.sanitizeSimulationResult(
      gameData(true), raw, [{ actionId: 'corretto', text: 'Ordine' }], 1, false, true,
    );
    expect(strict.actionOutcomes[0].actionId).toBe('sbagliato');
    // Nei run normali (non free) l'adattatore è disattivato: l'ID esterno
    // attraversa intatto e il validatore di protocollo lo rifiuta come prima.
    const unmodified = engine.sanitizeSimulationResult(
      gameData(false), structuredClone(raw), [{ actionId: 'corretto', text: 'Ordine' }], 1, false, false,
    );
    expect(unmodified.actionOutcomes[0].actionId).toBe('sbagliato');
  });
});
