/**
 * M02 µ2 — ledger append-only e ricostruzione (maestro §6.1–6.2, MAT04).
 * ======================================================================
 * Saldi e stock concordano, ogni trasferimento è bilanciato: una riga muove
 * un delta > 0 da origine a destinazione nella STESSA unità. La ripetizione
 * (branchId, effectId, entryIndex) è no-op verificata, non un secondo
 * pagamento. Append-only: nessun UPDATE/DELETE.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';

const TEST_DB = path.join(os.tmpdir(), `world-story-ledger-${process.pid}-${Date.now()}.db`);
process.env.OPEN_PAX_DB_PATH = TEST_DB;

let db: any;
let ledger: any;
let ledgerRepo: any;

const GAME = 'ledger-game';
const BRANCH = 'branch-main';
const BRANCH_ALT = 'branch-parallel';

const D = '1951-06-15';

const money = (effectId: string, entryIndex: number, cause: string, from: string | null, to: string | null, delta: string, at = D) =>
  ({ effectId, entryIndex, cause, kind: 'money', unitId: 'test', fromRef: from, toRef: to, delta, atDate: at });

const material = (effectId: string, entryIndex: number, cause: string, unitId: string, from: string | null, to: string | null, delta: string, at = D) =>
  ({ effectId, entryIndex, cause, kind: 'material', unitId, fromRef: from, toRef: to, delta, atDate: at });

beforeAll(async () => {
  const database = await import('../src/database');
  db = database.default;
  database.initDatabase();
  ledgerRepo = await import('../src/repositories/ledger.repository');
  ledger = await import('../src/domain/ledger');
});

afterAll(() => {
  try { fs.rmSync(TEST_DB); } catch { /* temporaneo */ }
});

describe('M02 µ2 — bilancio monetario §6.1 (MAT04)', () => {
  it('cassaFinale = cassaIniziale + incassi + prestiti − pagamenti − rimborsi − interessi', () => {
    const entries = [
      money('e_incasso_1', 0, 'incasso', 'attore_cittadini', 'tesoro_test', '250000'),
      money('e_prestito_1', 0, 'prestito_erogato', 'banca_centrale', 'tesoro_test', '50000'),
      money('e_pagamento_1', 0, 'pagamento', 'tesoro_test', 'attore_fornitori', '300000'),
      money('e_rimborso_1', 0, 'rimborso', 'tesoro_test', 'banca_centrale', '20000'),
      money('e_interesse_1', 0, 'interesse', 'tesoro_test', 'banca_centrale', '500'),
    ];
    const r = ledgerRepo.appendLedgerEntries(GAME, BRANCH, entries);
    expect(r).toEqual({ appended: 5, duplicates: 0 });

    const rec = ledgerRepo.reconstructBalances(BRANCH);
    expect(rec.entryCount).toBe(5);

    const byRef = new Map(rec.accounts.map((a: any) => [a.ref, a]));
    // cassa iniziale dichiarata dallo scenario: 1.000.000 cent (10.000 test)
    const iniziale = 1000000n;
    const movimenti = BigInt(byRef.get('tesoro_test')!.balance);
    expect(movimenti).toBe(250000n + 50000n - 300000n - 20000n - 500n); // −20.500 cent
    expect(iniziale + movimenti).toBe(979500n); // cassaFinale esatta, niente float
    // ogni controparte concorda: banca = −50000 + 20500; cittadini = −250000; fornitori = +300000
    expect(byRef.get('banca_centrale')!.balance).toBe('-29500');
    expect(byRef.get('attore_cittadini')!.balance).toBe('-250000');
    expect(byRef.get('attore_fornitori')!.balance).toBe('300000');
    // stessa valuta per tutti i conti toccati (nessuna somma eterogenea)
    for (const a of rec.accounts) expect(a.currencyId).toBe('test');
  });

  it('i conti di origine/destinazione sono bilanciati: la somma dei movimenti per unità è zero', () => {
    const rec = ledgerRepo.reconstructBalances(BRANCH);
    const perCurrency = new Map<string, bigint>();
    for (const a of rec.accounts as any[]) {
      perCurrency.set(a.currencyId, (perCurrency.get(a.currencyId) ?? 0n) + BigInt(a.balance));
    }
    for (const [, total] of perCurrency) expect(total).toBe(0n);
  });
});

describe('M02 µ2 — stock fisico con provenienza e causale (MAT04)', () => {
  it('estrazione, consegna, consumo e produzione concordano per lotto e risorsa', () => {
    const entries = [
      material('f_estrazione_1', 0, 'estrazione', 'iron_ore', null, 'alpha_mine', '1200', '1951-06-15'),
      material('f_consegna_1', 0, 'consegna', 'iron_ore', 'alpha_mine', 'alpha_steel_co', '600', '1951-06-16'),
      material('f_produzione_1', 0, 'consumo', 'iron_ore', 'alpha_steel_co', null, '60', '1951-06-16'),
      material('f_produzione_1', 1, 'produzione', 'steel', null, 'alpha_steel_co', '50', '1951-06-16'),
      material('f_produzione_1', 2, 'perdita', 'steel', 'alpha_steel_co', null, '2', '1951-06-16'),
    ];
    ledgerRepo.appendLedgerEntries(GAME, BRANCH, entries);
    const rec = ledgerRepo.reconstructBalances(BRANCH);

    const key = (holder: string, resourceId: string) => `${holder}/${resourceId}`;
    const byHolder = new Map(rec.stock.map((s: any) => [key(s.holder, s.resourceId), s]));
    expect(byHolder.get(key('alpha_mine', 'iron_ore'))!.quantity).toBe('600');
    expect(byHolder.get(key('alpha_steel_co', 'iron_ore'))!.quantity).toBe('540');
    expect(byHolder.get(key('alpha_steel_co', 'steel'))!.quantity).toBe('48');
    // risorse diverse restano distinte (nessuna somma di tonnellate eterogenee §6.3)
    expect(rec.stock.length).toBe(3);
  });

  it('lo stesso evento muove più lotti con entryIndex distinti', () => {
    const rec = ledgerRepo.reconstructBalances(BRANCH);
    // f_produzione_1 ha 3 righe: consumo, produzione, perdita
    expect(rec.entryCount).toBe(5 + 5);
    const entries = ledgerRepo.listLedgerEntries(BRANCH).filter((e: any) => e.effectId === 'f_produzione_1');
    expect(entries.map((e: any) => e.entryIndex)).toEqual([0, 1, 2]);
  });
});

describe('M02 µ2 — ripetizione = no-op verificata (§6.2)', () => {
  it('un retry con righe identiche non duplica pagamenti né movimenti', () => {
    const batch = [
      money('e_retry_1', 0, 'pagamento', 'tesoro_test', 'attore_fornitori', '7777'),
      material('f_retry_1', 0, 'produzione', 'tools', null, 'alpha_works', '10'),
    ];
    const first = ledgerRepo.appendLedgerEntries(GAME, BRANCH, batch);
    expect(first).toEqual({ appended: 2, duplicates: 0 });

    const before = ledgerRepo.reconstructBalances(BRANCH);
    const again = ledgerRepo.appendLedgerEntries(GAME, BRANCH, batch);
    expect(again).toEqual({ appended: 0, duplicates: 2 });

    const after = ledgerRepo.reconstructBalances(BRANCH);
    expect(after.entryCount).toBe(before.entryCount);
    const tesoroAfter = (after.accounts as any[]).find((a) => a.ref === 'tesoro_test')!;
    const tesoroBefore = (before.accounts as any[]).find((a) => a.ref === 'tesoro_test')!;
    expect(tesoroAfter.balance).toBe(tesoroBefore.balance); // nessun secondo pagamento
    expect((after.stock as any[]).find((s) => s.holder === 'alpha_works')!.quantity).toBe('10');
  });

  it('chiave uguale con contenuti DIVERSI è conflitto: nessun secondo pagamento', () => {
    const original = ledgerRepo.reconstructBalances(BRANCH);
    const beforeTesoro = (original.accounts as any[]).find((a) => a.ref === 'tesoro_test')!.balance;
    expect(() =>
      ledgerRepo.appendLedgerEntries(GAME, BRANCH, [
        money('e_retry_1', 0, 'pagamento', 'tesoro_test', 'attore_fornitori', '9999'),
      ]),
    ).toThrow(/già registrata con contenuto diverso/);
    const after = ledgerRepo.reconstructBalances(BRANCH);
    expect((after.accounts as any[]).find((a) => a.ref === 'tesoro_test')!.balance).toBe(beforeTesoro);
    expect(after.entryCount).toBe(original.entryCount);
  });
});

describe('M02 µ2 — validazione e isolamento', () => {
  it('rifiuta causali fuori dominio, delta non positivi/non canonici, movimenti nulli', () => {
    expect(() => ledgerRepo.appendLedgerEntries(GAME, BRANCH, [money('v1', 0, 'produzione' as any, 'a', 'b', '5')]))
      .toThrow(/non ammessa per movimenti monetari/);
    expect(() => ledgerRepo.appendLedgerEntries(GAME, BRANCH, [material('v2', 0, 'pagamento' as any, 'steel', 'a', 'b', '5')]))
      .toThrow(/non ammessa per movimenti fisici/);
    expect(() => ledgerRepo.appendLedgerEntries(GAME, BRANCH, [money('v3', 0, 'incasso', 'a', 'b', '0')]))
      .toThrow(/delta deve essere > 0/);
    expect(() => ledgerRepo.appendLedgerEntries(GAME, BRANCH, [money('v4', 0, 'incasso', 'a', 'b', '-5')]))
      .toThrow(ledger.LedgerEntryError);
    expect(() => ledgerRepo.appendLedgerEntries(GAME, BRANCH, [money('v5', 0, 'incasso', 'a', 'b', '1.5')]))
      .toThrow(ledger.LedgerEntryError);
    expect(() => ledgerRepo.appendLedgerEntries(GAME, BRANCH, [money('v6', 0, 'incasso', 'x', 'x', '5')]))
      .toThrow(/origine e destinazione coincidono/);
    expect(() => ledgerRepo.appendLedgerEntries(GAME, BRANCH, [money('v7', 0, 'incasso', null, null, '5')]))
      .toThrow(/almeno un endpoint/);
    expect(() => ledgerRepo.appendLedgerEntries(GAME, BRANCH, [money('v8', 0, 'incasso', 'a', 'b', '5', '15/06/1951')]))
      .toThrow(/ISO-8601/);
    // nessuna delle righe rifiutate ha toccato il ledger
    const rec = ledgerRepo.reconstructBalances(BRANCH);
    const refs = new Set([...rec.accounts, ...rec.stock].map((r: any) => r.ref));
    expect(refs.has('a')).toBe(false);
  });

  it('i rami sono isolati: la ricostruzione è per branchId', () => {
    ledgerRepo.appendLedgerEntries(GAME, BRANCH_ALT, [
      money('e_alt_1', 0, 'incasso', null, 'tesoro_test', '1000000', '1951-07-01'),
    ]);
    const recAlt = ledgerRepo.reconstructBalances(BRANCH_ALT);
    expect(recAlt.entryCount).toBe(1);
    expect((recAlt.accounts as any[]).find((a: any) => a.ref === 'tesoro_test')!.balance).toBe('1000000');
    // il ramo principale non vede il ramo alternativo (qui tesoro = −20500 primo batch − 7777 retry)
    const recMain = ledgerRepo.reconstructBalances(BRANCH);
    expect(recMain.entryCount).toBe(5 + 5 + 2);
    expect((recMain.accounts as any[]).find((a: any) => a.ref === 'tesoro_test')!.balance).toBe('-28277');
  });

  it('valute diverse nello stesso ramo non si sommano (§6.1)', () => {
    ledgerRepo.appendLedgerEntries(GAME, BRANCH_ALT, [
      money('e_multi_1', 0, 'incasso', null, 'tesoro_alt', '500', '1951-07-02'),
    ]);
    // valuta diversa per lo stesso conto: righe separate
    const usd = { ...money('e_multi_2', 0, 'incasso', null, 'tesoro_alt', '300', '1951-07-02'), unitId: 'usd' };
    expect(usd.unitId).toBe('usd');
    ledgerRepo.appendLedgerEntries(GAME, BRANCH_ALT, [usd]);
    const rec = ledgerRepo.reconstructBalances(BRANCH_ALT);
    const tesoro = (rec.accounts as any[]).filter((a: any) => a.ref === 'tesoro_alt');
    expect(tesoro.map((a: any) => `${a.currencyId}:${a.balance}`).sort()).toEqual(['test:500', 'usd:300']);
  });

  it('append-only: il repository non espone UPDATE/DELETE', () => {
    const mod = ledgerRepo as Record<string, unknown>;
    for (const key of Object.keys(mod)) {
      expect(/update|delete|mutate|set/i.test(key) && typeof mod[key] === 'function').toBe(false);
    }
  });
});