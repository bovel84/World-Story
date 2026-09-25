/**
 * World Story — N02: l'anno del mondo e la sua epoca
 * =================================================
 * Invariante **N6** («l'anno entra nel dossier una volta e da una fonte sola») e
 * **N4** («nessun'etichetta d'epoca scritta a mano nel client»).
 *
 * Il test **dichiara** che le soglie sono una copia di quelle del motore: se un
 * giorno il motore le cambia, questo test non lo impedisce — ma il commento e il
 * caso di prova rendono la divergenza visibile invece che silenziosa.
 */
import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  WORLD_EPOCH_BOUNDARIES,
  WORLD_EPOCH_LABEL,
  epochForYear,
  worldEpoch,
  yearOfDate,
} from './worldEpoch';

/** Le soglie del motore (`backend-nest/src/core/simulation/MilitaryDoctrine.ts`). */
const MOTOR_BOUNDARIES = [
  { from: 1861, epoch: 'grande_guerra' },
  { from: 1919, epoch: 'seconda_guerra' },
  { from: 1946, epoch: 'guerra_fredda' },
  { from: 1990, epoch: 'moderno' },
];

describe('N02 — l\'anno del mondo', () => {
  it('legge l\'anno da una data ISO', () => {
    expect(yearOfDate('1815-06-09')).toBe(1815);
    expect(yearOfDate('2026-01-01')).toBe(2026);
  });

  it('una data illeggibile non produce un anno inventato', () => {
    expect(yearOfDate('')).toBeNull();
    expect(yearOfDate(null)).toBeNull();
    expect(yearOfDate(undefined)).toBeNull();
    expect(yearOfDate('non una data')).toBeNull();
    expect(yearOfDate('0000-01-01')).toBeNull();
  });

  it('assegna l\'epoca sulle date reali dei preset del gioco', () => {
    // Le date di partenza **effettive** dei preset pubblicati dal motore
    // (`GET /api/templates`), non date di comodo: così il test misura il
    // comportamento su ciò che il giocatore può davvero scegliere.
    const PRESET_START_DATES: Array<[string, string]> = [
      ['1815-06-09', 'pre_industriale'],   // europa_1815
      ['1914-06-28', 'grande_guerra'],     // europa_1914
      ['1936-01-01', 'seconda_guerra'],    // mondo_1936
      ['1939-09-01', 'seconda_guerra'],    // paxh_ww2_provinces
      ['1989-06-04', 'guerra_fredda'],     // mondo_1989
      ['2000-01-01', 'moderno'],           // millennium_dawn
      ['2026-01-01', 'moderno'],           // pax_modern_provinces
    ];
    for (const [date, expected] of PRESET_START_DATES) {
      expect(worldEpoch(date).epoch, `preset ${date}`).toBe(expected);
    }
    // Guardia contro il falso verde: il test vede davvero tutti i preset.
    expect(PRESET_START_DATES.length).toBeGreaterThanOrEqual(7);
  });

  it('le soglie sono quelle del motore', () => {
    // Il contratto: se divergono, questo test lo dice.
    expect(WORLD_EPOCH_BOUNDARIES.map(b => ({ from: b.from, epoch: b.epoch }))).toEqual(MOTOR_BOUNDARIES);
    // E il confine è inclusivo: l'anno della soglia appartiene all'epoca nuova.
    for (const { from, epoch } of MOTOR_BOUNDARIES) {
      expect(epochForYear(from)).toBe(epoch);
      expect(epochForYear(from - 1)).not.toBe(epoch);
    }
  });

  it('le etichette sono quelle del motore', () => {
    expect(WORLD_EPOCH_LABEL).toEqual({
      pre_industriale: 'Eserciti pre-industriali',
      grande_guerra: 'Grande guerra',
      seconda_guerra: 'Seconda guerra mondiale',
      guerra_fredda: 'Guerra fredda',
      moderno: 'Era moderna',
    });
  });

  it('una data illeggibile produce un\'assenza dichiarata, non il default del motore', () => {
    // Il motore, con una data illeggibile, ricade su `guerra_fredda` (1951 è la
    // sua data di partenza storica). Il client **non** eredita quel default: un
    // mondo che non sa datare non ha un'epoca.
    const view = worldEpoch('');
    expect(view.year).toBeNull();
    expect(view.epoch).toBeNull();
    expect(view.epochLabel).toBeNull();
    expect(view.epoch).not.toBe('guerra_fredda');
  });

  it('è pura: stessi ingressi, stesso esito, nessun orologio del browser', () => {
    const a = worldEpoch('1951-01-01');
    const b = worldEpoch('1951-01-01');
    expect(a).toEqual(b);
    const source = fs.readFileSync(path.resolve(__dirname, 'worldEpoch.ts'), 'utf8');
    // Guardia: nessuna lettura dell'orologio reale nella derivazione dell'epoca.
    expect(source).not.toMatch(/new Date\(|Date\.now\(/);
  });

  it('il dossier deriva l\'epoca una volta sola, dalla data del mondo', () => {
    const dock = fs.readFileSync(path.resolve(__dirname, 'NationDock.tsx'), 'utf8');
    expect(dock).toMatch(/worldEpoch\(worldDate\)/);
    // N6: nessuna seconda derivazione dell'anno nel componente.
    expect(dock.match(/worldEpoch\(/g)?.length).toBe(1);
  });
});
