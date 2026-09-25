/**
 * Test-contratto della forma del dispaccio
 * =======================================
 * Difende due cose che la misura aveva trovato sbagliate:
 *
 *  1. **Una sola misura di lunghezza.** Prima il corpo di un dispaccio era
 *     descritto in tre modi diversi nella stessa cartella: «due brevi
 *     paragrafi» (`immersion.ts`), «90-140 parole» (`immersion.ts` riga
 *     seguente), «4-6 frasi» (`simulation/prompt.ts`). Il modello non poteva
 *     obbedire a tutte. Ora la misura vive in `EVENT_BODY_WORDS`.
 *  2. **Il divieto dei dispacci di riempimento** (§5.11) deve stare in
 *     **entrambi** i prompt — quello di simulazione e il contratto narrativo —
 *     perché i due percorsi sono alternativi.
 *
 * Il test legge il **sorgente con `fs`**, come i test-contratto del dossier, e
 * ha una **guardia contro il falso verde**: ogni blocco verifica prima di aver
 * trovato il testo che sta cercando.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';

const SRC = join(__dirname, '..');
const leggi = (rel: string) => readFileSync(join(SRC, rel), 'utf8');

/**
 * Toglie i commenti dal sorgente. Serve perché questo stesso test **cita** le
 * misure vecchie per spiegarle: senza questo filtro il test troverebbe la
 * citazione e si contraddirebbe da solo. Il controllo riguarda il **codice**,
 * cioè ciò che finisce davvero nel prompt del modello.
 */
const soloCodice = (sorgente: string): string =>
  sorgente
    .replace(/\/\*[\s\S]*?\*\//g, '')   // commenti di blocco
    .replace(/(^|[^:])\/\/[^\n]*/g, '$1'); // commenti di riga (senza toccare gli URL)

describe('una sola misura di lunghezza per il corpo del dispaccio', () => {
  it('la misura vive in EVENT_BODY_WORDS e non è ripetuta a mano', () => {
    const immersion = leggi('prompts/immersion.ts');
    // Guardia: la costante deve esistere ed essere esportata.
    expect(immersion).toMatch(/export const EVENT_BODY_WORDS\s*=/);

    // Le tre misure vecchie che si contraddicevano non devono restare **nel
    // codice** (il commento che le racconta è ammesso: è la memoria del perché).
    const immersionCodice = soloCodice(immersion);
    expect(immersionCodice, '«90-140 parole» era una delle tre misure in conflitto').not.toMatch(/90-140 parole/);
    expect(immersionCodice, '«4-6 frasi» era una delle tre misure in conflitto').not.toMatch(/4-6 frasi/);

    const prompt = leggi('prompts/simulation/prompt.ts');
    expect(soloCodice(prompt), 'anche prompt.ts imponeva una misura propria').not.toMatch(/4-6 frasi/);
    // La lunghezza si chiede solo tramite la guida condivisa.
    expect(prompt).toContain('${EVENT_DESCRIPTION_GUIDE}');
  });

  it('la guida condivisa contiene la misura, una volta sola', () => {
    const immersion = leggi('prompts/immersion.ts');
    const occorrenze = (soloCodice(immersion).match(/\$\{EVENT_BODY_WORDS\}/g) || []).length;
    expect(occorrenze, 'la misura deve essere interpolata una volta sola').toBe(1);
  });
});

describe('il divieto dei dispacci di riempimento (§5.11)', () => {
  it('compare nel prompt di simulazione', () => {
    const prompt = leggi('prompts/simulation/prompt.ts');
    expect(prompt).toMatch(/Ciò che NON è un dispaccio/);
    expect(prompt).toMatch(/riempimento/);
    expect(prompt).toMatch(/fine anno|fine del periodo/);
  });

  it('compare anche nel contratto narrativo, perché i percorsi sono alternativi', () => {
    const guards = leggi('prompts/simulation/guards.ts');
    expect(guards).toMatch(/dispacci di riempimento/);
    expect(guards).toMatch(/§5\.11/);
  });

  it('nessuno dei due vieta di completare la simulazione', () => {
    // Il divieto di riempimento non deve diventare «fermati a metà»: Pax lo
    // vieta esplicitamente («DO NOT JUST RANDOMLY STOP SIMULATING EVENTS»).
    const prompt = leggi('prompts/simulation/prompt.ts');
    expect(prompt).toMatch(/non interrompere|non troncare|distribuiscili/i);
  });
});
