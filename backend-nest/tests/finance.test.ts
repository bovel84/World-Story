import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import fs from 'fs'; import os from 'os'; import path from 'path';
import type { LedgerEntryInput } from '../src/domain/ledger';
const TEST_DB=path.join(os.tmpdir(),`world-story-finance-${process.pid}-${Date.now()}.db`); process.env.OPEN_PAX_DB_PATH=TEST_DB;
type Ledger=typeof import('../src/repositories/ledger.repository'); type Finance=typeof import('../src/services/FinanceService'); type Reservations=typeof import('../src/services/ReservationService');
let ledger:Ledger; let finance:Finance; let reservations:Reservations;
const GAME='finance-game'; const money=(effectId:string,fromRef:string|null,toRef:string|null,delta:string,atDate='1951-01-01',cause:LedgerEntryInput['cause']='pagamento'):LedgerEntryInput=>({effectId,entryIndex:0,cause,kind:'money',unitId:'test',fromRef,toRef,delta,atDate});
beforeAll(async()=>{const database=await import('../src/database');database.initDatabase();ledger=await import('../src/repositories/ledger.repository');finance=await import('../src/services/FinanceService');reservations=await import('../src/services/ReservationService');});
afterAll(()=>{try{fs.rmSync(TEST_DB);}catch{/* temp */}});

describe('M02 µ4 — stanziamento, cassa e debito restano distinti',()=>{
 it('stanziamento non crea cassa e residuo=autorizzato−impegni−spesa',()=>{
  const branch='appropriation'; ledger.appendLedgerEntries(GAME,branch,[money('seed',null,'treasury','50','1951-01-01','incasso')]);
  expect(finance.createAppropriation(GAME,branch,{appropriationId:'mandate',account:{ref:'treasury',currencyId:'test'},authorizedAmount:'100'})).toBe(true);
  expect(finance.commitAppropriation(branch,'mandate','commit-1','60')).toBe(true);
  expect(finance.commitAppropriation(branch,'mandate','commit-1','60')).toBe(false);
  expect(finance.getAppropriation(branch,'mandate')).toEqual({authorized:'100',committed:'60',spent:'0',residual:'40',cash:'50'});
  expect(()=>finance.commitAppropriation(branch,'mandate','commit-2','41')).toThrow(/residuo insufficiente/);
 });
 it('debito è contratto+ledger, non liquidità inventata; rateo ACT/365F conserva carry',()=>{
  const branch='debt'; ledger.appendLedgerEntries(GAME,branch,[money('bank-seed',null,'bank','100','1951-01-01','incasso')]);
  finance.createDebt(GAME,branch,{debtId:'loan',lender:{ref:'bank',currencyId:'test'},borrower:{ref:'treasury',currencyId:'test'},limitAmount:'100',rate:{numerator:'5',denominator:'100'},maturityDate:'1952-01-01'});
  expect(finance.getDebt(branch,'loan')).toMatchObject({drawn:'0',principal:'0',accruedInterest:'0'});
  finance.drawDebt(GAME,branch,'loan','draw-1','100',money('draw-1','bank','treasury','100','1951-01-01','prestito_erogato'));
  expect(ledger.reconstructBalances(branch).accounts.find(a=>a.ref==='treasury')?.balance).toBe('100');
  expect(finance.accrueDebtInterest(branch,'loan','accrue-year',365)).toMatchObject({interest:'5',carry:'0',accrued:'5',applied:true});
  expect(finance.accrueDebtInterest(branch,'loan','accrue-year',365).applied).toBe(false);
  expect(finance.getDebt(branch,'loan')).toEqual({drawn:'100',principal:'100',accruedInterest:'5',carry:'0',limit:'100'});
 });
});

describe('M02 µ4 — escrow fixture §7.2 (MAT36)',()=>{
 it('deposito consuma UNA riserva: 100/0/0 → 60/0/40 → 60/40/0, retry sicuro',()=>{
  const branch='escrow-release'; ledger.appendLedgerEntries(GAME,branch,[money('buyer-seed',null,'buyer','100','1951-01-01','incasso')]);
  reservations.createReservation(GAME,branch,{reservationId:'purchase-reserve',target:{kind:'money',unitId:'test',holderRef:'buyer'},amount:'40'});
  finance.createEscrow(GAME,branch,{escrowId:'contract',buyer:{ref:'buyer',currencyId:'test'},seller:{ref:'seller',currencyId:'test'},escrowRef:'escrow_contract',amount:'40'});
  expect(finance.depositEscrow(GAME,branch,'contract','deposit','purchase-reserve',money('deposit','buyer','escrow_contract','40'))).toBe(true);
  const funded=ledger.reconstructBalances(branch).accounts; const b=(ref:string)=>funded.find(a=>a.ref===ref)?.balance ?? '0';
  expect([b('buyer'),b('seller'),b('escrow_contract')]).toEqual(['60','0','40']);
  expect(reservations.getReservationAvailability(branch,{kind:'money',unitId:'test',holderRef:'buyer'})).toMatchObject({total:'60',committed:'0',available:'60'});
  expect(finance.releaseEscrow(GAME,branch,'contract','release',money('release','escrow_contract','seller','40','1951-01-04','pagamento'))).toBe(true);
  expect(finance.releaseEscrow(GAME,branch,'contract','release',money('release','escrow_contract','seller','40','1951-01-04','pagamento'))).toBe(false);
  const released=ledger.reconstructBalances(branch).accounts; const r=(ref:string)=>released.find(a=>a.ref===ref)?.balance ?? '0';
  expect([r('buyer'),r('seller'),r('escrow_contract')]).toEqual(['60','40','0']);
 });
 it('refund per annullamento/perdita torna 100/0/0 una sola volta',()=>{
  const branch='escrow-refund'; ledger.appendLedgerEntries(GAME,branch,[money('buyer-seed',null,'buyer','100','1951-01-01','incasso')]);
  reservations.createReservation(GAME,branch,{reservationId:'refund-reserve',target:{kind:'money',unitId:'test',holderRef:'buyer'},amount:'40'});
  finance.createEscrow(GAME,branch,{escrowId:'refund-contract',buyer:{ref:'buyer',currencyId:'test'},seller:{ref:'seller',currencyId:'test'},escrowRef:'escrow_refund',amount:'40'});
  finance.depositEscrow(GAME,branch,'refund-contract','deposit-refund','refund-reserve',money('deposit-refund','buyer','escrow_refund','40'));
  finance.refundEscrow(GAME,branch,'refund-contract','refund',money('refund','escrow_refund','buyer','40','1951-01-02','rimborso'));
  const rows=ledger.reconstructBalances(branch).accounts; const get=(ref:string)=>rows.find(a=>a.ref===ref)?.balance ?? '0';
  expect([get('buyer'),get('seller'),get('escrow_refund')]).toEqual(['100','0','0']);
  expect(()=>finance.releaseEscrow(GAME,branch,'refund-contract','bad-release',money('bad-release','escrow_refund','seller','40'))).toThrow(/già chiuso/);
 });
});

describe('M02 µ4 — cashflow datati, priorità, arretrati/default',()=>{
 it('priorità legale, pagamento parziale e arretrato preservano l obbligo; default blocca nuovi impegni',()=>{
  const branch='cashflow'; ledger.appendLedgerEntries(GAME,branch,[money('seed',null,'treasury','100','1951-01-01','incasso')]);
  finance.createCashflow(GAME,branch,{cashflowId:'high',debtor:{ref:'treasury',currencyId:'test'},creditor:{ref:'legal_a',currencyId:'test'},amount:'60',dueDate:'1951-01-02',legalPriority:0,partialAllowed:false,shortagePolicy:'arrears'});
  finance.createCashflow(GAME,branch,{cashflowId:'low',debtor:{ref:'treasury',currencyId:'test'},creditor:{ref:'legal_b',currencyId:'test'},amount:'60',dueDate:'1951-01-02',legalPriority:1,partialAllowed:true,shortagePolicy:'arrears'});
  expect(finance.settleDueCashflows(GAME,branch,'1951-01-02')).toEqual([{cashflowId:'high',paid:'60',status:'paid'},{cashflowId:'low',paid:'40',status:'arrears'}]);
  const rows=ledger.reconstructBalances(branch).accounts; expect(rows.find(a=>a.ref==='treasury')?.balance).toBe('0'); expect(rows.find(a=>a.ref==='legal_b')?.balance).toBe('40');
  ledger.appendLedgerEntries(GAME,branch,[money('new-cash',null,'treasury','20','1951-01-03','incasso')]);
  expect(finance.settleDueCashflows(GAME,branch,'1951-01-03')).toEqual([{cashflowId:'low',paid:'20',status:'paid'}]);
  const blocked='default-block'; ledger.appendLedgerEntries(GAME,blocked,[money('seed-default',null,'treasury','100','1951-01-01','incasso')]);
  finance.createCashflow(GAME,blocked,{cashflowId:'legal-default',debtor:{ref:'treasury',currencyId:'test'},creditor:{ref:'court',currencyId:'test'},amount:'150',dueDate:'1951-01-02',legalPriority:0,partialAllowed:false,shortagePolicy:'default'});
  expect(finance.settleDueCashflows(GAME,blocked,'1951-01-02')).toEqual([{cashflowId:'legal-default',paid:'0',status:'default'}]);
  expect(()=>reservations.createReservation(GAME,blocked,{reservationId:'new-spend',target:{kind:'money',unitId:'test',holderRef:'treasury'},amount:'1'})).toThrow(/nuovi impegni bloccati/);
 });
});
