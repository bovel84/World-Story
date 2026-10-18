import { describe, expect, it, vi } from 'vitest';
import { PromptEngine } from '../src/prompt-builder';
import { buildVerifiedWorldSnapshot } from '../src/core/government/VerifiedWorldSnapshot';
import { buildRealityAdvisorContext, buildRealityAdvisorPrompt, isAdvisorBriefingRequest, isAdvisorAdditionalProposalsRequest } from '../src/core/government/RealityAdvisor';
import { buildRealitySignals } from '../src/core/government/RealitySignals';
import { buildStrategicThreadEvidence } from '../src/core/government/StrategicThreads';
import { resolveCouncilIssue } from '../src/core/government/CouncilIssue';
import { normalizeMinisterCouncil } from '../src/core/government/MinisterDialogue';
import { buildAdvisorSituations, parseAdvisorResponse } from '../src/core/government/AdvisorSituations';

const fenced = (tag: string, value: unknown) => '```' + tag + '\n' + JSON.stringify(value) + '\n```';

function fixture() {
  const game = {
    id: 'advisor-two-pass', currentDate: '2000-01-01', currentTurn: 1,
    world: { name: 'Millennium Dawn', startDate: '2000-01-01', basePrompt: 'Uganda 2000',
      prompts: {}, regions: { ug: { id: 'ug', name: 'Uganda', owner: 'UGA', coastal: false, objects: [] } } },
    players: [{ id: 'p', name: 'Presidente', regionId: 'ug', polityId: 'UGA' }],
    playerPolityId: 'UGA', actions: [], results: [],
    worldState: { accounts: { UGA: { population: 10000000, stability: 50, monthlyBalance: -2 } },
      resources: { stock: { money: 2, food: 0.4 }, needs: { food: 1 } } },
    relationships: {},
  };
  const snapshot = buildVerifiedWorldSnapshot({ gameData: game, commitments: [], operationalRows: [], foodCoverageMonths: 0.4 });
  const signalKey = buildRealitySignals(snapshot).find(s => s.key === 'food-coverage')?.key;
  if (!signalKey) throw new Error('Fixture missing food coverage');
  const context = buildRealityAdvisorContext(snapshot, undefined, undefined, undefined, 'briefing').advisorContext;
  const situation = { id: 'scorte', title: 'Scorte alimentari in difficoltà',
    summary: 'Le scorte alimentari sono limitate; il Tesoro deve valutare come garantire le forniture.',
    signalKeys: [signalKey] };
  const issue = { title: 'Garantire gli approvvigionamenti',
    question: 'Quale politica di approvvigionamento autorizziamo per proteggere le scorte?',
    situationId: 'scorte', signalKeys: [signalKey], suggestedMinisters: ['tesoro'],
    options: [
      { title: 'Acquisti mirati', content: 'Autorizziamo acquisti mirati entro i fondi disponibili, tutelando le scorte ma comprimendo altre priorità.' },
      { title: 'Accordi commerciali', content: 'Proponiamo nuovi accordi di fornitura, riducendo il rischio immediato ma accettando condizioni negoziali.' },
      { title: 'Ridistribuire le risorse', content: 'Destiniamo risorse esistenti alle scorte essenziali, sacrificando temporaneamente altri programmi.' },
      { title: 'Piano graduale', content: 'Distribuiamo gli acquisti su più fasi, contenendo la spesa iniziale ma esponendoci a ritardi.' },
    ] };
  return { game: { ...game, advisorContext: context }, context, snapshot, situation, issue };
}

// Synthetic opening dossier: independent political decisions without numeric alerts.
function politicalFixture() {
  const f = fixture();
  const context = { ...f.context,
    temporalScope: { initialDate: '2000-01-01', currentDate: '2000-01-01' },
    nationSituation: 'Il governo propone una riforma tributaria e i sindacati contestano la distribuzione degli oneri.\nLa missione all’estero attende un mandato politico per il passaggio a una gestione civile.\nLa città ospitante prepara i Giochi e deve conciliare sicurezza e accesso dei cittadini.',
  };
  const themes = ['riforma', 'missione', 'giochi'];
  const situations = buildStrategicThreadEvidence(f.snapshot, context).filter(item => item.sourceRef === 'nationSituation')
    .map((item, index) => ({ id: themes[index], title: themes[index], summary: item.text, signalKeys: [], evidenceKeys: [item.key] }));
  const issueFor = (id: string) => ({ ...f.issue, signalKeys: undefined, evidenceKeys: situations.find(item => item.id === id)!.evidenceKeys,
    title: `Decisione ${id}`, question: `Quale mandato politico scegliamo per ${id}?`, situationId: id,
  });
  return { ...f, context, situations, issueFor, game: { ...f.game, advisorContext: context } };
}

describe('Political agenda development and Council handoff', () => {
  it.each([false, true])('develops threads separately and retains sources through Council (stream=%s)', async streaming => {
    const f = politicalFixture();
    const before = JSON.stringify(f.snapshot);
    const discovery = f.situations.map(situation => fenced('advisor_situation', situation)).join('\n');
    const developedIds: string[] = [];
    const generate = vi.fn(async (_mechanic: string, _system: string, prompt: string) => {
      if (prompt.includes('FASE 1 DI 2')) return { content: discovery };
      const plan = JSON.parse(prompt);
      expect(plan.situations).toHaveLength(1);
      expect(plan.agenda).toHaveLength(3);
      const situation = plan.situations[0];
      const original = f.situations.find(item => item.id === situation.id)!;
      expect(situation.verifiedContext[0].text).toBe(original.summary);
      developedIds.push(situation.id);
      return { content: fenced('advisor_situation', { ...original, summary: `Situazione sviluppata: ${original.summary}` })
        + fenced('council_issue', f.issueFor(situation.id)) };
    });
    const stream = vi.fn(async () => ({ content: discovery }));
    const engine = new PromptEngine({ generate, stream } as never);
    const text = streaming ? await engine.getAdvisorStream(f.game as never, 'fammi il quadro', [], () => {})
      : await engine.getAdvisor(f.game as never, 'fammi il quadro');
    const response = parseAdvisorResponse(f.snapshot, text, 'advisor', { strategicContext: f.context });
    expect(developedIds.sort()).toEqual(['giochi', 'missione', 'riforma']);
    expect(generate.mock.calls.length + stream.mock.calls.length).toBe(4);
    expect(response.issues).toHaveLength(3);
    expect(response.situations.every(item => item.summary.startsWith('Situazione sviluppata:'))).toBe(true);
    for (const issue of response.issues) {
      expect(issue.options).toHaveLength(4);
      expect(issue.signalKeys).toBeUndefined();
      expect(issue.verifiedFacts).toEqual([]);
      const room = normalizeMinisterCouncil({ sessionId: 'cabinet', topic: issue.question,
        initiatorMinister: 'tesoro', participants: ['tesoro'], phase: 'discussion', sourceIssue: issue,
      }, 'tesoro', f.snapshot, f.context);
      expect(room?.sourceIssue?.verifiedContext?.[0].text).toBe(f.situations.find(item => item.id === issue.situationId)!.summary);
    }
    expect(JSON.stringify(f.snapshot)).toBe(before);
  });

  it('retries only the incomplete situation', async () => {
    const f = politicalFixture();
    const attempts = new Map<string, number>();
    const generate = vi.fn(async (_mechanic: string, _system: string, prompt: string) => {
      if (prompt.includes('FASE 1 DI 2')) return { content: f.situations.map(situation => fenced('advisor_situation', situation)).join('\n') };
      const request = JSON.parse(prompt);
      const id = request.situations[0].id;
      attempts.set(id, (attempts.get(id) ?? 0) + 1);
      if (id === 'missione' && attempts.get(id) === 1) return { content: fenced('council_issue', { ...f.issueFor(id), evidenceKeys: ['invented'] }) };
      if (id === 'missione') expect(request.revision.reasons.join(' ')).toContain('Unknown');
      return { content: fenced('council_issue', f.issueFor(id)) };
    });
    const text = await new PromptEngine({ generate } as never).getAdvisor(f.game as never, 'fammi il quadro');
    expect(Object.fromEntries(attempts)).toEqual({ riforma: 1, missione: 2, giochi: 1 });
    expect(parseAdvisorResponse(f.snapshot, text, 'advisor', { strategicContext: f.context }).issues).toHaveLength(3);
  });

  it('rejects forged context and historical-only sources after opening', () => {
    const f = politicalFixture();
    const raw = { ...f.issueFor('riforma'), verifiedContext: [{ key: 'invented', text: 'Un fatto inventato' }] };
    expect(resolveCouncilIssue(f.snapshot, raw, 'advisor', f.context).verifiedContext?.[0].text).toBe(f.situations[0].summary);
    expect(() => resolveCouncilIssue(f.snapshot, { ...raw, evidenceKeys: ['invented'] }, 'advisor', f.context)).toThrow('Unknown');
    expect(() => resolveCouncilIssue({ ...f.snapshot, date: '2000-02-01', turn: 2 }, raw, 'advisor', f.context)).toThrow('continuity');
    expect(() => resolveCouncilIssue(f.snapshot, raw)).toThrow('Unknown');
  });

  it('stops development and retries when cancelled', async () => {
    const f = fixture();
    const controller = new AbortController();
    const generate = vi.fn(async (_mechanic: string, _system: string, prompt: string) => {
      if (prompt.includes('FASE 1 DI 2')) return { content: fenced('advisor_situation', f.situation) };
      controller.abort();
      throw new Error('cancelled');
    });
    await expect(new PromptEngine({ generate } as never).getAdvisor(f.game as never, 'fammi il quadro', [], controller.signal)).rejects.toThrow();
    expect(generate).toHaveBeenCalledTimes(2);
  });
});

describe('Explicit new proposals after a political briefing', () => {
  it('routes explicit additional requests to a new two-stage briefing without hijacking focused questions', () => {
    for (const message of ['Dammi altre proposte', 'crea nuove situazioni', 'Proponimi ulteriori alternative']) {
      expect(isAdvisorAdditionalProposalsRequest(message), message).toBe(true);
      expect(isAdvisorBriefingRequest(message), message).toBe(true);
    }
    expect(isAdvisorAdditionalProposalsRequest('Approfondiamo la questione di Gerusalemme')).toBe(false);
    expect(isAdvisorAdditionalProposalsRequest('fammi il quadro')).toBe(false);
  });

  it('retains a council decision grounded only in a verified urgent signal on transport', () => {
    const f = fixture();
    const signal = buildAdvisorSituations(f.snapshot).find(s => s.signalKeys.includes('food-coverage'))!;
    expect(signal).toBeDefined();
    const result = parseAdvisorResponse(f.snapshot,
      fenced('council_issue', { ...f.issue, situationId: signal.id }), 'advisor',
      { strategicContext: f.context, includeDeterministicSituations: true });
    expect(result.issues).toHaveLength(1);
    expect(result.issues[0].situationId).toBe(signal.id);
  });
});

describe('Advisor two-stage briefing', () => {
  it('discovers verified situations first and elaborates 4 options in a bounded second call', async () => {
    const f = fixture();
    const calls: string[] = [];
    const generate = vi.fn(async (_mechanic: string, _system: string, prompt: string) => {
      calls.push(prompt);
      if (prompt.includes('FASE 1 DI 2')) return { content: 'Il quadro richiede attenzione.\n' + fenced('advisor_situation', f.situation) };
      if (prompt.includes('"task":"Per ogni situazione scoperta')) return { content: fenced('council_issue', f.issue) };
      throw new Error('Unexpected third request');
    });
    const reply = await new PromptEngine({ generate } as never).getAdvisor(f.game as never, 'fammi il quadro');
    const result = parseAdvisorResponse(f.snapshot, reply, 'advisor', { strategicContext: f.context });
    expect(generate).toHaveBeenCalledTimes(2);
    expect(calls[0]).toContain('FASE 1 DI 2');
    expect(calls[0]).not.toContain('Per ogni questione proponi normalmente 3-5 azioni');
    expect(calls[1]).toContain('"situations"');
    expect(calls[1]).toContain('Scorte alimentari in difficoltà');
    expect(calls[1]).not.toContain('[VERIFIED WORLD SNAPSHOT');
    expect(result.situations.some(s => s.title === f.situation.title)).toBe(true);
    expect(result.issues.find(i => i.situationId === 'scorte')?.options).toHaveLength(4);
  });

  it('does not accept premature first-pass actions as finished proposals', async () => {
    const f = fixture();
    const generate = vi.fn(async (_mechanic: string, _system: string, prompt: string) => ({
      content: prompt.includes('FASE 1 DI 2')
        ? fenced('advisor_situation', f.situation) + '\n'
          + fenced('council_issue', { ...f.issue, title: 'Proposta prematura' })
        : fenced('council_issue', f.issue),
    }));
    const reply = await new PromptEngine({ generate } as never).getAdvisor(f.game as never, 'fammi il quadro');
    expect(generate).toHaveBeenCalledTimes(2);
    const issues = parseAdvisorResponse(f.snapshot, reply, 'advisor', { strategicContext: f.context }).issues;
    expect(issues).toHaveLength(1);
    expect(issues[0].title).toBe('Garantire gli approvvigionamenti');
  });

  it('uses at most one legacy fallback when first phase produces no valid situation', async () => {
    const f = fixture();
    const calls: string[] = [];
    const generate = vi.fn(async (_mechanic: string, _system: string, prompt: string) => {
      calls.push(prompt);
      return { content: calls.length === 1 ? 'Nessuna situazione verificabile.' :
        'La politica delle scorte richiede una scelta.\n' + fenced('advisor_situation', f.situation) + '\n' + fenced('council_issue', f.issue) };
    });
    const reply = await new PromptEngine({ generate } as never).getAdvisor(f.game as never, 'fammi il quadro');
    expect(calls).toHaveLength(2);
    expect(calls[1]).not.toContain('FASE 1 DI 2');
    expect(parseAdvisorResponse(f.snapshot, reply, 'advisor', { strategicContext: f.context }).issues).toHaveLength(1);
  });

  it('retains a single completion for focused conversation', async () => {
    const f = fixture();
    const generate = vi.fn(async () => ({ content: 'Le scorte richiedono una risposta prudente.' }));
    await new PromptEngine({ generate } as never).getAdvisor(
      { ...f.game, advisorContext: { ...f.context, mode: 'conversation' } } as never, 'Approfondisci le scorte');
    expect(generate).toHaveBeenCalledTimes(1);
  });

  it('uses streamed discovery and the same verified second-pass proposal validator', async () => {
    const f = fixture();
    const stream = vi.fn(async () => ({ content: fenced('advisor_situation', f.situation) }));
    const generate = vi.fn(async () => ({ content: fenced('council_issue', f.issue) }));
    const reply = await new PromptEngine({ stream, generate } as never).getAdvisorStream(f.game as never, 'fammi il quadro', [], () => {});
    expect(stream).toHaveBeenCalledTimes(1);
    expect(generate).toHaveBeenCalledTimes(1);
    expect(parseAdvisorResponse(f.snapshot, reply, 'advisor', { strategicContext: f.context }).issues[0].options).toHaveLength(4);
  });

  it('preserves canonical evidence and the cutoff in discovery-only mode', () => {
    const f = fixture();
    const prompt = buildRealityAdvisorPrompt(f.context, 'fammi il quadro', [], undefined, 'advisor', undefined, 'agenda');
    expect(prompt).toContain('STRATEGIC THREAD EVIDENCE');
    expect(prompt).toContain('FASE 1 DI 2');
    expect(prompt).toContain('SCRIVI COME UNA CRONACA POLITICA VIVA');
    expect(prompt).toContain('non anticipare eventi successivi alla divergenza');
    expect(prompt).toContain('REAL HISTORY < START DATE');
    expect(prompt).not.toContain('Per ogni questione proponi normalmente 3-5 azioni');
    expect(prompt).not.toContain('[COUNCIL PROPOSAL ANCHORS');
  });
});
