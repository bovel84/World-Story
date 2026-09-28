/**
 * MG04 — La controparte ha davvero quella merce?
 * =============================================
 * Il piano lo dice in una riga: «trattativa ≠ contratto ≠ consegna». Fino a qui
 * il motore sapeva dire cosa manca a una nazione e sapeva muovere merce fra due
 * punti; non sapeva rispondere alla domanda in mezzo — **chi, fuori, ha quella
 * merce da vendere, e a quali condizioni**.
 *
 * Le regole che i test difendono:
 *  - **la disponibilità è dell'NPC, non del compratore**: le scorte di BETA non
 *    diventano vendibili perché ALPHA ne ha bisogno;
 *  - **ciò che è già impegnato non è in vendita**: `available`, non `total`;
 *  - **il prezzo è dichiarato dal catalogo**: senza, l'offerta non si fa
 *    (`needs_price`), invece di inventare un numero plausibile;
 *  - **l'offerta può essere parziale**, e lo dichiara: la controparte vende
 *    quello che ha, non quello che le si chiede.
 *
 * Guardia contro il falso verde: si verifica anche il caso che DEVE fallire —
 * nessuna scorta, prezzo assente — e si controlla l'ARROTONDAMENTO del prezzo,
 * che è il punto in cui un numero sbagliato passa inosservato.
 */
import { describe, expect, it } from 'vitest';
import {
  buyerCanAfford, offerFor, priceFor, routeIsUsable,
  type CounterpartyStock, type DeclaredPrice,
} from '../src/core/economy/TradeOffer';

const price: DeclaredPrice = {
  resourceId: 'steel', currencyId: 'TEST',
  // 3 unità minime per kg: un prezzo dichiarato, non un numero scelto qui.
  minorUnitsPerBaseUnit: { numerator: '3', denominator: '1' },
};

const stock = (holderActorId: string, polityId: string, available: string): CounterpartyStock => ({
  holderActorId, polityId, resourceId: 'steel', available,
});

describe('MG04 — l’offerta di una controparte', () => {
  it('la controparte vende quello che ha, non quello che le si chiede', () => {
    const offer = offerFor({
      polityId: 'BETA', resourceId: 'steel', requested: '100',
      stocks: [stock('beta_treasury', 'BETA', '150')], price,
    });
    if ('kind' in offer) throw new Error('attesa un’offerta');
    // Chiede 100, ne ha 150: vende 100.
    expect(offer.quantity).toBe('100');
    expect(offer.partial).toBe(false);
    expect(offer.holderActorId).toBe('beta_treasury');
    // 100 kg a 3 unità minime = 300.
    expect(offer.totalMinorUnits).toBe('300');
  });

  it('se la controparte ne ha meno, l’offerta è PARZIALE e lo dichiara', () => {
    const offer = offerFor({
      polityId: 'BETA', resourceId: 'steel', requested: '500',
      stocks: [stock('beta_treasury', 'BETA', '150')], price,
    });
    if ('kind' in offer) throw new Error('attesa un’offerta');
    expect(offer.quantity).toBe('150');
    expect(offer.requested).toBe('500');
    expect(offer.partial).toBe(true);
    expect(offer.totalMinorUnits).toBe('450');
  });

  it('la merce di un’ALTRA nazione non è disponibilità', () => {
    // È l'invariante MG-I5 applicata al commercio: le scorte di ALPHA non
    // entrano nell'offerta di BETA, nemmeno se servono al compratore.
    const offer = offerFor({
      polityId: 'BETA', resourceId: 'steel', requested: '100',
      stocks: [stock('alpha_steel_co', 'ALPHA', '999'), stock('beta_treasury', 'BETA', '40')], price,
    });
    if ('kind' in offer) throw new Error('attesa un’offerta');
    expect(offer.quantity).toBe('40');
    expect(offer.holderActorId).toBe('beta_treasury');
    expect(offer.totalMinorUnits).toBe('120');
  });

  it('senza scorta non c’è offerta, e non è un’offerta da zero', () => {
    const none = offerFor({
      polityId: 'BETA', resourceId: 'steel', requested: '100', stocks: [], price,
    });
    expect(none).toMatchObject({ kind: 'no_stock', polityId: 'BETA', available: '0' });

    // Anche con scorta solo per un'altra nazione.
    const other = offerFor({
      polityId: 'BETA', resourceId: 'steel', requested: '100',
      stocks: [stock('alpha_steel_co', 'ALPHA', '500')], price,
    });
    expect(other).toMatchObject({ kind: 'no_stock' });
  });

  it('senza prezzo dichiarato l’offerta non si fa: non si inventa un numero', () => {
    const result = offerFor({
      polityId: 'BETA', resourceId: 'steel', requested: '100',
      stocks: [stock('beta_treasury', 'BETA', '150')],
      price: undefined,
    });
    expect(result).toMatchObject({ kind: 'needs_price', resourceId: 'steel' });
  });

  it('con più detentori si sceglie chi ne ha di più, e la quantità è la somma', () => {
    const offer = offerFor({
      polityId: 'BETA', resourceId: 'steel', requested: '100',
      stocks: [stock('beta_depot_a', 'BETA', '30'), stock('beta_depot_b', 'BETA', '70')], price,
    });
    if ('kind' in offer) throw new Error('attesa un’offerta');
    expect(offer.quantity).toBe('100');
    // Chi ne ha di più è il detentore della rotta: non si sposta merce da due
    // magazzini senza dirlo.
    expect(offer.holderActorId).toBe('beta_depot_b');
  });

  it('un prezzo frazionario si arrotonda in ECCESSO, mai in difetto', () => {
    // 5 kg a 1/3 di unità minima = 1.67 → 2. Il venditore non regala, e il
    // compratore non paga meno di così.
    expect(priceFor('5', { numerator: '1', denominator: '3' })).toBe(2n);
    // Esatto: 6/3 = 2, non 3.
    expect(priceFor('6', { numerator: '1', denominator: '3' })).toBe(2n);
    // Zero resta zero.
    expect(priceFor('0', { numerator: '7', denominator: '3' })).toBe(0n);
  });

  it('un denominatore nullo è un prezzo malformato, non zero', () => {
    expect(() => priceFor('5', { numerator: '1', denominator: '0' })).toThrow();
  });

  it('il compratore può pagare? La cassa è sua, non della controparte', () => {
    const offer = offerFor({
      polityId: 'BETA', resourceId: 'steel', requested: '100',
      stocks: [stock('beta_treasury', 'BETA', '150')], price,
    });
    if ('kind' in offer) throw new Error('attesa un’offerta');
    expect(buyerCanAfford(offer, '299')).toBe(false);
    expect(buyerCanAfford(offer, '300')).toBe(true);
    expect(buyerCanAfford(offer, '1000')).toBe(true);
  });

  it('una rotta senza origine, destinazione o giorni non è percorribile', () => {
    expect(routeIsUsable({ originRegionId: 'BETA-est', destinationRegionId: 'ALPHA-nord', days: 4 })).toBe(true);
    expect(routeIsUsable({ originRegionId: '', destinationRegionId: 'ALPHA-nord', days: 4 })).toBe(false);
    expect(routeIsUsable({ originRegionId: 'BETA-est', destinationRegionId: '', days: 4 })).toBe(false);
    expect(routeIsUsable({ originRegionId: 'BETA-est', destinationRegionId: 'ALPHA-nord', days: -1 })).toBe(false);
    expect(routeIsUsable({ originRegionId: 'BETA-est', destinationRegionId: 'ALPHA-nord', days: 1.5 })).toBe(false);
    expect(routeIsUsable(undefined)).toBe(false);
  });
});
