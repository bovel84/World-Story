/**
 * MG01 µ3 — Letture di disponibilità per il preflight
 * ==================================================
 * Il ponte fra il ledger del ramo e il giudizio di fattibilità. **Sola
 * lettura**: ricostruisce, non prenota. La prenotazione è MG02, e avviene al
 * salto, non aprendo un pannello.
 *
 * Tre scelte, tutte misurate sul motore attuale:
 *  - **Si guarda la CUSTODIA di ledger, non la proprietà dichiarata dal
 *    catalogo.** La disponibilità di un materiale è ciò che il ledger registra
 *    presso l'attore che paga; l'acciaio di `beta_treasury` non costruisce la
 *    strada di ALPHA. Attenzione a una differenza che il catalogo della fixture
 *    mostra: gli utensili sono registrati a `alpha_steel_co` ma il catalogo li
 *    dà in custodia a `alpha_farms`, e la lettura li attribuisce a chi li ha nel
 *    ledger. `reconstructOwnedStock` risponde a un'altra domanda (di chi è la
 *    merce) e non si usa qui.
 *  - **Si sottrae ciò che è già impegnato.** Il disponibile è il saldo meno le
 *    riserve attive: due ordini che leggono lo stesso stock non si illudono di
 *    averlo entrambi. È comunque una fotografia: la prenotazione vera avviene
 *    al salto (MG02).
 *  - **Le unità sono quelle del ledger.** `ledgerUnitId` canonicalizza in
 *    minuscolo; il modulo delle letture confronta unità già canonicalizzate e
 *    non reimplementa il codec.
 *
 * Limite dichiarato: le unità che il catalogo non dichiara più vengono **escluse
 * in silenzio** dal risultato. È lo stesso rischio di aliasing annotato nel
 * piano §10.3, e va segnalato quando una fase introdurrà la migrazione.
 */

import { listLedgerEntries, reconstructBalances } from '../repositories/ledger.repository';
import { ledgerUnitId } from '../services/StrictEffectProducerService';
import db from '../database';
import { parseInteger, intToString } from '../domain/quantities';
import type { SimulationCatalog } from '../scenario/types';
import type { AvailabilityReadings } from '../core/feasibility/Availability';

/**
 * Il ramo ha uno stato economico? Il bootstrap del catalogo avviene al primo
 * turno: prima di allora il ledger è vuoto e «disponibili 0» non significa
 * «non hai nulla», significa «non è ancora stato materializzato niente».
 * Chiamare la lettura su un ramo vuoto produrrebbe un deficit inventato.
 */
export function ledgerHasState(branchId: string): boolean {
  return listLedgerEntries(branchId).length > 0;
}

/**
 * Legge conti e giacenze del ramo **per un detentore**, al netto delle riserve.
 * `actorId` è il riferimento del detentore nel ledger (un conto o un custode).
 */
export function readAvailability(
  branchId: string,
  actorId: string,
  catalog: SimulationCatalog,
): AvailabilityReadings {
  // Quali unità esistono lo dice il CATALOGO, ma canonicalizzate nell'unità del
  // ledger: il catalogo dichiara `TEST`, il ledger usa `test`, e il confronto
  // va fatto sulla seconda in entrambi i lati.
  const currencies = new Set<string>([catalog.manifest.currency.id, ...(catalog.manifest.currencies ?? []).map(c => c.id)].map(ledgerUnitId));
  const resources = new Set<string>(catalog.resources.map(r => ledgerUnitId(r.id)));

  // Un'unità senza movimenti nel ramo non compare in `reconstructBalances`: la
  // interrogazione diretta risponde comunque `0` con `available` corretto.
  const entries = listLedgerEntries(branchId);
  const seenUnits = new Set<string>();
  for (const entry of entries) {
    if (entry.fromRef === actorId || entry.toRef === actorId) seenUnits.add(entry.unitId);
  }
  // Le unità senza movimenti restano a zero e non serve elencarle:
  // `measureDeficits` tratta l'assenza come zero (nessun saldo, nessun credito).

  // UNA sola ricostruzione del ledger per chiamata, non una per unità.
  // `getReservationAvailability` la ripete ogni volta: su un ramo con decine di
  // migliaia di righe sono secondi per unità, e la rotta `evaluate` la chiama a
  // ogni POST. Qui si ricostruisce una volta e si legge da lì; le riserve
  // attive si sommano in una sola query, come fa `getCommitted`.
  const balances = reconstructBalances(branchId);
  const committedRows = db.prepare(
    `SELECT kind, unit_id, holder_ref, remaining_amount FROM reservations
      WHERE branch_id = ? AND status = 'active'`,
  ).all(branchId) as Array<{ kind: string; unit_id: string; holder_ref: string; remaining_amount: string }>;
  const committed = new Map<string, bigint>();
  for (const row of committedRows) {
    const key = `${row.kind}|${row.unit_id}|${row.holder_ref}`;
    committed.set(key, (committed.get(key) ?? 0n) + parseInteger(row.remaining_amount, 'remaining'));
  }
  const availableOf = (kind: 'money' | 'material', unitId: string): string => {
    const total = kind === 'money'
      ? balances.accounts.find(item => item.ref === actorId && item.currencyId === unitId)?.balance ?? '0'
      : balances.stock.find(item => item.holder === actorId && item.resourceId === unitId)?.quantity ?? '0';
    const held = committed.get(`${kind}|${unitId}|${actorId}`) ?? 0n;
    // Il disponibile non si nasconde se è negativo: `max(0, …)` maschererebbe
    // un'incoerenza del ledger invece di mostrarla.
    return intToString(parseInteger(total, 'total') - held);
  };

  const money: { holder: string; unitId: string; available: string }[] = [];
  for (const unitId of seenUnits) {
    if (!currencies.has(unitId)) continue;
    money.push({ holder: actorId, unitId, available: availableOf('money', unitId) });
  }

  const stock: { holder: string; unitId: string; available: string }[] = [];
  for (const unitId of seenUnits) {
    if (!resources.has(unitId)) continue;
    stock.push({ holder: actorId, unitId, available: availableOf('material', unitId) });
  }

  // La manodopera NON è nel ledger: `workforce` è dichiarata dallo stato
  // iniziale del catalogo ma non è mai materializzata. Non la si inventa:
  // il campo resta assente, e il preflight dichiara il requisito non verificato.
  return { money, stock };
}
