/**
 * Finestra temporale delle sfide di pace: il client traduce i numeri del
 * motore (giorni trascorsi, giorni rimasti, priorità) in testo e toni. Nessuna
 * soglia è ricalcolata qui: se il motore non pubblica la finestra, la UI tace.
 */
import { describe, expect, it } from 'vitest';
import {
  PRESSURE_PRIORITY_LABEL,
  pressureWindowText,
  pressureWindowTone,
  splitPressuresByAttention,
} from './pressureWindow';

describe('GAMEPLAY-LONG — finestra delle sfide di pace', () => {
  it('descrive il tempo che resta con la data del motore', () => {
    expect(pressureWindowText({ daysElapsed: 30, daysLeft: 30, urgency: 'prossima' }))
      .toBe('Aperta da 30 giorni · restano 30.');
    expect(pressureWindowText({ daysElapsed: 1, daysLeft: 59, urgency: 'aperta' }))
      .toBe('Aperta da 1 giorno · restano 59.');
    expect(pressureWindowText({ daysElapsed: 0, daysLeft: 60, urgency: 'aperta' }))
      .toBe('Aperta ora: hai 60 giorni per rispondere.');
    expect(pressureWindowText({ daysElapsed: 50, daysLeft: 10, urgency: 'imminente' }))
      .toBe('Scade fra 10 giorni: decidi adesso.');
    expect(pressureWindowText({ daysElapsed: 61, daysLeft: 0, expired: true }))
      .toContain('Scaduta');
  });

  it('senza finestra non inventa nulla', () => {
    expect(pressureWindowText(undefined)).toBe('');
    expect(pressureWindowText(null)).toBe('');
    expect(pressureWindowTone(undefined)).toBe('');
  });

  it('il tono segue l’urgenza comunicata dal motore', () => {
    expect(pressureWindowTone({ urgency: 'aperta' })).toBe('positive');
    expect(pressureWindowTone({ urgency: 'imminente' })).toBe('warning');
    expect(pressureWindowTone({ urgency: 'prossima', escalationDue: true })).toBe('warning');
    expect(pressureWindowTone({ urgency: 'scaduta', expired: true })).toBe('negative');
  });

  it('ha un’etichetta per ogni priorità', () => {
    expect(PRESSURE_PRIORITY_LABEL.critica).toBeTruthy();
    expect(PRESSURE_PRIORITY_LABEL.rilevante).toBeTruthy();
    expect(PRESSURE_PRIORITY_LABEL.ordinaria).toBeTruthy();
  });

  it('P2: al massimo due questioni in evidenza, le altre restano nel dossier', () => {
    const pressures = [
      { id: 'a', highlighted: false, priority: 'ordinaria' },
      { id: 'b', highlighted: true, priority: 'critica' },
      { id: 'c', highlighted: true, priority: 'rilevante' },
      { id: 'd', highlighted: true, priority: 'critica' },
    ];
    const { highlighted, dossier } = splitPressuresByAttention(pressures);
    expect(highlighted.map(item => item.id)).toEqual(['b', 'c']);
    expect(dossier.map(item => item.id)).toEqual(['a', 'd']);
  });

  it('con la sola priorità mette in evidenza le critiche', () => {
    const pressures = [
      { id: 'a', priority: 'ordinaria' },
      { id: 'b', priority: 'critica' },
      { id: 'c', priority: 'rilevante' },
    ];
    const { highlighted, dossier } = splitPressuresByAttention(pressures);
    expect(highlighted.map(item => item.id)).toEqual(['b']);
    expect(dossier.map(item => item.id)).toEqual(['a', 'c']);
    expect(splitPressuresByAttention(null).highlighted).toEqual([]);
  });

  it('con payload vecchi (nessun campo) le sfide restano visibili, entro il tetto', () => {
    const two = splitPressuresByAttention([{ id: 'a' }, { id: 'b' }]);
    expect(two.highlighted.map(item => item.id)).toEqual(['a', 'b']);
    expect(two.dossier).toEqual([]);
    // Oltre il tetto, l'eccedenza resta nel dossier.
    const three = splitPressuresByAttention([{ id: 'a' }, { id: 'b' }, { id: 'c' }]);
    expect(three.highlighted.map(item => item.id)).toEqual(['a', 'b']);
    expect(three.dossier.map(item => item.id)).toEqual(['c']);
  });
});
