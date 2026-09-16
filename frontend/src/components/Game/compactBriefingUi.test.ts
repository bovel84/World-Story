/**
 * LW06.1 / MIGLIORIA 1 — briefing compatto percepibile senza aprire il Dossier.
 * Verifica la superficie (massimo voci, CTA) e l'assenza di duplicazione della
 * derivazione: `deriveStrategicBriefing` è chiamata una sola volta, in GameScreen.
 */
import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { compactBriefing, deriveStrategicBriefing } from './strategicBriefing';

const compact = fs.readFileSync(path.resolve(__dirname, 'CompactBriefing.tsx'), 'utf8');
const screen = fs.readFileSync(path.resolve(__dirname, 'GameScreen.tsx'), 'utf8');
const dock = fs.readFileSync(path.resolve(__dirname, 'NationDock.tsx'), 'utf8');

describe('LW06.1 — briefing compatto', () => {
  it('massimo 3 priorità per impostazione predefinita', () => {
    const briefing = deriveStrategicBriefing({
      account: { money: -1, monthlyBalance: -3, socialTension: 70, stability: 30 },
      ongoingProcesses: [{ id: 'x', title: 'Acciaieria', progress: 90 }],
    });
    const view = compactBriefing(briefing);
    expect(view.items.length).toBeLessThanOrEqual(3);
    expect(view.visible).toBe(true);
  });

  it('la CTA è «Apri dossier» e non introduce azioni complesse', () => {
    expect(compact).toContain('Apri dossier');
    expect(compact).toContain('onOpenDossier');
    expect(compact).not.toContain('Agisci');
  });

  it('la derivazione non è duplicata: una sola chiamata, in GameScreen', () => {
    const screenCalls = (screen.match(/deriveStrategicBriefing\(/g) || []).length;
    expect(screenCalls).toBe(1);
    expect(compact).not.toContain('deriveStrategicBriefing');
    expect(dock).not.toContain('deriveStrategicBriefing(');
    expect(screen).toContain('<CompactBriefing');
  });

  it('la striscia riusa la card completa del Dossier dallo stesso briefing', () => {
    expect(screen).toContain('briefing={briefing}');
    expect(dock).toContain('<StrategicBriefingCard briefing={briefing}');
  });
});
