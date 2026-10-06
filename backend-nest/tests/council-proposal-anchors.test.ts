/**
 * WS-GOV-COUNCIL-ANCHORS — Il Consulente deve poter produrre una `council_issue`
 * anche quando non c'è una criticità, agganciandosi a un fatto canonico
 * (`anchorKeys`). Gli anchor NON sono crisi né un'agenda: sono fonti possibili.
 * Il server risolve le chiavi come per le signal; chiave ignota → reject.
 */
import { describe, expect, it } from 'vitest';
import { buildVerifiedWorldSnapshot, type VerifiedWorldSnapshot } from '../src/core/government/VerifiedWorldSnapshot';
import { buildRealitySignals } from '../src/core/government/RealitySignals';
import { buildCouncilProposalAnchors, MAX_COUNCIL_ANCHORS } from '../src/core/government/CouncilProposalAnchors';
import { parseCouncilIssues, resolveCouncilIssue } from '../src/core/government/CouncilIssue';
import { buildRealityAdvisorContext, buildRealityAdvisorPrompt } from '../src/core/government/RealityAdvisor';

const block = (value: unknown) => `\`\`\`council_issue\n${JSON.stringify(value)}\n\`\`\``;

type Options = {
  relationships?: Record<string, Record<string, string>>;
  signedActs?: Array<{ id: string; text: string; status: 'signed_pending_execution'; createdAt: string }>;
  objects?: Array<Record<string, unknown>>;
  ongoingProcesses?: Array<Record<string, unknown>>;
};

/** Un paese senza emergenze ma con capacità reali: il caso che oggi non faceva nascere schede. */
function benign(options: Options = {}): VerifiedWorldSnapshot {
  return buildVerifiedWorldSnapshot({
    gameData: {
      id: 'anchors-benign', playerPolityId: 'TEST', currentDate: '2000-06-01',
      world: { regions: { home: { id: 'home', name: 'Home', owner: 'TEST', coastal: true,
        objects: options.objects ?? [
          { id: 'f1', type: 'factory', name: 'Acciaieria', owner: 'TEST' },
          { id: 'p1', type: 'port', name: 'Porto', owner: 'TEST' },
          { id: 'u1', type: 'university', name: 'Università', owner: 'TEST' },
        ] } } },
      worldState: {
        accounts: { TEST: { population: 10_000_000, socialTension: 20, stability: 80, monthlyBalance: 2,
          nominalGdpUsdBillions: 100, debtRatioPct: 30, debtServicePct: 4 } },
        resources: { stock: { money: 50, food: 10, weapons: 5, research: 3 }, needs: { food: 2 } },
        arsenal: { units: { tank: 10 } },
      },
      relationships: options.relationships ?? { TEST: { NEIGHBOR: 'neutral' } },
      ongoingProcesses: options.ongoingProcesses ?? [{ id: 'proj1', title: 'Ferrovia', expectedDate: '2001-01-01' }],
    },
    commitments: [], operationalRows: [], foodCoverageMonths: 5,
    signedActs: options.signedActs,
  });
}

/** Un paese di cui non si sa nulla: nessuna signal, nessun anchor. */
function bare(): VerifiedWorldSnapshot {
  return buildVerifiedWorldSnapshot({ gameData: {
    id: 'anchors-bare', playerPolityId: 'TEST', currentDate: '2000-06-01',
    world: { regions: { home: { id: 'home', name: 'Home', owner: 'TEST', coastal: false, objects: [] } } },
    worldState: { resources: { stock: {}, needs: {} } },
  }, commitments: [], operationalRows: [] });
}

describe('WS-GOV-COUNCIL-ANCHORS — appigli canonici per le proposte', () => {
  it('1. nessuna RealitySignal urgente ma un anchor valido: la proposta nasce', () => {
    const snapshot = benign();
    expect(buildRealitySignals(snapshot)).toEqual([]);
    const anchors = buildCouncilProposalAnchors(snapshot);
    expect(anchors.map(anchor => anchor.key)).toContain('capacity-infrastructure');
    const issue = resolveCouncilIssue(snapshot, {
      title: 'Nuovo tratto ferroviario', question: 'Vogliamo studiare un nuovo tratto ferroviario?',
      anchorKeys: ['capacity-infrastructure'], suggestedMinisters: ['lavori', 'tesoro'],
    });
    expect(issue.anchorKeys).toEqual(['capacity-infrastructure']);
    expect(issue.signalKeys).toBeUndefined();
    expect(issue.verifiedFacts.map(fact => fact.key)).toEqual(['factories', 'ports']);
    expect(issue.sourceRefs.length).toBeGreaterThan(0);
  });

  it('2. nessuna signal e nessun anchor pertinente: zero issue è valido', () => {
    const snapshot = bare();
    expect(buildRealitySignals(snapshot)).toEqual([]);
    expect(buildCouncilProposalAnchors(snapshot)).toEqual([]);
    expect(parseCouncilIssues(snapshot, 'Il quadro non offre appigli concreti: nessuna proposta.').issues).toEqual([]);
  });

  it('3. anchor inesistente → reject con motivo, mai in silenzio', () => {
    const snapshot = benign();
    expect(() => resolveCouncilIssue(snapshot, {
      title: 'Programma', question: 'Quale programma avviamo?', anchorKeys: ['does-not-exist'], suggestedMinisters: ['tesoro'],
    })).toThrow(/Unknown council anchor key: does-not-exist/);
    const reasons: string[] = [];
    const result = parseCouncilIssues(snapshot, block({
      title: 'Programma', question: 'Quale programma avviamo?', anchorKeys: ['does-not-exist'], suggestedMinisters: ['tesoro'],
    }), 'advisor', { onDiscard: reason => reasons.push(reason) });
    expect(result.issues).toEqual([]);
    expect(reasons.some(reason => reason.includes('Unknown council anchor key'))).toBe(true);
  });

  it('4. il percorso signalKeys continua a funzionare', () => {
    const snapshot = benign({ relationships: { TEST: { NEIGHBOR: 'hostile' } } });
    expect(buildRealitySignals(snapshot).map(signal => signal.key)).toContain('hostile-relations');
    const issue = resolveCouncilIssue(snapshot, {
      title: 'Rapporto ostile', question: 'Come gestiamo il confine?', signalKeys: ['hostile-relations'], suggestedMinisters: ['esteri'],
    });
    expect(issue.signalKeys).toEqual(['hostile-relations']);
    expect(issue.anchorKeys).toBeUndefined();
    expect(issue.sourceRefs.length).toBeGreaterThan(0);
  });

  it('5. problemi e opportunità distinti producono più issue', () => {
    const snapshot = benign({ relationships: { TEST: { NEIGHBOR: 'hostile' } } });
    const response = ['Due direzioni distinte.', block({
      title: 'Confine', question: 'Come riduciamo la tensione al confine?', signalKeys: ['hostile-relations'], suggestedMinisters: ['esteri'],
    }), block({
      title: 'Ferrovia', question: 'Vogliamo avviare un nuovo tratto ferroviario?', anchorKeys: ['capacity-infrastructure'], suggestedMinisters: ['lavori', 'tesoro'],
    })].join('\n\n');
    const result = parseCouncilIssues(snapshot, response);
    expect(result.issues).toHaveLength(2);
    expect(result.issues[0].signalKeys).toEqual(['hostile-relations']);
    expect(result.issues[1].anchorKeys).toEqual(['capacity-infrastructure']);
  });

  it('6. una decisione già firmata non viene riproposta', () => {
    const snapshot = benign({ signedActs: [{ id: 'act1', text: 'Avviare un programma ferroviario', status: 'signed_pending_execution', createdAt: '2000-05-01' }] });
    const reasons: string[] = [];
    const repeated = parseCouncilIssues(snapshot, block({
      title: 'Ferrovia', question: 'Avviare un programma ferroviario?', anchorKeys: ['capacity-infrastructure'], suggestedMinisters: ['lavori'],
    }), 'advisor', { onDiscard: reason => reasons.push(reason) });
    expect(repeated.issues).toEqual([]);
    expect(reasons.some(reason => reason.includes('Decision already signed: act1'))).toBe(true);
    // Una questione diversa, ancorata alla stessa capacità, resta valida.
    const other = parseCouncilIssues(snapshot, block({
      title: 'Manutenzione stradale', question: 'Come finanziamo la manutenzione delle strade?', anchorKeys: ['capacity-infrastructure'], suggestedMinisters: ['lavori', 'tesoro'],
    }));
    expect(other.issues).toHaveLength(1);
  });

  it('gli anchor di opportunità sono pochi e non una voce per ogni valore', () => {
    const anchors = buildCouncilProposalAnchors(benign());
    expect(anchors.length).toBeLessThanOrEqual(MAX_COUNCIL_ANCHORS);
    expect(anchors.filter(anchor => anchor.key.startsWith('capacity-')).length).toBeLessThanOrEqual(8);
  });

  it('il prompt del Consulente separa segnali (attenzione) e anchor (proposta)', () => {
    const prompt = buildRealityAdvisorPrompt(buildRealityAdvisorContext(benign()).advisorContext, 'Come procediamo?');
    expect(prompt).toContain('[CURRENT STRATEGIC SIGNALS');
    expect(prompt).toContain('[COUNCIL PROPOSAL ANCHORS');
    expect(prompt).toContain('capacity-infrastructure');
  });
});
