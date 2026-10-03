import { describe, expect, it } from 'vitest';
import {
  buildMinisterDialogueBrief, composeMinisterDialoguePrompt, currentMinisterDialogueRequest,
  dialogueHistory, dialogueResponseIsNatural, fallbackMinisterDialogue,
  normalizeMinisterCouncil, withMinisterDialogueRequest,
} from '../src/core/government/MinisterDialogue';
import { CABINET_SEATS } from '../src/core/government/Cabinet';
import { personaFor } from '../src/core/government/MinisterPersona';
import type { MinisterWorldContext } from '../src/prompts/national-context';

const council = {
  sessionId: 'shared-1', topic: 'Proteggere i porti', initiatorMinister: 'esteri',
  participants: ['esteri', 'tesoro', 'guerra'], phase: 'discussion',
  respondingTo: 'Guerra: senza scorte non sostengo la proposta.',
};
const world: MinisterWorldContext = {
  worldName: 'Mondo del consiglio', country: 'Paese', currentDate: '1951-01-01',
  scenarioPremise: 'WORLD_AUTHORITY', simulationRules: '', nationalContext: '', recentHistory: '', activeCommitments: '', ongoingProcesses: '',
};
const history = [
  { role: 'assistant' as const, content: 'Esteri: voglio negoziare prima di mobilitare.' },
  { role: 'assistant' as const, content: council.respondingTo },
];
const decision = { objective: 'Proteggere i porti', measures: [{ label: 'Negoziare', kind: 'priority', source: 'president', status: 'accepted' }] };
const brief = (message = 'Rispondi ai colleghi.') => buildMinisterDialogueBrief({
  seat: 'tesoro', worldContext: world, currentIssues: [], currentDecision: decision,
  presidentMessage: message, recentHistory: history,
});

describe('minister council: normalized request contract', () => {
  it('trims bounded strings and strips unknown client fields without changing participant order', () => {
    expect(normalizeMinisterCouncil({ ...council, sessionId: ' shared-1 ', topic: ' Proteggere i porti ', respondingTo: ` ${council.respondingTo} `, instructions: 'CLIENT_INSTRUCTIONS' }, 'tesoro')).toEqual(council);
  });

  it.each([
    null, [], 'council', {},
    { ...council, sessionId: '' }, { ...council, sessionId: 'x'.repeat(129) },
    { ...council, topic: ' ' }, { ...council, topic: 'x'.repeat(601) },
    { ...council, respondingTo: '' }, { ...council, respondingTo: 'x'.repeat(2001) },
    { ...council, initiatorMinister: 'unknown' }, { ...council, phase: 'signed' },
    { ...council, participants: [] }, { ...council, participants: ['esteri', 'unknown', 'tesoro'] },
    { ...council, participants: ['esteri', 'tesoro', 'tesoro'] },
    { ...council, participants: ['esteri', 'guerra'] },
    { ...council, participants: [...CABINET_SEATS, 'tesoro'] },
  ])('rejects malformed or inconsistent council context: %j', raw => {
    expect(normalizeMinisterCouncil(raw, 'tesoro')).toBeUndefined();
  });

  it('allows all known seats and optional respondingTo, but never auto-admits the requesting minister', () => {
    const { respondingTo: _, ...withoutResponse } = council;
    expect(normalizeMinisterCouncil({ ...withoutResponse, participants: [...CABINET_SEATS], phase: 'drafting' }, 'sanita')).toMatchObject({ phase: 'drafting', participants: [...CABINET_SEATS] });
    expect(normalizeMinisterCouncil(council, 'lavori')).toBeUndefined();
  });

  it('rejects invalid supplied context before running the request; omission retains the four-argument API', () => {
    let ran = false;
    expect(() => withMinisterDialogueRequest('game', 'tesoro', decision, () => { ran = true; }, { ...council, phase: 'adopted' })).toThrow(/consiglio/i);
    expect(ran).toBe(false);
    expect(withMinisterDialogueRequest('game', 'tesoro', decision, () => currentMinisterDialogueRequest('game', 'tesoro')?.currentDecision)).toEqual(decision);
  });
});

describe('minister council: request isolation and collaborative prompt', () => {
  it('isolates concurrent councils even on the same game/seat and restores nested legacy requests', async () => {
    await Promise.all(['shared-a', 'shared-b'].map(sessionId => withMinisterDialogueRequest('game', 'tesoro', decision, async () => {
      await Promise.resolve();
      expect(currentMinisterDialogueRequest('game', 'tesoro')?.council?.sessionId).toBe(sessionId);
      expect(currentMinisterDialogueRequest('other-game', 'tesoro')).toBeUndefined();
      expect(currentMinisterDialogueRequest('game', 'guerra')).toBeUndefined();
      expect(brief().council?.sessionId).toBe(sessionId);
      expect(buildMinisterDialogueBrief({ ...brief(), seat: 'guerra' }).council).toBeUndefined();
      withMinisterDialogueRequest('game', 'tesoro', undefined, () => {
        expect(brief().council).toBeUndefined();
      });
      expect(brief().council?.sessionId).toBe(sessionId);
    }, { ...council, sessionId })));
    expect(currentMinisterDialogueRequest('game', 'tesoro')).toBeUndefined();
    expect(brief().council).toBeUndefined();
  });

  it('preserves personality, authoritative facts, currentDecision and named colleagues, not all own speech', () => {
    withMinisterDialogueRequest('game', 'tesoro', decision, () => {
      const dialogue = brief();
      const prompt = composeMinisterDialoguePrompt(dialogue);
      expect(dialogue.council).toEqual(council);
      expect(dialogue.currentDecision).toEqual(decision);
      expect(prompt).toContain('WORLD_AUTHORITY');
      expect(prompt).toContain(personaFor('tesoro').priorities);
      expect(prompt).toContain(JSON.stringify(council));
      expect(prompt).toContain(JSON.stringify(dialogue.currentDecision));
      for (const contribution of history) expect(prompt).toContain(contribution.content);
      expect(prompt).toMatch(/unica sessione condivisa/i);
      expect(prompt).toMatch(/interventi.*attribuiti|attribuiti.*interventi/i);
      expect(prompt).toMatch(/non.*(?:tutti|ogni).*tu[oa]/i);
      expect(prompt).toMatch(/rispondi.*interventi reali/i);
      expect(prompt).toMatch(/(?:rivedi|rivedere).*posizione/i);
      expect(prompt).toMatch(/non inventare.*consenso/i);
      expect(prompt).toMatch(/non.*(?:ammettere|aggiungere).*automaticamente/i);
      expect(prompt).toContain('```consiglio');
      expect(prompt).toContain('needs_input_from');
      expect(prompt).toContain('"status":"conditional"');
      expect(prompt).toContain('support, conditional, oppose, pending');
      expect(prompt).toMatch(/valutazioni.*discussione.*non.*fatti verificati/i);
      expect(prompt).toMatch(/accordi.*non.*esecuzione/i);
      expect(prompt.match(/\[RECENT CONVERSATION\]/g)).toHaveLength(1);
      expect(prompt.match(/\[DIALOGUE STYLE\]/g)).toHaveLength(1);
      expect(prompt.match(/\[PROTOCOL\]/g)).toHaveLength(1);
    }, council);
    expect(dialogueHistory(history)).toEqual(history);
  });

  it('adds council instructions when JEV already owns world/history without duplicating history', () => {
    withMinisterDialogueRequest('game', 'tesoro', undefined, () => {
      const prompt = composeMinisterDialoguePrompt(brief(), { base: '[WORLD]\nWORLD_AUTHORITY\n[RECENT CONVERSATION]\nEsteri: intervento\n[CURRENT VERIFIED STATE]\nFACT_AUTHORITY', hasHistory: true, hasWorld: true });
      expect(prompt).toContain('FACT_AUTHORITY');
      expect(prompt).toContain('```consiglio');
      expect(prompt.match(/\[RECENT CONVERSATION\]/g)).toHaveLength(1);
    }, council);
  });

  it('drafting proposes clauses responding to colleagues, never signs or declares adoption', () => {
    withMinisterDialogueRequest('game', 'tesoro', decision, () => {
      const dialogue = brief('Va bene.');
      expect(composeMinisterDialoguePrompt(dialogue)).toMatch(/clausole.*colleghi/i);
      expect(composeMinisterDialoguePrompt(dialogue)).toMatch(/non firmare.*non.*adottat/i);
      const fallback = fallbackMinisterDialogue(dialogue);
      expect(fallback).not.toContain('```decision');
      expect(fallback).toMatch(/bozza|clausol/i);
      expect(fallback).not.toMatch(/segno la scelta|accordo raggiunto|adottato/);
    }, { ...council, phase: 'drafting' });
  });

  it('does not count a useful council assessment as narrative prose or a report', () => {
    withMinisterDialogueRequest('game', 'tesoro', undefined, () => {
      const response = `Esteri, condivido la prudenza, ma prima voglio la verifica delle scorte della Guerra.\n\`\`\`consiglio\n${JSON.stringify({ needs_input_from: [{ minister: 'guerra', question: 'Quali scorte sono verificate?' }], position: { status: 'conditional', reason: 'Manca la verifica.' }, agreements: Array(30).fill('Una valutazione di discussione, non un fatto verificato.'), disagreements: [] })}\n\`\`\``;
      expect(dialogueResponseIsNatural(response, brief())).toBe(true);
      expect(fallbackMinisterDialogue(brief('Va bene.'))).not.toContain('```decision');
    }, council);
  });

  it('omitting council leaves legacy prompt and confirmation semantics unchanged', () => {
    const legacyPrompt = composeMinisterDialoguePrompt(brief('Va bene.'));
    const legacyFallback = fallbackMinisterDialogue(brief('Va bene.'));
    withMinisterDialogueRequest('game', 'tesoro', decision, () => {
      expect(composeMinisterDialoguePrompt(brief('Va bene.'))).toBe(legacyPrompt);
      expect(fallbackMinisterDialogue(brief('Va bene.'))).toBe(legacyFallback);
      expect(legacyPrompt).not.toContain('```consiglio');
      expect(legacyFallback).toContain('```decision');
    });
  });
});
