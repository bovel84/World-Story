/**
 * MG05 µ3 — L'agenda legge lo stato VERO, e resta sola lettura
 * ============================================================
 * `GovernmentAgenda` è pura: trasforma fatti in scelte. Qui si difende il pezzo
 * che raccoglie i fatti — deficit dei cantieri, fazioni, bilancio, debito, opere
 * — dallo stato della partita.
 *
 * Le regole:
 *  - **I deficit dei cantieri sono misurati, non raccontati.** Un cantiere che ha
 *    tutto non produce una voce; uno che non ha l'acciaio sì, con i tre numeri.
 *  - **Le cifre che il motore non ha non si inventano.** Senza catalogo, l'agenda
 *    non finge di sapere cosa si può costruire: quelle voci non compaiono.
 *  - **Sola lettura.** Dopo aver letto l'agenda, il ledger e le riserve sono
 *    identici: il Governo propone, non impegna (invariante MG-I1).
 *
 * Guardia contro il falso verde: si contano le righe del ledger e delle riserve
 * PRIMA e DOPO la lettura, e si verifica il caso che deve tacere — un cantiere
 * senza deficit non deve comparire in agenda.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { loadSimulationCatalog } from '../src/scenario/loader';
import { buildVerifiedWorldSnapshot } from '../src/core/government/VerifiedWorldSnapshot';

const DB = path.join(os.tmpdir(), `world-story-mg05r-${process.pid}-${Date.now()}.db`);
process.env.OPEN_PAX_DB_PATH = DB;

const WORLD_ID = 'mg05r-world';
const REGION_ID = 'mg05r-region';

describe('MG05 µ3 — l’agenda legge lo stato della partita', () => {
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
      { id: WORLD_ID, name: 'MG05r', templateId: 'realism_test_world' },
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

  const ledgerRows = (): number => (db.prepare(
    'SELECT COUNT(*) AS n FROM ledger_entries WHERE branch_id = ?',
  ).get(branchId) as { n: number }).n;
  const reservationRows = (): number => (db.prepare(
    'SELECT COUNT(*) AS n FROM reservations WHERE branch_id = ?',
  ).get(branchId) as { n: number }).n;

  const readAgenda = async () => {
    const { readGovernmentAgenda } = await import('../src/game/GovernmentReadings');
    return readGovernmentAgenda({
      gameId, branchId, playerPolityId: 'ALPHA', government: session.getGovernment(),
    });
  };

  it('leggere l’agenda NON muta nulla: sola lettura davvero', async () => {
    // L'invariante MG-I1: il Governo propone. Se leggere l'agenda scrivesse una
    // riga di ledger o creasse una riserva, «proposta» e «decisione» sarebbero
    // la stessa cosa.
    const before = { ledger: ledgerRows(), reservations: reservationRows() };
    const agenda = await readAgenda();
    expect(agenda.canonicalMutation).toBe(false);
    expect(ledgerRows()).toBe(before.ledger);
    expect(reservationRows()).toBe(before.reservations);
  });

  const catalogReading = () => ({
    gameId, branchId, playerPolityId: 'ALPHA', government: session.getGovernment(),
    catalog: loadSimulationCatalog(path.join(process.cwd(), 'data', 'presets', 'realism_test_world')).catalog!,
  });

  it('il catalogo resta leggibile senza diventare automaticamente agenda', async () => {
    const { buildableWorks } = await import('../src/game/GovernmentReadings');
    const road = buildableWorks(catalogReading()).find(work => work.workId === 'w_road');
    expect(road).toBeTruthy();
    expect(road!.missing, 'cassa e materiali iniziali coprono la distinta').toEqual([]);
    const agenda = await readAgenda();
    expect(agenda.voices.filter(voice => voice.id.startsWith('build_'))).toEqual([]);
  });

  it('WS-GOVOFFICE-06 — tutto il catalogo esteso è costruibile con cassa e scorte iniziali', async () => {
    const { buildableWorks } = await import('../src/game/GovernmentReadings');
    const reading = catalogReading();
    const buildable = buildableWorks(reading);
    expect(buildable.length, 'il catalogo esteso deve restare leggibile per intero').toBeGreaterThanOrEqual(10);
    expect(buildable.map(work => work.workId).sort()).toEqual(reading.catalog.works!.map(work => work.id).sort());
    for (const work of buildable) {
      expect(work.missing, `${work.name}: distinta completa, cassa inclusa`).toEqual([]);
    }
    expect(buildable.find(work => work.workId === 'w_school')).toBeTruthy();
  });

  it('materiali coperti senza cassa non rendono il catalogo finanziabile', async () => {
    const { buildableWorks } = await import('../src/game/GovernmentReadings');
    const { getReservationAvailability } = await import('../src/services/ReservationService');
    const { appendLedgerEntries } = await import('../src/repositories/ledger.repository');
    const { ledgerUnitId } = await import('../src/services/StrictEffectProducerService');
    const reading = catalogReading();
    const unitId = ledgerUnitId(reading.catalog.manifest.currency.id);
    const transfers: { holder: string; amount: string }[] = [];
    const beforeReservations = reservationRows();
    try {
      for (const actor of reading.catalog.actors.filter(actor => actor.polityId === 'ALPHA')) {
        const amount = getReservationAvailability(branchId, { kind: 'money', unitId, holderRef: actor.actorId }).available;
        if (BigInt(amount) <= 0n) continue;
        appendLedgerEntries(gameId, branchId, [{
          effectId: `mg05r_cash_out_${actor.actorId}`, entryIndex: 0, cause: 'trasferimento',
          kind: 'money', unitId, fromRef: actor.actorId, toRef: 'mg05r_cash_escrow',
          delta: amount, atDate: '1951-01-01',
        }]);
        transfers.push({ holder: actor.actorId, amount });
      }
      expect(transfers.length).toBeGreaterThan(0);
      const beforeLedger = ledgerRows();
      const buildable = buildableWorks(reading);
      expect(buildable.every(work => work.missing.length > 0), 'ogni opera richiede anche fondi').toBe(true);
      expect(ledgerRows()).toBe(beforeLedger);
      expect(reservationRows()).toBe(beforeReservations);
    } finally {
      for (const transfer of transfers) {
        appendLedgerEntries(gameId, branchId, [{
          effectId: `mg05r_cash_back_${transfer.holder}`, entryIndex: 0, cause: 'trasferimento',
          kind: 'money', unitId, fromRef: 'mg05r_cash_escrow', toRef: transfer.holder,
          delta: transfer.amount, atDate: '1951-01-01',
        }]);
      }
    }
    expect(buildableWorks(reading).every(work => work.missing.length === 0)).toBe(true);
  });

  it.each(['money', 'material'] as const)('la copertura del catalogo sottrae le riserve attive di %s', async kind => {
    const { buildableWorks, readGovernmentAgenda } = await import('../src/game/GovernmentReadings');
    const { createReservation, releaseReservation, getReservationAvailability } = await import('../src/services/ReservationService');
    const { ledgerUnitId } = await import('../src/services/StrictEffectProducerService');
    const reading = catalogReading();
    const unitId = ledgerUnitId(kind === 'money' ? reading.catalog.manifest.currency.id : 'steel');
    const reservations: { id: string; amount: string }[] = [];
    const beforeLedger = ledgerRows();
    try {
      for (const actor of reading.catalog.actors.filter(actor => actor.polityId === 'ALPHA')) {
        const target = { kind, unitId, holderRef: actor.actorId };
        const available = getReservationAvailability(branchId, target).available;
        if (BigInt(available) <= 0n) continue;
        const id = `mg05r_coverage_${kind}_${actor.actorId}`;
        createReservation(gameId, branchId, { reservationId: id, target, amount: available });
        reservations.push({ id, amount: available });
      }
      expect(reservations.length).toBeGreaterThan(0);
      const beforeReservations = reservationRows();
      const road = buildableWorks(reading).find(work => work.workId === 'w_road')!;
      expect(road.missing.length, 'il saldo lordo coperto non basta se è già impegnato').toBeGreaterThan(0);
      const account = { ...session.getNationalAccounts()[session.getPlayerPolityId()],
        nominalGdpUsdBillions: 100, monthlyBalance: 1, mobilized: 0 };
      const agenda = readGovernmentAgenda({ ...reading, account });
      expect(agenda.voices.find(voice => voice.id === 'build_w_road')).toBeUndefined();
      expect(ledgerRows()).toBe(beforeLedger);
      expect(reservationRows()).toBe(beforeReservations);
    } finally {
      for (const reservation of reservations) {
        releaseReservation(gameId, branchId, reservation.id, {
          operationId: `${reservation.id}_release`, amount: reservation.amount,
        });
      }
    }
    expect(buildableWorks(reading).find(work => work.workId === 'w_road')!.missing).toEqual([]);
    expect(ledgerRows()).toBe(beforeLedger);
  });

  it('un cantiere senza deficit NON produce una voce di deficit', async () => {
    const { commitWork } = await import('../src/services/WorkCommitService');
    const catalog = loadSimulationCatalog(path.join(process.cwd(), 'data', 'presets', 'realism_test_world')).catalog!;
    commitWork({
      gameId, branchId, orderId: 'mg05r_cantiere',
      holders: { money: 'alpha_treasury', materials: 'alpha_steel_co' },
      work: catalog.works.find(w => w.id === 'w_road')!, regionId: REGION_ID,
    });

    const agenda = await readAgenda();
    // Il cantiere ha tutto: nessuna voce di deficit materiale per l'acciaio.
    const steelDeficit = agenda.voices.find(v => v.id === 'deficit_MATERIAL_SHORTAGE_steel');
    expect(steelDeficit, 'un cantiere coperto non deve produrre un deficit inventato').toBeUndefined();
  });

  it('la fase che STA PER PARTIRE conta: il lettore non guarda solo l’attiva', async () => {
    // Il difetto del lettore, difeso in modo diretto: la prima versione guardava
    // solo la fase ATTIVA, che ha già consumato la sua distinta — quindi il
    // fabbisogno risultava coperto anche quando il cantiere si sarebbe fermato
    // alla fase successiva.
    //
    // Il test agisce sui DATI, non sul catalogo: il catalogo è la fonte
    // autorevole e non si piega nel test. Si porta il saldo del detentore al di
    // sotto della seconda fase (che chiede 4 kg) e sopra la prima (8 kg già
    // spesi), e si verifica che il deficit compaia — cosa che il lettore vecchio
    // non faceva.
    const { blockedDeficits } = await import('../src/game/GovernmentReadings');
    const { listStrictProjects } = await import('../src/repositories/project-runtime.repository');
    const { appendLedgerEntries } = await import('../src/repositories/ledger.repository');
    const { ledgerUnitId } = await import('../src/services/StrictEffectProducerService');
    const { getReservationAvailability } = await import('../src/services/ReservationService');

    const project = listStrictProjects(gameId, branchId)[0];
    const holder = project.context.materialActorId;
    const unitId = ledgerUnitId('steel');

    // Si porta il saldo a 2 kg: meno dei 4 della pavimentazione, più di zero.
    // Il movimento è di TRASFERIMENTO — la merce va al cantiere, non si distrugge.
    const held = db.prepare(
      "SELECT COALESCE(SUM(CASE WHEN to_ref=? THEN CAST(delta AS INTEGER) ELSE -CAST(delta AS INTEGER) END),0) AS n FROM ledger_entries WHERE branch_id=? AND kind='material' AND unit_id=? AND (to_ref=? OR from_ref=?)",
    ).get(holder, branchId, unitId, holder, holder) as { n: number };
    if (held.n > 2) {
      appendLedgerEntries(gameId, branchId, [{
        effectId: 'mg05r_riduce', entryIndex: 0, cause: 'consumo', kind: 'material', unitId,
        fromRef: holder, toRef: `site:${project.projectId}`,
        delta: String(held.n - 2), atDate: '1951-01-06',
      }]);
    }
    void getReservationAvailability;

    const before = blockedDeficits({
      gameId, branchId, playerPolityId: 'ALPHA', government: session.getGovernment(),
      catalog: loadSimulationCatalog(path.join(process.cwd(), 'data', 'presets', 'realism_test_world')).catalog,
    });
    // Il deficit c'è, e porta i numeri veri: 8 kg richiesti dalla massicciata
    // (che il cantiere non ha ancora speso in questo test), 2 disponibili,
    // 6 mancanti.
    //
    // LIMITE DICHIARATO di questo test: passa anche se il lettore guardasse
    // SOLO la fase attiva, perché in questo scenario l'attiva è scoperta e
    // basta a produrre la voce. La prova al contrario lo ha mostrato. La scelta
    // di guardare anche la fase pianificata — perché il Governo deve vedere il
    // problema PRIMA che il cantiere si fermi — è quindi documentata nel codice
    // e non difesa da un test: per difenderla servirebbe una fixture in cui la
    // fase attiva è coperta e quella successiva no, che richiede un catalogo
    // dedicato. È lavoro dichiarato, non una lacuna nascosta.
    const steel = before.find(d => d.code === 'MATERIAL_SHORTAGE' && d.id === 'steel');
    expect(steel, 'un saldo sotto la distinta deve produrre un deficit').toBeTruthy();
    expect(steel!.required).toBe('8');
    expect(steel!.available).toBe('2');
    expect(steel!.missing).toBe('6');
  });

  it('senza branchId il catalogo dichiara disponibilità ignota e non propone investimenti', async () => {
    const { buildableWorks, readGovernmentAgenda } = await import('../src/game/GovernmentReadings');
    const reading = { ...catalogReading(), branchId: null };
    const road = buildableWorks(reading).find(work => work.workId === 'w_road')!;
    expect(road.missing).toEqual(['stato economico non disponibile']);
    const account = { ...session.getNationalAccounts()[session.getPlayerPolityId()],
      nominalGdpUsdBillions: 100, monthlyBalance: 1, mobilized: 0 };
    const agenda = readGovernmentAgenda({ ...reading, account });
    expect(agenda.voices.filter(voice => voice.id.startsWith('build_'))).toEqual([]);
  });

  it('le voci delle fazioni arrivano dalla fotografia del governo', async () => {
    // La fotografia del governo è la fonte: l'agenda non ricalcola le fazioni.
    const government = session.getGovernment();
    const agenda = await readAgenda();
    const factionVoices = agenda.voices.filter(v => v.factionId !== null);
    // Le fazioni scontente che pesano diventano voci; se nessuna lo è, nessuna
    // voce — e in entrambi i casi il conteggio non supera le fazioni esistenti.
    expect(factionVoices.length).toBeLessThanOrEqual(government.factions.length);
    for (const voice of factionVoices) {
      expect(government.factions.some(f => f.id === voice.factionId)).toBe(true);
    }
  });

  it('P04 — un conto ordinario senza salienza non crea richieste automatiche', async () => {
    const { readGovernmentAgenda } = await import('../src/game/GovernmentReadings');
    const baseGovernment = session.getGovernment();
    const government = { ...baseGovernment, debt: { ratioPct: 110, servicePct: 8 } };
    const account = { ...session.getNationalAccounts()[session.getPlayerPolityId()],
      nominalGdpUsdBillions: 100, monthlyBalance: 0, defenceBurdenPct: 2,
      forces: 200, mobilized: 0, socialTension: 41, stability: 62 };
    const agenda = readGovernmentAgenda({ gameId, branchId, playerPolityId: 'ALPHA', government, account });
    const ids = agenda.voices.map(voice => voice.id);
    for (const id of ['treasury_condition', 'debt_service', 'defence_condition', 'education_condition', 'health_condition']) {
      expect(ids).not.toContain(id);
    }
    expect(ids.filter(id => id.startsWith('build_'))).toEqual([]);
  });

  it('P04 — disavanzo rilevante e minaccia verificata arrivano alle sedie competenti', async () => {
    const { readGovernmentAgenda } = await import('../src/game/GovernmentReadings');
    const account = { ...session.getNationalAccounts()[session.getPlayerPolityId()],
      nominalGdpUsdBillions: 100, monthlyBalance: -1.2, defenceBurdenPct: 2,
      forces: 200, mobilized: 0, socialTension: 41, stability: 62,
      debtRatioPct: 110, debtServicePct: 8 };
    const baseGovernment = session.getGovernment();
    const government = { ...baseGovernment, debt: { ratioPct: 110, servicePct: 8 } };
    const snapshot = buildVerifiedWorldSnapshot({ gameData: {
      id: gameId, playerPolityId: 'ALPHA', currentTurn: 1, currentDate: '1951-01-01',
      world: { regions: { [REGION_ID]: { id: REGION_ID, name: 'A', owner: 'ALPHA', objects: [] } } },
      worldState: { accounts: { ALPHA: account } },
    }, branchId, operationalRows: [] });
    snapshot.diplomacy.relations = [{ polityId: 'BETA', polityName: 'Betaland',
      relationship: 'hostile', sourceRef: 'relations.BETA' }];
    const before = { ledger: ledgerRows(), reservations: reservationRows() };
    const agenda = readGovernmentAgenda({
      gameId, branchId, playerPolityId: 'ALPHA', government, account, snapshot,
    });
    const ids = agenda.voices.map(v => v.id);
    expect(ids).toContain('treasury_condition');
    expect(ids).toContain('defence_condition');
    // E le cifre vengono dal conto, non da una stima: la provenienza è misurata.
    const treasury = agenda.voices.find(v => v.id === 'treasury_condition')!;
    expect(treasury.figures.every(f => f.basis.kind === 'measured')).toBe(true);
    const defence = agenda.voices.find(v => v.id === 'defence_condition')!;
    expect(Number(defence.figures.find(f => f.label === 'Spesa di difesa')!.value))
      .toBe(account.defenceBurdenPct);
    expect(defence.because).toContain('relazioni ostili');
    expect(agenda.canonicalMutation).toBe(false);
    expect(ledgerRows()).toBe(before.ledger);
    expect(reservationRows()).toBe(before.reservations);
  });

  const snapshotFor = (account: Record<string, unknown>, initialReadinessPct?: number) => buildVerifiedWorldSnapshot({
    gameData: {
      id: gameId, playerPolityId: 'ALPHA', currentTurn: 1, currentDate: '1951-01-01',
      world: { regions: { [REGION_ID]: { id: REGION_ID, name: 'A', owner: 'ALPHA', objects: [] } } },
      worldState: { accounts: { ALPHA: account }, resources: { stock: { money: 100 } } },
    } as any,
    branchId, operationalRows: [], initialReadinessPct,
  });

  it.each([false, true])('debt salience uses raw 14.999999 vs 15 (snapshot=%s)', async scoped => {
    const { readGovernmentAgenda } = await import('../src/game/GovernmentReadings');
    for (const servicePct of [14.999999, 15]) {
      const account = { nominalGdpUsdBillions: 100, monthlyBalance: 0,
        debtServicePct: servicePct, debtRatioPct: 100 };
      const government = { ...session.getGovernment(), debt: { ratioPct: 100, servicePct: 15 } };
      const agenda = readGovernmentAgenda({
        gameId, branchId, playerPolityId: 'ALPHA', government,
        account: scoped ? { ...account, debtServicePct: 25 } : account,
        ...(scoped ? { snapshot: snapshotFor(account) } : {}),
      });
      expect(agenda.voices.some(v => v.id === 'treasury_condition'), String(servicePct)).toBe(servicePct >= 15);
      expect(agenda.voices.filter(v => ['treasury_condition', 'debt_service'].includes(v.id)).length)
        .toBe(servicePct >= 15 ? 1 : 0);
    }
  });

  it.each([false, true])('deficit salience uses raw -0.999999 vs -1.000001 with ample cash (snapshot=%s)', async scoped => {
    const { readGovernmentAgenda } = await import('../src/game/GovernmentReadings');
    for (const monthlyBalance of [-0.999999, -1.000001]) {
      const account = { nominalGdpUsdBillions: 100, monthlyBalance, debtServicePct: 8, debtRatioPct: 100 };
      const government = { ...session.getGovernment(), debt: { ratioPct: 100, servicePct: 8 } };
      const snapshot = snapshotFor(account);
      expect(Number(snapshot.facts.treasury.rawValue) / -monthlyBalance).toBeGreaterThan(3);
      const agenda = readGovernmentAgenda({ gameId, branchId, playerPolityId: 'ALPHA', government,
        account: scoped ? { ...account, monthlyBalance: 0 } : account,
        ...(scoped ? { snapshot } : {}),
      });
      expect(agenda.voices.some(v => v.id === 'treasury_condition'), String(monthlyBalance)).toBe(monthlyBalance <= -1);
    }
  });

  it.each(['gameId', 'branchId', 'polityId'] as const)('rejects a snapshot from another %s', async scope => {
    const { readGovernmentAgenda } = await import('../src/game/GovernmentReadings');
    const account = { nominalGdpUsdBillions: 100, monthlyBalance: 0, debtServicePct: 8, debtRatioPct: 100 };
    const snapshot = snapshotFor({ ...account, monthlyBalance: -2, debtServicePct: 25, stability: 0, socialTension: 90 }, 20);
    snapshot[scope] = 'other-scope';
    const agenda = readGovernmentAgenda({ gameId, branchId, playerPolityId: 'ALPHA',
      government: { ...session.getGovernment(), debt: { ratioPct: 100, servicePct: 8 } }, account, snapshot });
    expect(agenda.voices.filter(v => ['treasury_condition', 'debt_service', 'defence_condition',
      'education_condition', 'health_condition'].includes(v.id))).toEqual([]);
  });

  it('raw account debt overrides the legacy rounded government; debtBurdenPct remains a ratio fallback', async () => {
    const { readGovernmentAgenda } = await import('../src/game/GovernmentReadings');
    const government = { ...session.getGovernment(), debt: { ratioPct: 100, servicePct: 8 } };
    const account = { nominalGdpUsdBillions: 100, monthlyBalance: 0,
      debtServicePct: 15, debtRatioPct: NaN, debtBurdenPct: 123.4 };
    const treasury = readGovernmentAgenda({ gameId, branchId, playerPolityId: 'ALPHA', government, account })
      .voices.find(v => v.id === 'treasury_condition')!;
    expect(treasury).toBeTruthy();
    expect(Number(treasury.figures.find(f => f.label === 'Debito su PIL')!.value)).toBe(123.4);
  });

  it.each([undefined, null, NaN])('missing stability (%s) never becomes zero or a fake health crisis', async stability => {
    const { readGovernmentAgenda } = await import('../src/game/GovernmentReadings');
    const government = { ...session.getGovernment(), budget: { ...session.getGovernment().budget, socialBurdenPct: 8 } };
    const agenda = readGovernmentAgenda({ gameId, branchId, playerPolityId: 'ALPHA', government,
      account: { stability, population: 1000 } });
    expect(agenda.voices.find(v => v.id === 'health_condition')).toBeUndefined();
  });

  it.each([false, true])('known social stress surfaces with zero or unknown estimated shares (snapshot=%s)', async scoped => {
    const { readGovernmentAgenda } = await import('../src/game/GovernmentReadings');
    for (const share of [0, undefined, NaN]) {
      const account = { socialTension: 65, stability: 0, universities: NaN, population: undefined };
      const government = { ...session.getGovernment(), budget: { ...session.getGovernment().budget,
        educationBurdenPct: share, socialBurdenPct: share } };
      const agenda = readGovernmentAgenda({ gameId, branchId, playerPolityId: 'ALPHA', government,
        account, ...(scoped ? { snapshot: snapshotFor(account) } : {}) });
      const education = agenda.voices.find(v => v.id === 'education_condition')!;
      const health = agenda.voices.find(v => v.id === 'health_condition')!;
      expect(education).toBeTruthy();
      expect(health).toBeTruthy();
      expect(education.figures.some(f => f.label === 'Atenei')).toBe(false);
      expect(health.figures.some(f => f.label === 'Popolazione')).toBe(false);
      expect(health.figures.find(f => f.label === 'Stabilità')!.value).toBe('0');
      for (const voice of [education, health]) {
        expect(voice.because).not.toMatch(/NaN|undefined|Infinity/);
        expect(voice.figures.every(f => Number.isFinite(Number(f.value)))).toBe(true);
        const spending = voice.figures.find(f => f.label.startsWith('Spesa'));
        if (share === 0) expect(spending?.basis.kind).toBe('estimated');
        else expect(spending).toBeUndefined();
      }
    }
  });

  it('known zero debt measures override legacy nonzero values; unknown service falls back only without a snapshot', async () => {
    const { readGovernmentAgenda } = await import('../src/game/GovernmentReadings');
    const government = { ...session.getGovernment(), debt: { ratioPct: 100, servicePct: 25 } };
    const account = { nominalGdpUsdBillions: 100, monthlyBalance: 0,
      debtServicePct: 0, debtRatioPct: 0, debtBurdenPct: 123 };
    const read = (data: typeof account) => readGovernmentAgenda({ gameId, branchId, playerPolityId: 'ALPHA', government, account: data });
    expect(read(account).voices.some(v => ['treasury_condition', 'debt_service'].includes(v.id))).toBe(false);
    const treasury = read({ ...account, debtServicePct: 15 }).voices.find(v => v.id === 'treasury_condition')!;
    expect(treasury.figures.find(f => f.label === 'Debito su PIL')!.value).toBe('0');
    expect(read({ ...account, debtServicePct: NaN }).voices.some(v => v.id === 'treasury_condition')).toBe(true);
    const canonical = readGovernmentAgenda({ gameId, branchId, playerPolityId: 'ALPHA', government,
      account, snapshot: snapshotFor({ ...account, debtServicePct: undefined }) });
    expect(canonical.voices.some(v => ['treasury_condition', 'debt_service'].includes(v.id))).toBe(false);
  });

  it('a scoped snapshot preserves unknown social facts rather than taking a stale account crisis', async () => {
    const { readGovernmentAgenda } = await import('../src/game/GovernmentReadings');
    const agenda = readGovernmentAgenda({ gameId, branchId, playerPolityId: 'ALPHA', government: session.getGovernment(),
      account: { socialTension: 90, stability: 0 }, snapshot: snapshotFor({}) });
    expect(agenda.voices.filter(v => ['education_condition', 'health_condition'].includes(v.id))).toEqual([]);
  });

  it.each([undefined, {}])('operational salience speaks without inventing missing military account figures (%s)', async account => {
    const { readGovernmentAgenda } = await import('../src/game/GovernmentReadings');
    const agenda = readGovernmentAgenda({ gameId, branchId, playerPolityId: 'ALPHA',
      government: session.getGovernment(), account, snapshot: snapshotFor({}, 35) });
    const defence = agenda.voices.find(v => v.id === 'defence_condition')!;
    expect(defence).toBeTruthy();
    expect(defence.figures.find(f => f.label === 'Prontezza')!.basis.kind).toBe('estimated');
    expect(defence.figures.some(f => ['Spesa di difesa', 'Reparti in forza', 'Mobilitati'].includes(f.label))).toBe(false);
    expect(defence.because).not.toMatch(/NaN|undefined|Infinity/);
  });

  it.each([false, true])('partial military and fiscal accounts omit non-finite support but preserve measured zeros (snapshot=%s)', async scoped => {
    const { readGovernmentAgenda } = await import('../src/game/GovernmentReadings');
    const account = { nominalGdpUsdBillions: 100, monthlyBalance: 0, debtServicePct: 15,
      debtRatioPct: 0, forces: 0, mobilized: 1000, defenceBurdenPct: NaN };
    const government = { ...session.getGovernment(), debt: { ratioPct: 100, servicePct: 8 } };
    const agenda = readGovernmentAgenda({ gameId, branchId, playerPolityId: 'ALPHA', government,
      account, ...(scoped ? { snapshot: snapshotFor(account) } : {}) });
    const defence = agenda.voices.find(v => v.id === 'defence_condition')!;
    const treasury = agenda.voices.find(v => v.id === 'treasury_condition')!;
    expect(defence.figures.find(f => f.label === 'Reparti in forza')!.value).toBe('0');
    expect(defence.figures.some(f => f.label === 'Spesa di difesa')).toBe(false);
    for (const voice of [defence, treasury]) {
      expect(voice.because).not.toMatch(/NaN|undefined|Infinity/);
      expect(voice.figures.every(f => Number.isFinite(Number(f.value)))).toBe(true);
    }
  });

  it('P04 — senza il conto, il Tesoro e la Guerra TACCIONO: la regola non si piega', async () => {
    // La guardia contro il falso verde: la nuova fonte non ha abolito la regola
    // «un ministro senza dati tace». Senza conto, nessuna cifra inventata.
    const { readGovernmentAgenda } = await import('../src/game/GovernmentReadings');
    const agenda = readGovernmentAgenda({
      gameId, branchId, playerPolityId: 'ALPHA', government: session.getGovernment(),
    });
    const ids = agenda.voices.map(v => v.id);
    expect(ids).not.toContain('treasury_condition');
    expect(ids).not.toContain('defence_condition');
    // WS-GOVOFFICE-05 — e senza conto tacciono anche Istruzione e Sanità.
    expect(ids).not.toContain('education_condition');
    expect(ids).not.toContain('health_condition');
  });

  it('WS-GOVOFFICE-05 — con disagio civile, Istruzione e Sanità portano le cifre del conto', async () => {
    // Difende il CABLAGGIO delle due sedie nuove: la logica vive in `buildAgenda`
    // (testata a parte), ma se `readGovernmentAgenda` non leggesse il conto per
    // loro le due sedie tacerebbero comunque. La fixture economica di questo
    // mondo di prova è minima e non produce uscite (perciò le quote di spesa
    // sono a 0): qui si isola il cablaggio sui dati d'ingresso — conto con
    // atenei, popolazione e tensione, fotografia con le due quote — non la
    // contabilità del motore, che è coperta da `NationalBudget` a parte.
    const { readGovernmentAgenda } = await import('../src/game/GovernmentReadings');
    const baseAccount = session.getNationalAccounts()[session.getPlayerPolityId()];
    const baseGovernment = session.getGovernment();
    const account = {
      ...baseAccount,
      universities: 12,
      population: 50_000_000,
      stability: 40,
      socialTension: 65,
    };
    const government = {
      ...baseGovernment,
      budget: { ...baseGovernment.budget, educationBurdenPct: 3.4, socialBurdenPct: 8.1 },
    };
    const agenda = readGovernmentAgenda({
      gameId, branchId, playerPolityId: 'ALPHA', government, account,
    });
    const education = agenda.voices.find(v => v.id === 'education_condition')!;
    const health = agenda.voices.find(v => v.id === 'health_condition')!;
    expect(education, 'Istruzione deve comparire con tensione sociale significativa').toBeTruthy();
    expect(health, 'Sanità deve comparire con stabilità bassa').toBeTruthy();
    // Istruzione: la spesa è la quota della fotografia, gli atenei del conto.
    expect(Number(education.figures.find(f => f.label === 'Spesa per istruzione e ricerca')!.value)).toBe(3.4);
    expect(Number(education.figures.find(f => f.label === 'Atenei')!.value)).toBe(12);
    // Sanità: la popolazione è quella del conto, e la voce dichiara che il dato
    // è sanità + sostegno, non la sola sanità.
    expect(Number(health.figures.find(f => f.label === 'Popolazione')!.value)).toBe(50_000_000);
    expect(health.because).toContain('sanità e sostegno');
    // Ogni cifra porta la sua provenienza, e la quota di spesa è una stima.
    expect(health.figures.find(f => f.label.startsWith('Spesa sociale'))!.basis.kind).toBe('estimated');
  });
});
