/**
 * WS-MINISTER-UX-03 — La conversazione guida la tavola
 * ====================================================
 * Difende il confine della fase: il modello **sceglie riferimenti**, il resolver
 * costruisce il blocco dalle fonti autorizzate. Un riferimento invalido non fa
 * nulla (la risposta testuale resta), un blocco incompleto non si rende durante
 * lo streaming, e nel blocco non entrano HTML, JavaScript, numeri o geometrie.
 */
import { describe, expect, it } from 'vitest';
import {
  availableEvidence, blockForEvidence, parsePresentation, resolvePresentation, EVIDENCE_KEYS,
  type ActivePresentation, type PresentationDirective,
} from './presentation';
import type { SeatCanvasBlock } from './seatCanvasModel';
import type { TreasuryRoad } from './treasuryAct';
import { stabilizationPlan } from './strategicPlan';

const blocks: SeatCanvasBlock[] = [
  { kind: 'metrics', id: 'cifre-sedia', title: 'Le cifre della sedia', metrics: [{ id: 'a', label: 'Cassa', display: '12,40 mld', tone: 'neutral' }] },
  { kind: 'chart', id: 'bilancio', title: 'Dove va il denaro', figure: { kind: 'bilancio', title: 'Dove va il denaro', note: '', bars: [{ label: 'Istruzione', value: 10, display: '10', tone: 'positive' }] } },
  { kind: 'strategy', id: 'piano', title: 'Piano', plan: stabilizationPlan() },
  { kind: 'map', id: 'zone', title: 'Zone', note: '', zones: [], target: null },
  { kind: 'ideas', id: 'idee', title: 'Idee', ideas: [{ title: 'x', detail: 'y' }] },
];

const roads: TreasuryRoad[] = [
  { id: 'repay', title: 'Ammortamento del debito', voice: 'Rimborsare.', declaredCost: '12,00 mld', expectedGain: '0,54 mld di interessi in meno', recommended: false, order: { kind: 'text', text: 'x' } },
  { id: 'invest', title: 'Investimento', voice: 'Aprire il cantiere.', declaredCost: 'distinta coperta', expectedGain: 'effetto al completamento', recommended: true, order: { kind: 'text', text: 'y' } },
];

const active = (directive: PresentationDirective): ActivePresentation => ({
  directive, seat: 'tesoro', messageId: 'tesoro#2', quote: 'Ecco il grafico.',
});

describe('parsePresentation', () => {
  it('estrae la direttiva JSON e toglie il blocco dalla prosa', () => {
    const text = 'Signor Presidente, guardi qui.\n\n```tavola\n{"op":"focus","evidence":"spesa"}\n```';
    const parsed = parsePresentation(text);
    expect(parsed.directive).toEqual({ op: 'focus', evidence: 'spesa' });
    expect(parsed.text).toBe('Signor Presidente, guardi qui.');
    expect(parsed.text).not.toContain('tavola');
    expect(parsed.text).not.toContain('{');
  });

  it('accetta il ripiego `op=… evidence=…` quando il JSON non c’è', () => {
    const parsed = parsePresentation('Testo.\n```tavola\nop=focus evidence=mappa\n```');
    expect(parsed.directive).toEqual({ op: 'focus', evidence: 'mappa' });
  });

  it('rifiuta op sconosciuto, evidenza sconosciuta o evidenza mancante', () => {
    expect(parsePresentation('```tavola\n{"op":"fly","evidence":"spesa"}\n```').directive).toBeNull();
    expect(parsePresentation('```tavola\n{"op":"focus","evidence":"boh"}\n```').directive).toBeNull();
    expect(parsePresentation('```tavola\n{"op":"focus"}\n```').directive).toBeNull();
  });

  it('rifiuta HTML, JavaScript e gestori inline; ignora chiavi extra', () => {
    expect(parsePresentation('```tavola\n{"op":"focus","evidence":"spesa","x":"<b>hi</b>"}\n```').directive).toBeNull();
    expect(parsePresentation('```tavola\n{"op":"focus","evidence":"spesa","x":"javascript:alert(1)"}\n```').directive).toBeNull();
    // Chiavi extra innocue non allargano il contratto: si leggono solo op/evidence/note.
    const extra = parsePresentation('```tavola\n{"op":"focus","evidence":"spesa","regionIds":["A"]}\n```');
    expect(extra.directive).toEqual({ op: 'focus', evidence: 'spesa' });
  });

  it('non rende un blocco incompleto: lo rimuove dal testo durante lo streaming', () => {
    const streaming = 'Signor Presidente, ecco.\n```tavola\n{"op":"focus","evid';
    const parsed = parsePresentation(streaming);
    expect(parsed.directive).toBeNull();
    expect(parsed.text).toBe('Signor Presidente, ecco.');
    expect(parsed.text).not.toContain('tavola');
  });

  it('con più blocchi vince l’ultimo', () => {
    const parsed = parsePresentation('a ```tavola\n{"op":"focus","evidence":"spesa"}\n``` b ```tavola\n{"op":"compare"}\n```');
    expect(parsed.directive).toEqual({ op: 'compare' });
    expect(parsed.text).toBe('a  b');
  });
});

describe('catalogo e resolver', () => {
  it('mappa le chiavi sui blocchi reali e dichiara cosa è disponibile', () => {
    expect(blockForEvidence('spesa', blocks)?.id).toBe('bilancio');
    expect(blockForEvidence('mappa', blocks)?.id).toBe('zone');
    expect(blockForEvidence('cifre', blocks)?.id).toBe('cifre-sedia');
    expect(blockForEvidence('trend', blocks)).toBeNull();
    expect(availableEvidence(blocks)).toEqual(['spesa', 'cifre', 'piano', 'mappa', 'idee']);
    expect(EVIDENCE_KEYS.length).toBe(6);
  });

  it('risolve l’evidenza richiesta nel blocco giusto', () => {
    const resolved = resolvePresentation(active({ op: 'focus', evidence: 'spesa' }), blocks, roads);
    expect(resolved?.kind).toBe('evidence');
    expect(resolved?.block?.id).toBe('bilancio');
    expect(resolved?.label).toContain('spesa');
    expect(resolved?.messageId).toBe('tesoro#2');
  });

  it('risolve il confronto dalle strade del motore', () => {
    const resolved = resolvePresentation(active({ op: 'compare' }), blocks, roads);
    expect(resolved?.kind).toBe('compare');
    expect(resolved?.roads.map(road => road.id)).toEqual(['repay', 'invest']);
  });

  it('un’evidenza assente o un dismiss non mostrano nulla: la tavola resta', () => {
    expect(resolvePresentation(active({ op: 'focus', evidence: 'trend' }), blocks, roads)).toBeNull();
    expect(resolvePresentation(active({ op: 'dismiss' }), blocks, roads)).toBeNull();
    expect(resolvePresentation(null, blocks, roads)).toBeNull();
  });
});
