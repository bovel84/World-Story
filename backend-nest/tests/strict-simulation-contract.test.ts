import { describe, expect, it, vi } from 'vitest';

vi.mock('../src/repositories', () => ({
  gameRepository: {
    getEconomyMode: vi.fn(() => 'strict'),
  },
}));

import {
  GameController,
  STRICT_SIMULATION_CONTRACT,
  withStrictSimulationContract,
} from '../src/agents';

describe('strict simulation prompt contract', () => {
  it('adds the material-authority contract without mutating the source object', () => {
    const source = { id: 'g1', simulationRules: 'REGOLA PRESET' };
    const enriched = withStrictSimulationContract(source);

    expect(enriched).not.toBe(source);
    expect(source.simulationRules).toBe('REGOLA PRESET');
    expect(enriched.simulationRules).toContain('REGOLA PRESET');
    expect(enriched.simulationRules).toContain(STRICT_SIMULATION_CONTRACT);
    expect(enriched.simulationRules).toContain('`mapChanges` deve restare sempre []');
    expect(enriched.simulationRules).toContain('`partial` o `rejected`');
  });

  it('is idempotent', () => {
    const once = withStrictSimulationContract({ id: 'g1', simulationRules: 'BASE' });
    const twice = withStrictSimulationContract(once);

    expect(twice).toBe(once);
    expect(twice.simulationRules.split('[CONTRATTO STRICT — AUTORITÀ MATERIALE SERVER').length - 1).toBe(1);
  });

  it('passes the strict contract only to the simulation step', async () => {
    const controller = new GameController({} as any);
    let converterGameData: any;
    let simulationGameData: any;

    const convertActionsBatch = vi.fn(async (
      gameData: any,
      actions: Array<{ actionId: string; text: string }>,
    ) => {
      converterGameData = gameData;
      return actions;
    });
    const runSimulation = vi.fn(async (gameData: any) => {
      simulationGameData = gameData;
      return {
        narration: 'ok',
        events: [],
        worldChanges: {},
        actionOutcomes: [],
        voided: [],
        startChat: [],
        relationshipChanges: [],
        effects: [],
      };
    });

    (controller as any).promptEngine = { convertActionsBatch, runSimulation };

    await controller.processTurnWithPrompts(
      { id: 'strict-game', simulationRules: 'BASE' },
      [{ actionId: 'a1', text: 'Costruisci una fabbrica' }],
      30,
    );

    expect(converterGameData.simulationRules).toBe('BASE');
    expect(simulationGameData.simulationRules).toContain(STRICT_SIMULATION_CONTRACT);
  });
});
