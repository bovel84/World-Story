/**
 * WS-GOVUX-P3 — La tela conversazionale (canvas)
 * ==============================================
 * Difende i contratti della fase, non l'aspetto:
 *  - le quattro operazioni semantiche (sostituisci principale, aggiungi
 *    confronto, aggiorna, rimuovi) con una regola verificabile;
 *  - il lotto di una risposta: al massimo tre nuove istruzioni, deduplicate;
 *  - due evidenze principali al massimo visibili;
 *  - una direttiva invalida **degrada** e il testo valido resta leggibile;
 *  - una versione di stato stantia non riscrive una tela più recente;
 *  - un riferimento assente non azzera le altre evidenze.
 * La fetta verticale `messaggio → bilancio → grafico` è l'ultimo test.
 */
import { describe, expect, it } from 'vitest';
import {
  applyCanvasBatch, applyCanvasDirective, CANVAS_OP_SEMANTICS, emptyCanvas, MAX_MAIN_EVIDENCES,
  MAX_NEW_EVIDENCES_PER_REPLY, parsePresentation, resolveCanvas,
  type DirectiveMeta, type PresentationCanvas, type PresentationDirective,
} from './presentation';
import type { SeatCanvasBlock } from './seatCanvasModel';
import type { TreasuryRoad } from './treasuryAct';
import { parseStrategicPlan } from './strategicPlan';

const meta = (messageId = 'tesoro#2', discussion?: string): DirectiveMeta => ({
  messageId, quote: 'Ecco la tavola.', ...(discussion ? { discussion } : {}),
});

const samplePlan = () => parseStrategicPlan('PIANO: Prova\nESITO: Esito.\nT0 | Radice | Il punto | -');

/** Il catalogo completo: ogni chiave ha il suo blocco. */
const blocks: SeatCanvasBlock[] = [
  { kind: 'metrics', id: 'cifre-sedia', title: 'Cifre', metrics: [{ id: 'a', label: 'Cassa', display: '12,40 mld', tone: 'neutral' }] },
  { kind: 'chart', id: 'bilancio', title: 'Dove va il denaro', figure: { kind: 'bilancio', title: 'Dove va il denaro', note: '', bars: [{ label: 'Istruzione', value: 10, display: '10', tone: 'positive' }] } },
  { kind: 'chart', id: 'trend', title: 'Andamento', figure: { kind: 'trend', title: 'Andamento', note: '', bars: [] } },
  { kind: 'strategy', id: 'piano', title: 'Piano', plan: samplePlan() },
  { kind: 'map', id: 'zone', title: 'Zone', note: '', zones: [], target: null },
  { kind: 'ideas', id: 'idee', title: 'Idee', ideas: [{ title: 'x', detail: 'y' }] },
];

const roads: TreasuryRoad[] = [
  { id: 'repay', title: 'Ammortamento', voice: 'Rimborsare.', declaredCost: '12,00 mld', expectedGain: '0,54 mld', recommended: false, order: { kind: 'text', text: 'x' } },
  { id: 'invest', title: 'Investimento', voice: 'Aprire il cantiere.', declaredCost: 'coperta', expectedGain: 'effetto', recommended: true, order: { kind: 'text', text: 'y' } },
];

/** Applica un lotto partendo dalla tela vuota. */
const apply = (directives: PresentationDirective[], m = meta()): PresentationCanvas =>
  applyCanvasBatch(emptyCanvas(), directives, m);

const evidenceOf = (canvas: PresentationCanvas): string[] => canvas.mains.map(item => item.evidence);

describe('P3 — le operazioni e il lotto di una risposta', () => {
  it('mappa le operazioni storiche sulle quattro semantiche richieste', () => {
    expect(CANVAS_OP_SEMANTICS.show).toBe('sostituisci principale');
    expect(CANVAS_OP_SEMANTICS.focus).toBe('sostituisci principale');
    expect(CANVAS_OP_SEMANTICS.compare).toBe('aggiungi confronto');
    expect(CANVAS_OP_SEMANTICS.annotate).toBe('aggiorna');
    expect(CANVAS_OP_SEMANTICS.dismiss).toBe('rimuovi');
  });

  it('legge un lotto di direttive, deduplica e tiene l’ultima per chiave', () => {
    const text = [
      'Guardi qui.',
      '```tavola\n{"op":"show","evidence":"spesa"}',
      '```',
      '```tavola\n{"op":"compare"}',
      '```',
      '```tavola\n{"op":"show","evidence":"spesa","note":"di nuovo"}',
      '```',
    ].join('\n');
    const parsed = parsePresentation(text);
    // `show spesa` compare due volte: vale l'ultima; `compare` resta.
    expect(parsed.directives.map(d => d.op)).toEqual(['compare', 'show']);
    expect(parsed.directives.find(d => d.op === 'show')?.note).toBe('di nuovo');
    // Retro-compatibilità: `directive` è l'ultima valida.
    expect(parsed.directive?.op).toBe('show');
    expect(parsed.text).toBe('Guardi qui.');
  });

  it('non applica più di tre nuove istruzioni per risposta', () => {
    const text = ['```tavola\n{"op":"show","evidence":"spesa"}', '```', '```tavola\n{"op":"show","evidence":"trend"}', '```', '```tavola\n{"op":"show","evidence":"cifre"}', '```', '```tavola\n{"op":"show","evidence":"idee"}', '```'].join('\n');
    const parsed = parsePresentation(text);
    expect(parsed.directives.length).toBe(MAX_NEW_EVIDENCES_PER_REPLY);
    // Le ultime tre: la prima (`spesa`) è la più vecchia e cade.
    expect(parsed.directives.map(d => d.evidence)).toEqual(['trend', 'cifre', 'idee']);
  });

  it('valida `target` e `version`: valori non validi sono omessi, non interpretati', () => {
    const parsed = parsePresentation('```tavola\n{"op":"dismiss","target":"spesa","version":3}\n```');
    expect(parsed.directive).toEqual({ op: 'dismiss', target: 'spesa', version: 3 });
    const bad = parsePresentation('```tavola\n{"op":"dismiss","target":"boh","version":-1}\n```');
    expect(bad.directive).toEqual({ op: 'dismiss' });
  });

  it('una direttiva invalida degrada: il testo valido resta leggibile', () => {
    const parsed = parsePresentation('Signor Presidente, ecco.\n```tavola\n{"op":"fly","evidence":"spesa"}\n```');
    expect(parsed.directives).toEqual([]);
    expect(parsed.directive).toBeNull();
    expect(parsed.text).toBe('Signor Presidente, ecco.');
  });
});

describe('P3 — il reducer della tela', () => {
  it('sostituisci principale: porta l’evidenza in testa e conserva l’altra', () => {
    const canvas = apply([{ op: 'show', evidence: 'spesa' }, { op: 'show', evidence: 'piano' }]);
    expect(evidenceOf(canvas)).toEqual(['piano', 'spesa']);
    expect(canvas.stateVersion).toBe(2);
  });

  it('due principali al massimo: la terza scaccia la più vecchia', () => {
    const canvas = apply([
      { op: 'show', evidence: 'spesa' },
      { op: 'show', evidence: 'piano' },
      { op: 'show', evidence: 'cifre' },
    ]);
    expect(evidenceOf(canvas)).toEqual(['cifre', 'piano']);
    expect(canvas.mains.length).toBe(MAX_MAIN_EVIDENCES);
  });

  it('aggiungi confronto: NON toglie le principali (difetto del P0)', () => {
    const withMains = apply([{ op: 'show', evidence: 'spesa' }, { op: 'show', evidence: 'piano' }]);
    const canvas = applyCanvasDirective(withMains, { op: 'compare' }, meta('tesoro#3'));
    expect(evidenceOf(canvas)).toEqual(['piano', 'spesa']);
    expect(canvas.comparison).not.toBeNull();
    expect(canvas.mains).toHaveLength(2);
  });

  it('aggiorna mirato: la nota va solo sull’evidenza bersaglio', () => {
    const withMains = apply([{ op: 'show', evidence: 'spesa' }, { op: 'show', evidence: 'piano' }]);
    const canvas = applyCanvasDirective(withMains, { op: 'annotate', evidence: 'piano', note: 'Da leggere' }, meta('tesoro#4'));
    expect(canvas.mains.find(i => i.evidence === 'piano')?.note).toBe('Da leggere');
    expect(canvas.mains.find(i => i.evidence === 'spesa')?.note).toBeUndefined();
  });

  it('aggiorna un bersaglio assente degrada: stessa istanza', () => {
    const withMains = apply([{ op: 'show', evidence: 'spesa' }]);
    const same = applyCanvasDirective(withMains, { op: 'annotate', target: 'idee', note: 'x' }, meta('tesoro#5'));
    expect(same).toBe(withMains);
  });

  it('rimuovi mirato: toglie solo il bersaglio; senza bersaglio svuota', () => {
    const withMains = apply([{ op: 'show', evidence: 'spesa' }, { op: 'show', evidence: 'piano' }]);
    const trimmed = applyCanvasDirective(withMains, { op: 'dismiss', evidence: 'spesa' }, meta('tesoro#6'));
    expect(evidenceOf(trimmed)).toEqual(['piano']);
    // Bersaglio assente: nessun cambiamento.
    expect(applyCanvasDirective(trimmed, { op: 'dismiss', evidence: 'idee' }, meta())).toBe(trimmed);
    // Senza bersaglio: la tela torna vuota.
    const cleared = applyCanvasDirective(trimmed, { op: 'dismiss' }, meta('tesoro#7'));
    expect(cleared.mains).toEqual([]);
    expect(cleared.comparison).toBeNull();
  });

  it('una versione di stato stantia non riscrive la tela', () => {
    const canvas = apply([{ op: 'show', evidence: 'spesa' }]);
    expect(canvas.stateVersion).toBe(1);
    // Versione vecchia: degrada, stessa istanza.
    expect(applyCanvasDirective(canvas, { op: 'show', evidence: 'piano', version: 0 }, meta())).toBe(canvas);
    // Versione corrente: applica.
    const next = applyCanvasDirective(canvas, { op: 'focus', evidence: 'piano', version: 1 }, meta('tesoro#8'));
    expect(evidenceOf(next)).toEqual(['piano', 'spesa']);
    expect(next.stateVersion).toBe(2);
  });

  it('l’evidenza fissata non si sostituisce col confronto, ma si aggiorna e si rimuove', () => {
    const pinned = apply([{ op: 'show', evidence: 'spesa' }]);
    const locked: PresentationCanvas = { ...pinned, mains: pinned.mains.map(item => ({ ...item, pinned: true })) };
    expect(applyCanvasDirective(locked, { op: 'show', evidence: 'piano' }, meta())).toBe(locked);
    expect(applyCanvasDirective(locked, { op: 'compare' }, meta())).toBe(locked);
    const updated = applyCanvasDirective(locked, { op: 'annotate', evidence: 'spesa', note: 'letta' }, meta('tesoro#9'));
    expect(updated.mains[0].note).toBe('letta');
    const removed = applyCanvasDirective(updated, { op: 'dismiss', evidence: 'spesa' }, meta('tesoro#10'));
    expect(removed.mains).toEqual([]);
  });

  it('il resolver costruisce solo le evidenze con un blocco reale, senza azzerare le altre', () => {
    // `trend` è nel catalogo, `idee` anche; simuliamo un riferimento senza blocco
    // rimuovendo `idee` dal catalogo.
    const reduced = blocks.filter(block => block.id !== 'idee');
    const canvas = apply([{ op: 'show', evidence: 'spesa' }, { op: 'show', evidence: 'idee' }], meta('tesoro#11'));
    const resolved = resolveCanvas(canvas, reduced, roads);
    expect(resolved.mains.map(item => item.block?.id)).toEqual(['bilancio']);
    expect(resolved.comparison).toBeNull();
  });

  it('risolve il confronto dalle strade del motore', () => {
    const canvas = apply([{ op: 'compare' }]);
    const resolved = resolveCanvas(canvas, blocks, roads);
    expect(resolved.comparison?.kind).toBe('compare');
    expect(resolved.comparison?.roads.map(r => r.id)).toEqual(['repay', 'invest']);
  });
});

describe('P3 — la fetta verticale messaggio → bilancio → grafico', () => {
  it('da una risposta con due evidenze, la tela mostra bilancio e grafico', () => {
    // Il messaggio del ministro: due direttive in un solo lotto.
    const reply = [
      'Signor Presidente, ecco il bilancio e l’andamento.',
      '```tavola\n{"op":"show","evidence":"spesa"}',
      '```',
      '```tavola\n{"op":"focus","evidence":"trend"}',
      '```',
    ].join('\n');
    const parsed = parsePresentation(reply);
    expect(parsed.text).toBe('Signor Presidente, ecco il bilancio e l’andamento.');
    expect(parsed.directives).toHaveLength(2);

    const canvas = apply(parsed.directives, meta('tesoro#12', 'Mi mostri la spesa e il trend'));
    // La principale è l’ultima richiesta (trend), la precedente resta visibile.
    expect(evidenceOf(canvas)).toEqual(['trend', 'spesa']);

    const resolved = resolveCanvas(canvas, blocks, roads);
    expect(resolved.mains.map(item => item.block?.kind)).toEqual(['chart', 'chart']);
    expect(resolved.mains.map(item => item.block?.id)).toEqual(['trend', 'bilancio']);
    // Il testo valido del messaggio resta leggibile.
    expect(parsed.text).not.toContain('tavola');
  });
});
