/**
 * MG02 µ3 — Il commit di un'opera: riserve e progetto in una transazione
 * =====================================================================
 * L'ordine autorizzato diventa un cantiere **qui**, e in un solo posto: si
 * prenotano cassa e materiali e si crea il runtime del progetto, o non si fa
 * nulla. Non esiste uno stato intermedio in cui il denaro è impegnato e il
 * cantiere non c'è, o viceversa.
 *
 * Quattro scelte, tutte vincolate dal codice esistente:
 *
 *  - **Atomico per costruzione.** `createReservation` e `createProjectRuntime`
 *    aprono ciascuno la propria `withCanonicalTransaction`, e le transazioni
 *    annidate di better-sqlite3 diventano **savepoint**: avvolgere l'intera
 *    sequenza in `withCanonicalTransaction` fa sì che un errore a metà — il
 *    conflitto del runtime dopo che le riserve sono state create — annulli
 *    anche le riserve. Un semplice `try/catch` NON basta: senza una
 *    transazione esterna, la prenotazione creata un istante prima resta
 *    scritta, e il cantiere non c'è. Il test lo verifica provocando davvero
 *    quel conflitto e contando le righe rimaste.
 *
 *  - **Idempotente per chiave derivata.** Gli id delle riserve e del progetto
 *    derivano dall'ordine, non da un contatore: un retry dopo un timeout
 *    ripropone gli stessi effectId. `createReservation` risponde `created:
 *    false` con lo stesso contenuto, `createProjectRuntime` risponde `false`;
 *    entrambi sono no-op, non seconde prenotazioni. Un retry con contenuto
 *    diverso fallisce chiuso (`ReservationConflictError`,
 *    `PROJECT_RUNTIME_CONFLICT`), invece di sovrascrivere in silenzio.
 *
 *  - **Si riserva, non si spende.** La prenotazione impegna la disponibilità
 *    (`available = total − committed`) senza muovere il ledger: il movimento
 *    vero lo fa il tick quando la fase consuma. È la differenza fra «impegnato»
 *    e «speso» che il §6.1 del piano maestro richiede.
 *
 *  - **Il progetto nasce dal piano, non dal testo.** `runtimeFor` deriva il
 *    piano dalla distinta del catalogo: nessun parametro di questa funzione
 *    viene dal modello linguistico.
 */

import { createReservation } from './ReservationService';
import db, { withCanonicalTransaction } from '../database';
import { createProjectRuntime, setProjectContext } from '../repositories/project-runtime.repository';
import { ledgerUnitId } from './StrictEffectProducerService';
import { runtimeFor, totalFundsFor, totalMaterialsFor, projectIdForOrder } from '../core/feasibility/WorkPlan';
import type { WorkDefinition } from '../scenario/types';
import type { ProjectPlan, ProjectState } from '../core/projects/ProjectEngine';

export type WorkCommitStatus =
  /** Prenotazioni e progetto creati adesso. */
  | 'committed'
  /** Era già tutto lì: un retry idempotente, nessun doppio impegno. */
  | 'already_committed';

export interface WorkCommitResult {
  readonly status: WorkCommitStatus;
  readonly projectId: string;
  /** Riferimenti delle riserve attive, per associarle al progetto. */
  readonly reservationIds: readonly string[];
}

export interface WorkCommitInput {
  readonly gameId: string;
  readonly branchId: string;
  /** Id dell'ordine: da qui derivano projectId e chiavi idempotenti. */
  readonly orderId: string;
  /**
   * **Chi paga e chi ha la merce sono due riferimenti distinti**, e questa
   * separazione è misurata, non teorica: nella fixture il conto monetario è
   * della tesoreria dell'impresa (`alpha_steel_co_treasury`) mentre utensili e
   * acciaio stanno sull'impresa (`alpha_steel_co`). Il §4.3.1 del piano maestro
   * lo richiede — il settore privato non è il magazzino del governo — e MG-I2
   * dice che ogni input ha unità e luogo. Un solo `holder` per entrambi
   * imputerebbe la spesa al conto sbagliato, o cercherebbe la merce dove non
   * c'è: entrambi gli errori producono un deficit inventato.
   */
  readonly holders: { readonly money: string; readonly materials: string };
  readonly work: WorkDefinition;
  /** MG03 — la regione dove sorge l'opera: serve alla consegna sulla mappa. */
  readonly regionId?: string;
}

/** Chiave idempotente di una riserva, derivata dall'ordine: mai un contatore. */
export function reservationIdFor(orderId: string, resourceId: string): string {
  return `wres_${projectIdForOrder(orderId).slice('prj_'.length)}_${ledgerUnitId(resourceId)}`;
}

/**
 * Impegna cassa e materiali per un'opera e crea il suo progetto.
 *
 * Lancia `InsufficientAvailabilityError` quando la disponibilità non basta:
 * non c'è un ramo «parziale» nascosto — con `allowPartialStart: false` un'opera
 * che non si può coprire non parte, e la decisione su cosa fare del deficit
 * appartiene al giocatore, non a questa funzione.
 */
export function commitWork(input: WorkCommitInput): WorkCommitResult {
  const { gameId, branchId, orderId, holders, work } = input;
  const reservationIds: string[] = [];

  // Il piano e lo stato si derivano PRIMA di toccare il database: una distinta
  // incoerente deve fallire qui, non a metà della transazione.
  const { plan, state } = runtimeFor(work, orderId);

  const funds = totalFundsFor(work);
  const materials = totalMaterialsFor(work);

  const run = (): WorkCommitResult => {
    // ── Denaro: una sola prenotazione per valuta, sul totale dell'opera ────
    if (funds) {
      const reservationId = reservationIdFor(orderId, funds.currencyId);
      createReservation(gameId, branchId, {
        reservationId,
        target: { kind: 'money', unitId: ledgerUnitId(funds.currencyId), holderRef: holders.money },
        amount: funds.minorUnits,
      });
      reservationIds.push(reservationId);
    }

    // ── Materiali: una prenotazione per risorsa, sul totale dell'opera ────
    for (const material of materials) {
      const reservationId = reservationIdFor(orderId, material.resourceId);
      createReservation(gameId, branchId, {
        reservationId,
        target: { kind: 'material', unitId: ledgerUnitId(material.resourceId), holderRef: holders.materials },
        amount: material.baseUnits,
      });
      reservationIds.push(reservationId);
    }

    // ── Il cantiere ───────────────────────────────────────────────────────
    const created = createProjectRuntime(gameId, branchId, plan, state);

    // MG03 — il contesto operativo: chi paga, chi ha i materiali, dove sorge
    // l'opera. Senza, l'avanzamento non saprebbe dove attingere né dove
    // collocare l'opera dopo un riavvio. `regionId` è la regione dell'ordine.
    setProjectContext(gameId, branchId, plan.id, {
      payerActorId: holders.money,
      materialActorId: holders.materials,
      regionId: input.regionId ?? '',
    });

    return {
      status: created ? 'committed' : 'already_committed',
      projectId: plan.id,
      reservationIds,
    };
  };

  // La transazione esterna è ciò che rende atomica la sequenza: le transazioni
  // dei repository diventano savepoint al suo interno, quindi un errore qui
  // annulla anche le riserve già create e non resta denaro impegnato per un
  // cantiere che non esiste. Senza di essa il `catch` non annullerebbe nulla.
  return withCanonicalTransaction(run);
}

/** Il progetto già impegnato per un ordine, se esiste. Utile al retry e alla
 *  cronaca: la chiave è derivata, quindi la ricerca non ha bisogno di indici. */
export function committedProjectIdFor(orderId: string): string {
  return projectIdForOrder(orderId);
}

export type { ProjectPlan, ProjectState };
