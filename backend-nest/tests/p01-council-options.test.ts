/**
 * P01 — La proposta del Consulente porta le **mosse**, non solo il problema.
 *
 * Difende le invarianti del piano PROPOSTE_CONSIGLIERE_PARITA_PAX.md:
 *  - P-I1 l'opzione è **prosa**, non un fatto: nessuna cifra, nessuna chiave;
 *  - P-I5 **retrocompatibilità**: una scheda senza `options` resta valida;
 *  - i limiti (2-5 opzioni, lunghezze) sono validati dallo schema, non dal prompt;
 *  - il protocollo chiede le opzioni e vieta «dovremmo/potremmo» (lo standard Pax).
 */
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import {
  councilIssueInputSchema, resolveCouncilIssue, parseCouncilIssues,
  COUNCIL_ANCHOR_PROTOCOL, COUNCIL_ISSUE_PROTOCOL,
  type CouncilOption,
} from '../src/core/government/CouncilIssue';
import type { VerifiedWorldSnapshot } from '../src/core/government/VerifiedWorldSnapshot';

const read = (rel: string) => fs.readFileSync(path.resolve(__dirname, '..', rel), 'utf8');

const opzione = (over: Partial<CouncilOption> = {}): CouncilOption => ({
  title: 'Costringerli a svelarsi', content: 'Dispieghiamo osservatori lungo il confine e chiediamo una sessione congiunta con il vicino.', ...over,
});

/** Snapshot minimo con un fatto canonico, per costruire proposte valide. */
function snapshotWithFacts(): VerifiedWorldSnapshot {
  return {
    schemaVersion: 1, gameId: 'g', branchId: null, date: '2000-01-01', turn: 1,
    polityId: 'ITA', polityName: 'Italia',
    geography: { ownedRegions: [], coastal: null, landlocked: null, borderingPolities: null },
    infrastructure: { ports: null, airfields: null, railways: null, roads: null, factories: null, constructionSites: null, other: null },
    military: { formations: [], formationCount: null, mobilized: null, mobilizations: [], manpower: null, equipment: {}, navalUnits: [], units: [], ships: [], fleets: [], fronts: [], locations: [], supply: { stock: null, monthlyNeeds: null } },
    economy: { treasury: 10, monthlyBalance: 1, debt: 5, revenue: 3, expenditure: 2, foodCoverageMonths: 6, resources: null, naturalResources: null, account: null, ongoingProjects: [] },
    diplomacy: { relations: [], commitments: [], alliances: [], wars: null, sanctions: null, activeNegotiations: null },
    recent: { events: [], orders: [], consequences: [], decisions: [], followUps: null, signedActs: [] },
    changes: { available: false, reason: 'x', previousDate: null, previousTurn: null, comparedKeys: [], unavailableKeys: [], deltas: [] },
    facts: { treasury: { key: 'treasury', label: 'Tesoreria', value: '10 mld', rawValue: 10, source: 'national_economy', sourceRef: 'worldState.resources.stock.money' } },
    unavailable: [],
  } as unknown as VerifiedWorldSnapshot;
}

describe('P01 — lo schema delle opzioni', () => {
  const base = { title: 'T', question: 'Q', suggestedMinisters: ['esteri'], factKeys: ['treasury'] };

  it('accetta 2-5 opzioni', () => {
    for (const n of [2, 3, 5]) {
      const options = Array.from({ length: n }, () => opzione());
      expect(councilIssueInputSchema.safeParse({ ...base, options }).success).toBe(true);
    }
  });

  it('rifiuta 1 opzione e 6 opzioni (non è un consiglio, è un ventaglio)', () => {
    expect(councilIssueInputSchema.safeParse({ ...base, options: [opzione()] }).success).toBe(false);
    expect(councilIssueInputSchema.safeParse({ ...base, options: Array.from({ length: 6 }, () => opzione()) }).success).toBe(false);
  });

  it('rifiuta un titolo troppo corto o un content troppo corto', () => {
    expect(councilIssueInputSchema.safeParse({ ...base, options: [opzione({ title: 'A' }), opzione()] }).success).toBe(false);
    expect(councilIssueInputSchema.safeParse({ ...base, options: [opzione({ content: 'corto' }), opzione()] }).success).toBe(false);
  });

  it('una scheda SENZA opzioni resta valida (P-I5)', () => {
    expect(councilIssueInputSchema.safeParse(base).success).toBe(true);
  });
});

describe('P01 — il resolver conserva le opzioni come prosa', () => {
  const snapshot = snapshotWithFacts();
  const raw = { title: 'Il confine', question: 'Come rispondiamo?', suggestedMinisters: ['esteri'], factKeys: ['treasury'], options: [opzione(), opzione({ title: 'Alzare il tono' })] };

  it('le opzioni passano nel risultato, titolo e content', () => {
    const issue = resolveCouncilIssue(snapshot, raw);
    expect(issue.options).toHaveLength(2);
    expect(issue.options![0].title).toBe('Costringerli a svelarsi');
    expect(issue.options![1].title).toBe('Alzare il tono');
  });

  it("un'opzione NON porta chiavi: non è una fonte di fatti (P-I1)", () => {
    const issue = resolveCouncilIssue(snapshot, raw);
    for (const option of issue.options ?? []) {
      expect(Object.keys(option).sort()).toEqual(['content', 'title']);
    }
  });

  it('una proposta senza opzioni resta senza opzioni (non inventate dal server)', () => {
    const issue = resolveCouncilIssue(snapshot, { ...raw, options: undefined });
    expect(issue.options).toBeUndefined();
  });
});

describe('P01 — il parser scarta le schede con opzioni malformate', () => {
  it('una scheda con una sola opzione viene rifiutata (fail-closed)', () => {
    const text = 'prosa\n```council_issue\n' + JSON.stringify({ title: 'T', question: 'Q', suggestedMinisters: ['esteri'], factKeys: ['treasury'], options: [opzione()] }) + '\n```';
    const discarded: string[] = [];
    const { issues } = parseCouncilIssues(snapshotWithFacts(), text, 'advisor', { onDiscard: r => discarded.push(r) });
    expect(issues).toHaveLength(0);
    expect(discarded.length).toBeGreaterThan(0);
  });

  it('una scheda valida con opzioni passa e conserva le mosse', () => {
    const text = 'prosa\n```council_issue\n' + JSON.stringify({ title: 'T', question: 'Q', suggestedMinisters: ['esteri'], factKeys: ['treasury'], options: [opzione(), opzione()] }) + '\n```';
    const { issues } = parseCouncilIssues(snapshotWithFacts(), text);
    expect(issues).toHaveLength(1);
    expect(issues[0].options).toHaveLength(2);
  });
});

describe('P01 — il protocollo chiede le mosse (qualità Pax)', () => {
  it('chiede 2-5 opzioni con titolo immersivo e content eseguibile', () => {
    expect(COUNCIL_ANCHOR_PROTOCOL).toContain('"options"');
    expect(COUNCIL_ANCHOR_PROTOCOL).toContain('2-5 mosse');
    expect(COUNCIL_ANCHOR_PROTOCOL).toContain('immersiva');
    expect(COUNCIL_ANCHOR_PROTOCOL).toContain('prima persona plurale');
  });

  it('vieta i verbi deboli e le cifre nelle opzioni', () => {
    expect(COUNCIL_ANCHOR_PROTOCOL).toContain('dovremmo');
    expect(COUNCIL_ANCHOR_PROTOCOL).toContain('nessuna cifra');
  });

  it('conserva lo standard qualitativo migrato da suggestions.ts (P06)', () => {
    // Le regole che erano in `buildSuggestionsQualityInstruction` e che, dopo la
    // cancellazione del file, vivono SOLO qui. Se sparissero, si perderebbe lo
    // standard di qualità che l'autore ha chiesto.
    expect(COUNCIL_ANCHOR_PROTOCOL).toContain('prosa da memoria di governo');
    expect(COUNCIL_ANCHOR_PROTOCOL).toContain('bollettino');
    expect(COUNCIL_ANCHOR_PROTOCOL).toContain('soddisfazione 32/100');
    expect(COUNCIL_ANCHOR_PROTOCOL).toContain('Non nominare anime del governo');
    expect(COUNCIL_ANCHOR_PROTOCOL).toContain('Non inventare guerre');
    expect(COUNCIL_ANCHOR_PROTOCOL).toContain('Non riproporre iniziative completate');
    // L'esempio di forma: la cosa più incisiva dello standard, non un ornamento.
    expect(COUNCIL_ANCHOR_PROTOCOL).toContain('Esempio di forma corretta');
    expect(COUNCIL_ANCHOR_PROTOCOL).toContain('osservatori neutrali');
  });

  it('l’esempio JSON del protocollo principale include options', () => {
    expect(COUNCIL_ISSUE_PROTOCOL).toContain('"options"');
  });

  it('guardia contro il falso verde: il protocollo esiste ed è lungo', () => {
    expect(COUNCIL_ANCHOR_PROTOCOL.length).toBeGreaterThan(200);
  });
});
