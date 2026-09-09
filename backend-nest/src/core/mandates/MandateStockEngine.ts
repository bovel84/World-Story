/**
 * World Story — M07 µ4: valutazione pura delle scorte minime dei mandati.
 * =====================================================================
 * Il motore non compra e non muove denaro/materiali: un mandato non porta una
 * quotazione né una quantità di acquisto verificata. Un deficit diventa quindi
 * una decisione esplicita del giocatore, distinguendo purchase autorizzato
 * (mancano ancora prezzo/quantità) da purchase fuori whitelist (§7.5).
 */
import { intToString, parseInteger, type IntString } from '../../domain/quantities';
import { isExpired, type MandateDefinition, type MandateState, validateMandate } from './MandateEngine';

export type MandateStockDecisionKind = 'stock_shortfall_authorized' | 'stock_shortfall_outside_authorization';

export type MandateStockAssessment =
  | { readonly status: 'not_configured' | 'inactive' | 'not_started' | 'expired' | 'sufficient' }
  | {
    readonly status: 'decision_required';
    readonly kind: MandateStockDecisionKind;
    readonly mandateId: string;
    readonly resourceId: string;
    readonly minStock: IntString;
    readonly availableStock: IntString;
    readonly shortfall: IntString;
  };

/** Valuta un singolo mandato alla data canonica del tick. `availableStock` è
 * già la somma verificata delle sole giacenze DI PROPRIETÀ della polity. */
export function assessMandateMinimumStock(
  definition: MandateDefinition,
  state: MandateState,
  asOfDate: string,
  availableStock: IntString,
): MandateStockAssessment {
  validateMandate(definition);
  // isExpired valida anche la data canonical UTC; non fidarsi del chiamante.
  const expired = isExpired(definition, asOfDate);
  if (state.id !== definition.id) throw new Error(`mandate state mismatch: ${state.id} ≠ ${definition.id}`);
  if (state.status !== 'active') return { status: 'inactive' };
  if (asOfDate < definition.startDate) return { status: 'not_started' };
  if (expired) return { status: 'expired' };
  if (typeof definition.resourceId === 'undefined' || typeof definition.minStock === 'undefined') {
    return { status: 'not_configured' };
  }

  const minimum = parseInteger(definition.minStock, 'mandate.minStock');
  const available = parseInteger(availableStock, 'availableStock');
  if (available >= minimum) return { status: 'sufficient' };
  return {
    status: 'decision_required',
    kind: definition.whitelist.includes('purchase') ? 'stock_shortfall_authorized' : 'stock_shortfall_outside_authorization',
    mandateId: definition.id,
    resourceId: definition.resourceId,
    minStock: definition.minStock,
    availableStock,
    shortfall: intToString(minimum - available),
  };
}