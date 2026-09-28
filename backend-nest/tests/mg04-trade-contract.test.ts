/**
 * MG04 µ3 — Trattativa, contratto, merce: tre cose diverse
 * ======================================================
 * L'invariante MG-I4 lo dice in una riga, e questo file la difende: **accettare
 * un'offerta non è ricevere la merce**. Il giro è firmare → partire → arrivare,
 * e ogni passo lascia lo stato in un posto diverso:
 *
 *  - alla **firma**: la cassa del compratore è impegnata e la merce del venditore
 *    è riservata. Nessuno dei due ha speso o ricevuto nulla;
 *  - alla **partenza**: la merce esce dal venditore ed entra in `transit:<id>`.
 *    Non è nel magazzino del compratore — è sulla strada;
 *  - all'**arrivo**: la merce entra dal transito al compratore, ed è allora che
 *    il pagamento si regola.
 *
 * Guardia contro il falso verde: si guarda il LEDGER — chi detiene cosa, dopo
 * ogni passo — non solo il valore di ritorno della funzione. Un test che si
 * accontentasse di «il contratto è firmato» passerebbe anche con la merce già
 * nel magazzino del compratore, che è esattamente il difetto da evitare.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { loadSimulationCatalog } from '../src/scenario/loader';
import type { CounterpartyStock, DeclaredPrice, TradeRoute } from '../src/core/economy/TradeOffer';

const DB = path.join(os.tmpdir(), `world-story-mg04c-${process.pid}-${Date.now()}.db`);
process.env.OPEN_PAX_DB_PATH = DB;

const FIXTURE_DIR = path.join(process.cwd(), 'data', 'presets', 'realism_test_world');
const WORLD_ID = 'mg04c-world';
const REGION_ID = 'mg04c-region';

const catalog = () => loadSimulationCatalog(FIXTURE_DIR).catalog!;

/** Il prezzo è DICHIARATO, non scelto dal test: 2 unità minime per kg. */
const price: DeclaredPrice = {
  resourceId: 'steel', currencyId: 'TEST',
  minorUnitsPerBaseUnit: { numerator: '2', denominator: '1' },
};
const route: TradeRoute = { originRegionId: 'BETA-est', destinationRegionId: REGION_ID, days: 5 };

describe('MG04 µ3 — contratto e consegna di merce', () => {
  let db: any;
  let gameId = '';
  let branchId = '';

  beforeAll(async () => {
    const d = await import('../src/database');
    db = d.default;
    d.initDatabase();
    const worlds = (await import('../src/repositories/world.repository')).worldRepository;
    worlds.createWithRegions(
      { id: WORLD_ID, name: 'MG04c', templateId: 'realism_test_world' },
      [{ id: REGION_ID, name: 'Pianura', color: '#000', owner: 'ALPHA', population: 1, gdp: 1, militaryPower: 1, flag: 'A' }],
    );
    const registry = await import('../src/session-registry');
    registry.initSessionRegistry({ consolidation: { startRound: 25, chunkSize: 5, keepRawTail: 10 }, clearCache() {} } as never);
    const created = registry.getSessionRegistry().createSession(WORLD_ID, 'P', REGION_ID);
    gameId = created.gameId;
    branchId = created.session.fenceContext().branchId!;
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

  /** La giacenza di un attore in una risorsa, letta dal ledger. */
  const stockOf = (holder: string, resourceId = 'steel'): string => {
    const row = db.prepare(
      "SELECT COALESCE(SUM(CAST(delta AS INTEGER)), 0) AS n FROM ledger_entries WHERE branch_id = ? AND kind = 'material' AND unit_id = ? AND (to_ref = ? OR from_ref = ?)",
    ).get(branchId, resourceId, holder, holder) as { n: number };
    // Somma algebrica: entrate meno uscite. Il ledger è append-only, quindi
    // questo è il saldo vero, non una stima.
    const entries = db.prepare(
      "SELECT delta, to_ref, from_ref FROM ledger_entries WHERE branch_id = ? AND kind = 'material' AND unit_id = ? AND (to_ref = ? OR from_ref = ?)",
    ).all(branchId, resourceId, holder, holder) as { delta: string; to_ref: string | null; from_ref: string | null }[];
    let total = 0n;
    for (const entry of entries) {
      const delta = BigInt(entry.delta);
      total += entry.to_ref === holder ? delta : -delta;
    }
    void row;
    return total.toString();
  };

  /** Le giacenze di BETA per l'acciaio: la controparte della trattativa. */
  const betaSteel = (): CounterpartyStock[] => [{
    holderActorId: 'beta_treasury', polityId: 'BETA',
    resourceId: 'steel', available: stockOf('beta_treasury'),
  }];

  // Nota misurata: chi PAGA non è chi CUSTODISCE. Il conto monetario è della
  // tesoreria dell'impresa; la merce arriva all'impresa. Il test lo dichiara
  // invece di assumere che siano lo stesso attore.
  it('alla firma nessuno ha speso né ricevuto: la merce è RISERVATA', async () => {
    const { createTradeContract } = await import('../src/services/TradeContractService');
    const buyerBefore = stockOf('alpha_steel_co');
    const sellerBefore = stockOf('beta_treasury');

    const outcome = createTradeContract({
      gameId, branchId, contractId: 'ct_firma',
      buyerActorId: 'alpha_steel_co_treasury', sellerPolityId: 'BETA',
      resourceId: 'steel', requested: '20',
      stocks: betaSteel(), price, route, departureDate: '1951-01-10',
      // Il trasporto è AUTORIZZATO dal chiamante, non dalla firma: senza,
      // la spedizione resta `blocked` e la merce non parte.
      transportAuthorized: true,
    });

    expect(outcome.kind).toBe('signed');
    if (outcome.kind !== 'signed') return;
    expect(outcome.arrivalDate).toBe('1951-01-15');

    // Il ledger NON si è mosso: nessuna merce ha cambiato mano.
    expect(stockOf('alpha_steel_co')).toBe(buyerBefore);
    expect(stockOf('beta_treasury')).toBe(sellerBefore);

    // Ma la merce è riservata: non è più disponibile per altri.
    const { getReservationAvailability } = await import('../src/services/ReservationService');
    const { ledgerUnitId } = await import('../src/services/StrictEffectProducerService');
    const availability = getReservationAvailability(branchId, {
      kind: 'material', unitId: ledgerUnitId('steel'), holderRef: 'beta_treasury',
    });
    expect(availability.committed).toBe('20');
    expect(availability.available).toBe('130');
  });

  it('la spedizione è «planned»: firmata, non ancora partita', async () => {
    const row = db.prepare(
      'SELECT shipment_json FROM shipment_runtime_states WHERE branch_id = ? AND shipment_id = ?',
    ).get(branchId, 'shp_ct_firma') as { shipment_json: string };
    const shipment = JSON.parse(row.shipment_json);
    expect(shipment.status).toBe('planned');
    expect(shipment.originRef).toBe('beta_treasury');
    expect(shipment.destinationRef).toBe('alpha_steel_co_treasury');
    expect(shipment.departureDate).toBe('1951-01-10');
    expect(shipment.arrivalDate).toBe('1951-01-15');
  });

  it('alla partenza la merce è IN VIAGGIO, non nel magazzino del compratore', async () => {
    // Il tick fa partire la spedizione alla data dichiarata. La merce esce dal
    // venditore ed entra in `transit:`, che NON è il compratore.
    const { runStrictTick } = await import('../src/core/simulation/TurnOrchestrator');
    const buyerBefore = stockOf('alpha_steel_co');

    runStrictTick(gameId, branchId, db.prepare('SELECT world_revision AS r FROM games WHERE id = ?').get(gameId).r, '1951-01-10');

    // Il venditore ha ceduto la merce...
    expect(stockOf('beta_treasury')).toBe('130');
    // ...ma il compratore NON l'ha ricevuta: è sulla strada.
    expect(stockOf('alpha_steel_co')).toBe(buyerBefore);
    expect(stockOf('transit:shp_ct_firma')).toBe('20');

    const row = db.prepare(
      'SELECT shipment_json FROM shipment_runtime_states WHERE branch_id = ? AND shipment_id = ?',
    ).get(branchId, 'shp_ct_firma') as { shipment_json: string };
    expect(JSON.parse(row.shipment_json).status).toBe('in_transit');
  });

  it('all’arrivo la merce entra dal transito al compratore', async () => {
    const { runStrictTick } = await import('../src/core/simulation/TurnOrchestrator');
    // La merce arriva al DESTINATARIO dichiarato nella spedizione, che è il
    // compratore del contratto: `alpha_steel_co_treasury`. Che sia anche il
    // detentore dei materiali del cantiere è una scelta di chi firma, non un
    // fatto automatico — e il test non la presume.
    const buyerBefore = stockOf('alpha_steel_co_treasury');

    runStrictTick(gameId, branchId, db.prepare('SELECT world_revision AS r FROM games WHERE id = ?').get(gameId).r, '1951-01-15');

    // Ora sì: la merce è del compratore, e il transito è vuoto.
    expect(BigInt(stockOf('alpha_steel_co_treasury')) - BigInt(buyerBefore)).toBe(20n);
    expect(stockOf('transit:shp_ct_firma')).toBe('0');

    const row = db.prepare(
      'SELECT shipment_json FROM shipment_runtime_states WHERE branch_id = ? AND shipment_id = ?',
    ).get(branchId, 'shp_ct_firma') as { shipment_json: string };
    expect(JSON.parse(row.shipment_json).status).toBe('delivered');
  });

  it('alla consegna il pagamento SI REGOLA: il venditore incassa, la riserva si chiude', async () => {
    // Il difetto che il revisore ha misurato: nessuno consumava `tpay_*`, quindi
    // la cassa restava riservata per sempre e il venditore non incassava mai —
    // mentre il commento del modulo diceva «alla consegna il pagamento si
    // regola». Era falso.
    const { createTradeContract, settleTradePayment } = await import('../src/services/TradeContractService');
    const { runStrictTick } = await import('../src/core/simulation/TurnOrchestrator');
    const { getReservationAvailability } = await import('../src/services/ReservationService');
    const { ledgerUnitId } = await import('../src/services/StrictEffectProducerService');

    const sellerBefore = Number(stockOf('beta_treasury'));
    void sellerBefore;
    const moneyOf = (holder: string): string => {
      const rows = db.prepare(
        "SELECT to_ref, from_ref, delta FROM ledger_entries WHERE branch_id = ? AND kind = 'money' AND unit_id = ? AND (to_ref = ? OR from_ref = ?)",
      ).all(branchId, ledgerUnitId('TEST'), holder, holder) as any[];
      let total = 0n;
      for (const row of rows) {
        const delta = BigInt(row.delta);
        total += row.to_ref === holder ? delta : -delta;
      }
      return total.toString();
    };

    const outcome = createTradeContract({
      gameId, branchId, contractId: 'ct_pagamento',
      buyerActorId: 'alpha_steel_co_treasury', sellerPolityId: 'BETA',
      resourceId: 'steel', requested: '10',
      stocks: betaSteel(), price, route: { ...route, days: 3 },
      departureDate: '1951-07-01', transportAuthorized: true,
    });
    expect(outcome.kind).toBe('signed');
    if (outcome.kind !== 'signed') return;

    const sellerCashBefore = moneyOf('beta_treasury');
    const buyerCashBefore = moneyOf('alpha_steel_co_treasury');

    // Partenza e arrivo.
    runStrictTick(gameId, branchId, db.prepare('SELECT world_revision AS r FROM games WHERE id = ?').get(gameId).r, '1951-07-01');
    runStrictTick(gameId, branchId, db.prepare('SELECT world_revision AS r FROM games WHERE id = ?').get(gameId).r, '1951-07-04');

    // La merce è arrivata, e il pagamento si liquida: 10 kg × 2 = 20.
    const settled = settleTradePayment({
      gameId, branchId, contractId: 'ct_pagamento',
      buyerActorId: 'alpha_steel_co_treasury', sellerActorId: 'beta_treasury',
      currencyId: 'TEST', amountMinorUnits: outcome.kind === 'signed' ? '20' : '0',
      asOfDate: '1951-07-04',
    });
    expect(settled).toBe(true);

    // Il venditore ha incassato, il compratore ha pagato: la cassa si è mossa.
    expect(BigInt(moneyOf('beta_treasury')) - BigInt(sellerCashBefore)).toBe(20n);
    expect(BigInt(buyerCashBefore) - BigInt(moneyOf('alpha_steel_co_treasury'))).toBe(20n);

    // E LA RISERVA DI QUESTO CONTRATTO è chiusa: non resta cassa impegnata per
    // sempre. Si guarda la riserva del contratto, non il totale dei conti —
    // altri contratti di questo file hanno le loro riserve, legittimamente.
    const reservationRow = db.prepare(
      'SELECT status, remaining_amount FROM reservations WHERE branch_id = ? AND reservation_id = ?',
    ).get(branchId, 'tpay_ct_pagamento') as { status: string; remaining_amount: string };
    expect(reservationRow.status).toBe('consumed');
    expect(reservationRow.remaining_amount).toBe('0');
    const after = getReservationAvailability(branchId, {
      kind: 'money', unitId: ledgerUnitId('TEST'), holderRef: 'alpha_steel_co_treasury',
    });
    // Il totale dei conti non è zero: altri contratti sono ancora aperti.
    expect(BigInt(after.total)).toBeGreaterThan(0n);
  });

  it('liquidare due volte lo stesso pagamento non paga due volte', async () => {
    const { settleTradePayment } = await import('../src/services/TradeContractService');
    // Il contratto precedente è già liquidato: la seconda chiamata è un no-op.
    const second = settleTradePayment({
      gameId, branchId, contractId: 'ct_pagamento',
      buyerActorId: 'alpha_steel_co_treasury', sellerActorId: 'beta_treasury',
      currencyId: 'TEST', amountMinorUnits: '20', asOfDate: '1951-07-04',
    });
    expect(second).toBe(false);
  });

  it('senza autorizzazione al trasporto la merce non parte: la firma non autorizza sé stessa', async () => {
    // Prima `createShipmentRuntime` riceveva `true` cablato: il contratto
    // autorizzava il proprio trasporto. Ora è una decisione del chiamante, e
    // senza di essa la spedizione resta `blocked` — e lo dichiara.
    const { createTradeContract } = await import('../src/services/TradeContractService');
    const { runStrictTick } = await import('../src/core/simulation/TurnOrchestrator');
    const sellerBefore = stockOf('beta_treasury');

    const outcome = createTradeContract({
      gameId, branchId, contractId: 'ct_senza_trasporto',
      buyerActorId: 'alpha_steel_co_treasury', sellerPolityId: 'BETA',
      resourceId: 'steel', requested: '10',
      stocks: betaSteel(), price, route, departureDate: '1951-04-01',
      // transportAuthorized assente = non autorizzato.
    });
    expect(outcome.kind).toBe('signed');

    runStrictTick(gameId, branchId, db.prepare('SELECT world_revision AS r FROM games WHERE id = ?').get(gameId).r, '1951-04-05');

    // La merce NON si è mossa: il venditore ce l'ha ancora.
    expect(stockOf('beta_treasury')).toBe(sellerBefore);
    const row = db.prepare(
      'SELECT shipment_json FROM shipment_runtime_states WHERE branch_id = ? AND shipment_id = ?',
    ).get(branchId, 'shp_ct_senza_trasporto') as { shipment_json: string };
    expect(JSON.parse(row.shipment_json).status).toBe('blocked');
  });

  it('senza rotta non si firma: «in viaggio» senza tragitto non significa nulla', async () => {
    const { createTradeContract } = await import('../src/services/TradeContractService');
    const outcome = createTradeContract({
      gameId, branchId, contractId: 'ct_senza_rotta',
      buyerActorId: 'alpha_steel_co_treasury', sellerPolityId: 'BETA',
      resourceId: 'steel', requested: '10',
      stocks: betaSteel(), price, route: undefined, departureDate: '1951-02-01',
    });
    expect(outcome.kind).toBe('no_route');
  });

  it('senza prezzo dichiarato non si firma: non si inventa un numero', async () => {
    const { createTradeContract } = await import('../src/services/TradeContractService');
    const outcome = createTradeContract({
      gameId, branchId, contractId: 'ct_senza_prezzo',
      buyerActorId: 'alpha_steel_co_treasury', sellerPolityId: 'BETA',
      resourceId: 'steel', requested: '10',
      stocks: betaSteel(), price: undefined, route, departureDate: '1951-02-01',
    });
    expect(outcome.kind).toBe('needs_price');
  });

  it('senza cassa non si firma, e nessuna riserva resta appesa', async () => {
    const { createTradeContract } = await import('../src/services/TradeContractService');
    const reservations = () => (db.prepare(
      'SELECT COUNT(*) AS n FROM reservations WHERE branch_id = ?',
    ).get(branchId) as { n: number }).n;
    const before = reservations();

    const outcome = createTradeContract({
      gameId, branchId, contractId: 'ct_senza_cassa',
      // Un attore senza conto monetario non può pagare.
      buyerActorId: 'alpha_farms', sellerPolityId: 'BETA',
      resourceId: 'steel', requested: '10',
      stocks: betaSteel(), price, route, departureDate: '1951-02-01',
    });
    expect(outcome.kind).toBe('unaffordable');
    // Il rifiuto è un esito, non una transazione a metà: nessuna riserva.
    expect(reservations()).toBe(before);
  });

  it('una merce che la controparte non ha non produce un contratto', async () => {
    const { createTradeContract } = await import('../src/services/TradeContractService');
    const outcome = createTradeContract({
      gameId, branchId, contractId: 'ct_senza_merce',
      buyerActorId: 'alpha_steel_co_treasury', sellerPolityId: 'BETA',
      // I cereali di BETA non esistono: la sua agricoltura è di ALPHA.
      resourceId: 'grain', requested: '100',
      stocks: [{ holderActorId: 'beta_treasury', polityId: 'BETA', resourceId: 'grain', available: '0' }],
      price: { resourceId: 'grain', currencyId: 'TEST', minorUnitsPerBaseUnit: { numerator: '1', denominator: '1' } },
      route, departureDate: '1951-02-01',
    });
    expect(outcome.kind).toBe('no_stock');
  });

  it('firmare due volte lo stesso contratto è idempotente', async () => {
    const { createTradeContract } = await import('../src/services/TradeContractService');
    const reservations = () => (db.prepare(
      'SELECT COUNT(*) AS n FROM reservations WHERE branch_id = ?',
    ).get(branchId) as { n: number }).n;

    const first = createTradeContract({
      gameId, branchId, contractId: 'ct_retry',
      buyerActorId: 'alpha_steel_co_treasury', sellerPolityId: 'BETA',
      resourceId: 'steel', requested: '10',
      stocks: betaSteel(), price, route, departureDate: '1951-03-01',
    });
    expect(first.kind).toBe('signed');
    const after = reservations();

    // Un retry con lo stesso contractId non impegna una seconda volta.
    const second = createTradeContract({
      gameId, branchId, contractId: 'ct_retry',
      buyerActorId: 'alpha_steel_co_treasury', sellerPolityId: 'BETA',
      resourceId: 'steel', requested: '10',
      stocks: betaSteel(), price, route, departureDate: '1951-03-01',
    });
    expect(second.kind).toBe('signed');
    expect(reservations()).toBe(after);
  });
});
