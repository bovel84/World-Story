/**
 * H11 — I filoni del mondo nel dossier.
 *
 * Test-contratto sul sorgente (la convenzione del progetto: `environment: 'node'`,
 * niente render): legge `NationDock.tsx` e `widgets.tsx` e difende le invarianti.
 *
 *  - H-I1 una cifra un posto: il blocco dei filoni **non mostra numeri** (nessuna
 *    cifra di bilancio, nessuna percentuale) — è significato, non dati;
 *  - i filoni stanno in un blocco **leggibile**, non in un richiudibile (l'invariante
 *    del dossier: un blocco che agisce non si chiude; qui è lettura, ma resta visibile);
 *  - il blocco non si rende quando non ci sono filoni (zero è valido, H-I6).
 */
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

const read = (rel: string) => fs.readFileSync(path.resolve(__dirname, rel), 'utf8');
const dock = read('NationDock.tsx');
const widgets = read('NationDock/widgets.tsx');

describe('H11 — il blocco dei filoni nel dossier', () => {
  it('il dossier monta «Filoni del mondo» con la lista', () => {
    expect(dock).toContain('title="Filoni del mondo"');
    expect(dock).toContain('<StorylinesList storylines={props.storylines} />');
    expect(dock).toContain("from './NationDock/widgets'");
    // guardia contro il falso verde: la riga deve essere davvero presente
    expect((dock.match(/Filoni del mondo/g) ?? []).length).toBe(1);
  });

  it('non si rende quando non ci sono filoni (zero è valido)', () => {
    expect(dock).toMatch(/props\.storylines && props\.storylines\.length > 0/);
  });

  it('dichiara che sono contesto, non dati del motore', () => {
    expect(dock).toContain('Non sono dati del motore');
  });

  it('il widget non mostra cifre: nessun numero di bilancio nel blocco dei filoni', () => {
    // Isola il corpo di StorylinesList.
    const start = widgets.indexOf('export function StorylinesList');
    expect(start).toBeGreaterThan(0);
    const body = widgets.slice(start, widgets.indexOf('\n}', start));
    // Nessun uso di formattatori numerici né di unità monetarie.
    for (const forbidden of ['formatNumber', 'formatPercent', 'formatMld', 'money(', 'mld', '%']) {
      expect(body, `il blocco dei filoni non deve contenere «${forbidden}»`).not.toContain(forbidden);
    }
  });

  it('mostra la direzione come tendenza, senza promettere un esito', () => {
    expect(widgets).toContain('storyline-trajectory');
    expect(widgets).toContain('Direzione');
  });

  it('il dossier non ha richiuso il blocco dei filoni in un <details>', () => {
    // Guardia D07/V02 generalizzata: il blocco visibile non deve finire in un richiudibile.
    const blockStart = dock.indexOf('title="Filoni del mondo"');
    const before = dock.slice(0, blockStart);
    const lastDetails = before.lastIndexOf('<details');
    const lastClose = before.lastIndexOf('</details>');
    // Nessun `<details>` prima del blocco → non è dentro un richiudibile (caso buono).
    if (lastDetails !== -1) expect(lastDetails).toBeLessThan(lastClose);
  });
});
