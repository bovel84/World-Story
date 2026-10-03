/**
 * WS-GAME-OPENING-IMMERSION — OpeningContext, narrativa semantica e validazione.
 */
import { describe, expect, it } from 'vitest';
import {
  buildOpeningContext,
  buildDeterministicWorldNarrative,
  buildDeterministicOpeningResponse,
  composeOpeningNarrativePrompt,
  parseOpeningNarrativeJson,
  openingCouncilLine,
  validateTextAgainstContext,
  validateOpeningWorldNarrative,
} from '../src/core/government/OpeningNarrative';
import { personaFor } from '../src/core/government/MinisterPersona';
import type { CabinetAddress } from '../src/core/government/Cabinet';

function address(seat: CabinetAddress['seat'], urgency: 'critica' | 'urgente' | 'ordinaria', need: string): CabinetAddress {
  return {
    seat,
    label: `Ministro ${seat}`,
    reads: 'una competenza',
    items: [{ voiceId: `v-${seat}`, need, because: 'perché', urgency, figures: [], paths: [] }],
    opening: 'apertura',
  } as CabinetAddress;
}

const baseInput = {
  worldName: 'TEST_WORLD',
  date: '2000-01-01',
  premise: 'TEST_WORLD_PREMISE: la Guerra Fredda è finita e il nuovo ordine è instabile.\n\nL’Europa prepara l’allargamento verso est.',
  rules: 'Le infrastrutture richiedono tempo. La logistica conta.',
  nationName: 'TEST_NATION',
  polityId: 'TST',
  verifiedSituation: ['Il margine fiscale è ristretto', 'La ricostruzione non è terminata'],
  worldFacts: [{ id: 'TEST_WORLD_FACT', label: 'Un vicino cambia schieramento', severity: 'warning' }],
  addresses: [
    address('lavori', 'ordinaria', 'Ricostruire le infrastrutture'),
    address('tesoro', 'critica', 'Coprire la cassa'),
    address('esteri', 'ordinaria', 'Coltivare le relazioni'),
    address('guerra', 'ordinaria', 'Difendere i confini'),
  ],
};

describe('WS-GAME-OPENING-IMMERSION — OpeningContext', () => {
  it('raccoglie mondo, paese, priorità e consiglio dai soli dati esistenti', () => {
    const context = buildOpeningContext(baseInput);
    expect(context.world.name).toBe('TEST_WORLD');
    expect(context.world.premise).toContain('TEST_WORLD_PREMISE');
    expect(context.world.rules).toContain('infrastrutture');
    expect(context.nation.name).toBe('TEST_NATION');
    expect(context.worldFacts[0].id).toBe('TEST_WORLD_FACT');
    expect(context.priorities.length).toBeGreaterThan(0);
    expect(context.council).toHaveLength(3); // max 3
    expect(context.council[0].seat).toBe('tesoro'); // urgenza critica in testa
  });

  it('il prologo deterministico è semantico, non paragraphs[]', () => {
    const context = buildOpeningContext(baseInput);
    const narrative = buildDeterministicWorldNarrative(context);
    expect(narrative.worldOrder).toContain('TEST_WORLD_PREMISE');
    expect(narrative.regionalSituation).toContain('Europa');
    expect(narrative.stakesForNation).toContain('TEST_NATION');
    expect((narrative as Record<string, unknown>).paragraphs).toBeUndefined();
    const response = buildDeterministicOpeningResponse(context);
    expect(response.deterministic).toBe(true);
    expect(response.world.narrative.worldOrder).toBe(narrative.worldOrder);
  });

  it('il consiglio usa persona + verified need e resta seat→seat', () => {
    const context = buildOpeningContext(baseInput);
    for (const line of context.council) {
      const signature = personaFor(line.seat).signature.replace(/^[«"]\s*/, '').replace(/\s*[»"]$/, '').replace(/[.]$/, '');
      expect(line.line).toContain(signature);
      expect(/\d/.test(line.line)).toBe(false);
    }
    expect(context.council.map(c => c.seat)).toEqual(['tesoro', 'lavori', 'esteri']);
  });
});

describe('WS-GAME-OPENING-IMMERSION — validazione del renderer', () => {
  it('§32: rifiuta una cifra non presente nell’input (999 miliardi)', () => {
    const context = buildOpeningContext(baseInput);
    const bad = { worldOrder: 'Servono 999 miliardi.', stakesForNation: 'Per TEST_NATION.' };
    expect(validateOpeningWorldNarrative(bad, context).ok).toBe(false);
    // Una cifra che è nell'input passa.
    const good = { worldOrder: 'La premessa TEST_WORLD_PREMISE.', stakesForNation: 'Per TEST_NATION.' };
    expect(validateTextAgainstContext(good.worldOrder, context).ok).toBe(true);
  });

  it('§33: rifiuta un proper noun nuovo non presente nel contesto', () => {
    const context = buildOpeningContext({
      ...baseInput,
      premise: 'Il mondo è instabile.', // nessuna menzione di C
    });
    const bad = 'Il paese C minaccia la frontiera.';
    const result = validateTextAgainstContext(bad, context);
    expect(result.ok).toBe(false);
    expect(result.reason).toContain('nome non verificato');
  });

  it('rifiuta le parole di metadato', () => {
    const context = buildOpeningContext(baseInput);
    expect(validateTextAgainstContext('Come stabilito nel preset, ...', context).ok).toBe(false);
  });

  it('il prompt del renderer porta davvero i fatti verificati', () => {
    const context = buildOpeningContext(baseInput);
    const prompt = composeOpeningNarrativePrompt(context);
    expect(prompt).toContain('TEST_WORLD_PREMISE');
    expect(prompt).toContain('TEST_NATION');
    expect(prompt).toContain('Un vicino cambia schieramento');
    expect(prompt).toContain('infrastrutture');
  });

  it('parse: JSON valido → narrativa; non-JSON → null', () => {
    const parsed = parseOpeningNarrativeJson('```json\n{"worldOrder":"x","stakesForNation":"y","council":[{"seat":"tesoro","line":"z"}]}\n```');
    expect(parsed?.world.worldOrder).toBe('x');
    expect(parsed?.council[0].seat).toBe('tesoro');
    expect(parseOpeningNarrativeJson('non json')).toBeNull();
  });
});
