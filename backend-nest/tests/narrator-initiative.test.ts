import { describe, expect, it, vi } from 'vitest';
import { PromptEngine } from '../src/prompt-builder';
import { autoJumpEventBudget, fixedJumpEventBudget, isAutoJumpStop } from '../src/core/simulation/EventBudget';
import { buildNarrativeSituationSources, buildWorldChronicleGuide } from '../src/prompts/simulation/initiative';
import { buildConstrainedSimulationPrompt } from '../src/prompts/simulation/prompt';
import type { PromptVariables } from '../src/prompts/types';
import { buildReactionContext, renderReactionContext } from '../src/core/simulation/ReactionContext';

const pressure = 'Le comunità chiedono accesso alle strade rurali';
const commitment = 'Consultazione sui collegamenti rurali ancora aperta';
function game(override: boolean): any {
  return {
    id: 'initiative', currentDate: '2000-01-01', currentTurn: 1,
    world: {
      name: 'Test', basePrompt: 'La ricostruzione rurale è incompleta.', startDate: '2000-01-01',
      ...(override ? { prompts: { simulation: 'Simula il periodo.' } } : {}),
      regions: { KHM: { id: 'KHM', name: 'Cambogia', owner: 'KHM', color: '#111', objects: [] } },
    },
    players: [{ id: 'p1', name: 'Cambogia', regionId: 'KHM', polityId: 'KHM' }],
    playerPolityId: 'KHM', polityNames: { KHM: 'Cambogia' }, actions: [], results: [],
    activeCommitments: commitment,
    storylines: [{ id: 'rural', title: 'Ricostruzione rurale', summary: 'Il paese ricostruisce i collegamenti.', parties: ['KHM'] }],
    polityNationSituations: [{ polityId: 'KHM', countryName: 'Cambogia', startDate: '2000-01-01',
      situation: 'Le comunità rurali cercano accesso ai mercati.', generatedAt: '2000-01-01', version: 1 }],
    worldState: { pressures: [{ id: 'rural', kind: 'internal', title: pressure,
      detail: 'I collegamenti limitano l’accesso ai mercati.', severity: 2, source: 'Comunità rurali' }] },
  };
}

function router(model: string, count = 1) {
  const events = Array.from({ length: count }, (_, i) => ({
    type: 'event', headline: `Le comunità presentano la richiesta ${i + 1}`,
    description: 'I collegamenti rurali restano incompleti. Le comunità chiedono un confronto sulle priorità: resta da scegliere quali collegamenti esaminare per primi.',
    date: `2000-01-0${i + 2}`, mapChanges: [], reactions: [],
  }));
  const content = [...events, { type: 'complete', narration: 'Il confronto resta aperto.',
    actionOutcomes: [], voided: [], startChat: [], relationshipChanges: [],
    worldChanges: { regionOwners: {}, regionColors: {} }, targetDate: events.at(-1)!.date }]
    .map(value => JSON.stringify(value)).join('\n');
  return {
    describe: () => ({ jump: { model } }),
    stream: vi.fn(async (_mechanic: string, _system: string, _prompt: string, onToken: any) => {
      onToken(content.length, content);
      return { content };
    }),
    generate: vi.fn(),
  };
}

describe('narratore: iniziativa causale nella chiamata del turno', () => {
  it('il percorso Flash trasmette l’ultimo attore e tutte le sue opzioni nella singola chiamata', async () => {
    const data = game(false);
    const ids = Array.from({ length: 8 }, (_, i) => `NPC${i}`);
    data.reactionContextData = buildReactionContext({ playerPolityId: 'KHM', playerPolityName: 'Cambogia', focusTexts: [],
      polityNames: Object.fromEntries(ids.map(id => [id, id])),
      regions: Object.fromEntries(ids.map(id => [id, { id, name: id, owner: id }])),
      worldCauses: [{ kind: 'world_process', sourceRef: 'storyline:talks', summary: 'S'.repeat(500), polityIds: ids }] });
    data.reactionContext = renderReactionContext(data.reactionContextData);
    expect(data.reactionContext.length).toBeGreaterThan(2500);
    const llm = router('glm-5.3-flash');
    await new PromptEngine(llm as any).runSimulation(data, [], 30);
    const prompt = llm.stream.mock.calls[0][2];
    for (const option of data.reactionContextData.allowedOptionIds) expect(prompt).toContain(option);
    expect(prompt).toContain('eventHeadline ESATTO');
    expect(prompt).toContain('[CRONACA STORICA MONDIALE');
    expect(prompt).toContain('TIMELINE di fatti datati');
    expect(llm.stream).toHaveBeenCalledTimes(1);
    expect(llm.generate).not.toHaveBeenCalled();
  });

  // These are wiring/regression checks with mock output, not a quality benchmark.
  it.each([
    ['glm-5.3-flash', false], ['gpt-test', false], ['gpt-test', true], ['glm-5.3-flash', true],
  ])('%s, preset override %s: conserva fonti e un evento interno senza ordini', async (model, override) => {
    const llm = router(model);
    const emitted: string[] = [];
    const result = await new PromptEngine(llm as any).runSimulation(
      game(override), [], 30, undefined, true, event => emitted.push(event.headline),
    );
    const prompt = llm.stream.mock.calls[0][2];
    expect(prompt).toContain(pressure);
    expect(prompt).toContain(commitment);
    expect(prompt).toContain('Ricostruzione rurale');
    expect(prompt).toContain('Le comunità rurali cercano accesso ai mercati.');
    expect(prompt.match(/\[MONDO VIVO/g)).toHaveLength(1);
    expect(prompt.match(/\[CRONACA STORICA MONDIALE/g)).toHaveLength(1);
    expect(prompt).toContain('Regole auto-jump senza ordini');
    expect(prompt).not.toContain('Fermati SOLO sull\'evento');
    expect(prompt).not.toContain('NON fermarti al primo fatto');
    expect(prompt).not.toContain('Se nessun evento porta una decisione NPC');
    expect(result.events).toHaveLength(1);
    expect(result.events[0].reactions).toEqual([]);
    expect(result.events[0].mapChanges).toEqual([]);
    expect(emitted).toEqual([result.events[0].headline]);
    expect(result.targetDate).toBe('2000-01-02');
    expect(llm.stream).toHaveBeenCalledTimes(1);
    expect(llm.generate).not.toHaveBeenCalled();
  });

  it('conserva tutti i dispacci completi anche oltre la stima di eventi', async () => {
    const llm = router('glm-5.3-flash', 5);
    const result = await new PromptEngine(llm as any).runSimulation(game(false), [], 30, undefined, true);
    expect(result.events).toHaveLength(5);
    expect(result.events.at(-1)?.date).toBe('2000-01-06');
    const prompt = llm.stream.mock.calls[0][2];
    expect(prompt).toContain('senza un tetto numerico artificiale');
    expect(prompt).not.toContain('Genera massimo 3 eventi');
    expect(llm.stream.mock.calls[0][4]?.maxTokens).toBe(8_000);
    expect(llm.stream).toHaveBeenCalledTimes(1);
    expect(llm.generate).not.toHaveBeenCalled();
  });

  it('la guida richiede eventi mondiali datati, non copie del futuro storico', () => {
    const guide = buildWorldChronicleGuide();
    expect(guide).toContain('TIMELINE di fatti datati');
    expect(guide).toContain('Dopo la data di divergenza');
    expect(guide).toContain('mapChanges:[]');
    expect(guide).toContain('startChat');
    expect(guide.length).toBeLessThan(2800);
  });

  it('il budget lascia spazio al mondo oltre agli esiti degli ordini', async () => {
    expect(fixedJumpEventBudget(30, 3)).toBe(5);
    expect(fixedJumpEventBudget(1, 0)).toBe(2);
    expect(fixedJumpEventBudget(30, 0)).toBe(3);
    expect(fixedJumpEventBudget(3650, 100)).toBe(30);
    const llm = router('glm-5.3-flash', 3);
    const result = await new PromptEngine(llm as any).runSimulation(game(false), ['Aprire un confronto'], 30);
    expect(result.events).toHaveLength(3); // Old budget truncated this to two.
    expect(llm.generate).not.toHaveBeenCalled();
  });

  it('senza ordini non ferma la cronaca per numero di eventi, ma conserva la risposta NPC agli ordini', () => {
    expect(autoJumpEventBudget(0)).toBe(3);
    expect(autoJumpEventBudget(1)).toBe(3);
    expect(isAutoJumpStop({ reactions: [] }, 0, 1)).toBe(false);
    expect(isAutoJumpStop({ reactions: [] }, 0, 2)).toBe(false);
    expect(isAutoJumpStop({ reactions: [] }, 0, 3)).toBe(false);
    expect(isAutoJumpStop({ reactions: [] }, 0, 100)).toBe(false);
    expect(isAutoJumpStop({ reactions: [] }, 1, 3)).toBe(false);
    expect(isAutoJumpStop({ reactions: [{ role: 'counterparty' }] }, 1, 1)).toBe(true);
    expect(isAutoJumpStop(null, 0, 3)).toBe(false);
  });

  it('limita ogni fonte separatamente e conserva i vincoli di copertura nel compatto', () => {
    const vars = { PEACETIME_PRESSURES: pressure, NATION_CRISIS: 'Crisi registrata',
      GOVERNMENT_STATE: 'G'.repeat(20_000), ACTIVE_COMMITMENTS: commitment,
      ORDER_FUNDING: '[ordine-1] Copertura assente', PLAYER_POLITY: 'Cambogia' } as PromptVariables;
    const sources = buildNarrativeSituationSources(vars);
    expect(sources.length).toBeLessThan(3000);
    expect(sources).toContain(commitment);
    expect(sources).toContain('Crisi registrata');
    expect(buildNarrativeSituationSources({} as PromptVariables)).toBe('');
    const prompt = buildConstrainedSimulationPrompt(vars);
    expect(prompt).toContain('[ordine-1] Copertura assente');
    expect(prompt).toContain('non possono avere esito accepted');
  });
});
