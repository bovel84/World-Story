/**
 * WS-GOV-REALITY-ADVISOR-HARDENING — UNICA fonte canonica dei tipi di asset.
 *
 * Prima esistevano due mappe indipendenti (`VerifiedWorldSnapshot` e
 * `CanonicalOrderSafety`) con alias diversi: lo stesso oggetto poteva risultare
 * «infrastruttura esistente» per il motore e «assente» per il Consulente. Qui
 * gli alias vivono in un solo posto e i consumatori mappano solo la categoria.
 *
 * `canonicalAssetKind` riconosce SOLO tipi realmente presenti nel progetto: non
 * inventa tipi che il motore non produce.
 */

/** Categorie di asset che un atto può usare o espandere. */
export type CanonicalAssetKind = 'port' | 'railway' | 'road' | 'airfield' | 'factory' | 'fleet';

/**
 * Alias canonici. I tipi `ft_*` sono le feature della mappa; i nomi brevi
 * (`port`, `railway`, …) ricorrono nei preset e negli oggetti operativi.
 */
const ALIASES: Readonly<Record<string, CanonicalAssetKind>> = {
  port: 'port',
  ft_port: 'port',
  harbour: 'port',
  harbor: 'port',
  railway: 'railway',
  ft_railway: 'railway',
  railroad: 'railway',
  rail: 'railway',
  road: 'road',
  ft_road: 'road',
  highway: 'road',
  airfield: 'airfield',
  airbase: 'airfield',
  ft_airbase: 'airfield',
  ft_airfield: 'airfield',
  airport: 'airfield',
  factory: 'factory',
  ft_factory: 'factory',
  ft_works: 'factory',
  ft_foundry: 'factory',
  works: 'factory',
  foundry: 'factory',
  steel_mill: 'factory',
  arms_factory: 'factory',
  vehicle_factory: 'factory',
  aircraft_factory: 'factory',
  fleet: 'fleet',
  ship: 'fleet',
};

export function canonicalAssetKind(type: string | null | undefined): CanonicalAssetKind | undefined {
  if (!type) return undefined;
  return ALIASES[type];
}

/** Etichetta italiana plurale, per i messaggi dei guard e dei read model. */
export const CANONICAL_ASSET_LABEL: Readonly<Record<CanonicalAssetKind, string>> = {
  port: 'porti',
  railway: 'ferrovie',
  road: 'strade',
  airfield: 'aeroporti',
  factory: 'fabbriche',
  fleet: 'flotta o navi',
};
