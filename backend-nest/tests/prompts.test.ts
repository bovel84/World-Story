/**
 * Тесты промпт-слоя: парсер ответа симуляции и переменные промптов.
 * Регрессии бага №1 (лор мира не доходил до LLM, STARTING_ROUND_DATE «плыл»)
 * и бага №5 (LLM адресует регионы/политии по именам, не по id).
 */
import { describe, it, expect } from 'vitest';
import { parseSimulationResponse, buildSimulationPrompt, buildConstrainedSimulationPrompt, buildSimulationNarrativeContract, buildIncrementalOutputInstruction } from '../src/prompts/simulation';
import { LLMContractError } from '../src/llm';
import { PromptBuilder } from '../src/prompt-builder';
import { parseConverterResponse } from '../src/prompts/converter';

describe('resilienza del convertitore', () => {
  it('conserva l’ordine originale se il modello free restituisce prosa non JSON', () => {
    expect(parseConverterResponse('Non riesco a produrre JSON.', 'Mobilitiamo una brigata a Gaza')).toEqual({
      type: 'action',
      text: 'Mobilitiamo una brigata a Gaza',
    });
  });
});

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

  it('su una risposta fuori contratto lancia LLMContractError (nessun fallback vuoto)', () => {
    expect(() => parseSimulationResponse('совсем не json')).toThrow(LLMContractError);
    expect(() => parseSimulationResponse('{}')).toThrow(LLMContractError);
  });

  it('normalizza le reazioni strutturate delle politie coinvolte', () => {
    const result = parseSimulationResponse(JSON.stringify({
      events: [{
        headline: 'Israele risponde alla proposta palestinese',
        description: 'La proposta raggiunge Gerusalemme.',
        date: '2024-01-02',
        mapChanges: [],
        reactions: [
          { polityName: 'Israel', role: 'counterparty', stance: 'conditional', priority: 'sicurezza delle frontiere', response: 'Israele richiede garanzie verificabili.', counterAction: 'Convoca una verifica tecnica.', note: 'Chiediamo garanzie verificabili prima di ogni ritiro.' },
          { polityName: 'USA', role: 'observer', stance: 'neutral', response: '' },
          { polityName: 'USA', response: 'Washington offre una mediazione tecnica.' },
        ],
      }],
    }));

    expect(result.events[0].reactions).toEqual([
      expect.objectContaining({
        polityName: 'Israel',
        role: 'counterparty',
        stance: 'conditional',
        priority: 'sicurezza delle frontiere',
        counterAction: 'Convoca una verifica tecnica.',
        note: 'Chiediamo garanzie verificabili prima di ogni ritiro.',
      }),
      expect.objectContaining({ polityName: 'USA', role: 'counterparty', stance: 'neutral' }),
    ]);
  });

  it('ripara alias italiani e schemi semplificati dei modelli free', () => {
    const result = parseSimulationResponse(JSON.stringify({
      eventi: [{
        titolo: 'Mobilitazione a Gaza',
        descrizione: 'Il reclutamento prende avvio.',
        data: '2024-01-04',
        map_changes: [{
          type: 'create_army',
          region: 'Gaza',
          unitName: 'Forza territoriale',
        }],
        reazioni: [{
          country: 'Israele',
          role: 'controparte',
          position: 'condizionata',
          decision: 'Richiede garanzie verificabili.',
          counter_action: 'Rafforza il monitoraggio di frontiera.',
        }],
      }],
      narrazione: 'La mobilitazione resta parziale.',
      action_outcomes: [{
        action_id: 'ordine-1',
        status: 'parziale',
        sintesi: 'Il reclutamento è iniziato.',
        event_headlines: ['Mobilitazione a Gaza'],
      }],
      world_changes: { regionOwners: {}, regionColors: {} },
      target_date: '2024-01-04',
    }));

    expect(result.events[0]).toMatchObject({
      headline: 'Mobilitazione a Gaza',
      date: '2024-01-04',
      mapChanges: [{
        type: 'spawn_unit',
        regionName: 'Gaza',
        feature: { type: 'army', name: 'Forza territoriale' },
      }],
      reactions: [{
        polityName: 'Israele',
        role: 'counterparty',
        stance: 'conditional',
        counterAction: 'Rafforza il monitoraggio di frontiera.',
      }],
    });
    expect(result.actionOutcomes?.[0]).toMatchObject({ actionId: 'ordine-1', status: 'partial' });
    expect(result.targetDate).toBe('2024-01-04');
  });

  it('normalizza riunioni multinazionali legate a un evento e conserva il formato legacy', () => {
    const result = parseSimulationResponse(JSON.stringify({
      events: [],
      startChat: [
        {
          participants: ['Polonia', 'Cecoslovacchia', 'Polonia'],
          topic: 'Riunione urgente sulla frontiera.',
          kind: 'meeting',
          eventHeadline: 'Vertice di frontiera',
        },
        { polityName: 'Francia', topic: 'Nota diplomatica.' },
        { participants: [null, ''], topic: 'Record invalido.' },
      ],
    }));

    expect(result.startChat).toEqual([
      expect.objectContaining({
        polityName: 'Polonia',
        participants: ['Polonia', 'Cecoslovacchia'],
        kind: 'meeting',
        eventHeadline: 'Vertice di frontiera',
      }),
      expect.objectContaining({ polityName: 'Francia', participants: ['Francia'] }),
    ]);
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
    // In runSimulation il prompt di simulazione è sempre composto con il
    // protocollo incrementale, che ora contiene il formato di output e le
    // regole mappa: il prompt base resta volutamente più snello.
    const prompt = buildSimulationPrompt(vars) + buildIncrementalOutputInstruction(vars, 4);
    expect(prompt).toContain('LORE_MARKER');
    expect(prompt).toContain('Польша');
    expect(prompt).toContain('regionName');
    expect(prompt).toContain('Causa ed effetto — regola non negoziabile');
    expect(prompt).toContain('causa verificabile');
    expect(prompt).toContain('CICLO MONDIALE OBBLIGATORIO');
    expect(prompt).toContain("Ogni avanzamento temporale simula l'intero mondo");
    expect(prompt).toContain('riunione di gruppo');
    expect(prompt).toContain('eventHeadline');
    expect(prompt).toContain('participants');
    expect(prompt).toContain('reactions');
    expect(prompt).toContain('non deve essere la parafrasi');
    expect(prompt).toContain('non vale come accettazione altrui');
    expect(prompt).toContain('Personalità, priorità e memoria NPC');
    expect(prompt).toContain('counterAction');
    expect(prompt).toContain('Il campo "note" è diverso');
    expect(prompt).toContain('Le mapChanges riguardano TUTTE le politie');
    expect(prompt).toContain('nel territorio della politia che agisce');
    expect(prompt).toContain('start_construction');
    expect(prompt).toContain('spawn_unit');
    expect(prompt).toContain('INIZIATIVA AUTONOMA DELLE NAZIONI NPC');
    expect(prompt).toContain('fortification');
    expect(prompt).toContain('blocco navale');
    expect(prompt).toContain('almeno un\'iniziativa autonoma');
    // La riselezione degli attori non è più nel prompt: è autoritativa nel
    // CONTESTO DI REAZIONE (contratto del motore).
    expect(prompt).toContain('CONTRATTO DELLE REAZIONI');
    expect(prompt).toContain('actorId');
    expect(prompt).toContain('optionId');
    expect(prompt).toContain('non sostituire l\'ID con il nome della nazione');
    expect(prompt).toContain('la provincia controllata più vicina a X');
    expect(prompt).toContain('REAZIONI INTERNE ED ECONOMIA DELLA GUERRA');
    expect(prompt).toContain('tensione sociale');
    expect(prompt).toContain('[Contesto di reazione — attori, vincoli e opzioni ammesse dal motore]');
  });

  it('offre un protocollo compatto ai modelli con capacità ridotta', () => {
    const constrained = buildConstrainedSimulationPrompt({
      ...vars,
      PLAYER_ACTIONS_THIS_ROUND: '[actionId:a1] Avviare una mobilitazione limitata',
      NPC_STRATEGIC_PROFILES: 'Israele [ISR]: sicurezza delle frontiere',
    }, { autoJump: true, eventBudget: 1 });
    expect(constrained).toContain('PROTOCOLLO COMPATTO');
    expect(constrained).toContain('[actionId:a1]');
    expect(constrained).toContain('start_mobilization');
    expect(constrained).toContain('Una controazione materiale');
    expect(constrained).toContain('nel territorio della politia che agisce');
    expect(constrained).toContain('Iniziativa NPC');
    expect(constrained).toContain("preparazione d'invasione");
    expect(constrained).toContain('CONTESTO DI REAZIONE');
    expect(constrained).toContain('nasce in una provincia controllata da chi la crea');
    expect(constrained).toContain('4c. Reazioni interne ed economia');
    expect(constrained).toContain('ULTIMA riga obbligatoria');
    expect(constrained.length).toBeLessThan(buildSimulationPrompt(vars).length);
  });

  it('conserva antefatti recenti e premessa anche nel percorso compatto con override', () => {
    const results = Array.from({ length: 10 }, (_, index) => ({
      id: `r${index}`, turn: index + 1, narration: 'Sintesi precedente. '.repeat(100),
      timelineEvents: [{ id: `e${index}`, date: '1952-06-14', headline: `Fatto ${index}`,
        detail: `${index === 9 ? 'ULTIMO_ANTEFATTO' : 'VECCHIO_FATTO'}: trattativa ancora aperta. ${'Dettagli confermati. '.repeat(80)}` }],
    }));
    const historyVars = new PromptBuilder({ ...game, results, consolidatedHistory: `MEMORIA_STORICA ${'Fatti remoti. '.repeat(600)}` }).buildVariables();
    const compact = buildConstrainedSimulationPrompt(historyVars, { presetOverride: 'Istruzioni editoriali senza placeholder.' });
    expect(compact).toContain('ULTIMO_ANTEFATTO');
    expect(compact).toContain('MEMORIA_STORICA');
    expect(compact).toContain('LORE_MARKER');
    expect(compact).toContain('Istruzioni editoriali senza placeholder.');
    expect(historyVars.ALL_EVENTS_WITH_CONSOLIDATION.length).toBeLessThanOrEqual(4500);
    for (const prompt of [compact, buildSimulationPrompt(historyVars), buildSimulationNarrativeContract(historyVars, true)]) {
      expect(prompt).toContain('antefatto documentato');
      expect(prompt).not.toContain('3 frasi dense');
      expect(prompt).not.toContain('3 frasi con causa');
    }
  });

  it('applica un contratto narrativo anche ai preset che sovrascrivono il prompt', () => {
    const contract = buildSimulationNarrativeContract(vars, true);
    expect(contract).toContain('CONTRATTO NARRATIVO NON AGGIRABILE');
    expect(contract).toContain('LORE_MARKER');
    expect(contract).toContain('non prende iniziative senza un ordine esplicito');
    expect(contract).toContain('causa già visibile');
    expect(contract).toContain('non dichiarare firmato un accordo');
    expect(contract).toContain('Personalità, priorità e memoria NPC');
    expect(contract).toContain('mapChanges');
    expect(contract).toContain('nel territorio della politia che agisce');
    expect(contract).toContain('INIZIATIVA AUTONOMA DELLE NAZIONI NPC');
  });

  it('passa al simulatore il dossier strategico persistente degli NPC', () => {
    const npcVars = new PromptBuilder({
      ...game,
      npcStrategicProfiles: 'Israele [ISR] — profilo persistente: security_first; memoria strategica: rifiuto del turno 2.',
    }).buildVariables();
    expect(npcVars.NPC_STRATEGIC_PROFILES).toContain('Israele [ISR]');
    expect(buildSimulationPrompt(npcVars)).toContain('memoria strategica: rifiuto del turno 2');
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

  it('mostra la potenza effettiva delle nazioni confinanti quando l’arsenale è noto', () => {
    const armedGame: any = {
      ...game,
      relationships: { DEU: { POL: 'hostile' }, POL: { DEU: 'hostile' } },
      worldState: {
        accounts: {
          DEU: { polityId: 'DEU', provinces: 1, population: 10, gdp: 20, militaryPower: 30, factories: 0, ports: 0, universities: 0, forces: 2, mobilized: 0, monthlyRevenue: 1, monthlyExpenses: 1, monthlyBalance: 0, annualGrowthRate: 0, stability: 50, defenceBurdenPct: 2, warEffort: 10, socialTension: 5, nominalGdpUsdBillions: 100, gdpPerCapitaUsd: 1000, government: 'repubblica', effectiveMilitaryPower: 18 },
          POL: { polityId: 'POL', provinces: 1, population: 40, gdp: 50, militaryPower: 60, factories: 0, ports: 0, universities: 0, forces: 3, mobilized: 0, monthlyRevenue: 1, monthlyExpenses: 1, monthlyBalance: 0, annualGrowthRate: 0, stability: 50, defenceBurdenPct: 2, warEffort: 10, socialTension: 5, nominalGdpUsdBillions: 100, gdpPerCapitaUsd: 1000, government: 'repubblica', effectiveMilitaryPower: 36 },
        },
      },
      world: {
        ...game.world,
        regions: {
          w1_DEU: { ...game.world.regions.w1_DEU, population: 10, gdp: 20, militaryPower: 30, borders: ['w1_POL'] },
          w1_POL: { ...game.world.regions.w1_POL, population: 40, gdp: 50, militaryPower: 60, borders: ['w1_DEU'] },
        },
      },
    };
    const vars = new PromptBuilder(armedGame).buildVariables();
    expect(vars.STRATEGIC_STATE).toContain('potenza militare 36 effettiva (nominale 60)');
  });

  it('mostra il magazzino materiale con capacità, copertura e tetto reale', () => {
    const materialGame: any = {
      ...game,
      worldState: {
        accounts: {
          DEU: { polityId: 'DEU', provinces: 1, population: 60_000_000, gdp: 2000, militaryPower: 300, factories: 3, ports: 1, universities: 2, forces: 10, mobilized: 0, monthlyRevenue: 10, monthlyExpenses: 9, monthlyBalance: 1, annualGrowthRate: 0.02, stability: 50, defenceBurdenPct: 2, warEffort: 10, socialTension: 5, nominalGdpUsdBillions: 4500, gdpPerCapitaUsd: 45000, government: 'repubblica' },
        },
        resources: {
          stock: { money: 20, food: 4, clothing: 3, weapons: 10, fuel: 2, research: 10, technologies: [] },
          capacity: { food: 8, clothing: 6, weapons: 20, fuel: 5 },
          needs: { food: 1.2, clothing: 0.5, weapons: 0.3, fuel: 0.6 },
        },
      },
    };
    const vars = new PromptBuilder(materialGame).buildVariables();
    // Il modello vede la copertura reale e il tetto del magazzino, così le sue
    // leve materiali restano dentro la capacità della nazione.
    expect(vars.STRATEGIC_STATE).toContain('Magazzino materiale');
    expect(vars.STRATEGIC_STATE).toContain('mesi di copertura');
    expect(vars.STRATEGIC_STATE).toContain('Capacità di stoccaggio');
    expect(buildSimulationPrompt(vars)).toContain('Capacità di stoccaggio');
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
