import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import type { OperatingObjectPayload, OperatingPicturePayload } from '../../services/api';
import {
  UnitActionPanel,
  confirmedUnitPanelCommand,
  unitPanelCommand,
} from './UnitActionPanel';

const unitObject: OperatingObjectPayload = {
  id: 'ita-1', kind: 'unit', label: 'ITA 1° Reparto', status: 'operational', statusLabel: 'Operativo',
  parentId: 'army-ita', regionId: 'ROM', regionName: 'Roma', facts: [], problems: [],
  actions: [
    { id: 'reinforce_unit', label: 'Rinforza', enabled: true },
    { id: 'transfer_unit', label: 'Trasferisci', enabled: true },
    { id: 'reassign_unit', label: 'Cambia armata', enabled: false, blockedReason: 'Nessuna armata disponibile.' },
    { id: 'order_attack', label: 'Attacca', enabled: true },
  ],
};
const picture: OperatingPicturePayload = {
  objects: [
    unitObject,
    { ...unitObject, id: 'target', kind: 'facility', label: 'Bologna', parentId: null, regionId: 'BOL', regionName: 'Bologna', actions: [] },
  ],
  chains: [], counts: {}, conventions: [],
};

describe('MAP P4 — shared UnitActionPanel command authority', () => {
  it('uses the same exact action payload for dry-run and confirmation', () => {
    const preview = unitPanelCommand({ actionId: 'reinforce_unit', unitId: 'ita-1', dryRun: true });
    expect(preview).toEqual({ kind: 'action', request: { action: 'reinforce', unitId: 'ita-1', dryRun: true } });
    expect(confirmedUnitPanelCommand(preview)).toEqual({
      kind: 'action', request: { action: 'reinforce', unitId: 'ita-1', dryRun: false },
    });
  });

  it('does not calculate transfer paths: it sends only the engine target', () => {
    const preview = unitPanelCommand({ actionId: 'transfer_unit', unitId: 'ita-1', target: 'BOL', dryRun: true });
    expect(preview).toEqual({
      kind: 'action', request: { action: 'transfer', unitId: 'ita-1', regionId: 'BOL', dryRun: true },
    });
    expect(JSON.stringify(preview)).not.toContain('path');
    expect(JSON.stringify(preview)).not.toContain('estimatedArrivalDate');
  });

  it('uses the existing unit order endpoint contract', () => {
    const preview = unitPanelCommand({ actionId: 'order_attack', unitId: 'ita-1', dryRun: true });
    expect(preview).toEqual({ kind: 'order', request: { unitId: 'ita-1', order: 'attack', dryRun: true } });
    expect(confirmedUnitPanelCommand(preview)).toEqual({
      kind: 'order', request: { unitId: 'ita-1', order: 'attack', dryRun: false },
    });
  });

  it('renders only engine-published actions and keeps blocked reasons visible', () => {
    const html = renderToStaticMarkup(<UnitActionPanel object={unitObject} picture={picture} />);
    expect(html).toContain('Rinforza');
    expect(html).toContain('Trasferisci');
    expect(html).toContain('Attacca');
    expect(html).toContain('Nessuna armata disponibile.');
    expect(html).not.toContain('Crea reparto qui');
  });
});
