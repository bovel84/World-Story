/**
 * MG04 µ3 — Il contratto e la consegna: trattativa, contratto, merce
 * ================================================================
 * `TradeOffer.ts` risponde alla prima domanda — *chi ha quella merce, a che
 * prezzo*. Qui si fanno le altre due, e la distinzione è il punto dell'invariante
 * MG-I4: **accettare un'offerta non è ricevere la merce**.
 *
 * Il giro, nell'ordine in cui il motore lo esegue:
 *
 *  1. **Il contratto** (`createTradeContract`) impegna le due parti: il compratore
 *     prenota la sua cassa, il venditore **riserva** la merce che ha promesso.
 *     Da questo momento la merce non è più disponibile per altri — ma non è
 *     ancora di nessuno;
 *  2. **La partenza** (`createShipmentRuntime`) mette la merce **in viaggio**:
 *     esce dal detentore ed entra in `transit:<shipmentId>`. Non è nel magazzino
 *     del compratore: è sulla strada (MG-I4 lo dice esplicitamente);
 *  3. **La consegna**, alla data d'arrivo, la fa entrare dal transito al
 *     destinatario — ed è il tick a eseguirla (`applyDueCanonicalEffects`
 *     consuma `shipment_runtime_states`), non questa funzione.
 *
 * Perché il venditore **riserva** e non vende subito: se vendesse al momento
 * della firma, un contratto annullato prima della partenza avrebbe già spostato
 * merce. La riserva è l'impegno; la partenza è il fatto. Ed è la stessa
 * disciplina che il cantiere usa per i suoi materiali.
 *
 * Il pagamento segue la stessa logica: il compratore riserva la cassa alla firma
 * e la merce si paga **alla consegna**. Una merce persa in viaggio non si paga —
 * ed è un caso che il motore sa già rappresentare (`loseShipment`).
 */

import db, { withCanonicalTransaction } from '../database';
import { createReservation, consumeReservation, getReservationAvailability } from './ReservationService';
import { createShipmentRuntime, ledgerUnitId } from './StrictEffectProducerService';
import { offerFor, routeIsUsable, type DeclaredPrice, type TradeOffer, type TradeRoute } from '../core/economy/TradeOffer';
import { parseInteger } from '../domain/quantities';
import type { Shipment } from '../core/economy/TransitEngine';
import type { CounterpartyStock } from '../core/economy/TradeOffer';

export type ContractOutcome =
  | {
    readonly kind: 'signed';
    readonly contractId: string;
    readonly shipmentId: string;
    /** Riserva sulla cassa del compratore: il pagamento avverrà alla consegna. */
    readonly paymentReservationId: string;
    /** Riserva sulla merce del venditore: la partenza la consumerà. */
    readonly goodsReservationId: string;
    readonly departureDate: string;
    readonly arrivalDate: string;
  }
  /** La merce non c'è, o è tutta impegnata. */
  | { readonly kind: 'no_stock'; readonly available: string }
  /** Il catalogo non dichiara il prezzo. */
  | { readonly kind: 'needs_price'; readonly resourceId: string }
  /** La cassa del compratore non copre il prezzo. */
  | { readonly kind: 'unaffordable'; readonly required: string; readonly available: string }
  /** La rotta non è dichiarata: senza origine, destinazione e giorni non si spedisce. */
  | { readonly kind: 'no_route' };

export interface CreateTradeContractInput {
  readonly gameId: string;
  readonly branchId: string;
  /** Id del contratto: da qui derivano le chiavi idempotenti. */
  readonly contractId: string;
  /** Chi compra: la sua cassa paga, il suo magazzino riceve. */
  readonly buyerActorId: string;
  /** Chi vende: la sua merce parte. */
  readonly sellerPolityId: string;
  readonly resourceId: string;
  readonly requested: string;
  /** Le giacenze disponibili delle controparti, già lette dal ledger. */
  readonly stocks: readonly CounterpartyStock[];
  readonly price: DeclaredPrice | undefined;
  readonly route: TradeRoute | undefined;
  readonly departureDate: string;
  /**
   * Il trasporto è autorizzato? È una decisione del chiamante — una rotta
   * aperta, un vettore disponibile — non una conseguenza della firma. Assente
   * significa «non autorizzato»: la spedizione resta `blocked` finché qualcuno
   * non la sblocca, e lo dichiara.
   */
  readonly transportAuthorized?: boolean;
}

/** Chiave idempotente della riserva di pagamento. */
export function paymentReservationIdFor(contractId: string): string {
  return `tpay_${contractId}`;
}
/** Chiave idempotente della riserva sulla merce del venditore. */
export function goodsReservationIdFor(contractId: string): string {
  return `tgoods_${contractId}`;
}
/** L'id della spedizione: derivato dal contratto, non da un contatore. */
export function shipmentIdFor(contractId: string): string {
  return `shp_${contractId}`;
}

/**
 * Firma il contratto: riserva la cassa del compratore e la merce del venditore,
 * e mette la spedizione in coda di partenza.
 *
 * Non sposta merce e non spende: quello lo fa il tick, alla partenza e alla
 * consegna. Un contratto firmato e mai partito lascia le due riserve attive —
 * stato leggibile, non un fatto compiuto.
 */
export function createTradeContract(input: CreateTradeContractInput): ContractOutcome {
  // La firma è ATOMICA: due riserve e una spedizione, o nessuna delle tre. Un
  // errore a metà — misurato: la spedizione già presente con contenuto diverso
  // — lasciava le riserve appese a un contratto mai firmato. Le transazioni dei
  // repository diventano savepoint, come per il commit di un'opera.
  return withCanonicalTransaction(() => createTradeContractInner(input));
}

function createTradeContractInner(input: CreateTradeContractInput): ContractOutcome {
  const { gameId, branchId, contractId, buyerActorId, resourceId, requested } = input;

  // La rotta è una condizione, non un dettaglio: senza, la merce non ha un
  // tragitto, e «in viaggio» non significherebbe nulla.
  if (!routeIsUsable(input.route)) return { kind: 'no_route' };

  const offer = offerFor({
    polityId: input.sellerPolityId, resourceId, requested,
    stocks: input.stocks, price: input.price,
  });
  if ('kind' in offer) return offer;

  // La cassa del compratore: si verifica PRIMA di riservare, così il rifiuto è
  // un esito e non un'eccezione a metà transazione.
  const currencyUnit = ledgerUnitId(offer.currencyId);
  const buyerMoney = getReservationAvailability(branchId, {
    kind: 'money', unitId: currencyUnit, holderRef: buyerActorId,
  });
  if (parseInteger(offer.totalMinorUnits, 'total') > parseInteger(buyerMoney.available, 'available')) {
    return { kind: 'unaffordable', required: offer.totalMinorUnits, available: buyerMoney.available };
  }

  const route = input.route!;
  const departureDate = input.departureDate;
  const arrivalDate = addDays(departureDate, route.days);

  // ── Le due riserve ──────────────────────────────────────────────────────
  // Il compratore impegna la cassa; il venditore impegna la merce promessa.
  // Entrambe con chiave derivata dal contratto: un retry è un no-op.
  createReservation(gameId, branchId, {
    reservationId: paymentReservationIdFor(contractId),
    target: { kind: 'money', unitId: currencyUnit, holderRef: buyerActorId },
    amount: offer.totalMinorUnits,
  });
  // La riserva va sul DETENTORE che ha davvero la merce, e non sull'aggregato:
  // `offerFor` somma i disponibili di più magazzini, ma la spedizione parte da
  // `holderActorId`. Riservare l'aggregato su un solo detentore fallirebbe —
  // misurato: `richiesti 200, disponibili 150` con due magazzini a 150 e 100.
  // Se il detentore scelto non copre l'offerta, si prova con gli altri.
  const holderForQuantity = input.stocks
    .filter(stock => stock.polityId === input.sellerPolityId && stock.resourceId === resourceId)
    .filter(stock => parseInteger(stock.available, 'a') >= parseInteger(offer.quantity, 'q'))
    .map(stock => stock.holderActorId);
  const holderActorId = holderForQuantity.includes(offer.holderActorId)
    ? offer.holderActorId
    : holderForQuantity[0];
  if (!holderActorId) {
    // Nessun singolo detentore copre la quantità: il contratto non si firma.
    // Meglio un rifiuto che una promessa che nessuno può mantenere.
    return { kind: 'no_stock', available: offer.quantity };
  }

  createReservation(gameId, branchId, {
    reservationId: goodsReservationIdFor(contractId),
    target: { kind: 'material', unitId: ledgerUnitId(resourceId), holderRef: holderActorId },
    amount: offer.quantity,
  });

  // ── La spedizione in attesa di partire ──────────────────────────────────
  // `status: 'planned'`: è il tick a farla partire alla data dichiarata, con
  // `departShipment` che verifica la merce e il trasporto. Qui si dichiara il
  // tragitto, non lo si percorre.
  const shipment: Shipment = {
    id: shipmentIdFor(contractId),
    resourceId: ledgerUnitId(resourceId),
    quantity: offer.quantity,
    // Il proprietario resta il venditore finché la merce non è consegnata:
    // l'invariante di proprietà è del venditore fino alla consegna.
    ownerRef: holderActorId,
    originRef: holderActorId,
    destinationRef: buyerActorId,
    // Il vettore è la nazione acquirente: è chi organizza il trasporto. Una
    // fase successiva potrà distinguere il vettore; qui è dichiarato.
    carrierRef: buyerActorId,
    departureDate,
    arrivalDate,
    status: 'planned',
  };
  // `transportAuthorized` è un'autorizzazione, e un contratto non se la concede
  // da solo: si dichiara dalla firma, e il tick la rispetta. Prima era cablata
  // a `true` e la firma autorizzava sé stessa.
  createShipmentRuntime(gameId, branchId, shipment, input.transportAuthorized ?? false);

  return {
    kind: 'signed',
    contractId,
    shipmentId: shipment.id,
    paymentReservationId: paymentReservationIdFor(contractId),
    goodsReservationId: goodsReservationIdFor(contractId),
    departureDate,
    arrivalDate,
  };
}

/**
 * Liquida il pagamento di un contratto consegnato.
 *
 * Alla firma la cassa del compratore è stata **riservata**; alla consegna si
 * consuma la riserva con un movimento vero verso il venditore. Prima di questa
 * funzione nessuno consumava `tpay_*`: misurato, la cassa restava riservata per
 * sempre e il venditore non incassava mai — il commento «il pagamento si regola
 * alla consegna» era falso.
 *
 * Si chiama **dopo** che la spedizione risulta `delivered`: una merce persa in
 * viaggio non si paga, e la riserva resta da rilasciare.
 */
export function settleTradePayment(input: {
  readonly gameId: string;
  readonly branchId: string;
  readonly contractId: string;
  readonly buyerActorId: string;
  readonly sellerActorId: string;
  readonly currencyId: string;
  readonly amountMinorUnits: string;
  readonly asOfDate: string;
}): boolean {
  const unitId = ledgerUnitId(input.currencyId);
  return withCanonicalTransaction(() => {
    const reservationId = paymentReservationIdFor(input.contractId);
    const row = db.prepare(
      "SELECT status FROM reservations WHERE branch_id = ? AND reservation_id = ?",
    ).get(input.branchId, reservationId) as { status: string } | undefined;
    // Già liquidato, o mai firmato: no-op esplicito, non un secondo pagamento.
    if (!row) return false;
    if (row.status === 'consumed') return false;

    consumeReservation(input.gameId, input.branchId, reservationId, {
      operationId: `tpay_settle_${input.contractId}`,
      amount: input.amountMinorUnits,
      ledgerEntry: {
        effectId: `tpay_settle_${input.contractId}`,
        entryIndex: 0,
        cause: 'pagamento',
        kind: 'money',
        unitId,
        fromRef: input.buyerActorId,
        toRef: input.sellerActorId,
        delta: input.amountMinorUnits,
        atDate: input.asOfDate,
      },
    });
    return true;
  });
}

/** Somma giorni a una data ISO, senza fusi e senza sorprese. */
export function addDays(date: string, days: number): string {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new Error(`data non canonica: ${date}`);
  const time = Date.parse(`${date}T00:00:00.000Z`);
  return new Date(time + days * 86_400_000).toISOString().slice(0, 10);
}

export type { TradeOffer };
