import { defineConfig } from 'vitest/config';

/**
 * Configurazione dei test backend.
 *
 * **Perché esiste.** Le suite che toccano il database importano `src/database`
 * in `beforeAll`, e quell'import esegue le migrazioni dello schema. Su una
 * macchina scarica è questione di millisecondi; su una macchina di CI carica
 * sfonda i **10 secondi** che vitest usa come default, e il test fallisce con
 * `Hook timed out in 10000ms` — un rosso che non dice nulla sul codice.
 *
 * È successo davvero e in modo intermittente: lo stesso commit passava e
 * falliva, `main` risultava rosso mentre una PR sullo stesso albero era verde.
 * Un gate che dipende dal carico della macchina non è un gate.
 *
 * I timeout qui sotto sono **tetti**, non attese: un test veloce resta veloce.
 * Sono tarati sul costo reale misurato delle migrazioni (decine di secondi nel
 * caso peggiore), non alzati «per sicurezza».
 */
export default defineConfig({
  test: {
    // L'import del database con le migrazioni: il collo di bottiglia noto.
    hookTimeout: 120_000,
    // I test lunghi (salti di decenni, sei periodi materiali) superano di molto
    // i 5 s di default pur restando deterministici.
    testTimeout: 120_000,
  },
});
