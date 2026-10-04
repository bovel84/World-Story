import { type ReactNode } from 'react';
import { ChatsPanel } from '../Game/ChatsPanel';
import { EventFeed } from '../Game/EventFeed';
import { DiplomacyPanel } from '../Game/DiplomacyPanel';
import { NationDock } from '../Game/NationDock';
import { ForcesPanel } from '../Game/ForcesPanel';
import { EmptyState } from '../Game/NationDock/widgets';
import type { NationResources } from '../Game/NationDock';
import type { ArsenalResponse, Commitment, CrisisSnapshot, FiscalPolicyInfo, GovernmentSnapshot, GovernmentVoicesResponse, PeacetimePressure, PowerAgenda } from '../../services/api';
import { SaveGameModal } from '../Game/SaveGameModal';
import { useToast } from '../ui/ToastProvider';
import { ConfirmDialog } from '../ui/ConfirmDialog';
import { chatsApi, gameApi } from '../../services/api';
import type { Region, World, Game } from '../../types';
import type { ActiveModule } from '../../stores/moduleState';

interface DeskContentProps {
  activeModule: ActiveModule;
  closeModule: () => void;
  /** V01 — apre un altro modulo da dentro il desk (es. dalla sintesi alle Questioni). */
  openModule: (module: ActiveModule) => void;
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
  /** C01 — i dati territoriali canonici, per i grafici del Consulente. */
  worldMapAssets?: import('../../services/api').WorldMapAssetsPayload | null;
  /** Anime del governo e dettaglio del bilancio pubblicati dal motore. */
  nationalGovernment?: GovernmentSnapshot | null;
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
}

export function DeskContent({
  activeModule,
  closeModule,
  openModule,
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
  worldMapAssets = null,
  nationalGovernment = null,
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
}: DeskContentProps) {
  const { notify } = useToast();

  // Contenuto vuoto quando nessun modulo attivo
  if (activeModule === 'none') {
    return null;
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

  // D-1 — Modulo Forze: la sala operativa, fuori dal dossier nazionale.
  // Stesso principio di Questioni: il dossier si legge, la sala si comanda.
  if (activeModule === 'forze') {
    return (
      <div className="forces-desk" style={{ position: 'relative', height: '100%' }}>
        <button type="button" className="desk-close-x" onClick={closeModule} aria-label="Chiudi forze" title="Chiudi">✕</button>
        <ForcesPanel
          arsenal={nationalArms}
          snapshotKey={snapshotKey}
          onPreviewFormation={onPreviewFormation}
          onRaiseFormation={onRaiseFormation}
          onUnitAction={onUnitAction}
          onUnitOrder={onUnitOrder}
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
            {/* N01/N7: se il motore non pubblica il nome della polity, il dossier
                lo dichiara. Il ripiego precedente mescolava tre fonti diverse
                (nome inglese del registro, nome della provincia, codice) e su un
                mondo provinciale intitolava il dossier «Alaska». */}
            <div className="nation-module-title">{nationalName || 'Nome del paese non pubblicato'}</div>
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
            // D-1 — le props operative (creazione reparti, azioni di reparto,
            // ordini) non entrano più nel dossier: la sala operativa è il
            // modulo `forze`, che le riceve più sopra.
            snapshotKey={snapshotKey}
            trade={tradeResource}
            accountHistory={nationalHistory}
            government={nationalGovernment}
            governmentVoices={governmentVoices}
            governmentVoicesLoading={governmentVoicesLoading}
            governmentVoicesError={governmentVoicesError}
            onLoadGovernmentVoices={onLoadGovernmentVoices}
            onBorrowDebt={onBorrowDebt}
            fiscalPolicy={nationalFiscalPolicy}
            onSetFiscalPolicy={onSetFiscalPolicy}
            fiscalPolicyBusy={fiscalPolicyBusy}
            pressures={nationalPressures}
            // V05 — `recentPressures`/`onResolvePressure`/`pressureBusy` non
            // entrano più nel dossier: da V01 servono solo a Questioni.
            crisis={nationalCrisis}
            // V01 — dalla sintesi del dossier si salta al pannello Questioni
            // per rispondere a una sfida: le sfide non si risolvono più qui.
            onOpenQuestions={() => openModule('orders')}
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