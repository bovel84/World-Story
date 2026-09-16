/**
 * World Story — Fase 2: test del contesto nazionale e della CommandRail
 * ====================================================================
 */
import { describe, expect, it, vi } from 'vitest';
import { deriveNationalContext, deriveRailItems } from './nationalContext';
import type { Game, Region } from '../../types';

const region = (over: Partial<Region>): Region => ({
  id: 'R1', name: 'Regione', owner: 'AAA', gdp: 100, population: 10,
  ...over,
} as Region);

const game = (over: Partial<Game> = {}): Game => ({
  id: 'g1', currentTurn: 1, currentDate: '1951-01-01',
  players: [{ id: 'p1', regionId: 'CAP', polityId: 'AAA' } as any],
  ...over,
} as Game);

describe('deriveNationalContext', () => {
  it('riconosce la polis del giocatore e le sue regioni', () => {
    const regions = [
      region({ id: 'CAP', owner: 'AAA', polityName: 'Atlantide' }),
      region({ id: 'R2', owner: 'AAA' }),
      region({ id: 'R3', owner: 'BBB' }),
    ];
    const ctx = deriveNationalContext({ regions, currentGame: game(), selectedRegion: null, nationalAccounts: {} });
    expect(ctx.playerPolityId).toBe('AAA');
    expect(ctx.nationalRegions.map(r => r.id)).toEqual(['CAP', 'R2']);
    expect(ctx.nationalName).toBe('Atlantide');
    expect(ctx.playerRegionId).toBe('CAP');
  });

  it('preferisce i valori aggregati dal motore alla somma delle regioni', () => {
    const regions = [region({ id: 'CAP', owner: 'AAA', gdp: 100, population: 10 })];
    const ctx = deriveNationalContext({
      regions,
      currentGame: game(),
      selectedRegion: null,
      nationalAccounts: { AAA: { nominalGdpUsdBillions: 999, population: 42, monthlyRevenue: 5, monthlyExpenses: 3, government: 'Monarchia parlamentare' } },
    });
    expect(ctx.nationalGdp).toBe(999);
    expect(ctx.nationalPopulation).toBe(42);
    expect(ctx.estimatedRevenue).toBe(5);
    expect(ctx.estimatedExpenses).toBe(3);
    expect(ctx.governmentType).toBe('Monarchia parlamentare');
  });

  it('ripiega sulla somma delle regioni e sulla mappa forme di governo note', () => {
    const regions = [region({ id: 'CAP', owner: 'GBR', gdp: 10, population: 2 }), region({ id: 'R2', owner: 'GBR', gdp: 5, population: 3 })];
    const ctx = deriveNationalContext({
      regions,
      currentGame: game({ players: [{ id: 'p1', regionId: 'CAP', polityId: 'GBR' } as any] }),
      selectedRegion: null,
      nationalAccounts: {},
    });
    expect(ctx.nationalGdp).toBe(15);
    expect(ctx.nationalPopulation).toBe(5);
    expect(ctx.governmentType).toBe('Monarchia parlamentare');
  });

  it('segnala una provincia esterna selezionata di un\'altra polis', () => {
    const regions = [region({ id: 'CAP', owner: 'AAA' }), region({ id: 'R3', owner: 'BBB' }), region({ id: 'R4', owner: 'AAA' })];
    const external = deriveNationalContext({ regions, currentGame: game(), selectedRegion: 'R3', nationalAccounts: {} });
    expect(external.externalRegionSelected).toBe(true);
    const own = deriveNationalContext({ regions, currentGame: game(), selectedRegion: 'R4', nationalAccounts: {} });
    expect(own.externalRegionSelected).toBe(false);
  });
});

describe('deriveRailItems', () => {
  it('marca il modulo attivo e riporta i badge dei dispacci', () => {
    const openModule = vi.fn();
    const items = deriveRailItems({ activeModule: 'news', totalUnread: 3, unreadFeedCount: 7, openModule });
    expect(items.map(i => i.id)).toEqual(['orders', 'diplomacy', 'advisor', 'news', 'nation']);
    expect(items.find(i => i.id === 'news')).toMatchObject({ badge: 7, active: true });
    expect(items.find(i => i.id === 'diplomacy')).toMatchObject({ badge: 3, active: false });
    items[0].onClick();
    expect(openModule).toHaveBeenCalledWith('orders');
  });
});
