/**
 * WS-COUNCIL-SIGNALKEYS — Il Consulente collega le schede Consiglio ai segnali
 * canonici con `signalKeys`: il SERVER risolve `factKeys` e `sourceRefs` dalla
 * RealitySignal reale, il modello non fornisce mai fatti o riferimenti.
 */
import { describe, expect, it, vi } from 'vitest';
import { buildVerifiedWorldSnapshot } from '../src/core/government/VerifiedWorldSnapshot';

// Segnali deterministici: 9 disponibili, così si verifica anche il cap a 8.
const SIGNALS = vi.hoisted(() => [
  { key: 'signal-0', domain: 'military', importance: 3, factKeys: ['treasury'], sourceRefs: ['worldState.resources.stock.money'], reason: 'prontezza minima' },
  { key: 'signal-1', domain: 'diplomacy', importance: 2, factKeys: [], sourceRefs: ['diplomacy.relations.NEIGHBOR'], reason: 'rapporto ostile' },
  { key: 'signal-2', domain: 'project', importance: 2, factKeys: [], sourceRefs: ['ongoingProcesses.p1'], reason: 'opera in ritardo' },
  { key: 'signal-3', domain: 'decision', importance: 2, factKeys: [], sourceRefs: ['decisions.d1'], reason: 'decisione recente' },
  { key: 'signal-4', domain: 'social', importance: 2, factKeys: ['socialTension'], sourceRefs: ['worldState.accounts.TEST.socialTension'], reason: 'tensione sociale' },
  { key: 'signal-5', domain: 'economy', importance: 2, factKeys: [], sourceRefs: ['worldState.accounts.TEST.monthlyBalance'], reason: 'saldo mensile' },
  { key: 'signal-6', domain: 'food', importance: 2, factKeys: [], sourceRefs: ['worldState.resources.stock.food'], reason: 'scorte' },
  { key: 'signal-7', domain: 'report', importance: 2, factKeys: [], sourceRefs: ['results.r1'], reason: 'rapporto' },
  { key: 'signal-8', domain: 'inaction', importance: 2, factKeys: [], sourceRefs: ['decisions.d2'], reason: 'inazione' },
]);

vi.mock('../src/core/government/RealitySignals', async importOriginal => {
  const actual = await importOriginal<typeof import('../src/core/government/RealitySignals')>();
  return { ...actual, buildRealitySignals: () => SIGNALS };
});

import { parseCouncilIssues, resolveCouncilIssue } from '../src/core/government/CouncilIssue';
import { buildRealityAdvisorContext, buildRealityAdvisorPrompt } from '../src/core/government/RealityAdvisor';

const snapshot = () => buildVerifiedWorldSnapshot({ gameData: {
  id: 'signalkeys', playerPolityId: 'TEST', currentDate: '2000-01-01',
  world: { regions: { home: { id: 'home', name: 'Home', owner: 'TEST', coastal: false, objects: [] } } },
  worldState: { resources: { stock: { money: 10, weapons: 2 }, needs: {} }, accounts: { TEST: { socialTension: 40, monthlyBalance: -2 } } },
}, commitments: [], operationalRows: [] });

const block = (value: unknown) => `\`\`\`council_issue\n${JSON.stringify(value)}\n\`\`\``;

describe('WS-COUNCIL-SIGNALKEYS — signalKeys come collegamento canonico', () => {
  it('risolve una signal con factKeys in fatti e riferimenti canonici', () => {
    const issue = resolveCouncilIssue(snapshot(), {
      title: 'Prontezza delle forze', question: 'Come ristabiliamo la prontezza?',
      signalKeys: ['signal-0'], suggestedMinisters: ['guerra', 'tesoro'],
    });
    expect(issue.verifiedFacts.map(fact => fact.key)).toEqual(['treasury']);
    expect(issue.verifiedFacts[0].sourceRef).toBe('worldState.resources.stock.money');
    expect(issue.sourceRefs).toEqual(['worldState.resources.stock.money']);
  });

  it('accetta una signal senza factKeys ma con sourceRefs canonici: verifiedFacts vuoto e signalKeys conservate', () => {
    const issue = resolveCouncilIssue(snapshot(), {
      title: 'Rapporto ostile', question: 'Come gestiamo il confine?',
      signalKeys: ['signal-1'], suggestedMinisters: ['esteri'],
    });
    expect(issue.verifiedFacts).toEqual([]);
    expect(issue.sourceRefs).toEqual(['diplomacy.relations.NEIGHBOR']);
    expect(issue.signalKeys).toEqual(['signal-1']);
  });

  it('round-trip: la issue risolta rientra dal client e resta valida', () => {
    const first = resolveCouncilIssue(snapshot(), {
      title: 'Rapporto ostile', question: 'Come gestiamo il confine?',
      signalKeys: ['signal-1'], suggestedMinisters: ['esteri'],
    });
    const back = resolveCouncilIssue(snapshot(), JSON.parse(JSON.stringify(first)));
    expect(back.signalKeys).toEqual(['signal-1']);
    expect(back.verifiedFacts).toEqual([]);
    expect(back.sourceRefs).toEqual(['diplomacy.relations.NEIGHBOR']);
  });

  it('round-trip con fatti: verifiedFacts tornano dal client e vengono ricalcolati dal server', () => {
    const first = resolveCouncilIssue(snapshot(), {
      title: 'Prontezza', question: 'Come ristabiliamo la prontezza?', signalKeys: ['signal-0'], suggestedMinisters: ['guerra'],
    });
    const back = resolveCouncilIssue(snapshot(), JSON.parse(JSON.stringify(first)));
    expect(back.signalKeys).toEqual(['signal-0']);
    expect(back.verifiedFacts.map(fact => fact.key)).toEqual(['treasury']);
  });

  it('sicurezza round-trip: signalKeys valide + sourceRefs inventati → riferimenti ricalcolati', () => {
    const server = resolveCouncilIssue(snapshot(), {
      title: 'Rapporto ostile', question: 'Come gestiamo il confine?', signalKeys: ['signal-1'], suggestedMinisters: ['esteri'],
    });
    const back = resolveCouncilIssue(snapshot(), { ...JSON.parse(JSON.stringify(server)), sourceRefs: ['invented.ref'] });
    expect(back.sourceRefs).toEqual(['diplomacy.relations.NEIGHBOR']);
    expect(back.sourceRefs).not.toContain('invented.ref');
  });

  it("il payload sourceIssue di 'Porta al Consiglio' non lancia InvalidCouncilIssueError", () => {
    const server = resolveCouncilIssue(snapshot(), {
      title: 'Rapporto ostile', question: 'Come gestiamo il confine?', signalKeys: ['signal-1'], suggestedMinisters: ['esteri'],
    });
    const sourceIssue = JSON.parse(JSON.stringify(server)) as Record<string, unknown>;
    expect(() => resolveCouncilIssue(snapshot(), sourceIssue)).not.toThrow();
  });

  it('scarta una signalKey inesistente con un motivo, non in silenzio', () => {
    const reasons: string[] = [];
    const result = parseCouncilIssues(snapshot(), ['Testo.', block({
      title: 'Inventata', question: 'Domanda inventata?', signalKeys: ['does-not-exist'], suggestedMinisters: ['guerra'],
    })].join('\n\n'), 'advisor', { onDiscard: reason => reasons.push(reason) });
    expect(result.issues).toEqual([]);
    expect(reasons.some(reason => reason.includes('Unknown reality signal key: does-not-exist'))).toBe(true);
  });

  it('ignora i sourceRefs inventati dal modello: restano solo quelli canonici', () => {
    const issue = resolveCouncilIssue(snapshot(), {
      title: 'Rapporto ostile', question: 'Come gestiamo il confine?',
      signalKeys: ['signal-1'], sourceRefs: ['invented.ref'], suggestedMinisters: ['esteri'],
    });
    expect(issue.sourceRefs).toEqual(['diplomacy.relations.NEIGHBOR']);
    expect(issue.sourceRefs).not.toContain('invented.ref');
  });

  it('con signalKeys presenti, una factKey client-side estranea (ma esistente) NON entra in verifiedFacts', () => {
    const issue = resolveCouncilIssue(snapshot(), {
      title: 'Rapporto ostile', question: 'Come gestiamo il confine?',
      signalKeys: ['signal-1'], factKeys: ['treasury'], suggestedMinisters: ['esteri'],
    });
    expect(issue.verifiedFacts).toEqual([]);
    expect(issue.signalKeys).toEqual(['signal-1']);
    expect(issue.sourceRefs).toEqual(['diplomacy.relations.NEIGHBOR']);
  });

  it('con signalKeys presenti, verifiedFacts client-side estranei sono ignorati', () => {
    const issue = resolveCouncilIssue(snapshot(), {
      title: 'Rapporto ostile', question: 'Come gestiamo il confine?',
      signalKeys: ['signal-1'], verifiedFacts: [{ key: 'treasury' }], suggestedMinisters: ['esteri'],
    });
    expect(issue.verifiedFacts).toEqual([]);
    expect(issue.signalKeys).toEqual(['signal-1']);
  });

  it('legacy senza signalKeys: una factKey valida continua a produrre i fatti', () => {
    const issue = resolveCouncilIssue(snapshot(), {
      title: 'Cassa', question: 'Come proteggiamo la cassa?',
      factKeys: ['treasury'], suggestedMinisters: ['tesoro'],
    });
    expect(issue.signalKeys).toBeUndefined();
    expect(issue.verifiedFacts.map(fact => fact.key)).toEqual(['treasury']);
    expect(issue.sourceRefs).toEqual(['worldState.resources.stock.money']);
  });

  it('accetta 5 signal con 5 issue: 5 schede, più di tre restano supportate', () => {
    const keys = ['signal-0', 'signal-1', 'signal-2', 'signal-3', 'signal-4'];
    const response = ['Cinque questioni distinte.', ...keys.map((key, index) => block({
      title: `Questione ${index}`, question: `Domanda distinta numero ${index}?`, signalKeys: [key], suggestedMinisters: ['guerra'],
    }))].join('\n\n');
    const result = parseCouncilIssues(snapshot(), response);
    expect(result.issues).toHaveLength(5);
    result.issues.forEach((issue, index) => expect(issue.question).toBe(`Domanda distinta numero ${index}?`));
  });

  it('un turno senza problemi reali vale zero issue', () => {
    expect(parseCouncilIssues(snapshot(), 'Il quadro è stabile, non vedo decisioni urgenti.').issues).toEqual([]);
  });

  it('il prompt dice che una questione politica DEVE produrre una council_issue senza soluzioni', () => {
    const prompt = buildRealityAdvisorPrompt(buildRealityAdvisorContext(snapshot()).advisorContext, 'Come procediamo?');
    expect(prompt).toContain('DEVI emettere la relativa scheda');
    expect(prompt).toContain('council_issue');
    expect(prompt).not.toContain('"options"');
    expect(prompt).toContain('Le soluzioni devono emergere SOLO nel Consiglio');
    expect(prompt).not.toContain('questioni al Consiglio sono facoltative');
  });

  it('passa al modello al massimo 8 signal (cap tecnico)', () => {
    const prompt = buildRealityAdvisorPrompt(buildRealityAdvisorContext(snapshot()).advisorContext, 'Come procediamo?');
    expect(prompt).toContain('"key":"signal-7"');
    expect(prompt).not.toContain('"key":"signal-8"');
  });
});
