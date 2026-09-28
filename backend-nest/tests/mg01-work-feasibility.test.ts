/**
 * MG01 — La distinta di costruzione, e la guardia contro il costo ignoto
 * =====================================================================
 * Il difetto misurato (sonda in copia isolata, 27 settembre 2026): con
 * l'attore giusto e i consensi richiesti, un `construct` usciva **`feasible`**
 * pur avendo `timeDays: 0` e `inputs: []`. Cioè: «l'opera costa zero», quando
 * la verità era «il costo dell'opera non è dichiarato da nessuna parte».
 *
 * Qui si difendono quattro cose:
 *  - una **distinta di costruzione** esiste nel catalogo, come sezione propria
 *    (`works.json`) e non dentro `recipes.json`: una ricetta produce una
 *    risorsa, un'opera produce un asset, e la chiusura delle filiere si
 *    calcola sugli output delle ricette;
 *  - la stima di un `construct` legge quella distinta — tempo, materiali,
 *    fondi, manodopera — invece di restituire il vuoto;
 *  - la valutazione di un `construct` **senza** distinta è `needs_data`, mai
 *    `feasible`: è la guardia che il verde spurio rendeva necessaria;
 *  - il catalogo delle opere ha la disciplina opposta a quella delle ricette:
 *    un campo che il loader non conosce è un **errore**, non un silenzio — e il
 *    controllo scende in ogni sotto-oggetto (effetto, manutenzione, materiali,
 *    fondi, manodopera, provenienza), non solo al primo livello.
 *
 * Guardia contro il falso verde: il test non si accontenta di `status !==
 * 'feasible'`. Verifica che il blocco sia `DATA_UNAVAILABLE` (dato mancante) e
 * non `UNKNOWN_ENTITY` (entità inventata), e che il percorso vivo — la rotta
 * `evaluate`, con la sua tesoreria — resti bloccato: oggi il motore non sa
 * leggere le disponibilità, e il test lo dichiara invece di fingere che il
 * verde spurio sia già chiuso end-to-end. A difendere la guardia è il test a
 * livello di servizio: quello sulla rotta passerebbe anche senza, perché il
 * blocco di autorità c'è comunque.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { loadSimulationCatalog, validateCatalog, type CatalogFiles } from '../src/scenario/loader';
import { estimateIntentCosts } from '../src/core/feasibility/costs';
import { FeasibilityService, resolveConstructWork } from '../src/core/feasibility/FeasibilityService';
import { normalizeOrderIntent } from '../src/core/feasibility/intent';
import type { OrderIntent } from '../src/core/feasibility/intent';

const DB = path.join(os.tmpdir(), `world-story-mg01-${process.pid}-${Date.now()}.db`);
process.env.OPEN_PAX_DB_PATH = DB;

const FIXTURE_DIR = path.join(process.cwd(), 'data', 'presets', 'realism_test_world');
const WORLD_ID = 'mg01-world';
const WORLD_REGION = 'mg01-region';

function fixtureFiles(): CatalogFiles {
  const read = (name: string) => JSON.parse(fs.readFileSync(path.join(FIXTURE_DIR, 'simulation', name), 'utf-8'));
  return {
    manifest: read('manifest.json'),
    polities: read('polities.json'),
    resources: read('resources.json'),
    technologies: read('technologies.json'),
    recipes: read('recipes.json'),
    works: read('works.json'),
    facilities: read('facilities.json'),
    actors: read('actors.json'),
    authorities: read('authorities.json'),
    'initial-state': read('initial-state.json'),
  };
}

/** Intento di costruzione normalizzato: `targetIds` = [bersaglio noto, tipo d'opera]. */
function constructIntent(catalogRef: string, targetIds: string[] = ['ALPHA', catalogRef]): OrderIntent {
  const normalized = normalizeOrderIntent({
    id: 'ord_mg01',
    actorPolityId: 'ALPHA',
    originalText: 'Costruisci una strada',
    actionKind: 'construct',
    targetIds,
    catalogRef,
    priority: 1,
    dependencyIds: [],
    authorization: { allowPartialStart: false, allowedPhaseIds: [] },
  });
  if (!normalized.ok) throw new Error(`intent non normalizzabile: ${JSON.stringify(normalized.clarifications)}`);
  return normalized.intent;
}

const facts = (actorId: string, approvals: string[]) => ({
  actorId,
  verifiedPolityId: 'ALPHA',
  approvals,
  rights: [],
  knowledgeIds: [] as string[],
  capabilityIds: [] as string[],
});

// ─── Catalogo delle opere ────────────────────────────────────────────────────

describe('MG01 µ1 — la distinta di costruzione nel catalogo', () => {
  it('la fixture dichiara la strada e il loader la accetta', () => {
    const { catalog, report } = loadSimulationCatalog(FIXTURE_DIR);
    expect(report.errors).toEqual([]);
    expect(catalog!.works.map(w => w.id)).toContain('w_road');

    const road = catalog!.works.find(w => w.id === 'w_road')!;
    expect(road.assetTypeId).toBe('ft_road');
    expect(road.phases.map(p => p.id)).toEqual(['subgrade', 'paving']);
    expect(road.effect.kind).toBe('transport');
    // La distinta è dichiarata, non dedotta: ogni fase porta i suoi materiali.
    for (const phase of road.phases) expect(phase.inputs.length).toBeGreaterThan(0);
  });

  it('un campo ignoto al primo livello dell’opera è un errore', () => {
    const files = fixtureFiles();
    const works = JSON.parse(JSON.stringify(files.works)) as any[];
    works[0].phases[0].durationDays = 5; // il `minDays` parallelo che non deve esistere
    const report = validateCatalog({ ...files, works });
    expect(report.ok).toBe(false);
    expect(report.errors.map(e => `${e.path}:${e.code}`)).toContain('works[0].phases[0].durationDays:unknown_field');
  });

  it('il rifiuto dei campi ignoti vale anche nei sotto-oggetti, non solo al primo livello', () => {

    // Un campo ignoto annidato è il modo più facile per far sembrare completa
    // una distinta che non lo è: il controllo deve scendere di un livello.
    const files = fixtureFiles();
    const works = JSON.parse(JSON.stringify(files.works)) as any[];
    const w = works[0];
    w.effect.extra = 1;
    w.maintenance.extra = 1;
    w.evidence.extra = 1;
    w.phases[0].inputs[0].extra = 1;
    w.phases[0].funds.extra = 1;
    w.phases[0].workforce[0].extra = 1;
    const report = validateCatalog({ ...files, works });
    expect(report.ok).toBe(false);
    const paths = report.errors.map(e => `${e.path}:${e.code}`);
    for (const path of [
      'works[0].effect.extra:unknown_field',
      'works[0].maintenance.extra:unknown_field',
      'works[0].evidence.extra:unknown_field',
      'works[0].phases[0].inputs[0].extra:unknown_field',
      'works[0].phases[0].funds.extra:unknown_field',
      'works[0].phases[0].workforce[0].extra:unknown_field',
    ]) expect(paths).toContain(path);
  });

  it('un catalogo malformato è un rifiuto, non un crash del loader', () => {
    // Trovato dalla revisione indipendente: `phases` o `inputs` non-array
    // facevano uscire dal loader con un TypeError. Sulla rotta di import di un
    // preset questo diventa un 500 invece di un rifiuto motivato.
    const files = fixtureFiles();
    const withPhases = JSON.parse(JSON.stringify(files.works)) as any[];
    withPhases[0].phases = { subgrade: {} };
    expect(() => validateCatalog({ ...files, works: withPhases })).not.toThrow();
    expect(validateCatalog({ ...files, works: withPhases }).ok).toBe(false);

    const withInputs = JSON.parse(JSON.stringify(files.works)) as any[];
    withInputs[0].phases[0].inputs = { steel: '8' };
    expect(() => validateCatalog({ ...files, works: withInputs })).not.toThrow();
    expect(validateCatalog({ ...files, works: withInputs }).ok).toBe(false);
  });

  it('manutenzione, nome di fase e durate seguono le stesse regole dei loro fratelli', () => {
    const cases: Array<[string, (w: any[]) => void, string]> = [
      ['manutenzione a zero', w => { w[0].maintenance.baseUnits = '0'; }, 'works[0].maintenance.baseUnits:bad_int'],
      ['manutenzione negativa', w => { w[0].maintenance.baseUnits = '-5'; }, 'works[0].maintenance.baseUnits:bad_int'],
      ['periodo di manutenzione a zero', w => { w[0].maintenance.periodDays = 0; }, 'works[0].maintenance.periodDays:bad_duration'],
      ['nome di fase mancante', w => { delete w[0].phases[0].name; }, 'works[0].phases[0].name:missing_field'],
      ['nome d’opera mancante', w => { delete w[0].name; }, 'works[0].name:missing_field'],
      ['perDay dell’effetto a zero', w => { w[0].effect.perDay = '0'; }, 'works[0].effect.perDay:bad_int'],
      ['unità dell’effetto mancante', w => { delete w[0].effect.unit; }, 'works[0].effect.unit:missing_field'],
      ['provenienza senza fonti', w => { w[0].evidence.sourceRefs = []; }, 'works[0].evidence.sourceRefs:missing_field'],
      ['provenienza con qualità inventata', w => { w[0].evidence.quality = 'inventata'; }, 'works[0].evidence.quality:bad_evidence'],
      ['manodopera a zero', w => { w[0].phases[0].workforce[0].persons = '0'; }, 'works[0].phases[0].workforce[0].persons:bad_int'],
      ['qualifica mancante', w => { delete w[0].phases[0].workforce[0].qualification; }, 'works[0].phases[0].workforce[0].qualification:missing_field'],
      ['fondi a zero', w => { w[0].phases[0].funds.minorUnits = '0'; }, 'works[0].phases[0].funds.minorUnits:bad_int'],
      ['due opere con lo stesso id', w => { w.push(JSON.parse(JSON.stringify(w[0]))); }, 'works[1].id:duplicate_id'],
      ['due fasi con lo stesso id', w => { w[0].phases[1].id = w[0].phases[0].id; }, 'works[0].phases[1].id:duplicate_id'],
      ['dipendenza verso una fase inesistente', w => { w[0].phases[1].dependencyIds = ['fantasma']; }, 'works[0].phases[paving].dependencyIds:unknown_ref'],
      ['id d’opera non canonico', w => { w[0].id = 'W_ROAD'; }, 'works[0].id:bad_id'],
    ];
    for (const [label, mutate, expected] of cases) {
      const files = fixtureFiles();
      const works = JSON.parse(JSON.stringify(files.works)) as any[];
      mutate(works);
      const report = validateCatalog({ ...files, works });
      expect(report.ok, `${label}: il catalogo deve essere rifiutato`).toBe(false);
      expect(report.errors.map(e => `${e.path}:${e.code}`), label).toContain(expected);
    }
  });

  it('materiali e fondi della distinta devono essere risolti dal catalogo', () => {
    const files = fixtureFiles();
    const works = JSON.parse(JSON.stringify(files.works)) as any[];
    works[0].phases[0].inputs[0].resourceId = 'ghiaia_inventata';
    works[0].phases[1].funds.currencyId = 'DOLLARO_INVENTATO';
    const report = validateCatalog({ ...files, works });
    expect(report.ok).toBe(false);
    const codes = report.errors.map(e => `${e.path}:${e.code}`);
    expect(codes).toContain('works[0].phases[0].inputs[0].resourceId:unknown_ref');
    expect(codes).toContain('works[0].phases[1].funds.currencyId:currency_mismatch');
  });

  it('una distinta senza materiali non è ammessa: sarebbe un costo non dichiarato', () => {
    const files = fixtureFiles();
    const works = JSON.parse(JSON.stringify(files.works)) as any[];
    works[0].phases[0].inputs = [];
    const report = validateCatalog({ ...files, works });
    expect(report.ok).toBe(false);
    expect(report.errors.map(e => `${e.path}:${e.code}`)).toContain('works[0].phases[0].inputs:missing_field');
  });

  it('le fasi formano un DAG: un ciclo è rifiutato', () => {
    const files = fixtureFiles();
    const works = JSON.parse(JSON.stringify(files.works)) as any[];
    works[0].phases[0].dependencyIds = ['paving'];
    works[0].phases[1].dependencyIds = ['subgrade'];
    const report = validateCatalog({ ...files, works });
    expect(report.ok).toBe(false);
    expect(report.errors.map(e => e.code)).toContain('dag_cycle');
  });

  it('le fasi senza durata minima o senza lavoro non avanzano mai: rifiutate', () => {
    const files = fixtureFiles();
    const works = JSON.parse(JSON.stringify(files.works)) as any[];
    works[0].phases[0].minDays = 0;
    works[0].phases[1].workload = '0';
    const report = validateCatalog({ ...files, works });
    expect(report.ok).toBe(false);
    const codes = report.errors.map(e => `${e.path}:${e.code}`);
    expect(codes).toContain('works[0].phases[0].minDays:bad_duration');
    expect(codes).toContain('works[0].phases[1].workload:bad_int');
  });

  it('l’asset finale deve essere un tipo noto e l’effetto deve essere dichiarato', () => {
    const files = fixtureFiles();
    const works = JSON.parse(JSON.stringify(files.works)) as any[];
    works[0].assetTypeId = 'ft_inventato';
    delete works[0].effect;
    const report = validateCatalog({ ...files, works });
    expect(report.ok).toBe(false);
    const codes = report.errors.map(e => `${e.path}:${e.code}`);
    expect(codes).toContain('works[0].assetTypeId:unknown_ref');
    expect(codes).toContain('works[0].effect.kind:missing_field');
  });

  it('la chiusura delle filiere vale anche per le opere (§4.4)', () => {
    const files = fixtureFiles();
    const works = JSON.parse(JSON.stringify(files.works)) as any[];
    // Una risorsa senza stock, giacimento né filiera: la distinta non è chiusa.
    works[0].phases[0].inputs = [{ resourceId: 'coke', baseUnits: '5' }];
    const resources = JSON.parse(JSON.stringify(files.resources)) as any[];
    resources.push({ id: 'coke', name: 'Coke', unit: { kind: 'mass', symbol: 'kg' }, transportable: true, conserved: true });
    const report = validateCatalog({ ...files, resources, works });
    expect(report.ok).toBe(false);
    expect(report.errors.map(e => `${e.path}:${e.code}`)).toContain('works[w_road].phases[subgrade].inputs:unjustified_input');
  });

  it('un preset senza opere resta valido: la sezione è opzionale', () => {
    const files = fixtureFiles();
    const { works, ...withoutWorks } = files;
    const report = validateCatalog(withoutWorks);
    expect(report.ok).toBe(true);
  });
});

// ─── Stima dalla distinta ────────────────────────────────────────────────────

describe('MG01 µ2 — la stima legge la distinta dell’opera', () => {
  it('tempo, materiali, fondi e manodopera vengono dalla distinta, non dal vuoto', () => {
    const catalog = loadSimulationCatalog(FIXTURE_DIR).catalog!;
    const estimate = estimateIntentCosts(catalog, constructIntent('w_road'));

    expect(estimate.basis).toBe('work');
    // La durata dell'opera è la somma delle fasi: 4 + 3 giorni minimi.
    expect(estimate.timeDays).toBe(7);
    // I materiali restano **per fase**, non fusi in un totale: la distinta deve
    // dire quale fase consuma cosa, altrimenti il cantiere non sa cosa manca.
    expect(estimate.inputs.map(l => `${l.resourceId}=${l.quantity}${l.unit}`))
      .toEqual(['steel=8kg', 'tools=2pz', 'steel=4kg', 'tools=1pz']);
    // Il totale aggregato è una proiezione, e come tale si calcola: 12 kg e 3 pz.
    const totals = estimate.inputs.reduce<Record<string, bigint>>((acc, line) => {
      acc[line.resourceId] = (acc[line.resourceId] ?? 0n) + BigInt(line.quantity);
      return acc;
    }, {});
    expect(totals).toEqual({ steel: 12n, tools: 3n });
    expect(estimate.funds).toEqual([{ currencyId: 'TEST', minorUnits: '12000' }, { currencyId: 'TEST', minorUnits: '8000' }]);
    expect(estimate.workforce).toEqual([{ qualification: 'operaio', persons: '30' }, { qualification: 'operaio', persons: '18' }]);
    // Le fasi portano la loro durata: è quella che il piano di progetto userà.
    expect(estimate.phases!.map(p => `${p.id}:${p.minDays}`)).toEqual(['subgrade:4', 'paving:3']);
  });

  it('un tipo d’impianto senza distinta resta una stima parziale, non un costo', () => {
    const catalog = loadSimulationCatalog(FIXTURE_DIR).catalog!;
    const estimate = estimateIntentCosts(catalog, constructIntent('ft_mine'));
    // `basis` diverso da 'work': il chiamante non può scambiarla per una distinta.
    expect(estimate.basis).toBe('upkeep');
    expect(estimate.timeDays).toBe(0);
    expect(estimate.inputs).toEqual([]);
    expect(estimate.funds).toBeUndefined();
  });
});

// ─── La guardia: dato mancante ≠ costo zero ─────────────────────────────────

describe('MG01 µ2 — costo non dichiarato: needs_data, mai feasible', () => {
  const catalog = loadSimulationCatalog(FIXTURE_DIR).catalog!;
  const service = new FeasibilityService(catalog);

  it('senza distinta il costo NON è verificato, e la valutazione lo DICE', () => {
    // REGRESSIONE CORRETTA (28 settembre, segnalata dall'autore: «gli ordini non
    // passano»). Questo test sosteneva che una costruzione senza distinta dovesse
    // essere `needs_data` — un BLOCCO. Applicato ai cataloghi che non dichiarano
    // `works` (`millennium_dawn`, `modern_world_provinces`) significava che NESSUN
    // ordine di costruzione poteva passare: il gioco rotto per una regola nata su
    // una fixture.
    //
    // La regola giusta distingue due cose diverse:
    //  - il costo non è NOTO → si dichiara con un avviso, e l'ordine resta possibile;
    //  - il costo è noto ma incoerente (una fase senza materiali) → blocca, perché
    //    lì il silenzio significherebbe «costa zero».
    const assessment = service.evaluate(constructIntent('ft_mine'), facts('alpha_steel_co', ['institutional']));
    expect(assessment.status, 'una distinta assente non deve bloccare un ordine').not.toBe('needs_data');
    expect(assessment.blockers.map(b => b.code)).not.toContain('DATA_UNAVAILABLE');
    // Ma non si finge di sapere: l'avviso lo dichiara.
    expect(assessment.warnings.join(' ')).toContain('distinta di costruzione non dichiarata');
  });

  it('un tipo d’opera inventato resta entità ignota, non dato mancante', () => {
    const assessment = service.evaluate(constructIntent('w_autostrada_inventata'), facts('alpha_steel_co', ['institutional']));
    expect(assessment.status).toBe('blocked');
    expect(assessment.blockers.map(b => b.code)).toContain('UNKNOWN_ENTITY');
    expect(assessment.blockers.map(b => b.code)).not.toContain('DATA_UNAVAILABLE');
  });

  it('la risoluzione distingue i tre casi senza ambiguità', () => {
    expect(resolveConstructWork(catalog, 'w_road')).toEqual({ kind: 'declared', workId: 'w_road' });
    expect(resolveConstructWork(catalog, 'ft_mine')).toEqual({ kind: 'missing_distinct' });
    expect(resolveConstructWork(catalog, 'niente')).toEqual({ kind: 'unknown' });
    // `works` assente dal catalogo: la costruzione non è valutabile, non gratis.
    expect(resolveConstructWork({ ...catalog, works: [] }, 'w_road')).toEqual({ kind: 'unknown' });
  });

  it('una distinta INCOMPLETA blocca: lì il silenzio sarebbe «costa zero»', () => {
    // La controprova della correzione: se il catalogo DICHIARA l'opera ma una
    // fase non ha materiali, non si sa cosa serve — e questo resta un blocco.
    // Senza questo test, togliere ogni blocco passerebbe per una correzione.
    const incomplete = {
      ...catalog,
      works: [{
        ...catalog.works.find(w => w.id === 'w_road')!,
        phases: [
          ...catalog.works.find(w => w.id === 'w_road')!.phases,
          { id: 'fase_muta', name: 'Fase senza distinta', minDays: 1, workload: '10', inputs: [] },
        ],
      }],
    };
    const assessment = new FeasibilityService(incomplete as typeof catalog)
      .evaluate(constructIntent('w_road'), facts('alpha_steel_co', ['institutional']));
    expect(assessment.blockers.map(b => b.code)).toContain('DATA_UNAVAILABLE');
    expect(assessment.blockers.find(b => b.code === 'DATA_UNAVAILABLE')!.detail).toContain('incompleta');
  });

  it('una distinta completa non deve introdurre blocchi propri', () => {
    // Con la sola guardia MG01 attiva, `w_road` non produce DATA_UNAVAILABLE.
    // Resta `blocked` per la regola di autorità (nessun `allocate` per la
    // tesoreria): è un difetto NOTO e dichiarato, non parte di questa fase.
    const assessment = service.evaluate(constructIntent('w_road'), facts('alpha_steel_co', ['institutional']));
    expect(assessment.blockers.map(b => b.code)).not.toContain('DATA_UNAVAILABLE');
    expect(assessment.blockers.map(b => b.code)).not.toContain('UNKNOWN_ENTITY');
  });
});

// ─── Il percorso vivo ────────────────────────────────────────────────────────

describe('MG01 — la rotta evaluate e il percorso vivo', () => {
  let router: { stack: unknown[] };
  let session: { getQueueVersion: () => number };
  let gameId = '';
  let db: { prepare: (sql: string) => { get: (...x: string[]) => unknown } };

  beforeAll(async () => {
    const d = await import('../src/database');
    db = d.default;
    d.initDatabase();
    const worlds = (await import('../src/repositories/world.repository')).worldRepository;
    worlds.createWithRegions(
      { id: WORLD_ID, name: 'MG01', templateId: 'realism_test_world' },
      [{ id: WORLD_REGION, name: 'A', color: '#000', owner: 'ALPHA', population: 1, gdp: 1, militaryPower: 1, flag: 'A' }],
    );
    const registry = await import('../src/session-registry');
    registry.initSessionRegistry({ consolidation: { startRound: 25, chunkSize: 5, keepRawTail: 10 }, clearCache() {} } as never);
    const created = registry.getSessionRegistry().createSession(WORLD_ID, 'P', WORLD_REGION);
    gameId = created.gameId;
    session = created.session;
    router = (await import('../src/routes/games.routes')).gamesRouter as unknown as { stack: unknown[] };
  });

  afterAll(() => {
    try { fs.rmSync(DB); } catch { /* tmp */ }
  });

  function evaluate(body: unknown): Promise<{ status: number; payload: any }> {
    return new Promise((resolve, reject) => {
      const req = { method: 'POST', params: { id: gameId }, body };
      const res = {
        statusCode: 200,
        status(code: number) { this.statusCode = code; return this; },
        json(payload: unknown) { resolve({ status: this.statusCode, payload }); },
      };
      for (const raw of router.stack) {
        const layer = raw as { route?: { path: string; methods: Record<string, boolean>; stack: Array<{ handle: (a: unknown, b: unknown) => void }> } };
        if (layer.route?.path === '/:id/actions/evaluate' && layer.route.methods.post) {
          layer.route.stack[layer.route.stack.length - 1]?.handle(req, res);
          return;
        }
      }
      reject(new Error('route missing'));
    });
  }

  it('la rotta accetta il tipo d’opera e non dichiara fattibile un costo ignoto', async () => {
    const antes = session.getQueueVersion();
    const result = await evaluate({
      intent: {
        id: 'ord_rotta', actorPolityId: 'ALPHA', originalText: 'Costruisci una strada',
        actionKind: 'construct', targetIds: ['ALPHA', 'w_road'], catalogRef: 'w_road',
        priority: 0, dependencyIds: [], authorization: { allowPartialStart: false, allowedPhaseIds: [] },
      },
    });
    expect(result.status).toBe(200);
    expect(result.payload.canonicalMutation).toBe(false);
    // Con una distinta completa il blocco NON è più «dato mancante»: la rotta
    // arriva alla guardia di autorità. È questa la differenza che MG01 produce.
    const codes = result.payload.orders[0].blockers.map((b: any) => b.code);
    expect(codes).not.toContain('DATA_UNAVAILABLE');
    // La coda non si muove: la valutazione è sola lettura (MAT13).
    expect(session.getQueueVersion()).toBe(antes);
  });

  it('dalla rotta, un tipo d’impianto senza distinta NON blocca l’ordine', async () => {
    // REGRESSIONE CORRETTA (28 settembre, «gli ordini non passano»). Questo test
    // pretendeva `needs_data` per un `construct` con `catalogRef` di tipo
    // d'impianto — e su un catalogo senza `works` (tutti tranne la fixture)
    // significava che nessuna costruzione poteva essere ordinata. Il caso che
    // resta davvero da bloccare è la distinta DICHIARATA e incompleta, che ha il
    // suo test proprio.
    const result = await evaluate({
      intent: {
        id: 'ord_rotta_ft', actorPolityId: 'ALPHA', originalText: 'Costruisci una miniera',
        actionKind: 'construct', targetIds: ['ALPHA', 'ft_mine'], catalogRef: 'ft_mine',
        priority: 0, dependencyIds: [], authorization: { allowPartialStart: false, allowedPhaseIds: [] },
      },
    });
    expect(result.status).toBe(200);
    const codes = result.payload.orders[0].blockers.map((b: any) => b.code);
    expect(codes, 'un costo non dichiarato non è una ragione per rifiutare').not.toContain('DATA_UNAVAILABLE');
    // L'ordine resta possibile, ma il costo non verificato è DETTO.
    expect(result.payload.orders[0].warnings.join(' ')).toContain('distinta di costruzione non dichiarata');
  });

  it('la rotta resta bloccata sul percorso vivo: la guardia non è ancora sufficiente', () => {
    // Documenta un limite REALE misurato in MG01, non un'aspirazione: l'attore
    // usato dalla rotta è la tesoreria, che nel catalogo della fixture non ha
    // la regola R1 per `allocate`. Finché una fase non collega le disponibilità
    // e la regola giusta, una costruzione non è eseguibile end-to-end nemmeno
    // con una distinta completa. L'asserzione sulla rotta qui sopra da sola non
    // lo proverebbe: passerebbe anche senza la guardia, perché il blocco di
    // autorità c'è comunque. È il test a livello di servizio, più sopra, che
    // difende la guardia.
    const catalog = loadSimulationCatalog(FIXTURE_DIR).catalog!;
    const assessment = new FeasibilityService(catalog).evaluate(constructIntent('w_road'), facts('alpha_treasury', []));
    expect(assessment.status).toBe('blocked');
    expect(assessment.blockers.map(b => b.code)).toContain('UNAUTHORIZED_ACTOR');
  });
});
