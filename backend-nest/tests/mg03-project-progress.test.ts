/**
 * MG03 — Il cantiere avanza, e alla fine c'è un'opera
 * ==================================================
 * Il difetto che questo file esiste per chiudere: dopo MG02 l'ordine creava un
 * cantiere **e lì restava**. Il tick sa consumare il lavoro schedulato, ma
 * nessuno lo schedulava: le riserve erano impegnate e nessun giorno passava. Un
 * cantiere immobile è peggio di nessun cantiere, perché promette.
 *
 * Le regole che i test difendono:
 *  - **senza materiali la fase non parte**, e il blocco dice quanto manca —
 *    oltre la data prevista, come dice il gate di MG03;
 *  - **il consumo è reale**: i materiali escono dal ledger (`consumo`), la cassa
 *    si spende, e la differenza fra «impegnato» e «speso» si vede;
 *  - **l'opera nasce solo dal collaudo**: i giorni che passano non attivano
 *    nulla, e l'asset non compare finché non c'è il collaudo esplicito;
 *  - **il giorno di lavoro è commisurato**: una fase dura i suoi giorni minimi,
 *    non uno — nessuna scorciatoia dal tempo.
 *
 * Guardia contro il falso verde: si contano le righe del ledger e si RILEGGE il
 * runtime dal database dopo ogni passo, invece di fidarsi dello stato in memoria.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { loadSimulationCatalog } from '../src/scenario/loader';

const DB = path.join(os.tmpdir(), `world-story-mg03-${process.pid}-${Date.now()}.db`);
process.env.OPEN_PAX_DB_PATH = DB;

const FIXTURE_DIR = path.join(process.cwd(), 'data', 'presets', 'realism_test_world');
const WORLD_ID = 'mg03-world';
const REGION_ID = 'mg03-region';

const catalog = () => loadSimulationCatalog(FIXTURE_DIR).catalog!;
const road = () => catalog().works.find(w => w.id === 'w_road')!;

describe('MG03 — avanzamento del cantiere e consegna dell’opera', () => {
  let db: any;
  let gameId = '';
  let branchId = '';
  let session: any;

  beforeAll(async () => {
    const d = await import('../src/database');
    db = d.default;
    d.initDatabase();
    const worlds = (await import('../src/repositories/world.repository')).worldRepository;
    worlds.createWithRegions(
      { id: WORLD_ID, name: 'MG03', templateId: 'realism_test_world' },
      [{ id: REGION_ID, name: 'A', color: '#000', owner: 'ALPHA', population: 1, gdp: 1, militaryPower: 1, flag: 'A' }],
    );
    const registry = await import('../src/session-registry');
    registry.initSessionRegistry({ consolidation: { startRound: 25, chunkSize: 5, keepRawTail: 10 }, clearCache() {} } as never);
    const created = registry.getSessionRegistry().createSession(WORLD_ID, 'P', REGION_ID);
    gameId = created.gameId;
    session = created.session;
    branchId = session.fenceContext().branchId!;
    const { bootstrapCatalogEconomy } = await import('../src/services/StrictEffectProducerService');
    bootstrapCatalogEconomy(gameId, branchId, catalog());
    expect((db as { name?: string }).name, 'database temporaneo').toBe(DB);
  });

  afterAll(() => {
    try { fs.rmSync(DB); } catch { /* tmp */ }
    for (const suffix of ['-wal', '-shm']) {
      try { fs.rmSync(DB + suffix); } catch { /* tmp */ }
    }
  });

  const ledgerRows = (): number => (db.prepare(
    'SELECT COUNT(*) AS n FROM ledger_entries WHERE branch_id = ?',
  ).get(branchId) as { n: number }).n;
  const runtimeOf = (projectId: string) => {
    const row = db.prepare(
      'SELECT state_json FROM project_runtime_states WHERE branch_id = ? AND project_id = ?',
    ).get(branchId, projectId) as { state_json: string } | undefined;
    return row ? JSON.parse(row.state_json) : null;
  };

  /** Un cantiere pronto, come lo lascia MG02. */
  async function commitRoad(orderId: string): Promise<string> {
    const { commitWork } = await import('../src/services/WorkCommitService');
    const result = commitWork({
      gameId, branchId, orderId,
      holders: { money: 'alpha_treasury', materials: 'alpha_steel_co' },
      work: road(),
    });
    return result.projectId;
  }

  it('un giorno di lavoro è commisurato ai giorni minimi della fase', async () => {
    const { dailyWorkFor } = await import('../src/game/ProjectWorks');
    // 120 di lavoro in 4 giorni: 30 al giorno, esatto.
    expect(dailyWorkFor('120', 4)).toBe('30');
    // 80 in 3 giorni: 26.67 → 27, arrotondato in su per non sottostimare.
    expect(dailyWorkFor('80', 3)).toBe('27');
    // Lavoro nullo non è ammesso dal catalogo; il minimo è comunque un giorno.
    expect(dailyWorkFor('5', 0)).toBe('5');
  });

  it('il cantiere avanza: la prima fase si chiude nei suoi giorni minimi, non in uno', async () => {
    const { advanceProject } = await import('../src/game/ProjectWorks');
    const projectId = await commitRoad('mg03_avanza');
    const before = runtimeOf(projectId);
    expect(before.phases[0].status).toBe('active');
    expect(before.phases[0].completedWork).toBe('0');

    // Un solo giorno: la fase NON è chiusa, perché ne servono quattro.
    const oneDay = advanceProject({
      gameId, branchId, projectId, elapsedDays: 1, asOfDate: '1951-01-02',
      materialHolder: 'alpha_steel_co', moneyHolder: 'alpha_treasury',
    });
    expect(oneDay.some(outcome => outcome.kind === 'commissioning')).toBe(false);
    const afterOne = runtimeOf(projectId);
    // Il lavoro è riletto dal DATABASE, non dallo stato in memoria.
    expect(afterOne.phases[0].completedWork).toBe('30');
    expect(afterOne.phases[0].status).toBe('active');
  });

  it('i materiali della fase escono dal ledger: si consuma, non solo si prenota', async () => {
    const { consumePhaseInputs } = await import('../src/game/ProjectWorks');
    const { getProjectRuntime } = await import('../src/repositories/project-runtime.repository');
    const projectId = await commitRoad('mg03_consumo');
    const runtime = getProjectRuntime(branchId, projectId);

    const before = ledgerRows();
    const result = consumePhaseInputs({
      gameId, branchId, projectId, plan: runtime.plan, phaseId: 'subgrade',
      holder: 'alpha_steel_co', moneyHolder: 'alpha_treasury', asOfDate: '1951-01-05',
    });
    expect(result.ok).toBe(true);
    // La massicciata consuma 8 kg di acciaio, 2 utensili e 12000 di cassa:
    // tre movimenti veri nel ledger.
    expect(ledgerRows()).toBe(before + 3);

    const rows = db.prepare(
      "SELECT kind, unit_id, from_ref, to_ref, delta, cause FROM ledger_entries WHERE branch_id = ? AND effect_id = ? ORDER BY entry_index",
    ).all(branchId, `cs_${projectId.slice('prj_'.length).slice(0, 12)}_subgrade`) as any[];
    expect(rows.map(r => `${r.kind}:${r.unit_id}:${r.cause}:${r.delta}`))
      .toEqual(['material:steel:consumo:8', 'material:tools:consumo:2', 'money:test:pagamento:12000']);
    // I materiali ESCONO dal detentore e vanno al CANTIERE; la cassa a un conto
    // di costo. **Nessuno dei due ha `toRef: null`**: un movimento senza
    // destinazione distrugge merce e denaro invece di spenderli — misurato, la
    // somma dei saldi monetari calava senza che nessuno li incassasse, e
    // l'invariante «la somma dei movimenti per unità è zero» era violata.
    expect(rows.filter(r => r.kind === 'material').every(r => r.from_ref === 'alpha_steel_co' && r.to_ref === `site:${projectId}`)).toBe(true);
    expect(rows.find(r => r.kind === 'money').to_ref).toBe(`cost:${projectId}`);
  });

  it('il consumo CONSERVA: ogni unità che esce da un conto entra in un altro', async () => {
    // L'invariante di `ledger.test.ts` — «la somma dei movimenti per unità è
    // zero» — applicata al consumo del cantiere. È il test che avrebbe trovato
    // il difetto del `toRef: null`: la merce usciva dal mondo, non dal cantiere.
    const { commitWork } = await import('../src/services/WorkCommitService');
    const { consumePhaseInputs } = await import('../src/game/ProjectWorks');
    const { getProjectRuntime } = await import('../src/repositories/project-runtime.repository');
    const projectId = commitWork({
      gameId, branchId, orderId: 'mg03_conservazione',
      holders: { money: 'alpha_treasury', materials: 'alpha_steel_co' },
      work: road(), regionId: REGION_ID,
    }).projectId;
    // Consumo diretto di una fase: il test verifica la CONSERVAZIONE, non il
    // calendario — e un salto del turno porterebbe con sé altro consumo.
    const runtime = getProjectRuntime(branchId, projectId);
    consumePhaseInputs({
      gameId, branchId, projectId, plan: runtime.plan, phaseId: 'subgrade',
      holder: 'alpha_steel_co', moneyHolder: 'alpha_treasury', asOfDate: '1951-06-01',
    });

    // Ogni movimento di TRASFERIMENTO ha due lati: dove esce e dove entra.
    // Il bootstrap NON è un trasferimento — crea merce dal nulla (`fromRef:
    // null`, causa `estrazione`) — ed è legittimo che non si bilanci. Qui si
    // verificano i movimenti del cantiere: consumo e pagamento.
    const rows = db.prepare(
      "SELECT unit_id, from_ref, to_ref, delta FROM ledger_entries WHERE branch_id = ? AND effect_id LIKE 'cs_%' ORDER BY unit_id, entry_index",
    ).all(branchId) as { unit_id: string; from_ref: string | null; to_ref: string | null; delta: string }[];
    expect(rows.length).toBeGreaterThan(0);
    for (const row of rows) {
      expect(row.from_ref, 'il consumo deve uscire da un conto').toBeTruthy();
      expect(row.to_ref, 'e deve ENTRARE in un altro: senza destinazione distrugge').toBeTruthy();
    }
    expect(projectId.startsWith('prj_')).toBe(true);
  });

  it('consumare due volte la stessa fase non raddoppia il consumo', async () => {
    const { consumePhaseInputs } = await import('../src/game/ProjectWorks');
    const { getProjectRuntime } = await import('../src/repositories/project-runtime.repository');
    const projectId = await commitRoad('mg03_idem');
    const runtime = getProjectRuntime(branchId, projectId);
    const args = {
      gameId, branchId, projectId, plan: runtime.plan, phaseId: 'subgrade',
      holder: 'alpha_steel_co', moneyHolder: 'alpha_treasury', asOfDate: '1951-01-05',
    };
    consumePhaseInputs(args);
    const after = ledgerRows();
    consumePhaseInputs(args);
    // L'id dell'effetto è derivato: il secondo tentativo è un no-op.
    expect(ledgerRows()).toBe(after);
  });

  it('senza materiali la fase non parte, e il blocco dice quanto manca', async () => {
    const { advanceProject } = await import('../src/game/ProjectWorks');
    // Un cantiere il cui detentore non ha nulla: la fase non deve avanzare di un
    // giorno, e il motivo dev'essere un numero.
    const { commitWork } = await import('../src/services/WorkCommitService');
    const projectId = commitWork({
      gameId, branchId, orderId: 'mg03_bloccato',
      holders: { money: 'alpha_treasury', materials: 'alpha_steel_co' },
      work: road(),
    }).projectId;

    const outcomes = advanceProject({
      gameId, branchId, projectId, elapsedDays: 10, asOfDate: '1951-01-10',
      // Un detentore che non ha l'acciaio della distinta.
      materialHolder: 'alpha_bank', moneyHolder: 'alpha_treasury',
    });
    const blocked = outcomes.find(outcome => outcome.kind === 'blocked');
    expect(blocked, 'la fase deve risultare bloccata, non avanzata').toBeTruthy();
    expect(blocked!.kind === 'blocked' && blocked!.missing.length).toBeGreaterThan(0);
    // E il cantiere non ha lavorato: un giorno scoperto non è un giorno lavorato.
    expect(runtimeOf(projectId).phases[0].completedWork).toBe('0');
  });

  it('i giorni non attivano l’asset: serve il collaudo', async () => {
    const { advanceProject, commissionProject } = await import('../src/game/ProjectWorks');
    const projectId = await commitRoad('mg03_collaudo');

    // Giorni a sufficienza per entrambe le fasi (4 + 3).
    advanceProject({
      gameId, branchId, projectId, elapsedDays: 20, asOfDate: '1951-02-01',
      materialHolder: 'alpha_steel_co', moneyHolder: 'alpha_treasury',
    });

    const beforeCommission = runtimeOf(projectId);
    // L'asset NON è attivo, e nemmeno in attesa: si aspetta il collaudo.
    expect(beforeCommission.activatedAssets).toEqual([]);
    expect(beforeCommission.activatedAssets).not.toContain('ft_road');

    const commissioned = commissionProject({ gameId, branchId, projectId, phaseId: 'paving' });
    expect(commissioned).toBeTruthy();
    expect(commissioned!.assetId).toBe('ft_road');

    // Ora sì: l'asset è attivato, e il progetto è concluso.
    const afterCommission = runtimeOf(projectId);
    expect(afterCommission.activatedAssets).toContain('ft_road');
    expect(afterCommission.status).toBe('completed');
  });

  it('un progetto senza collaudo richiesto non produce un asset dal nulla', async () => {
    const { commissionProject } = await import('../src/game/ProjectWorks');
    const projectId = await commitRoad('mg03_senza_collaudo');
    // La prima fase NON richiede collaudo: chiederlo è un errore, non un modo
    // per attivare l'asset in anticipo.
    expect(commissionProject({ gameId, branchId, projectId, phaseId: 'subgrade' })).toBeNull();
    expect(runtimeOf(projectId).activatedAssets).toEqual([]);
  });

  it('un progetto inesistente non fa fallire il salto', async () => {
    const { advanceProject } = await import('../src/game/ProjectWorks');
    const outcomes = advanceProject({
      gameId, branchId, projectId: 'prj_mai_creato', elapsedDays: 5, asOfDate: '1951-01-10',
      materialHolder: 'alpha_steel_co', moneyHolder: 'alpha_treasury',
    });
    // Un esito, non un'eccezione: il mondo continua anche se un cantiere non c'è.
    expect(outcomes[0].kind).toBe('idle');
  });

  it('un cantiere finanziato AL CENTESIMO parte lo stesso', async () => {
    // Il difetto misurato dal revisore: la verifica dei materiali usava
    // `available`, che sottrae l'impegnato — compreso quello del cantiere
    // STESSO. Un'opera coperta esattamente non partiva mai.
    //
    // QUESTO TEST È DISTRUTTIVO e per questo è l'ULTIMO: esaurisce l'acciaio
    // disponibile per il detentore. L'ordine è parte del test.
    //
    // Per rendere il caso effettivo serve un detentore che ha ESATTAMENTE la
    // distinta: si usa un attore dedicato, così il test non dipende da quanto
    // gli altri cantieri di questo file hanno già impegnato.
    const { advanceProject, consumePhaseInputs } = await import('../src/game/ProjectWorks');
    const { getProjectRuntime } = await import('../src/repositories/project-runtime.repository');
    const { getReservationAvailability } = await import('../src/services/ReservationService');
    const { ledgerUnitId } = await import('../src/services/StrictEffectProducerService');
    const { commitWork } = await import('../src/services/WorkCommitService');

    // `alpha_farms` non ha acciaio né utensili: le sue riserve falliscono, ma il
    // cantiere si crea con la cassa della tesoreria. Poi si verificano i
    // materiali di una fase contro un detentore che NON copre la distinta.
    const projectId = commitWork({
      gameId, branchId, orderId: 'mg03_esatto2',
      holders: { money: 'alpha_treasury', materials: 'alpha_steel_co' },
      work: road(), regionId: REGION_ID,
    }).projectId;
    const runtime = getProjectRuntime(branchId, projectId);
    // Si esaurisce l'eccesso: si riserva tutto ciò che il detentore ha OLTRE la
    // distinta di questa fase. Così `available` scende a zero mentre il saldo
    // copre ancora il fabbisogno — che è esattamente il caso ambiguo.
    const { createReservation } = await import('../src/services/ReservationService');
    const target = { kind: 'material' as const, unitId: ledgerUnitId('steel'), holderRef: 'alpha_steel_co' };
    // Si riserva TUTTO il disponibile: `available` scende a zero mentre il
    // saldo totale copre ancora la distinta della fase. È la situazione reale
    // di un cantiere finanziato al centesimo: il suo commit ha già impegnato
    // tutto, e la fase deve poter spendere ciò che è SUO.
    const steelNow = getReservationAvailability(branchId, target);
    if (BigInt(steelNow.available) > 0n) {
      createReservation(gameId, branchId, {
        reservationId: 'mg03_esatto_tutto', target, amount: steelNow.available,
      });
    }
    const before = getReservationAvailability(branchId, target);
    // Il punto: `available` è ZERO, ma il saldo copre la distinta.
    expect(before.available).toBe('0');
    expect(BigInt(before.total)).toBeGreaterThanOrEqual(8n);

    // La prova diretta: consumare la fase riesce anche se `available` è
    // inferiore alla distinta, perché l'impegno è del progetto.
    const result = consumePhaseInputs({
      gameId, branchId, projectId, plan: runtime.plan, phaseId: 'subgrade',
      holder: 'alpha_steel_co', moneyHolder: 'alpha_treasury', asOfDate: '1951-06-01',
    });
    expect(result, 'il necessario è impegnato dal progetto: la fase deve partire').toMatchObject({ ok: true });

    // E l'avanzamento non si blocca.
    const outcomes = advanceProject({
      gameId, branchId, projectId, elapsedDays: 2, asOfDate: '1951-06-10',
      materialHolder: 'alpha_steel_co', moneyHolder: 'alpha_treasury',
    });
    expect(outcomes.some(outcome => outcome.kind === 'blocked')).toBe(false);
  });

});
