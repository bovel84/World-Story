import { type ReactNode } from 'react';
import { ActionsPanel } from '../Game/ActionsPanel';
import { AdvisorChat } from '../Game/AdvisorChat';
import { ChatsPanel } from '../Game/ChatsPanel';
import { EventFeed } from '../Game/EventFeed';
import { DiplomacyPanel } from '../Game/DiplomacyPanel';
import { NationDock } from '../Game/NationDock';
import { SaveGameModal } from '../Game/SaveGameModal';
import { useToast } from '../ui/ToastProvider';
import { ConfirmDialog } from '../ui/ConfirmDialog';
import { chatsApi } from '../../services/api';
import type { Region, World, Game } from '../../types';
import type { Suggestion } from '../../stores';
import type { ActiveModule } from '../../stores/moduleState';

interface DeskContentProps {
  activeModule: ActiveModule;
  closeModule: () => void;
  currentGame: Game | null;
  currentWorld: World | null;
  currentRegion: Region | null;
  selectedRegion: string | null;
  externalRegionSelected: boolean;
  nationalName: string;
  governmentType: string;
  nationalAccount: any;
  nationalHistory?: Array<{ date: string; turn?: number; account: Record<string, any> }>;
  campaignProgress: number;
  latestNationalNarration: string;
  currentRegionOwnerName: string | null;
  selectedIsPlayerProvince: boolean;
  isPaxProvince: boolean;
  provinceAssets: { factories: number; ports: number; cities: number; capital: boolean; units: number };
  provinceMetadata: { surface_type?: string; tags?: string[] };
  infrastructureLevel: number;
  pendingActions: Array<{ id: string; text: string }>;
  suggestions: Suggestion[];
  orderDraftText: string;
  updateOrderDraft: (text: string) => void;
  enhancedPreview: string | null;
  enhanceLoading: boolean;
  enhanceError: string | null;
  enhanceOrder: (text: string) => Promise<void>;
  acceptOrderEnhanced: () => void;
  rejectOrderEnhanced: () => void;
  registerOrder: (text: string) => Promise<void>;
  queuePlayerAction: (text: string) => Promise<boolean>;
  removeQueuedAction: (id: string) => void;
  updateQueuedAction: (id: string, text: string) => void;
  editingActionId: string | null;
  editingActionText: string;
  setEditingActionId: (id: string | null) => void;
  setEditingActionText: (text: string) => void;
  isProcessingTurn: boolean;
  /** Processi letti dal registro simulazione, per il dossier nazionale G5-A. */
  ongoingProcesses: Array<{ id: string; title: string; summary: string; started_date: string; expected_date?: string | null }>;
  mandateDecisions: Array<{ mandateId: string; kind: string; resourceId: string; minStock: string; availableStock: string; shortfall: string; asOfDate: string; status: string }>;
  onAcknowledgeMandateDecision: (mandateId: string, kind: string) => Promise<void>;
  feedItems: any[];
  /** G4-C: seleziona una regione sulla mappa (da «Mostra sulla mappa»). */
  onFocusRegion: (regionId: string) => void;
  /** Segna un dispaccio come letto all'apertura dell'articolo. */
  onMarkFeedRead?: (id: string) => void;
  /** «Segna tutti come letti» dal pannello Dispacci. */
  onMarkAllFeedRead?: () => void;
  playerPolityId: string;
  showSaveModal: boolean;
  setShowSaveModal: (v: boolean) => void;
  setShowPromptEditor: (v: boolean) => void;
  setShowLLMSettings: (v: boolean) => void;
  onOpenSavePicker: () => void;
  currentGameId: string | undefined;
  onGenerateSuggestions?: () => void;
  suggestionsLoading?: boolean;
  suggestionsError?: string;
}

export function DeskContent({
  activeModule,
  closeModule,
  currentGame,
  currentWorld,
  currentRegion,
  selectedRegion,
  externalRegionSelected,
  nationalName,
  governmentType,
  nationalAccount,
  nationalHistory = [],
  campaignProgress,
  latestNationalNarration,
  currentRegionOwnerName,
  selectedIsPlayerProvince,
  isPaxProvince,
  provinceAssets,
  provinceMetadata,
  infrastructureLevel,
  pendingActions,
  suggestions,
  orderDraftText,
  updateOrderDraft,
  enhancedPreview,
  enhanceLoading,
  enhanceError,
  enhanceOrder,
  acceptOrderEnhanced,
  rejectOrderEnhanced,
  registerOrder,
  queuePlayerAction,
  removeQueuedAction,
  updateQueuedAction,
  editingActionId,
  editingActionText,
  setEditingActionId,
  setEditingActionText,
  isProcessingTurn,
  ongoingProcesses,
  mandateDecisions,
  onAcknowledgeMandateDecision,
  feedItems,
  onFocusRegion,
  onMarkFeedRead,
  onMarkAllFeedRead,
  playerPolityId,
  showSaveModal,
  setShowSaveModal,
  setShowPromptEditor,
  setShowLLMSettings,
  onOpenSavePicker,
  currentGameId,
  onGenerateSuggestions,
  suggestionsLoading,
  suggestionsError,
}: DeskContentProps) {
  const { notify } = useToast();

  // Contenuto vuoto quando nessun modulo attivo
  if (activeModule === 'none') {
    return null;
  }

  // Modulo Ordini
  if (activeModule === 'orders') {
    return (
      <div className="suggestions-content">
        <div className="council-head">
          <div className="council-title">Pianifica la prossima mossa</div>
          <div className="council-sub">Ordini concreti costruiti sulla mappa, la cronaca e la tua strategia</div>
          <button
            className="btn-generate-suggestions"
            disabled={!!suggestionsLoading}
            onClick={() => onGenerateSuggestions?.()}
          >
            {suggestionsLoading ? 'Elaborazione…' : 'Elabora proposte'}
          </button>
          {suggestionsError && (
            <div className="suggestions-error" role="alert">{suggestionsError}</div>
          )}
        </div>
        <button
          type="button"
          className="desk-close-x"
          onClick={closeModule}
          aria-label="Chiudi pannello"
          title="Chiudi"
        >
          ✕
        </button>

        {suggestions.length > 0 && (
          <div
            className="suggestions-list"
            aria-live="polite"
            aria-label={`${suggestions.length} temi strategici generati`}
          >
            {suggestions.map((suggestion, topicIndex) => (
              <section
                key={`${suggestion.topic}-${topicIndex}`}
                className="suggestion-item"
                aria-labelledby={`suggestion-topic-${topicIndex}`}
              >
                <div id={`suggestion-topic-${topicIndex}`} className="suggestion-topic">
                  {suggestion.topic}
                </div>
                <div className="suggestion-description">{suggestion.description}</div>
                {suggestion.actions.map((action, actionIndex) => {
                  const content = action.content.trim();
                  const queued = pendingActions.some(item => item.text.trim() === content);
                  return (
                    <button
                      type="button"
                      key={`${action.title}-${actionIndex}`}
                      className={`suggestion-action${queued ? ' queued' : ''}`}
                      disabled={queued || !content}
                      onClick={() => void queuePlayerAction(content)}
                      title={queued ? 'Azione già nel piano' : 'Aggiungi questa proposta al piano'}
                    >
                      <span className="suggestion-action-plus" aria-hidden="true">{queued ? '✓' : '+'}</span>
                      <span className="suggestion-action-body">
                        <b>{action.title}</b>
                        <span>{content}</span>
                      </span>
                      <span className="suggestion-action-cta">{queued ? 'Aggiunta' : 'Usa'}</span>
                    </button>
                  );
                })}
              </section>
            ))}
          </div>
        )}

        <div className="pending-actions-section">
          <div className="pending-header">In attesa di elaborazione:</div>
          {pendingActions.length === 0 ? (
            <div className="pending-empty">Nessuna azione</div>
          ) : (
            <div className="pending-list">
              {pendingActions.map((action, index) => (
                <div key={action.id} className="pending-item">
                  <span className="pending-number">{index + 1}.</span>
                  {editingActionId === action.id ? (
                    <>
                      <textarea
                        className="pending-edit-input"
                        value={editingActionText}
                        onChange={(e) => setEditingActionText(e.target.value)}
                        rows={2}
                        aria-label={`Modifica azione ${index + 1}`}
                      />
                      <button
                        className="btn-save-pending"
                        disabled={!editingActionText.trim()}
                        onClick={() => void updateQueuedAction(action.id, editingActionText)}
                        title="Salva la modifica"
                        aria-label={`Salva modifica azione ${index + 1}`}
                      >
                        ✓
                      </button>
                      <button
                        className="btn-cancel-pending"
                        onClick={() => { setEditingActionId(null); setEditingActionText(''); }}
                        title="Annulla la modifica"
                        aria-label={`Annulla modifica azione ${index + 1}`}
                      >
                        ✕
                      </button>
                    </>
                  ) : (
                    <>
                      <span className="pending-text">{action.text}</span>
                      <button
                        className="btn-edit-pending"
                        onClick={() => { setEditingActionId(action.id); setEditingActionText(action.text); }}
                        title="Modifica l'ordine prima della presa in carico"
                        aria-label={`Modifica azione ${index + 1}`}
                      >
                        ✎
                      </button>
                      <button
                        className="btn-remove-pending"
                        onClick={() => void removeQueuedAction(action.id)}
                        title="Rimuovi dalla coda"
                        aria-label={`Rimuovi azione ${index + 1}`}
                      >
                        ×
                      </button>
                    </>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>

        <ActionsPanel
          text={orderDraftText}
          onTextChange={updateOrderDraft}
          enhancedPreview={enhancedPreview}
          enhanceLoading={enhanceLoading}
          enhanceError={enhanceError}
          onEnhance={(t) => void enhanceOrder(t)}
          onAcceptEnhanced={acceptOrderEnhanced}
          onRejectEnhanced={rejectOrderEnhanced}
          onRegister={(t) => void registerOrder(t)}
        />

        <div className="suggestions-footer">
          <span className="pending-advance-hint">
            {pendingActions.length > 0
              ? `${pendingActions.length} ${pendingActions.length === 1 ? 'ordine pronto' : 'ordini pronti'} · gli eventi inizieranno solo quando avanzi il tempo dalla data in alto.`
              : 'Aggiungi un ordine al piano: non passerà tempo finché non scegli una data.'}
          </span>
          <button
            className="btn-submit-actions"
            disabled={pendingActions.length === 0}
            onClick={closeModule}
            title="Chiudi il piano: gli ordini restano in attesa"
          >
            Chiudi piano
          </button>
        </div>
      </div>
    );
  }

  // Modulo Consulente
  if (activeModule === 'advisor' && currentGame) {
    return (
      <div className="advisor-chat-wrap" style={{ position: 'relative', height: '100%' }}>
        <button type="button" className="desk-close-x" onClick={closeModule} aria-label="Chiudi consulente" title="Chiudi">✕</button>
        <AdvisorChat gameId={currentGame.id} />
      </div>
    );
  }

  // Modulo Diplomazia: chat diplomatiche (scelta originaria del modulo 💬)
  if (activeModule === 'diplomacy' && currentGame) {
    return (
      <div className="diplomacy-chat-wrap" style={{ position: 'relative', height: '100%' }}>
        <button type="button" className="desk-close-x" onClick={closeModule} aria-label="Chiudi chat diplomatiche" title="Chiudi">✕</button>
        <ChatsPanel
          gameId={currentGame.id}
          regions={currentWorld?.regions ? Object.values(currentWorld.regions) as Region[] : []}
          playerPolityId={playerPolityId}
        />
      </div>
    );
  }

  // Modulo Notizie
  if (activeModule === 'news') {
    return (
      <div className="news-feed-wrap" style={{ position: 'relative', height: '100%' }}>
        <button type="button" className="desk-close-x" onClick={closeModule} aria-label="Chiudi notizie" title="Chiudi">✕</button>
        <EventFeed
          items={feedItems}
          processing={isProcessingTurn}
          focusedRegionName={currentRegion?.name}
          onFocusRegion={onFocusRegion}
          onMarkRead={onMarkFeedRead}
          onMarkAllRead={onMarkAllFeedRead}
          playerPolityName={nationalName}
        />
      </div>
    );
  }

  // Modulo Nazione
  if (activeModule === 'nation') {
    return (
      <div className="nation-desk">
        <header className="nation-module-header">
          <div>
            <div className="nation-module-kicker">Dossier nazionale</div>
            <div className="nation-module-title">Nazione</div>
          </div>
          <button
            className="nation-module-close"
            onClick={closeModule}
            title="Chiudi nazione"
            aria-label="Chiudi nazione"
          >×</button>
        </header>

        {selectedRegion && !externalRegionSelected && (
          <NationDock
            nationalName={nationalName}
            governmentType={governmentType}
            account={nationalAccount}
            accountHistory={nationalHistory}
            regions={currentWorld?.regions ? Object.values(currentWorld.regions).filter((region) => region.owner === playerPolityId) as Region[] : []}
            ongoingProcesses={ongoingProcesses}
            mandateDecisions={mandateDecisions}
            onAcknowledgeMandateDecision={onAcknowledgeMandateDecision}
            campaignProgress={campaignProgress}
            latestNarration={latestNationalNarration}
          />
        )}

        {selectedRegion && !externalRegionSelected && (
          <div className="country-selector">
            <label>La tua nazione:</label>
            <div className="country-locked">
              {currentGame?.players[0] && (
                <span style={{ color: currentRegion?.color || '#fff' }}>
                  {currentRegion?.name || 'Sconosciuto'}
                </span>
              )}
            </div>
          </div>
        )}

        {currentRegion && (
          <div className="country-info province-detail-card">
            <div className="province-detail-kicker">{selectedIsPlayerProvince ? 'Provincia · La tua nazione' : 'Provincia selezionata'}</div>
            <div className="country-name province-detail-title" style={{ color: currentRegion.color }}>
              {currentRegion.name}
            </div>
            {!selectedIsPlayerProvince && currentRegionOwnerName && (
              <div className="province-owner">Appartenente a: {currentRegionOwnerName}</div>
            )}
            <div className="country-stats">
              <span><b>POP.</b> {currentRegion.population?.toLocaleString() || '1,000,000'}</span>
              <span><b>PIL</b> {currentRegion.gdp || 100}</span>
              <span><b>FORZE</b> {currentRegion.militaryPower || 100}</span>
            </div>
            {isPaxProvince && selectedIsPlayerProvince && (
              <div className="province-dossier">
                <div className="province-dossier-kicker">Provincia · {provinceMetadata.surface_type || 'Terra'}</div>
                <div className="province-assets">
                  <span title="Livello infrastrutture, sviluppabile con gli ordini">⌁ INFRA <b>L{infrastructureLevel}</b></span>
                  <span title="Impianti industriali presenti">⚙ FAB. <b>{provinceAssets.factories}</b></span>
                  <span title="Porti presenti">⚓ PORTI <b>{provinceAssets.ports}</b></span>
                  <span title="Centri urbani nella provincia">● CITTÀ <b>{provinceAssets.cities + (provinceAssets.capital ? 1 : 0)}</b></span>
                  <span title="Unità militari schierate">▲ UNITÀ <b>{provinceAssets.units}</b></span>
                </div>
                {Array.isArray(provinceMetadata.tags) && provinceMetadata.tags.length > 0 && (
                  <div className="province-tags">{provinceMetadata.tags.slice(0, 3).join(' · ')}</div>
                )}
              </div>
            )}
          </div>
        )}

        {currentGame && selectedRegion && !externalRegionSelected && (
          <DiplomacyPanel
            gameId={currentGame.id}
            selectedRegionId={selectedRegion}
            regions={currentWorld?.regions ? Object.values(currentWorld.regions) as any[] : []}
            refreshKey={currentGame.currentTurn}
          />
        )}

        <div className="save-load-section">
          <button className="btn-save" onClick={() => setShowSaveModal(true)}>Salva</button>
          <button className="btn-load" onClick={onOpenSavePicker}>Carica</button>
          <button className="btn-edit-prompt" onClick={() => { setShowPromptEditor(true); }} title="Modifica il prompt del mondo">Mondo</button>
          <button className="btn-edit-prompt" onClick={() => setShowLLMSettings(true)} title="Scegli il modello IA">Modello</button>
        </div>
      </div>
    );
  }

  return null;
}

export default DeskContent;