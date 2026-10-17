import { describe, expect, it } from 'vitest';
import type { Region } from '../../types';
import { buildEventLocationIndex, resolveEventLocation } from './eventLocation';
import { eventCameraViewBox } from '../Map/mapFocus';

const region = (id: string, name: string, owner: string, polityName: string, objects: Region['objects'] = []): Region => ({
  id, name, owner, polityName, objects, color: '#777', population: 0, gdp: 0, militaryPower: 0,
  borders: [], status: 'stable', metadata: {},
});
const regions = [
  region('ug-w', 'Regione occidentale', 'UGA', 'Uganda', [{ id: 'city-k', type: 'city', name: 'Kasese', lng: 30.08, lat: .18 }]),
  region('ug-c', 'Regione centrale', 'UGA', 'Uganda', [{ id: 'city-c', type: 'capital', name: 'Kampala' }]),
  region('ru-c', 'Cecenia', 'RUS', 'Federazione Russa', [{ id: 'g', type: 'city', name: 'Grozny' }]),
  region('sd', 'Sudan', 'SDN', 'Sudan'),
  region('ss', 'Sud Sudan', 'SSD', 'Sud Sudan'),
];
const index = buildEventLocationIndex(regions);

describe('event camera uses disclosed canonical places', () => {
  it('follows the scene, not the foreign actor, with canonical city coordinates', () => {
    expect(resolveEventLocation({ headline: 'Uganda invia soccorsi', detail: 'A Kasese i convogli raggiungono gli sfollati. Kampala segue i lavori.' }, index))
      .toEqual({ label: 'Kasese', regionIds: ['ug-w'], center: [30.08, .18] });
    expect(resolveEventLocation({ headline: 'La Federazione Russa riprende Grozny' }, index)?.regionIds).toEqual(['ru-c']);
  });
  it('frames the whole country for a national event and handles overlapping names', () => {
    expect(resolveEventLocation({ headline: "L’Uganda ottiene una riduzione del debito" }, index)?.regionIds).toEqual(['ug-w', 'ug-c']);
    expect(resolveEventLocation({ headline: 'Il Sud Sudan apre i colloqui' }, index)?.regionIds).toEqual(['ss']);
    expect(resolveEventLocation({ headline: 'Uganda avvia colloqui in Sudan' }, index)?.regionIds).toEqual(['sd']);
  });
  it('does not mistake a substring or unknown location for a map target', () => {
    expect(resolveEventLocation({ headline: 'I sudanesi aprono i colloqui' }, index)).toBeNull();
    expect(resolveEventLocation({ headline: 'Accordo a Nuova Città' }, index)).toBeNull();
    expect(resolveEventLocation(null, index)).toBeNull();
  });
  it('does not guess between homonymous cities in different regions', () => {
    const ambiguous = buildEventLocationIndex([...regions, region('copy', 'Provincia', 'OTH', 'Altro paese', [{ id: 'k2', type: 'city', name: 'Kasese' }])]);
    expect(resolveEventLocation({ headline: 'Riunione a Kasese' }, ambiguous)).toBeNull();
  });
  it('supports old events with accents and uses only the current text', () => {
    const accented = buildEventLocationIndex([region('br', 'Brasile', 'BRA', 'Brasile', [{ id: 'sp', type: 'city', name: 'São Paulo' }])]);
    expect(resolveEventLocation({ headline: 'Manifestazione a SAO PAULO' }, accented)?.regionIds).toEqual(['br']);
    expect(resolveEventLocation({ headline: 'Il mondo entra nel nuovo millennio', detail: 'I sistemi informatici restano operativi.' }, index)).toBeNull();
  });
  it('keeps the SVG scene in the upper half, leaving ordinary camera requests unchanged', () => {
    expect(eventCameraViewBox('0 0 100 100', { regionId: 'r', requestId: 1, presentation: 'event' })).toBe('0 -30 100 240');
    expect(eventCameraViewBox('0 0 100 100', { regionId: 'r', requestId: 1 })).toBe('0 0 100 100');
  });
});
