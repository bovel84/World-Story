/**
 * WS-GOV-MINISTER-WORLD-CONTEXT — un solo mondo, per tutti i ministri
 * ==================================================================
 * Prova che:
 *  1. il contesto di mondo si deriva dai soli dati del `GameData` ed è diverso
 *     per mondi/momenti diversi (nessuna fonte in più);
 *  2. con JEV **spento** il blocco `[IDENTITÀ DEL MONDO]`/`[CONTESTO DEL PAESE]`
 *     arriva al ministro e alla voce read-only della riunione, con l'enfasi
 *     della competenza desunta dalla sedia;
 *  3. con JEV **acceso** lo stesso blocco non è duplicato e i `[DATI VERIFICATI]`
 *     restano per ultimi (l'ordine §3);
 *  4. la gerarchia delle verità è presente.
 *
 * Solo SQLite temporaneo e provider stub: nessun backend, nessuna rete.
 * Le sedie non attive nella fixture (Lavori, Esteri) sono provate dal percorso
 * reale del builder (`PromptEngine.getAdvisor`), lo stesso che usa la rotta.
 */
import { afterAll, beforeAll, afterEach, describe, expect, it, vi } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { mandateFor } from '../src/core/government/MinisterMemory';
import { SEAT_LABEL } from '../src/core/government/Cabinet';

const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'ws-gov-world-'));
const originalDbPath = process.env.OPEN_PAX_DB_PATH;
process.env.OPEN_PAX_DB_PATH = path.join(directory, 'memory.sqlite');
const originalEnabled = process.env.JEV_MEMORY_ENABLED;

const WORLD = 'ws-gov-world-context';
let db: any;
let session: any;
let PromptBuilder: any;
let PromptEngine: any;
let scopeFor: (seat: string) => any;
let buildMinisterWorldContext: typeof import('../src/prompts/national-context').buildMinisterWorldContext;
let renderMinisterWorldContext: typeof import('../src/prompts/national-context').renderMinisterWorldContext;
let renderWorldIdentity: typeof import('../src/prompts/national-context').renderWorldIdentity;
let MINISTER_WORLD_TRUTH_HIERARCHY: string;
let composeMeetingNarrativeMessage: typeof import('../src/core/government/MeetingNarrative').composeMeetingNarrativeMessage;

const captured: string[] = [];
const provider: any = {
  consolidation: { startRound: 25, chunkSize: 5, keepRawTail: 10 },
  async generate(_mechanic: string, _system: string, prompt: string) { captured.push(prompt); return { content: 'Risposta di fixture.' }; },
  async stream(_mechanic: string, _system: string, prompt: string, callback: (n: number) => void) { captured.push(prompt); callback(20); return { content: 'Risposta di fixture.' }; },
  clearCache() {},
};

beforeAll(async () => {
  vi.spyOn(Math, 'random').mockReturnValue(0.42);
  const database = await import('../src/database');
  db = database.default;
  database.initDatabase();
  PromptBuilder = (await import('../src/prompt-builder')).PromptBuilder;
  PromptEngine = (await import('../src/prompt-builder')).PromptEngine;
  ({ buildMinisterWorldContext, renderMinisterWorldContext, renderWorldIdentity, MINISTER_WORLD_TRUTH_HIERARCHY } = await import('../src/prompts/national-context'));
  ({ composeMeetingNarrativeMessage } = await import('../src/core/government/MeetingNarrative'));
  const repos = await import('../src/repositories');
  repos.worldRepository.createWithRegions(
    {
      id: WORLD, name: 'Mondo Marker', description: '', startDate: '1936-01-01',
      basePrompt: 'TEST_WORLD_CONTEXT_MARKER il mondo è sull’orlo della guerra.',
      historicalAccuracy: 0.8,
      simulationRules: 'TEST_WORLD_RULE_MARKER le crisi si propagano in tre mesi.',
    },
    [{ id: `${WORLD}_REG`, name: 'Ruritania', color: '#123456', owner: 'RUR', population: 1000, gdp: 2400, militaryPower: 10, flag: 'RUR', coastal: true, borders: [], objects: [] } as any],
  );
  const { initSessionRegistry } = await import('../src/session-registry');
  ({ session } = initSessionRegistry(provider).createSession(WORLD, 'Player', `${WORLD}_REG`, '#123456'));
  const branchId = repos.gameRepository.ensureMainBranch(session.id);
  scopeFor = (seat: string) => ({
    gameId: session.id,
    branchId,
    seat,
    mandate: mandateFor(seat as any, session.getGovernment(), session.getPlayer()?.polityId ?? null),
  });
});

afterEach(() => { vi.restoreAllMocks(); });
afterAll(() => {
  if (db?.open) db.close();
  if (originalDbPath === undefined) delete process.env.OPEN_PAX_DB_PATH; else process.env.OPEN_PAX_DB_PATH = originalDbPath;
  if (originalEnabled === undefined) delete process.env.JEV_MEMORY_ENABLED; else process.env.JEV_MEMORY_ENABLED = originalEnabled;
  fs.rmSync(directory, { recursive: true, force: true });
});

describe('WS-GOV-MINISTER-WORLD-CONTEXT', () => {
  it('deriva un unico contesto di mondo, diverso per mondi e momenti diversi', () => {
    session.currentTurn = 5;
    session.currentDate = '1938-06-01';
    const vars = new PromptBuilder(session.buildGameData()).buildVariables();
    const world = buildMinisterWorldContext({ vars, worldName: vars.WORLD_NAME, seat: 'tesoro' });
    expect(world.worldName).toBe('Mondo Marker');
    expect(world.scenarioPremise).toContain('TEST_WORLD_CONTEXT_MARKER');
    expect(world.simulationRules).toContain('TEST_WORLD_RULE_MARKER');

    const other = buildMinisterWorldContext({
      vars: { ...vars, WORLD_BEFORE_ROUND_ONE_TEXT: 'ALTRO_MONDO_PREMISE', ORIGIN_ROUND_DATE: '1960-01-01', WORLD_NAME: 'Altro Mondo' },
      worldName: 'Altro Mondo',
      seat: 'tesoro',
    });
    expect(other.worldName).toBe('Altro Mondo');
    expect(other.currentDate).toBe('1960-01-01');
    expect(other.scenarioPremise).toContain('ALTRO_MONDO_PREMISE');
    expect(other.scenarioPremise).not.toContain('TEST_WORLD_CONTEXT_MARKER');
    expect(world.currentDate).toBe('1938-06-01');

    const rendered = renderMinisterWorldContext(world, 'tesoro');
    expect(rendered).toContain('[IDENTITÀ DEL MONDO]');
    expect(rendered).toContain('[CONTESTO DEL PAESE]');
    expect(rendered).toContain(MINISTER_WORLD_TRUTH_HIERARCHY);
    expect(rendered).toContain('[ENFASI DELLA TUA COMPETENZA]');
  });

  it('JEV spento: al ministro e alla voce della riunione arriva il mondo, con l’enfasi della sedia', async () => {
    process.env.JEV_MEMORY_ENABLED = 'false';
    session.currentTurn = 5;
    session.currentDate = '1938-06-01';

    // Percorso reale della chat: la sola sedia attiva nella fixture è il Tesoro.
    captured.length = 0;
    await session.getMinisterReply('tesoro', 'Che aria tira?', []);
    expect(captured[0]).toContain('[IDENTITÀ DEL MONDO]');
    expect(captured[0]).toContain('[CONTESTO DEL PAESE]');
    expect(captured[0]).toContain('TEST_WORLD_CONTEXT_MARKER');
    expect(captured[0]).toContain('[GERARCHIA DELLE VERITÀ');
    expect(captured[0]).toContain('situazione economica');

    // Stesso percorso reale del builder, per sedie non attive nella fixture: la
    // sedia si desume dal briefing senza toccare `game-session.ts`.
    const engine = new PromptEngine(provider);
    const expectations: Record<string, string> = { lavori: 'industrializzazione', esteri: 'alleanze' };
    for (const [seat, keyword] of Object.entries(expectations)) {
      captured.length = 0;
      const data = session.buildGameData();
      await engine.getAdvisor(data, `Sei il ${SEAT_LABEL[seat]} del governo.\n\nREGOLE CHE NON PUOI VIOLARE: nessuna.`, []);
      expect(captured[0], seat).toContain('[IDENTITÀ DEL MONDO]');
      expect(captured[0], seat).toContain('TEST_WORLD_CONTEXT_MARKER');
      expect(captured[0], seat).toContain('[ENFASI DELLA TUA COMPETENZA]');
      expect(captured[0], seat).toContain(keyword);
    }

    // La voce read-only della riunione (rotta `.../render`): solo prosa, ma con
    // lo stesso contesto di mondo.
    captured.length = 0;
    const data = session.buildGameData();
    await engine.getAdvisor(data, composeMeetingNarrativeMessage({
      seat: 'esteri', facts: [], blockers: [], politicalContext: [], meetingObjective: 'OBJ_TEST', previousContributions: [],
    }), []);
    expect(captured[0]).toContain('[IDENTITÀ DEL MONDO]');
    expect(captured[0]).toContain('TEST_WORLD_CONTEXT_MARKER');
    expect(captured[0]).toContain('OBJ_TEST');
  });

  it('JEV acceso: lo stesso mondo, senza duplicazioni, e i dati verificati per ultimi', async () => {
    process.env.JEV_MEMORY_ENABLED = 'true';
    session.currentTurn = 5;
    session.currentDate = '1938-06-01';
    const engine = new PromptEngine(provider);
    for (const seat of ['tesoro', 'lavori', 'esteri']) {
      captured.length = 0;
      const data = session.buildGameData();
      data.ministerMemoryRequest = { scope: scopeFor(seat), query: 'Che aria tira?', verifiedState: `STATO_VERIFICATO_${seat}` };
      await engine.getAdvisor(data, 'Che aria tira?', []);
      const prompt = captured[0];
      expect(prompt, seat).toContain('[IDENTITÀ DEL MONDO]');
      expect(prompt, seat).toContain('TEST_WORLD_CONTEXT_MARKER');
      expect(prompt, seat).toContain('[CONTESTO DEL PAESE]');
      expect(prompt, seat).toContain('[ENFASI DELLA TUA COMPETENZA]');
      // Il blocco mondo è una volta sola: JEV e builder non lo duplicano.
      expect(prompt.match(/\[IDENTITÀ DEL MONDO\]/g), seat).toHaveLength(1);
      expect(prompt.match(/\[CONTESTO DEL PAESE\]/g), seat).toHaveLength(1);
      expect(prompt, seat).toContain('CURRENT VERIFIED STATE');
      expect(prompt, seat).toContain(`STATO_VERIFICATO_${seat}`);
      // Ordine §3: mondo → paese → ministero → dati verificati.
      const positions = ['[IDENTITÀ DEL MONDO]', '[CONTESTO DEL PAESE]', 'MINISTER IDENTITY', 'CURRENT VERIFIED STATE']
        .map(header => prompt.indexOf(header));
      expect(positions.every(index => index >= 0), seat).toBe(true);
      expect(positions, seat).toEqual([...positions].sort((a, b) => a - b));
    }
  });

  it('guardrail: il preset non è una fonte di cifre e i dati verificati restano separati', async () => {
    process.env.JEV_MEMORY_ENABLED = 'true';
    session.currentTurn = 5;
    session.currentDate = '1938-06-01';
    const vars = new PromptBuilder(session.buildGameData()).buildVariables();
    const world = buildMinisterWorldContext({
      vars: { ...vars, HISTORICAL_PRESET_SIMULATION_RULES: 'PRESET_NUMBER_777 il presidio resta.' },
      worldName: vars.WORLD_NAME,
      seat: 'tesoro',
    });
    const { buildMinisterContext } = await import('../src/core/government/jev/jev-memory.service');
    const result = buildMinisterContext({
      scope: scopeFor('tesoro'),
      query: 'spesa',
      verifiedState: 'CIFRA_MOTORE 42',
      worldContext: renderWorldIdentity(world),
      nationalContext: `[CONTESTO DEL PAESE]\n${world.simulationRules}`,
      asOf: { gameDate: '1938-06-01', turn: 5 },
    });
    expect(result.sections.worldContext).toContain('PRESET_NUMBER_777');
    expect(result.sections.worldState).toContain('CIFRA_MOTORE 42');
    // I dati verificati non contengono il numero del preset: il preset è
    // significato, non fonte di cifre (§4).
    expect(result.sections.worldState).not.toContain('PRESET_NUMBER_777');
    // Telemetria JEV coerente: il contesto immutabile è contabilizzato a parte
    // e, con le sezioni dinamiche entro budget, `over_budget` è falso (§3).
    expect(result.telemetry.immutable_context_bytes).toBeGreaterThan(0);
    expect(result.telemetry.dynamic_budget_bytes).toBe(4400);
    expect(result.telemetry.over_budget).toBe(false);
    expect(result.telemetry.dynamic_context_bytes).toBe(
      result.telemetry.total_bytes - result.telemetry.immutable_context_bytes,
    );
  });

  it('storia alternativa: il preset iniziale e la rottura della partita convivono, con la precedenza dichiarata', () => {
    const vars = new PromptBuilder(session.buildGameData()).buildVariables();
    const world = buildMinisterWorldContext({
      vars: {
        ...vars,
        WORLD_BEFORE_ROUND_ONE_TEXT: 'Nel 1936 Ruritania è alleata di Paese B.',
        ALL_EVENTS_WITH_CONSOLIDATION: 'Turno 3: il governo rompe l’alleanza con Paese B.',
      },
      worldName: vars.WORLD_NAME,
      seat: 'esteri',
    });
    const rendered = renderMinisterWorldContext(world, 'esteri');
    expect(rendered).toContain('alleata di Paese B');
    expect(rendered).toContain('rompe l’alleanza');
    expect(rendered).toContain('STORIA DELLA PARTITA: prevale sul passato storico');
    expect(rendered).toContain('non reintrodurre alleanze');
  });

  it('JEV spento + prompts.advisor override: il ministro riceve comunque il mondo', async () => {
    process.env.JEV_MEMORY_ENABLED = 'false';
    session.currentTurn = 5;
    session.currentDate = '1938-06-01';
    const engine = new PromptEngine(provider);
    const data = session.buildGameData();
    data.world.prompts = JSON.stringify({ advisor: 'PROMPT_OVERRIDE_ADVISOR per ${PLAYER_POLITY}.' });
    captured.length = 0;
    await engine.getAdvisor(data, `Sei il ${SEAT_LABEL.tesoro} del governo.\n\nREGOLE CHE NON PUOI VIOLARE: nessuna.`, []);
    const prompt = captured[0];
    // Il template custom NON può bypassare il contesto di mondo.
    expect(prompt).toContain('PROMPT_OVERRIDE_ADVISOR');
    expect(prompt).toContain('[IDENTITÀ DEL MONDO]');
    expect(prompt).toContain('TEST_WORLD_CONTEXT_MARKER');
    expect(prompt).toContain('[CONTESTO DEL PAESE]');
    expect(prompt).toContain('[ENFASI DELLA TUA COMPETENZA]');
  });

  it('Consigliere normale: nessun blocco ministeriale aggiunto dal nuovo contesto', async () => {
    process.env.JEV_MEMORY_ENABLED = 'false';
    const engine = new PromptEngine(provider);
    captured.length = 0;
    await engine.getAdvisor(session.buildGameData(), 'Consigliami una linea.', []);
    const prompt = captured[0];
    expect(prompt).not.toContain('[IDENTITÀ DEL MONDO]');
    expect(prompt).not.toContain('[CONTESTO DEL PAESE]');
    expect(prompt).not.toContain('[ENFASI DELLA TUA COMPETENZA]');
    // Il Consigliere conserva le sue sezioni storiche.
    expect(prompt).toContain('[Contesto di gioco]');
    expect(prompt).toContain('[Regole di simulazione]');
  });
});
