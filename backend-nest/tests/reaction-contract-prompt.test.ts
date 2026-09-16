/**
 * Contratto prompt delle reazioni — test di copertura del testo.
 * Verifica che il contratto `actorId`/`optionId` sia presente in ENTRAMBI i
 * protocolli (compatto e standard/incrementale) e che la regola di riselezione
 * degli attori sia stata rimossa perché ora è autoritativa nel CONTESTO DI
 * REAZIONE (una sola fonte, niente istruzioni contraddittorie).
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'fs';
import { buildConstrainedSimulationPrompt, buildSimulationPrompt, buildIncrementalOutputInstruction } from '../src/prompts/simulation/prompt';
import { buildCausalityGuard, buildReactionContractGuard, buildSimulationNarrativeContract } from '../src/prompts/simulation/guards';
import type { PromptVariables } from '../src/prompts/types';

function vars(overrides: Partial<PromptVariables> = {}): PromptVariables {
  return {
    PLAYER_POLITY: 'Italia',
    ORIGIN_ROUND_DATE: '1951-01-01',
    TARGET_ROUND_DATE: '1951-03-01',
    PLAYER_ACTIONS_THIS_ROUND: '[a1] Invia ultimatum alla Germania',
    REACTION_CONTEXT: 'ATTORI RILEVANTI E OPZIONI AMMESSE:\n[FRA] Francia\n  - FRA:condition Accetta con condizioni',
    STRATEGIC_STATE: 'stato',
    NPC_STRATEGIC_PROFILES: 'profili',
    ONGOING_PROCESSES: '',
    ALL_EVENTS_WITH_CONSOLIDATION: '',
    CHATS_NON_CONSOLIDATED_ROUNDS: '',
    GRAND_MAP_DESCRIPTION_NO_CITY: '',
    WORLD_BEFORE_ROUND_ONE_TEXT: '',
    HISTORICAL_PRESET_SIMULATION_RULES: '',
    DIFFICULTY_DESCRIPTION_JUMP_FORWARD: '',
    WORLD_NAME: 'Mondo',
    ...overrides,
  } as PromptVariables;
}

function standardPrompt(v: PromptVariables): string {
  return buildSimulationPrompt(v) + buildIncrementalOutputInstruction(v, 3);
}

describe('contratto reazioni nel prompt', () => {
  it('la regola autoritativa è unica e definita una sola volta', () => {
    const guard = buildReactionContractGuard();
    expect(guard).toContain('CONTRATTO DELLE REAZIONI');
    expect(guard).toContain('actorId');
    expect(guard).toContain('optionId');
    expect(guard.match(/CONTRATTO DELLE REAZIONI/g)).toHaveLength(1);
  });

  it('il protocollo COMPATTO chiede actorId e optionId e contiene la regola autoritativa', () => {
    const prompt = buildConstrainedSimulationPrompt(vars(), {});
    expect(prompt).toContain('"actorId"');
    expect(prompt).toContain('"optionId"');
    expect(prompt.match(/CONTRATTO DELLE REAZIONI/g)).toHaveLength(1);
  });

  it('il protocollo STANDARD/INCREMENTALE chiede actorId e optionId e contiene la regola autoritativa', () => {
    const prompt = standardPrompt(vars());
    expect(prompt).toContain('"actorId"');
    expect(prompt).toContain('"optionId"');
    expect(prompt.match(/CONTRATTO DELLE REAZIONI/g)).toHaveLength(1);
  });

  it('anche il percorso con prompt override del preset dichiara il contratto una sola volta', () => {
    // `buildSimulationPrompt` da solo non contiene il contratto (vive nella
    // sezione di protocollo dell'output): ogni prompt realmente assemblato —
    // override del preset compreso — lo riceve da
    // `buildIncrementalOutputInstruction`.
    const v = vars();
    const overridePath = 'ISTRUZIONI DEL PRESET'
      + buildCausalityGuard(v)
      + buildSimulationNarrativeContract(v, true)
      + buildIncrementalOutputInstruction(v, 3, true);
    expect(overridePath.match(/CONTRATTO DELLE REAZIONI/g)).toHaveLength(1);
    expect(overridePath).toContain('"actorId"');
    expect(overridePath).toContain('"optionId"');
    // E il prompt standard non duplica la regola quando è assemblato davvero.
    expect(standardPrompt(v).match(/CONTRATTO DELLE REAZIONI/g)).toHaveLength(1);
  });

  it('le vecchie regole di riselezione degli attori sono state rimosse', () => {
    for (const prompt of [buildConstrainedSimulationPrompt(vars(), {}), standardPrompt(vars())]) {
      expect(prompt).not.toContain('quella politia deve comparire');
      expect(prompt).not.toContain('Teatro della crisi');
      expect(prompt).not.toContain('non aggiungere potenze lontane senza interesse documentato');
      // Il testo resta coerente: la selezione la fa il motore.
      expect(prompt).toContain('CONTESTO DI REAZIONE');
    }
  });

  it('l’esempio JSON resta un ordine di campi valido per il parser', () => {
    const guard = buildReactionContractGuard();
    // La regola autoritativa non deve contenere un secondo esempio JSON
    // autorevole: l'unico esempio resta quello del protocollo evento.
    expect(guard).not.toContain('"polityName"');
    // L'ID dell'attore va copiato, non il nome della nazione.
    expect(guard).toContain('non sostituire l\'ID con il nome della nazione');
  });
});

/**
 * L'unico repair di formato deve poter *omettere* una reaction il cui attore non
 * è ammesso: rimapparla su un altro attore sarebbe indovinare una decisione, e
 * senza questa istruzione un modello reale tenderebbe a conservarla, facendo
 * fallire il turno (fail-closed) invece di correggerlo.
 */
describe('repair di formato delle reactions (source contract)', () => {
  const source = readFileSync(new URL('../src/prompt-builder.ts', import.meta.url), 'utf8');

  it('il repair può omettere le reactions fuori contesto e non rimapparle', () => {
    expect(source).toContain('OMETTILA');
    expect(source).toContain('non rimapparla su un altro attore');
    expect(source).toContain('non superare il numero massimo di reactions');
  });

  it('il repair conserva la cronaca: nessun nuovo evento, nessuna rigenerazione', () => {
    expect(source).toContain('NON modificare headline, date, description, mapChanges');
  });

  it('esiste UNA sola chiamata ausiliaria di repair nel percorso di simulazione', () => {
    expect(source.match(/private async repairReactionFormat/g)).toHaveLength(1);
    expect(source.match(/repairReactionDecisions\(/g)).toHaveLength(1);
  });
});
