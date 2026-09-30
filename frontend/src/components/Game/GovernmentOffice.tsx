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

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { CSSProperties, KeyboardEvent as ReactKeyboardEvent, PointerEvent as ReactPointerEvent } from 'react';
import { AccessibleDialog } from '../ui/AccessibleDialog';
import { CabinetSession } from './CabinetSession';
import { MinisterChat } from './MinisterChat';
import { OrderRegister } from './OrderRegister';
import { SeatBrief } from './SeatBrief';
import { SeatTable } from './SeatTable';
import { deriveSeatCanvasBlocks } from './seatCanvasModel';
import { seatCanvasAuthoring } from './seatCanvasConfig';
import { treasuryAct, type TreasuryRoad } from './treasuryAct';
import { resolvePresentation, type ActivePresentation, type PresentationDirective } from './presentation';
import {
  discussedProposal, loadMemory, openQuestion, queuedDecision, recordMemory,
  saveMemory, seatRecords, withSeatRecords, type MinisterMemoryRecord, type MinisterMemoryStore,
} from './ministerMemory';
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

  // WS-MINISTER-UX-05 — La memoria della sedia: ricordi derivati dagli eventi
  // espliciti della seduta, tenuti nel browser per partita. Questo store è la
  // rete immediata/offline e la sorgente dei ricordi inviati; la persistenza
  // vera è server-side (innesto: `minister_memory`, per partita, ramo e mandato).
  const [memoryStore, setMemoryStore] = useState<MinisterMemoryStore>(() => loadMemory(gameId));
  useEffect(() => { setMemoryStore(loadMemory(gameId)); }, [gameId]);
  useEffect(() => { saveMemory(gameId, memoryStore); }, [gameId, memoryStore]);
  const rememberFor = useCallback(
    (seat: CabinetAddressView['seat'], input: MinisterMemoryRecord): void => {
      setMemoryStore(prev => withSeatRecords(prev, seat, recordMemory(prev[seat] ?? [], input)));
    },
    [],
  );

  // WS-GOVOFFICE-02 — `openSeat` è la sedia aperta (la schermata 2). Finché è
  // null si vede solo la scelta. È stato di UI, non di gioco: non tocca il
  // motore e non crea ordini.
  const [openSeat, setOpenSeat] = useState<CabinetAddressView['seat'] | null>(null);
  const [lastOutcome, setLastOutcome] = useState<OfficeOutcome | null>(null);

  // WS-MINISTER-UX-01 — La composizione della seduta: il dialogo è la
  // superficie principale (42% di base), la tavola lo affianca. Il divisore è
  // ridimensionabile (32–60%); su mobile si vede una superficie alla volta.
  const [splitPct, setSplitPct] = useState(42);
  const [mobilePane, setMobilePane] = useState<'dialogo' | 'tavola'>('dialogo');
  const splitRef = useRef<HTMLDivElement>(null);
  const draggingRef = useRef(false);

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

  // Cambiando sedia si riparte dal dialogo su mobile: la tavola non resta
  // appesa a una sedia che non è più aperta.
  useEffect(() => {
    setMobilePane('dialogo');
  }, [openSeat]);

  // WS-MINISTER-UX-01 — Il divisore ridimensionabile: trascinamento col
  // puntatore e frecce da tastiera, con limiti dichiarati (32–60%).
  const startSplit = (event: ReactPointerEvent<HTMLDivElement>): void => {
    draggingRef.current = true;
    event.currentTarget.setPointerCapture?.(event.pointerId);
  };
  const moveSplit = (event: ReactPointerEvent<HTMLDivElement>): void => {
    if (!draggingRef.current || !splitRef.current) return;
    const rect = splitRef.current.getBoundingClientRect();
    if (rect.width <= 0) return;
    const pct = ((event.clientX - rect.left) / rect.width) * 100;
    setSplitPct(Math.min(60, Math.max(32, pct)));
  };
  const endSplit = (): void => {
    draggingRef.current = false;
  };
  const keySplit = (event: ReactKeyboardEvent<HTMLDivElement>): void => {
    if (event.key === 'ArrowLeft') {
      setSplitPct(pct => Math.min(60, Math.max(32, pct - 2)));
      event.preventDefault();
    } else if (event.key === 'ArrowRight') {
      setSplitPct(pct => Math.min(60, Math.max(32, pct + 2)));
      event.preventDefault();
    }
  };

  const address = openSeat
    ? session?.addresses.find(candidate => candidate.seat === openSeat) ?? null
    : null;
  const chatMessages = openSeat ? (ministerChats[openSeat] ?? []) : [];
  const streaming = openSeat !== null && ministerStreamingSeat === openSeat;
  // WS-MINISTER-UX-05 — I ricordi della sedia, potati alla data corrente, e la
  // loro sintesi per il prompt.
  const memoryRecords = openSeat ? seatRecords(memoryStore, openSeat, currentDate) : [];

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

  // WS-MINISTER-UX-03 — La presentazione richiesta nella conversazione: stato di
  // UI legato alla sedia e al messaggio. Parlare non impegna nulla, e la tavola
  // di una sedia non cambia per un evento di un'altra.
  const [presentations, setPresentations] = useState<
    Partial<Record<CabinetAddressView['seat'], ActivePresentation>>
  >({});
  const applyPresentation = useCallback(
    (seat: CabinetAddressView['seat'], messageId: string, quote: string, directive: PresentationDirective): void => {
      setPresentations(prev => ({ ...prev, [seat]: { directive, seat, messageId, quote } }));
      // WS-MINISTER-UX-05 — Una proposta confrontata è una proposta discussa:
      // entra in memoria, senza confonderla con un atto accodato.
      if (directive.op === 'compare') {
        for (const road of act.roads) {
          rememberFor(seat, discussedProposal(seat, road, { messageId, gameDate: currentDate ?? '' }));
        }
      }
    },
    [act.roads, currentDate, rememberFor],
  );
  const chatPresentation = useCallback(
    (messageId: string, quote: string, directive: PresentationDirective): void => {
      if (openSeat) applyPresentation(openSeat, messageId, quote, directive);
    },
    [openSeat, applyPresentation],
  );
  const clearPresentation = useCallback((): void => {
    if (!openSeat) return;
    setPresentations(prev => {
      const next = { ...prev };
      delete next[openSeat];
      return next;
    });
  }, [openSeat]);
  const activePresentation = openSeat ? presentations[openSeat] ?? null : null;
  const resolvedPresentation = useMemo(
    () => resolvePresentation(activePresentation, canvasBlocks, act.roads),
    [activePresentation, canvasBlocks, act.roads],
  );

  // L'atto firmato tramite la coda del motore: l'opera (cantiere reale) o un
  // ordine in testo. Entra nel registro, non resta una promessa.
  const signTreasuryRoad = async (road: TreasuryRoad): Promise<boolean> => {
    if (!address) return false;
    if (road.order.kind === 'work') {
      if (!onQueueCabinetPath) return false;
      const queued = await onQueueCabinetPath(road.order.item, road.order.path);
      if (queued) {
        setLastOutcome({ seat: address.seat, label: address.label, kind: 'order', text: road.order.path.title });
        rememberFor(address.seat, queuedDecision(address.seat, road.order.path.title, { gameDate: currentDate ?? '' }));
      }
      return queued;
    }
    if (!onQueueOrder) return false;
    const queued = await onQueueOrder(road.order.text);
    if (queued) {
      setLastOutcome({ seat: address.seat, label: address.label, kind: 'order', text: road.title });
      rememberFor(address.seat, queuedDecision(address.seat, road.title, { gameDate: currentDate ?? '' }));
    }
    return queued;
  };

  // ── Gli esiti: un ordine in coda, o un nulla di fatto ───────────────────
  const queueProblem = async (text: string): Promise<void> => {
    if (!onQueueOrder || !address) return;
    const queued = await onQueueOrder(text);
    if (queued) {
      setLastOutcome({ seat: address.seat, label: address.label, kind: 'order', text });
      rememberFor(address.seat, queuedDecision(address.seat, text, { gameDate: currentDate ?? '' }));
    }
  };

  const concludeNothing = (): void => {
    if (address) {
      setLastOutcome({ seat: address.seat, label: address.label, kind: 'nothing' });
      // Una seduta senza ordine lascia una questione aperta: si ricorda come
      // aperta, non come respinta e non come approvata.
      rememberFor(address.seat, openQuestion(
        address.seat,
        'Seduta chiusa senza ordine: nessuna decisione presa.',
        { gameDate: currentDate ?? '' },
      ));
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
        // ── [2] SEDUTA — il dialogo è la superficie principale (UX-01); la
        //     tavola di lavoro lo affianca a destra. ───────────────────────
        <div className="government-office-session" data-mobile-pane={mobilePane}>
          <header className="minister-session-head">
            <button
              type="button"
              className="government-office-back"
              onClick={() => setOpenSeat(null)}
              title="Torna all'elenco dei ministri"
            >
              ← Ministri
            </button>
            <div className="minister-session-id">
              <h2 className="minister-session-name" id="government-office-title">
                {address ? address.label : 'Seduta'}
              </h2>
              {address && <span className="minister-session-reads">{address.reads}</span>}
            </div>
            <div className="minister-session-context">
              <span className="minister-session-state">{nationalName}</span>
              {currentDate && <span className="minister-session-date">{currentDate}</span>}
            </div>
            <div className="minister-session-views" role="tablist" aria-label="Viste della seduta">
              <button
                type="button"
                role="tab"
                aria-selected={mobilePane === 'dialogo'}
                className={`minister-session-view${mobilePane === 'dialogo' ? ' active' : ''}`}
                onClick={() => setMobilePane('dialogo')}
              >
                Dialogo
              </button>
              <button
                type="button"
                role="tab"
                aria-selected={mobilePane === 'tavola'}
                className={`minister-session-view${mobilePane === 'tavola' ? ' active' : ''}`}
                onClick={() => setMobilePane('tavola')}
              >
                Tavola
                {activePresentation && mobilePane !== 'tavola' && (
                  <span className="minister-session-view-dot" title="Nuova evidenza sulla tavola" aria-hidden="true" />
                )}
              </button>
            </div>
          </header>

          {sessionLoading ? (
            <p className="cabinet-status" role="status">Il consiglio si sta riunendo…</p>
          ) : sessionError ? (
            <p className="cabinet-status cabinet-error" role="alert">{sessionError}</p>
          ) : (
            <div
              ref={splitRef}
              className="government-office-split"
              style={{ '--dialogue-pct': `${splitPct}%` } as CSSProperties}
              onPointerMove={moveSplit}
              onPointerUp={endSplit}
            >
              <section
                className="government-office-pane government-office-pane-chat"
                data-pane="dialogo"
                aria-label="Dialogo con il ministro"
              >
                <SeatBrief address={address} memory={memoryRecords} />
                <MinisterChat
                  gameId={gameId}
                  address={address}
                  messages={chatMessages}
                  streaming={streaming}
                  memory={memoryRecords}
                  onAddMessage={message => { if (openSeat) addMinisterMessage(openSeat, message); }}
                  onAppendToken={token => { if (openSeat) appendToLastMinisterMessage(openSeat, token); }}
                  onStreamingChange={isStreaming => setMinisterStreaming(isStreaming ? openSeat : null)}
                  onOrderFromUserMessage={text => void queueProblem(text)}
                  onPresentation={chatPresentation}
                />

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
              </section>

              <div
                className="government-office-divider"
                role="separator"
                aria-orientation="vertical"
                aria-label="Ridimensiona dialogo e tavola"
                aria-valuemin={32}
                aria-valuemax={60}
                aria-valuenow={Math.round(splitPct)}
                tabIndex={0}
                onPointerDown={startSplit}
                onKeyDown={keySplit}
              />

              <section
                className="government-office-pane government-office-pane-table"
                data-pane="tavola"
                aria-label="Tavola di lavoro"
              >
                <SeatTable
                  seat={address?.seat ?? 'lavori'}
                  blocks={canvasBlocks}
                  act={act}
                  onSign={signTreasuryRoad}
                  presentation={resolvedPresentation}
                  onClearPresentation={clearPresentation}
                  onReturnToMessage={() => setMobilePane('dialogo')}
                />
              </section>
            </div>
          )}

          <div className="suggestions-footer">
            <span className="pending-advance-hint">
              {pendingActions.length > 0
                ? `${pendingActions.length} ${pendingActions.length === 1 ? 'atto nel registro' : 'atti nel registro'} · eseguiti quando avanzi il tempo dalla data in alto.`
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
        </div>
      )}
    </AccessibleDialog>
  );
}

export default GovernmentOffice;
