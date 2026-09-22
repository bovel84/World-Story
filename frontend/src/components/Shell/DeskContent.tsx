import { type ReactNode } from 'react';
import { ActionsPanel } from '../Game/ActionsPanel';
import { AdvisorChat } from '../Game/AdvisorChat';
import { ChatsPanel } from '../Game/ChatsPanel';
import { EventFeed } from '../Game/EventFeed';
import { DiplomacyPanel } from '../Game/DiplomacyPanel';
import { NationDock } from '../Game/NationDock';
import { EmptyState } from '../Game/NationDock/widgets';
import type { NationResources } from '../Game/NationDock';
import type { ArsenalResponse, Commitment, CrisisSnapshot, FiscalPolicyInfo, GovernmentSnapshot, GovernmentVoicesResponse, PeacetimePressure, PowerAgenda } from '../../services/api';
import { SaveGameModal } from '../Game/SaveGameModal';
import { useToast } from '../ui/ToastProvider';
import { ConfirmDialog } from '../ui/ConfirmDialog';
import { chatsApi, gameApi } from '../../services/api';
import type { Region, World, Game } from '../../types';
import type { Suggestion } from '../../stores';
import { resolveSuggestionToggle } from '../Game/suggestionToggle';
import { suggestionsEmptyHint } from '../Game/suggestionsLifecycle';
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
  nationalResources?: NationResources | null;
  nationalArms?: ArsenalResponse | null;
  procureEquipment?: (mode: 'build' | 'buy', equipmentId: string, quantity?: number) => Promise<void>;
  /** OP-OBJECTS — anteprima della creazione di reparti (sola lettura). */
  onPreviewFormation?: (options: { formations?: number; armyId?: string | null; name?: string }) => Promise<import('../../services/api').FormationImpactPayload>;
  /** OP-OBJECTS — crea davvero i reparti: paga il materiale e aggiunge l'armata. */
  onRaiseFormation?: (options: { formations?: number; armyId?: string | null; name?: string }) => Promise<unknown>;
  /** MILITARY-UNITS — azione su un reparto (anteprima `dryRun` o esecuzione). */
  onUnitAction?: (request: import('../../services/api').UnitActionRequest) => Promise<import('../../services/api').UnitActionImpactPayload>;
  /** MILITARY-UNITS PR2 — mossa del reparto sul fronte. */
  onUnitOrder?: (request: import('../../services/api').UnitOrderRequest) => Promise<import('../../services/api').UnitOrderImpactPayload>;
  /** MAP P4.1 — identità dello snapshot canonico: un cambio invalida le preview aperte. */
  snapshotKey?: string;
  tradeResource?: (mode: 'sell' | 'buy', resourceId: string, quantity: number) => Promise<void>;
  nationalHistory?: Array<{ date: string; turn?: number; account: Record<string, any> }>;
  /** Anime del governo e dettaglio del bilancio pubblicati dal motore. */
  nationalGovernment?: GovernmentSnapshot | null;
  /** Trasforma la richiesta di una fazione in una bozza d'ordine. */
  onDraftGovernmentPetition?: (text: string) => void;
  /** Voci del consiglio generate dall'LLM (on-demand, per il turno corrente). */
  governmentVoices?: GovernmentVoicesResponse | null;
  governmentVoicesLoading?: boolean;
  governmentVoicesError?: string | null;
  onLoadGovernmentVoices?: () => void;
  /** La nazione fa debito: emette titoli con tasso e scadenza. */
  onBorrowDebt?: (amountMld: number, termYears: number) => Promise<void>;
  /** Politica fiscale scelta dal giocatore (aliquota, limiti, effetti). */
  nationalFiscalPolicy?: FiscalPolicyInfo | null;
  onSetFiscalPolicy?: (taxRatePct: number) => Promise<void>;
  fiscalPolicyBusy?: boolean;
  /** Sfide di pace attive e ultime chiuse. */
  nationalPressures?: PeacetimePressure[];
  recentPressures?: PeacetimePressure[];
  onResolvePressure?: (pressureId: string, optionId: string) => Promise<void>;
  pressureBusy?: boolean;
  /** Crisi nazionale: rischi di collasso ed eventuale epilogo. */
  nationalCrisis?: CrisisSnapshot | null;
  /** GAMEPLAY-LONG: obiettivi persistenti delle potenze del teatro. */
  strategicAgenda?: { powers: PowerAgenda[] } | null;
  /** Registro strutturato degli impegni (trattati, promesse, ultimatum). */
  commitments?: { commitments: Commitment[]; attention: Commitment[] } | null;
  /** LW06.1 — briefing già derivato in `GameScreen` (stessa read model). */
  briefing?: import('../Game/strategicBriefing').StrategicBriefing;
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
  ongoingProcesses: Array<{ id: string; title: string; summary: string; started_date: string; expected_date?: string | null; progress?: number | null; progress_note?: string | null }>;
  completedProcesses?: Array<{ id: string; title: string; summary: string; started_date: string; expected_date?: string | null; completed_date?: string | null }>;
  mandateDecisions: Array<{ mandateId: string; kind: string; resourceId: string; minStock: string; availableStock: string; shortfall: string; asOfDate: string; status: string }>;
  maintenanceObligations: Array<{ facilityId: string; typeId: string; typeName: string; regionId: string; operational: boolean; resourceId: string; baseUnits: string; periodDays: number; available: string; sufficient: boolean; shortfall: string }>;
  onAcknowledgeMandateDecision: (mandateId: string, kind: string) => Promise<void>;
  feedItems: any[];
  /** G4-C: seleziona una regione sulla mappa (da «Mostra sulla mappa»). */
  onFocusRegion: (regionId: string) => void;
  /** Segna un dispaccio come letto all'apertura dell'articolo. */
  onMarkFeedRead?: (id: string) => void;
  /** «Segna tutti come letti» dal pannello Dispacci. */
  onMarkAllFeedRead?: () => void;
  playerPolityId: string;
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
  nationalResources,
  nationalArms,
  procureEquipment,
  onPreviewFormation,
  onRaiseFormation,
  onUnitAction,
  onUnitOrder,
  snapshotKey,
  tradeResource,
  nationalHistory = [],
  nationalGovernment = null,
  onDraftGovernmentPetition,
  governmentVoices = null,
  governmentVoicesLoading = false,
  governmentVoicesError = null,
  onLoadGovernmentVoices,
  onBorrowDebt,
  nationalFiscalPolicy = null,
  onSetFiscalPolicy,
  fiscalPolicyBusy = false,
  nationalPressures = [],
  recentPressures = [],
  onResolvePressure,
  pressureBusy = false,
  nationalCrisis = null,
  strategicAgenda = null,
  commitments = null,
  briefing,
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
  completedProcesses = [],
  mandateDecisions,
  maintenanceObligations,
  onAcknowledgeMandateDecision,
  feedItems,
  onFocusRegion,
  onMarkFeedRead,
  onMarkAllFeedRead,
  playerPolityId,
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

        {suggestions.length === 0 && !suggestionsLoading && !suggestionsError && (
          <p className="suggestions-empty" role="status">{suggestionsEmptyHint()}</p>
        )}

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
                  const toggle = resolveSuggestionToggle(pendingActions, content);
                  const queued = toggle.kind === 'remove';
                  return (
                    <button
                      type="button"
                      key={`${action.title}-${actionIndex}`}
                      className={`suggestion-action${queued ? ' queued' : ''}`}
                      disabled={!content}
                      aria-pressed={queued}
                      onClick={() => {
                        if (toggle.kind === 'remove') void removeQueuedAction(toggle.id);
                        else void queuePlayerAction(content);
                      }}
                      title={queued ? 'Rimuovi questa proposta dal piano' : 'Aggiungi questa proposta al piano'}
                    >
                      <span className="suggestion-action-plus" aria-hidden="true">{queued ? '✓' : '+'}</span>
                      <span className="suggestion-action-body">
                        <b>{action.title}</b>
                        <span>{content}</span>
                      </span>
                      <span className="suggestion-action-cta">{queued ? 'Rimuovi' : 'Usa'}</span>
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
            <div className="nation-module-title">{nationalName || 'Nazione'}</div>
          </div>
          <button
            className="nation-module-close"
            onClick={closeModule}
            title="Chiudi nazione"
            aria-label="Chiudi nazione"
          >×</button>
        </header>

        {currentGame ? (
          <NationDock
            playerPolityId={playerPolityId}
            governmentType={governmentType}
            account={nationalAccount}
            resources={nationalResources}
            arms={nationalArms}
            procure={procureEquipment}
            onPreviewFormation={onPreviewFormation}
            onRaiseFormation={onRaiseFormation}
            onUnitAction={onUnitAction}
            onUnitOrder={onUnitOrder}
            snapshotKey={snapshotKey}
            trade={tradeResource}
            accountHistory={nationalHistory}
            government={nationalGovernment}
            onDraftOrder={onDraftGovernmentPetition}
            governmentVoices={governmentVoices}
            governmentVoicesLoading={governmentVoicesLoading}
            governmentVoicesError={governmentVoicesError}
            onLoadGovernmentVoices={onLoadGovernmentVoices}
            onBorrowDebt={onBorrowDebt}
            fiscalPolicy={nationalFiscalPolicy}
            onSetFiscalPolicy={onSetFiscalPolicy}
            fiscalPolicyBusy={fiscalPolicyBusy}
            pressures={nationalPressures}
            recentPressures={recentPressures}
            onResolvePressure={onResolvePressure}
            pressureBusy={pressureBusy}
            crisis={nationalCrisis}
            strategicAgenda={strategicAgenda}
            commitments={commitments}
            today={currentGame?.currentDate || ''}
            briefing={briefing}
            regions={currentWorld?.regions ? Object.values(currentWorld.regions).filter((region) => region.owner === playerPolityId) as Region[] : []}
            ongoingProcesses={ongoingProcesses}
            completedProcesses={completedProcesses}
            mandateDecisions={mandateDecisions}
            maintenanceObligations={maintenanceObligations}
            onAcknowledgeMandateDecision={onAcknowledgeMandateDecision}
          />
        ) : (
          <EmptyState>Apri una partita per consultare il dossier nazionale.</EmptyState>
        )}

        {currentGame && selectedRegion && !externalRegionSelected && (
          <DiplomacyPanel
            gameId={currentGame.id}
            selectedRegionId={selectedRegion}
            regions={currentWorld?.regions ? Object.values(currentWorld.regions) as any[] : []}
            refreshKey={currentGame.currentTurn}
          />
        )}
      </div>
    );
  }

  return null;
}

export default DeskContent;