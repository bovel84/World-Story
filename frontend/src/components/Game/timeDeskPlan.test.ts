/**
 * LW03 — Il desk del tempo mostra il piano e una CTA esplicita, senza cambiare
 * la semantica: la CTA chiama lo stesso `onTimeSkip`, gli ordini restano
 * registrati a parte (nessuna nuova pipeline di turno).
 */
import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const frontend = path.resolve(__dirname, '..', '..', '..');
const timeDesk = fs.readFileSync(path.resolve(__dirname, 'TimeDesk.tsx'), 'utf8');
const hud = fs.readFileSync(path.resolve(__dirname, 'HudBar.tsx'), 'utf8');
const screen = fs.readFileSync(path.resolve(__dirname, 'GameScreen.tsx'), 'utf8');

describe('LW03 — Piano visibile prima dell’avanzamento', () => {
  it('il desk elenca gli ordini e offre «Esegui piano e avanza»', () => {
    expect(timeDesk).toContain('pendingOrders');
    expect(timeDesk).toContain('<h3>Piano</h3>');
    expect(timeDesk).toContain('Esegui piano e avanza');
  });

  it('la CTA usa il meccanismo di avanzamento già esistente', () => {
    expect(timeDesk).toContain('beginSkip(0)');
    expect(timeDesk).toContain('onTimeSkip(days)');
  });

  it('il piano arriva dagli ordini reali, non da uno stato duplicato', () => {
    expect(screen).toContain('pendingOrders={pendingActions.map');
    expect(hud).toContain('pendingOrders={pendingOrders}');
  });

  it('il pannello Timeline integra i delta del motore (LW02)', () => {
    const checkpointImpact = fs.readFileSync(path.resolve(__dirname, 'checkpointImpact.ts'), 'utf8');
    expect(checkpointImpact).toContain('deriveCheckpointImpact');
    expect(hud).toContain('impactsByTurn(history)');
    expect(frontend).toBeTruthy();
  });
});
