/**
 * World Story — M07 µ2 (+ µ2-bis remediation): mandato → finanza canonica (M06).
 * =========================================================================
 * Un'esecuzione di mandato (MAT31) consuma il plafond UNA volta e produce un
 * obbligo datato REALE: il tesoro bound paga il fornitore alla data indicata
 * tramite `FinanceService.createCashflow`; il tick strict liquida con priorità
 * legale (arretrati se il mandato lo consente, insoluto/default se
 * `noNewDebt`). Nessun movimento ledger grezzo fuori dalla finanza canonica.
 *
 * µ2-bis (revisione 1): plafond e cashflow nel MEDESIMO albero transazionale
 * canonico (`withCanonicalTransaction`; i call-site interni annidati diventano
 * savepoint) → crash o rifiuto finanza → o entrambi o nessuno. Il retry con
 * lo stesso executionId chiama SEMPRE `createCashflow` (idempotente e
 * verificata): se una finestra di crash ha lasciato il plafond consumato senza
 * obbligo, il retry lo ripara invece di mascherarlo. Validazioni preventive
 * (id composito, valuta) PRIMA del consumo del plafond, con errori di mandato
 * → 422, mai 500.
 */
import { MandateError, type MandateExecution, type MandateState } from '../core/mandates/MandateEngine';
import { executeMandateRecord, getMandateDefinition } from './MandateService';
import { createCashflow } from './FinanceService';
import { withCanonicalTransaction } from '../database';

export interface MandateTreasuryBinding {
  /** Attore tesoreria bound alla polity del giocatore (catalogo server). */
  readonly actorId: string;
  /** Valuta canonica del tesoro (unitId ledger, minuscolo). */
  readonly currencyId: string;
}

/** Identificatore canonico dell'obbligo generato da un'esecuzione di mandato. */
export function mandateCashflowId(mandateId: string, executionId: string): string {
  return `mandate_${mandateId}_${executionId}`;
}

/** Specchio del pattern ID di FinanceService: il composito deve esservi valido
 *  PRIMA del consumo del plafond (µ2-bis M-3), mai dopo. */
const FINANCE_ID_RE = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;

export function executeMandateEconomy(
  gameId: string,
  branchId: string,
  mandateId: string,
  execution: MandateExecution,
  treasury: MandateTreasuryBinding,
): { mandate: MandateState; applied: boolean; cashflowId: string } {
  return withCanonicalTransaction(() => {
    const cashflowId = mandateCashflowId(mandateId, execution.executionId);
    if (!FINANCE_ID_RE.test(cashflowId)) {
      throw new MandateError('bad_cashflow_id', `id composito obbligo non valido per ${mandateId}/${execution.executionId} (max 128)`);
    }
    const def = getMandateDefinition(branchId, mandateId);
    if (def && def.currencyId !== treasury.currencyId) {
      throw new MandateError('bad_currency', `mandato ${mandateId} in valuta ${def.currencyId}, tesoro in ${treasury.currencyId}`);
    }

    const outcome = executeMandateRecord(gameId, branchId, mandateId, execution);

    const effective = getMandateDefinition(branchId, mandateId);
    if (!effective) throw new MandateError('not_found', `mandato ${mandateId} sparito dopo l'esecuzione`);

    // SEMPRE (anche su retry applied:false): l'obbligo è idempotente e
    // verificata; ripara uno stato di crash "plafond consumato, obbligo assente".
    createCashflow(gameId, branchId, {
      cashflowId,
      debtor: { ref: treasury.actorId, currencyId: effective.currencyId },
      creditor: { ref: execution.supplier, currencyId: effective.currencyId },
      amount: execution.amount,
      dueDate: execution.atDate,
      legalPriority: 0,
      partialAllowed: false,
      shortagePolicy: effective.noNewDebt ? 'default' : 'arrears',
    });
    return { ...outcome, cashflowId };
  });
}