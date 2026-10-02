/**
 * WS-GOVUX-P7 — La plancia delle conseguenze (render)
 * ===================================================
 * Difende ciò che il Presidente vede **prima della firma**: i quattro gruppi
 * etichettati, il contrassegno «applicato dal motore», la dichiarazione di ciò
 * che non è stimabile, e il ricalcolo esplicito quando la bozza cambia.
 */
import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { ActDraftPanel } from './ActDraftPanel';
import { ConsequenceBoardPanel } from './ConsequenceBoardPanel';
import { buildConsequenceBoard, consequenceBoardSignature, type EnginePreview } from './consequenceBoard';
import { actStatus, type ProposalActDraft } from './actDraft';
import type { TreasuryRoad } from './treasuryAct';

const road: TreasuryRoad = {
  id: 'repay',
  title: 'Ammortamento del debito',
  voice: 'Rimborsare i titoli toglie interessi dal bilancio.',
  declaredCost: '1.200 mld',
  expectedGain: '30 mld di interessi in meno all’anno',
  recommended: true,
  order: { kind: 'text', text: 'Rimborso titoli: 1.200 mld in scadenza il 1952-01-01' },
};

const draft: ProposalActDraft = {
  id: 'tesoro:repay', seat: 'tesoro', roadId: 'repay', title: 'Ammortamento del debito',
  text: road.order.kind === 'text' ? road.order.text : '',
  capability: 'text-order',
  note: 'Il motore interpreterà la prosa all’avanzamento del tempo.',
};

const preview: EnginePreview = {
  feasible: true,
  costs: {
    timeDays: 45,
    inputs: [{ resourceId: 'money', name: 'Tesoreria', quantity: '12,40', unit: 'mld' }],
    upkeep: [],
    basis: 'request',
    category: 'Infrastrutture',
  },
  prerequisites: [], risks: [], warnings: [], summary: 'Ordine fattibile',
};

const snapshot = 'game-1:3:1952-01-01:0:main';
const currentSig = () => consequenceBoardSignature({ snapshotKey: snapshot, draft });

describe('WS-GOVUX-P7 — la plancia resa', () => {
  it('mostra i quattro gruppi, la verifica del motore e l’applicato', () => {
    const board = buildConsequenceBoard({ draft, road, snapshotKey: snapshot, preview, previewSignature: currentSig() });
    const html = renderToStaticMarkup(<ConsequenceBoardPanel board={board} />);
    expect(html).toContain('Effetti diretti calcolati');
    expect(html).toContain('Previsioni del motore');
    expect(html).toContain('>Rischi<');
    expect(html).toContain('Incertezze');
    expect(html).toContain('data-group="direct"');
    expect(html).toContain('verifica del motore');
    expect(html).toContain('applicato dal motore');
    expect(html).toContain('Non stimabile');
  });

  it('senza verifica del motore dichiara la stima e non finge i costi', () => {
    const board = buildConsequenceBoard({ draft, road, snapshotKey: snapshot });
    const html = renderToStaticMarkup(<ConsequenceBoardPanel board={board} />);
    expect(html).toContain('stima dichiarata');
    expect(html).toContain('Impegno di cassa');
    expect(html).toContain('1.200 mld');
  });

  it('una stima stantia offre il ricalcolo', () => {
    const board = buildConsequenceBoard({ draft, road, snapshotKey: snapshot, preview, previewSignature: 'altra' });
    const html = renderToStaticMarkup(<ConsequenceBoardPanel board={board} onRefresh={() => {}} />);
    expect(html).toContain('data-stale="true"');
    expect(html).toContain('Ricalcola stima');
    expect(html).toContain('La bozza è cambiata');
  });
});

describe('WS-GOVUX-P7 — la plancia dentro la bozza d’atto', () => {
  it('compare PRIMA della firma', () => {
    const board = buildConsequenceBoard({ draft, road, snapshotKey: snapshot, preview, previewSignature: currentSig() });
    const html = renderToStaticMarkup(
      <ActDraftPanel draft={draft} status={actStatus(draft, [], [])} board={board} onRefreshBoard={() => {}} />,
    );
    expect(html).toContain('consequence-board');
    expect(html).toContain('Effetti diretti calcolati');
    expect(html.indexOf('consequence-board')).toBeLessThan(html.indexOf('act-draft-sign'));
  });

  it('senza plancia la bozza resta quella di prima', () => {
    const html = renderToStaticMarkup(<ActDraftPanel draft={draft} status={actStatus(draft, [], [])} />);
    expect(html).not.toContain('consequence-board');
    expect(html).toContain('act-draft-sign');
  });
});
