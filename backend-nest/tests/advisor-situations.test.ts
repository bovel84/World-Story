/**
 * WS-CONSULENTE-SITUAZIONI — La SITUAZIONE è un oggetto distinto dalla PROPOSTA.
 *
 * Difende: validazione canonica delle `signalKeys`, separazione `situations` /
 * `issues`, base deterministica che non nasconde un segnale reale, granularità
 * per entità (vicini ostili, opere in ritardo).
 */
import { describe, expect, it, vi } from 'vitest';
import { buildVerifiedWorldSnapshot, type VerifiedWorldSnapshot } from '../src/core/government/VerifiedWorldSnapshot';
import { advisorBriefingSentences, buildRealitySignals } from '../src/core/government/RealitySignals';
import {
  advisorReplyWithProposals, buildAdvisorSituations, mergeAdvisorSituations, MAX_ADVISOR_SITUATIONS, parseAdvisorResponse, parseAdvisorSituations,
  proposalMatchesSituation, resolveAdvisorSituation, resolveFocusSituation, serializeAdvisorResponse,
  signalSituationTitle, situationsOverlap, withAdvisorBriefingCoverage,
} from '../src/core/government/AdvisorSituations';
import { buildAdvisorBriefingRepairPrompt, repairAdvisorBriefing } from '../src/core/government/AdvisorBriefingRepair';
import { buildRealityAdvisorContext, buildRealityAdvisorPrompt, withAdvisorStrategicContext } from '../src/core/government/RealityAdvisor';
import { buildStrategicThreadEvidence } from '../src/core/government/StrategicThreads';
import { ADVISOR_BRIEFING_SITUATION_PROTOCOL, ADVISOR_CONVERSATION_PROTOCOL } from '../src/core/government/CouncilIssue';

const block = (kind: string, value: unknown) => `\`\`\`${kind}\n${JSON.stringify(value)}\n\`\`\``;

type Options = {
  relationships?: Record<string, Record<string, string>>;
  polityNames?: Record<string, string>;
  ongoingProcesses?: Array<Record<string, unknown>>;
  account?: Record<string, unknown>;
  stock?: Record<string, number>;
  date?: string;
  turn?: number;
};

function world(options: Options = {}): VerifiedWorldSnapshot {
  return buildVerifiedWorldSnapshot({
    gameData: {
      id: 'situations', playerPolityId: 'UGA', playerPolityName: 'Uganda', currentDate: options.date ?? '2000-06-01',
      ...(options.turn !== undefined ? { currentTurn: options.turn } : {}),
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

describe('Country X — strategic focus and historical continuity', () => {
  const context = {
    historicalBaseline: 'Alla data di divergenza il movimento ALPHA era attivo nella regione NORTH e riceveva sostegno politico oltre il confine con Y.',
    temporalScope: { initialDate: '2000-01-01', currentDate: '2000-01-01' },
  };
  const country = (turn = 1) => {
    const snapshot = buildVerifiedWorldSnapshot({ gameData: {
      id: 'country-x', playerPolityId: 'X', playerPolityName: 'Country X', currentDate: turn === 1 ? '2000-01-01' : '2000-02-01', currentTurn: turn,
      world: { regions: { north: { id: 'north', name: 'NORTH', owner: 'X', coastal: false, objects: [] } } },
      worldState: { accounts: { X: { population: 1_000_000, stability: 20 } }, resources: { stock: { food: 1 }, needs: { food: 1 } } },
      relationships: { X: { Y: 'hostile', Z: 'hostile' } },
    }, commitments: [], operationalRows: [] });
    snapshot.military.initialReadinessPct = 20;
    return snapshot;
  };
  const historicalKey = () => buildStrategicThreadEvidence(country(), context).find(item => item.kind === 'historical')!.key;
  const proposal = (signalKeys = ['stability', 'hostile-relations:Y']) => ({ id: 'alpha-north',
    title: 'Insurrezione di ALPHA nella regione NORTH', summary: 'Le tensioni oltre confine limitano la risposta alla crisi documentata nel nord.',
    signalKeys, evidenceKeys: [historicalKey()] });
  const event = (headline: string, id = 'event') => ({ id, date: '2000-02-01', headline, detail: null, sourceRef: `results.${id}`, sourceActionIds: [] });

  it('accetta il thread generico Country X / ALPHA / NORTH senza dipendenze da paesi reali', () => {
    const result = resolveAdvisorSituation(country(), proposal(), context);
    expect(result.id).toBe('alpha-north');
    expect(result.title).toBe('Insurrezione di ALPHA nella regione NORTH');
    expect(result.evidenceKeys).toEqual([historicalKey()]);
  });

  it('focus multi-signal: schema route, resolver e prompt conservano TUTTE le fonti', async () => {
    const { realityAdvisorSchema } = await import('../src/routes/games/schemas');
    const snapshot = country();
    const payload = { id: 'alpha-north', signalKeys: ['stability', 'hostile-relations:Y', 'hostile-relations:Z'], evidenceKeys: [historicalKey()] };
    const body = realityAdvisorSchema.parse({ focusSituation: { ...payload, title: 'FATTO CLIENT INVENTATO', summary: 'Non fidarsi' } });
    const focus = resolveFocusSituation(snapshot, body.focusSituation, context);
    expect(focus.id).toBe(payload.id);
    expect(focus.signalKeys).toEqual(payload.signalKeys);
    expect(focus.evidenceKeys).toEqual(payload.evidenceKeys);
    expect(focus.title).not.toBe('Stabilità interna');
    const prompt = buildRealityAdvisorPrompt({ ...buildRealityAdvisorContext(snapshot).advisorContext, ...context, focusSituation: focus }, 'Approfondisci questa situazione');
    expect(prompt).toContain('alpha-north');
    expect(prompt).toContain(context.historicalBaseline);
    for (const key of payload.signalKeys) expect(prompt).toContain(key);
    expect(prompt).not.toContain('FATTO CLIENT INVENTATO');
    expect(prompt).toContain('Non presentare nuovamente il quadro nazionale');
  });

  it('focus evidence-only è valido, ma fonti entrambe vuote o una chiave falsa falliscono chiuse', () => {
    const snapshot = country();
    const focus = resolveFocusSituation(snapshot, { id: 'constitutional-transition', signalKeys: [], evidenceKeys: [historicalKey()] }, context);
    expect(focus.signalKeys).toEqual([]);
    expect(focus.evidenceKeys).toEqual([historicalKey()]);
    expect(() => resolveFocusSituation(snapshot, { id: 'empty', signalKeys: [], evidenceKeys: [] }, context)).toThrow();
    expect(() => resolveFocusSituation(snapshot, { id: 'alpha', signalKeys: ['stability'], evidenceKeys: ['historical:inventato'] }, context)).toThrow();
    expect(() => resolveFocusSituation(snapshot, { id: 'alpha', signalKeys: ['inventato'], evidenceKeys: [historicalKey()] }, context)).toThrow();
  });

  it('turno 2: la baseline resta, un evento scolastico indipendente non la disabilita', () => {
    const snapshot = country(2);
    snapshot.recent.events = [event('Costruita una scuola')];
    expect(buildStrategicThreadEvidence(snapshot, context).some(item => item.key === historicalKey())).toBe(true);
    expect(resolveAdvisorSituation(snapshot, proposal(), context).id).toBe('alpha-north');
    expect(() => resolveAdvisorSituation(snapshot, proposal([]), context)).toThrow(/current|corrente|continu/i);
    expect(() => resolveFocusSituation(snapshot, { id: 'alpha-north', evidenceKeys: [historicalKey()] }, context)).toThrow();
    snapshot.recent.events.push(event('ALPHA continua le operazioni nella regione NORTH', 'continuity'));
    const continuity = buildStrategicThreadEvidence(snapshot, context).find(item => item.kind === 'history' && item.text.includes('ALPHA'))!;
    expect(resolveAdvisorSituation(snapshot, { ...proposal([]), evidenceKeys: [historicalKey(), continuity.key] }, context).id).toBe('alpha-north');
    const current = buildStrategicThreadEvidence(snapshot, context).find(item => item.kind === 'current')!;
    expect(resolveAdvisorSituation(snapshot, { ...proposal([]), evidenceKeys: [historicalKey(), current.key] }, context).id).toBe('alpha-north');
  });

  it('ALPHA disarmato: la sua vecchia evidence non viene riattivata da stability, altre baseline restano', () => {
    const snapshot = country(2);
    snapshot.recent.events = [event('ALPHA ha deposto le armi; crisi conclusa.')];
    const richer = { ...context, historicalBaseline: context.historicalBaseline + '\nLa transizione BETA era in corso nella regione SOUTH.' };
    expect(() => resolveAdvisorSituation(snapshot, proposal(['stability']), richer)).toThrow();
    expect(() => resolveFocusSituation(snapshot, { id: 'alpha-north', signalKeys: ['stability'], evidenceKeys: [historicalKey()] }, richer)).toThrow();
    expect(buildStrategicThreadEvidence(snapshot, richer).some(item => item.kind === 'historical' && item.text.includes('BETA'))).toBe(true);
  });

  it('una negazione o un proposito di disarmo non è una risoluzione', () => {
    const snapshot = country(2);
    snapshot.recent.events = [event('ALPHA non ha deposto le armi.')];
    snapshot.recent.signedActs = [{ id: 'act', text: 'ALPHA va disarmato: autorizzato un negoziato', status: 'signed_pending_execution', createdAt: snapshot.date! }];
    expect(resolveAdvisorSituation(snapshot, proposal(), context).id).toBe('alpha-north');
  });

  it('una risoluzione lontana non sparisce quando la cronaca recente viene troncata', () => {
    const snapshot = country(30);
    const base = { ...buildRealityAdvisorContext(snapshot).advisorContext, ...context };
    const results = Array.from({ length: 25 }, (_, index) => ({ id: `r${index}`, date: '2000-01-15', turn: index + 2,
      events: [index === 1 ? 'ALPHA ha deposto le armi; crisi conclusa.' : `Rapporto amministrativo ${index}`] }));
    const enriched = withAdvisorStrategicContext(base, context.temporalScope.initialDate, results, 'quadro');
    expect(() => resolveAdvisorSituation(snapshot, proposal(['stability']), enriched)).toThrow();
  });
});

describe('Strategic threads grounded in server evidence', () => {
  const baseline = "Alla vigilia della divergenza l'LRA era attivo nel nord, nelle aree di Gulu e Acholi. Il Sudan ne complicava la dimensione transfrontaliera.";
  const opening = () => world({ date: '2000-01-01', turn: 1, relationships: { UGA: { SDN: 'hostile', COD: 'hostile' } } });
  const context = { historicalBaseline: baseline, temporalScope: { initialDate: '2000-01-01', currentDate: '2000-01-01' } };
  const thread = (evidenceKeys: string[], signalKeys: string[] = []) => block('advisor_situation', {
    title: "Insurrezione dell'LRA nel nord", summary: 'Il controllo governativo a Gulu e Acholi resta il problema politico; risorse e rapporti regionali limitano le alternative.',
    signalKeys, evidenceKeys,
  });

  it('A/B: baseline + segnali → una situazione narrativa, senza duplicare le card tecniche coperte', () => {
    const snapshot = opening();
    const evidence = buildStrategicThreadEvidence(snapshot, context).find(item => item.kind === 'historical');
    expect(evidence).toBeDefined();
    const signals = ['hostile-relations:SDN', 'stability'];
    const parsed = parseAdvisorResponse(snapshot, thread([evidence!.key], signals), 'advisor', { strategicContext: context, includeDeterministicSituations: true });
    const narrative = parsed.situations.find(item => item.title.includes('LRA'))!;
    expect(narrative.signalKeys).toEqual(signals);
    expect(narrative.evidenceKeys).toEqual([evidence!.key]);
    expect(parsed.situations.filter(item => item.signalKeys.some(key => signals.includes(key)))).toEqual([narrative]);
    expect(parsed.situations.some(item => item.signalKeys.includes('hostile-relations:COD'))).toBe(true);
  });

  it('la baseline pertinente può fondare un thread senza forzare una signalKey', () => {
    const snapshot = opening();
    const evidence = buildStrategicThreadEvidence(snapshot, context).find(item => item.kind === 'historical')!;
    const result = parseAdvisorResponse(snapshot, thread([evidence.key]), 'advisor', { strategicContext: context, includeDeterministicSituations: true });
    expect(result.situations.find(item => item.title.includes('LRA'))?.signalKeys).toEqual([]);
    const again = parseAdvisorResponse(snapshot, serializeAdvisorResponse(result), 'advisor', { strategicContext: context });
    expect(again.situations).toEqual(result.situations);
  });

  it('C: due problemi distinti restano due thread anche con segnali generici comuni', () => {
    const snapshot = opening();
    const evidence = buildStrategicThreadEvidence(snapshot, context).find(item => item.kind === 'historical')!;
    const parsed = parseAdvisorSituations(snapshot, thread([evidence.key], ['hostile-relations:SDN']) + block('advisor_situation', {
      title: 'Coinvolgimento nella guerra del Congo', summary: 'Il rapporto con il Congo richiede una scelta distinta.', signalKeys: ['hostile-relations:COD'],
    }), { strategicContext: context });
    expect(parsed.situations).toHaveLength(2);
    expect(mergeAdvisorSituations(snapshot, parsed.situations).filter(item => /LRA|Congo/.test(item.title))).toHaveLength(2);
  });

  it('un’opportunità senza alert conserva la proposta e il collegamento nel doppio parsing', async () => {
    const snapshot = world({ date: '2000-01-01', turn: 1,
      account: { population: 10_000_000, socialTension: 20, stability: 80, monthlyBalance: 2, debtRatioPct: 40, debtServicePct: 5 },
    });
    snapshot.facts.foodCoverageMonths.rawValue = 5;
    snapshot.facts.foodCoverageMonths.value = '5 mesi';
    expect(buildAdvisorSituations(snapshot)).toEqual([]);
    const strategicContext = { ...context, historicalBaseline: 'Alla divergenza la cooperazione EAC offriva opportunità di integrazione regionale.' };
    const evidence = buildStrategicThreadEvidence(snapshot, strategicContext).find(item => item.kind === 'historical')!;
    const text = 'Possiamo discutere una cooperazione regionale subordinata alle risorse disponibili.\n'
      + block('advisor_situation', { id: 'integrazione', title: 'Integrazione economica regionale', summary: 'La cooperazione regionale offre una direzione politica, non un accordo già concluso.', kind: 'opportunity', signalKeys: [], evidenceKeys: [evidence.key] })
      + block('council_issue', { title: 'Mandato commerciale', question: 'Autorizzare Esteri a proporre un negoziato commerciale regionale subordinato alla copertura del Tesoro?', situationId: 'integrazione', factKeys: ['treasury'], suggestedMinisters: ['esteri', 'tesoro'] });
    const { PromptEngine } = await import('../src/prompt-builder');
    const generate = vi.fn(async () => ({ content: text }));
    const engine = new PromptEngine({ generate } as never);
    const serialized = await engine.getAdvisor({ id: 'threads', currentDate: snapshot.date, currentTurn: 1,
      world: { name: 'Uganda', startDate: snapshot.date, prompts: {}, regions: { home: { id: 'home', name: 'Kampala', owner: 'UGA', objects: [] } } },
      players: [{ id: 'p', name: 'Presidente', regionId: 'home', polityId: 'UGA' }], playerPolityId: 'UGA', actions: [], results: [],
      advisorContext: { ...buildRealityAdvisorContext(snapshot).advisorContext, ...strategicContext } } as never, 'fammi il quadro');
    const parsed = parseAdvisorResponse(snapshot, serialized, 'advisor', { strategicContext });
    // One existing opportunity remains valid; the advisor may seek another.
    expect(generate).toHaveBeenCalledTimes(2);
    expect(parsed.situations[0].kind).toBe('opportunity');
    expect(parsed.situations[0].importance).toBe(1);
    expect(parsed.issues[0].situationId).toBe('integrazione');
    expect(withAdvisorBriefingCoverage(snapshot, parsed).briefingCoverage?.complete).toBe(true);
  });

  it('F: una decisione risolta corrente impedisce di promuovere la baseline a presente', () => {
    const snapshot = opening();
    const key = buildStrategicThreadEvidence(snapshot, context).find(item => item.kind === 'historical')!.key;
    snapshot.recent.decisions = [{ id: 'pace', title: 'Fine della crisi nel nord', status: 'resolved', resolution: 'LRA disarmato', resolvedDate: snapshot.date }];
    const parsed = parseAdvisorSituations(snapshot, thread([key], ['stability']), { strategicContext: context, onDiscard: () => {} });
    expect(parsed.situations).toEqual([]);
  });

  it('G: dopo i turni neppure un segnale generico riattiva una crisi della baseline', () => {
    const key = buildStrategicThreadEvidence(opening(), context).find(item => item.kind === 'historical')!.key;
    const snapshot = world({ date: '2005-01-01', turn: 9 });
    const strategicContext = { ...context, strategicHistory: [{ id: 'pace', date: '2001-01-01', headline: 'LRA disarmato: crisi risolta', detail: null, sourceRef: 'results.pace', sourceActionIds: [] }] };
    expect(parseAdvisorSituations(snapshot, thread([key], ['stability']), { strategicContext, onDiscard: () => {} }).situations).toEqual([]);
    expect(buildStrategicThreadEvidence(snapshot, strategicContext).some(item => item.kind === 'history')).toBe(true);
  });

  it('H: senza risposta LLM il fallback resta esclusivamente deterministico', () => {
    const snapshot = opening();
    expect(parseAdvisorResponse(snapshot, '', 'advisor', { strategicContext: context, includeDeterministicSituations: true }).situations).toEqual(buildAdvisorSituations(snapshot));
  });

  it('riferimenti inventati non sono salvati da un segnale valido', () => {
    expect(parseAdvisorSituations(opening(), thread(['historical:inventato'], ['stability']), { strategicContext: context, onDiscard: () => {} }).situations).toEqual([]);
  });
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

  it('A: più segnali correlati formano UNA situazione con più signalKeys (1-5)', () => {
    const snapshot = multi();
    const nonDecision = buildRealitySignals(snapshot).filter(signal => signal.domain !== 'decision');
    const realKeys = nonDecision.map(signal => signal.key).slice(0, 3);
    expect(realKeys.length).toBeGreaterThanOrEqual(2);
    const grouped = resolveAdvisorSituation(snapshot, {
      title: 'Minaccia dell\'LRA nel nord', summary: 'L\'insicurezza nel nord pesa su stabilità, forze e rapporti col vicino.', signalKeys: realKeys,
    });
    expect(grouped.signalKeys).toEqual(realKeys);
    expect(grouped.importance).toBe(Math.max(...nonDecision.filter(signal => realKeys.includes(signal.key)).map(signal => signal.importance)));
    const parsed = parseAdvisorSituations(snapshot, block('advisor_situation', {
      title: 'Minaccia dell\'LRA nel nord', summary: 'L\'insicurezza nel nord pesa su stabilità, forze e rapporti col vicino.', signalKeys: realKeys,
    }));
    expect(parsed.situations).toHaveLength(1);
    expect(parsed.situations[0].signalKeys).toEqual(realKeys);
    // Il limite resta 5: sei chiavi valide non sono un unico problema politico.
    const tooMany = buildRealitySignals(snapshot).map(signal => signal.key).slice(0, 6);
    if (tooMany.length === 6) expect(() => resolveAdvisorSituation(snapshot, { title: 'x', summary: 'y', signalKeys: tooMany })).toThrow(/situazione non valida/i);
  });

  it('B: due vicini ostili non correlati restano due situazioni distinte', () => {
    const snapshot = multi();
    expect(buildAdvisorSituations(snapshot).map(situation => situation.title)).toEqual(expect.arrayContaining(['Tensioni con Sudan', 'Tensioni con Congo']));
    const parsed = parseAdvisorSituations(snapshot, [
      block('advisor_situation', { title: 'Tensioni con il Sudan', summary: 'Rapporto ostile.', signalKeys: ['hostile-relations:SDN'] }),
      block('advisor_situation', { title: 'Pressione al confine con il Congo', summary: 'Rapporto ostile.', signalKeys: ['hostile-relations:COD'] }),
    ].join('\n'));
    expect(parsed.situations).toHaveLength(2);
    expect(situationsOverlap(parsed.situations[0], parsed.situations[1])).toBe(false);
  });

  it('D: una signalKey inventata scarta l\'intera situazione (fail closed)', () => {
    const snapshot = multi();
    const reasons: string[] = [];
    const parsed = parseAdvisorSituations(snapshot, block('advisor_situation', {
      title: 'Crisi inventata', summary: 'x', signalKeys: ['hostile-relations:SDN', 'non-esiste'],
    }), { onDiscard: reason => reasons.push(reason) });
    expect(parsed.situations).toEqual([]);
    expect(reasons.some(reason => reason.includes('Unknown reality signal key'))).toBe(true);
  });

  it('deduplicazione per sovrapposizione di signalKeys, mai per titolo', () => {
    expect(situationsOverlap({ signalKeys: ['a', 'b'] }, { signalKeys: ['a', 'b', 'c'] })).toBe(true);
    expect(situationsOverlap({ signalKeys: ['a', 'b'] }, { signalKeys: ['c', 'd'] })).toBe(false);
    const snapshot = multi();
    const parsed = parseAdvisorSituations(snapshot, [
      block('advisor_situation', { title: 'Insurrezione nel nord', summary: 'x', signalKeys: ['hostile-relations:SDN', 'food-coverage'] }),
      block('advisor_situation', { title: 'Minaccia LRA a Gulu', summary: 'y', signalKeys: ['food-coverage', 'hostile-relations:SDN'] }),
    ].join('\n'));
    expect(parsed.situations).toHaveLength(1);
  });

  it('separa le situazioni dalle proposte: una situazione NON crea una CouncilIssue', () => {
    const snapshot = multi();
    const modelSituation = block('advisor_situation', { title: 'Tensioni al confine con il Sudan', summary: 'Il rapporto con il Sudan resta ostile.', signalKeys: ['hostile-relations:SDN'] });
    const modelIssue = block('council_issue', { title: 'Sicurezza al confine', question: 'Autorizzare il dispiegamento delle forze disponibili al confine?', signalKeys: ['hostile-relations:SDN'], suggestedMinisters: ['guerra'] });
    const result = parseAdvisorResponse(snapshot, ['Quadro.', modelSituation, modelIssue].join('\n\n'), 'advisor');
    expect(result.reply).toBe('Quadro.');
    expect(result.issues).toHaveLength(1);
    expect(result.issues[0].title).toBe('Sicurezza al confine');
    expect(result.situations).toHaveLength(1);
    // La situazione del modello ha il titolo scelto; le altre restano reali.
    expect(result.situations.map(situation => situation.title)).toContain('Tensioni al confine con il Sudan');
    // Nessuna proposta inventata: il briefing rimane esplicitamente incompleto.
    const noIssues = parseAdvisorResponse(snapshot, `Solo situazioni.\n${modelSituation}`, 'advisor', { includeDeterministicSituations: true });
    expect(noIssues.issues).toEqual([]);
    expect(noIssues.situations.length).toBeGreaterThanOrEqual(4);
    expect(noIssues.reply).not.toContain('Briefing incompleto');
    expect(noIssues.briefingCoverage?.complete).toBe(false);
  });

  it('A/F: tre situazioni reali conservano tre proposte, una per signalKey canonica', () => {
    const snapshot = world({
      account: { population: 10_000_000, socialTension: 20, stability: 75, monthlyBalance: 0, nominalGdpUsdBillions: 100, debtRatioPct: 40, debtServicePct: 5 },
      relationships: { UGA: { SDN: 'hostile', COD: 'hostile' } },
      polityNames: { SDN: 'Sudan', COD: 'Congo' },
    });
    expect(buildRealitySignals(snapshot)).toHaveLength(3);
    const proposals = [
      { title: 'Mandato Sudan', question: 'Autorizzare Esteri ad aprire negoziati di non aggressione con il Sudan?', signalKeys: ['hostile-relations:SDN'], suggestedMinisters: ['esteri'] },
      { title: 'Mandato Congo', question: 'Incaricare Esteri di proporre al Congo un meccanismo bilaterale di verifica degli incidenti?', signalKeys: ['hostile-relations:COD'], suggestedMinisters: ['esteri'] },
      { title: 'Approvvigionamento alimentare', question: 'Autorizzare acquisti straordinari di alimenti subordinati alla copertura del Tesoro?', signalKeys: ['food-coverage'], suggestedMinisters: ['tesoro'] },
    ];
    const proposal = block('council_issue', proposals[0]);
    const result = parseAdvisorResponse(snapshot, ['Quadro.', ...proposals.map(p => block('council_issue', p))].join('\n'), 'advisor', { includeDeterministicSituations: true });
    expect(result.situations).toHaveLength(3);
    expect(result.issues).toHaveLength(3);
    for (const situation of result.situations) {
      expect(result.issues.some(issue => issue.signalKeys?.includes(situation.signalKeys[0]))).toBe(true);
    }
    expect(result.briefingCoverage).toEqual({ complete: true, missingSignalKeys: [], missingOpportunity: false });
    expect(result.reply).toBe('Quadro.');
    // Una sola proposta con tutti i tag non soddisfa la copertura delle tre situazioni.
    const tagged = parseAdvisorResponse(snapshot, block('council_issue', { ...proposals[0], signalKeys: proposals.flatMap(p => p.signalKeys) }), 'advisor', { includeDeterministicSituations: true });
    expect(tagged.issues).toHaveLength(1);
    expect(tagged.briefingCoverage?.missingSignalKeys).toHaveLength(2);
    expect(tagged.briefingCoverage?.complete).toBe(false);
    // La stessa decisione concreta resta ammessa in conversazione/focus.
    expect(parseAdvisorResponse(snapshot, proposal, 'president').issues).toHaveLength(1);
    expect(advisorBriefingSentences(snapshot)).not.toMatch(/chiederei|darei|sonderei|farei|eviterei|ridurrei/i);
  });

  it.each(['Valutare', 'Verificare', 'Approfondire', 'Monitorare', 'Studiare', 'Sondare informalmente', 'Proporre di valutare', 'Autorizzare una verifica sulle'])('scarta una proposta solo istruttoria: %s', verb => {
    const proposal = block('council_issue', { title: 'Distensione', question: `${verb} le possibilità di distensione: nessun costo quantificato, è una verifica.`, signalKeys: ['hostile-relations:SDN'], suggestedMinisters: ['esteri'] });
    expect(parseAdvisorResponse(multi(), proposal, 'president').issues).toEqual([]);
    const briefing = parseAdvisorResponse(multi(), proposal, 'advisor', { includeDeterministicSituations: true });
    expect(briefing.issues).toEqual([]);
    expect(briefing.briefingCoverage?.complete).toBe(false);
    // Il filtro è del Consulente, non altera il percorso dei ministri.
    expect(parseAdvisorResponse(multi(), proposal, 'minister').issues).toHaveLength(1);
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

  it('B: alternative concrete distinte restano; duplicati e proposte istruttorie non contano', () => {
    const snapshot = multi();
    const proposal = { title: 'Sicurezza Sudan', signalKeys: ['hostile-relations:SDN'], suggestedMinisters: ['esteri', 'guerra'] };
    const questions = [
      'Autorizzare Esteri ad aprire negoziati formali con il Sudan sulla sicurezza di frontiera?',
      'Incaricare Esteri e Guerra di presentare entro il prossimo turno un piano congiunto per la sicurezza di frontiera con il Sudan?',
      'Monitorare i rapporti con il Sudan?',
    ];
    const result = parseAdvisorResponse(snapshot, questions.concat(questions[0]).map(question => block('council_issue', { ...proposal, question })).join('\n'), 'advisor', { includeDeterministicSituations: true });
    expect(result.issues.map(issue => issue.question)).toEqual(questions.slice(0, 2));
    expect(result.briefingCoverage?.missingSignalKeys).not.toContain('hostile-relations:SDN');
    expect(result.briefingCoverage?.missingSignalKeys).toContain('hostile-relations:COD');
    expect(result.reply).not.toContain('Briefing incompleto');
    const roundTrip = parseAdvisorResponse(snapshot, serializeAdvisorResponse(result), 'advisor', { includeDeterministicSituations: true });
    expect(roundTrip.reply).toBe(result.reply);
    expect(roundTrip.briefingCoverage).toEqual(result.briefingCoverage);
    expect(roundTrip.issues).toEqual(result.issues);
    // Il merge ordina per titolo le schede del modello; identità e contenuto restano intatti.
    expect(roundTrip.situations).toHaveLength(result.situations.length);
    expect(roundTrip.situations).toEqual(expect.arrayContaining(result.situations));
  });

  it('D: senza crisi una proposta fondata su un anchor basta; senza proposta il briefing è incompleto', () => {
    const snapshot = world({ account: { socialTension: 20, stability: 80, monthlyBalance: 2, nominalGdpUsdBillions: 100 } });
    snapshot.facts.foodCoverageMonths.rawValue = 5;
    snapshot.facts.foodCoverageMonths.value = '5 mesi';
    expect(buildAdvisorSituations(snapshot)).toEqual([]);
    const proposal = block('council_issue', {
      title: 'Riserva alimentare', question: 'Autorizzare un programma di incremento della riserva alimentare subordinato alla copertura del Tesoro?',
      anchorKeys: ['capacity-economy'], suggestedMinisters: ['tesoro'],
      verifiedFacts: [{ key: 'invented', value: '999' }], sourceRefs: ['forged'],
    });
    const result = parseAdvisorResponse(snapshot, `Il margine di bilancio offre una possibilità.\n${proposal}`, 'advisor', { includeDeterministicSituations: true });
    expect(result.issues).toHaveLength(1);
    expect(result.issues[0].anchorKeys).toEqual(['capacity-economy']);
    expect(result.issues[0].sourceRefs).not.toContain('forged');
    expect(result.issues[0].verifiedFacts.some(fact => fact.key === 'invented')).toBe(false);
    expect(result.briefingCoverage?.complete).toBe(true);
    const missing = parseAdvisorResponse(snapshot, 'Nessuna crisi.', 'advisor', { includeDeterministicSituations: true });
    expect(missing.briefingCoverage?.missingOpportunity).toBe(true);
    expect(missing.reply).not.toContain('Briefing incompleto');
    expect(missing.issues).toEqual([]);
  });

  it('E/F: atto già firmato o chiave inventata non coprono una situazione', () => {
    const snapshot = multi();
    const question = 'Autorizzare negoziati con il Sudan';
    snapshot.recent.signedActs = [{ id: 'signed', text: question, status: 'signed_pending_execution', createdAt: '2000-05-01' }];
    const reasons: string[] = [];
    const result = parseAdvisorResponse(snapshot, [
      block('council_issue', { title: 'Mandato Sudan', question, signalKeys: ['hostile-relations:SDN'], suggestedMinisters: ['esteri'] }),
      block('council_issue', { title: 'Inventata', question: 'Autorizzare un negoziato?', signalKeys: ['invented'], suggestedMinisters: ['esteri'] }),
    ].join('\n'), 'advisor', { includeDeterministicSituations: true, onDiscard: reason => reasons.push(reason) });
    expect(result.issues).toEqual([]);
    expect(reasons.join(' ')).toMatch(/Decision already signed.*Unknown reality signal key/);
    expect(result.briefingCoverage?.missingSignalKeys).toContain('hostile-relations:SDN');
    expect(result.situations).toHaveLength(buildAdvisorSituations(snapshot).length);
  });

  it('fallback senza LLM o senza basi canoniche dichiara il briefing incompleto senza inventare proposte', () => {
    for (const snapshot of [multi(), buildVerifiedWorldSnapshot({ gameData: { id: 'empty' }, commitments: [], operationalRows: [] })]) {
      const result = buildRealityAdvisorContext(snapshot, undefined, null, undefined, 'briefing');
      expect(result.issues).toEqual([]);
      expect(result.briefingCoverage?.complete).toBe(false);
      expect(result.reply).not.toContain('Briefing incompleto');
      expect(result.advisorContext.governmentBrief).not.toContain('Briefing incompleto');
    }
  });

  it('oltre otto situazioni: prompt e doppio parsing non tagliano le ultime proposte del briefing', async () => {
    const codes = Array.from({ length: 10 }, (_, index) => `NPC${index}`);
    const snapshot = world({ relationships: { UGA: Object.fromEntries(codes.map(code => [code, 'hostile'])) } });
    const proposals = codes.map(code => block('council_issue', { title: `Mandato ${code}`, question: `Autorizzare un negoziato di non aggressione con ${code}?`, signalKeys: [`hostile-relations:${code}`], suggestedMinisters: ['esteri'] }));
    const parsed = parseAdvisorResponse(snapshot, proposals.join('\n'), 'advisor', { includeDeterministicSituations: true });
    expect(parsed.issues).toHaveLength(10);
    const prompt = buildRealityAdvisorPrompt(buildRealityAdvisorContext(snapshot, undefined, null, undefined, 'briefing').advisorContext, 'Apriamo.');
    for (const situation of parsed.situations) expect(prompt).toContain(situation.signalKeys[0]);
    const { PromptEngine } = await import('../src/prompt-builder');
    const generate = vi.fn(async () => ({ content: proposals.join('\n') }));
    const engine = new PromptEngine({ generate } as never);
    const text = await engine.getAdvisor({
      id: 'briefing-test', currentDate: snapshot.date, currentTurn: 1,
      world: { name: 'Uganda', startDate: snapshot.date, prompts: {}, regions: { home: { id: 'home', name: 'Kampala', owner: 'UGA', objects: [] } } },
      players: [{ id: 'p', name: 'Presidente', regionId: 'home', polityId: 'UGA' }],
      playerPolityId: 'UGA', actions: [], results: [],
      advisorContext: buildRealityAdvisorContext(snapshot, undefined, null, undefined, 'briefing').advisorContext,
    } as never, 'Apriamo.');
    // A fully covered crisis agenda can still lack opportunity proposals.
    // One targeted repair is allowed; the ten existing decisions survive.
    expect(generate).toHaveBeenCalledTimes(2);
    expect(parseAdvisorResponse(snapshot, text, 'advisor', { includeDeterministicSituations: true }).issues).toHaveLength(10);
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
    expect(briefingPrompt).not.toContain('council_issue = 0');
    expect(briefingPrompt).toContain('almeno una proposta concreta per ogni situazione');
    expect(briefingPrompt).toContain('COUNCIL PROPOSAL ANCHORS');
    expect(briefingPrompt).toContain('DEVI emettere');

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
    // La base deterministica contiene Congo e i ritardi, ma la risposta in focus no.
    const baseTitles = buildAdvisorSituations(snapshot).map(situation => situation.title);
    expect(baseTitles.some(title => title.includes('Congo'))).toBe(true);
    const focusedReply = parseAdvisorResponse(snapshot, 'Approfondiamo il Sudan: il rapporto resta teso.', 'advisor');
    expect(focusedReply.situations).toEqual([]);
  });

  it('le decisioni già prese non sono situazioni da approfondire', () => {
    const snapshot = world({});
    snapshot.recent.decisions = [{ id: 'd1', title: 'Decreto infrastrutture', status: 'resolved', resolution: 'In vigore', resolvedDate: '2000-06-01' }];
    const titles = buildAdvisorSituations(snapshot).map(situation => situation.title);
    expect(titles).not.toContain('Decisioni recenti');
    expect(titles.some(title => title.includes('Decreto infrastrutture'))).toBe(false);
  });

  it('C: la HistoricalBaseline dà attori reali alla situazione senza diventare current state', () => {
    const snapshot = multi();
    // Il modello può intitolare/sintetizzare con attori e luoghi storici realmente esistenti.
    const parsed = parseAdvisorSituations(snapshot, block('advisor_situation', {
      title: 'Minaccia dell\'LRA nel nord',
      summary: 'L\'insurrezione dell\'LRA continua a premere sul controllo governativo nell\'area di Gulu, mentre il rapporto con Khartoum complica la risposta.',
      signalKeys: ['hostile-relations:SDN'],
    }));
    expect(parsed.situations[0].title).toBe('Minaccia dell\'LRA nel nord');
    const baseline = 'Dalla fine degli anni Ottanta l\'insurrezione dell\'LRA insanguinava il nord del paese; Gulu divenne il centro della crisi e Khartoum sostenne gruppi armati.';
    const context = buildRealityAdvisorContext(snapshot, undefined, baseline, undefined, 'briefing').advisorContext;
    const prompt = buildRealityAdvisorPrompt(context, 'Apriamo il Governo.');
    expect(prompt).toContain('[HISTORICAL BASELINE');
    expect(prompt).toContain('LRA');
    // La baseline è materiale di contesto: il modello è autorizzato a usare attori reali...
    expect(prompt).toContain('attori o luoghi reali pertinenti');
    // ...ma la gerarchia resta rigida.
    expect(prompt).toContain('CURRENT STATE > PLAYER HISTORY > HISTORICAL BASELINE');
    expect(prompt).toContain('non trasformare un dato storico in un fatto corrente');
  });

  it('E: una situazione con 3 signalKeys è coperta da una proposta su una delle chiavi principali', () => {
    const snapshot = multi();
    const realKeys = buildRealitySignals(snapshot).filter(signal => signal.domain !== 'decision').map(signal => signal.key).slice(0, 3);
    const situationBlock = block('advisor_situation', { title: 'Crisi di sicurezza nel nord', summary: 'Insicurezza, forze sotto pressione e rapporti col vicino.', signalKeys: realKeys });
    const issue = block('council_issue', { title: 'Operazione limitata nel nord', question: 'Autorizzare un\'operazione limitata delle forze disponibili nelle aree colpite?', signalKeys: [realKeys[0]], suggestedMinisters: ['guerra'] });
    const result = parseAdvisorResponse(snapshot, [situationBlock, issue].join('\n'), 'advisor', { includeDeterministicSituations: true });
    const situation = result.situations.find(item => item.signalKeys.length === 3)!;
    expect(situation).toBeTruthy();
    expect(result.issues).toHaveLength(1);
    expect(result.issues[0].signalKeys).toContain(realKeys[0]);
    expect(result.briefingCoverage?.missingSignalKeys).not.toContain(realKeys[0]);
  });

  it('F: dopo alcuni turni il prompt fa pesare la player history più della baseline', () => {
    const snapshot = world({ date: '2005-06-01', turn: 8 });
    const base = buildRealityAdvisorContext(snapshot, undefined, 'Il paese usciva da decenni di conflitti e instabilità.').advisorContext;
    const context = withAdvisorStrategicContext(base, '2000-01-01', [{ id: 'r1', turn: 2, date: '2003-01-01', events: ['Il Presidente ha riformato l\'esercito'], narration: '' }], 'riforma');
    const prompt = buildRealityAdvisorPrompt(context, 'Come procede la riforma?');
    expect(prompt).toContain('[CRONACA STRATEGICA');
    expect(prompt).toContain('Il Presidente ha riformato l\'esercito');
    expect(prompt).toContain('dopo alcuni turni PLAYER HISTORY pesa di più');
    expect(prompt).toContain('dopo anni domina');
    expect(prompt).toContain('CURRENT STATE > PLAYER HISTORY > HISTORICAL BASELINE');
  });

  it('G: il fallback deterministico non inventa storia né raggruppa da solo', () => {
    const snapshot = multi();
    const result = buildRealityAdvisorContext(snapshot, undefined, null, undefined, 'briefing');
    expect(result.issues).toEqual([]);
    expect(result.briefingCoverage?.complete).toBe(false);
    expect(result.reply).not.toContain('Briefing incompleto');
    const titles = result.situations.map(situation => situation.title);
    expect(titles).toContain('Tensioni con Sudan');
    expect(titles).not.toContain('Minaccia dell\'LRA nel nord');
    // Il fallback resta una scheda per segnale: nessuna narrazione inventata.
    for (const situation of result.situations) expect(situation.signalKeys).toHaveLength(1);
  });

  // --- PR #233 follow-up: matching proposta→situazione, dedup conservativa e
  // prosa pulita (nessun «Briefing incompleto» al giocatore). ---
  const situationWith = (id: string, signalKeys: string[]) => ({ id, title: id, summary: 'sintesi', signalKeys, importance: 2 });

  it('COVERAGE-A: una chiave generica copre solo la situazione con quella primary', () => {
    const situationA = situationWith('A', ['military-readiness', 'stability', 'hostile-relations:SDN']);
    const situationB = situationWith('B', ['stability']);
    const proposal = { signalKeys: ['stability'] };
    // Una sola chiave generica condivisa non basta per A.
    expect(proposalMatchesSituation(proposal, situationA)).toBe(false);
    expect(proposalMatchesSituation(proposal, situationB)).toBe(true);
    const coverage = withAdvisorBriefingCoverage(world(), { reply: 'Quadro politico.', situations: [situationA, situationB], issues: [proposal as never] });
    expect(coverage.briefingCoverage?.missingSignalKeys).toContain('military-readiness');
    expect(coverage.briefingCoverage?.complete).toBe(false);
  });

  it('COVERAGE-B: due chiavi condivise coprono una situazione multi-segnale', () => {
    const situation = situationWith('nord', ['military-readiness', 'hostile-relations:SDN', 'stability']);
    const proposal = { signalKeys: ['hostile-relations:SDN', 'military-readiness'] };
    expect(proposalMatchesSituation(proposal, situation)).toBe(true);
    const coverage = withAdvisorBriefingCoverage(world(), { reply: 'Quadro.', situations: [situation], issues: [proposal as never] });
    expect(coverage.briefingCoverage?.missingSignalKeys).toEqual([]);
    expect(coverage.briefingCoverage?.complete).toBe(true);
    // Una proposta con una sola chiave qualunque non copre la situazione.
    expect(proposalMatchesSituation({ signalKeys: ['stability'] }, situation)).toBe(false);
  });

  it('DEDUP-C: una chiave generica condivisa non rende duplicate due situazioni', () => {
    expect(situationsOverlap(situationWith('a', ['stability']), situationWith('b', ['stability', 'hostile-relations:SDN']))).toBe(false);
  });

  it('DEDUP-D: stesso problema con primary condivisa è duplicato', () => {
    expect(situationsOverlap(
      situationWith('a', ['military-readiness', 'hostile-relations:SDN']),
      situationWith('b', ['military-readiness', 'hostile-relations:SDN', 'stability']),
    )).toBe(true);
    expect(situationsOverlap(
      situationWith('a', ['hostile-relations:SDN', 'food-coverage']),
      situationWith('b', ['food-coverage', 'hostile-relations:SDN']),
    )).toBe(true);
    expect(situationsOverlap(situationWith('a', ['hostile-relations:SDN']), situationWith('b', ['hostile-relations:COD']))).toBe(false);
  });

  it('REPLY-E: coverage incompleta resta metadata interno, la prosa resta naturale', () => {
    const result = withAdvisorBriefingCoverage(world(), {
      reply: 'Presidente, il nord merita la nostra attenzione prima di tutto.',
      situations: [situationWith('nord', ['military-readiness'])], issues: [],
    });
    expect(result.briefingCoverage?.complete).toBe(false);
    expect(result.briefingCoverage?.missingSignalKeys).toEqual(['military-readiness']);
    expect(result.reply).toBe('Presidente, il nord merita la nostra attenzione prima di tutto.');
    expect(result.reply).not.toContain('Briefing incompleto');
  });

  it('FALLBACK-F: senza LLM la prosa resta naturale e le situazioni deterministiche restano', () => {
    const result = buildRealityAdvisorContext(multi(), undefined, null, undefined, 'briefing');
    expect(result.reply).toBe(result.advisorContext.governmentBrief);
    expect(result.reply).not.toContain('Briefing incompleto');
    expect(result.reply).not.toMatch(/signalKey|coverage|canonicalRealitySignal/i);
    expect(result.briefingCoverage?.complete).toBe(false);
    expect(result.situations.length).toBeGreaterThanOrEqual(4);
    for (const situation of result.situations) expect(situation.signalKeys).toHaveLength(1);
  });

  it('PROMPT-G: il briefing preferisce 3-6 situazioni ordinate per priorità politica', () => {
    const prompt = buildRealityAdvisorPrompt(buildRealityAdvisorContext(multi(), undefined, null, undefined, 'briefing').advisorContext, 'Apriamo il Governo.');
    expect(prompt).toContain('circa 3-6 situazioni strategiche');
    expect(prompt).toContain('raggruppando i segnali che descrivono lo stesso problema politico');
    expect(prompt).toContain('importanza politica e urgenza');
    expect(prompt).toContain('non per categoria');
  });
});

describe('WS-CONSULENTE-PROPOSTE — repair mirato di un briefing incompleto', () => {
  /** Due sole situazioni reali (un vicino ostile + scorte alimentari sotto soglia). */
  const twoSituations = () => world({
    account: { population: 10_000_000, socialTension: 20, stability: 80, monthlyBalance: 2, nominalGdpUsdBillions: 100, debtRatioPct: 30, debtServicePct: 5 },
    relationships: { UGA: { SDN: 'hostile' } },
    polityNames: { SDN: 'Sudan' },
  });

  it('con 2 situazioni e 0 proposte chiede UNA sola completion, solo per le schede scoperte', async () => {
    const snapshot = twoSituations();
    const parsed = parseAdvisorResponse(snapshot, 'Quadro senza proposte.', 'advisor', { includeDeterministicSituations: true });
    expect(parsed.issues).toEqual([]);
    expect(parsed.situations).toHaveLength(2);
    const prompts: string[] = [];
    const outcome = await repairAdvisorBriefing(snapshot, parsed, { complete: async prompt => { prompts.push(prompt); return ''; } });
    expect(prompts).toHaveLength(1);
    for (const situation of parsed.situations) expect(prompts[0]).toContain(situation.id);
    expect(prompts[0]).toContain('situationId');
    expect(outcome.response.issues).toEqual([]);
    expect(outcome.response.briefingCoverage?.complete).toBe(false);
    expect(outcome.discarded.length).toBeGreaterThanOrEqual(2);
  });

  it('collega due proposte alle due situazioni tramite situationId e completa la copertura', async () => {
    const snapshot = twoSituations();
    const parsed = parseAdvisorResponse(snapshot, 'Quadro.', 'advisor', { includeDeterministicSituations: true });
    const [first, second] = parsed.situations;
    const outcome = await repairAdvisorBriefing(snapshot, parsed, { complete: async () => [
      block('council_issue', { title: 'Risposta uno', question: 'Autorizzare un piano straordinario di scorte con mandato a Guerra e Tesoro?', situationId: first.id, signalKeys: first.signalKeys, suggestedMinisters: ['guerra', 'tesoro'] }),
      block('council_issue', { title: 'Risposta due', question: 'Avviare un negoziato di non aggressione con il Sudan?', situationId: second.id, signalKeys: second.signalKeys, suggestedMinisters: ['esteri'] }),
    ].join('\n') });
    expect(outcome.repairedSituationIds).toEqual(expect.arrayContaining([first.id, second.id]));
    // Le advisor_situation e la prosa non vengono toccate né duplicate.
    expect(outcome.response.situations).toEqual(parsed.situations);
    expect(outcome.response.reply).toBe(parsed.reply);
    expect(outcome.response.issues.map(issue => issue.situationId)).toEqual(expect.arrayContaining([first.id, second.id]));
    expect(outcome.response.briefingCoverage?.complete).toBe(true);
  });

  it('scarta una proposta istruttoria o con chiave invalida senza fabbricarne altre', async () => {
    const snapshot = twoSituations();
    const parsed = parseAdvisorResponse(snapshot, 'Quadro.', 'advisor', { includeDeterministicSituations: true });
    const [first] = parsed.situations;
    const reasons: string[] = [];
    const outcome = await repairAdvisorBriefing(snapshot, parsed, {
      complete: async () => [
        block('council_issue', { title: 'Monitorare', question: 'Monitorare la situazione al confine?', situationId: first.id, signalKeys: first.signalKeys, suggestedMinisters: ['esteri'] }),
        block('council_issue', { title: 'Chiave falsa', question: 'Autorizzare un piano al confine?', situationId: first.id, signalKeys: ['inventata'], suggestedMinisters: ['esteri'] }),
      ].join('\n'),
      onDiscard: reason => reasons.push(reason),
    });
    expect(outcome.response.issues).toEqual([]);
    expect(reasons.join(' ')).toMatch(/istruttoria|Unknown reality signal key/);
    expect(outcome.response.briefingCoverage?.complete).toBe(false);
  });

  it('non esegue alcuna seconda completion quando la copertura è già completa', async () => {
    const snapshot = twoSituations();
    const parsed = parseAdvisorResponse(snapshot, 'Quadro.', 'advisor', { includeDeterministicSituations: true });
    const proposals = parsed.situations.map((situation, index) => block('council_issue', {
      title: `Decisione ${index}`, question: `Autorizzare la decisione ${index} subordinata alla copertura del Tesoro?`,
      signalKeys: situation.signalKeys, suggestedMinisters: ['tesoro'],
    }));
    const complete = parseAdvisorResponse(snapshot, proposals.join('\n'), 'advisor', { includeDeterministicSituations: true });
    expect(complete.briefingCoverage?.complete).toBe(true);
    let calls = 0;
    const outcome = await repairAdvisorBriefing(snapshot, complete, { complete: async () => { calls += 1; return ''; } });
    expect(calls).toBe(0);
    expect(outcome.response).toBe(complete);
  });

  it('a ogni richiesta considera opportunità del preset e ripara anche una conversazione senza proposte', async () => {
    const { PromptEngine } = await import('../src/prompt-builder');
    const canonical = twoSituations();
    const prompts: string[] = [];
    const generate = vi.fn(async (_mechanic: string, _system: string, prompt: string) => {
      prompts.push(prompt);
      return { content: prompts.length === 1 ? 'Presidente, possiamo aprire nuove prospettive.' : [
        block('council_issue', { title: 'Riserva alimentare', question: 'Avviare un programma di riserve alimentari subordinato alla copertura del Tesoro?', anchorKeys: ['capacity-economy'], suggestedMinisters: ['tesoro'] }),
        block('council_issue', { title: 'Politica del credito', question: 'Modificare la politica di indebitamento imponendo priorità ai programmi con copertura verificata?', anchorKeys: ['capacity-credit'], suggestedMinisters: ['tesoro'] }),
      ].join('\n') };
    });
    const engine = new PromptEngine({ generate } as never);
    const game = { id: 'preset-opportunities', currentDate: canonical.date, currentTurn: 2,
      world: { name: 'Scenario X', startDate: '2000-01-01', basePrompt: 'La federazione emerge da una transizione istituzionale e cerca cooperazione regionale.', regions: {}, prompts: {} },
      players: [{ id: 'president', name: 'Presidente', regionId: 'home', polityId: 'UGA' }], playerPolityId: 'UGA', actions: [], results: [], advisorContext: buildRealityAdvisorContext(canonical).advisorContext };
    const text = await engine.getAdvisor(game as never, 'Come possiamo rafforzare la nostra posizione?');
    expect(prompts[0]).toContain('[CONTESTO INIZIALE DEL PRESET');
    expect(prompts[0]).toContain('Scenario X');
    expect(prompts[0]).toContain(game.world.basePrompt);
    expect(prompts[0]).toContain('A ogni richiesta');
    const parsed = parseAdvisorResponse(canonical, text);
    expect(parsed.reply).toBe('Presidente, possiamo aprire nuove prospettive.');
    expect(parsed.issues).toHaveLength(2);
    expect(advisorReplyWithProposals(parsed)).toContain('Riserva alimentare');
    expect(advisorReplyWithProposals(parsed)).toContain('Politica del credito');
    expect(advisorReplyWithProposals(parsed)).not.toContain('```');
    expect(parsed.situations).toEqual([]); // Chat, non refresh dell'agenda.
    expect(generate).toHaveBeenCalledTimes(2); // Una generazione + al massimo un repair.
  });

  it('stream e focus restano propositivi, senza repair quando una proposta pertinente è già presente', async () => {
    const { PromptEngine } = await import('../src/prompt-builder');
    const canonical = twoSituations();
    const context = buildRealityAdvisorContext(canonical, undefined, undefined, { id: 'scorte', signalKeys: ['food-coverage'] }).advisorContext;
    const content = 'Presidente, agiamo sulle riserve.\n' + block('council_issue', {
      title: 'Riserva alimentare', question: 'Avviare un programma di riserve alimentari subordinato alla copertura del Tesoro?',
      anchorKeys: ['capacity-economy'], suggestedMinisters: ['tesoro'],
    });
    const stream = vi.fn(async (_mechanic: string, _system: string, prompt: string) => {
      expect(prompt).toContain('SCENARIO_X');
      expect(prompt).toContain('A ogni richiesta');
      expect(prompt).toContain('rispondi SOLO su di essa');
      return { content };
    });
    const generate = vi.fn();
    const engine = new PromptEngine({ generate, stream } as never);
    const game = { id: 'focus-preset', currentDate: canonical.date, currentTurn: 2,
      world: { name: 'SCENARIO_X', startDate: '2000-01-01', basePrompt: 'Transizione istituzionale.', regions: {}, prompts: {} },
      players: [{ id: 'president', name: 'Presidente', regionId: 'home', polityId: 'UGA' }], playerPolityId: 'UGA', actions: [], results: [], advisorContext: context };
    const result = await engine.getAdvisorStream(game as never, 'Approfondisci le scorte', [], () => {});
    expect(parseAdvisorResponse(canonical, result).issues).toHaveLength(1);
    expect(generate).not.toHaveBeenCalled();
    expect(stream).toHaveBeenCalledTimes(1);
    // A later food-focused request with no decision may repair once, but an
    // unrelated credit opportunity is not accepted just for sharing a country.
    stream.mockResolvedValueOnce({ content: 'Presidente, esaminiamo le scorte.' });
    generate.mockResolvedValueOnce({ content: block('council_issue', {
      title: 'Nuovo debito', question: 'Autorizzare una nuova politica di indebitamento?',
      anchorKeys: ['capacity-credit'], suggestedMinisters: ['tesoro'],
    }) });
    const unrelated = await engine.getAdvisorStream(game as never, 'Approfondisci le scorte', [], () => {});
    expect(parseAdvisorResponse(canonical, unrelated).issues).toEqual([]);
    expect(generate).toHaveBeenCalledTimes(1);
  });

  it('il prompt di repair è compatto: situazioni scoperte, anchor e atti firmati, nessuna prosa', () => {
    const snapshot = twoSituations();
    snapshot.recent.signedActs = [{ id: 'signed', text: 'Autorizzare negoziati con il Sudan', status: 'signed_pending_execution', createdAt: '2000-05-01' }];
    const parsed = parseAdvisorResponse(snapshot, 'Quadro.', 'advisor', { includeDeterministicSituations: true });
    const prompt = buildAdvisorBriefingRepairPrompt(snapshot, parsed.situations);
    const payload = JSON.parse(prompt);
    expect(payload.situations).toHaveLength(parsed.situations.length);
    expect(payload.signedActs[0].text).toContain('negoziati con il Sudan');
    expect(payload).toHaveProperty('anchors');
  });
});
