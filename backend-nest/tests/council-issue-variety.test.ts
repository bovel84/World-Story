import { describe, expect, it } from 'vitest';
import { ADVISOR_BRIEFING_SITUATION_PROTOCOL, COUNCIL_ISSUE_PROTOCOL, MAX_COUNCIL_ISSUES, SITUATION_BASE_PROTOCOL, parseCouncilIssues, resolveCouncilIssue, serializeCouncilIssues } from '../src/core/government/CouncilIssue';
import { buildVerifiedWorldSnapshot } from '../src/core/government/VerifiedWorldSnapshot';

const snapshot = () => buildVerifiedWorldSnapshot({ gameData: {
  id: 'council-variety', playerPolityId: 'TEST', currentDate: '2000-01-01',
  world: { regions: { home: { id: 'home', name: 'Home', owner: 'TEST', coastal: false, objects: [] } } },
  worldState: { resources: { stock: { money: 10, weapons: 2 }, needs: {} } },
}, commitments: [], operationalRows: [] });

const proposals = [
  { title: 'Riforma delle forze armate', question: 'Come riorganizzare le forze armate?', factKeys: ['resources.weapons', 'treasury'], suggestedMinisters: ['guerra', 'tesoro'] },
  { title: 'Iniziativa diplomatica', question: 'Quale iniziativa diplomatica proporre ai vicini?', factKeys: ['landlocked'], suggestedMinisters: ['esteri'] },
  { title: 'Rilancio infrastrutturale', question: 'Quale tracciato ferroviario studiare?', factKeys: ['railways', 'treasury'], suggestedMinisters: ['lavori', 'tesoro'] },
];
const block = (proposal: unknown) => `\`\`\`council_issue\n${JSON.stringify(proposal)}\n\`\`\``;
const response = (...items: unknown[]) => ['Discutiamo queste direzioni.', ...items.map(block)].join('\n\n');

describe('CouncilIssue optional variety protocol', () => {
  it('instructs the advisor to propose all and only the truly distinct issues, without a three-issue quota', () => {
    // WS-CONSULENTE-SITUAZIONI — nessun numero fisso nel protocollo condiviso.
    expect(COUNCIL_ISSUE_PROTOCOL).toMatch(/una o più/);
    expect(COUNCIL_ISSUE_PROTOCOL).not.toMatch(/una o più di tre/);
    expect(COUNCIL_ISSUE_PROTOCOL).not.toMatch(/da 1 a 3/);
    expect(COUNCIL_ISSUE_PROTOCOL).not.toContain('un solo blocco');
    expect(COUNCIL_ISSUE_PROTOCOL).toMatch(/distint/i);
    expect(COUNCIL_ISSUE_PROTOCOL).toMatch(/duplic/i);
    expect(COUNCIL_ISSUE_PROTOCOL).toMatch(/pertinent/i);
    expect(COUNCIL_ISSUE_PROTOCOL).toMatch(/separatamente/i);
    expect(COUNCIL_ISSUE_PROTOCOL).toContain('Usa solo chiavi presenti in facts');
  });

  it('separa SITUAZIONE da PROPOSTA DI ATTO e ancora i titoli ai fatti', () => {
    expect(SITUATION_BASE_PROTOCOL).toMatch(/numero fisso/);
    expect(SITUATION_BASE_PROTOCOL).toMatch(/SITUAZIONE da PROPOSTA DI ATTO/);
    expect(SITUATION_BASE_PROTOCOL).toContain('ogni situazione deve avere almeno una proposta collegata');
    expect(ADVISOR_BRIEFING_SITUATION_PROTOCOL).toMatch(/titoli devono essere concreti/i);
  });

  it('keeps proposals optional and accepts a single issue', () => {
    expect(parseCouncilIssues(snapshot(), 'Nessuna proposta.')).toEqual({ reply: 'Nessuna proposta.', issues: [] });
    expect(parseCouncilIssues(snapshot(), response(proposals[0])).issues).toHaveLength(1);
  });

  it('accepts three distinct issues with canonical facts and their own ministers', () => {
    const world = snapshot();
    const result = parseCouncilIssues(world, response(...proposals), 'president');
    expect(result.reply).toBe('Discutiamo queste direzioni.');
    expect(result.issues).toHaveLength(3);
    result.issues.forEach((issue, index) => {
      expect(issue.question).toBe(proposals[index].question);
      expect(issue.suggestedMinisters).toEqual(proposals[index].suggestedMinisters);
      expect(issue.origin).toBe('president');
      expect(issue.createdDate).toBe('2000-01-01');
      expect(issue.verifiedFacts).toEqual(proposals[index].factKeys.map(key => {
        const { rawValue: _rawValue, ...canonical } = world.facts[key];
        return canonical;
      }));
    });
  });

  it('rejects a repeated question even under a different title and with different facts or ministers', () => {
    const duplicate = { ...proposals[0], title: 'Nuovo titolo', factKeys: ['treasury'], suggestedMinisters: ['interno'] };
    const result = parseCouncilIssues(snapshot(), response(proposals[0], duplicate, proposals[1], proposals[2]));
    expect(result.issues.map(issue => issue.title)).toEqual(proposals.map(issue => issue.title));
    expect(result.reply).toBe('Discutiamo queste direzioni.');
  });

  it('rejects cosmetic question duplicates without consuming the three-issue budget', () => {
    const duplicate = { ...proposals[0], title: 'Altro titolo', question: 'COME   riorganizzare\nle forze armate !' };
    const result = parseCouncilIssues(snapshot(), response(proposals[0], duplicate, proposals[1], proposals[2]));
    expect(result.issues.map(issue => issue.question)).toEqual(proposals.map(issue => issue.question));
  });

  it('does not mistake shared titles, facts, or ministers for duplicate questions', () => {
    const issues = [
      { ...proposals[2], title: 'Infrastrutture', question: 'Quale tracciato ferroviario studiare?' },
      { ...proposals[2], title: 'Infrastrutture', question: 'Quale tracciato stradale studiare?' },
      { ...proposals[2], title: 'Infrastrutture', question: 'Come finanziare la manutenzione ferroviaria?' },
    ];
    expect(parseCouncilIssues(snapshot(), response(...issues)).issues.map(issue => issue.question)).toEqual(issues.map(issue => issue.question));
  });

  it('returns five valid council_issue blocks: proposals are no longer capped at three', () => {
    const extra = [
      { ...proposals[0], question: 'Come migliorare la formazione degli ufficiali?' },
      { ...proposals[0], question: 'Come rafforzare la difesa costiera?' },
    ];
    const result = parseCouncilIssues(snapshot(), response(...proposals, ...extra));
    expect(result.issues).toHaveLength(5);
    expect(result.issues.map(issue => issue.question)).toEqual([...proposals, ...extra].map(issue => issue.question));
    expect(result.reply).toBe('Discutiamo queste direzioni.');
  });

  it('keeps a high technical cap without presenting it to the model as a quota', () => {
    const many = Array.from({ length: MAX_COUNCIL_ISSUES + 2 }, (_, index) => ({
      ...proposals[0], question: `Domanda distinta numero ${index}?`,
    }));
    expect(parseCouncilIssues(snapshot(), response(...many)).issues).toHaveLength(MAX_COUNCIL_ISSUES);
    expect(COUNCIL_ISSUE_PROTOCOL).not.toContain(String(MAX_COUNCIL_ISSUES));
  });

  it('accepts zero issues: no problem means no proposal', () => {
    expect(parseCouncilIssues(snapshot(), 'Nessun problema saliente, nessuna proposta.').issues).toEqual([]);
  });

  it('still fails closed on unknown fact keys, including keys hidden in verifiedFacts', () => {
    const world = snapshot();
    for (const key of ['invented', '__proto__', 'toString']) {
      const invalid = { ...proposals[0], factKeys: ['treasury', key] };
      expect(() => resolveCouncilIssue(world, invalid)).toThrow(/Unknown verified fact key/);
      expect(parseCouncilIssues(world, response(invalid, ...proposals)).issues).toHaveLength(3);
    }
    const invalid = { ...proposals[0], verifiedFacts: [{ key: 'invented', value: 'forged' }] };
    expect(parseCouncilIssues(world, response(invalid)).issues).toEqual([]);
  });

  it('rehydrates facts from the snapshot instead of using invented values', () => {
    const world = snapshot();
    const forged = { ...proposals[0], factKeys: undefined, verifiedFacts: [{ key: 'treasury', label: 'Fake', value: '999', source: 'model', sourceRef: 'forged' }] };
    const result = parseCouncilIssues(world, response(forged));
    const { rawValue: _rawValue, ...canonical } = world.facts.treasury;
    expect(result.issues[0].verifiedFacts[0]).toEqual(canonical);
  });

  it('round-trips the three independent proposals through the legacy transport', () => {
    const world = snapshot();
    const result = parseCouncilIssues(world, response(...proposals));
    expect(parseCouncilIssues(world, serializeCouncilIssues(result))).toEqual(result);
  });
});
