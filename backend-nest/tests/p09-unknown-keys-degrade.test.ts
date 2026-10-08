/**
 * P09 — La chiave ignota **degrada**, non uccide.
 *
 * Il difetto (misurato su una generazione vera): il modello, senza le chiavi
 * canoniche sotto gli occhi, le **inventa**. Una sola chiave ignota faceva fallire
 * l'INTERA scheda: la proposta — titolo, domanda, **opzioni** — spariva, dopo che
 * il modello aveva già lavorato.
 *
 * Le due cose che devono convivere:
 *  - **una chiave inventata non si accetta MAI** (il risultato non la contiene);
 *  - **la scheda sopravvive** se resta almeno una fonte canonica, portando con sé
 *    le sue opzioni;
 *  - **fail-closed sul risultato**: se il modello ha dato SOLO chiavi ignote, la
 *    scheda muore ancora — non si inventa una fonte per salvarla.
 */
import { describe, it, expect } from 'vitest';
import { resolveCouncilIssue, parseCouncilIssues } from '../src/core/government/CouncilIssue';
import type { VerifiedWorldSnapshot } from '../src/core/government/VerifiedWorldSnapshot';

/** Snapshot con un fatto canonico e un segnale reale (`hostile-relations`). */
function snapshot(): VerifiedWorldSnapshot {
  return {
    schemaVersion: 1, gameId: 'g', branchId: null, date: '2000-06-01', turn: 3, polityId: 'ITA', polityName: 'Italia',
    geography: { ownedRegions: [], coastal: null, landlocked: null, borderingPolities: null },
    infrastructure: { ports: null, airfields: null, railways: null, roads: null, factories: null, constructionSites: null, other: null },
    military: { formations: [], formationCount: null, mobilized: null, mobilizations: [], manpower: null, equipment: {}, navalUnits: [], units: [], ships: [], fleets: [], fronts: [], locations: [], supply: { stock: null, monthlyNeeds: null } },
    economy: { treasury: 12, monthlyBalance: 1.5, debt: 100, revenue: 30, expenditure: 28.5, foodCoverageMonths: 6, resources: null, naturalResources: null, account: null, ongoingProjects: [] },
    diplomacy: { relations: [{ polityId: 'SRB', polityName: 'Serbia', relationship: 'hostile', sourceRef: 'r1' }], commitments: [], alliances: [], wars: null, sanctions: null, activeNegotiations: null },
    recent: { events: [], orders: [], consequences: [], decisions: [], followUps: null, signedActs: [] },
    changes: { available: false, reason: 'x', previousDate: null, previousTurn: null, comparedKeys: [], unavailableKeys: [], deltas: [] },
    facts: { treasury: { key: 'treasury', label: 'Tesoreria', value: '12 mld', rawValue: 12, source: 'national_economy', sourceRef: 'w' } },
    unavailable: [],
  } as unknown as VerifiedWorldSnapshot;
}

const OPZIONI = [
  { title: 'Canale discreto', content: 'Incarichiamo la Farnesina di un canale riservato con Belgrado per ridurre la tensione.' },
  { title: 'Linea ferma', content: 'Confermiamo la nostra posizione e coordiniamo la risposta con i partner europei.' },
];

describe('P09 — la scheda sopravvive a una chiave inventata', () => {
  it('una signalKey ignota NON uccide la scheda se resta un fatto canonico', () => {
    const issue = resolveCouncilIssue(snapshot(), {
      title: 'Rilancio nel Mezzogiorno', question: 'Usiamo la cassa?', options: OPZIONI,
      signalKeys: ['riforma-pensionistica-divide-maggioranza'], factKeys: ['treasury'], suggestedMinisters: ['lavori'],
    });
    expect(issue.title).toBe('Rilancio nel Mezzogiorno');
    // Le opzioni — la cosa che l'autore ha chiesto — sono salve.
    expect(issue.options).toHaveLength(2);
    // E la chiave inventata NON compare nel risultato (non si accetta mai).
    expect(issue.signalKeys ?? []).not.toContain('riforma-pensionistica-divide-maggioranza');
    expect(issue.verifiedFacts.map(f => f.key)).toContain('treasury');
  });

  it('una anchorKey ignota degrada allo stesso modo', () => {
    const issue = resolveCouncilIssue(snapshot(), {
      title: 'T', question: 'Q', options: OPZIONI,
      anchorKeys: ['capacity-inventata'], factKeys: ['treasury'], suggestedMinisters: ['tesoro'],
    });
    expect(issue.options).toHaveLength(2);
    expect(issue.anchorKeys ?? []).not.toContain('capacity-inventata');
  });

  it('una chiave ignota IN MEZZO a una valida: si scarta quella, si tiene quella', () => {
    const issue = resolveCouncilIssue(snapshot(), {
      title: 'T', question: 'Q', options: OPZIONI,
      signalKeys: ['hostile-relations', 'chiave-inventata'], suggestedMinisters: ['esteri'],
    });
    expect(issue.signalKeys).toEqual(['hostile-relations']);
    expect(issue.options).toHaveLength(2);
  });
});

describe('P09 — fail-closed: solo chiavi inventate → la scheda muore (non si inventa una fonte)', () => {
  it('chiavi tutte ignote e nessun fatto → InvalidCouncilIssueError che NOMINA la chiave', () => {
    // Mai in silenzio: il motivo dice quale chiave è stata scartata.
    expect(() => resolveCouncilIssue(snapshot(), {
      title: 'T', question: 'Q', options: OPZIONI,
      signalKeys: ['tutta-inventata'], suggestedMinisters: ['lavori'],
    })).toThrow(/Unknown reality signal key: tutta-inventata/);
  });

  it('nel parser la scheda di sole chiavi ignote viene scartata, con il motivo', () => {
    const testo = 'prosa\n```council_issue\n' + JSON.stringify({
      title: 'T', question: 'Q', options: OPZIONI, signalKeys: ['tutta-inventata'], suggestedMinisters: ['lavori'],
    }) + '\n```';
    const scartate: string[] = [];
    const { issues } = parseCouncilIssues(snapshot(), testo, 'advisor', { onDiscard: r => scartate.push(r) });
    expect(issues).toHaveLength(0);
    expect(scartate.length).toBe(1);
  });

  it('nel parser la scheda con una chiave buona E una inventata SOPRAVVIVE', () => {
    const testo = 'prosa\n```council_issue\n' + JSON.stringify({
      title: 'T', question: 'Q', options: OPZIONI,
      signalKeys: ['hostile-relations', 'inventata'], suggestedMinisters: ['esteri'],
    }) + '\n```';
    const { issues } = parseCouncilIssues(snapshot(), testo, 'advisor');
    expect(issues).toHaveLength(1);
    expect(issues[0].options).toHaveLength(2);
    expect(issues[0].signalKeys).toEqual(['hostile-relations']);
  });
});
