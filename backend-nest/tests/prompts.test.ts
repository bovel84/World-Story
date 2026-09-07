/**
 * Тесты промпт-слоя: парсер ответа симуляции и переменные промптов.
 * Регрессии бага №1 (лор мира не доходил до LLM, STARTING_ROUND_DATE «плыл»)
 * и бага №5 (LLM адресует регионы/политии по именам, не по id).
 */
import { describe, it, expect } from 'vitest';
import { parseSimulationResponse, buildSimulationPrompt } from '../src/prompts/simulation';
import { PromptBuilder } from '../src/prompt-builder';

describe('parseSimulationResponse', () => {
  it('парсит валидный JSON с событиями и mapChanges по именам', () => {
    const json = JSON.stringify({
      events: [
        {
          headline: 'Польша капитулировала',
          description: 'Войска ФРГ вошли в Варшаву.',
          date: '1951-02-01',
          mapChanges: [{ type: 'transfer', regionName: 'Польша', newOwner: 'ФРГ' }],
        },
      ],
      narration: 'Мир содрогнулся.',
      worldChanges: { regionOwners: { 'Польша': 'ФРГ' }, regionColors: {} },
    });

    const result = parseSimulationResponse(json);
    expect(result.events).toHaveLength(1);
    expect(result.events[0].mapChanges[0].regionName).toBe('Польша');
    expect(result.narration).toBe('Мир содрогнулся.');
    expect(result.worldChanges.regionOwners['Польша']).toBe('ФРГ');
  });

  it('достаёт JSON из обёртки (markdown/текст вокруг)', () => {
    const text = 'Вот результат:\n```json\n{"events": [], "narration": "ok"}\n```';
    const result = parseSimulationResponse(text);
    expect(result.narration).toBe('ok');
  });

  it('на мусоре возвращает fallback, не падает', () => {
    const result = parseSimulationResponse('совсем не json');
    expect(result.events).toEqual([]);
    expect(typeof result.narration).toBe('string');
  });
});

describe('PromptBuilder.buildVariables (баг №1)', () => {
  const game: any = {
    id: 'g1',
    currentDate: '1952-06-15', // «текущая» дата отличается от стартовой
    currentTurn: 7,
    world: {
      name: 'Test World',
      basePrompt: 'LORE_MARKER: в этом мире СССР распался в 1949 году',
      startDate: '1951-01-01',
      regions: {
        w1_DEU: { id: 'w1_DEU', name: 'ФРГ', owner: 'DEU', color: '#FF0000', objects: [] },
        w1_POL: { id: 'w1_POL', name: 'Польша', owner: 'POL', color: '#00FF00', objects: [] },
      },
    },
    players: [{ id: 'p1', name: 'Player', regionId: 'w1_DEU', polityId: 'DEU' }],
    playerPolityId: 'DEU',
    actions: [],
    results: [],
  };

  const vars = new PromptBuilder(game).buildVariables();

  it('лор мира доходит до промпта (WORLD_BEFORE_ROUND_ONE_TEXT)', () => {
    expect(vars.WORLD_BEFORE_ROUND_ONE_TEXT).toContain('LORE_MARKER');
  });

  it('STARTING_ROUND_DATE зафиксирован на старте мира, а не «плывёт» за текущей датой', () => {
    expect(vars.STARTING_ROUND_DATE).toBe('1951-01-01');
    expect(vars.ORIGIN_ROUND_DATE).toBe('1952-06-15');
  });

  it('описание карты по именам с id-алиасами и пометкой игрока (баг №5)', () => {
    expect(vars.GRAND_MAP_DESCRIPTION_NO_CITY).toContain('Politia "ФРГ" [DEU] (GIOCATORE)');
    expect(vars.GRAND_MAP_DESCRIPTION_NO_CITY).toContain('Politia "Польша" [POL]');
    expect(vars.GRAND_MAP_DESCRIPTION_NO_CITY).not.toContain('ai-');
  });

  it('полный промпт симуляции содержит лор и имена', () => {
    const prompt = buildSimulationPrompt(vars);
    expect(prompt).toContain('LORE_MARKER');
    expect(prompt).toContain('Польша');
    expect(prompt).toContain('regionName');
    expect(prompt).toContain('Causa ed effetto — regola non negoziabile');
    expect(prompt).toContain('causa verificabile');
    expect(prompt).toContain('CICLO MONDIALE OBBLIGATORIO');
    expect(prompt).toContain("Ogni avanzamento temporale simula l'intero mondo");
  });

  it('passa uno stato strategico verificabile con confini, risorse e relazioni', () => {
    const strategicGame: any = {
      ...game,
      relationships: { DEU: { POL: 'hostile' }, POL: { DEU: 'hostile' } },
      world: {
        ...game.world,
        regions: {
          w1_DEU: { ...game.world.regions.w1_DEU, population: 10, gdp: 20, militaryPower: 30, borders: ['w1_POL'] },
          w1_POL: { ...game.world.regions.w1_POL, population: 40, gdp: 50, militaryPower: 60, borders: ['w1_DEU'] },
        },
      },
    };
    const strategicVars = new PromptBuilder(strategicGame).buildVariables();
    expect(strategicVars.STRATEGIC_STATE).toContain('PIL 20');
    expect(strategicVars.STRATEGIC_STATE).toContain('rapporto hostile');
    expect(strategicVars.STRATEGIC_STATE).toContain('confina tramite Польша');
    expect(strategicVars.STRATEGIC_STATE).toContain('potenza militare stimata 60');
  });

  it('для провинциальной карты передаёт настоящее имя страны, все регионы и суммарные ресурсы', () => {
    const provincialGame: any = {
      ...game,
      playerPolityName: 'Germania',
      polityNames: { DEU: 'Germania', POL: 'Polonia' },
      world: {
        ...game.world,
        regions: {
          w1_BER: { id: 'w1_BER', name: 'Berlino', owner: 'DEU', color: '#f00', population: 4, gdp: 10, militaryPower: 7, objects: [] },
          w1_BAV: { id: 'w1_BAV', name: 'Baviera', owner: 'DEU', color: '#f00', population: 8, gdp: 20, militaryPower: 5, objects: [{ type: 'battalion' }] },
          w1_POL: game.world.regions.w1_POL,
        },
      },
      players: [{ id: 'p1', name: 'Player', regionId: 'w1_BER', polityId: 'DEU' }],
    };

    const provincialVars = new PromptBuilder(provincialGame).buildVariables();
    expect(provincialVars.PLAYER_POLITY).toBe('Germania');
    expect(provincialVars.GRAND_MAP_DESCRIPTION_NO_CITY).toContain('Politia "Germania" [DEU]');
    expect(provincialVars.PLAYER_POLITY_REGIONS).toContain('Berlino, Baviera');
    expect(provincialVars.PLAYER_POLITY_REGIONS).toContain('PIL 30');
    expect(provincialVars.PLAYER_POLITY_BATTALION_SUMMARIES).toContain('1 unità in Baviera');
  });

  it('la cronaca passata all\'LLM include i dettagli completi degli eventi, non solo il riassunto', () => {
    const historyGame: any = {
      ...game,
      results: [
        {
          id: 'r1',
          turn: 1,
          narration: 'La Germania invade la Polonia.',
          events: ['La Germania invade la Polonia'],
          date: '1951-02-01',
          timelineEvents: [
            {
              id: 'r1-0',
              date: '1951-02-01',
              headline: 'La Germania invade la Polonia',
              detail: 'Le divisioni corazzate tedesche attraversano il confine e occupano Varsavia in tre giorni.',
              source: 'world',
            },
          ],
        },
        {
          id: 'r2',
          turn: 2,
          narration: 'La Polonia firma la resa.',
          events: ['La Polonia firma la resa'],
          date: '1951-03-01',
          timelineEvents: [
            {
              id: 'r2-0',
              date: '1951-03-01',
              headline: 'La Polonia firma la resa',
              detail: 'Il governo polacco in esilio accetta l\'armistizio proposto da Berlino.',
              source: 'world',
            },
          ],
        },
      ],
    };

    const historyVars = new PromptBuilder(historyGame).buildVariables();
    // Il dettaglio completo dell'evento deve arrivare all'LLM, non solo il riassunto.
    expect(historyVars.ALL_EVENTS_WITH_CONSOLIDATION).toContain('occupano Varsavia in tre giorni');
    expect(historyVars.ALL_EVENTS_WITH_CONSOLIDATION).toContain('governo polacco in esilio');
    expect(historyVars.ALL_EVENTS_WITH_CONSOLIDATION).toContain('Turno 1');
    expect(historyVars.ALL_EVENTS_WITH_CONSOLIDATION).toContain('Turno 2');
  });
});
