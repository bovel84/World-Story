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
  availableEvidence, blockForEvidence, parsePresentation, resolvePresentation, shouldApplyPresentation, EVIDENCE_KEYS,
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

  it('rifiuta HTML, JavaScript e gestori inline; le chiavi extra note sono riferimenti', () => {
    expect(parsePresentation('```tavola\n{"op":"focus","evidence":"spesa","x":"<b>hi</b>"}\n```').directive).toBeNull();
    expect(parsePresentation('```tavola\n{"op":"focus","evidence":"spesa","x":"javascript:alert(1)"}\n```').directive).toBeNull();
    // `regionIds` è un riferimento ammesso (UX-04): sono id, non geometrie.
    const extra = parsePresentation('```tavola\n{"op":"focus","evidence":"mappa","regionIds":["ALPHA"]}\n```');
    expect(extra.directive).toEqual({ op: 'focus', evidence: 'mappa', regionIds: ['ALPHA'] });
  });

  it('sanifica i regionIds: solo id brevi e sicuri', () => {
    const longId = 'x'.repeat(40);
    const raw = '{"op":"focus","evidence":"mappa","regionIds":["ALPHA","a b","BETA","' + longId + '"]}';
    const parsed = parsePresentation('```tavola\n' + raw + '\n```');
    expect(parsed.directive).toEqual({ op: 'focus', evidence: 'mappa', regionIds: ['ALPHA', 'BETA'] });
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

  it('porta le zone in evidenza solo quando l’evidenza è la mappa', () => {
    const mappa = resolvePresentation(active({ op: 'focus', evidence: 'mappa', regionIds: ['ALPHA'] }), blocks, roads);
    expect(mappa?.block?.id).toBe('zone');
    expect(mappa?.regionIds).toEqual(['ALPHA']);
    // Su un'altra evidenza le zone non hanno senso e si ignorano.
    const spesa = resolvePresentation(active({ op: 'focus', evidence: 'spesa', regionIds: ['ALPHA'] }), blocks, roads);
    expect(spesa?.regionIds).toBeUndefined();
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

describe('WS-MINISTER-UX-07 — A2 voce di spesa e C evidenza fissata', () => {
  const expense: SeatCanvasBlock = {
    kind: 'chart', id: 'bilancio', title: 'Dove va il denaro',
    figure: {
      kind: 'bilancio', title: 'Dove va il denaro', note: '',
      bars: [
        { label: 'Difesa', value: 34, display: '34', tone: 'warning' },
        { label: 'Sanità e assistenza', value: 45, display: '45', tone: 'positive' },
      ],
    },
  };

  it('A2 — la voce discussa diventa la focus e il saldo non è l’evidenza', () => {
    const resolved = resolvePresentation(
      {
        directive: { op: 'focus', evidence: 'spesa' },
        seat: 'tesoro', messageId: 'tesoro#9', quote: 'Ecco la tavola.',
        discussion: 'La spesa per la sanità',
      },
      [expense],
      roads,
    );
    expect(resolved?.focusLabel).toBe('Sanità e assistenza');
    expect(resolved?.label).toContain('Sanità e assistenza');
  });

  it('A2 — senza aggancio non si evidenzia una voce a caso', () => {
    const resolved = resolvePresentation(
      { directive: { op: 'focus', evidence: 'spesa' }, seat: 'tesoro', messageId: 'tesoro#10', quote: 'Ecco la tavola.' },
      [expense],
      roads,
    );
    expect(resolved?.focusLabel).toBeUndefined();
  });

  it('C — un’evidenza fissata non si sostituisce, il dismiss la chiude', () => {
    expect(shouldApplyPresentation({ ...active({ op: 'focus', evidence: 'spesa' }), pinned: true }, { op: 'focus', evidence: 'trend' })).toBe(false);
    expect(shouldApplyPresentation({ ...active({ op: 'focus', evidence: 'spesa' }), pinned: true }, { op: 'dismiss' })).toBe(true);
    expect(shouldApplyPresentation({ ...active({ op: 'focus', evidence: 'spesa' }) }, { op: 'focus', evidence: 'trend' })).toBe(true);
    expect(shouldApplyPresentation(null, { op: 'focus', evidence: 'spesa' })).toBe(true);
  });
});
