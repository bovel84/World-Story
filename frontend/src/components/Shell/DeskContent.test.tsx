/**
 * BUG FIX — dossier nazionale vuoto dopo la selezione di una regione esterna
 * ========================================================================
 * Riproduzione reale: partita `millennium_dawn`, Palestina, turn 1. Toccando
 * una provincia esterna `externalRegionSelected` diventava `true` e il modulo
 * `nation` non montava **né** `NationDock` **né** `DiplomacyPanel`: restava solo
 * l'header, corpo completamente vuoto.
 *
 * Il Dossier nazionale è della nazione del giocatore: deve restare visibile
 * **sempre**, non dipendere da quale provincia è selezionata. Qui si fissa il
 * contratto del modulo `nation`:
 *   - nessuna provincia selezionata → `NationDock` presente;
 *   - provincia esterna selezionata → `NationDock` del giocatore presente;
 *   - provincia propria selezionata → invariato;
 *   - mai un modulo `nation` senza contenuto né `EmptyState`;
 *   - senza partita → `EmptyState` esplicito, mai body vuoto.
 *
 * `NationDock` e `DiplomacyPanel` sono sostituiti da marcatori: il test isola
 * esattamente il **gate di render** (il bug), non il contenuto dei due pannelli
 * (già coperto dai loro test). `useToast` è neutralizzato per renderizzare
 * `DeskContent` fuori da un `ToastProvider`.
 */
import { describe, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';

vi.mock('../ui/ToastProvider', () => ({
  useToast: () => ({ notify: () => {} }),
}));

vi.mock('../Game/NationDock', () => ({
  NationDock: (props: any) => (
    <div className="nation-dock" data-polity={props.playerPolityId}>
      {`DOSSIER:${props.playerPolityId}`}
    </div>
  ),
}));

vi.mock('../Game/NationDock/widgets', () => ({
  EmptyState: ({ children }: any) => <div className="nation-empty" role="note">{children}</div>,
}));

vi.mock('../Game/DiplomacyPanel', () => ({
  DiplomacyPanel: (props: any) => (
    <div className="diplomacy-panel">{`RELAZIONI:${props.selectedRegionId}`}</div>
  ),
}));

import { DeskContent } from './DeskContent';

const baseProps: any = {
  activeModule: 'nation',
  closeModule: () => {},
  currentGame: { id: 'g1', currentTurn: 1, currentDate: '2000-01-01' },
  currentWorld: { regions: {} },
  currentRegion: null,
  selectedRegion: null,
  externalRegionSelected: false,
  nationalName: 'Palestine',
  governmentType: 'Autorità nazionale palestinese',
  nationalAccount: null,
  pendingActions: [],
  suggestions: [],
  orderDraftText: '',
  updateOrderDraft: () => {},
  enhancedPreview: null,
  enhanceLoading: false,
  enhanceError: null,
  enhanceOrder: async () => {},
  acceptOrderEnhanced: () => {},
  rejectOrderEnhanced: () => {},
  registerOrder: async () => {},
  queuePlayerAction: async () => true,
  removeQueuedAction: () => {},
  updateQueuedAction: async () => {},
  editingActionId: null,
  editingActionText: '',
  setEditingActionId: () => {},
  setEditingActionText: () => {},
  isProcessingTurn: false,
  ongoingProcesses: [],
  mandateDecisions: [],
  maintenanceObligations: [],
  onAcknowledgeMandateDecision: async () => {},
  feedItems: [],
  onFocusRegion: () => {},
  playerPolityId: 'PSE',
  currentGameId: 'g1',
};

const render = (overrides: Record<string, unknown> = {}) =>
  renderToStaticMarkup(<DeskContent {...baseProps} {...overrides} />);

describe('BUG dossier nazionale — il dossier è della nazione del giocatore', () => {
  it('nessuna provincia selezionata → NationDock presente, mai body vuoto', () => {
    const html = render({ selectedRegion: null });
    expect(html).toContain('Dossier nazionale');
    expect(html).toContain('nation-dock');
    expect(html).toContain('DOSSIER:PSE');
  });

  it('provincia esterna selezionata → il dossier del giocatore resta presente', () => {
    const html = render({ selectedRegion: 'EXTERNAL', externalRegionSelected: true });
    expect(html).toContain('Dossier nazionale');
    expect(html).toContain('nation-dock');
    // I dati passati sono quelli del giocatore, non della provincia toccata.
    expect(html).toContain('DOSSIER:PSE');
    // Mantiene il comportamento preesistente della diplomazia sulle regioni esterne.
    expect(html).not.toContain('diplomacy-panel');
  });

  it('provincia propria selezionata → invariato (dossier + diplomazia)', () => {
    const html = render({ selectedRegion: 'OWN', externalRegionSelected: false });
    expect(html).toContain('DOSSIER:PSE');
    expect(html).toContain('RELAZIONI:OWN');
  });

  it('mai un modulo nation senza contenuto né EmptyState', () => {
    for (const { selectedRegion, externalRegionSelected } of [
      { selectedRegion: null, externalRegionSelected: false },
      { selectedRegion: 'OWN', externalRegionSelected: false },
      { selectedRegion: 'EXTERNAL', externalRegionSelected: true },
    ]) {
      const html = render({ selectedRegion, externalRegionSelected });
      expect(html.includes('nation-dock') || html.includes('nation-empty'), String(selectedRegion)).toBe(true);
    }
  });

  it('senza partita → EmptyState esplicito, mai body vuoto', () => {
    const html = render({ currentGame: null, selectedRegion: 'OWN' });
    expect(html).toContain('Dossier nazionale');
    expect(html).toContain('nation-empty');
    expect(html).not.toContain('nation-dock');
    // Nessuna diplomazia senza partita: niente fetch senza gameId.
    expect(html).not.toContain('diplomacy-panel');
  });
});
