/**
 * LW06.1 / MIGLIORIA 2 — il lettore del checkpoint mostra le variazioni reali
 * quando disponibili, senza attribuirle causalmente all'evento, e senza
 * cambiare la semantica di continue/intervene.
 */
import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { deriveImpactAtDate } from './checkpointImpact';

const reader = fs.readFileSync(path.resolve(__dirname, 'SimulationEventReader.tsx'), 'utf8');
const screen = fs.readFileSync(path.resolve(__dirname, 'GameScreen.tsx'), 'utf8');

describe('LW06.1 — SimulationEventReader: variazioni del periodo', () => {
  it('riceve l’impatto come dato di presentazione (nessuna nuova API)', () => {
    expect(reader).toContain('impact?: CheckpointImpact | null');
    expect(reader).toContain('impact = null');
    expect(screen).toContain('deriveImpactAtDate');
    expect(screen).toContain('impact={checkpointImpact}');
  });

  it('mostra gli effetti solo quando ci sono variazioni', () => {
    expect(reader).toContain('impact && impact.hasChanges');
    expect(reader).toContain('Variazioni registrate nel periodo');
  });

  it('usa una dicitura non causale', () => {
    expect(reader).not.toMatch(/ha causato|questo evento ha|ha provocato/i);
    expect(reader).toContain('non un giudizio di causa');
  });

  it('non cambia la semantica di continue/intervene', () => {
    expect(reader).toContain('onContinue');
    expect(reader).toContain('onIntervene');
    expect(reader).toContain('btn-continue-next');
    expect(reader).toContain('btn-intervene');
    expect(reader).toContain('playback.revision');
    expect(reader).toContain('playback.checkpointId');
  });

  it('non mostra effetti per un checkpoint senza punto storico alla data', () => {
    const history = [{ date: '1951-01-01', turn: 1, account: { money: 1 } }];
    expect(deriveImpactAtDate(history, '1951-09-09')).toBeNull();
  });
});
