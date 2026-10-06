/**
 * WS-CONSULENTE-SITUAZIONI — La SITUAZIONE è un oggetto distinto dalla PROPOSTA.
 *
 * Difende: validazione canonica delle `signalKeys`, separazione `situations` /
 * `issues`, base deterministica che non nasconde un segnale reale, granularità
 * per entità (vicini ostili, opere in ritardo).
 */
import { describe, expect, it } from 'vitest';
import { buildVerifiedWorldSnapshot, type VerifiedWorldSnapshot } from '../src/core/government/VerifiedWorldSnapshot';
import { buildRealitySignals } from '../src/core/government/RealitySignals';
import {
  buildAdvisorSituations, MAX_ADVISOR_SITUATIONS, parseAdvisorResponse, parseAdvisorSituations,
  resolveAdvisorSituation, signalSituationTitle,
} from '../src/core/government/AdvisorSituations';

const block = (kind: string, value: unknown) => `\`\`\`${kind}\n${JSON.stringify(value)}\n\`\`\``;

type Options = {
  relationships?: Record<string, Record<string, string>>;
  polityNames?: Record<string, string>;
  ongoingProcesses?: Array<Record<string, unknown>>;
  account?: Record<string, unknown>;
  stock?: Record<string, number>;
};

function world(options: Options = {}): VerifiedWorldSnapshot {
  return buildVerifiedWorldSnapshot({
    gameData: {
      id: 'situations', playerPolityId: 'UGA', playerPolityName: 'Uganda', currentDate: '2000-06-01',
      world: { regions: { home: { id: 'home', name: 'Kampala', owner: 'UGA', coastal: false, objects: [] } } },
      worldState: {
        accounts: { UGA: options.account ?? { population: 10_000_000, socialTension: 65, stability: 20, monthlyBalance: -2, nominalGdpUsdBillions: 100, debtRatioPct: 40, debtServicePct: 5 } },
        resources: { stock: options.stock ?? { money: 1, food: 0.5, weapons: 1 }, needs: { food: 1 } },
        arsenal: { units: {} },
      },
      relationships: options.relationships ?? {},
      polityNames: options.polityNames,
      ongoingProcesses: options.ongoingProcesses ?? [],
    },
    commitments: [], operationalRows: [], foodCoverageMonths: 0.5,
  });
}

const multi = () => world({
  relationships: { UGA: { SDN: 'hostile', COD: 'hostile' } },
  polityNames: { SDN: 'Sudan', COD: 'Congo' },
  ongoingProcesses: [
    { id: 'p1', title: 'Ferrovia Kampala–Jinja', expectedDate: '2000-01-01' },
    { id: 'p2', title: 'Acquedotto del Nord', expectedDate: '2000-02-01' },
  ],
});

describe('WS-CONSULENTE-SITUAZIONI — AdvisorSituation', () => {
  it('deriva una situazione per ogni segnale reale, con titoli concreti', () => {
    const situations = buildAdvisorSituations(multi());
    expect(situations.length).toBeGreaterThanOrEqual(4);
    expect(situations.length).toBeLessThanOrEqual(MAX_ADVISOR_SITUATIONS);
    // Le entità distinte NON vengono aggregate in un unico problema.
    const titles = situations.map(situation => situation.title);
    expect(titles).toContain('Tensioni con Sudan');
    expect(titles).toContain('Tensioni con Congo');
    expect(titles).toContain('Ritardo: Ferrovia Kampala–Jinja');
    expect(titles).toContain('Ritardo: Acquedotto del Nord');
    // Mai titoli generici.
    for (const title of titles) expect(title).not.toMatch(/^(Economia|Difesa|Situazione diplomatica)$/i);
    // Ogni situazione è ancorata a un segnale reale.
    const keys = new Set(buildRealitySignals(multi()).map(signal => signal.key));
    for (const situation of situations) for (const key of situation.signalKeys) expect(keys.has(key)).toBe(true);
  });

  it('un solo rapporto ostile conserva la chiave legacy `hostile-relations`', () => {
    const snapshot = world({ relationships: { UGA: { SDN: 'hostile' } }, polityNames: { SDN: 'Sudan' } });
    const signal = buildRealitySignals(snapshot).find(item => item.key === 'hostile-relations')!;
    expect(signal).toBeTruthy();
    expect(signal.subject).toBe('Sudan');
    expect(signalSituationTitle(signal)).toBe('Tensioni con Sudan');
  });

  it('valida le signalKeys contro i segnali REALI: chiave ignota → scheda scartata', () => {
    const snapshot = multi();
    const valid = resolveAdvisorSituation(snapshot, { title: 'Tensioni al confine', summary: 'Rapporti ostili.', signalKeys: ['hostile-relations:SDN'] });
    expect(valid.signalKeys).toEqual(['hostile-relations:SDN']);
    expect(valid.importance).toBeGreaterThanOrEqual(2);
    expect(() => resolveAdvisorSituation(snapshot, { title: 'Inventata', summary: 'x', signalKeys: ['non-esiste'] })).toThrow(/Unknown reality signal key/);

    const reasons: string[] = [];
    const parsed = parseAdvisorSituations(snapshot, `Premessa.\n${block('advisor_situation', { title: 'Inventata', summary: 'x', signalKeys: ['non-esiste'] })}`, { onDiscard: reason => reasons.push(reason) });
    expect(parsed.reply).toBe('Premessa.');
    expect(parsed.situations).toEqual([]);
    expect(reasons.some(reason => reason.includes('Unknown reality signal key'))).toBe(true);
  });

  it('separa le situazioni dalle proposte: una situazione NON crea una CouncilIssue', () => {
    const snapshot = multi();
    const modelSituation = block('advisor_situation', { title: 'Tensioni al confine con il Sudan', summary: 'Il rapporto con il Sudan resta ostile.', signalKeys: ['hostile-relations:SDN'] });
    const modelIssue = block('council_issue', { title: 'Sicurezza al confine', question: 'Come rafforziamo il confine?', signalKeys: ['hostile-relations:SDN'], suggestedMinisters: ['guerra'] });
    const result = parseAdvisorResponse(snapshot, ['Quadro.', modelSituation, modelIssue].join('\n\n'), 'advisor');
    expect(result.reply).toBe('Quadro.');
    expect(result.issues).toHaveLength(1);
    expect(result.issues[0].title).toBe('Sicurezza al confine');
    // La base deterministica non sparisce: il modello non nasconde un segnale.
    expect(result.situations.length).toBeGreaterThanOrEqual(4);
    // La situazione del modello ha il titolo scelto; le altre restano reali.
    expect(result.situations.map(situation => situation.title)).toContain('Tensioni al confine con il Sudan');
    // Zero proposte resta valido.
    const noIssues = parseAdvisorResponse(snapshot, `Solo situazioni.\n${modelSituation}`, 'advisor');
    expect(noIssues.issues).toEqual([]);
    expect(noIssues.situations.length).toBeGreaterThanOrEqual(4);
  });

  it('senza blocchi del modello la base deterministica resta disponibile', () => {
    const result = parseAdvisorResponse(multi(), 'Il paese è sotto pressione.', 'advisor');
    expect(result.issues).toEqual([]);
    expect(result.situations.length).toBeGreaterThanOrEqual(4);
  });

  it('le decisioni già prese non sono situazioni da approfondire', () => {
    const snapshot = world({});
    snapshot.recent.decisions = [{ id: 'd1', title: 'Decreto infrastrutture', status: 'resolved', resolution: 'In vigore', resolvedDate: '2000-06-01' }];
    const titles = buildAdvisorSituations(snapshot).map(situation => situation.title);
    expect(titles).not.toContain('Decisioni recenti');
    expect(titles.some(title => title.includes('Decreto infrastrutture'))).toBe(false);
  });
});
