/**
 * World Story — N08: igiene delle date
 * ====================================
 * Due difetti, entrambi della famiglia «un dato inventato al posto di un dato
 * mancante»:
 *
 *  1. la HUD mostrava `'1951-01-01'` come fallback: in uno scenario del 1815 o
 *     del 2026, finché il gioco non pubblicava la sua data, la barra mostrava
 *     il 1° gennaio 1951;
 *  2. il Dossier aveva una **seconda** copia di `formatDate`, identica nella
 *     regola e diversa solo nel fallback: due copie della stessa regola
 *     divergono.
 */
import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { formatDate, formatDateOr } from '../../utils/format';
import { NO_WORLD_DATE, formatDateCompact, formatDateIt } from './HudBar';

const read = (rel: string) => fs.readFileSync(path.resolve(__dirname, rel), 'utf8');

describe('N08 — nessuna data del 1951 inventata', () => {
  it('la HUD dichiara l\'assenza quando il mondo non ha una data', () => {
    expect(formatDateIt('')).toBe(NO_WORLD_DATE);
    expect(formatDateCompact('')).toBe(NO_WORLD_DATE);
    expect(formatDateIt('non una data')).toBe(NO_WORLD_DATE);
  });

  it('la HUD forma le date reali come prima', () => {
    // Guardia contro il falso verde: la funzione continua a funzionare.
    expect(formatDateIt('1951-01-04')).toBe('4 gennaio 1951');
    expect(formatDateCompact('1951-01-04')).toBe('04/01/1951');
  });

  it('il fallback 1951 non esiste più nel codice del gioco', () => {
    // La HUD è l'unico punto dove era **visibile a schermo**; nello storico del
    // salto temporale resta un default di periodStart, che non è una data
    // mostrata come «adesso». Il controllo è sulla HUD.
    const screen = read('./GameScreen.tsx');
    expect(screen).not.toMatch(/currentDate \|\| '1951-01-01'/);
  });
});

describe('N08 — una sola implementazione della data breve', () => {
  it('il Dossier non riscrive la regola: la importa', () => {
    const dossierFormat = read('./NationDock/format.ts');
    // Nessuna seconda lista di mesi, nessuna seconda regex: la regola è una.
    expect(dossierFormat).not.toMatch(/gen', 'feb'/);
    expect(dossierFormat).not.toMatch(/\(\?<|\\d\{4\}\)-\\d\{2\}/);
    expect(dossierFormat).toMatch(/formatDateOr/);
  });

  it('il fallback è un parametro: ogni chiamante dichiara il proprio', () => {
    expect(formatDateOr('1951-01-04', '—')).toBe('4 gen 1951');
    expect(formatDateOr('', 'Data non pubblicata')).toBe('Data non pubblicata');
    // Una stringa non-ISO si restituisce com'è: non si maschera un dato
    // parziale con un fallback, perché sarebbe una perdita di informazione.
    expect(formatDateOr('circa 1951', '—')).toBe('circa 1951');
  });

  it('la funzione condivisa conserva il comportamento storico', () => {
    expect(formatDate('1951-01-04')).toBe('4 gen 1951');
    expect(formatDate(null)).toBe('—');
  });
});
