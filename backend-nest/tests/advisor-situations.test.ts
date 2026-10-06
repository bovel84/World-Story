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
  resolveAdvisorSituation, resolveFocusSituation, signalSituationTitle,
} from '../src/core/government/AdvisorSituations';
import { buildRealityAdvisorContext, buildRealityAdvisorPrompt } from '../src/core/government/RealityAdvisor';
import { ADVISOR_BRIEFING_SITUATION_PROTOCOL, ADVISOR_CONVERSATION_PROTOCOL } from '../src/core/government/CouncilIssue';

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

  it('una AdvisorSituation rappresenta un SOLO segnale: 2 signalKeys vengono rifiutate', () => {
    const snapshot = multi();
    expect(() => resolveAdvisorSituation(snapshot, {
      title: 'Tensioni regionali', summary: 'Sudan e Congo.',
      signalKeys: ['hostile-relations:SDN', 'hostile-relations:COD'],
    })).toThrow(/situazione non valida/i);
    const parsed = parseAdvisorSituations(snapshot, block('advisor_situation', {
      title: 'Tensioni regionali', summary: 'Sudan e Congo.',
      signalKeys: ['hostile-relations:SDN', 'hostile-relations:COD'],
    }));
    expect(parsed.situations).toEqual([]);
    // E restano due problemi distinti nella base deterministica.
    const titles = buildAdvisorSituations(snapshot).map(situation => situation.title);
    expect(titles).toContain('Tensioni con Sudan');
    expect(titles).toContain('Tensioni con Congo');
  });

  it('separa le situazioni dalle proposte: una situazione NON crea una CouncilIssue', () => {
    const snapshot = multi();
    const modelSituation = block('advisor_situation', { title: 'Tensioni al confine con il Sudan', summary: 'Il rapporto con il Sudan resta ostile.', signalKeys: ['hostile-relations:SDN'] });
    const modelIssue = block('council_issue', { title: 'Sicurezza al confine', question: 'Come rafforziamo il confine?', signalKeys: ['hostile-relations:SDN'], suggestedMinisters: ['guerra'] });
    const result = parseAdvisorResponse(snapshot, ['Quadro.', modelSituation, modelIssue].join('\n\n'), 'advisor', { includeDeterministicSituations: true });
    expect(result.reply).toBe('Quadro.');
    expect(result.issues).toHaveLength(1);
    expect(result.issues[0].title).toBe('Sicurezza al confine');
    // La base deterministica non sparisce: il modello non nasconde un segnale.
    expect(result.situations.length).toBeGreaterThanOrEqual(4);
    // La situazione del modello ha il titolo scelto; le altre restano reali.
    expect(result.situations.map(situation => situation.title)).toContain('Tensioni al confine con il Sudan');
    // Zero proposte resta valido.
    const noIssues = parseAdvisorResponse(snapshot, `Solo situazioni.\n${modelSituation}`, 'advisor', { includeDeterministicSituations: true });
    expect(noIssues.issues).toEqual([]);
    expect(noIssues.situations.length).toBeGreaterThanOrEqual(4);
  });

  it('apertura/turn briefing: la lista completa; chat normale: nessuna situazione automatica', () => {
    const snapshot = multi();
    // Apertura: `includeDeterministicSituations: true` → tutte le situazioni correnti.
    const opening = parseAdvisorResponse(snapshot, 'Il paese è sotto pressione.', 'advisor', { includeDeterministicSituations: true });
    expect(opening.issues).toEqual([]);
    expect(opening.situations.length).toBe(buildAdvisorSituations(snapshot).length);
    expect(opening.situations.length).toBeGreaterThanOrEqual(4);
    // Chat normale: default false → nessuna lista reiniettata.
    const chat = parseAdvisorResponse(snapshot, 'Il paese è sotto pressione.', 'advisor');
    expect(chat.issues).toEqual([]);
    expect(chat.situations).toEqual([]);
    // Chat normale con una nuova situazione esplicita del modello: solo quella.
    const one = parseAdvisorResponse(snapshot, `Nuova.\n${block('advisor_situation', { title: 'Tensioni con il Sudan', summary: 'Rapporto ostile.', signalKeys: ['hostile-relations:SDN'] })}`, 'advisor');
    expect(one.situations.map(situation => situation.title)).toEqual(['Tensioni con il Sudan']);
  });

  it('focusSituation: una sola signalKey canonica, chiave ignota → fail closed', () => {
    const snapshot = multi();
    const focus = resolveFocusSituation(snapshot, { id: 's-sudan', signalKey: 'hostile-relations:SDN' });
    expect(focus.signalKeys).toEqual(['hostile-relations:SDN']);
    expect(focus.title).toBe('Tensioni con Sudan');
    // Titolo e sintesi del client NON sono fonte di fatti: vengono ignorati.
    const spoofed = resolveFocusSituation(snapshot, { id: 's', signalKey: 'hostile-relations:SDN', title: 'Titolo inventato', summary: 'Fatti inventati' });
    expect(spoofed.title).toBe('Tensioni con Sudan');
    expect(spoofed.summary).not.toBe('Fatti inventati');
    expect(() => resolveFocusSituation(snapshot, { signalKey: 'non-esiste' })).toThrow(/Unknown reality signal key/);
    expect(() => resolveFocusSituation(snapshot, {})).toThrow(/situazione non valida/i);
  });

  it('il prompt chiede le situazioni solo in BRIEFING MODE, non in conversazione', () => {
    const snapshot = multi();
    const briefing = buildRealityAdvisorContext(snapshot, undefined, null, undefined, 'briefing');
    const briefingPrompt = buildRealityAdvisorPrompt(briefing.advisorContext, 'Apriamo il Governo.');
    expect(briefingPrompt).toContain(ADVISOR_BRIEFING_SITUATION_PROTOCOL);
    expect(briefingPrompt).not.toContain(ADVISOR_CONVERSATION_PROTOCOL);

    const chat = buildRealityAdvisorContext(snapshot, undefined, null, undefined, 'conversation');
    const chatPrompt = buildRealityAdvisorPrompt(chat.advisorContext, 'Come vanno le finanze?');
    expect(chatPrompt).toContain(ADVISOR_CONVERSATION_PROTOCOL);
    expect(chatPrompt).not.toContain(ADVISOR_BRIEFING_SITUATION_PROTOCOL);
    // La chat normale non chiede di rigenerare l'elenco delle situazioni.
    expect(chatPrompt).toMatch(/NON rigenerare l'elenco delle situazioni/);
  });

  it('con FOCUS SITUATION il prompt impone di non ripresentare il quadro nazionale', () => {
    const snapshot = multi();
    const focused = buildRealityAdvisorContext(snapshot, undefined, null, { signalKey: 'hostile-relations:SDN' }, 'conversation');
    const prompt = buildRealityAdvisorPrompt(focused.advisorContext, 'Approfondiamo il Sudan.');
    expect(prompt).toContain('[FOCUS SITUATION');
    expect(prompt).toContain('hostile-relations:SDN');
    expect(prompt).toMatch(/Non presentare nuovamente il quadro nazionale/);
    expect(prompt).not.toContain(ADVISOR_BRIEFING_SITUATION_PROTOCOL);
  });

  it('le decisioni già prese non sono situazioni da approfondire', () => {
    const snapshot = world({});
    snapshot.recent.decisions = [{ id: 'd1', title: 'Decreto infrastrutture', status: 'resolved', resolution: 'In vigore', resolvedDate: '2000-06-01' }];
    const titles = buildAdvisorSituations(snapshot).map(situation => situation.title);
    expect(titles).not.toContain('Decisioni recenti');
    expect(titles.some(title => title.includes('Decreto infrastrutture'))).toBe(false);
  });
});
