/**
 * World Story — Fase 2: `GameModals`
 * =================================
 * I dialoghi sovrapposti della partita — conferma rewind, scelta/creazione
 * salvataggio, fine partita, conferma caricamento, verifica di fattibilità —
 * erano il blocco finale del JSX di `App.tsx`. Qui sono un componente con
 * props esplicite.
 *
 * Contratto invariato:
 *  - salvare una partita chiama il motore e chiude la modale in ogni caso;
 *  - un errore di salvataggio è notificato, mai ingoiato;
 *  - le conferme distruttive (rewind, load) usano il variant `destructive`.
 */
import { gameApi, type GameEnding } from '../../services/api';
import type { Game } from '../../types';
import type { SaveSummary } from './SavePickerModal';
import { SavePickerModal } from './SavePickerModal';
import { SaveGameModal } from './SaveGameModal';
import { GameOverOverlay } from './GameOverOverlay';
import { FeasibilityCheck, type FeasibilityResult } from './FeasibilityCheck';
import { ConfirmDialog } from '../ui/ConfirmDialog';
import { useToast } from '../ui/ToastProvider';

export interface GameModalsProps {
  showRewindConfirm: boolean;
  onCloseRewind: () => void;
  onConfirmRewind: () => Promise<void>;

  showSavePicker: boolean;
  currentGameId?: string;
  onCloseSavePicker: () => void;
  onSelectSave: (save: SaveSummary) => void;

  showSaveModal: boolean;
  currentGame?: Game | null;
  onCloseSaveModal: () => void;

  gameEnding: GameEnding | null;
  currentDate?: string;
  currentTurn?: number;
  loading: boolean;
  onNewGame: () => void;
  onCloseEnding: () => void;

  saveToLoad: SaveSummary | null;
  onCloseLoadConfirm: () => void;
  onConfirmLoad: (save: SaveSummary) => Promise<void>;

  showFeasibility: boolean;
  feasibilityResult: FeasibilityResult | null;
  feasibilityLoading: boolean;
  feasibilityError: string | null;
  verifyingText: string;
  onCloseFeasibility: () => void;
  onRegister: () => Promise<void>;
  onBack: () => void;
  onReverify: () => void;
}

export function GameModals({
  showRewindConfirm,
  onCloseRewind,
  onConfirmRewind,
  showSavePicker,
  currentGameId,
  onCloseSavePicker,
  onSelectSave,
  showSaveModal,
  currentGame,
  onCloseSaveModal,
  gameEnding,
  currentDate,
  currentTurn,
  loading,
  onNewGame,
  onCloseEnding,
  saveToLoad,
  onCloseLoadConfirm,
  onConfirmLoad,
  showFeasibility,
  feasibilityResult,
  feasibilityLoading,
  feasibilityError,
  verifyingText,
  onCloseFeasibility,
  onRegister,
  onBack,
  onReverify,
}: GameModalsProps) {
  const { notify } = useToast();

  return (
    <>
      <ConfirmDialog
        open={showRewindConfirm}
        onClose={onCloseRewind}
        onConfirm={onConfirmRewind}
        title="Annullare l'ultima mossa?"
        message="Il mondo tornerà allo stato precedente. Questa azione non può essere annullata."
        confirmLabel="Annulla mossa"
        cancelLabel="Mantieni"
        variant="destructive"
      />
      <SavePickerModal
        open={showSavePicker}
        currentGameId={currentGameId}
        onClose={onCloseSavePicker}
        onSelect={onSelectSave}
      />
      {/* Fase 6: la modale di salvataggio era importata ma mai renderizzata: il
          bottone SALVA del desk non faceva nulla. Render + chiamata API. */}
      {showSaveModal && currentGame && (
        <SaveGameModal
          open={true}
          defaultName={`Partita ${new Date().toLocaleDateString('it-IT')}`}
          onClose={onCloseSaveModal}
          onSave={(name) => {
            void (async () => {
              try {
                await gameApi.saveGame(currentGame.id, name);
                notify(`Partita salvata: ${name}`, 'success');
              } catch (e) {
                console.error('[Save] Failed to save game:', e);
                notify('Errore durante il salvataggio.', 'error');
              } finally {
                onCloseSaveModal();
              }
            })();
          }}
        />
      )}
      {gameEnding && (
        <GameOverOverlay
          ending={gameEnding}
          date={gameEnding.date || currentDate}
          turn={gameEnding.turn || currentTurn}
          busy={loading}
          onRewind={() => void onConfirmRewind()}
          onNewGame={onNewGame}
          onClose={onCloseEnding}
        />
      )}
      {saveToLoad && (
        <ConfirmDialog
          open={true}
          onClose={onCloseLoadConfirm}
          onConfirm={() => void onConfirmLoad(saveToLoad)}
          title="Caricare il salvataggio?"
          message={`Caricare "${saveToLoad.name}" (Mossa ${saveToLoad.current_turn ?? '—'})? Lo stato locale sarà sostituito dallo snapshot.`}
          confirmLabel="Carica"
          cancelLabel="Annulla"
          variant="destructive"
        />
      )}
      {showFeasibility && (
        <FeasibilityCheck
          result={feasibilityResult}
          loading={feasibilityLoading}
          error={feasibilityError}
          orderText={verifyingText}
          onClose={onCloseFeasibility}
          onRegister={onRegister}
          onBack={onBack}
          onReverify={onReverify}
        />
      )}
    </>
  );
}
