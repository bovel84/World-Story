/**
 * P03a — L'ordine del Governo passa i requisiti del motore
 * ========================================================
 * Il difetto misurato dall'autore: **l'ordine nato dal Governo non passava i
 * requisiti del motore**. Il motivo era preciso: la voce di un ministro era
 * prosa, e dal testo libero il motore non ricava una costruzione. Per aprire un
 * cantiere servono due cose che nessuna frase contiene: **quale opera** del
 * catalogo, e **chi** paga e custodisce i materiali.
 *
 * La correzione: la voce che riguarda un'opera porta con sé il `workId`, e la
 * seduta vi aggiunge la **dichiarazione risolta dal server** — i detentori li
 * trova il motore, non il client. Così l'ordine nato dal Governo è lo stesso
 * atto di un ordine dichiarato a mano: non un secondo percorso.
 *
 * Le regole che i test difendono:
 *  - **il catalogo da solo non crea un’agenda**: la fixture dichiara un avanzo
 *    significativo e usa la distinta coperta dal ledger per proporre l’opera;
 *  - **una voce di costruzione porta l'opera**: senza `workId`, la coda non può
 *    dichiarare nulla e il motore rifiuta l'ordine;
 *  - **la dichiarazione la risolve il server**, con i detentori reali del paese;
 *  - **senza detentore l’opera NON diventa una richiesta automatica**: il
 *    resolver canonico restituisce `materialActorId: null` e quanto manca;
 *    anche un ordine con una dichiarazione ormai obsoleta non apre cantieri;
 *  - **la dichiarazione è quella che `commitWork` accetta**: il giro completo,
 *    dal catalogo alla coda.
 *
 * Guardia contro il falso verde: si verifica anche la voce che NON è una
 * costruzione — una fazione, un debito — che non deve portare dichiarazioni.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { loadSimulationCatalog } from '../src/scenario/loader';
import type { CabinetSession } from '../src/core/government/Cabinet';

const DB = path.join(os.tmpdir(), `world-story-p03-${process.pid}-${Date.now()}.db`);
process.env.OPEN_PAX_DB_PATH = DB;

const WORLD_ID = 'p03-world';
const REGION_ID = 'p03-region';

describe('P03a — la voce di costruzione porta la dichiarazione che il motore pretende', () => {
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
      { id: WORLD_ID, name: 'P03', templateId: 'realism_test_world' },
      [{ id: REGION_ID, name: 'A', color: '#000', owner: 'ALPHA', population: 1, gdp: 1, militaryPower: 1, flag: 'A' }],
    );
    const registry = await import('../src/session-registry');
    registry.initSessionRegistry({ consolidation: { startRound: 25, chunkSize: 5, keepRawTail: 10 }, clearCache() {} } as never);
    const created = registry.getSessionRegistry().createSession(WORLD_ID, 'P', REGION_ID);
    gameId = created.gameId;
    session = created.session;
    branchId = session.fenceContext().branchId!;
    const { bootstrapCatalogEconomy } = await import('../src/services/StrictEffectProducerService');
    bootstrapCatalogEconomy(gameId, branchId, loadSimulationCatalog(path.join(process.cwd(), 'data', 'presets', 'realism_test_world')).catalog!);
    expect((db as { name?: string }).name, 'database temporaneo').toBe(DB);
  });

  afterAll(() => {
    try { fs.rmSync(DB); } catch { /* tmp */ }
    for (const suffix of ['-wal', '-shm']) {
      try { fs.rmSync(DB + suffix); } catch { /* tmp */ }
    }
  });

  const canonicalState = (): string => JSON.stringify(
    ['ledger_entries', 'reservations', 'project_runtime_states'].map(table =>
      db.prepare(`SELECT * FROM ${table} WHERE branch_id = ?`).all(branchId)),
  );

  const readCabinet = async (): Promise<CabinetSession> => {
    const { readCabinetSession } = await import('../src/game/GovernmentReadings');
    const before = canonicalState();
    const cabinet = readCabinetSession({
      gameId, branchId, playerPolityId: 'ALPHA', government: session.getGovernment(),
      // Conto sintetico dichiarato: 2 mld/mese su 100 mld di PIL annuo (2%,
      // non annualizzato). Serve a rendere significativa la scelta d’investire;
      // cassa e materiali restano quelli reali del bootstrap, validati dal motore.
      account: { monthlyBalance: 2, nominalGdpUsdBillions: 100 },
    });
    expect(cabinet.canonicalMutation).toBe(false);
    expect(canonicalState(), 'leggere non prenota, spende o costruisce').toBe(before);
    // Il registry usa una fixture priva di generate/stream: nessun LLM necessario.
    return cabinet;
  };

  it('una voce di costruzione porta l’OPERA, e la dichiarazione coi detentori', async () => {
    const cabinet = await readCabinet();
    const buildItems = cabinet.addresses.flatMap(address => address.items)
      .filter(item => item.work);

    expect(buildItems.length, 'avanzo significativo e distinta coperta: la voce porta l’opera').toBeGreaterThan(0);
    const road = buildItems.find(item => item.work!.workId === 'w_road')!;
    expect(road.work!.name).toBeTruthy();

    // La dichiarazione risolta dal server: senza, l'ordine non passa.
    expect(road.declaration, 'la voce di un’opera deve portare la dichiarazione').toBeTruthy();
    expect(road.declaration!.workId).toBe('w_road');
    expect(road.declaration!.payerActorId).toBe('alpha_treasury');
    expect(road.declaration!.materialActorId).toBe('alpha_steel_co');
    expect(road.declaration!.funded).toBe(true);
  });

  it('la dichiarazione è quella che `commitWork` ACCETTA: il giro completo', async () => {
    // Il punto della fase: non basta che la dichiarazione esista — deve essere
    // quella che il motore accetta. Si passa dalla coda fino al cantiere.
    const cabinet = await readCabinet();
    const road = cabinet.addresses.flatMap(address => address.items)
      .find(item => item.work?.workId === 'w_road')!;
    const declaration = road.declaration!;

    const { applyWorkCommits } = await import('../src/game/WorkCommitTurn');
    const projects = (): number => (db.prepare(
      'SELECT COUNT(*) AS n FROM project_runtime_states WHERE branch_id = ?',
    ).get(branchId) as { n: number }).n;

    const ledgerBefore = db.prepare('SELECT * FROM ledger_entries WHERE branch_id = ?').all(branchId);
    const reservationsBefore = (db.prepare(
      'SELECT COUNT(*) AS n FROM reservations WHERE branch_id = ?',
    ).get(branchId) as { n: number }).n;
    const before = projects();
    const outcomes = applyWorkCommits({
      gameId, branchId,
      catalog: loadSimulationCatalog(path.join(process.cwd(), 'data', 'presets', 'realism_test_world')).catalog!,
      actions: [{
        id: 'p03_ordine', text: road.need, createdAt: '1951-01-01', status: 'processing',
        workOrder: {
          workId: declaration.workId,
          payerActorId: declaration.payerActorId,
          materialActorId: declaration.materialActorId!,
          funded: declaration.funded,
        },
      }],
      wasAccepted: () => true,
      playerPolityId: 'ALPHA',
      regionId: REGION_ID,
    });

    // L'ordine nato dal Governo APRE IL CANTIERE: è la prova che passa i requisiti.
    expect(outcomes[0].kind).toBe('committed');
    expect(projects()).toBe(before + 1);
    if (outcomes[0].kind !== 'committed') throw new Error('cantiere non impegnato');
    expect(outcomes[0].reservationIds).toHaveLength(3); // cassa, acciaio e utensili
    expect((db.prepare(
      'SELECT COUNT(*) AS n FROM reservations WHERE branch_id = ?',
    ).get(branchId) as { n: number }).n).toBe(reservationsBefore + 3);
    // Impegnare non consuma: si conserva integralmente il ledger.
    expect(db.prepare('SELECT * FROM ledger_entries WHERE branch_id = ?').all(branchId)).toEqual(ledgerBefore);
  });

  it('senza detentore l’opera non è in agenda e il motore non materializza un cantiere impossibile', async () => {
    // Si conserva una dichiarazione valida, poi si riserva tutto l’acciaio
    // libero: il catalogo resta consultabile, ma non è una richiesta automatica.
    const initialCabinet = await readCabinet();
    const staleDeclaration = initialCabinet.addresses.flatMap(address => address.items)
      .find(item => item.work?.workId === 'w_road')!.declaration!;
    expect(staleDeclaration.funded).toBe(true);
    expect(staleDeclaration.materialActorId).toBe('alpha_steel_co');
    const { getReservationAvailability, createReservation } = await import('../src/services/ReservationService');
    const { ledgerUnitId } = await import('../src/services/StrictEffectProducerService');
    const target = { kind: 'material' as const, unitId: ledgerUnitId('steel'), holderRef: 'alpha_steel_co' };
    const available = getReservationAvailability(branchId, target).available;
    if (BigInt(available) > 0n) {
      createReservation(gameId, branchId, { reservationId: 'p03_esaurisce', target, amount: available });
    }

    expect(getReservationAvailability(branchId, target).available).toBe('0');
    const before = canonicalState();
    const cabinet = await readCabinet();
    expect(cabinet.addresses.flatMap(address => address.items)
      .filter(item => item.work?.workId === 'w_road' || item.voiceId === 'build_w_road')).toEqual([]);

    const catalog = loadSimulationCatalog(path.join(process.cwd(), 'data', 'presets', 'realism_test_world')).catalog!;
    const { resolveWorkHolders } = await import('../src/game/WorkHolders');
    const road = catalog.works!.find(work => work.id === 'w_road')!;
    const holders = resolveWorkHolders(catalog, branchId, 'ALPHA', road);
    expect(holders.payerActorId).toBe('alpha_treasury');
    expect(holders.materialActorId, 'nessun attore copre la distinta').toBeNull();
    expect(holders.missingMaterials).toContainEqual({ resourceId: 'steel', missing: '12' });
    expect(canonicalState(), 'anche il resolver è read-only').toBe(before);

    // Il client può rimandare un preflight obsoleto con funded:true: è il
    // motore a ricontrollare la disponibilità e annullare ogni riserva parziale.
    const { applyWorkCommits } = await import('../src/game/WorkCommitTurn');
    const outcomes = applyWorkCommits({
      gameId, branchId, catalog,
      actions: [{
        id: 'p03_impossibile', text: 'Costruire la strada', createdAt: '1951-01-01', status: 'processing',
        workOrder: {
          workId: staleDeclaration.workId,
          payerActorId: staleDeclaration.payerActorId,
          materialActorId: staleDeclaration.materialActorId!,
          funded: staleDeclaration.funded,
        },
      }],
      wasAccepted: () => true,
      playerPolityId: 'ALPHA', regionId: REGION_ID,
    });
    expect(outcomes).toEqual([{
      kind: 'unfunded', orderId: 'p03_impossibile',
      reason: expect.stringContaining('nessun cantiere avviato'),
    }]);
    expect(canonicalState(), 'nessun cantiere o riserva parziale, ledger conservato').toBe(before);
  });

  it('una voce che NON è una costruzione non porta dichiarazioni', async () => {
    // Il controllo opposto: una fazione o un debito non hanno un'opera, e la
    // voce non deve inventarne una. Senza questo test, una voce qualsiasi
    // potrebbe portare una dichiarazione e aprire un cantiere per sbaglio.
    const cabinet = await readCabinet();
    const others = cabinet.addresses.flatMap(address => address.items)
      .filter(item => item.voiceId.startsWith('faction_') || item.voiceId === 'debt_service');
    for (const item of others) {
      expect(item.work, `la voce ${item.voiceId} non riguarda un’opera`).toBeUndefined();
      expect(item.declaration).toBeUndefined();
    }
  });

  it('la dichiarazione non è una stringa vuota: è assenza, se manca', async () => {
    // Un dettaglio che sembra minore e non lo è: `materialActorId: ''` sarebbe
    // un attore inesistente, e il commit lo rifiuterebbe con un messaggio
    // interno. `null` è l'assenza dichiarata, e il client la legge come tale.
    const cabinet = await readCabinet();
    for (const item of cabinet.addresses.flatMap(address => address.items)) {
      if (!item.declaration) continue;
      expect(item.declaration.workId.length).toBeGreaterThan(0);
      expect(item.declaration.payerActorId.length).toBeGreaterThan(0);
      expect(item.declaration.materialActorId === null || item.declaration.materialActorId.length > 0).toBe(true);
    }
  });
});
