import { describe, expect, it } from 'vitest';
import { buildVerifiedWorldSnapshot, type VerifiedWorldSnapshot } from '../src/core/government/VerifiedWorldSnapshot';
import { compileNarrativeSituation, renderNarrativeContext, narrativeRoleForSeat, narrativeAnchors, compileDiplomaticSituation } from '../src/core/government/NarrativeContextCompiler';
import { buildRealityAdvisorContext, buildRealityAdvisorPrompt } from '../src/core/government/RealityAdvisor';
import { buildMinisterDialogueBrief, composeMinisterDialoguePrompt } from '../src/core/government/MinisterDialogue';

interface SnapshotOverrides {
  currentDate?: string;
  currentTurn?: number;
  monthlyBalance?: number;
  projects?: Array<{ id: string; title?: string; startedDate?: string; progress?: number; expectedDate?: string }>;
  signedActs?: Array<{ id: string; text: string; status: 'signed_pending_execution'; createdAt: string }>;
  previousSnapshot?: VerifiedWorldSnapshot;
}

function makeSnapshot(overrides: SnapshotOverrides = {}): VerifiedWorldSnapshot {
  return buildVerifiedWorldSnapshot({
    gameData: {
      id: 'khm-game', playerPolityId: 'KHM', playerPolityName: 'Cambogia',
      currentDate: overrides.currentDate ?? '2002-06-01', currentTurn: overrides.currentTurn ?? 4,
      polityNames: { VNM: 'Vietnam', THA: 'Thailandia' },
      world: { regions: { kh: { id: 'kh', name: 'Cambogia', owner: 'KHM', coastal: true, borders: [], objects: [] } } },
      worldState: {
        resources: { stock: { money: 10 } },
        accounts: { KHM: { monthlyBalance: overrides.monthlyBalance ?? -2, stability: 60, socialTension: 40 } },
        arsenal: { units: {} },
      },
      relationships: { KHM: { VNM: 'neutral', THA: 'neutral' } },
      ongoingProcesses: overrides.projects ?? [],
    },
    commitments: [],
    operationalRows: [],
    signedActs: overrides.signedActs ?? [],
    previousSnapshot: overrides.previousSnapshot ?? null,
  });
}

const baseline = 'La Cambogia usciva dal regime dei Khmer Rossi. Gli accordi di Parigi del 1991 aprirono la ricostruzione istituzionale.';

describe('WS-GOV-NARRATIVE-CONTEXT-COMPILER', () => {
  it('1 — lo stesso stato con ruolo Tesoro/Guerra produce una situazione diversa', () => {
    const snapshot = makeSnapshot();
    const tesoro = compileNarrativeSituation({ snapshot, role: 'tesoro', query: "Possiamo aumentare l'esercito?" });
    const guerra = compileNarrativeSituation({ snapshot, role: 'guerra', query: "Possiamo aumentare l'esercito?" });
    expect(tesoro.rolePerspective).toContain('Ministro del Tesoro');
    expect(guerra.rolePerspective).toContain('Ministro della Guerra');
    expect(tesoro.rolePerspective).not.toBe(guerra.rolePerspective);
    expect(narrativeRoleForSeat('tesoro')).toBe('tesoro');
    expect(narrativeRoleForSeat('consulente')).toBeNull();
  });

  it('2 — lo stato corrente resta autorevole e il compiler non muta lo snapshot', () => {
    const snapshot = makeSnapshot();
    const before = JSON.stringify(snapshot);
    const situation = compileNarrativeSituation({ snapshot, role: 'consulente', query: 'Come siamo messi?' });
    expect(JSON.stringify(snapshot)).toBe(before);
    const prompt = buildRealityAdvisorPrompt(buildRealityAdvisorContext(snapshot).advisorContext, 'Come siamo messi?');
    // Il fact registry resta l'autorità: i fatti canonici sono nel prompt.
    expect(prompt).toContain('[VERIFIED FACT REGISTRY');
    expect(prompt).toContain('Porti posseduti');
    expect(situation).toBeTruthy();
  });

  it('3 — senza delta confrontabile non compare "migliorato/peggiorato"', () => {
    const snapshot = makeSnapshot();
    const situation = compileNarrativeSituation({ snapshot, role: 'consulente', query: 'Come stiamo?' });
    expect(situation.whatChanged).toEqual([]);
    expect(renderNarrativeContext(situation)).not.toMatch(/migliorat|peggiorat/i);
  });

  it('4 — con un delta reale compare il confronto temporale', () => {
    const previous = makeSnapshot({ currentTurn: 3, currentDate: '2002-05-01', monthlyBalance: -5 });
    const snapshot = makeSnapshot({ currentTurn: 4, currentDate: '2002-06-01', monthlyBalance: -2, previousSnapshot: previous });
    const situation = compileNarrativeSituation({ snapshot, role: 'tesoro', query: 'Come va il bilancio?' });
    expect(situation.whatChanged.join(' ')).toContain('da -5 a -2');
    expect(situation.whatChanged.join(' ')).toContain('2002-05-01 → 2002-06-01');
  });

  it("5 — un atto firmato è una decisione presa, non un effetto già avvenuto", () => {
    const snapshot = makeSnapshot({ signedActs: [{ id: 'a1', text: 'Riforma agraria', status: 'signed_pending_execution', createdAt: '2002-05-01' }] });
    const situation = compileNarrativeSituation({ snapshot, role: 'consulente', query: '' });
    const trajectory = situation.recentTrajectory.join(' ');
    expect(trajectory).toContain('decisione presa');
    expect(trajectory).toContain('effetti non sono ancora eseguiti');
    expect(trajectory).not.toMatch(/ha prodotto|è entrata in vigore|ha aumentato/i);
  });

  it('6 — la baseline storica influenza lo sfondo iniziale senza essere recitata', () => {
    const snapshot = makeSnapshot({ currentTurn: 1, currentDate: '2000-01-01' });
    const situation = compileNarrativeSituation({ snapshot, role: 'consulente', historicalBaseline: baseline, startDate: '2000-01-01' });
    expect(situation.inheritedContext).toContain('2000');
    const rendered = renderNarrativeContext(situation);
    expect(rendered).toContain('Khmer');
    expect(anchorsFrom(rendered)).toBeTruthy();
    // Non è un elenco: la prosa completa della baseline non viene riprodotta.
    expect(rendered).not.toContain('aprirono la ricostruzione istituzionale');
  });

  it('7 — dopo più turni GAME HISTORY domina la baseline', () => {
    const snapshot = makeSnapshot({ currentTurn: 8, currentDate: '2006-06-01' });
    const situation = compileNarrativeSituation({
      snapshot, role: 'consulente', historicalBaseline: baseline, startDate: '2000-01-01',
      strategicHistory: [{ id: 'e1', date: '2006-01-01', headline: 'Riforma agraria approvata', detail: null, sourceRef: 'results.r1.timelineEvents.e1', sourceActionIds: [] }],
    });
    expect(situation.inheritedContext).toContain('sfondo remoto');
    expect(situation.recentTrajectory.join(' ')).toContain('Riforma agraria approvata');
  });

  it('8 — una posizione già espressa dal Presidente entra nel contesto', () => {
    const situation = compileNarrativeSituation({
      snapshot: makeSnapshot(), role: 'tesoro', query: 'Nuove spese?',
      conversation: [{ role: 'user', content: 'Non voglio aumentare le tasse.' }],
    });
    expect(situation.politicalPosition).toContain('tasse');
    expect(renderNarrativeContext(situation)).toContain('[CURRENT POLITICAL POSITION]');
  });

  it('9 — il prompt mette il narrative context PRIMA del verified registry', () => {
    const prompt = buildRealityAdvisorPrompt(buildRealityAdvisorContext(makeSnapshot()).advisorContext, 'Domanda');
    const situation = prompt.indexOf('[YOUR SITUATION]');
    const registry = prompt.indexOf('[VERIFIED FACT REGISTRY');
    expect(situation).toBeGreaterThanOrEqual(0);
    expect(registry).toBeGreaterThan(situation);
    // Le regole di verità restano in fondo.
    expect(prompt.lastIndexOf('VERIFIED FACT POLICY')).toBeGreaterThan(registry);
  });

  it('10/11 — il compiler è sincrono, puro e non chiama il provider', () => {
    const snapshot = makeSnapshot();
    const situation = compileNarrativeSituation({ snapshot, role: 'consulente', query: '' });
    // Nessuna Promise, nessun effetto: è una proiezione deterministica.
    expect(situation).not.toBeInstanceOf(Promise);
    expect(typeof (situation as unknown as { then?: unknown }).then).toBe('undefined');
    expect(compileNarrativeSituation.length).toBeLessThanOrEqual(1);
  });
});

/** Helper di test: verifica che l'eredità contenga almeno un'ancora concreta. */
function anchorsFrom(text: string): string[] {
  return narrativeAnchors(text, 3);
}

describe('WS-GOV-NARRATIVE-CONTEXT-COMPILER — fase 2 diplomazia', () => {
  it('la posizione di governo NPC precede i dati ed è distinta dalla prospettiva del Consulente', () => {
    const diplomatic = compileDiplomaticSituation({
      countryName: 'Vietnam', counterpartyName: 'Cambogia', relationship: 'neutral',
      priorities: ['proteggere il confine'], recentMemory: ['avvicinamento alla Thailandia'],
      agenda: 'Cerca una distensione senza impegni vincolanti.', commitments: 'Nessun accordo formale con il vicino.', hostileNeighbours: 1,
    });
    expect(diplomatic).toContain('[HOW YOUR GOVERNMENT SEES THIS]');
    expect(diplomatic).toContain('«neutral»');
    expect(diplomatic).toContain('avvicinamento alla Thailandia');
    expect(diplomatic).toContain('1 vicini ostili');
    expect(diplomatic).toContain('non ripetere i dati verificati');
    expect(diplomatic).not.toContain('[WHO YOU ARE]');
    expect(diplomatic).not.toContain('[YOUR SITUATION]');
  });

  it('il rapporto cambia la posizione di partenza, senza inventare altro', () => {
    const base = { countryName: 'Vietnam', counterpartyName: 'Cambogia', priorities: [] as string[] };
    expect(compileDiplomaticSituation({ ...base, relationship: 'hostile' })).toContain('diffidenza e deterrenza');
    expect(compileDiplomaticSituation({ ...base, relationship: 'ally' })).toContain('esiste fiducia');
    expect(compileDiplomaticSituation({ ...base, relationship: 'neutral' })).toContain('non c\'è una crisi aperta');
  });

  it('senza rapporto registrato fallisce in modo chiuso, senza dedurre ostilità o fiducia', () => {
    const diplomatic = compileDiplomaticSituation({ countryName: 'Vietnam', counterpartyName: 'Cambogia', relationship: '', priorities: [] });
    expect(diplomatic).toContain('non è disponibile');
    expect(diplomatic).toContain('evita di inventare un accordo, una crisi o una concessione');
    expect(diplomatic).not.toMatch(/diffidenza|esiste fiducia/);
  });

  it('il decision frame è un selettore di dominio, non solo una keyword fissa', () => {
    // «confine» non compare in nessuna chiave canonica: lo aggancia il sinonimo del dominio diplomazia.
    const situation = compileNarrativeSituation({ snapshot: makeSnapshot(), role: 'consulente', query: 'Come proteggiamo il confine?' });
    expect(situation.decisionFrame).toContain('rapporti con l\'estero');
    // Una domanda senza dominio riconoscibile non inventa una tensione specifica.
    const vague = compileNarrativeSituation({ snapshot: makeSnapshot(), role: 'consulente', query: 'zzz qqq' });
    expect(vague.decisionFrame ?? '').not.toContain('margine fiscale');
    expect(vague.decisionFrame ?? '').not.toContain("rapporti con l'estero");
  });

  it('anche il Consiglio legacy riceve il blocco narrativo, prima del protocollo', () => {
    const world = { worldName: 'Mondo', country: 'Paese', currentDate: '2002-06-01', scenarioPremise: 'WORLD_AUTHORITY',
      simulationRules: '', nationalContext: '', recentHistory: '', activeCommitments: '', ongoingProcesses: '' };
    const base = { seat: 'tesoro' as const, worldContext: world, currentIssues: [], presidentMessage: 'Rispondi.', recentHistory: [] };
    const without = composeMinisterDialoguePrompt(buildMinisterDialogueBrief(base));
    const withNarrative = composeMinisterDialoguePrompt(buildMinisterDialogueBrief({ ...base, narrativeContext: '[WHO YOU ARE]\nSei il Ministro del Tesoro.' }));
    expect(without).not.toContain('[WHO YOU ARE]');
    expect(withNarrative).toContain('[WHO YOU ARE]');
    expect(withNarrative.indexOf('[WHO YOU ARE]')).toBeLessThan(withNarrative.indexOf('[PROTOCOL]'));
  });
});
