import { describe, expect, it, vi } from 'vitest';
import { PromptEngine } from '../src/prompt-builder';
import { buildVerifiedWorldSnapshot } from '../src/core/government/VerifiedWorldSnapshot';
import { buildRealityAdvisorContext, buildRealityAdvisorPrompt } from '../src/core/government/RealityAdvisor';
import { buildRealitySignals } from '../src/core/government/RealitySignals';
import { parseAdvisorResponse } from '../src/core/government/AdvisorSituations';

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

describe('Advisor two-stage briefing', () => {
  it('discovers verified situations first and elaborates 4 options in a bounded second call', async () => {
    const f = fixture();
    const calls: string[] = [];
    const generate = vi.fn(async (_mechanic: string, _system: string, prompt: string) => {
      calls.push(prompt);
      if (prompt.includes('FASE 1 DI 2')) return { content: 'Il quadro richiede attenzione.\n' + fenced('advisor_situation', f.situation) };
      if (prompt.includes('"task":"Collega ogni situazione')) return { content: fenced('council_issue', f.issue) };
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
    expect(prompt).toContain('REAL HISTORY < START DATE');
    expect(prompt).not.toContain('Per ogni questione proponi normalmente 3-5 azioni');
  });
});
