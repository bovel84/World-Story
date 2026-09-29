/**
 * P04 / WS-GOVOFFICE-02 — L'Ufficio del Governo: dalla sala affollata alla
 * seduta in due passi
 * ===========================================================================
 * L'autore: «La schermata governo è caotica, io farei una schermata intermedia
 * che fa apparire solamente i riquadro dei ministri. Poi quando si entra nella
 * scheda il ministro parla "signor presidente...." e elenca dubbi e problemi;
 * alla fine della discussione ci deve essere un ordine o un nulla di fatto.
 * Ordine che deve essere messo in automatico nella lista degli ordini.»
 *
 * Il flusso, quindi, è a **due schermate** dentro lo stesso modale:
 *  [1] SCELTA — solo i riquadri dei ministri (nome + competenza). Niente item,
 *      niente cifre, niente chat, niente coda, niente compositore.
 *  [2] SEDUTA — il ministro aperto parla in prima persona («Signor Presidente,
 *      …») ed elenca i suoi dubbi e problemi dai dati del motore; la chat è lo
 *      strumento del dialogo. Alla fine ci sono **due esiti espliciti**:
 *      un ORDINE (messo in coda AUTOMATICAMENTE, `onQueueOrder` /
 *      `onQueueCabinetPath`) oppure un NULLA DI FATTO (nessun ordine, nota
 *      dichiarata, ritorno alla scelta).
 *
 * Non si inventa contenuto: la voce del ministro è `address.opening` + `items`;
 * la salutazione «Signor Presidente,» è una cornice della UI. La coda e il
 * compositore restano la via dell'ordine libero, con la sua verifica.
 *
 * La cronaca dei ministri resta PER SEDIA nello store: cambiare sedia non
 * cancella il dialogo.
 */

import { useEffect, useState } from 'react';
import { AccessibleDialog } from '../ui/AccessibleDialog';
import { CabinetSession } from './CabinetSession';
import { MinisterChat } from './MinisterChat';
import { ActionsPanel } from './ActionsPanel';
import { useChatStore } from '../../stores';
import type { CabinetAddressView, CabinetPathView, CabinetSessionView } from '../../services/api';

/** L'esito dichiarato di una seduta: un ordine messo in coda, o nulla. */
interface OfficeOutcome {
  seat: CabinetAddressView['seat'];
  label: string;
  kind: 'order' | 'nothing';
  /** Il testo dell'ordine, quando l'esito è un ordine. */
  text?: string;
}

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
  /**
   * WS-GOVOFFICE-02 — L'esito ORDINE: la strada scelta entra in coda
   * **automaticamente** (nessuna conferma separata). Il testo lo compone il
   * chiamante dai dati del motore. Ritorna `true` se l'ordine è stato accodato.
   */
  onQueueCabinetPath?: (item: CabinetAddressView['items'][number], path: CabinetPathView) => Promise<boolean>;
  /** WS-GOVOFFICE-02 — L'esito ORDINE dal problema scritto dal giocatore. */
  onQueueOrder?: (text: string) => Promise<boolean>;

  // ── La bozza e la coda: la via dell'ordine libero, con la sua verifica ──
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
  onQueueCabinetPath,
  onQueueOrder,
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

  // WS-GOVOFFICE-02 — `openSeat` è la sedia aperta (la schermata 2). Finché è
  // null si vede solo la scelta. È stato di UI, non di gioco: non tocca il
  // motore e non crea ordini.
  const [openSeat, setOpenSeat] = useState<CabinetAddressView['seat'] | null>(null);
  const [lastOutcome, setLastOutcome] = useState<OfficeOutcome | null>(null);

  // Chiudere l'ufficio riporta alla scelta: quando lo si riapre, si riparte dai
  // ministri, non da una seduta rimasta a metà.
  useEffect(() => {
    if (!open) {
      setOpenSeat(null);
      setLastOutcome(null);
    }
  }, [open]);

  const address = openSeat
    ? session?.addresses.find(candidate => candidate.seat === openSeat) ?? null
    : null;
  const chatMessages = openSeat ? (ministerChats[openSeat] ?? []) : [];
  const streaming = openSeat !== null && ministerStreamingSeat === openSeat;

  // ── Gli esiti: un ordine in coda, o un nulla di fatto ───────────────────
  const queuePath = async (
    item: CabinetAddressView['items'][number],
    path: CabinetPathView,
  ): Promise<void> => {
    if (!onQueueCabinetPath) return;
    const queued = await onQueueCabinetPath(item, path);
    if (queued && address) {
      setLastOutcome({ seat: address.seat, label: address.label, kind: 'order', text: path.title });
    }
  };

  const queueProblem = async (text: string): Promise<void> => {
    if (!onQueueOrder || !address) return;
    const queued = await onQueueOrder(text);
    if (queued) {
      setLastOutcome({ seat: address.seat, label: address.label, kind: 'order', text });
    }
  };

  const concludeNothing = (): void => {
    if (address) {
      setLastOutcome({ seat: address.seat, label: address.label, kind: 'nothing' });
    }
    setOpenSeat(null);
  };

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

      {openSeat === null ? (
        // ── [1] SCELTA — solo i riquadri dei ministri ──────────────────────
        <>
          <div className="council-head">
            <h2 className="council-title" id="government-office-title">L’Ufficio del Governo</h2>
            <p className="council-sub">
              Scegli un ministro: nella sua scheda parla in prima persona, elenca
              dubbi e problemi, e alla fine la discussione si chiude con un ordine
              o con un nulla di fatto.
            </p>
          </div>

          {lastOutcome && (
            <p className="government-office-outcome-note" role="status">
              {lastOutcome.label}: {lastOutcome.kind === 'order'
                ? <>ordine in coda — «{lastOutcome.text}»</>
                : <>nulla di fatto, nessun ordine.</>}
            </p>
          )}

          <CabinetSession
            variant="pick"
            session={session}
            loading={sessionLoading}
            error={sessionError}
            onOpenSeat={next => { setLastOutcome(null); setOpenSeat(next.seat); }}
          />
        </>
      ) : (
        // ── [2] SEDUTA — il ministro parla; alla fine, l'esito ─────────────
        <>
          <button
            type="button"
            className="government-office-back"
            onClick={() => setOpenSeat(null)}
            title="Torna all'elenco dei ministri"
          >
            ← Torna ai ministri
          </button>
          <div className="council-head">
            <h2 className="council-title" id="government-office-title">
              {address ? address.label : 'Seduta'}
            </h2>
            <p className="council-sub">
              Il ministro porta i suoi dubbi e i suoi problemi. Alla fine: un
              ordine in coda, oppure un nulla di fatto dichiarato.
            </p>
          </div>

          <p className="government-office-hint" role="note">
            Le cifre sono quelle del motore, non del modello. «Concludi con un
            ordine» mette subito l’ordine nella coda del turno.
          </p>

          <CabinetSession
            variant="full"
            onlySeat={openSeat}
            session={session}
            loading={sessionLoading}
            error={sessionError}
            speakingSeat={openSeat}
            onChoose={(item, path) => void queuePath(item, path)}
          >
            <MinisterChat
              gameId={gameId}
              address={address}
              onChoose={(item, path) => void queuePath(item, path)}
              messages={chatMessages}
              streaming={streaming}
              onAddMessage={message => { if (openSeat) addMinisterMessage(openSeat, message); }}
              onAppendToken={token => { if (openSeat) appendToLastMinisterMessage(openSeat, token); }}
              onStreamingChange={isStreaming => setMinisterStreaming(isStreaming ? openSeat : null)}
              onOrderFromUserMessage={text => void queueProblem(text)}
            />
          </CabinetSession>

          {lastOutcome?.kind === 'order' && (
            <p className="government-office-outcome-note" role="status">
              Ordine in coda — «{lastOutcome.text}»
            </p>
          )}

          <div className="government-office-outcome">
            <button
              type="button"
              className="cabinet-nothing"
              onClick={concludeNothing}
              title="Chiudi la seduta senza ordine: torna ai ministri"
            >
              Nulla di fatto — chiudi senza ordine
            </button>
          </div>

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
                : 'Concludi la seduta con un ordine, oppure scrivine uno tu: non passerà tempo finché non scegli una data.'}
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
        </>
      )}
    </AccessibleDialog>
  );
}

export default GovernmentOffice;
