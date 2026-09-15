import { describe, expect, it } from 'vitest';
import { governmentSnapshot } from '../src/core/simulation/GovernmentFactions';
import { WorldStateEngine } from '../src/core/simulation/WorldStateEngine';
import {
  buildGovernmentNarrativeGuard,
  buildGovernmentStateBlock,
  buildGovernmentVoicePrompt,
  parseGovernmentVoices,
} from '../src/prompts/government';
import { buildSimulationPrompt, buildSimulationNarrativeContract } from '../src/prompts/simulation';
import { PromptBuilder } from '../src/prompt-builder';
import type { PromptVariables } from '../src/prompts/types';

const snapshotFor = (objects: Array<{ type: string; level?: number }> = []) => governmentSnapshot(
  WorldStateEngine.accounts([
    { id: 'p1', owner: 'ITA', population: 60_000_000, gdp: 2000, militaryPower: 40, objects },
  ]).ITA,
);

const gameWith = (snapshot: ReturnType<typeof snapshotFor>, voices?: { council: string; voices: Record<string, string> }) => ({
  id: 'g1',
  currentDate: '1952-06-15',
  currentTurn: 7,
  world: {
    name: 'Test World',
    basePrompt: 'LORE_MARKER',
    startDate: '1951-01-01',
    regions: {
      w1_ITA: { id: 'w1_ITA', name: 'Italia', owner: 'ITA', color: '#00FF00', objects: [] },
    },
  },
  players: [{ id: 'p1', name: 'Player', regionId: 'w1_ITA', polityId: 'ITA' }],
  playerPolityId: 'ITA',
  actions: [],
  results: [],
  worldState: { government: snapshot, governmentVoices: voices },
} as any);

describe('anime del governo — prompt e voci', () => {
  it('il blocco di stato elenca fazioni, richieste e voci senza inventare nulla', () => {
    const snapshot = snapshotFor([{ type: 'army', level: 3 }]);
    const block = buildGovernmentStateBlock(snapshot, {
      council: 'Il consiglio è diviso sulla difesa.',
      voices: { militari: 'Chiediamo più mezzi per difendere i confini.' },
    });
    expect(block).toContain('Forze armate');
    expect(block).toContain('Coesione del governo');
    expect(block).toContain('Debito pubblico');
    expect(block).toContain('scadenze da rifinanziare');
    expect(block).toContain('Chiediamo più mezzi per difendere i confini.');
    expect(block).toContain('Il consiglio è diviso sulla difesa.');
    // Nessuna fazione fuori dal roster del motore.
    const unknown = buildGovernmentStateBlock(null);
    expect(unknown).toContain('Nessuna anima del governo');
  });

  it('la regola narrativa impone prosa scorrevole e vieta i bollettini', () => {
    const guard = buildGovernmentNarrativeGuard({ PLAYER_POLITY: 'Italia' } as PromptVariables);
    expect(guard).toContain('PROSA SCORREVOLE');
    expect(guard).toContain('VIETATO');
    expect(guard).toContain('Italia');
  });

  it('il prompt delle voci chiude il roster: solo le fazioni del motore', () => {
    const snapshot = snapshotFor();
    const prompt = buildGovernmentVoicePrompt({ PLAYER_POLITY: 'Italia', ORIGIN_ROUND_DATE: '1952-06-15' } as PromptVariables, snapshot);
    for (const faction of snapshot.factions) {
      expect(prompt).toContain(faction.id);
      expect(prompt).toContain(faction.demand.title);
    }
    expect(prompt).toContain('"council"');
    expect(prompt).toContain('"voices"');
  });

  it('il parser tiene solo le voci delle fazioni note e scarta il resto', () => {
    const parsed = parseGovernmentVoices(JSON.stringify({
      council: 'Consiglio diviso.',
      voices: [
        { id: 'militari', petition: 'Chiediamo più mezzi per difendere i confini.' },
        { id: 'inventata', petition: 'Vogliamo cose nuove.' },
        { id: 'lavoratori', petition: 'breve' },
      ],
    }), ['militari', 'lavoratori']);
    expect(parsed?.voices).toEqual({ militari: 'Chiediamo più mezzi per difendere i confini.' });
    expect(parsed?.council).toBe('Consiglio diviso.');
    expect(parseGovernmentVoices('non json', ['militari'])).toBeNull();
    expect(parseGovernmentVoices('{}', ['militari'])).toBeNull();
  });

  it('senza snapshot delle anime il prompt resta valido', () => {
    const builder = new PromptBuilder({
      id: 'g1', currentDate: '1952-06-15', currentTurn: 7,
      world: { name: 'W', basePrompt: 'L', startDate: '1951-01-01', regions: {} },
      players: [{ id: 'p1', name: 'P', regionId: 'r1', polityId: 'ITA' }],
      playerPolityId: 'ITA', actions: [], results: [],
    } as any);
    const vars = builder.buildVariables();
    expect(vars.GOVERNMENT_STATE).toContain('Nessuna anima del governo');
    expect(buildSimulationPrompt(vars)).toContain('ANIME DEL GOVERNO E NARRAZIONE');
  });

  it('il prompt di simulazione riceve le anime e la regola di prosa', () => {
    const snapshot = snapshotFor([{ type: 'factory', level: 3 }, { type: 'university', level: 2 }]);
    const vars = new PromptBuilder(gameWith(snapshot, {
      council: 'Il consiglio si stringe attorno al bilancio.',
      voices: { industriali: 'Le imprese non possono attendere.' },
    })).buildVariables();
    expect(vars.GOVERNMENT_STATE).toContain('Industria e padronato');
    expect(vars.GOVERNMENT_STATE).toContain('Le imprese non possono attendere.');
    const prompt = buildSimulationPrompt(vars);
    expect(prompt).toContain('ANIME DEL GOVERNO E NARRAZIONE');
    expect(prompt).toContain('PROSA SCORREVOLE');
    expect(prompt).toContain('Industria e padronato');
    // Anche un preset che sovrascrive il template riceve le anime e la regola.
    const contract = buildSimulationNarrativeContract(vars, true);
    expect(contract).toContain('ANIME DEL GOVERNO E NARRAZIONE');
    expect(contract).toContain('Industria e padronato');
    expect(contract).toContain('PROSA SCORREVOLE');
  });
});
