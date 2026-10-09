/** Advisor coverage requires a verified question, never prebuilt solutions. */
import { describe, expect, it, vi } from 'vitest';
import { buildVerifiedWorldSnapshot } from '../src/core/government/VerifiedWorldSnapshot';
import { buildAdvisorSituations, parseAdvisorResponse, uncoveredAdvisorSituations, withAdvisorBriefingCoverage } from '../src/core/government/AdvisorSituations';
import { buildRealityAdvisorContext, buildRealityAdvisorPrompt } from '../src/core/government/RealityAdvisor';
import { ADVISOR_BRIEFING_REPAIR_SYSTEM, buildAdvisorBriefingRepairPrompt, repairAdvisorBriefing } from '../src/core/government/AdvisorBriefingRepair';
import { ADVISOR_BRIEFING_SITUATION_PROTOCOL, COUNCIL_ANCHOR_PROTOCOL, COUNCIL_ISSUE_PROTOCOL, parseCouncilIssues } from '../src/core/government/CouncilIssue';

function world() {
  return buildVerifiedWorldSnapshot({ gameData: {
    id: 's', playerPolityId: 'UGA', playerPolityName: 'Uganda', currentDate: '2000-06-01',
    world: { regions: { home: { id: 'home', name: 'Kampala', owner: 'UGA', coastal: false, objects: [] } } },
    worldState: { accounts: { UGA: { population: 10_000_000, socialTension: 20, stability: 80, monthlyBalance: 2 } }, resources: { stock: { money: 10, food: 0.5 }, needs: { food: 1 } } },
  }, commitments: [], operationalRows: [], foodCoverageMonths: 0.5 });
}
const block = (kind: string, value: unknown) => `\`\`\`${kind}\n${JSON.stringify(value)}\n\`\`\``;
const situation = { id: 'scorte', title: 'Continuità degli approvvigionamenti', summary: 'Le scorte limitano il margine operativo.', kind: 'problem', signalKeys: ['food-coverage'] };
const question = { title: situation.title, question: 'Come garantiamo continuità degli approvvigionamenti senza compromettere la sostenibilità finanziaria?', situationId: situation.id, signalKeys: situation.signalKeys, suggestedMinisters: ['tesoro', 'interno'] };
const legacyOptions = [
  { title: 'Acquisti straordinari', content: 'Finanziamo acquisti di alimenti subordinati alla copertura del Tesoro.' },
  { title: 'Riserve nazionali', content: 'Incarichiamo i ministri di incrementare le riserve disponibili.' },
];
const briefing = (issue?: unknown, extraSituation = {}) => parseAdvisorResponse(world(), [
  block('advisor_situation', { ...situation, ...extraSituation }),
  ...(issue ? [block('council_issue', issue)] : []),
].join('\n'), 'advisor', { includeDeterministicSituations: true });

describe('Advisor questions without solutions', () => {
  it('A/B/D: accepts a situation and linked verified question without options; coverage is complete', () => {
    const result = briefing(question);
    expect(result.situations).toHaveLength(1);
    expect(result.situations[0]).not.toHaveProperty('options');
    expect(result.issues).toHaveLength(1);
    expect(result.issues[0]).not.toHaveProperty('options');
    expect(result.issues[0].situationId).toBe(situation.id);
    expect(result.issues[0].verifiedFacts.length).toBeGreaterThan(0);
    expect(result.issues[0].suggestedMinisters).toEqual(question.suggestedMinisters);
    expect(result.briefingCoverage?.complete).toBe(true);
    expect(uncoveredAdvisorSituations(result)).toEqual([]);
  });

  it.each([{}, { options: legacyOptions }])('E: a situation without a question remains uncovered, including legacy options: %j', extra => {
    const result = briefing(undefined, extra);
    expect(result.issues).toEqual([]);
    expect(result.briefingCoverage?.complete).toBe(false);
    expect(uncoveredAdvisorSituations(result).map(item => item.id)).toEqual([situation.id]);
    if ('options' in extra) expect(result.situations[0].options).toEqual(legacyOptions);
  });

  it('unverified or incorrectly linked questions cannot complete coverage', () => {
    for (const invalid of [{ ...question, signalKeys: ['invented'] }, { ...question, situationId: 'unknown' }]) {
      const result = parseAdvisorResponse(world(), block('advisor_situation', situation) + block('council_issue', invalid), 'advisor', {
        includeDeterministicSituations: true, onDiscard: () => {},
      });
      expect(result.issues).toEqual([]);
      expect(result.briefingCoverage?.complete).toBe(false);
    }
  });

  it('C: repair emits only a linked verified question and completes coverage', async () => {
    const result = briefing();
    const complete = vi.fn(async () => block('council_issue', question));
    const repaired = await repairAdvisorBriefing(world(), result, { complete });
    expect(complete).toHaveBeenCalledTimes(1);
    expect(repaired.response.issues[0]).not.toHaveProperty('options');
    expect(repaired.response.issues[0].question).toBe(question.question);
    expect(repaired.response.briefingCoverage?.complete).toBe(true);
    expect(repaired.repairedSituationIds).toEqual([situation.id]);
    expect(repaired.response.situations).toEqual(result.situations);
    expect(repaired.response.reply).toBe(result.reply);
  });

  it('repair failure remains fail-closed, even with legacy solutions on the situation', async () => {
    const result = briefing(undefined, { options: legacyOptions });
    const complete = vi.fn(async () => { throw new Error('unavailable'); });
    const repaired = await repairAdvisorBriefing(world(), result, { complete, onDiscard: () => {} });
    expect(complete).toHaveBeenCalledTimes(1);
    expect(repaired.response.issues).toEqual([]);
    expect(repaired.response.briefingCoverage?.complete).toBe(false);
  });

  it('does not repair situations already covered by questions without options', async () => {
    const result = briefing(question);
    const complete = vi.fn();
    const repaired = await repairAdvisorBriefing(world(), result, { complete });
    expect(complete).not.toHaveBeenCalled();
    expect(repaired.response).toBe(result);
  });

  it.each(['briefing', 'conversation'] as const)('F: the full %s Advisor prompt requests no solutions', mode => {
    const context = buildRealityAdvisorContext(world(), undefined, null, undefined, mode).advisorContext;
    const prompt = buildRealityAdvisorPrompt(context, 'Come procediamo?');
    expect(prompt).not.toMatch(/options|2-5 mosse|\[OPZIONI\]|ordine PRONTO|prudente\/diplomatica/i);
    expect(prompt).toContain('DEVI emettere');
    expect(prompt).toContain('suggestedMinisters');
    expect(prompt).toContain('NON già risolta');
    expect(prompt).toContain('Le soluzioni devono emergere SOLO nel Consiglio');
    expect(prompt).not.toContain(COUNCIL_ISSUE_PROTOCOL);
    if (mode === 'briefing') expect(prompt).toContain(ADVISOR_BRIEFING_SITUATION_PROTOCOL);
    expect(prompt).toContain(COUNCIL_ANCHOR_PROTOCOL);
  });

  it('the minister protocol remains unchanged and separate from Advisor generation', () => {
    const prompt = buildRealityAdvisorPrompt(buildRealityAdvisorContext(world()).advisorContext, 'Parliamo delle scorte', [], undefined, 'minister');
    expect(prompt).toContain(COUNCIL_ISSUE_PROTOCOL);
    expect(COUNCIL_ISSUE_PROTOCOL).toContain('"options"');
    expect(prompt).not.toContain(COUNCIL_ANCHOR_PROTOCOL);
  });

  it('G: neither repair system nor payload requests or copies solutions', () => {
    const result = briefing(undefined, { options: legacyOptions });
    const prompt = buildAdvisorBriefingRepairPrompt(world(), result.situations);
    expect(ADVISOR_BRIEFING_REPAIR_SYSTEM + prompt).not.toMatch(/options|2-5|\[OPZIONI\]|ordine PRONTO/i);
    for (const key of ['situationId', 'signalKeys', 'anchorKeys', 'suggestedMinisters']) expect(ADVISOR_BRIEFING_REPAIR_SYSTEM).toContain(key);
    expect(prompt).not.toContain(legacyOptions[0].content);
    const context = buildRealityAdvisorContext(world()).advisorContext;
    const legacyIssue = parseCouncilIssues(world(), block('council_issue', { ...question, options: legacyOptions })).issues[0];
    for (const focus of [{ focusSituation: result.situations[0] }, { focusIssue: legacyIssue }]) {
      const focusedPrompt = buildAdvisorBriefingRepairPrompt(world(), result.situations, {
        context: { ...context, ...focus }, message: 'Approfondisci le scorte', missingOpportunities: 1, existingIssues: [legacyIssue],
      });
      expect(focusedPrompt).not.toContain('options');
      expect(focusedPrompt).not.toContain(legacyOptions[0].content);
      expect(JSON.parse(focusedPrompt).request.focus.id).toBeDefined();
    }
  });

  it('H: the legacy CouncilIssue parser still accepts options', () => {
    const parsed = parseCouncilIssues(world(), block('council_issue', { ...question, options: legacyOptions }));
    expect(parsed.issues[0].options).toEqual(legacyOptions);
  });

  it('deterministic fallback only measures missing coverage, without inventing questions', () => {
    const result = buildRealityAdvisorContext(world(), undefined, null, undefined, 'briefing');
    expect(result.situations).toEqual(buildAdvisorSituations(world()));
    expect(result.issues).toEqual([]);
    expect(withAdvisorBriefingCoverage(world(), result).briefingCoverage?.complete).toBe(false);
  });
});
