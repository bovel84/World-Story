/**
 * Test-contratto — «la cronaca racconta, la chat conversa» (Fase E01, invariante I5)
 * =================================================================================
 * Il difetto misurato sul database di gioco (26 settembre 2026):
 *
 *  - `source=diplomacy` produceva una voce di cronaca con una di **otto frasi
 *    predefinite** scritte dal motore (`DiplomacyService.openingByKind`):
 *    «invia una nota diplomatica», «avvia un negoziato», «convoca una riunione
 *    multilaterale»… Nelle partite recenti erano il **28 %** delle voci di
 *    cronaca;
 *  - dei due percorsi che aprono un canale, quello **automatico** (la reazione
 *    di una controparte) è il responsabile: `reactionChatStarts` impone
 *    `kind: 'statement'`, quindi **132 delle 185** voci `diplomacy` portano
 *    letteralmente «invia una nota diplomatica»;
 *  - e non aggiunge un fatto: **183 note su 183** si aprono con
 *    `In seguito a «<titolo>»`, e il titolo citato è un evento di mondo dello
 *    **stesso run**. La posizione era già raccontata nel blocco «Reazioni
 *    internazionali» del dispaccio dell'evento.
 *
 * Il rimedio non è togliere la chat — il giocatore deve poter rispondere, e le
 * aperture chat restano eventi diplomatici legittimi (SPEC §G21). È togliere la
 * **seconda voce di cronaca** per i canali che nascono da una reazione già
 * raccontata, lasciandola a quelli che portano un fatto nuovo.
 *
 * Guardia contro il falso verde: una soppressione scritta male potrebbe
 * sopprimere **tutto**. I test difendono entrambe le direzioni — il canale
 * automatico non entra in cronaca, il canale chiesto dal modello **sì**.
 */
import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';

const ROOT = path.resolve(__dirname, '..', '..');

function read(relative: string): string {
  return fs.readFileSync(path.join(ROOT, relative), 'utf8');
}

/** Estrae il corpo di `openSimulationChats` senza dipendere dal numero di riga. */
function openSimulationChatsBody(): string {
  const source = read('src/game/DiplomacyService.ts');
  const start = source.indexOf('openSimulationChats(');
  expect(start, 'openSimulationChats non trovata in DiplomacyService.ts').toBeGreaterThan(0);
  // Il metodo termina al primo `return {` che restituisce i quattro campi.
  const end = source.indexOf('return { timelineEvents', start);
  expect(end, 'return di openSimulationChats non trovato').toBeGreaterThan(start);
  return source.slice(start, end);
}

describe('E01 — la posizione diplomatica non duplica il dispaccio', () => {
  it('il canale nato da una reazione già raccontata non entra in cronaca', () => {
    const body = openSimulationChatsBody();
    // La scelta vive in un solo punto, e le due destinazioni sono dichiarate.
    expect(body).toContain('suppressedTimelineEvents');
    expect(body).toContain('start.alreadyNarrated');
  });

  it('la soppressione non è un filtro cieco: il canale del modello resta cronaca', () => {
    const body = openSimulationChatsBody();
    // Le due destinazioni sono un ternario, non un `continue` che scarta tutto.
    expect(body).toMatch(/alreadyNarrated\s*\?\s*suppressedTimelineEvents\s*:\s*timelineEvents/);
  });

  it('la reazione automatica è marcata come già raccontata alla fonte', () => {
    const source = read('src/game-session.ts');
    const start = source.indexOf('private reactionChatStarts');
    expect(start, 'reactionChatStarts non trovata').toBeGreaterThan(0);
    const body = source.slice(start, source.indexOf('reactionChatStarts(', start + 30) === -1
      ? source.length
      : source.indexOf('\n  /**', start));
    expect(body).toContain('alreadyNarrated: true');
    // Il kind resta 'statement' per il canale: si toglie la voce, non il tipo.
    expect(body).toContain("kind: 'statement'");
  });

  it('il campo è interno: il parser dei startChat non lo legge', () => {
    const parser = read('src/prompts/simulation/parse.ts');
    const start = parser.indexOf('const startChat: SimulationChatStart[]');
    expect(start, 'blocco startChat non trovato in parse.ts').toBeGreaterThan(0);
    // Il blocco finisce con il filtro finale dei null.
    const end = parser.indexOf('const rawRelationshipChanges', start);
    expect(end, 'fine del blocco startChat non trovata').toBeGreaterThan(start);
    const block = parser.slice(start, end);
    expect(block, 'il parser non deve passare alreadyNarrazato dal modello')
      .not.toContain('alreadyNarrated');
    // E i campi letti sono elencati uno per uno: nessun `...c` che li trascini.
    expect(block).not.toMatch(/\.\.\.\s*c\b/);
  });

  it('le otto frasi restano: servono al canale, non alla cronaca', () => {
    const source = read('src/game/DiplomacyService.ts');
    // La mappa esiste ancora, e il commento dice perché.
    for (const frase of [
      'convoca una riunione multilaterale', 'chiede una riunione', 'propone un vertice',
      'avvia un negoziato', 'convoca una conferenza', 'apre un confronto su un ultimatum',
      'propone un tavolo tecnico', 'invia una nota diplomatica',
    ]) {
      expect(source, `frase mancante: ${frase}`).toContain(frase);
    }
  });
});
