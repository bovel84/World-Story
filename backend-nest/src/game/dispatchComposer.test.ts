/**
 * Test-contratto dei dispacci contabili
 * =====================================
 * Difende la regola §5.11 della SPEC («contabilità ordinaria … non è una
 * svolta della cronaca») e la regola del prompt di simulazione («mai una cifra
 * di bilancio» in un titolo).
 *
 * Il test ha **guardie contro il falso verde** in ogni blocco: un parser rotto
 * che non riconosce più nessuna riga non deve far passare il test trovando zero
 * violazioni. Per questo ogni blocco verifica prima che le righe siano state
 * **riconosciute** (almeno N), e solo dopo che siano corrette.
 */
import { describe, it, expect } from 'vitest';
import {
  composeDispatch,
  composeDispatchLines,
  isComposedDispatch,
  type ComposedDispatch,
} from './dispatchComposer';

/** Le righe reali osservate in una partita (`backend-nest/data/world-story.db`). */
const RIGHE_REALI = [
  '🔬 Nuova tecnologia sbloccata: Agricoltura meccanizzata — produzione alimentare +35%.',
  '📜 Scadenza del debito — Debito ereditato 3 anni: 963.1 mld al 8% (scadenza 2029-01-20): rifinanziato al nuovo tasso.',
  '📜 Scadenza del debito — Debito ereditato 8 anni: 1284.2 mld al 8.4% (scadenza 2034-01-20): rifinanziato al nuovo tasso.',
  '📜 Scadenza del debito — Debito ereditato 15 anni: 963.1 mld al 8.9% (scadenza 2041-01-20): rifinanziato al nuovo tasso.',
  '🏛️ Governo — Lavoro e sindacati ha la maggiore influenza; Forze armate preme di più: riarmo: portare la spesa militare al 4% del pil.',
  '🏭 Magazzino nazionale: Tesoreria 39.2 mld, cibo 10/10, vestiario 4.4/4.4, armamenti 4/4, carburante 3.8/3.8, ricerca 1.4. Debito pubblico 3210.4 mld su 3 titoli (interessi 270.6 mld/anno; tetto di credito).',
  '📦 Magazzino al tetto: perduto food 1, clothing 2, weapons 2, fuel 1.3 (capacità di stoccaggio superata).',
  '⛏️ Estrazione risorse: 0.469 oil, 0.469 gas, 0.937 bauxite, 0.937 timber, 1.875 fertile_land, 1.875 fisheries, 1.406 water.',
];

const BULLETIN_REALE =
  'Quadro nazionale: Repubblica parlamentare; popolazione 59.024.477,2; PIL nominale stimato $2383,4 mld '
  + '(circa $40.380 pro capite). Bilancio mensile: entrate 18,4, uscite 9,9, saldo +8,5 (spesa militare 1,8% del PIL). '
  + 'Crescita annua 3.3%, stabilità 53/100. Riserve mobilitate: 0; sforzo bellico 30/100; tensione sociale 21/100.';

describe('composeDispatch — la contabilità ordinaria non è una notizia', () => {
  it('nessuna delle righe di contabilità ordinaria produce un dispaccio', () => {
    const ordinarie = RIGHE_REALI.filter(r => /^(⛏️|🏭|📦)/.test(r));
    // Guardia contro il falso verde: le righe devono essere quelle attese.
    expect(ordinarie.length).toBeGreaterThanOrEqual(3);

    for (const riga of ordinarie) {
      const esito = composeDispatch(riga);
      expect(isComposedDispatch(esito), `doveva restare fuori cronaca: ${riga}`).toBe(false);
    }
  });

  it('l\'estrazione di risorse è dichiarata routine, non nascosta', () => {
    const esito = composeDispatch(RIGHE_REALI[7]);
    expect(isComposedDispatch(esito)).toBe(false);
    if (!isComposedDispatch(esito)) expect(esito.reason).toBe('routine');
  });
});

describe('composeDispatch — le righe che SONO notizie', () => {
  it('produce un dispaccio per tecnologia, debito, governo, carenza e risorsa esaurita', () => {
    const campioni = [
      RIGHE_REALI[0], // tecnologia
      RIGHE_REALI[1], // debito
      RIGHE_REALI[4], // governo
      '⚠️ Carenza materiale — Carburante: deficit fino a 1.5 in 2 periodi su 3.',
      '🪫 Risorsa esaurita: oil — le produzioni che ne dipendevano perdono il bonus del giacimento.',
    ];
    // Guardia: tutti e cinque i tipi devono essere riconosciuti come notizia.
    const notizie = campioni.map(composeDispatch).filter(isComposedDispatch);
    expect(notizie.length).toBe(campioni.length);
  });

  it('il titolo non contiene mai una cifra di bilancio né la formula ripetuta', () => {
    const tutte = [...RIGHE_REALI, BULLETIN_REALE].map(composeDispatch).filter(isComposedDispatch);
    // Guardia: se il parser si rompesse, qui ci sarebbero zero titoli.
    expect(tutte.length).toBeGreaterThanOrEqual(4);

    for (const d of tutte as ComposedDispatch[]) {
      expect(d.title).not.toMatch(/Conti nazionali del periodo/i);
      expect(d.title).not.toMatch(/mld|PIL|pro capite/i);
      // Una cifra in un titolo è ammessa solo come anno (es. «nel 2029»).
      const cifre = d.title.match(/\d+/g) || [];
      for (const cifra of cifre) expect(cifra).toMatch(/^(19|20)\d{2}$/);
    }
  });

  it('il corpo è breve, in prosa, e non un elenco di indicatori', () => {
    const tutte = [...RIGHE_REALI, BULLETIN_REALE].map(composeDispatch).filter(isComposedDispatch);
    expect(tutte.length).toBeGreaterThanOrEqual(4);

    for (const d of tutte as ComposedDispatch[]) {
      expect(d.body.length).toBeGreaterThan(40);
      expect(d.body.length).toBeLessThan(420);
      expect(d.body).toMatch(/[.!?]$/);
    }
  });

  it('il quadro nazionale diventa una notizia di direzione, non un bollettino', () => {
    // Il bollettino arriva dal motore con l'emoji 📊 davanti.
    const esito = composeDispatch(`📊 ${BULLETIN_REALE}`);
    expect(isComposedDispatch(esito)).toBe(true);
    if (isComposedDispatch(esito)) {
      // Il titolo dice la direzione dei conti, non ripete le cifre.
      expect(esito.title).toMatch(/bilancio|conti/i);
      expect(esito.title).not.toMatch(/59\.|2383|40\.380/);
      // Il corpo traduce le cifre in un giudizio politico.
      expect(esito.body).toMatch(/saldo mensile/i);
    }
  });
});

describe('composeDispatchLines — una riga sola di verità', () => {
  it('separa notizie e contabilità, senza perdere nulla', () => {
    const narrativa = ['Lunga deriva'];
    const esito = composeDispatchLines(narrativa, RIGHE_REALI);

    // Guardia: le righe sono state tutte considerate.
    expect(esito.ledgerLines.length).toBe(RIGHE_REALI.length);
    expect(esito.dispatches.length + esito.ledgerOnly.length).toBe(RIGHE_REALI.length);

    // Le notizie sono quelle attese: tecnologia, tre debiti, governo, e la carenza.
    expect(esito.dispatches.length).toBeGreaterThanOrEqual(5);

    // La narrativa resta in testa, immutata.
    expect(esito.events[0]).toBe('Lunga deriva');
    // E la contabilità non è persa: vive nel riepilogo.
    for (const riga of RIGHE_REALI) expect(esito.events).toContain(riga);
  });

  it('un salto senza notizie non inventa dispacci', () => {
    const esito = composeDispatchLines([], [RIGHE_REALI[7]]); // solo estrazione
    expect(esito.dispatches.length).toBe(0);
    expect(esito.ledgerOnly.length).toBe(1);
  });
});
