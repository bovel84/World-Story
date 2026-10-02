/**
 * WS-GOVUX-P7 — La plancia delle conseguenze (contratto puro)
 * ==========================================================
 * Difende le quattro regole della fase:
 *  1. i gruppi sono **distinti ed etichettati** (effetti diretti, previsioni,
 *     rischi, incertezze);
 *  2. **i costi della preview sono quelli applicati**: la plancia copia la stima
 *     del motore, non la ricalcola;
 *  3. **modificare la bozza invalida la stima**: la firma cambia e la vecchia
 *     stima è dichiarata `stale`;
 *  4. **ciò che non è simulato è non stimabile**, mai una percentuale inventata.
 */
import { describe, expect, it } from 'vitest';
import {
  CONSEQUENCE_GROUP_LABEL, buildConsequenceBoard, consequenceBoardSignature,
  type EnginePreview,
} from './consequenceBoard';
import type { ProposalActDraft } from './actDraft';
import type { CabinetItemView } from '../../services/api';
import type { TreasuryRoad } from './treasuryAct';

const textRoad: TreasuryRoad = {
  id: 'repay',
  title: 'Ammortamento del debito',
  voice: 'Rimborsare i titoli toglie interessi dal bilancio.',
  declaredCost: '1.200 mld',
  expectedGain: '30 mld di interessi in meno all’anno',
  recommended: true,
  order: { kind: 'text', text: 'Rimborso titoli: 1.200 mld in scadenza il 1952-01-01' },
};

const textDraft: ProposalActDraft = {
  id: 'tesoro:repay',
  seat: 'tesoro',
  roadId: 'repay',
  title: 'Ammortamento del debito',
  text: textRoad.order.kind === 'text' ? textRoad.order.text : '',
  capability: 'text-order',
  note: 'Il motore interpreterà la prosa all’avanzamento del tempo.',
};

const workItem: CabinetItemView = {
  voiceId: 'hospital',
  need: 'Coprire il disavanzo',
  because: 'Le uscite superano le entrate',
  urgency: 'urgente',
  figures: [
    { label: 'Costo stimato', value: '1.200', unit: 'mld', basis: { kind: 'estimated', source: 'catalogo', method: 'ricetta' } },
  ],
  paths: [],
  work: { workId: 'hospital', name: 'Ospedale' },
  declaration: { workId: 'hospital', payerActorId: 'p1', materialActorId: 'a1', funded: false, missingMaterials: [{ resourceId: 'acciaio', missing: '40 t' }] },
};

const workRoad: TreasuryRoad = {
  id: 'invest',
  title: 'Investimento',
  voice: 'Aprire il cantiere per l’Ospedale.',
  declaredCost: 'distinta scoperta: acciaio (40 t)',
  expectedGain: 'l’opera consegna il suo effetto dichiarato nel catalogo',
  recommended: false,
  order: { kind: 'work', item: workItem, path: { id: 'build_now', title: 'Costruisci', detail: '', prerequisites: [], expected: '', recommended: true } },
};

const workDraft: ProposalActDraft = {
  id: 'tesoro:invest',
  seat: 'tesoro',
  roadId: 'invest',
  title: 'Investimento',
  text: 'Fondo per le opere: Ospedale',
  capability: 'engine-order',
  note: 'Distinta scoperta: mancano acciaio (40 t).',
  work: { workId: 'hospital', payerActorId: 'p1', materialActorId: 'a1', funded: false },
};

const preview: EnginePreview = {
  feasible: true,
  costs: {
    timeDays: 45,
    inputs: [{ resourceId: 'money', name: 'Tesoreria', quantity: '12,40', unit: 'mld' }],
    upkeep: [],
    basis: 'request',
    note: '25% del gettito annuo',
    category: 'Infrastrutture',
  },
  prerequisites: [],
  risks: [],
  warnings: [],
  summary: 'Ordine fattibile',
};

const snapshot = 'game-1:3:1952-01-01:0:main';
const sig = (draft: ProposalActDraft) => consequenceBoardSignature({ snapshotKey: snapshot, draft });

describe('WS-GOVUX-P7 — la firma del preventivo', () => {
  it('è stabile per la stessa bozza e cambia quando il testo cambia', () => {
    expect(sig(textDraft)).toBe(sig(textDraft));
    const edited: ProposalActDraft = { ...textDraft, text: `${textDraft.text} (corretto)` };
    expect(sig(edited)).not.toBe(sig(textDraft));
  });

  it('cambia quando cambia lo snapshot del mondo, non l’istante tecnico', () => {
    const other = consequenceBoardSignature({ snapshotKey: 'game-1:4:1952-02-01:0:main', draft: textDraft });
    expect(other).not.toBe(sig(textDraft));
  });
});

describe('WS-GOVUX-P7 — quattro gruppi distinti ed etichettati', () => {
  it('la plancia ha sempre i quattro gruppi, nell’ordine dichiarato', () => {
    const board = buildConsequenceBoard({ draft: textDraft, road: textRoad, snapshotKey: snapshot });
    expect(board.groups.map(group => group.id)).toEqual(['direct', 'predicted', 'risks', 'uncertainties']);
    expect(board.groups[0].label).toBe(CONSEQUENCE_GROUP_LABEL.direct);
    expect(board.groups[3].label).toBe(CONSEQUENCE_GROUP_LABEL.uncertainties);
  });

  it('gli effetti sociali sono dichiarati non stimabili', () => {
    const board = buildConsequenceBoard({ draft: textDraft, road: textRoad, snapshotKey: snapshot });
    expect(board.groups[3].entries.some(entry => entry.label === 'Effetti sociali')).toBe(true);
    expect(board.notEstimable.join(' ')).toContain('Effetti sociali');
  });
});

describe('WS-GOVUX-P7 — i costi della preview sono quelli applicati', () => {
  it('con la verifica del motore, la plancia copia i costi riga per riga', () => {
    const board = buildConsequenceBoard({
      draft: textDraft, road: textRoad, snapshotKey: snapshot,
      preview, previewSignature: sig(textDraft),
    });
    expect(board.status).toBe('engine-preview');
    const direct = board.groups[0].entries.filter(entry => entry.applied);
    expect(direct.some(entry => entry.label === 'Tesoreria' && entry.detail === '12,40 mld')).toBe(true);
    expect(direct.some(entry => entry.label === 'Durata' && entry.detail === '45 giorni per ciclo')).toBe(true);
    // La stima è la stessa del motore: nessun ricalcolo, nessun arrotondamento.
    expect(direct.find(entry => entry.label === 'Tesoreria')?.detail).toBe(preview.costs.inputs[0].quantity + ' ' + preview.costs.inputs[0].unit);
  });

  it('senza verifica, l’ordine in prosa dichiara il costo e non lo finge applicato', () => {
    const board = buildConsequenceBoard({ draft: textDraft, road: textRoad, snapshotKey: snapshot });
    expect(board.status).toBe('declared');
    const direct = board.groups[0].entries;
    expect(direct[0].label).toBe('Impegno di cassa');
    expect(direct[0].detail).toBe('1.200 mld');
    expect(direct[0].applied).toBe(false);
    expect(board.groups[3].entries.some(entry => entry.label === 'Costo applicato')).toBe(true);
  });

  it('la stima di un’altra versione della bozza è dichiarata stale e non usata', () => {
    const edited: ProposalActDraft = { ...textDraft, text: `${textDraft.text} (corretto)` };
    const board = buildConsequenceBoard({
      draft: edited, road: textRoad, snapshotKey: snapshot,
      preview, previewSignature: sig(textDraft),
    });
    expect(board.stale).toBe(true);
    expect(board.status).toBe('declared');
    expect(board.groups[0].entries.every(entry => entry.label !== 'Tesoreria')).toBe(true);
  });
});

describe('WS-GOVUX-P7 — l’opera e l’ignoto', () => {
  it('la distinta scoperta è un rischio, non un costo applicato', () => {
    const board = buildConsequenceBoard({ draft: workDraft, road: workRoad, item: workItem, snapshotKey: snapshot });
    expect(board.status).toBe('declared');
    const risks = board.groups[2].entries;
    expect(risks.some(entry => entry.label === 'Distinta scoperta' && entry.detail.includes('acciaio'))).toBe(true);
    expect(board.groups[0].entries.some(entry => entry.applied)).toBe(true);
  });

  it('le cifre stimate diventano incertezze, mai percentuali inventate', () => {
    const board = buildConsequenceBoard({ draft: workDraft, road: workRoad, item: workItem, snapshotKey: snapshot });
    const uncertainties = board.groups[3].entries;
    expect(uncertainties.some(entry => entry.label === 'Costo stimato' && entry.basis === 'estimated')).toBe(true);
    // La plancia non introduce percentuali proprie: le uniche che possono
    // comparire vengono dal testo del motore, non da un calcolo locale.
    const own = board.groups.flatMap(group => group.entries).filter(entry => entry.label !== 'Avviso del motore');
    expect(own.some(entry => entry.detail.includes('%'))).toBe(false);
  });

  it('una funzione assente è dichiarata non stimabile, senza numeri', () => {
    const unsupported: ProposalActDraft = {
      ...workDraft, capability: 'unsupported', work: undefined,
      note: 'Nessun comando supportato: registrare l’atto non produrrebbe l’effetto dichiarato.',
    };
    const board = buildConsequenceBoard({ draft: unsupported, road: workRoad, item: workItem, snapshotKey: snapshot });
    expect(board.status).toBe('not-estimable');
    expect(board.groups[2].entries.some(entry => entry.label === 'Funzione assente')).toBe(true);
    expect(board.notEstimable.join(' ')).toContain('Nessun comando');
  });
});
