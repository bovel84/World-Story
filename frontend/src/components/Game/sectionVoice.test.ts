/**
 * V04/V05 — la voce delle sezioni e l'unicità delle definizioni
 * =============================================================
 * Due chiusure del piano «dossier stile Victoria 3».
 *
 * V04: ogni sezione densa dice che cosa contiene. Otto schede con un titolo
 * bastavano a orientarsi; quattro sezioni grandi no: «Regno» e «Tesoro» non
 * dicono da soli che cosa c'è dentro, e una voce di una riga evita che il
 * giocatore debba aprirle per saperlo. Situazione è esclusa: apre già con la
 * sintesi (I3), e una voce sopra il giudizio sarebbe rumore.
 *
 * V05: `ActiveModule` e `RailItem` erano dichiarati due volte — qui e nelle
 * loro fonti canoniche. Due elenchi paralleli degli stessi moduli: aggiungerne
 * uno richiedeva di ricordarsi di entrambe. Ora c'è una sola definizione.
 *
 * Test-contratto: legge il sorgente con `fs` + regex, con guardie contro il
 * falso verde (il file deve essere grande, le voci devono essere trovate).
 */
import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const read = (...parts: string[]): string =>
  fs.readFileSync(path.resolve(__dirname, ...parts), 'utf8');

const DOCK = read('NationDock.tsx');
const RAIL = read('../Shell/CommandRail.tsx');
const STORE = read('../../stores/moduleState.ts');

/** Il corpo di una sezione (dalla sua guardia alla successiva). */
function section(source: string, name: string): string {
  const start = source.indexOf(`{active === '${name}' && (`);
  expect(start, `sezione «${name}» non trovata`).toBeGreaterThan(-1);
  const next = source.indexOf("{active === '", start + 10);
  return source.slice(start, next > start ? next : source.length);
}

describe('V04 — ogni sezione densa dice che cosa contiene', () => {
  it('Regno, Tesoro e Stato maggiore aprono con una voce', () => {
    for (const name of ['regno', 'tesoro', 'statoMaggiore']) {
      expect(section(DOCK, name), `«${name}» non ha una voce di sezione`)
        .toContain('className="nation-section-voice"');
    }
    // Guardia contro il falso verde: le tre sezioni esistono e sono grandi.
    expect(section(DOCK, 'regno').length).toBeGreaterThan(1000);
    expect(section(DOCK, 'tesoro').length).toBeGreaterThan(1000);
    expect(section(DOCK, 'statoMaggiore').length).toBeGreaterThan(1000);
  });

  it('la voce è solo testo: nessuna cifra, nessuna azione', () => {
    // Una voce che contenesse un numero o un bottone sarebbe una card travestita.
    for (const name of ['regno', 'tesoro', 'statoMaggiore']) {
      const voice = /className="nation-section-voice">([^<]+)</.exec(section(DOCK, name));
      expect(voice, `voce di «${name}» non parsata`).not.toBeNull();
      expect(voice![1], `la voce di «${name}» contiene cifre`).not.toMatch(/\d/);
    }
  });

  it('Situazione non ha una voce: apre con la sintesi (I3)', () => {
    const situ = section(DOCK, 'situazione');
    expect(situ).not.toContain('nation-section-voice');
    expect(situ.indexOf('<NationalSynthesisPanel')).toBeLessThan(situ.indexOf('title="Indicatori di tenuta"'));
  });

  it('Tesoro è diviso in due gruppi tipografici, non in due schede', () => {
    const tesoro = section(DOCK, 'tesoro');
    expect(tesoro).toContain('className="nation-group-head"');
    expect(tesoro).toContain('Denaro');
    expect(tesoro).toContain('Materie, industria e cantieri');
    // Le schede restano quattro: i gruppi sono intestazioni `<h3>`, non sezioni.
    expect(DOCK).not.toMatch(/active === 'denaro'|active === 'materie'/);
  });
});

describe('V05 — una sola definizione per tipo', () => {
  it('`ActiveModule` è dichiarato una volta sola (nello store)', () => {
    expect(STORE).toMatch(/export type ActiveModule =/);
    expect(RAIL, 'CommandRail ri-dichiara ActiveModule: seconda verità').not.toMatch(/export type ActiveModule =/);
    expect(RAIL, 'CommandRail deve importare il tipo canonico').toMatch(/import type \{ ActiveModule \} from '\.\.\/\.\.\/stores\/moduleState'/);
  });

  it('`RailItem` è dichiarato una volta sola (nel contesto di gioco)', () => {
    expect(RAIL, 'CommandRail ri-dichiara RailItem: seconda verità').not.toMatch(/export interface RailItem/);
    expect(RAIL).toMatch(/import type \{ RailItem \} from '\.\.\/Game\/nationalContext'/);
  });

  it('il dossier non riceve più le props inerte delle sfide', () => {
    const types = read('NationDock/types.ts');
    // `pressures` resta: serve alla sintesi (la lista unica le elenca).
    expect(types).toMatch(/pressures\?: PeacetimePressure/);
    // Le tre che non servivano più sono uscite dalla firma.
    expect(types, '`recentPressures` è inerte: non deve restare nel contratto').not.toMatch(/recentPressures\?:/);
    expect(types, '`onResolvePressure` è inerte').not.toMatch(/onResolvePressure\?:/);
    expect(types, '`pressureBusy` è inerte').not.toMatch(/pressureBusy\?:/);
  });
});
