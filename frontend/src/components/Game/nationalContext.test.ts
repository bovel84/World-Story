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
    const ctx = deriveNationalContext({ regions, currentGame: game(), selectedRegion: null, nationalAccounts: {}, relationshipNames: { AAA: 'Atlantide' } });
    expect(ctx.playerPolityId).toBe('AAA');
    expect(ctx.nationalRegions.map(r => r.id)).toEqual(['CAP', 'R2']);
    expect(ctx.nationalName).toBe('Atlantide');
    expect(ctx.playerRegionId).toBe('CAP');
  });

  it('N01 — senza il nome dal motore il nome resta assente, mai ricavato dalla regione', () => {
    // Prima questo test asseriva `polityName` della regione come nome della
    // nazione. Era il difetto: su un mondo provinciale quel campo è il nome di
    // una **provincia** («Alaska» per gli USA di `pax_modern_provinces`).
    const regions = [region({ id: 'CAP', owner: 'AAA', polityName: 'Atlantide' })];
    const ctx = deriveNationalContext({ regions, currentGame: game(), selectedRegion: null, nationalAccounts: {} });
    expect(ctx.nationalName).toBe('');
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

  it('ripiega sulla somma delle regioni; la forma di governo viene solo dal motore', () => {
    // Prima questo test asseriva che il client ricavasse «Monarchia parlamentare»
    // per GBR da una mappa scritta a mano (`GOVERNMENT_TYPES`) e, per tutti gli
    // altri paesi, un default «Repubblica presidenziale». Entrambi erano dati
    // inventati dal client (N4/N7): ora il conto del motore è l'unica fonte.
    const regions = [region({ id: 'CAP', owner: 'GBR', gdp: 10, population: 2 }), region({ id: 'R2', owner: 'GBR', gdp: 5, population: 3 })];
    const base = {
      currentGame: game({ players: [{ id: 'p1', regionId: 'CAP', polityId: 'GBR' } as any] }),
      selectedRegion: null,
    };
    const senzaConto = deriveNationalContext({ ...base, regions, nationalAccounts: {} });
    expect(senzaConto.nationalGdp).toBe(15);
    expect(senzaConto.nationalPopulation).toBe(5);
    expect(senzaConto.governmentType).toBe('');

    const conConto = deriveNationalContext({
      ...base, regions,
      nationalAccounts: { GBR: { government: 'Monarchia parlamentare' } },
    });
    expect(conConto.governmentType).toBe('Monarchia parlamentare');
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
    // V01: «Questioni» sta fra Ordini e Diplomazia — è la voce delle sfide di
    // pace, che non vivono più dentro il dossier nazionale.
    // D-1: «Forze» (la sala operativa) segue lo stesso principio — fuori dal
    // dossier, accanto alle altre voci che chiedono un'azione.
    expect(items.map(i => i.id)).toEqual(['orders', 'questioni', 'forze', 'diplomacy', 'advisor', 'news', 'nation']);
    expect(items.find(i => i.id === 'news')).toMatchObject({ badge: 7, active: true });
    expect(items.find(i => i.id === 'diplomacy')).toMatchObject({ badge: 3, active: false });
    items[0].onClick();
    expect(openModule).toHaveBeenCalledWith('orders');
  });

  it('V01: il distintivo delle Questioni conta le sfide attive, non quelle chiuse', () => {
    const openModule = vi.fn();
    const base = { activeModule: 'none', totalUnread: 0, unreadFeedCount: 0, openModule };

    // Nessuna sfida aperta → nessun distintivo (la voce resta, ma muta).
    expect(deriveRailItems({ ...base, openQuestions: 0 }).find(i => i.id === 'questioni'))
      .toMatchObject({ badge: 0, label: 'Questioni' });
    // Sfide aperte → il numero, e la voce punta al pannello.
    const withOpen = deriveRailItems({ ...base, openQuestions: 3 }).find(i => i.id === 'questioni')!;
    expect(withOpen.badge).toBe(3);
    withOpen.onClick();
    expect(openModule).toHaveBeenCalledWith('questioni');
  });
});
