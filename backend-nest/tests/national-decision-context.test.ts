import { describe, expect, it, vi } from 'vitest';
import { PromptEngine } from '../src/prompt-builder';

const original = 'Riprendere i lavori del porto senza nuove spese e senza ampliare il progetto.';
function fixture(override: boolean): any {
  return {
    id: 'context-test', currentDate: '1951-06-01', currentTurn: 2,
    prompts: { simulation: 'Regole', ...(override ? { suggestions: 'Suggerimenti personalizzati', converter: 'Conversione personalizzata' } : {}) },
    world: { name: 'Paese test', startDate: '1951-01-01', basePrompt: 'PREMESSA_NAZIONALE: ricostruzione dopo il conflitto.',
      regions: { lazio: { id: 'lazio', name: 'Lazio', owner: 'ITA', color: '#609f87', population: 10, gdp: 20, militaryPower: 5, borders: [], objects: [] } } },
    players: [{ id: 'p1', name: 'Italia', polityId: 'ITA', regionId: 'lazio' }],
    playerPolityId: 'ITA', playerPolityName: 'Italia', polityNames: { ITA: 'Italia' },
    actions: [{ id: 'old', playerId: 'p1', turn: 1, text: 'SCELTA_PRECEDENTE: autorizzare i lavori portuali.', createdAt: '1951-05-01' }],
    ongoingProcesses: [{ id: 'project-1', sourceActionId: 'old', title: 'CANTIERE_APERTO', summary: 'Materiali in ritardo', startedDate: '1951-05-01', expectedDate: '1951-08-01' }],
    results: [{ id: 'r1', turn: 1, narration: 'I lavori attendono materiali.', timelineEvents: [{ id: 'e1', date: '1951-05-30', headline: 'ULTIMO_DISPACCIO', detail: 'Le consegne per il porto sono state rinviate.' }] }],
    chatTranscripts: 'DIPLOMAZIA_PRECEDENTE: proposta di forniture ancora pendente.',
  };
}

for (const constrained of [false, true]) for (const override of [false, true]) {
  describe(`national context: compact=${constrained}, override=${override}`, () => {
    it('grounds suggestions, single and batch elaboration without mutating the game or adding inference calls', async () => {
      const model = constrained ? 'vendor/tiny:free' : 'gpt-4o';
      const llm: any = {
        describe: () => ({ suggestions: { model }, converter: { model } }),
        generate: vi.fn(async (mechanic: string, _system: string, prompt: string) => ({ content: mechanic === 'suggestions'
          ? JSON.stringify({ suggestions: [{ topic: 'Riprendere il porto', description: 'Le consegne rinviate impediscono di proseguire i lavori già autorizzati.', actions: [{ title: 'Verificare le forniture', content: original }] }] })
          : /^(?:Riformula ogni|Converti le decisioni)/.test(prompt)
            ? JSON.stringify([{ actionId: 'a1', type: 'action', text: original }, { actionId: 'a2', type: 'action', text: 'Verificare le forniture.' }])
            : JSON.stringify({ type: 'action', text: original }) })),
      };
      const engine = new PromptEngine(llm);
      const game = fixture(override);
      const snapshot = JSON.stringify(game);
      await engine.getSuggestions(game);
      await engine.convertAction(game, original);
      const batch = await engine.convertActionsBatch(game, [{ actionId: 'a1', text: original }, { actionId: 'a2', text: 'Verificare le forniture.' }]);
      expect(batch.map(action => action.actionId)).toEqual(['a1', 'a2']);
      expect(JSON.stringify(game)).toBe(snapshot);
      expect(llm.generate).toHaveBeenCalledTimes(override ? 4 : 3);
      for (const [mechanic, , prompt] of llm.generate.mock.calls) {
        for (const marker of ['PREMESSA_NAZIONALE', 'ULTIMO_DISPACCIO', 'SCELTA_PRECEDENTE', 'CANTIERE_APERTO', 'DIPLOMAZIA_PRECEDENTE']) expect(prompt).toContain(marker);
        if (mechanic === 'converter') {
          expect(prompt).toContain('quantità, limiti, condizioni e negazioni');
          expect(prompt).toContain('non sostituisce la volontà');
          expect(prompt).toContain('massimo 650 caratteri');
        } else {
          expect(prompt).toContain('40-75 parole');
          expect(prompt).toContain('Non proporre nuovamente iniziative completate');
          expect(prompt).not.toContain('15-25 parole');
        }
      }
    });
  });
}

it('labels fallback proposals and grounds a follow-up in the latest real dispatch', async () => {
  const llm: any = {
    describe: () => ({ suggestions: { model: 'tiny:free', provider: 'stub' } }),
    generate: vi.fn(async () => ({ content: '{"suggestions":[]}' })), invalidateCache: vi.fn(),
  };
  const proposals = await new PromptEngine(llm).getSuggestions(fixture(false));
  expect(proposals[1].description).toContain('ULTIMO_DISPACCIO');
  expect(proposals[1].actions[0].content).toContain('ULTIMO_DISPACCIO');
  expect(proposals.every(proposal => proposal.description.includes('di riserva'))).toBe(true);
  expect(llm.generate).toHaveBeenCalledTimes(2);
});
