/**
 * World Story — LW06: presenza diplomatica (read model puro)
 * ========================================================
 * Traduce la matrice di relazioni già pubblicata dal motore
 * (`GET /:id/relationships`) in un quadro leggibile: alleati, ostili,
 * neutrali e una riga di sintesi. Nessun nuovo treaty engine, nessuna nuova
 * verità: solo presentazione dei dati esistenti.
 *
 * Il **nome** di ogni partner arriva dal motore (`names`, vedi
 * `GameSession.getRelationshipNames`): registro dei paesi, nomi italiani curati
 * e nomi dei preset storici. Prima veniva dedotto dal nome della provincia
 * capitale, e «ITA» si leggeva «Aosta» — un difetto di identità, non di stile.
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

/**
 * Nome leggibile di una polity: la mappa del motore ha la precedenza. Il codice
 * è l'ultimo ripiego — meglio `ITA` di un nome di città che non è il paese.
 */
function polityDisplayName(
  polityId: string,
  regions: readonly Region[],
  names?: Record<string, string> | null,
): string {
  const authoritative = names?.[polityId];
  if (authoritative && authoritative.trim()) return authoritative;
  const owned = regions.filter(region => region.owner === polityId);
  const capital = owned.find(region => (region.metadata as Record<string, unknown> | undefined)?.isCapitalProvince);
  // Il nome della provincia resta solo come indizio estremo, e mai al posto di
  // un codice valido: `ITA` è più onesto di «Aosta».
  const provinceName = (capital || owned[0])?.name;
  return provinceName && provinceName.trim().length > 0 && /[a-z]/.test(provinceName)
    ? provinceName
    : polityId;
}

/**
 * Costruisce il quadro diplomatico per il proprietario selezionato. Ordina gli
 * alleati prima, poi gli ostili. Deterministica e senza effetti collaterali.
 */
export function deriveDiplomacyPresence(input: {
  relationships: Record<string, Record<string, string>> | null | undefined;
  regionOwner: string;
  regions: readonly Region[];
  /** Nomi pubblici delle polity, dal motore. Assente ⇒ ripiego sul codice. */
  names?: Record<string, string> | null;
}): DiplomacyPresence {
  const relMap = input.relationships?.[input.regionOwner] ?? {};
  const entries: DiplomacyEntry[] = Object.entries(relMap).map(([id, relationship]) => ({
    id,
    name: polityDisplayName(id, input.regions, input.names),
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
