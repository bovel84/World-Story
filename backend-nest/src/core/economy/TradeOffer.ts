/**
 * MG04 — L'offerta di una controparte: chi ha davvero quella merce
 * ===============================================================
 * `PIANO_MOTORE_GOVERNO_E_MONDO_VIVO.md` lo chiede esplicitamente: «trattativa
 * ≠ contratto ≠ consegna». Fino a qui il motore sapeva dire a una nazione cosa
 * le manca (`Availability.ts`) e sapeva muovere merce fra due punti
 * (`TransitEngine`, `createShipmentRuntime`). Non sapeva rispondere alla domanda
 * in mezzo: **chi, fuori, ha davvero quella merce da vendere, e a quali
 * condizioni**.
 *
 * Questo modulo risponde, e lo fa con tre vincoli che sono il punto:
 *
 *  - **La disponibilità è quella dell'NPC, non del giocatore.** Le scorte si
 *    leggono dal ledger **presso gli attori di quella polity**, non dal magazzino
 *    di chi compra: l'acciaio di BETA non diventa disponibile perché ALPHA ne ha
 *    bisogno. È l'invariante MG-I5 applicata al commercio.
 *  - **La merce deve essere esportabile.** Ciò che è già impegnato in riserve
 *    attive non è in vendita: `available = total − committed`, come ovunque.
 *  - **Il prezzo è dichiarato dal catalogo, non inventato.** Se il catalogo non
 *    dice quanto costa una risorsa, l'offerta non si fa: `needs_price`, non un
 *    numero plausibile. Il testo del modello non crea prezzi.
 *
 * Modulo **puro** per la parte di valutazione: riceve le letture già fatte e
 * restituisce l'offerta. Chi legge il ledger lo fa fuori, come per `Availability`.
 */

import { IntString, parseInteger, intToString } from '../../domain/quantities';

/** Una giacenza esportabile di una controparte, per risorsa. */
export interface CounterpartyStock {
  /** Chi detiene la merce: l'attore, non la polity. */
  readonly holderActorId: string;
  readonly polityId: string;
  readonly resourceId: string;
  /** Disponibile = totale meno riserve attive, nell'unità del ledger. */
  readonly available: IntString;
}

/** Il prezzo dichiarato dal catalogo: se manca, l'offerta non si fa. */
export interface DeclaredPrice {
  readonly resourceId: string;
  readonly currencyId: string;
  /** Prezzo per unità base, in unità minime. Frazione ammessa come razionale. */
  readonly minorUnitsPerBaseUnit: { readonly numerator: IntString; readonly denominator: IntString };
}

export type OfferUnavailable =
  /** La controparte non ha quella merce, o l'ha tutta impegnata. */
  | { readonly kind: 'no_stock'; readonly polityId: string; readonly available: IntString }
  /** Il catalogo non dichiara un prezzo: non si inventa. */
  | { readonly kind: 'needs_price'; readonly resourceId: string };

export interface TradeOffer {
  readonly polityId: string;
  readonly holderActorId: string;
  readonly resourceId: string;
  /** Quanto è disposta a vendere: la sua disponibilità, non il fabbisogno. */
  readonly quantity: IntString;
  /** Quanto il compratore ha chiesto, se ha chiesto più di così. */
  readonly requested: IntString;
  /** Vero quando la controparte non copre la richiesta: l'offerta è parziale. */
  readonly partial: boolean;
  readonly currencyId: string;
  /** Costo totale in unità minime, arrotondato in ECCESSO (mai un regalo). */
  readonly totalMinorUnits: IntString;
}

export interface OfferInput {
  readonly polityId: string;
  readonly resourceId: string;
  /** Quanto il compratore vorrebbe. */
  readonly requested: IntString;
  readonly stocks: readonly CounterpartyStock[];
  readonly price: DeclaredPrice | undefined;
}

/**
 * L'offerta di una controparte per una risorsa.
 *
 * `null` quando la controparte non ha nulla da vendere. Un `OfferUnavailable`
 * quando c'è un impedimento strutturale (prezzo non dichiarato).
 */
export function offerFor(input: OfferInput): TradeOffer | OfferUnavailable {
  if (!input.price) return { kind: 'needs_price', resourceId: input.resourceId };

  // Solo la merce di QUELLA polity, e solo quella libera: le riserve attive
  // sono impegni già presi, non merce in vendita.
  const held = input.stocks.filter(stock =>
    stock.polityId === input.polityId && stock.resourceId === input.resourceId);
  const total = held.reduce((sum, stock) => sum + parseInteger(stock.available, 'available'), 0n);
  const requested = parseInteger(input.requested, 'requested');

  // Senza scorta non c'è offerta: non è un'offerta da zero.
  if (total <= 0n || held.length === 0) {
    return { kind: 'no_stock', polityId: input.polityId, available: intToString(total) };
  }

  const quantity = total < requested ? total : requested;
  const holder = held.reduce((best, stock) =>
    parseInteger(stock.available, 'a') > parseInteger(best.available, 'a') ? stock : best, held[0]);

  return {
    polityId: input.polityId,
    holderActorId: holder.holderActorId,
    resourceId: input.resourceId,
    quantity: quantity.toString(),
    requested: intToString(requested),
    partial: quantity < requested,
    currencyId: input.price.currencyId,
    // Il costo si arrotonda in ECCESSO: una frazione di unità minima non è un
    // regalo al compratore, e il venditore non regala (§6.1: il resto è
    // esplicito, non nascosto).
    totalMinorUnits: priceOf(quantity, input.price.minorUnitsPerBaseUnit).toString(),
  };
}

/**
 * Costo di `quantity` al prezzo dichiarato, arrotondato in eccesso.
 * Due forme, una per l'uso interno (bigint, già parsato) e una per l'esterno
 * (stringa canonica): convertire due volte è il modo in cui un numero cambia.
 */
export function priceFor(quantity: IntString, price: { numerator: IntString; denominator: IntString }): bigint {
  return priceOf(parseInteger(quantity, 'quantity'), price);
}

export function priceOf(amount: bigint, price: { numerator: IntString; denominator: IntString }): bigint {
  const numerator = parseInteger(price.numerator, 'numerator');
  const denominator = parseInteger(price.denominator, 'denominator');
  if (denominator <= 0n) throw new Error('denominatore del prezzo non positivo');
  const total = amount * numerator;
  const quotient = total / denominator;
  return total % denominator === 0n ? quotient : quotient + 1n;
}

/**
 * L'offerta è accettabile per il compratore? Verifica la sua cassa, **non** la
 * disponibilità della merce (quella l'ha già verificata l'offerta).
 */
export function buyerCanAfford(offer: TradeOffer, buyerAvailableMinorUnits: IntString): boolean {
  return parseInteger(offer.totalMinorUnits, 'total') <= parseInteger(buyerAvailableMinorUnits, 'available');
}

/**
 * La rotta: da dove parte la merce e dove arriva, con i giorni di viaggio.
 * I giorni non li decide il modello: sono una distanza dichiarata, e se non
 * c'è, il trasporto non si pianifica.
 */
export interface TradeRoute {
  readonly originRegionId: string;
  readonly destinationRegionId: string;
  readonly days: number;
}

export function routeIsUsable(route: TradeRoute | undefined): route is TradeRoute {
  return !!route
    && typeof route.originRegionId === 'string' && route.originRegionId.length > 0
    && typeof route.destinationRegionId === 'string' && route.destinationRegionId.length > 0
    && Number.isInteger(route.days) && route.days >= 0;
}
