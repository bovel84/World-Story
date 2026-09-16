/**
 * World Story — Fase 2: contesto nazionale del giocatore
 * =====================================================
 * `renderGame` calcolava inline, a ogni render, chi è il giocatore, quali
 * regioni possiede, il nome della nazione, il PIL/la popolazione e se la
 * provincia selezionata è esterna. Sono derivazioni pure dai read model del
 * motore: vivono qui, testate, e `App` si limita a consumarle.
 *
 * Regole invariate:
 *  - la polis del giocatore è `players[0].polityId`, oppure l'owner della
 *    regione capitale, oppure `"player"`;
 *  - il valore aggregato dal motore (`nationalAccount`) prevale sulla somma
 *    delle regioni;
 *  - una provincia è «esterna» se non è la capitale del giocatore e appartiene
 *    a un'altra polis: il bollettino nazionale si nasconde.
 */
import type { Game, Region } from '../../types';

export interface NationalContextInput {
  regions: Region[];
  currentGame: Game | null | undefined;
  selectedRegion: string | null | undefined;
  nationalAccounts: Record<string, any>;
}

export interface NationalContext {
  /** Regione attualmente selezionata sulla mappa. */
  currentRegion: Region | undefined;
  /** PolityId del giocatore (owner della capitale o `players[0].polityId`). */
  playerPolityId: string;
  /** Regioni possedute dal giocatore. */
  nationalRegions: Region[];
  /** Regione di riferimento della nazione (capitale o prima posseduta). */
  nationalReference: Region | undefined;
  /** Nome leggibile della nazione. */
  nationalName: string;
  /** Conto nazionale aggregato dal motore per la polis del giocatore. */
  nationalAccount: any;
  nationalGdp: number;
  nationalPopulation: number;
  estimatedRevenue: number;
  estimatedExpenses: number;
  /** Forma di governo: dal motore, da una mappa nota o dal default. */
  governmentType: string;
  /** Regione capitale del giocatore. */
  playerRegionId: string | null;
  /** La provincia selezionata appartiene a un'altra polis. */
  externalRegionSelected: boolean;
}

const GOVERNMENT_TYPES: Record<string, string> = {
  PSE: 'Autorità nazionale palestinese',
  USA: 'Repubblica federale presidenziale',
  RUS: 'Repubblica federale presidenziale',
  CHN: 'Repubblica popolare a partito unico',
  GBR: 'Monarchia parlamentare',
  FRA: 'Repubblica semipresidenziale',
  DEU: 'Repubblica federale parlamentare',
  ITA: 'Repubblica parlamentare',
};

export function deriveNationalContext({
  regions,
  currentGame,
  selectedRegion,
  nationalAccounts,
}: NationalContextInput): NationalContext {
  const currentRegion = regions.find(r => r.id === selectedRegion);
  const playerRegionIdRaw = currentGame?.players?.[0]?.regionId;

  // Polis del giocatore (owner = polityId; da players.polityId, oppure dedotto dalla regione capitale)
  const playerPolityId = currentGame?.players?.[0]?.polityId
    ?? regions.find(r => r.id === playerRegionIdRaw)?.owner
    ?? 'player';
  const nationalRegions = regions.filter(region => region.owner === playerPolityId);
  const nationalReference = nationalRegions.find(region => region.id === playerRegionIdRaw) || nationalRegions[0];
  const nationalName = nationalReference?.polityName || nationalReference?.name || playerPolityId;
  const nationalAccount = nationalAccounts[playerPolityId];
  const nationalGdp = Number(nationalAccount?.nominalGdpUsdBillions ?? nationalRegions.reduce((sum, region) => sum + Number(region.gdp || 0), 0));
  const nationalPopulation = Number(nationalAccount?.population ?? nationalRegions.reduce((sum, region) => sum + Number(region.population || 0), 0));
  const estimatedRevenue = Number(nationalAccount?.monthlyRevenue ?? 0);
  const estimatedExpenses = Number(nationalAccount?.monthlyExpenses ?? 0);
  const governmentType = nationalAccount?.government || GOVERNMENT_TYPES[playerPolityId] || 'Repubblica presidenziale';
  const playerRegionId = playerRegionIdRaw || nationalReference?.id || null;
  // Provincia esterna selezionata: il bollettino nazionale si nasconde, resta solo il dettaglio provincia.
  const externalRegionSelected = Boolean(currentRegion && currentRegion.id !== playerRegionId && currentRegion.owner !== playerPolityId);

  return {
    currentRegion,
    playerPolityId,
    nationalRegions,
    nationalReference,
    nationalName,
    nationalAccount,
    nationalGdp,
    nationalPopulation,
    estimatedRevenue,
    estimatedExpenses,
    governmentType,
    playerRegionId,
    externalRegionSelected,
  };
}

export interface RailItem {
  id: 'orders' | 'diplomacy' | 'advisor' | 'news' | 'nation';
  icon: string;
  label: string;
  badge: number;
  active: boolean;
  onClick: () => void;
}

export interface RailItemsInput {
  activeModule: string;
  totalUnread: number;
  unreadFeedCount: number;
  openModule: (module: RailItem['id']) => void;
}

/** Voci della CommandRail: ordini, diplomazia, consulente, notizie, nazione. */
export function deriveRailItems({
  activeModule,
  totalUnread,
  unreadFeedCount,
  openModule,
}: RailItemsInput): RailItem[] {
  return [
    {
      id: 'orders',
      icon: '⚡',
      label: 'Ordini',
      badge: 0,
      active: activeModule === 'orders',
      onClick: () => openModule('orders'),
    },
    {
      id: 'diplomacy',
      icon: '💬',
      label: 'Diplomazia',
      badge: totalUnread > 0 ? totalUnread : 0,
      active: activeModule === 'diplomacy',
      onClick: () => openModule('diplomacy'),
    },
    {
      id: 'advisor',
      icon: '✦',
      label: 'Consulente',
      badge: 0,
      active: activeModule === 'advisor',
      onClick: () => openModule('advisor'),
    },
    {
      id: 'news',
      icon: '▤',
      label: 'Notizie',
      badge: unreadFeedCount,
      active: activeModule === 'news',
      onClick: () => openModule('news'),
    },
    {
      id: 'nation',
      icon: '⌂',
      label: 'Nazione',
      badge: 0,
      active: activeModule === 'nation',
      onClick: () => openModule('nation'),
    },
  ];
}
