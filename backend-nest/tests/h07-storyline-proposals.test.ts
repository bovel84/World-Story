/**
 * H07 — Il Consulente propone *dal* filone (parità Pax).
 *
 * Difende le invarianti:
 *  - un filone che tocca il giocatore diventa un **segnale** e un **anchor**
 *    validabile: il modello può emettere una `council_issue` con
 *    `signalKeys: ["storyline:<id>"]`;
 *  - un filone è **significato**, non un fatto: la chiave è `storyline:*`, mai
 *    una `factKey`, e il dominio è quello della sua sedia;
 *  - la chiave resta **stabile e riconoscibile** (una proposta su un filone
 *    ignoto non risolve — è la stessa disciplina degli anchor);
 *  - il blocco nel prompt dichiara che la `trajectory` è una tendenza (H-I12).
 */
import { describe, it, expect } from 'vitest';
import { buildRealitySignals, seatToSignalDomain } from '../src/core/government/RealitySignals';
import { buildCouncilProposalAnchors } from '../src/core/government/CouncilProposalAnchors';
import { renderPlayerStorylines } from '../src/core/government/RealityAdvisor';
import { CABINET_SEATS } from '../src/core/government/Cabinet';
import type { VerifiedWorldSnapshot } from '../src/core/government/VerifiedWorldSnapshot';
import type { Storyline } from '../src/scenario/storylines';

/** Uno snapshot minimo ma valido per i consumatori puri. */
function snapshotWith(storylines: Storyline[]): VerifiedWorldSnapshot {
  return {
    schemaVersion: 1, gameId: 'g', branchId: null, date: '2000-01-01', turn: 1,
    polityId: 'ISR', polityName: 'Israele',
    geography: { ownedRegions: [], coastal: null, landlocked: null, borderingPolities: null },
    infrastructure: { ports: null, airfields: null, railways: null, roads: null, factories: null, constructionSites: null, other: null },
    military: {
      formations: [], formationCount: null, mobilized: null, mobilizations: [], manpower: null,
      equipment: {}, navalUnits: [], units: [], ships: [], fleets: [], fronts: [], locations: [],
      supply: { stock: null, monthlyNeeds: null },
    },
    economy: { treasury: 10, monthlyBalance: 1, debt: 5, revenue: 3, expenditure: 2, foodCoverageMonths: 6, resources: null, naturalResources: null, account: null, ongoingProjects: [] },
    diplomacy: { relations: [], commitments: [], alliances: [], wars: null, sanctions: null, activeNegotiations: null },
    recent: { events: [], orders: [], consequences: [], decisions: [], followUps: null, signedActs: [] },
    changes: { available: false, reason: 'x', previousDate: null, previousTurn: null, comparedKeys: [], unavailableKeys: [], deltas: [] },
    facts: {}, unavailable: [],
    storylines,
  } as unknown as VerifiedWorldSnapshot;
}

const filone: Storyline = {
  id: 'levante-disarmo-hamas', title: 'Il disarmo di Hamas', domain: 'esteri',
  parties: ['ISR', 'PSE', 'USA'], region: 'Levante', state: 'aperto', pressure: 3,
  summary: 'Israele e gli USA premono per il disarmo.',
  trajectory: 'Se nessuno lo devia, il nodo scivola verso lo scontro.',
  triggers: ['attentato'],
};

describe('H07 — il filone diventa un segnale riconoscibile', () => {
  it('emette una chiave `storyline:<id>` con l’importanza dalla pressure', () => {
    const signals = buildRealitySignals(snapshotWith([filone]));
    const sig = signals.find(s => s.key === 'storyline:levante-disarmo-hamas');
    expect(sig).toBeTruthy();
    expect(sig!.importance).toBe(3);
    expect(sig!.reason).toContain('Il disarmo di Hamas');
  });

  it('NON porta factKey (un filone non è un fatto del motore)', () => {
    const sig = buildRealitySignals(snapshotWith([filone])).find(s => s.key.startsWith('storyline:'))!;
    expect(sig.factKeys).toEqual([]);
    // Ha però un riferimento canonico, che è ciò che lo rende validabile.
    expect(sig.sourceRefs).toEqual(['storylines.levante-disarmo-hamas']);
  });

  it('la sedia `esteri` diventa il dominio `diplomacy`, e tutte le sedi sono mappate', () => {
    expect(seatToSignalDomain('esteri')).toBe('diplomacy');
    expect(seatToSignalDomain('guerra')).toBe('military');
    expect(seatToSignalDomain('tesoro')).toBe('economy');
    for (const seat of CABINET_SEATS) {
      expect(typeof seatToSignalDomain(seat)).toBe('string');
    }
  });
});

describe('H07 — il filone è un anchor validabile', () => {
  it('compare fra gli anchor, così una `council_issue` con quella chiave risolve', () => {
    const anchors = buildCouncilProposalAnchors(snapshotWith([filone]));
    expect(anchors.some(a => a.key === 'storyline:levante-disarmo-hamas')).toBe(true);
  });

  it('senza filoni non compaiono anchor storyline', () => {
    const anchors = buildCouncilProposalAnchors(snapshotWith([]));
    expect(anchors.some(a => a.key.startsWith('storyline:'))).toBe(false);
  });
});

describe('H07 — il blocco nel prompt', () => {
  it('elenca i filoni con la chiave da usare e la direzione come tendenza', () => {
    const block = renderPlayerStorylines(snapshotWith([filone]))!;
    expect(block).toContain('[FILONI DEL MONDO');
    expect(block).toContain('[storyline:levante-disarmo-hamas]');
    expect(block).toContain('signalKeys');   // dice al modello come agganciare la proposta
    expect(block).toContain('tendenza, mai un fatto');
  });

  it('senza filoni non emette un blocco vuoto', () => {
    expect(renderPlayerStorylines(snapshotWith([]))).toBeUndefined();
  });
});
