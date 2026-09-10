import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const hudSource = fs.readFileSync(path.resolve(__dirname, 'HudBar.tsx'), 'utf8');
const timeDeskSource = fs.readFileSync(path.resolve(__dirname, 'TimeDesk.tsx'), 'utf8');
const timelinePanelSource = hudSource.slice(
  hudSource.indexOf('export const TimelinePanel'),
  hudSource.indexOf('// ============================================================================\n// Barra HUD'),
);

describe('G4-A — Tempo separato dalla Cronaca', () => {
  it('espone una CTA HUD Avanza e un desk dedicato', () => {
    expect(hudSource).toContain('hud-advance-btn');
    expect(hudSource).toContain('<TimeDesk');
    expect(timeDeskSource).toContain('Avanza il tempo');
    expect(timeDeskSource).toContain('Vai al prossimo evento importante');
  });

  it('mantiene la Timeline come cronaca read-only', () => {
    expect(hudSource).toContain('La cronaca è consultazione.');
    expect(timelinePanelSource).not.toContain('onTimeSkip');
  });

  it('rende espliciti ordini pronti e processi prima del salto', () => {
    expect(timeDeskSource).toContain('Ordini pronti');
    expect(timeDeskSource).toContain('Processi in corso');
    expect(timeDeskSource).toContain('pendingOrdersCount');
  });
});
