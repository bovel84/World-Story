/**
 * WS-GOV-ADVISOR-RESIDUAL-FIXES — persistenza per gioco/ramo/turno.
 *
 * §2/§3: nessuna contaminazione tra rami; l'archivio dei turni precedenti si
 * ricostruisce dallo stesso ramo. §4: gli `issues` restano portabili dopo il
 * reload, con validazione minima.
 */
import { describe, expect, it } from 'vitest';
import { advisorBucketKey, advisorOpeningKey, loadAdvisorArchive, loadAdvisorMessages, loadAdvisorOpening, saveAdvisorMessages, saveAdvisorOpening } from './advisorMemory';
import type { AdvisorMessage } from '../../stores/chatStore';
import type { AdvisorSituation, CouncilIssue } from '../../services/api';

function fakeStorage(): Storage {
  const map = new Map<string, string>();
  return {
    get length() { return map.size; },
    clear: () => map.clear(),
    getItem: (key: string) => map.get(key) ?? null,
    key: (index: number) => Array.from(map.keys())[index] ?? null,
    removeItem: (key: string) => { map.delete(key); },
    setItem: (key: string, value: string) => { map.set(key, value); },
  };
}

const issue = (): CouncilIssue => ({
  id: 'i1', title: 'Approvvigionamento', question: 'Come garantiamo le scorte?',
  verifiedFacts: [{ key: 'foodCoverageMonths', label: 'Copertura alimentare', value: '0,8 mesi', source: 'national_economy', sourceRef: 'national_economy.foodCoverageMonths' }],
  suggestedMinisters: ['interno', 'tesoro'], origin: 'advisor',
  sourceRefs: ['national_economy.foodCoverageMonths'], createdDate: '1951-03-01',
});

/** WS-COUNCIL-SIGNALKEYS — scheda canonica senza fatti, solo signalKeys. */
const signalIssue = (): CouncilIssue => ({
  id: 'i-signal', title: 'Rapporto ostile', question: 'Rafforziamo il confine?',
  signalKeys: ['hostile-relations'], verifiedFacts: [],
  suggestedMinisters: ['esteri'], origin: 'advisor',
  sourceRefs: ['diplomacy.relations.NEIGHBOR'], createdDate: '2000-01-01',
});

/** WS-GOV-COUNCIL-ANCHORS — scheda senza fatti, solo anchorKeys (opportunità). */
const anchorIssue = (over: Partial<CouncilIssue> = {}): CouncilIssue => ({
  id: 'issue-anchor', title: 'Programma ferroviario',
  question: 'Vogliamo studiare un nuovo collegamento?',
  anchorKeys: ['capacity-infrastructure'], signalKeys: undefined, verifiedFacts: [],
  suggestedMinisters: ['lavori', 'tesoro'], origin: 'advisor',
  sourceRefs: ['regions.home.objects.f1'], createdDate: '2000-06-01',
  ...over,
});

describe('advisorMemory', () => {
  it('isola i bucket per turno e per ramo: nessun merge tra scope diversi', () => {
    (globalThis as { localStorage?: Storage }).localStorage = fakeStorage();
    const turn3 = advisorBucketKey('g1', 'main', 'g1|main|3');
    const turn4 = advisorBucketKey('g1', 'main', 'g1|main|4');
    const fork = advisorBucketKey('g1', 'fork', 'g1|fork|3');
    const messages3: AdvisorMessage[] = [{ role: 'user', content: 'Cassa?', turn: 3 }];

    saveAdvisorMessages(turn3, messages3);
    expect(loadAdvisorMessages(turn3)).toEqual(messages3);
    expect(loadAdvisorMessages(turn4)).toEqual([]);
    // Lo stesso turno su un altro ramo è un bucket diverso: nessuna contaminazione.
    expect(loadAdvisorMessages(fork)).toEqual([]);
    expect(loadAdvisorArchive('g1', 'fork', 3)).toEqual([]);
  });

  it('l’archivio ripristina i turni precedenti dello stesso ramo', () => {
    (globalThis as { localStorage?: Storage }).localStorage = fakeStorage();
    const turn2 = advisorBucketKey('g1', 'main', 'g1|main|2');
    const turn3 = advisorBucketKey('g1', 'main', 'g1|main|3');
    const otherBranch = advisorBucketKey('g1', 'fork', 'g1|fork|2');
    saveAdvisorMessages(turn2, [{ role: 'user', content: 'vecchio', turn: 2 }]);
    saveAdvisorMessages(otherBranch, [{ role: 'user', content: 'altro ramo', turn: 2 }]);

    const archived = loadAdvisorArchive('g1', 'main', 3);
    expect(archived.map(message => message.content)).toEqual(['vecchio']);
  });

  it('RESIDUAL-FIXES-2 §2: un altro scope dello STESSO turno non entra in archivio', () => {
    (globalThis as { localStorage?: Storage }).localStorage = fakeStorage();
    // Stesso gioco, stesso ramo, stesso turno, mandate diverso → scopeKey diverso.
    const otherScopeSameTurn = advisorBucketKey('g1', 'main', 'g1|main|3|mandato-B');
    saveAdvisorMessages(otherScopeSameTurn, [{ role: 'assistant', content: 'altro scope, stesso turno', turn: 3 }]);
    saveAdvisorMessages(advisorBucketKey('g1', 'main', 'g1|main|2|mandato-A'), [{ role: 'user', content: 'turno precedente', turn: 2 }]);

    const archived = loadAdvisorArchive('g1', 'main', 3);
    expect(archived.map(message => message.content)).toEqual(['turno precedente']);
  });

  it('gli issues del Consulente restano portabili, con validazione minima', () => {
    (globalThis as { localStorage?: Storage }).localStorage = fakeStorage();
    const key = advisorBucketKey('g1', 'main', 'g1|main|3');
    saveAdvisorMessages(key, [
      { role: 'user', content: 'Domanda', turn: 3 },
      { role: 'assistant', content: 'Risposta', turn: 3, issues: [issue()] },
    ]);
    const restored = loadAdvisorMessages(key);
    expect(restored[1].issues?.[0].title).toBe('Approvvigionamento');
    expect(restored[1].issues?.[0].verifiedFacts[0].key).toBe('foodCoverageMonths');

    // Payload non valido: scartato senza rompere il messaggio.
    const storage = (globalThis as { localStorage?: Storage }).localStorage as Storage;
    storage.setItem(key, JSON.stringify([{ role: 'assistant', content: 'Risposta', turn: 3, issues: [{ id: 'x' }] }]));
    const sanitized = loadAdvisorMessages(key);
    expect(sanitized).toHaveLength(1);
    expect(sanitized[0].issues).toBeUndefined();
  });

  it('salva e ripristina cinque proposte validate, senza tagliarle a tre', () => {
    (globalThis as { localStorage?: Storage }).localStorage = fakeStorage();
    const key = advisorBucketKey('g1', 'main', 'g1|main|3');
    const many = Array.from({ length: 5 }, (_, index) => ({ ...issue(), id: `i${index}`, title: `Proposta ${index}` }));
    saveAdvisorMessages(key, [{ role: 'assistant', content: 'Cinque proposte', turn: 3, issues: many }]);
    const restored = loadAdvisorMessages(key);
    expect(restored).toHaveLength(1);
    expect(restored[0].issues).toHaveLength(5);
    expect(restored[0].issues?.map(entry => entry.id)).toEqual(['i0', 'i1', 'i2', 'i3', 'i4']);
  });

  it('WS-COUNCIL-SIGNALKEYS: salva e ripristina una issue senza verifiedFacts ma con signalKeys', () => {
    (globalThis as { localStorage?: Storage }).localStorage = fakeStorage();
    const key = advisorBucketKey('g1', 'main', 'g1|main|3');
    saveAdvisorMessages(key, [{ role: 'assistant', content: 'Proposta', turn: 3, issues: [signalIssue()] }]);
    const restored = loadAdvisorMessages(key);
    expect(restored).toHaveLength(1);
    expect(restored[0].issues).toHaveLength(1);
    expect(restored[0].issues?.[0].signalKeys).toEqual(['hostile-relations']);
    expect(restored[0].issues?.[0].verifiedFacts).toEqual([]);
  });

  it('WS-COUNCIL-SIGNALKEYS: senza fatti e senza signalKeys la issue viene scartata anche con sourceRefs', () => {
    (globalThis as { localStorage?: Storage }).localStorage = fakeStorage();
    const key = advisorBucketKey('g1', 'main', 'g1|main|3');
    saveAdvisorMessages(key, [{ role: 'assistant', content: 'Proposta', turn: 3, issues: [{ ...signalIssue(), signalKeys: undefined }] }]);
    const restored = loadAdvisorMessages(key);
    expect(restored).toHaveLength(1);
    expect(restored[0].issues).toBeUndefined();
  });

  it('WS-GOV-COUNCIL-ANCHORS (A): salva e ripristina una issue anchor-only, senza fatti né signal', () => {
    (globalThis as { localStorage?: Storage }).localStorage = fakeStorage();
    const key = advisorBucketKey('g1', 'main', 'g1|main|3');
    saveAdvisorMessages(key, [{ role: 'assistant', content: 'Proposta', turn: 3, issues: [anchorIssue()] }]);
    const restored = loadAdvisorMessages(key);
    expect(restored).toHaveLength(1);
    expect(restored[0].issues).toHaveLength(1);
    expect(restored[0].issues?.[0].anchorKeys).toEqual(['capacity-infrastructure']);
    expect(restored[0].issues?.[0].verifiedFacts).toEqual([]);
    expect(restored[0].issues?.[0].signalKeys).toBeUndefined();
  });

  it('WS-GOV-COUNCIL-ANCHORS (B): il percorso signal-only resta invariato', () => {
    (globalThis as { localStorage?: Storage }).localStorage = fakeStorage();
    const key = advisorBucketKey('g1', 'main', 'g1|main|3');
    saveAdvisorMessages(key, [{ role: 'assistant', content: 'Proposta', turn: 3, issues: [signalIssue()] }]);
    const restored = loadAdvisorMessages(key);
    expect(restored[0].issues?.[0].signalKeys).toEqual(['hostile-relations']);
    expect(restored[0].issues?.[0].anchorKeys).toBeUndefined();
  });

  it('WS-GOV-COUNCIL-ANCHORS (C): senza facts, signal e anchor la issue è scartata anche con sourceRefs', () => {
    (globalThis as { localStorage?: Storage }).localStorage = fakeStorage();
    const key = advisorBucketKey('g1', 'main', 'g1|main|3');
    saveAdvisorMessages(key, [{ role: 'assistant', content: 'Proposta', turn: 3, issues: [anchorIssue({ anchorKeys: undefined })] }]);
    const restored = loadAdvisorMessages(key);
    expect(restored).toHaveLength(1);
    expect(restored[0].issues).toBeUndefined();
  });

  it('WS-GOV-COUNCIL-ANCHORS (D): anchor duplicati e con spazi diventano una sola chiave', () => {
    (globalThis as { localStorage?: Storage }).localStorage = fakeStorage();
    const key = advisorBucketKey('g1', 'main', 'g1|main|3');
    saveAdvisorMessages(key, [{ role: 'assistant', content: 'Proposta', turn: 3,
      issues: [anchorIssue({ anchorKeys: ['capacity-infrastructure', ' capacity-infrastructure '] })] }]);
    expect(loadAdvisorMessages(key)[0].issues?.[0].anchorKeys).toEqual(['capacity-infrastructure']);
  });

  it('WS-GOV-COUNCIL-ANCHORS (E): l’apertura conserva una issue anchor-only', () => {
    (globalThis as { localStorage?: Storage }).localStorage = fakeStorage();
    const key = advisorOpeningKey('g1', 'main', 'g1|main|3');
    saveAdvisorOpening(key, { reply: 'Presidente, nessuna urgenza: c’è margine.', issues: [anchorIssue()], date: '2000-06-01' });
    const restored = loadAdvisorOpening(key)!;
    expect(restored.issues).toHaveLength(1);
    expect(restored.issues[0].anchorKeys).toEqual(['capacity-infrastructure']);
    expect(restored.issues[0].verifiedFacts).toEqual([]);
    expect(restored.issues[0].signalKeys).toBeUndefined();
  });

  it('WS-GOV-COUNCIL-ANCHORS: l’archivio dei turni precedenti conserva una issue anchor-only', () => {
    (globalThis as { localStorage?: Storage }).localStorage = fakeStorage();
    saveAdvisorMessages(advisorBucketKey('g1', 'main', 'g1|main|2'), [{ role: 'assistant', content: 'Proposta', turn: 2, issues: [anchorIssue()] }]);
    const archived = loadAdvisorArchive('g1', 'main', 3);
    expect(archived).toHaveLength(1);
    expect(archived[0].issues?.[0].anchorKeys).toEqual(['capacity-infrastructure']);
  });

  it('uno storage rotto o pieno non interrompe la conversazione', () => {
    (globalThis as { localStorage?: Storage }).localStorage = {
      ...fakeStorage(),
      getItem: () => '{non json',
      setItem: () => { throw new Error('quota'); },
    } as Storage;
    expect(loadAdvisorMessages('qualsiasi')).toEqual([]);
    expect(loadAdvisorArchive('g1', 'main', 'x')).toEqual([]);
    expect(() => saveAdvisorMessages('qualsiasi', [{ role: 'user', content: 'x', turn: 1 }])).not.toThrow();
  });

  it('WS-COUNCIL-SIGNALKEYS: l’apertura conserva le issue con signalKeys e senza fatti', () => {
    (globalThis as { localStorage?: Storage }).localStorage = fakeStorage();
    const key = advisorOpeningKey('g1', 'main', 'g1|main|3');
    saveAdvisorOpening(key, { reply: 'Presidente, il confine è teso.', issues: [signalIssue()], date: '2000-01-01' });
    const restored = loadAdvisorOpening(key)!;
    expect(restored.issues).toHaveLength(1);
    expect(restored.issues[0].signalKeys).toEqual(['hostile-relations']);
    expect(restored.issues[0].verifiedFacts).toEqual([]);
    expect(restored.issues[0].sourceRefs).toEqual(['diplomacy.relations.NEIGHBOR']);
  });

  it('WS-CONSULENTE-SITUAZIONI: le situazioni restano cliccabili dopo il reload', () => {
    (globalThis as { localStorage?: Storage }).localStorage = fakeStorage();
    const key = advisorBucketKey('g1', 'main', 'g1|main|3');
    saveAdvisorMessages(key, [{ role: 'assistant', content: 'Quadro', turn: 3, situations: [
      { id: 's1', title: 'Tensioni con il Sudan', summary: 'Rapporto ostile.', signalKeys: ['hostile-relations'], importance: 2 },
      { id: 's2', title: 'Scorte alimentari sotto soglia', summary: 'Copertura 0,8 mesi.' },
      { id: 'broken', title: '', summary: 'x' },
    ] }]);
    const restored = loadAdvisorMessages(key)[0];
    expect(restored.situations).toHaveLength(2);
    expect(restored.situations?.[0].title).toBe('Tensioni con il Sudan');
    expect(restored.situations?.[0].signalKeys).toEqual(['hostile-relations']);
    expect(restored.situations?.[1].signalKeys).toBeUndefined();
  });

  it('ignores cached openings from older protocols and regenerates once with the current one', () => {
    const storage = fakeStorage();
    (globalThis as { localStorage?: Storage }).localStorage = storage;
    const key = advisorOpeningKey('g1', 'main', 'g1|main|3');
    expect(key).toContain('ws.advisor.opening.v5::');
    // Le aperture v4, v3, v2 o del protocollo precedente non contano più: si rigenerano.
    for (const legacy of ['ws.advisor.opening.v4::', 'ws.advisor.opening.v3::', 'ws.advisor.opening.v2::', 'ws.advisor.opening::']) {
      storage.setItem(key.replace('ws.advisor.opening.v5::', legacy), JSON.stringify({ reply: 'Primo intervento del mandato', issues: [], date: '2000-01-01' }));
    }
    expect(loadAdvisorOpening(key)).toBeNull();
  });

  it('WS-GOV-ADVISOR-HISTORICAL-BASELINE: l’apertura LLM si riusa per bucket', () => {
    (globalThis as { localStorage?: Storage }).localStorage = fakeStorage();
    const key = advisorOpeningKey('g1', 'main', 'g1|main|3');
    expect(loadAdvisorOpening(key)).toBeNull();
    saveAdvisorOpening(key, { reply: 'Presidente, il paese arriva al 2000 dopo decenni difficili.', issues: [issue()], date: '2000-01-01' });
    const restored = loadAdvisorOpening(key)!;
    expect(restored.reply).toContain('2000');
    expect(restored.date).toBe('2000-01-01');
    expect(restored.issues[0].title).toBe('Approvvigionamento');
    // Bucket diverso (altro ramo): nessuna contaminazione.
    expect(loadAdvisorOpening(advisorOpeningKey('g1', 'other', 'g1|other|3'))).toBeNull();
    // Payload illeggibile o incompleto: `null`, senza rompere la chat.
    (globalThis as { localStorage?: Storage }).localStorage = { ...fakeStorage(), getItem: () => '{"reply":""}' } as Storage;
    expect(loadAdvisorOpening(key)).toBeNull();
    (globalThis as { localStorage?: Storage }).localStorage = { ...fakeStorage(), setItem: () => { throw new Error('quota'); } } as Storage;
    expect(() => saveAdvisorOpening(key, { reply: 'x', issues: [], date: null })).not.toThrow();
  });
});

/**
 * T02 — Le MOSSE di una situazione sopravvivono al salvataggio.
 *
 * Era il difetto di P03 rimasto aperto per le situazioni: `sanitizeSituations`
 * non conosceva `options`, quindi una situazione tornava dal reload senza le
 * sue mosse — cioè nella forma del 16:43, con il solo «Approfondisci».
 */
describe('T02 — le mosse della situazione nella persistenza', () => {
  const mosse = [
    { title: 'Soffocare la rivolta', content: 'Dispieghiamo le unità disponibili lungo il confine e fortifichiamo i nodi logistici.' },
    { title: 'Comprare la tregua', content: 'Apriamo un canale con i capi locali e finanziamo la ricostruzione dei mercati.' },
  ];
  const situation = (): AdvisorSituation => ({
    id: 'sudan', title: 'Tensioni con il Sudan', summary: 'Rapporto ostile al confine.',
    options: mosse, signalKeys: ['hostile-relations:SDN'], importance: 3,
  });

  it('le mosse si conservano al salvataggio e tornano al reload', () => {
    const storage = fakeStorage();
    (globalThis as any).localStorage = storage;
    const key = advisorBucketKey('g1', 'b1', 'scope');
    saveAdvisorMessages(key, [{ role: 'assistant', content: 'Quadro.', turn: 1, situations: [situation()] } as AdvisorMessage]);
    const loaded = loadAdvisorMessages(key);
    expect(loaded[0].situations?.[0].options).toEqual(mosse);
  });

  it('una situazione senza mosse resta senza, e il reload non ne inventa', () => {
    const storage = fakeStorage();
    (globalThis as any).localStorage = storage;
    const key = advisorBucketKey('g2', 'b1', 'scope');
    const senza = { id: 's1', title: 'Scorte fragili', summary: 'Margine sottile.', signalKeys: ['food-coverage'] };
    saveAdvisorMessages(key, [{ role: 'assistant', content: 'Quadro.', turn: 1, situations: [senza] } as AdvisorMessage]);
    const loaded = loadAdvisorMessages(key);
    expect(loaded[0].situations?.[0].options).toBeUndefined();
    expect(loaded[0].situations?.[0]).not.toHaveProperty('options');
  });

  it('una mossa senza titolo o senza contenuto si scarta; le altre restano', () => {
    const storage = fakeStorage();
    (globalThis as any).localStorage = storage;
    const storageKey = advisorBucketKey('g3', 'b1', 'scope');
    const rotta = { ...situation(), options: [{ title: '', content: 'Senza titolo.' }, ...mosse] };
    saveAdvisorMessages(storageKey, [{ role: 'assistant', content: 'Quadro.', turn: 1, situations: [rotta] } as AdvisorMessage]);
    const loaded = loadAdvisorMessages(storageKey);
    expect(loaded[0].situations?.[0].options).toEqual(mosse);
  });

  it('una chiave dentro una mossa NON entra nel salvataggio: la mossa è prosa', () => {
    const storage = fakeStorage();
    (globalThis as any).localStorage = storage;
    const storageKey = advisorBucketKey('g4', 'b1', 'scope');
    const conChiave = { ...situation(), options: [{ ...mosse[0], signalKey: 'hostile-relations:SDN' }] };
    saveAdvisorMessages(storageKey, [{ role: 'assistant', content: 'Quadro.', turn: 1, situations: [conChiave] } as AdvisorMessage]);
    const loaded = loadAdvisorMessages(storageKey);
    expect(loaded[0].situations?.[0].options).toEqual([{ title: mosse[0].title, content: mosse[0].content }]);
    // La guardia è sulla MOSSA, non sull'intera scheda: `signalKeys` della
    // situazione è una fonte canonica legittima e resta. Solo l'opzione non ha
    // chiavi — è prosa. (La mia prima asserzione colpiva l'intera
    // serializzazione e cadeva su `signalKeys`: era la prova a essere larga.)
    expect(Object.keys(loaded[0].situations![0].options![0]).sort()).toEqual(['content', 'title']);
  });
});
