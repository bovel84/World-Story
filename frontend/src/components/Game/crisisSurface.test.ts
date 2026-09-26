/**
 * V02 — la crisi in superficie, e cosa può stare in un richiudibile
 * ==================================================================
 * Conseguenza diretta di V01. Chiusa la questione delle sfide, nel dossier
 * restavano due cose dietro un `<summary>`: la **crisi** e gli impegni. Ma la
 * crisi non è dettaglio: sono le tre strade del collasso, cioè la cosa più
 * grave che può capitare alla partita. Tenerla chiusa significava che la notizia
 * peggiore del dossier era anche la meno visibile.
 *
 * Questo file difende due regole:
 *  1. **La crisi sta in superficie**, sotto gli indicatori che la determinano.
 *  2. **In un richiudibile non va un blocco che agisce.** Un richiudibile
 *     conviene solo alla cronaca (gli impegni, il quadro d'insieme): chi ha
 *     qualcosa da *fare* non deve prima aprirlo. È la generalizzazione della
 *     guardia di D07, che proteggeva il solo `ObjectsBoard`.
 *
 * Come i test-contratto del dossier, legge il **sorgente con `fs` + regex** e ha
 * guardie contro il falso verde: se il parser non trovasse i blocchi, il test
 * fallisce invece di passare a vuoto.
 */
import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const read = (...parts: string[]): string =>
  fs.readFileSync(path.resolve(__dirname, ...parts), 'utf8');

const SOURCE = read('NationDock.tsx');

/** Il corpo della sola sezione «Situazione». */
function situazioneSection(source: string): string {
  const start = source.indexOf("{active === 'situazione'");
  expect(start, 'sezione «situazione» non trovata: il parser è rotto').toBeGreaterThan(-1);
  const next = source.indexOf("{active === 'governo'", start);
  return source.slice(start, next > start ? next : source.length);
}

const SITUAZIONE = situazioneSection(SOURCE);
/** I richiudibili della Situazione (con il loro contenuto). */
const DETAILS = [...SITUAZIONE.matchAll(/<details[\s\S]*?<\/details>/g)].map(m => m[0]);

describe('V02 — la crisi sta in superficie', () => {
  it('«Crisi della nazione» è un blocco visibile, non un richiudibile', () => {
    expect(
      SITUAZIONE,
      'la crisi non deve stare dietro un `<details>`',
    ).toMatch(/title="Crisi della nazione"/);
    for (const block of DETAILS) {
      expect(block, 'la crisi è la cosa più grave del dossier: deve stare in vista')
        .not.toMatch(/<CrisisBlock/);
      expect(block, 'la card della crisi non va richiusa').not.toMatch(/Crisi della nazione/);
    }
  });

  it('la guardia vede davvero la sezione e i suoi richiudibili', () => {
    // Contro il falso verde: la sezione è grande, e i richiudibili sono quelli
    // attesi (impegni e quadro d'insieme), non zero.
    expect(SITUAZIONE.length).toBeGreaterThan(2000);
    expect(SITUAZIONE).toMatch(/NationalSynthesisPanel/);
    expect(DETAILS.length, 'i richiudibili della Situazione sono spariti dal parser').toBeGreaterThan(0);
    for (const block of DETAILS) {
      // Un richiudibile lecito contiene solo letture, mai azioni.
      expect(
        block,
        'un blocco che agisce non va chiuso in un `<details>`: chi ha qualcosa da fare non deve aprirlo',
      ).not.toMatch(/<ObjectsBoard|<PressuresBlock|<CrisisBlock|nation-decision-ack/);
    }
  });

  it('l’ordine di apertura è: sintesi → indicatori → crisi', () => {
    const synthesis = SITUAZIONE.indexOf('<NationalSynthesisPanel');
    const indicators = SITUAZIONE.indexOf('title="Indicatori di tenuta"');
    const crisis = SITUAZIONE.indexOf('title="Crisi della nazione"');
    expect(synthesis).toBeGreaterThan(-1);
    expect(indicators).toBeGreaterThan(-1);
    expect(crisis).toBeGreaterThan(-1);
    expect(synthesis, 'la sintesi deve precedere gli indicatori (I3)').toBeLessThan(indicators);
    expect(indicators, 'gli indicatori spiegano la crisi: vengono prima').toBeLessThan(crisis);
  });

  it('non c’è più nessun blocco interattivo nei richiudibili del dossier', () => {
    // La regola V4 del piano: nel dossier, zero eccezioni dichiarate. Era
    // l'eccezione di D05 (le sfide) e la crisi: ora nessuna delle due.
    const allDetails = [...SOURCE.matchAll(/<details[\s\S]*?<\/details>/g)].map(m => m[0]);
    expect(allDetails.length, 'il dossier non ha più richiudibili? il parser è rotto').toBeGreaterThan(0);
    for (const block of allDetails) {
      expect(block, 'residuo interattivo in un richiudibile').not.toMatch(
        /<ObjectsBoard|<PressuresBlock|<CrisisBlock|nation-decision-ack/,
      );
    }
    // Il quadro d'insieme resta un richiudibile: naviga, non agisce (I5).
    expect(SOURCE).toMatch(/Quadro d&apos;insieme per dominio/);
  });
});
