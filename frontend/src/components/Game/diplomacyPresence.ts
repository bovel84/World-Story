/**
 * World Story — LW06: presenza diplomatica (read model puro)
 * ========================================================
 * Traduce la matrice di relazioni già pubblicata dal motore
 * (`GET /:id/relationships`) in un quadro leggibile: alleati, ostili,
 * neutrali e una riga di sintesi. Nessun nuovo treaty engine, nessuna nuova
 * verità: solo presentazione dei dati esistenti.
 */

import type { Region } from '../../types';

export interface DiplomacyEntry {
  id: string;
  name: string;
  relationship: string;
}

export interface DiplomacyPresence {
  allies: DiplomacyEntry[];
  hostiles: DiplomacyEntry[];
  /** Quanti partner restano neutrali. */
  neutrals: number;
  /** Totale dei partner conosciuti. */
  total: number;
  /** Riga breve per il briefing: «2 alleati · 1 ostile». */
  summary: string;
}

function polityDisplayName(polityId: string, regions: readonly Region[]): string {
  const owned = regions.filter(region => region.owner === polityId);
  const capital = owned.find(region => (region.metadata as Record<string, unknown> | undefined)?.isCapitalProvince);
  return (capital || owned[0])?.name || polityId;
}

/**
 * Costruisce il quadro diplomatico per il proprietario selezionato. Ordina gli
 * alleati prima, poi gli ostili. Deterministica e senza effetti collaterali.
 */
export function deriveDiplomacyPresence(input: {
  relationships: Record<string, Record<string, string>> | null | undefined;
  regionOwner: string;
  regions: readonly Region[];
}): DiplomacyPresence {
  const relMap = input.relationships?.[input.regionOwner] ?? {};
  const entries: DiplomacyEntry[] = Object.entries(relMap).map(([id, relationship]) => ({
    id,
    name: polityDisplayName(id, input.regions),
    relationship,
  }));

  const allies = entries.filter(entry => entry.relationship === 'ally');
  const hostiles = entries.filter(entry => entry.relationship === 'hostile');
  const neutrals = entries.length - allies.length - hostiles.length;

  const parts: string[] = [];
  if (allies.length > 0) parts.push(`${allies.length} ${allies.length === 1 ? 'alleato' : 'alleati'}`);
  if (hostiles.length > 0) parts.push(`${hostiles.length} ${hostiles.length === 1 ? 'ostile' : 'ostili'}`);
  if (parts.length === 0) parts.push(neutrals > 0 ? `${neutrals} partner neutrali` : 'nessuna relazione registrata');

  return { allies, hostiles, neutrals, total: entries.length, summary: parts.join(' · ') };
}
