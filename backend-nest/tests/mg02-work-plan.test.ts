/**
 * MG02 µ2 — La distinta diventa un piano che il motore dei progetti accetta
 * ======================================================================
 * Fino a MG02 l'ordine autorizzato non diventava nulla: `createProjectRuntime`
 * non aveva alcun chiamante applicativo. Qui si difende il ponte, che è **puro**
 * — nessun database, nessuna transazione, nessun LLM — e le tre proprietà che
 * rendono onesto il passaggio:
 *
 *  - **Il collaudo è sull'ultima fase, e solo lì.** `requiresCommissioning`
 *    mette la fase in `commissioning` e l'asset in `pending` finché non c'è un
 *    collaudo esplicito: è l'invariante MG-I3. Una strada non è pronta perché i
 *    giorni sono passati.
 *  - **Gli id sono canonici e derivati.** Lo stesso ordine dà lo stesso
 *    progetto — un retry non ne crea un secondo — e l'id non dipende da come è
 *    scritto l'ordine (un id che inizia per cifra sarebbe rifiutato dal
 *    motore).
 *  - **Il costo si aggrega per unità.** Il denaro è fungibile: il fabbisogno di
 *    un progetto è il suo totale, non un residuo fase per fase. Valute
 *    eterogenee si rifiutano invece di arrotondarsi.
 *
 * Guardia contro il falso verde: il test non si accontenta che il piano «si
 * costruisca». Lo fa **validare da `ProjectEngine`** — che è l'arbitro vero — e
 * verifica che la catena completa porti fino a un asset `pending`, cioè che il
 * collaudo non sia saltato per strada.
 */
import { describe, expect, it } from 'vitest';
import path from 'path';
import { loadSimulationCatalog } from '../src/scenario/loader';
import {
  WorkPlanError, authorizedStateFor, planFromWork, projectIdForOrder, runtimeFor,
  totalFundsFor, totalMaterialsFor,
} from '../src/core/feasibility/WorkPlan';
import {
  activatePhase, advancePhaseDay, authorizeProject, completeCommissioning,
  createProject, validateProjectPlan, type ProjectPlan,
} from '../src/core/projects/ProjectEngine';

const FIXTURE_DIR = path.join(process.cwd(), 'data', 'presets', 'realism_test_world');
const catalog = () => loadSimulationCatalog(FIXTURE_DIR).catalog!;
const road = () => catalog().works.find(w => w.id === 'w_road')!;

describe('MG02 µ2 — il piano nasce dalla distinta e il motore lo accetta', () => {
  it('il piano conserva fasi, durate, lavoro e distinta dichiarati', () => {
    const plan = planFromWork(road(), 'prj_test');
    // L'arbitro è il motore dei progetti, non il nostro giudizio.
    expect(() => validateProjectPlan(plan)).not.toThrow();
    expect(plan.phases.map(p => p.id)).toEqual(['subgrade', 'paving']);
    expect(plan.phases.map(p => p.minDays)).toEqual([4, 3]);
    expect(plan.phases.map(p => p.workload)).toEqual(['120', '80']);
    expect(plan.phases[0].inputs).toEqual([
      { resourceId: 'steel', baseUnits: '8' },
      { resourceId: 'tools', baseUnits: '2' },
    ]);
    expect(plan.phases[0].budget).toEqual({ currencyId: 'TEST', minorUnits: '12000' });
  });

  it('il collaudo è richiesto sull’ultima fase, e su nessun’altra', () => {
    const plan = planFromWork(road(), 'prj_test');
    expect(plan.phases[0].requiresCommissioning).toBe(false);
    expect(plan.phases[1].requiresCommissioning).toBe(true);
    // L'asset è quello dell'ultima fase: è il confine oltre il quale il tipo
    // d'opera diventa operativo.
    expect(plan.phases[1].assetId).toBe('ft_road');
    expect(plan.phases[0].assetId).toBeUndefined();
  });

  it('l’id del progetto è deterministico e canonico qualunque sia l’ordine', () => {
    // Stesso ordine → stesso progetto: un retry non ne crea un secondo.
    expect(projectIdForOrder('abc123')).toBe(projectIdForOrder('abc123'));
    expect(projectIdForOrder('abc123')).not.toBe(projectIdForOrder('abc124'));
    // Un ordine che inizia per cifra produrrebbe un id non canonico se fosse
    // concatenato: la derivazione lo sanifica, e `isIdString` lo conferma.
    const digitLeading = projectIdForOrder('3zzz');
    expect(digitLeading.startsWith('prj_')).toBe(true);
    expect(() => planFromWork(road(), digitLeading)).not.toThrow();
  });

  it('un ordine vuoto non produce un progetto', () => {
    expect(() => projectIdForOrder('')).toThrow(WorkPlanError);
  });

  it('un id di progetto non canonico è rifiutato prima della validazione del motore', () => {
    expect(() => planFromWork(road(), 'Prj-Maiuscolo')).toThrow(WorkPlanError);
  });
});

describe('MG02 µ2 — lo stato autorizzato parte, e non anticipa l’asset', () => {
  it('il progetto nasce autorizzato con la prima fase attiva, senza asset attivati', () => {
    const { plan, state } = runtimeFor(road(), 'ordine_1');
    expect(state.status).toBe('active');
    expect(state.phases.find(p => p.id === 'subgrade')?.status).toBe('active');
    expect(state.phases.find(p => p.id === 'paving')?.status).toBe('planned');
    expect(state.activatedAssets).toEqual([]);
    expect(state.pendingAssets).toEqual([]);
  });

  it('la catena completa porta a un asset PENDING, non operativo: il collaudo non si salta', () => {
    // Il difetto che questo test esiste per impedire: un'opera che compare
    // operativa perché i giorni sono passati. Il motore dei progetti non lo
    // permette, e qui si verifica che il piano non gli dia modo di farlo.
    const { plan, state } = runtimeFor(road(), 'ordine_2');
    let current = state;

    // Massicciata: lavoro pieno in un giorno, ma la durata minima è 4.
    current = advancePhaseDay(plan, current, 'subgrade', '120');
    expect(current.phases[0].status).toBe('active');
    current = advancePhaseDay(plan, current, 'subgrade', '1');
    current = advancePhaseDay(plan, current, 'subgrade', '1');
    current = advancePhaseDay(plan, current, 'subgrade', '1');
    expect(current.phases[0].status).toBe('completed');

    // Pavimentazione: dipende dalla prima, e chiede il collaudo.
    current = activatePhase(plan, current, 'paving');
    expect(current.phases[1].status).toBe('active');
    current = advancePhaseDay(plan, current, 'paving', '80');
    expect(current.phases[1].status).toBe('active');
    current = advancePhaseDay(plan, current, 'paving', '1');
    current = advancePhaseDay(plan, current, 'paving', '1');
    expect(current.phases[1].status).toBe('commissioning');
    // Nessun asset operativo, e nessuno in attesa: si aspetta il collaudo.
    expect(current.activatedAssets).toEqual([]);
    expect(current.pendingAssets).toEqual([]);

    // Solo il collaudo esplicito mette l'asset in attesa; solo il confine
    // temporale lo attiva. Il piano non concede scorciatoie.
    const commissioned = completeCommissioning(plan, current, 'paving');
    expect(commissioned.pendingAssets).toEqual(['ft_road']);
    expect(commissioned.activatedAssets).toEqual([]);
    expect(commissioned.status).toBe('completed');
  });

  it('una fase intermedia non può attivare l’asset: le dipendenze reggono', () => {
    const plan = planFromWork(road(), 'prj_test');
    const authorized = authorizeProject(createProject(plan));
    // Attivare la seconda fase prima che la prima sia completata la blocca.
    const blocked = activatePhase(plan, authorized, 'paving');
    expect(blocked.status).toBe('blocked');
    expect(blocked.pendingAssets).toEqual([]);
  });
});

describe('MG02 µ2 — il costo dell’opera si aggrega per unità', () => {
  it('i fondi sono il totale delle fasi, in una sola valuta', () => {
    expect(totalFundsFor(road())).toEqual({ currencyId: 'TEST', minorUnits: '20000' });
  });

  it('i materiali sono il totale per risorsa, non per fase', () => {
    expect(totalMaterialsFor(road()).sort((a, b) => a.resourceId.localeCompare(b.resourceId)))
      .toEqual([
        { resourceId: 'steel', baseUnits: '12' },
        { resourceId: 'tools', baseUnits: '3' },
      ]);
  });

  it('due valute diverse non si sommano: si rifiuta', () => {
    // §6.1: valute eterogenee non si arrotondano. Un'opera con due valute è un
    // dato da correggere, non un numero da inventare.
    const work = JSON.parse(JSON.stringify(road()));
    work.phases[1].funds.currencyId = 'ALTRA';
    expect(() => totalFundsFor(work)).toThrow(WorkPlanError);
  });

  it('un’opera senza fondi non produce una prenotazione monetaria', () => {
    const work = JSON.parse(JSON.stringify(road()));
    for (const phase of work.phases) delete phase.funds;
    expect(totalFundsFor(work)).toBeNull();
  });
});

describe('MG02 µ2 — la distinta non è consumata dal piano', () => {
  it('costruire il piano non tocca il catalogo', () => {
    // Le voci del catalogo sono condivise fra le partite: scriverle qui
    // significherebbe spenderle per tutti. Il piano le COPIA.
    const work = road();
    const before = JSON.stringify(work);
    const plan = planFromWork(work, 'prj_test');
    plan.phases[0].inputs![0].baseUnits = '0';
    expect(JSON.stringify(work)).toBe(before);
  });

  it('due piani dello stesso ordine sono indipendenti', () => {
    const first: ProjectPlan = planFromWork(road(), 'prj_same');
    const second = planFromWork(road(), 'prj_same');
    expect(second).toEqual(first);
    second.phases[0].dependencyIds = [];
    expect(first.phases[0].dependencyIds).toEqual([]);
    // E il piano non perde la dipendenza dichiarata dalla distinta.
    expect(planFromWork(road(), 'prj_same').phases[1].dependencyIds).toEqual(['subgrade']);
  });

  it('lo stato autorizzato non dipende dallo stato di un altro ordine', () => {
    const a = runtimeFor(road(), 'ordine_a');
    const b = runtimeFor(road(), 'ordine_b');
    expect(a.plan.id).not.toBe(b.plan.id);
    a.state.phases[0].completedWork = '999';
    expect(b.state.phases[0].completedWork).toBe('0');
    // La funzione non riusa lo stato: ogni chiamata ne costruisce uno nuovo.
    expect(authorizedStateFor(a.plan).phases[0].completedWork).toBe('0');
  });
});
