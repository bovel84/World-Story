/**
 * MAP-DETAIL — funzioni pure per il preset editor.
 * ================================================
 * Servono a capire se una mappa caricata è provinciale e quali proprietà
 * GeoJSON possono raggruppare le province in `grouped`. Nessuna dipendenza da
 * React: così restano testabili come funzioni pure.
 *
 * La generazione vera (proiezione, confini) vive lato backend in
 * `backend-nest/src/utils/map-detail.ts`; qui c'è solo il supporto di editing.
 */

/** Vero se la mappa caricata porta province (`properties.country` ≠ `code`). */
export function hasProvinceFeatures(map: any): boolean {
  const features = map?.features;
  if (!Array.isArray(features)) return false;
  return features.some((feature: any) => {
    const props = feature?.properties || {};
    return typeof props.country === 'string' && props.country !== ''
      && typeof props.code === 'string' && props.code !== ''
      && props.country !== props.code;
  });
}

/**
 * Livelli di dettaglio della mappa (allineato a `PresetMapDetail` di
 * `services/api`).
 */
export type MapDetailLevel = 'nations' | 'grouped' | 'full';

/**
 * Un'opzione del livello mappa è disabilitata **solo** se il preset non ha una
 * mappa provinciale e l'opzione non è «nations». Regola pura e testabile:
 * il campo non va mai disabilitato a livello di fieldset, perché
 * `<fieldset disabled>` bloccherebbe anche «nations».
 */
export function mapDetailOptionDisabled(hasProvinceMap: boolean, value: MapDetailLevel): boolean {
  return !hasProvinceMap && value !== 'nations';
}

/**
 * Il preset ha una mappa provinciale effettiva? Il file proprio vince sulla
 * mappa nativa scelta (stessa precedenza della generazione). PURA.
 */
export function effectiveProvinceMap(
  hasOwnMap: boolean,
  ownHasProvinces: boolean,
  nativeHasProvinces: boolean,
): boolean {
  return hasOwnMap ? ownHasProvinces : nativeHasProvinces;
}

/**
 * Codici paese effettivamente generabili per il preset. PURA.
 * - con un override `countries` nel preset → quei codici;
 * - altrimenti i `country_codes` filtrati per il registro noto (i codici
 *   sconosciuti al registro NON producono politia, quindi non servono geometria).
 * Restituisce `null` se il registro non è disponibile (nessun filtro affidabile):
 * in quel caso il chiamante non deve bloccare nulla.
 */
export function requiredCountryCodes(
  countryCodes: string[],
  overrideCodes: string[],
  knownCodes: string[],
): string[] | null {
  const normalize = (codes: string[]) => [...new Set(codes.map(c => c.toUpperCase()).filter(Boolean))];
  if (overrideCodes.length > 0) return normalize(overrideCodes);
  if (knownCodes.length === 0) return null;
  const known = new Set(knownCodes.map(c => c.toUpperCase()));
  return normalize(countryCodes.filter(code => known.has(code.toUpperCase())));
}

/** Codici richiesti NON coperti dalla mappa nativa. PURA. */
export function nativeMapMissingCodes(required: string[], covered: string[]): string[] {
  const have = new Set((covered || []).map(c => c.toUpperCase()));
  return required.filter(code => !have.has(code.toUpperCase()));
}

/**
 * Proprietà GeoJSON che possono raggruppare le province in `grouped`:
 * presenti su più feature e con un numero di valori distinti intermedio
 * (non univoci come `code`, non costanti), di tipo scalare. Suggerisce le
 * gerarchie reali (es. `region`, `admin1`, o una chiave storica creata
 * dall'autore) senza imporre un nome fisso.
 */
export function detectGroupingKeys(map: any): string[] {
  const features: any[] = Array.isArray(map?.features) ? map.features : [];
  const total = features.length;
  if (total < 3) return [];
  const values = new Map<string, Set<string>>();
  for (const feature of features) {
    const props = feature?.properties;
    if (!props || typeof props !== 'object') continue;
    for (const [key, raw] of Object.entries(props)) {
      if (key === 'country' || key === 'code' || key === 'name') continue;
      if (typeof raw !== 'string' && typeof raw !== 'number') continue;
      if (raw === '') continue;
      if (!values.has(key)) values.set(key, new Set());
      values.get(key)!.add(String(raw));
    }
  }
  return [...values.entries()]
    .filter(([, distinct]) => distinct.size > 1 && distinct.size < total)
    .sort((a, b) => a[1].size - b[1].size || a[0].localeCompare(b[0]))
    .map(([key]) => key);
}
