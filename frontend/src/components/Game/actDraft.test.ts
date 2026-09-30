/**
 * WS-MINISTER-UX-06 — La bozza d'atto: capacità, preparazione, stato reale
 * =======================================================================
 * Difende il confine della fase:
 *  - la **capacità** della strada viene dalla dichiarazione d'opera, non dalla voce;
 *  - preparare non accoda: la bozza è testo correggibile + dichiarazione;
 *  - lo **stato** dell'atto è derivato da coda e cronologia, mai da un flag locale;
 *  - una strada senza comando supportato lo dice e non prende la dichiarazione.
 */
import { describe, it, expect } from 'vitest';
import {
  actDraftFor, actHeadline, actStatus, capabilityFor, capabilityLabel, capabilityNote,
  deriveActState, editActDraft, orderKey,
} from './actDraft';
import type { TreasuryRoad } from './treasuryAct';
import type { HistoryItem, PendingAction } from '../../stores/gameStore';

const path = { id: 'build_now', title: 'Avviare il cantiere', detail: '', prerequisites: [], expected: '', recommended: true };

function workItem(declaration?: unknown): any {
  return {
    voiceId: 'v', need: 'Costruire: Scuola elementare', because: '', urgency: 'ordinaria',
    figures: [], paths: [path], ...(declaration ? { declaration } : {}),
  };
}

function workRoad(declaration?: unknown): TreasuryRoad {
  return {
    id: 'invest', title: 'Investimento', voice: 'Aprire il cantiere.', declaredCost: 'distinta coperta',
    expectedGain: 'effetto dichiarato al completamento', recommended: true,
    order: { kind: 'work', item: workItem(declaration), path },
  };
}

function textRoad(text = 'Rimborso titoli: 20 mld in scadenza'): TreasuryRoad {
  return {
    id: 'repay', title: 'Ammortamento del debito', voice: 'Rimborsare i titoli.', declaredCost: '20 mld',
    expectedGain: '0,60 mld di interessi in meno', recommended: false, order: { kind: 'text', text },
  };
}

const declaration = { workId: 'w_school', payerActorId: 'ITA', materialActorId: 'ITA', funded: true };

const accepted: HistoryItem = { turn: 3, action: 'Avviare il cantiere\n— Costruire: Scuola elementare', result: 'ok', outcomeStatus: 'accepted' };
const rejected: HistoryItem = { turn: 3, action: 'Rimborso titoli: 20 mld in scadenza', result: 'no', outcomeStatus: 'rejected' };

describe('actDraft — capacità dichiarata', () => {
  it('la capacità viene dalla dichiarazione, non dalla voce', () => {
    expect(capabilityFor(workRoad(declaration))).toBe('engine-order');
    expect(capabilityFor(workRoad())).toBe('unsupported');
    expect(capabilityFor(textRoad())).toBe('text-order');
  });

  it('una distinta scoperta dice cosa manca, invece di promettere il cantiere', () => {
    const road = workRoad();
    road.order = { kind: 'work', item: { ...workItem(), declaration: { workId: 'w', payerActorId: 'ITA', materialActorId: null, funded: false, missingMaterials: [{ resourceId: 'acciaio', missing: 12 }] } }, path };
    expect(capabilityFor(road)).toBe('unsupported');
    expect(capabilityNote(road, 'unsupported')).toContain('acciaio (12)');
    expect(capabilityNote(road, 'unsupported')).toContain('non aprirebbe il cantiere');
  });

  it('le etichette sono leggibili e distinte', () => {
    expect(capabilityLabel('engine-order')).toBe('ordine d’opera supportato');
    expect(capabilityLabel('text-order')).toBe('bozza testuale da valutare');
    expect(capabilityLabel('unsupported')).toBe('funzione assente');
  });
});

describe('actDraft — preparazione e modifica', () => {
  it('la strada d’opera coperta diventa una bozza con la dichiarazione', () => {
    const draft = actDraftFor(workRoad(declaration), 'tesoro');
    expect(draft.id).toBe('tesoro:invest');
    expect(draft.capability).toBe('engine-order');
    expect(draft.text).toContain('Avviare il cantiere');
    expect(draft.work).toEqual(declaration);
  });

  it('una strada senza comando supportato resta prosa: nessuna dichiarazione', () => {
    const draft = actDraftFor(workRoad(), 'tesoro');
    expect(draft.capability).toBe('unsupported');
    expect(draft.work).toBeUndefined();
  });

  it('«Modifica proposta» cambia il testo e conserva la dichiarazione d’opera', () => {
    const draft = actDraftFor(workRoad(declaration), 'tesoro');
    const edited = editActDraft(draft, 'Testo corretto dal Presidente');
    expect(edited.text).toBe('Testo corretto dal Presidente');
    expect(edited.work).toEqual(declaration);
  });
});

describe('actDraft — lo stato reale, non un flag locale', () => {
  it('senza coda né cronologia l’atto è preparato', () => {
    expect(deriveActState({ text: 'Avviare il cantiere' }, [], [])).toBe('prepared');
  });

  it('una voce in coda rende l’atto accodato', () => {
    const pending: PendingAction[] = [{ id: 'a1', text: 'Avviare il cantiere\n— Costruire: Scuola elementare' }];
    expect(deriveActState({ text: 'Avviare il cantiere\n— Costruire: Scuola elementare' }, pending, [])).toBe('queued');
  });

  it('l’esito del motore distingue eseguito da fallito', () => {
    expect(deriveActState({ text: accepted.action }, [], [accepted])).toBe('executed');
    expect(deriveActState({ text: rejected.action }, [], [rejected])).toBe('failed');
  });

  it('un atto riaccodato dopo l’esecuzione torna «accodato»: vince la coda', () => {
    const pending: PendingAction[] = [{ id: 'a2', text: accepted.action }];
    expect(deriveActState({ text: accepted.action }, pending, [accepted])).toBe('queued');
  });

  it('la corrispondenza ignora spazi e a capo in eccesso', () => {
    expect(orderKey('  A   B \n C ')).toBe('A B C');
    expect(deriveActState({ text: 'A  B' }, [{ id: 'x', text: 'A B' }], [])).toBe('queued');
  });

  it('lo stato porta con sé etichetta e spiegazione', () => {
    expect(actStatus({ text: 'x' }, [], []).label).toBe('preparato');
    expect(actStatus({ text: 'x' }, [{ id: 'i', text: 'x' }], []).label).toBe('accodato');
    expect(actStatus({ text: rejected.action }, [], [rejected]).label).toBe('fallito');
  });

  it('il titolo concreto dell’atto è la prima riga del testo', () => {
    expect(actHeadline({ text: '\n  Avviare il cantiere  \n— resto', title: 'Investimento' })).toBe('Avviare il cantiere');
    expect(actHeadline({ text: '   ', title: 'Investimento' })).toBe('Investimento');
  });
});
