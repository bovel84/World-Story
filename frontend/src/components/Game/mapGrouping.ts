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
