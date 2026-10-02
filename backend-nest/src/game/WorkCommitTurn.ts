/**
 * MG02 µ4 — Il turno chiude la filiera: dall'ordine al cantiere
 * ===========================================================
 * `commitWork` esisteva e aveva i suoi test, ma nessun percorso di gioco lo
 * chiamava: l'ordine accettato non diventava un cantiere. Qui sta l'aggancio,
 * in un modulo solo, perché la decisione «questo ordine è una costruzione
 * coperta e va impegnata» deve essere una sola in tutto il turno.
 *
 * Il turno conosce il **testo** dell'ordine, non la sua distinta: la distinta
 * sta nel catalogo. Perciò l'ordine porta con sé un'**opera dichiarata**
 * (`PendingWorkOrder`) — un id di opera del catalogo e i due detentori — e non
 * quantità: il prezzo e i materiali restano quelli del catalogo, e nessun
 * numero viene dal testo o dal modello.
 *
 * Tre esiti, e la differenza conta:
 *  - **impegnato**: il cantiere nasce con le sue riserve, e l'ordine è compiuto
 *    solo per la parte che gli compete (avviare il cantiere, non finirlo);
 *  - **già impegnato**: un retry del turno non crea un secondo cantiere né
 *    seconde riserve — la chiave deriva dall'ordine;
 *  - **non coperto**: le risorse non bastano. L'ordine non impegna nulla e il
 *    turno lo dichiara annullato. Non si lancia: un'opera non finanziabile non
 *    deve far fallire l'intero salto, deve diventare un esito leggibile.
 */

import type { PendingAction } from './OrderExecutionService';
import { commitWork } from '../services/WorkCommitService';
import { WorkPlanError } from '../core/feasibility/WorkPlan';
import type { SimulationCatalog } from '../scenario/types';

export type WorkCommitOutcome =
  | { readonly kind: 'none' }
  | { readonly kind: 'committed'; readonly orderId: string; readonly projectId: string; readonly reservationIds: readonly string[] }
  | { readonly kind: 'already_committed'; readonly orderId: string; readonly projectId: string }
  | { readonly kind: 'unfunded'; readonly orderId: string; readonly reason: string };

export interface ApplyWorkCommitInput {
  readonly gameId: string;
  readonly branchId: string;
  readonly catalog: SimulationCatalog;
  /** Gli ordini del turno: si guarda solo chi dichiara un'opera. */
  readonly actions: readonly PendingAction[];
  /**
   * L'ordine è stato accettato dal modello? Un ordine respinto non costruisce:
   * il commit non deve anticipare una decisione che il turno non ha preso.
   *
   * **I modi di essere respinti sono due**, e guardarne uno solo era il buco
   * misurato dalla revisione: `actionOutcomes` con `status: 'rejected'` E
   * l'elenco `voided` (il modello che dichiara l'ordine irrealistico senza
   * emetterne l'esito). Il chiamante conosce entrambi e li passa qui.
   */
  readonly wasAccepted: (orderId: string) => boolean;
  /**
   * La polity del giocatore: i detentori dichiarati devono appartenerle.
   *
   * Senza questo vincolo un client può indicare il conto di un'ALTRA nazione —
   * misurato: con `payerActorId: 'beta_treasury'` l'impegno riesce e la riserva
   * nasce sul conto di BETA. È l'unico difetto della fase che tocca un soggetto
   * terzo, e il progetto ha già il binding per gli altri percorsi economici
   * (`bindStrictEconomy`): qui mancava.
   */
  readonly playerPolityId: string;
  /** MG03 — la regione dell'ordine: dove sorgerà l'opera collaudata. */
  readonly regionId?: string;
}

/** L'opera del catalogo nominata dall'ordine, se esiste. */
function workOf(catalog: SimulationCatalog, workId: string) {
  return catalog.works?.find(item => item.id === workId);
}

/**
 * Il motivo di un impegno fallito, in una frase che il giocatore può leggere.
 *
 * Gli errori del motore portano identificatori interni — `prenotazione
 * wres_56e9591fa0330fc8_test: richiesti 20000, disponibili 0 (total 0,
 * committed 0, unità test)` — misurati nel testo rivolto al giocatore. Il
 * dettaglio resta utile nei log, non nella narrazione: qui si distinguono i
 * casi che hanno un significato per chi gioca, e si ripiega su una frase
 * generica per tutto il resto.
 */
export function humanReasonFor(error: unknown): string {
  const message = error instanceof Error ? error.message : '';
  if (/insufficient_available|insufficient/i.test(message)) {
    return 'risorse insufficienti per impegnare l’opera: nessun cantiere avviato';
  }
  if (/spending_blocked/i.test(message)) {
    return 'nuovi impegni bloccati su questo conto: nessun cantiere avviato';
  }
  if (/PROJECT_RUNTIME_CONFLICT|STAGING_CONFLICT/i.test(message)) {
    return 'esiste già un cantiere diverso per questo ordine: nessuna sovrascrittura';
  }
  if (error instanceof WorkPlanError) {
    // La distinta del catalogo è incoerente: è un dato da correggere, non una
    // scelta del giocatore, e va detto senza gergo.
    return 'la distinta dell’opera non è utilizzabile: nessun cantiere avviato';
  }
  return 'impegno non riuscito: nessun cantiere avviato';
}

/**
 * Impegna ogni costruzione dichiarata e accettata in questo turno.
 *
 * L'ordine di esecuzione è quello della coda: se due ordini competono per la
 * stessa scorta, il primo la impegna e il secondo trova il residuo ridotto —
 * la stessa disciplina del `BatchAllocator`, applicata alla coda reale.
 * Un ordine che il preflight ha dichiarato non coperto non viene nemmeno
 * tentato: il commit fallirebbe, e il motivo è già noto.
 */
export function applyWorkCommits(input: ApplyWorkCommitInput): readonly WorkCommitOutcome[] {
  const outcomes: WorkCommitOutcome[] = [];

  for (const action of input.actions) {
    const declaration = action.workOrder;
    if (!declaration) continue;
    if (!input.wasAccepted(action.id)) {
      outcomes.push({ kind: 'unfunded', orderId: action.id, reason: 'ordine non accettato: nessun cantiere avviato' });
      continue;
    }
    if (!declaration.funded) {
      outcomes.push({
        kind: 'unfunded', orderId: action.id,
        reason: 'risorse insufficienti dichiarate dal preflight: nessun impegno',
      });
      continue;
    }

    const work = workOf(input.catalog, declaration.workId);
    if (!work) {
      outcomes.push({
        kind: 'unfunded', orderId: action.id,
        reason: `opera ${declaration.workId} assente dal catalogo: nessun cantiere avviato`,
      });
      continue;
    }

    // I due detentori devono appartenere alla polity del giocatore. Il
    // controllo è qui, non nel client: la dichiarazione arriva da fuori, e
    // senza vincolo si potrebbe impegnare la cassa di un'altra nazione.
    const intruder = [declaration.payerActorId, declaration.materialActorId]
      .find(actorId => input.catalog.actors.find(a => a.actorId === actorId)?.polityId !== input.playerPolityId);
    if (intruder) {
      outcomes.push({
        kind: 'unfunded', orderId: action.id,
        reason: 'impegno rifiutato: il conto indicato non appartiene alla nazione del giocatore',
      });
      continue;
    }

    try {
      const result = commitWork({
        gameId: input.gameId,
        branchId: input.branchId,
        orderId: action.id,
        holders: { money: declaration.payerActorId, materials: declaration.materialActorId },
        work,
        // La regione dichiarata dal client (dalla riunione/atto) ha la
        // precedenza sulla regione dell'ordine: è la localizzazione canonica
        // scelta dal Presidente. Senza, resta il comportamento precedente.
        regionId: declaration.regionId ?? input.regionId,
      });
      outcomes.push(result.status === 'committed'
        ? { kind: 'committed', orderId: action.id, projectId: result.projectId, reservationIds: result.reservationIds }
        : { kind: 'already_committed', orderId: action.id, projectId: result.projectId });
    } catch (error) {
      // Le risorse possono essere finite fra il preflight e il salto: un altro
      // ordine dello stesso turno le ha impegnate, o il mondo è cambiato. Non è
      // un errore di programma, è un esito da raccontare — e la transazione di
      // `commitWork` ha già annullato ogni prenotazione parziale.
      outcomes.push({ kind: 'unfunded', orderId: action.id, reason: humanReasonFor(error) });
    }
  }

  return outcomes;
}
