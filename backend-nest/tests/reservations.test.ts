/**
 * M02 µ3 — prenotazioni fondi/stock atomiche e idempotenti (MAT05).
 * ==================================================================
 * Fixture obbligatoria §7.1: 1.000 TEST, 100 kg acciaio (=100.000 g),
 * P1 riserva 600/60 kg; P2 non può prendere la stessa capacità. Dopo 3
 * giorni P1 ha consumato 180/18 kg: totale 820/82 kg, committed 420/42 kg,
 * disponibile ancora 400/40 kg. Consume = ledger + decremento nello stesso
 * commit; retry = no-op, nessuna doppia sottrazione.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import type { LedgerEntryInput } from '../src/domain/ledger';

const TEST_DB = path.join(os.tmpdir(), `world-story-reservations-${process.pid}-${Date.now()}.db`);
process.env.OPEN_PAX_DB_PATH = TEST_DB;

type LedgerRepository = typeof import('../src/repositories/ledger.repository');
type Reservations = typeof import('../src/services/ReservationService');

let ledger: LedgerRepository;
let reservations: Reservations;

const GAME = 'reservation-game';
const TREASURY = 'treasury_a';
const HOUSEHOLDS = 'households_a';
const STEEL_HOLDER = 'treasury_a';
const MONEY = { kind: 'money' as const, unitId: 'test', holderRef: TREASURY };
const STEEL = { kind: 'material' as const, unitId: 'steel', holderRef: STEEL_HOLDER };

function entry(
  effectId: string,
  kind: 'money' | 'material',
  unitId: string,
  cause: LedgerEntryInput['cause'],
  fromRef: string | null,
  toRef: string | null,
  delta: string,
  atDate = '1951-01-01',
): LedgerEntryInput {
  return { effectId, entryIndex: 0, kind, unitId, cause, fromRef, toRef, delta, atDate };
}

function seedFixture(branchId: string): void {
  // Dati sintetici iniziali APPROVATI della fixture, non creati da un ordine.
  ledger.appendLedgerEntries(GAME, branchId, [
    entry('seed_cash', 'money', 'test', 'incasso', null, TREASURY, '1000'),
    entry('seed_steel', 'material', 'steel', 'estrazione', null, STEEL_HOLDER, '100000'), // grammi
  ]);
}

function reserveP1(branchId: string): void {
  reservations.createReservation(GAME, branchId, {
    reservationId: 'p1_cash_phase_1', target: MONEY, amount: '600',
  });
  reservations.createReservation(GAME, branchId, {
    reservationId: 'p1_steel_phase_1', target: STEEL, amount: '60000',
  });
}

beforeAll(async () => {
  const database = await import('../src/database');
  database.initDatabase();
  ledger = await import('../src/repositories/ledger.repository');
  reservations = await import('../src/services/ReservationService');
});

afterAll(() => {
  try { fs.rmSync(TEST_DB); } catch { /* DB temporaneo */ }
});

describe('M02 µ3 — due cantieri non prenotano la stessa quantità (MAT05, §7.1)', () => {
  const branch = 'fixture-preflight';

  it('P1 impegna 600 TEST e 60 kg; P2 è bloccato e la preview non crea riserve', () => {
    seedFixture(branch);
    expect(reservations.getReservationAvailability(branch, MONEY)).toMatchObject({
      total: '1000', committed: '0', available: '1000', shortfall: '0',
    });
    expect(reservations.getReservationAvailability(branch, STEEL)).toMatchObject({
      total: '100000', committed: '0', available: '100000', shortfall: '0',
    });

    reserveP1(branch);
    expect(reservations.getReservationAvailability(branch, MONEY)).toMatchObject({
      total: '1000', committed: '600', available: '400', shortfall: '0',
    });
    expect(reservations.getReservationAvailability(branch, STEEL)).toMatchObject({
      total: '100000', committed: '60000', available: '40000', shortfall: '0',
    });

    // Il secondo cantiere non ottiene né gli stessi fondi né lo stesso acciaio.
    expect(() => reservations.createReservation(GAME, branch, {
      reservationId: 'p2_cash_phase_1', target: MONEY, amount: '600',
    })).toThrow(reservations.InsufficientAvailabilityError);
    expect(() => reservations.createReservation(GAME, branch, {
      reservationId: 'p2_steel_phase_1', target: STEEL, amount: '60000',
    })).toThrow(/disponibili 40000/);
    expect(reservations.getReservation(branch, 'p2_cash_phase_1')).toBeNull();
    expect(reservations.getReservation(branch, 'p2_steel_phase_1')).toBeNull();
  });

  it('retry della creazione è no-op verificato, non una seconda prenotazione', () => {
    const retry = reservations.createReservation(GAME, branch, {
      reservationId: 'p1_cash_phase_1', target: MONEY, amount: '600',
    });
    expect(retry.created).toBe(false);
    expect(retry.reservation.remainingAmount).toBe('600');
    expect(retry.availability).toMatchObject({ committed: '600', available: '400' });
    expect(() => reservations.createReservation(GAME, branch, {
      reservationId: 'p1_cash_phase_1', target: MONEY, amount: '601',
    })).toThrow(reservations.ReservationConflictError);
  });
});

describe('M02 µ3 — consume atomico, senza doppia sottrazione (MAT05)', () => {
  const branch = 'fixture-three-days';

  it('dopo tre giornate: cassa 820, households 180, acciaio 82kg; riserve 420/42kg', () => {
    seedFixture(branch);
    reserveP1(branch);
    for (let day = 1; day <= 3; day += 1) {
      const date = `1951-01-0${day}`;
      const cashOperation = `p1_cash_day_${day}`;
      const steelOperation = `p1_steel_day_${day}`;
      const cash = reservations.consumeReservation(GAME, branch, 'p1_cash_phase_1', {
        operationId: cashOperation,
        amount: '60',
        ledgerEntry: entry(cashOperation, 'money', 'test', 'pagamento', TREASURY, HOUSEHOLDS, '60', date),
      });
      const steel = reservations.consumeReservation(GAME, branch, 'p1_steel_phase_1', {
        operationId: steelOperation,
        amount: '6000',
        ledgerEntry: entry(steelOperation, 'material', 'steel', 'consumo', STEEL_HOLDER, null, '6000', date),
      });
      expect(cash.consumed).toBe(true);
      expect(steel.consumed).toBe(true);
    }

    expect(reservations.getReservationAvailability(branch, MONEY)).toMatchObject({
      total: '820', committed: '420', available: '400', shortfall: '0',
    });
    expect(reservations.getReservationAvailability(branch, STEEL)).toMatchObject({
      total: '82000', committed: '42000', available: '40000', shortfall: '0',
    });
    expect(reservations.getReservation(branch, 'p1_cash_phase_1')).toMatchObject({
      status: 'active', initialAmount: '600', remainingAmount: '420',
    });

    const rec = ledger.reconstructBalances(branch);
    expect(rec.accounts.find((a) => a.ref === HOUSEHOLDS && a.currencyId === 'test')?.balance).toBe('180');
    expect(rec.accounts.find((a) => a.ref === TREASURY && a.currencyId === 'test')?.balance).toBe('820');
    expect(rec.stock.find((s) => s.holder === STEEL_HOLDER && s.resourceId === 'steel')?.quantity).toBe('82000');
  });

  it('retry di consume riesegue il ledger idempotente e non scala una seconda volta', () => {
    const before = reservations.getReservation(branch, 'p1_cash_phase_1');
    const retry = reservations.consumeReservation(GAME, branch, 'p1_cash_phase_1', {
      operationId: 'p1_cash_day_1',
      amount: '60',
      ledgerEntry: entry('p1_cash_day_1', 'money', 'test', 'pagamento', TREASURY, HOUSEHOLDS, '60', '1951-01-01'),
    });
    expect(retry.consumed).toBe(false);
    expect(retry.reservation.remainingAmount).toBe(before?.remainingAmount);
    expect(reservations.getReservationAvailability(branch, MONEY)).toMatchObject({
      total: '820', committed: '420', available: '400',
    });
    expect(ledger.reconstructBalances(branch).accounts.find((a) => a.ref === HOUSEHOLDS)?.balance).toBe('180');
  });

  it('ledger conflict fa rollback della prenotazione: nessun consume parziale', () => {
    const cashReserve = reservations.createReservation(GAME, branch, {
      reservationId: 'atomic_cash', target: MONEY, amount: '100',
    });
    expect(cashReserve.created).toBe(true);
    // Una riga esterna con la stessa chiave ledger ma contenuto incompatibile.
    ledger.appendLedgerEntries(GAME, branch, [
      entry('atomic_consume', 'money', 'test', 'pagamento', TREASURY, HOUSEHOLDS, '99', '1951-01-04'),
    ]);
    expect(() => reservations.consumeReservation(GAME, branch, 'atomic_cash', {
      operationId: 'atomic_consume',
      amount: '100',
      ledgerEntry: entry('atomic_consume', 'money', 'test', 'pagamento', TREASURY, HOUSEHOLDS, '100', '1951-01-04'),
    })).toThrow(/contenuto diverso/);
    expect(reservations.getReservation(branch, 'atomic_cash')).toMatchObject({
      status: 'active', remainingAmount: '100',
    });
    expect(reservations.getReservationAvailability(branch, MONEY)).toMatchObject({
      total: '721', committed: '520', available: '201',
    });
  });
});

describe('M02 µ3 — release idempotente e disponibilità distinta da committed', () => {
  const branch = 'release-stock';

  it('release libera solo il residuo non consumato, senza un movimento ledger', () => {
    seedFixture(branch);
    const created = reservations.createReservation(GAME, branch, {
      reservationId: 'delivery_steel', target: STEEL, amount: '60000',
    });
    expect(created.reservation.status).toBe('active');
    const first = reservations.releaseReservation(GAME, branch, 'delivery_steel', {
      operationId: 'release_part_1', amount: '20000',
    });
    expect(first.released).toBe(true);
    expect(first.reservation).toMatchObject({ status: 'active', remainingAmount: '40000' });
    expect(reservations.getReservationAvailability(branch, STEEL)).toMatchObject({
      total: '100000', committed: '40000', available: '60000',
    });

    const retry = reservations.releaseReservation(GAME, branch, 'delivery_steel', {
      operationId: 'release_part_1', amount: '20000',
    });
    expect(retry.released).toBe(false);
    expect(retry.reservation.remainingAmount).toBe('40000');

    const finalRelease = reservations.releaseReservation(GAME, branch, 'delivery_steel', {
      operationId: 'release_rest', amount: '40000',
    });
    expect(finalRelease.reservation).toMatchObject({ status: 'released', remainingAmount: '0' });
    expect(reservations.getReservationAvailability(branch, STEEL)).toMatchObject({
      total: '100000', committed: '0', available: '100000', shortfall: '0',
    });
    expect(ledger.reconstructBalances(branch).stock.find((s) => s.resourceId === 'steel')?.quantity).toBe('100000');
  });

  it('riferimenti opachi con : restano integri nella ricostruzione e nelle riserve', () => {
    const branch = 'opaque-ref';
    const target = { kind: 'money' as const, unitId: 'test', holderRef: 'treasury:programme_a' };
    ledger.appendLedgerEntries(GAME, branch, [
      entry('seed_opaque_ref', 'money', 'test', 'incasso', null, target.holderRef, '50'),
    ]);
    reservations.createReservation(GAME, branch, {
      reservationId: 'opaque_ref_reservation', target, amount: '30',
    });
    expect(reservations.getReservationAvailability(branch, target)).toMatchObject({
      total: '50', committed: '30', available: '20',
    });
    expect(ledger.reconstructBalances(branch).accounts.find((a) => a.ref === target.holderRef)?.balance).toBe('50');
  });

  it('rifiuta over-consume, movimento non coerente e release oltre residuo', () => {
    seedFixture('invalid-reservations');
    reservations.createReservation(GAME, 'invalid-reservations', {
      reservationId: 'small_cash', target: MONEY, amount: '100',
    });
    expect(() => reservations.consumeReservation(GAME, 'invalid-reservations', 'small_cash', {
      operationId: 'too_much', amount: '101',
      ledgerEntry: entry('too_much', 'money', 'test', 'pagamento', TREASURY, HOUSEHOLDS, '101'),
    })).toThrow(/supera il residuo/);
    expect(() => reservations.consumeReservation(GAME, 'invalid-reservations', 'small_cash', {
      operationId: 'wrong_holder', amount: '50',
      ledgerEntry: entry('wrong_holder', 'money', 'test', 'pagamento', HOUSEHOLDS, TREASURY, '50'),
    })).toThrow(/stesso holder/);
    expect(() => reservations.releaseReservation(GAME, 'invalid-reservations', 'small_cash', {
      operationId: 'too_much_release', amount: '101',
    })).toThrow(/supera il residuo/);
    expect(reservations.getReservation('invalid-reservations', 'small_cash')?.remainingAmount).toBe('100');
  });
});
