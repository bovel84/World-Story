/**
 * Test-contratto della voce diplomatica
 * =====================================
 * Le nazioni in chat devono parlare COME NAZIONI — una volontà, un punto
 * dominante, uno stato d'animo — e non come un elencatore di fatti che
 * recita priorità, linee rosse, agenda e memoria come voci di un rapporto.
 *
 * Il test verifica il prompt che il motore manda al modello:
 *  1. il contratto di voce (retroterra come guida del giudizio, mai da
 *     recitare; forme vietate; esempio di registro ✗/✓);
 *  2. le invarianti dure che non devono sparire con la riscrittura
 *     (solo partecipanti presenti, niente cifre, niente atti compiuti,
 *      contratto JSON {"message"}, prima persona plurale);
 *  3. la vecchia formula a slot («cosa vogliamo ottenere, quale limite non
 *     accettiamo e quale passo reciproco proponiamo») non c'è più.
 */
import { describe, it, expect } from 'vitest';
import { buildChatPrompt, parseChatResponse } from '../src/prompts/chat';

const VARS = {
  playerPolityName: 'Regno di Cambogia',
  participants: [
    { name: 'Vietnam', relationship: 'neutral', personality: 'prudente; dottrina difensiva; stile indiretto', interests: 'ciò che conta di più: proteggere il delta' },
  ],
  respondingParticipant: { name: 'Vietnam', relationship: 'neutral', personality: 'prudente', interests: 'x' },
  worldContext: 'Storia alternativa',
  simulationRules: '',
  mapContext: '',
  difficultyContext: '',
  date: '1962-03-01',
  recentEvents: [],
  history: [],
  playerMessage: 'Proponiamo un patto di non aggressione.',
  mode: 'reply' as const,
  subject: null,
};

describe('la chat diplomatica parla come una nazione, non come un elencatore di fatti', () => {
  const prompt = buildChatPrompt(VARS);

  it('presenta il retroterra come guida del giudizio, mai da recitare', () => {
    expect(prompt).toContain('[Chi sei — retroterra, non copione]');
    expect(prompt).toContain('NON lo reciti, NON lo elenchi, NON lo riassumi');
  });

  it('vieta le forme da elencatore di fatti', () => {
    expect(prompt).toContain('Forme VIETATE');
    for (const vietata of [
      '«le nostre priorità sono',
      '«le nostre linee rosse includono',
      '«la nostra agenda prevede',
      '«i nostri impegni in vigore',
    ]) {
      expect(prompt, vietata).toContain(vietata);
    }
    expect(prompt).toContain('UNA posizione dominante');
  });

  it('mostra un esempio di registro da evitare e da imitare', () => {
    expect(prompt).toContain('✗ da evitare');
    expect(prompt).toContain('✓ da imitare');
    expect(prompt).toContain('conta solo il registro');
  });

  it('conserva le invarianti dure della trattativa', () => {
    expect(prompt).toContain('Le sole nazioni presenti in questa trattativa sono: Vietnam');
    expect(prompt).toContain('NON citare cifre');
    expect(prompt).toContain('non firma nuovi atti per Regno di Cambogia');
    expect(prompt).toContain('prima persona plurale');
    expect(prompt).toContain('Rispondi SOLO con un oggetto JSON valido');
    expect(prompt).toContain('{"message":"<replica diplomatica di Vietnam>"}');
  });

  it('la vecchia formula a slot non c’è più nel prompt', () => {
    expect(prompt).not.toContain('cosa vogliamo ottenere, quale limite non accettiamo e quale passo reciproco proponiamo');
  });

  it('il testo diplomatico restituito rimane leggibile su mobile anche con risposte prolisse', () => {
    const verbose = Array.from({ length: 10 }, (_, i) => `Condizione ${i + 1}: negoziamo soltanto dopo un passo reciproco verificabile.`).join(' ');
    expect(parseChatResponse(JSON.stringify({ message: verbose })).message.length).toBeLessThanOrEqual(850);
    expect(parseChatResponse(verbose).message.length).toBeLessThanOrEqual(850);
  });

  it('il messaggio di reazione automatica NON narra in terza persona', () => {
    // Il fallback «senza modello» parlava di sé in terza persona
    // («X prende formalmente atto…»): anche quel testo è voce della nazione.
    const sorgente = require('fs').readFileSync(
      require('path').join(__dirname, '../src/game/DiplomacyService.ts'), 'utf8');
    expect(sorgente).not.toContain('prende formalmente atto');
    expect(sorgente).toContain('Il nostro governo prende atto');
  });
});
