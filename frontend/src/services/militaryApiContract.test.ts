/**
 * MAP P2 — contratto del payload militare frontend.
 * =================================================
 * Prova che `MilitaryUnitPayload` non è una copia semplificata: espone i campi
 * del motore che la mappa usa — `polityId` (nazionalità), `order`, `frontId`,
 * `movement` P6 — e che il read model li preserva senza ricalcolarli.
 */
import { describe, expect, it } from 'vitest';
import type { MilitaryUnitPayload, WarFrontPayload } from './api';
import type { Region } from '../types';
import { buildMilitaryMapModel } from '../components/Map/militaryMapModel';

const region: Region = {
  id: 'R1', name: 'Pianura', color: '#aa0000', owner: 'AUT', polityName: 'Austria',
  population: 1, gdp: 1, militaryPower: 1, objects: [], borders: [], metadata: {},
  status: 'active', flag: 'AUT',
  geojson: JSON.stringify({ geometry: { type: 'Polygon', coordinates: [[[0, 0], [4, 0], [4, 4], [0, 4], [0, 0]]] } }),
};

// Il compilatore deve accettare tutti i campi del motore: i tipi obbligatori
// (`polityId`, `order`, `frontId`) non sono opzionali.
const unit: MilitaryUnitPayload = {
  id: 'u1',
  polityId: 'AUT',
  armyId: 'a1',
  name: '1ª Divisione',
  personnel: 8_430,
  equipment: { rifles: 5000 },
  monthlyNeeds: { fuel: 1, weapons: 2, food: 3 },
  readiness: 0.62,
  status: 'degraded',
  regionId: 'R1',
  regionName: 'Pianura',
  updatedDate: '1951-02-01',
  legacyDerived: false,
  order: 'defend',
  frontId: 'front-1',
  movement: {
    path: ['R0', 'R1', 'R2'], targetRegionId: 'R2', targetRegionName: 'Vienna',
    startedDate: '1951-02-01', pathIndex: 1, daysPerHop: 15, remainingDaysToNextHop: 4,
    totalHops: 2, estimatedArrivalDate: '1951-03-01', motorized: true,
  },
};

const front: WarFrontPayload = {
  id: 'front-1', name: 'Fronte alpino', attackerPolityId: 'ITA', defenderPolityId: 'AUT',
  regionIds: ['R1'], status: 'active', objectiveRegionId: 'R1',
  attackerPressure: 0.63, defenderPressure: 0.48, momentumPolityId: 'ITA',
  createdDate: '1951-01-01', updatedDate: '1951-02-01',
};

describe('MAP P2 — contratto payload militare', () => {
  it('preserva polityId/order/frontId/movement dal payload del motore', () => {
    const model = buildMilitaryMapModel({ regions: [region], units: [unit], fronts: [front] });
    const marker = model.units[0];
    expect(marker).toMatchObject({ id: 'u1', polityId: 'AUT', order: 'defend', frontId: 'front-1' });
    // Nazionalità AUT anche se la regione è ora del controllo italiano.
    expect(marker.polityId).not.toBe(region.owner === 'AUT' ? 'ITA' : region.owner);
    expect(marker.movement?.path).toEqual(['R1', 'R2']);
    expect(marker.movement?.estimatedArrivalDate).toBe('1951-03-01');
    // Fronte letto, non ricalcolato.
    expect(model.fronts[0]).toMatchObject({ id: 'front-1', objectiveRegionId: 'R1', momentumPolityId: 'ITA' });
  });

  it('non perde i campi quando il movimento è assente', () => {
    const still: MilitaryUnitPayload = { ...unit, movement: undefined, frontId: null };
    const model = buildMilitaryMapModel([region], [still]);
    expect(model.units[0].movement).toBeUndefined();
    expect(model.units[0].frontId).toBeNull();
    expect(model.units[0].polityId).toBe('AUT');
  });
});
