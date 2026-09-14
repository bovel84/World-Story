import { describe, expect, it } from 'vitest';
import { buildNarrationPrompt, parseNarrationResponse } from '../src/prompts/narration';
import { buildImmersionContract } from '../src/prompts/immersion';
import { constructionProgressPatch } from '../src/utils/construction-progress';
import { parseSimulationResponse } from '../src/prompts/simulation';
import { validateStrictMapChanges } from '../src/core/simulation/EffectValidator';

describe('Narrative continuity without extra inference', () => {
  it('preserves paragraphs beyond the former 500-character cutoff', () => {
    const story = `${'Il governo conferma l’apertura dei lavori. '.repeat(15)}\n\nLe forniture restano in attesa.`;
    expect(story.length).toBeGreaterThan(500);
    expect(parseNarrationResponse(story)).toBe(story);
  });
  it('caps overlong output at a sentence boundary and removes markdown wrappers', () => {
    const sentence = 'Le opere proseguono nel territorio. ';
    const parsed = parseNarrationResponse(`\`\`\`markdown\n# Cronaca\n${sentence.repeat(150)}\n\`\`\``);
    expect(parsed.length).toBeLessThanOrEqual(2400);
    expect(parsed.endsWith('.')).toBe(true);
    expect(parsed).not.toContain('```');
    expect(parsed).not.toContain('# Cronaca');
    expect(parseNarrationResponse('')).toBe('');
    expect(parseNarrationResponse('a'.repeat(4000)).length).toBeLessThanOrEqual(2400);
  });
  it('requires factual atmosphere, not invented scenes or automatic project completion', () => {
    const prompt = buildNarrationPrompt({ facts: [], jumpDays: 5, currentDate: '1951-01-01', targetDate: '1951-01-06', playerPolity: 'Italia', language: 'italian' });
    expect(prompt).toContain('1-2 frasi');
    expect(prompt).toContain('il solo canone');
    expect(prompt).toContain("non è un'opera già operativa");
    expect(buildImmersionContract()).toContain('update_construction');
    expect(buildImmersionContract()).toContain('non prova il completamento');
    expect(buildImmersionContract()).toContain('non ripetere l\'ordine');
  });
});

describe('Construction report contract', () => {
  it('accepts only bounded qualitative fields and real calendar dates', () => {
    expect(constructionProgressPatch({ phase: 'foundations', status: 'paused', blocker: ' Acciaio in ritardo ', nextStep: 'x'.repeat(1000), expectedDate: '1952-02-29', progress: 90, owner: 'NPC', plannedType: 'army' })).toEqual({
      phase: 'foundations', status: 'paused', blocker: 'Acciaio in ritardo', nextStep: 'x'.repeat(280), expectedDate: '1952-02-29',
    });
    expect(constructionProgressPatch({ expectedDate: '1951-02-29', phase: 'completed', status: 'operational' })).toEqual({});
    expect(constructionProgressPatch({ expectedDate: null, blocker: '' })).toEqual({ expectedDate: null, blocker: '' });
    for (const bad of [null, 0, [], 'text']) expect(constructionProgressPatch(bad)).toEqual({});
  });
  it('parses the new update but does not bypass strict economic authority', () => {
    const change = { type: 'update_construction', regionName: 'Lazio', feature: { id: 'site-1', name: 'Porto', type: 'port', metadata: { phase: 'testing' } } };
    const parsed = parseSimulationResponse(JSON.stringify({ events: [{ headline: 'Il porto avvia i collaudi', description: 'Le installazioni completate consentono le prove.', date: '1951-01-02', mapChanges: [change] }] }));
    expect(parsed.events[0].mapChanges[0]).toMatchObject(change);
    expect(() => validateStrictMapChanges([change])).toThrow();
  });
});
