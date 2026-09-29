/**
 * P04 — L'Ufficio del Governo: la seduta diventa una stanza modale
 * ===============================================================
 * L'autore: «quando clicco il governo vorrei che aprisse il modale e vedessi
 * l'ufficio con i ministri che parlano e presentano i problemi, oppure sono io
 * che presento problemi a loro. Tutto questo poi deve trasformarsi in ordini
 * che il sistema sia in grado di accettare».
 *
 * Il modulo `orders` era una colonna del desk; qui diventa una stanza in primo
 * piano (`AccessibleDialog`), con la stessa superficie notturna del Consulente.
 * Non aggiunge dati né logica di gioco: monta esattamente ciò che il desk
 * montava — la seduta, la chat per sedia, la bozza e la coda — perché la
 * discussione politica è una sola, cambia solo dove vive sullo schermo.
 *
 * Due direzioni, un solo esito:
 *  - **i ministri parlano**: le sedie portano bisogni, cifre e strade (P02);
 *  - **il giocatore parla**: scrive a una sedia, e da quel problema prepara un
 *    ordine con un click (`onDraftFromUserMessage`);
 *  - **l'esito è un ordine che il motore accetta**: la strada scelta o il testo
 *    libero finiscono nella bozza, che `registerOrder` verifica e accoda. Qui
 *    non si registra nulla: è l'invariante MG-I1 — leggere non impegna.
 *
 * La cronaca dei ministri resta PER SEDIA nello store: aprire un'altra sedia
 * non cancella il dialogo, e chiudere l'ufficio non perde nulla.
 */

import { AccessibleDialog } from '../ui/AccessibleDialog';
import { CabinetSession } from './CabinetSession';
import { MinisterChat } from './MinisterChat';
import { ActionsPanel } from './ActionsPanel';
import { useChatStore } from '../../stores';
import type { CabinetAddressView, CabinetPathView, CabinetSessionView } from '../../services/api';

export interface GovernmentOfficeProps {
  /** L'ufficio è aperto (modulo `orders` attivo). */
  open: boolean;
  /** Chiudere la stanza: non registra nulla, la bozza e la coda restano. */
  onClose: () => void;
  gameId: string;
  /** La seduta del gabinetto: le sedie che portano i bisogni del paese. */
  session: CabinetSessionView | null;
  sessionLoading?: boolean;
  sessionError?: string | null;
  /** Scelta una strada: si prepara una bozza, non si registra (MG-I1). */
  onChoose?: (item: CabinetAddressView['items'][number], path: CabinetPathView) => void;
  /** Il parlare: la sedia diventa un pulsante e apre la sua chat. */
  onSpeak?: (address: CabinetAddressView) => void;
  speakingSeat?: CabinetAddressView['seat'] | null;

  // ── La bozza e la coda: dalla parola all'ordine che il motore accetta ──
  pendingActions: Array<{ id: string; text: string }>;
  orderDraftText: string;
  updateOrderDraft: (text: string) => void;
  enhancedPreview: string | null;
  enhanceLoading: boolean;
  enhanceError: string | null;
  enhanceOrder: (text: string) => Promise<void>;
  acceptOrderEnhanced: () => void;
  rejectOrderEnhanced: () => void;
  registerOrder: (text: string) => Promise<void>;
  removeQueuedAction: (id: string) => void;
  updateQueuedAction: (id: string, text: string) => Promise<void>;
  editingActionId: string | null;
  editingActionText: string;
  setEditingActionId: (id: string | null) => void;
  setEditingActionText: (text: string) => void;
}

export function GovernmentOffice({
  open,
  onClose,
  gameId,
  session,
  sessionLoading = false,
  sessionError = null,
  onChoose,
  onSpeak,
  speakingSeat = null,
  pendingActions,
  orderDraftText,
  updateOrderDraft,
  enhancedPreview,
  enhanceLoading,
  enhanceError,
  enhanceOrder,
  acceptOrderEnhanced,
  rejectOrderEnhanced,
  registerOrder,
  removeQueuedAction,
  updateQueuedAction,
  editingActionId,
  editingActionText,
  setEditingActionId,
  setEditingActionText,
}: GovernmentOfficeProps) {
  // La cronaca dei ministri vive nello store, una per sedia: la stanza può
  // aprirsi e chiudersi senza perdere il filo del discorso.
  const ministerChats = useChatStore(state => state.ministerChats);
  const ministerStreamingSeat = useChatStore(state => state.ministerStreamingSeat);
  const addMinisterMessage = useChatStore(state => state.addMinisterMessage);
  const appendToLastMinisterMessage = useChatStore(state => state.appendToLastMinisterMessage);
  const setMinisterStreaming = useChatStore(state => state.setMinisterStreaming);

  return (
    <AccessibleDialog
      open={open}
      onClose={onClose}
      className="suggestions-content government-office"
      overlayClassName="government-office-overlay"
      ariaLabelledBy="government-office-title"
    >
      <button
        type="button"
        className="desk-close-x"
        onClick={onClose}
        aria-label="Chiudi l'ufficio del Governo"
        title="Chiudi"
      >
        ✕
      </button>

      <div className="council-head">
        <h2 className="council-title" id="government-office-title">L’Ufficio del Governo</h2>
        <p className="council-sub">
          I ministri portano i bisogni del paese; chiedi conto a una sedia, oppure
          porta tu un problema. Da ogni strada nasce una bozza d’ordine che tu
          confermi.
        </p>
      </div>

      <p className="government-office-hint" role="note">
        Scegli un ministro e premi «Parla»: la sua chat si apre qui sotto. Le
        cifre sono quelle del motore, non del modello.
      </p>

      {/* P02 — La seduta del gabinetto: i bisogni documentati del paese. */}
      <CabinetSession
        session={session}
        loading={sessionLoading}
        error={sessionError}
        onChoose={onChoose}
        onSpeak={onSpeak}
        speakingSeat={speakingSeat}
      >
        {/* P02-bis — La chat del ministro, sotto la sua sedia: parla in
            streaming come il Consulente e finisce con le strade da cui nasce la
            bozza. Il problema scritto dal giocatore può diventare l'ordine con
            un click. */}
        <MinisterChat
          gameId={gameId}
          address={session?.addresses.find(candidate => candidate.seat === speakingSeat) ?? null}
          onChoose={onChoose}
          messages={speakingSeat ? (ministerChats[speakingSeat] ?? []) : []}
          streaming={ministerStreamingSeat === speakingSeat}
          onAddMessage={message => { if (speakingSeat) addMinisterMessage(speakingSeat, message); }}
          onAppendToken={token => { if (speakingSeat) appendToLastMinisterMessage(speakingSeat, token); }}
          onStreamingChange={streaming => setMinisterStreaming(streaming ? speakingSeat : null)}
          onDraftFromUserMessage={updateOrderDraft}
        />
      </CabinetSession>

      <div className="pending-actions-section">
        <div className="pending-header">Ordini in attesa del turno:</div>
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
            : 'Registra un ordine dal dialogo o dal compositore: non passerà tempo finché non scegli una data.'}
        </span>
        <button
          type="button"
          className="btn-submit-actions"
          onClick={onClose}
          title="Chiudi l'ufficio: gli ordini restano in attesa"
        >
          Chiudi ufficio
        </button>
      </div>
    </AccessibleDialog>
  );
}

export default GovernmentOffice;
