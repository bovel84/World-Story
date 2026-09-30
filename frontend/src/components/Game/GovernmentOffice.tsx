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

import { useEffect, useMemo, useState } from 'react';
import { AccessibleDialog } from '../ui/AccessibleDialog';
import { CabinetSession } from './CabinetSession';
import { MinisterChat } from './MinisterChat';
import { OrderRegister } from './OrderRegister';
import { SeatCanvas } from './SeatCanvas';
import { TreasuryActPanel } from './TreasuryActPanel';
import { deriveSeatCanvasBlocks } from './seatCanvasModel';
import { seatCanvasAuthoring } from './seatCanvasConfig';
import { treasuryAct, type TreasuryRoad } from './treasuryAct';
import { nationalOperatingPicture } from './nationalOperatingPicture';
import { nationOperatingPictureInput, type NationOperatingPictureSources } from './nationOperatingPictureInput';
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
  /** Chiudere la stanza: non registra nulla, la coda resta. */
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

  // ── Il registro: gli atti deliberati, in lettura ────────────────────────
  /** Gli atti in attesa del turno. Il registro li legge e li firma. */
  pendingActions: Array<{ id: string; text: string }>;
  /** Il nome dello Stato che firma gli atti (da `nationalName`). */
  nationalName: string;
  /** La data corrente di gioco (ISO): è la data della firma. */
  currentDate?: string | null;
  /**
   * Ritirare un atto dal registro prima che il tempo avanzi. È l'unico modo di
   * togliere un ordine dalla coda (la coda non si mostra più nella seduta):
   * passa da `removeQueuedAction`, cioè dalla rotta del motore.
   */
  onWithdrawOrder: (id: string) => void;

  /**
   * WS-GOVOFFICE-03 — Le fonti del quadro operativo nazionale, per il pannello
   * del ministro. Sono le stesse del dossier Nazione: la composizione passa da
   * `nationOperatingPictureInput`, così un dominio ha **un solo** numero.
   */
  pictureSources: NationOperatingPictureSources;
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
  nationalName,
  currentDate = null,
  onWithdrawOrder,
  pictureSources,
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

  // WS-GOVOFFICE-03 — Il quadro operativo per il pannello del ministro. Lo
  // compone lo **stesso** helper del dossier Nazione: un dominio, un numero.
  const picture = useMemo(
    () => nationalOperatingPicture(nationOperatingPictureInput(pictureSources)),
    [pictureSources],
  );

  // WS-GOVOFFICE-07 — L'atto del Tesoro: cifre dai conti nazionali, nessuna
  // inventata. È lo stesso read model che alimenta la tela.
  const act = useMemo(
    () => treasuryAct({ session, picture, sources: pictureSources }),
    [session, picture, pictureSources],
  );

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

  // WS-GOVOFFICE-07 — La tela della sedia: blocchi derivati dal read model
  // (pattern Operating Picture) + il contenuto curato che la sedia dichiara nel
  // registro `SEAT_CANVAS_AUTHORING` (Tesoro e Stato maggiore). La tela è
  // generica: nessuna sedia è cablata qui.
  const canvasBlocks = address
    ? deriveSeatCanvasBlocks({
        seat: address.seat,
        picture,
        sources: pictureSources,
        address,
        authored: seatCanvasAuthoring(address.seat, {
          seat: address.seat,
          picture,
          sources: pictureSources,
          act,
        }),
      })
    : [];

  // L'atto firmato tramite la coda del motore: l'opera (cantiere reale) o un
  // ordine in testo. Entra nel registro, non resta una promessa.
  const signTreasuryRoad = async (road: TreasuryRoad): Promise<boolean> => {
    if (!address) return false;
    if (road.order.kind === 'work') {
      if (!onQueueCabinetPath) return false;
      const queued = await onQueueCabinetPath(road.order.item, road.order.path);
      if (queued) setLastOutcome({ seat: address.seat, label: address.label, kind: 'order', text: road.order.path.title });
      return queued;
    }
    if (!onQueueOrder) return false;
    const queued = await onQueueOrder(road.order.text);
    if (queued) setLastOutcome({ seat: address.seat, label: address.label, kind: 'order', text: road.title });
    return queued;
  };

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
              Gli atti già deliberati sono nel registro. Scegli un ministro per
              aprirne uno nuovo: nella sua scheda parla in prima persona, elenca
              dubbi e problemi, e alla fine la discussione si chiude con un ordine
              o con un nulla di fatto.
            </p>
          </div>

          {/* WS-GOVOFFICE-03 — Il registro degli atti: prima schermata, in
              lettura. Gli ordini NON si vedono più nella pagina del ministro. */}
          <OrderRegister
            orders={pendingActions}
            nationalName={nationalName}
            date={currentDate}
            onWithdraw={onWithdrawOrder}
          />

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
          {/* WS-GOVOFFICE-03 — La seduta a DUE PANNELLI: a sinistra il dialogo
              con il ministro, a destra i dati della nazione e della sua materia.
              Le strade proposte e la coda degli ordini NON stanno qui: le prime
              non sono piu' una scelta da premere, la seconda vive nel registro
              della prima schermata. */}
          <div className="government-office-split">
            <div className="government-office-pane government-office-pane-chat">
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
                  Il ministro porta i suoi dubbi e i suoi problemi. La discussione
                  si chiude con un ordine, che finisce nel registro, oppure con un
                  nulla di fatto dichiarato.
                </p>
              </div>

              <p className="government-office-hint" role="note">
                Le cifre sono quelle del motore, non del modello. Concludere la
                seduta con un ordine lo mette subito nel registro degli atti.
              </p>

              <CabinetSession
                variant="full"
                onlySeat={openSeat}
                session={session}
                loading={sessionLoading}
                error={sessionError}
                speakingSeat={openSeat}
              >
                <MinisterChat
                  gameId={gameId}
                  address={address}
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
                  Atto firmato nel registro — «{lastOutcome.text}»
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
            </div>

            {/* Il pannello dei dati: competenza della sedia, le sue cifre e la
                scheda del dominio nazionale di quella materia. */}
            <div className="government-office-pane government-office-pane-dossier">
              {/* WS-GOVOFFICE-07 — Lo spazio destro è una TELA, non un'etichetta:
                  il Tesoro porta l'atto concreto e le strade firmabili, ogni
                  sedia riceve i blocchi del proprio dominio. */}
              {address?.seat === 'tesoro' && (
                <TreasuryActPanel key={address.seat} act={act} onSign={signTreasuryRoad} />
              )}
              <SeatCanvas
                key={`tela-${address?.seat ?? 'nessuna-sedia'}`}
                blocks={canvasBlocks}
                emptyLabel="Nessuna cifra pubblicata per questa sedia: la tela resta vuota, non inventa."
              />
            </div>
          </div>

          <div className="suggestions-footer">
            <span className="pending-advance-hint">
              {pendingActions.length > 0
                ? `${pendingActions.length} ${pendingActions.length === 1 ? 'atto nel registro' : 'atti nel registro'} · saranno eseguiti solo quando avanzi il tempo dalla data in alto.`
                : 'Nessun atto nel registro: concludi la seduta con un ordine, oppure chiudila con un nulla di fatto.'}
            </span>
            <button
              type="button"
              className="btn-submit-actions"
              onClick={onClose}
              title="Chiudi l'ufficio: gli atti restano nel registro"
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
