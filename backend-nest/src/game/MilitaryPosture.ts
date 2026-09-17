/**
 * World Story — MilitaryPosture
 * =============================
 * Read model puro della postura militare MATERIALE di una politia: quali
 * formazioni esistono davvero sulla mappa, dove, e in che stato.
 *
 * Perché esiste: il contesto di reazione riceve oggi solo il testo degli
 * ordini. Una mossa materiale (unità creata, mobilitazione avviata, reparto
 * spostato) esiste nella mappa ma non entrava mai nel contesto, quindi gli
 * attori rilevanti non avevano alcun aggancio materiale su cui reagire. Il
 * motore continua a decidere chi reagisce e con quali opzioni: qui si rende
 * soltanto visibile ciò che l'esercito del giocatore è realmente diventato.
 *
 * Nessun numero è inventato: ogni riga deriva da un oggetto presente in una
 * regione della sessione.
 */
import { UNIT_TYPES, unitEffectiveType } from '../utils/movement-orders';

export interface MilitaryPostureRegion {
  id: string;
  name: string;
  owner: string;
  objects?: any[];
}

export interface MilitaryPostureFact {
  unitId: string;
  unitName: string;
  /** Tipo operativo effettivo: una mobilitazione conta come il reparto previsto. */
  type: string;
  /** `forming` = reparto non ancora operativo (mobilitazione in corso). */
  status: 'forming' | 'operational';
  regionId: string;
  regionName: string;
}

const MAX_FACTS = 6;

/** Formazioni realmente presenti di una politia, le più fragili (in formazione) prima. */
export function playerMilitaryPosture(
  regions: Iterable<MilitaryPostureRegion>,
  polityId: string,
  limit = MAX_FACTS,
): MilitaryPostureFact[] {
  const facts: MilitaryPostureFact[] = [];
  for (const region of regions) {
    for (const object of region.objects || []) {
      if (!object || !UNIT_TYPES.has(object.type)) continue;
      const owner = object.owner || region.owner;
      if (owner !== polityId) continue;
      const status = object.type === 'mobilization' || object.metadata?.status === 'forming'
        ? 'forming'
        : 'operational';
      facts.push({
        unitId: String(object.id || object.name || ''),
        unitName: String(object.name || object.type),
        type: unitEffectiveType(object),
        status,
        regionId: region.id,
        regionName: region.name,
      });
    }
  }
  // Le formazioni in via di costituzione sono la notizia più rilevante per un
  // vicino: prima quelle, poi l'ordine alfabetico per una lettura stabile.
  return facts
    .sort((a, b) => (a.status === b.status ? 0 : a.status === 'forming' ? -1 : 1)
      || a.unitName.localeCompare(b.unitName))
    .slice(0, limit);
}

/**
 * Blocco compatto per il contesto di reazione. Vuoto quando la politia non ha
 * formazioni: nessuna riga inutile nel prompt.
 */
export function renderMilitaryPosture(facts: MilitaryPostureFact[], polityName: string): string {
  if (facts.length === 0) return '';
  const lines = facts.map(fact =>
    `- ${fact.regionName} [${fact.regionId}]: ${fact.unitName} (${fact.type}, ${fact.status === 'forming' ? 'in formazione' : 'operativo'})`);
  return [
    `POSTURA MILITARE MATERIALE DI ${polityName} (stato di mappa, non intenzioni):`,
    ...lines,
    'Una formazione in formazione non è ancora operativa: un vicino può protestare, contro-mobilitare o chiedere garanzie.',
  ].join('\n');
}
