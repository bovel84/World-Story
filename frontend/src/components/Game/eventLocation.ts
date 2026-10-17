import type { Region } from '../../types';

/** Camera hints from canonical geography only. No geocoder or model call. */
export interface EventLocation {
  label: string;
  regionIds: string[];
  center?: [number, number];
}
type Places = Map<string, EventLocation | null>;
export interface EventLocationIndex { places: Places; countries: Places; maxWords: number }
const normalize = (value: string) => value.normalize('NFD').replace(/\p{M}/gu, '')
  .toLocaleLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim();

export function buildEventLocationIndex(regions: readonly Region[]): EventLocationIndex {
  const places: Places = new Map();
  const countries: Places = new Map();
  const countryOwners = new Map<string, string>();
  let maxWords = 1;
  const add = (name: string, location: EventLocation) => {
    const key = normalize(name);
    if (key.length < 3) return;
    maxWords = Math.max(maxWords, key.split(' ').length);
    const previous = places.get(key);
    // Homonymous towns/provinces must not silently pick an arbitrary country.
    if (places.has(key) && (!previous || previous.regionIds[0] !== location.regionIds[0])) places.set(key, null);
    else places.set(key, location);
  };
  for (const region of regions) {
    if (!region.polityName || normalize(region.name) !== normalize(region.polityName)) {
      add(region.name, { label: region.name, regionIds: [region.id] });
    }
    for (const object of region.objects ?? []) {
      if (!['city', 'capital', 'port'].includes(object.type)) continue;
      const center: [number, number] | undefined = Number.isFinite(object.lng) && Number.isFinite(object.lat)
        && Math.abs(object.lng!) <= 180 && Math.abs(object.lat!) <= 90 ? [object.lng!, object.lat!] : undefined;
      add(object.name, { label: object.name, regionIds: [region.id], ...(center ? { center } : {}) });
    }
    if (!region.polityName || !region.owner || region.owner === 'neutral') continue;
    const key = normalize(region.polityName);
    maxWords = Math.max(maxWords, key.split(' ').length);
    if (countryOwners.has(key) && countryOwners.get(key) !== region.owner) { countries.set(key, null); continue; }
    countryOwners.set(key, region.owner);
    const prior = countries.get(key);
    if (!countries.has(key)) countries.set(key, { label: region.polityName, regionIds: [region.id] });
    else if (prior) prior.regionIds.push(region.id);
  }
  return { places, countries, maxWords };
}

function findPlace(text: string, index: EventLocationIndex, kind: 'places' | 'countries', locatedOnly = false): EventLocation | null {
  const places = index[kind];
  const words = normalize(text).split(' ');
  for (let i = 0; i < words.length; i++) {
    // Longest name wins: South Sudan must never resolve to Sudan.
    for (let length = Math.min(index.maxWords, words.length - i); length > 0; length--) {
      const key = words.slice(i, i + length).join(' ');
      if (index.places.has(key) || index.countries.has(key)) {
        const match = places.get(key);
        const prefix = words.slice(Math.max(0, i - 4), i).join(' ');
        const located = /(?:^| )(?:a|ad|in|nel|nella|nelle|nei|negli|sul|sulla|presso|verso|lungo|regione di|provincia di|citta di|territorio di|confine con)$/.test(prefix);
        if (match && (!locatedOnly || located)) return match;
        i += length - 1;
        break;
      }
    }
  }
  return null;
}

/** Prefer the named scene over the country acting there. Only the current
 * disclosed event is passed here; future events never influence the camera. */
export function resolveEventLocation(
  event: { headline: string; detail?: string } | null | undefined,
  index: EventLocationIndex,
): EventLocation | null {
  if (!event) return null;
  const lead = event.detail?.split(/[.!?\n]/, 1)[0] ?? '';
  return findPlace(event.headline, index, 'places')
    ?? findPlace(lead, index, 'places')
    ?? findPlace(`${event.headline}. ${lead}`, index, 'countries', true)
    ?? findPlace(event.headline, index, 'countries')
    ?? findPlace(lead, index, 'countries');
}
