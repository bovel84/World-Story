/**
 * World Story — resa del testo del Consulente
 * ===========================================
 * Il difetto: il prompt del Consulente chiede al modello di scrivere «con titoli,
 * grassetto, elenchi» (`prompts/advisor.ts`), ma il componente stampava il testo
 * grezzo con `white-space: pre-wrap`. Il giocatore leggeva «**grassetto**» con gli
 * asterischi, «## Titolo» col cancelletto, «- voce» col trattino.
 *
 * Questi test difendono due cose: che il testo **venga** reso, e che la resa non
 * apra una superficie di iniezione (niente `dangerouslySetInnerHTML`).
 */
import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { hasRichText, parseBlocks, parseInline } from './richTextModel';

const read = (rel: string) => fs.readFileSync(path.resolve(__dirname, rel), 'utf8');

describe('richText — interpretazione del testo del Consulente', () => {
  it('rende il grassetto, e il grassetto non diventa due corsivi', () => {
    expect(parseInline('un **punto fermo** qui')).toEqual([
      { kind: 'text', text: 'un ' },
      { kind: 'strong', text: 'punto fermo' },
      { kind: 'text', text: ' qui' },
    ]);
    // Guardia: `**x**` è un grassetto, non due corsivi annidati.
    const nodes = parseInline('**x**');
    expect(nodes).toEqual([{ kind: 'strong', text: 'x' }]);
  });

  it('rende corsivo e codice', () => {
    expect(parseInline('*enfasi* e `codice`')).toEqual([
      { kind: 'em', text: 'enfasi' },
      { kind: 'text', text: ' e ' },
      { kind: 'code', text: 'codice' },
    ]);
    expect(parseInline('_enfasi_')).toEqual([{ kind: 'em', text: 'enfasi' }]);
  });

  it('un asterisco spaiato resta testo: non si perde nulla', () => {
    expect(parseInline('2 * 3 = 6')).toEqual([{ kind: 'text', text: '2 * 3 = 6' }]);
  });

  it('interpreta titoli, elenchi, citazioni e divisori', () => {
    const blocks = parseBlocks(`## Situazione\n\nIl **Nord** è scoperto.\n\n- prima voce\n- seconda voce\n\n> una citazione\n\n---`);
    expect(blocks.map(b => b.kind)).toEqual(['heading', 'paragraph', 'list', 'quote', 'rule']);
    const heading = blocks[0];
    expect(heading.kind === 'heading' && heading.level).toBe(2);
    const list = blocks[2];
    expect(list.kind === 'list' && list.ordered).toBe(false);
    expect(list.kind === 'list' && list.items.length).toBe(2);
  });

  it('distingue elenchi numerati da puntati', () => {
    const blocks = parseBlocks('1. primo\n2. secondo');
    expect(blocks[0].kind === 'list' && blocks[0].ordered).toBe(true);
  });

  it('un testo semplice resta un paragrafo, senza blocchi inventati', () => {
    const blocks = parseBlocks('Una frase sola.');
    expect(blocks).toEqual([{ kind: 'paragraph', inlines: [{ kind: 'text', text: 'Una frase sola.' }] }]);
  });

  it('il testo vuoto non produce blocchi', () => {
    expect(parseBlocks('')).toEqual([]);
    expect(parseBlocks('   \n\n  ')).toEqual([]);
  });

  it('riconosce quando c\'è qualcosa da rendere (guardia contro il falso verde)', () => {
    expect(hasRichText('## Titolo')).toBe(true);
    expect(hasRichText('un **punto**')).toBe(true);
    expect(hasRichText('- voce')).toBe(true);
    expect(hasRichText('testo puro senza marcatori')).toBe(false);
  });
});

describe('RichText — la resa è sicura e completa', () => {
  /** Il sorgente senza i commenti: le parole *spiegate* non sono codice. */
  const code = (rel: string) => read(rel)
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:])\/\/.*$/gm, '$1');

  it('non usa HTML grezzo: rende con elementi React', () => {
    // Il testo arriva da un modello linguistico: inserirlo come HTML sarebbe una
    // superficie di iniezione. Si rende con elementi, mai con HTML grezzo.
    // (Il controllo è sul **codice**: il commento in testa a `RichText.tsx` cita
    // la tecnica proprio per dire che non si usa.)
    const view = code('./RichText.tsx');
    expect(view).not.toMatch(/dangerouslySetInnerHTML/);
    expect(view).not.toMatch(/innerHTML/);
  });

  it('ogni tipo di blocco del parser è reso, nessuno cade nel vuoto', () => {
    const view = code('./RichText.tsx');
    // I tipi con un ramo proprio.
    for (const kind of ['heading', 'list', 'quote', 'rule']) {
      expect(view, `blocco non reso: ${kind}`).toContain(`'${kind}'`);
    }
    // Il paragrafo è il caso di default: deve esistere un ramo finale che lo rende,
    // altrimenti un blocco senza match sparirebbe dalla risposta.
    expect(view).toMatch(/rich-paragraph/);
    // E i tre tipi in linea.
    for (const kind of ['strong', 'em', 'code']) {
      expect(view).toContain(`'${kind}'`);
    }
  });

  it('la chat del Consulente rende le risposte del consulente, non il testo del governo', () => {
    const chat = read('./AdvisorChat.tsx');
    expect(chat).toMatch(/RichText/);
    // Solo il ruolo `assistant` passa dal renderer: il messaggio del giocatore è
    // testo che scrive lui, e va mostrato com'è.
    expect(chat).toMatch(/m\.role === 'assistant'/);
  });
});
