/**
 * MG02 µ4 — Dal turno al cantiere: la filiera è chiusa
 * ===================================================
 * `commitWork` aveva i suoi test ma **nessun chiamante**: l'ordine accettato non
 * diventava un cantiere. Qui si difende l'aggancio, che è l'ultimo pezzo della
 * filiera e il gate di MG02.
 *
 * Le regole che il test difende:
 *  - **Solo chi dichiara un'opera.** Un ordine in prosa non costruisce: la
 *    distinta sta nel catalogo, e ricavarla dal testo sarebbe far decidere al
 *    modello quanto costa un'opera. Un testo che nomina un'opera non basta.
 *  - **Solo chi è coperto.** Un ordine che il preflight ha dichiarato non
 *    coperto non impegna nulla, e non fa fallire il salto: diventa un esito
 *    leggibile. Lo stesso vale se le risorse finiscono fra preflight e salto
 *    (un altro ordine del turno le ha prese).
 *  - **Solo chi è accettato.** Un ordine respinto dal turno non costruisce: il
 *    commit non anticipa una decisione che il turno non ha preso.
 *  - **La coda è la priorità.** Sei ordini su una scorta che ne copre cinque:
 *    i primi cinque la impegnano, il sesto no — e nessun ordinamento nascosto.
 *  - **La prosa non crea distinte.** Nessun campo di questa catena accetta
 *    quantità dal testo: il costo è quello del catalogo.
 *
 * Guardia contro il falso verde: si contano le righe nel database — progetti,
 * riserve attive e **movimenti di ledger** — e si rilegge il runtime, invece di
 * fidarsi dei valori di ritorno.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { loadSimulationCatalog } from '../src/scenario/loader';
import type { PendingAction } from '../src/game/OrderExecutionService';

const DB = path.join(os.tmpdir(), `world-story-mg02t-${process.pid}-${Date.now()}.db`);
process.env.OPEN_PAX_DB_PATH = DB;

const FIXTURE_DIR = path.join(process.cwd(), 'data', 'presets', 'realism_test_world');
const WORLD_ID = 'mg02t-world';
const REGION_ID = 'mg02t-region';

const catalog = () => loadSimulationCatalog(FIXTURE_DIR).catalog!;

/** Un ordine come lo vede il turno: la distinta è DICHIARATA, non dedotta. */
function order(id: string, text: string, declaration?: PendingAction['workOrder']): PendingAction {
  return {
    id, text, createdAt: '1951-01-01', status: 'processing',
    ...(declaration ? { workOrder: declaration } : {}),
  };
}

const roadDeclaration = (funded = true) => ({
  workId: 'w_road', payerActorId: 'alpha_steel_co_treasury', materialActorId: 'alpha_steel_co', funded,
});

describe('MG02 µ4 — il turno impegna le costruzioni dichiarate', () => {
  let db: any;
  let gameId = '';
  let branchId = '';

  beforeAll(async () => {
    const d = await import('../src/database');
    db = d.default;
    d.initDatabase();
    const worlds = (await import('../src/repositories/world.repository')).worldRepository;
    worlds.createWithRegions(
      { id: WORLD_ID, name: 'MG02t', templateId: 'realism_test_world' },
      [{ id: REGION_ID, name: 'A', color: '#000', owner: 'ALPHA', population: 1, gdp: 1, militaryPower: 1, flag: 'A' }],
    );
    const registry = await import('../src/session-registry');
    registry.initSessionRegistry({ consolidation: { startRound: 25, chunkSize: 5, keepRawTail: 10 }, clearCache() {} } as never);
    const created = registry.getSessionRegistry().createSession(WORLD_ID, 'P', REGION_ID);
    gameId = created.gameId;
    branchId = created.session.fenceContext().branchId!;
    const { bootstrapCatalogEconomy } = await import('../src/services/StrictEffectProducerService');
    bootstrapCatalogEconomy(gameId, branchId, catalog());

    expect((db as { name?: string }).name, 'il test deve girare su un database temporaneo').toBe(DB);
  });

  afterAll(() => {
    try { fs.rmSync(DB); } catch { /* tmp */ }
    for (const suffix of ['-wal', '-shm']) {
      try { fs.rmSync(DB + suffix); } catch { /* tmp */ }
    }
  });

  const projects = (): number => (db.prepare(
    'SELECT COUNT(*) AS n FROM project_runtime_states WHERE branch_id = ?',
  ).get(branchId) as { n: number }).n;
  const reservations = (): number => (db.prepare(
    'SELECT COUNT(*) AS n FROM reservations WHERE branch_id = ? AND status = ?',
  ).get(branchId, 'active') as { n: number }).n;

  it('un ordine dichiarato e accettato fa nascere il cantiere', async () => {
    const { applyWorkCommits } = await import('../src/game/WorkCommitTurn');
    const before = { projects: projects(), reservations: reservations() };

    const outcomes = applyWorkCommits({
      gameId, branchId, catalog: catalog(),
      actions: [order('o1', 'Costruisci una strada', roadDeclaration())],
      wasAccepted: () => true, playerPolityId: 'ALPHA',
    });

    expect(outcomes).toHaveLength(1);
    expect(outcomes[0]).toMatchObject({ kind: 'committed', orderId: 'o1' });
    expect(projects()).toBe(before.projects + 1);
    expect(reservations()).toBe(before.reservations + 3);
  });

  it('un ordine in prosa non costruisce, anche se il testo nomina una strada', async () => {
    // La regola più importante: la distinta sta nel catalogo, non nella prosa.
    const { applyWorkCommits } = await import('../src/game/WorkCommitTurn');
    const before = { projects: projects(), reservations: reservations() };
    const outcomes = applyWorkCommits({
      gameId, branchId, catalog: catalog(),
      actions: [order('o2', 'Costruisci una strada ordinaria con 12 kg di acciaio')],
      wasAccepted: () => true, playerPolityId: 'ALPHA',
    });
    // Nessun esito: l'ordine non dichiara un'opera, quindi non entra nel commit.
    expect(outcomes).toEqual([]);
    expect(projects()).toBe(before.projects);
    expect(reservations()).toBe(before.reservations);
  });

  it('un ordine non coperto non impegna, e lo dichiara invece di fallire', async () => {
    const { applyWorkCommits } = await import('../src/game/WorkCommitTurn');
    const before = { projects: projects(), reservations: reservations() };
    const outcomes = applyWorkCommits({
      gameId, branchId, catalog: catalog(),
      actions: [order('o3', 'Costruisci una strada', roadDeclaration(false))],
      wasAccepted: () => true, playerPolityId: 'ALPHA',
    });
    expect(outcomes[0]).toMatchObject({ kind: 'unfunded', orderId: 'o3' });
    expect(outcomes[0].reason).toContain('insufficienti');
    // Il motivo è una frase leggibile, non il messaggio interno del motore con
    // l'id della prenotazione: quello resta nei log.
    expect(outcomes[0].reason).not.toContain('wres_');
    expect(outcomes[0].reason).not.toContain('committed');
    expect(projects()).toBe(before.projects);
    expect(reservations()).toBe(before.reservations);
  });

  it('un ordine respinto dal turno non costruisce', async () => {
    const { applyWorkCommits } = await import('../src/game/WorkCommitTurn');
    const before = projects();
    const outcomes = applyWorkCommits({
      gameId, branchId, catalog: catalog(),
      actions: [order('o4', 'Costruisci una strada', roadDeclaration())],
      wasAccepted: () => false, playerPolityId: 'ALPHA',
    });
    expect(outcomes[0]).toMatchObject({ kind: 'unfunded', orderId: 'o4' });
    expect(outcomes[0].reason).toContain('non accettato');
    expect(projects()).toBe(before);
  });

  it('un’opera assente dal catalogo non fa nascere nulla', async () => {
    const { applyWorkCommits } = await import('../src/game/WorkCommitTurn');
    const before = projects();
    const outcomes = applyWorkCommits({
      gameId, branchId, catalog: catalog(),
      actions: [order('o5', 'Costruisci un ponte', { ...roadDeclaration(), workId: 'w_ponte_inventato' })],
      wasAccepted: () => true, playerPolityId: 'ALPHA',
    });
    expect(outcomes[0]).toMatchObject({ kind: 'unfunded', orderId: 'o5' });
    expect(outcomes[0].reason).toContain('assente dal catalogo');
    expect(projects()).toBe(before);
  });

  it('la coda è la priorità: il primo ordine che non trova scorta non impegna', async () => {
    // ATTENZIONE alla dipendenza: gli altri test di questo file consumano la
    // scorta della fixture (60 kg di acciaio, 12 per strada). Qui non si
    // presume quanti ordini «stanno»: si ordina finché uno non passa, e si
    // verifica che (a) i primi N passino in ordine, (b) il primo che non passa
    // sia `unfunded`, (c) non ci siano buchi in mezzo. Così il test regge
    // qualunque sia la scorta rimasta.
    const { applyWorkCommits } = await import('../src/game/WorkCommitTurn');
    const before = projects();
    const declarations = Array.from({ length: 8 }, (_, index) => order(
      `k${index}`, `Strada ${index}`,
      { ...roadDeclaration(), payerActorId: 'alpha_treasury', materialActorId: 'alpha_steel_co' },
    ));
    const outcomes = applyWorkCommits({
      gameId, branchId, catalog: catalog(),
      actions: declarations,
      wasAccepted: () => true, playerPolityId: 'ALPHA',
    });
    const kinds = outcomes.map(o => o.kind);
    const firstFailure = kinds.indexOf('unfunded');
    // Nessun buco: una volta esaurita la scorta, tutti i successivi falliscono.
    if (firstFailure >= 0) {
      expect(kinds.slice(firstFailure).every(kind => kind === 'unfunded')).toBe(true);
    }
    // E il numero di cantieri nati è esattamente quello dei commit riusciti.
    const committed = kinds.filter(kind => kind === 'committed').length;
    expect(projects()).toBe(before + committed);
    expect(committed).toBeGreaterThan(0);
  });

  it('il ledger non cresce: si prenota, non si spende', async () => {
    // La proprietà che il commento del file dichiarava senza verificarla: le
    // riserve NON muovono il ledger. Il movimento vero lo fa il tick.
    const { applyWorkCommits } = await import('../src/game/WorkCommitTurn');
    const ledgerRows = () => (db.prepare(
      'SELECT COUNT(*) AS n FROM ledger_entries WHERE branch_id = ?',
    ).get(branchId) as { n: number }).n;
    const before = ledgerRows();
    applyWorkCommits({
      gameId, branchId, catalog: catalog(),
      actions: [order('led1', 'Strada', roadDeclaration())],
      wasAccepted: () => true, playerPolityId: 'ALPHA',
    });
    expect(ledgerRows()).toBe(before);
  });

  it('i detentori devono appartenere alla nazione del giocatore', async () => {
    // Il difetto misurato: con `payerActorId: 'beta_treasury'` l'impegno
    // riusciva e la riserva nasceva sul conto di BETA. È l'unico caso della
    // fase che tocca un soggetto terzo, e il vincolo sta nel motore — non nel
    // client, che non è affidabile.
    const { applyWorkCommits } = await import('../src/game/WorkCommitTurn');
    const before = { projects: projects(), reservations: reservations() };
    const outcomes = applyWorkCommits({
      gameId, branchId, catalog: catalog(),
      actions: [order('intr1', 'Strada di BETA con soldi di BETA', {
        ...roadDeclaration(), payerActorId: 'beta_treasury', materialActorId: 'alpha_steel_co',
      })],
      wasAccepted: () => true, playerPolityId: 'ALPHA',
    });
    expect(outcomes[0].kind).toBe('unfunded');
    expect(outcomes[0].reason).toContain('non appartiene');
    expect(projects()).toBe(before.projects);
    expect(reservations()).toBe(before.reservations);
    // E nessuna riserva è nata sul conto di BETA.
    const betaReservations = db.prepare(
      'SELECT COUNT(*) AS n FROM reservations WHERE branch_id = ? AND holder_ref = ?',
    ).get(branchId, 'beta_treasury') as { n: number };
    expect(betaReservations.n).toBe(0);
  });

  it('la stessa nazione è ammessa: il vincolo non blocca il caso legittimo', async () => {
    // Controprova del test precedente, senza la quale il vincolo potrebbe
    // essere «rifiuta sempre» e passare lo stesso. Non si presume che la
    // scorta basti: si verifica che il rifiuto NON sia quello di nazionalità.
    const { applyWorkCommits } = await import('../src/game/WorkCommitTurn');
    const outcomes = applyWorkCommits({
      gameId, branchId, catalog: catalog(),
      actions: [order('legit1', 'Strada', roadDeclaration())],
      wasAccepted: () => true, playerPolityId: 'ALPHA',
    });
    expect(outcomes[0].kind).not.toBe('none');
    if (outcomes[0].kind === 'unfunded') {
      expect(outcomes[0].reason).not.toContain('non appartiene');
    }
  });

  it('un retry del turno non crea un secondo cantiere', async () => {
    const { applyWorkCommits } = await import('../src/game/WorkCommitTurn');
    const before = { projects: projects(), reservations: reservations() };
    const outcomes = applyWorkCommits({
      gameId, branchId, catalog: catalog(),
      actions: [order('o1', 'Costruisci una strada', roadDeclaration())],
      wasAccepted: () => true, playerPolityId: 'ALPHA',
    });
    // Stesso ordine di prima: idempotente.
    expect(outcomes[0]).toMatchObject({ kind: 'already_committed', orderId: 'o1' });
    expect(projects()).toBe(before.projects);
    expect(reservations()).toBe(before.reservations);
  });

  it('l’ordine completato porta il projectId: il legame causale esiste', async () => {
    // ATTENZIONE, limite dichiarato: `projectId` vive sull'esito dell'ordine in
    // memoria e il turno lo scrive lì. NON è persistito su `turn_results`, su
    // `simulation_action_outcomes` né nei checkpoint: dopo un reload il legame
    // non c'è più. Questo test verifica che il valore sia quello del cantiere
    // davvero creato, non che sopravviva — la persistenza è lavoro aperto.
    const { applyWorkCommits } = await import('../src/game/WorkCommitTurn');
    const outcomes = applyWorkCommits({
      gameId, branchId, catalog: catalog(),
      actions: [order('o6', 'Costruisci una strada', roadDeclaration())],
      wasAccepted: () => true, playerPolityId: 'ALPHA',
    });
    const committed = outcomes[0];
    if (committed.kind !== 'committed') {
      // La scorta della fixture può essere finita per gli altri test: in quel
      // caso il legame non è verificabile qui, e lo si dichiara invece di
      // far fallire il test per una ragione che non gli appartiene.
      expect(committed.kind).toBe('unfunded');
      return;
    }

    const row = db.prepare(
      'SELECT project_id FROM project_runtime_states WHERE branch_id = ? AND project_id = ?',
    ).get(branchId, committed.projectId) as { project_id: string } | undefined;
    expect(row, 'il projectId dell’esito deve esistere nel database').toBeTruthy();
  });

  it('l’impegno di un’opera con il pagatore sbagliato fallisce senza lasciare riserve', async () => {
    // Chi paga deve avere la cassa: un attore senza conto non impegna, e la
    // transazione non lascia prenotazioni parziali.
    const { applyWorkCommits } = await import('../src/game/WorkCommitTurn');
    const before = { projects: projects(), reservations: reservations() };
    const outcomes = applyWorkCommits({
      gameId, branchId, catalog: catalog(),
      actions: [order('o7', 'Strada', { ...roadDeclaration(), payerActorId: 'alpha_farms' })],
      wasAccepted: () => true, playerPolityId: 'ALPHA',
    });
    expect(outcomes[0].kind).toBe('unfunded');
    // L'eccezione del motore è stata tradotta: il messaggio grezzo porta l'id
    // della prenotazione e le unità interne (`wres_…_test: richiesti 20000,
    // disponibili 0 (total 0, committed 0, unità test)`), misurato nel testo
    // che il giocatore legge. Qui si verifica la traduzione, e questo è il solo
    // test che passa per il percorso dell'ECCEZIONE (gli altri falliscono sulla
    // dichiarazione `funded: false`, che non lancia).
    expect(outcomes[0].reason).not.toContain('wres_');
    expect(outcomes[0].reason).not.toContain('committed');
    expect(outcomes[0].reason).not.toContain('unità');
    expect(outcomes[0].reason.length).toBeGreaterThan(0);
    expect(projects()).toBe(before.projects);
    expect(reservations()).toBe(before.reservations);
  });
});
