/**
 * World Story — N03/N04: ogni cifra dice di che unità è
 * =====================================================
 * Invarianti **N1** («una cifra dichiara la sua unità») e **N2** («l'unità
 * dichiarata è vera»).
 *
 * Il difetto misurato: nel dossier la stringa `'mld'` era ricopiata in **36**
 * punti e ogni importo si leggeva «12,40 mld» senza dire di che cosa; l'unico
 * simbolo di valuta di tutta l'interfaccia era un `$` sul PIL pro capite, che
 * faceva passare il **dollaro del 2026** per la moneta del paese — anche in una
 * partita del 1815.
 *
 * Questo è un test-contratto sul **sorgente**, come `nationDockSingleSource`: le
 * cifre e le etichette sono dati nel testo dei componenti, quindi si verificano
 * con `fs` + regex. `environment: 'node'`, nessun render.
 */
import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { MONEY_UNIT, MONEY_UNIT_NOTE, index, money } from './NationDock/format';

const read = (rel: string) => fs.readFileSync(path.resolve(__dirname, rel), 'utf8');

/** I file del dossier che formattano denaro. */
const DOSSIER_FILES = [
  'NationDock.tsx',
  'NationDock/widgets.tsx',
  'NationDock/useNationDockModel.ts',
  'NationDock/format.ts',
  'nationalOperatingPicture.ts',
  'economyOperatingPicture.ts',
  'governmentDossier.ts',
];

describe('N03 — una sola unità di conto, dichiarata una volta', () => {
  it('l\'unità vive in un punto solo', () => {
    expect(MONEY_UNIT).toBe('mld');
    expect(MONEY_UNIT_NOTE).toContain(MONEY_UNIT);
  });

  it('l\'helper forma il denaro con l\'unità', () => {
    expect(money(12.4)).toBe('12,40 mld');
    expect(money(-2.1, 2, { sign: true })).toBe('−2,10 mld');
    expect(money(null)).toBe('—');
  });

  it('l\'helper per gli indici NON aggiunge una valuta', () => {
    // Guardia contro il falso verde: se `index` aggiungesse «mld», pesi e
    // quote diventerebbero denaro.
    expect(index(56.4)).toBe('56,4');
    expect(index(-3, 0, { sign: true })).toBe('−3');
    expect(index(56.4)).not.toContain('mld');
  });

  it('nessun file del dossier ricopia più la stringa dell\'unità', () => {
    const offenders: string[] = [];
    for (const file of DOSSIER_FILES) {
      const source = read(`./${file}`);
      // L'unità può comparire come valore di MONEY_UNIT (una volta), ma non
      // ricopiata dentro una chiamata di formattazione.
      const copies = source.match(/currency:\s*'mld'/g) ?? [];
      if (copies.length > 0) offenders.push(`${file}: ${copies.length}`);
    }
    expect(offenders).toEqual([]);
  });

  it('il simbolo del dollaro non esiste più nel dossier', () => {
    const offenders: string[] = [];
    for (const file of DOSSIER_FILES) {
      if (/currency:\s*'\$'/.test(read(`./${file}`))) offenders.push(file);
    }
    expect(offenders).toEqual([]);
  });

  it('i blocchi che mostrano denaro dichiarano l\'unità nella descrizione', () => {
    // Guardia contro il falso verde: i blocchi con denaro sono davvero molti.
    // Le cifre di denaro vivono sia nel dock sia nella scheda viva: si contano
    // insieme, altrimenti il solo spostamento di una card farebbe scattare
    // l'allarme senza che nulla sia cambiato.
    const count = (pattern: RegExp) => DOSSIER_FILES
      .map(file => read(`./${file}`).match(pattern)?.length ?? 0)
      .reduce((total, value) => total + value, 0);
    expect(count(/formatMoney\(|money\(|formatBillions\(/g)).toBeGreaterThan(15);
    expect(count(/MONEY_UNIT_NOTE/g)).toBeGreaterThanOrEqual(7);
  });
});

describe('N04 — il confine del denaro è dichiarato', () => {
  it('il PIL pro capite non si presenta più come la moneta del paese', () => {
    // Il PIL pro capite è nella scheda viva «Stato nazionale»: la cifra resta,
    // ma si dichiara per quello che è — una stima in dollari di oggi.
    const live = read('./LiveNationalDossier.tsx');
    expect(live).toMatch(/gdpPerCapitaUsd/);
    expect(live).toMatch(/dollari di oggi/);
    const dock = read('./NationDock.tsx');
    expect(dock).not.toMatch(/label="PIL pro capite"/);
  });

  it('il modulo che spiega i costi dichiara la scala del catalogo', () => {
    // `formatBillions` converte milioni in miliardi: la scala va detta, perché
    // il motore pubblica il catalogo in milioni di USD.
    const fmt = read('./NationDock/format.ts');
    expect(fmt).toMatch(/milioni/);
    expect(fmt).toMatch(/MONEY_UNIT/);
  });
});
