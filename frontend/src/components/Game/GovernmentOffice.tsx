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
import { projectCurrentDecision } from './ministerDialogueContext';
import { OrderRegister } from './OrderRegister';
import { SeatBrief } from './SeatBrief';
import { SeatTable } from './SeatTable';
import { ActDraftPanel } from './ActDraftPanel';
import { deriveSeatCanvasBlocks } from './seatCanvasModel';
import { SeatCanvas } from './SeatCanvas';
import { seatCanvasAuthoring } from './seatCanvasConfig';
import { treasuryAct, type TreasuryRoad } from './treasuryAct';
import {
  actDraftFor, actDraftFromProposal, actHeadline, actStatus, deriveActState, editActDraft,
  type ActState, type ProposalActDraft,
} from './actDraft';
import type { WorkDeclarationInput } from './cabinetOrder';
import {
  applyCanvasBatch, availableEvidence, blockForEvidence, emptyCanvas, parsePresentation,
  resolveCanvas, type EvidenceKey, type PresentationCanvas, type PresentationDirective,
} from './presentation';
import { shouldShowEvidenceBadge, type EvidenceCardIndex, type InlineEvidenceCard } from './inlineEvidence';
import {
  discussedProposal, declaredPreference, loadMemory, openQuestion, queuedDecision, recordMemory,
  revokeMemory, saveMemory, seatRecords, withSeatRecords, clientMandate,
  type MinisterMemoryRecord, type MinisterMemoryStore,
} from './ministerMemory';
import { seatRoads } from './seatProposals';
import {
  activeProposal, actStaleness, applyDecisionBatch, emptyWorkspace, withEvidenceRefs, proposalSummary,
  type DecisionAction, type DecisionWorkspace,
} from './decisionWorkspace';
import {
  canPromoteToCouncil, conveneSeat, promoteToCouncil,
  type CouncilWorkspace,
} from './councilWorkspace';
import {
  continueMeeting, meetingActDraft, openMeeting, seatSpeaker, shouldConveneMeeting,
  type CouncilMeeting, type MeetingPrompt,
} from './councilMeeting';
import { meetingReadFromFeasibility } from './meetingEngineRead';
import { resolveCurrentRegionRef } from './meetingLocalization';
import {
  narrativeContribution, meetingBriefFor,
  type MeetingNarrator,
} from './meetingNarrative';
import {
  blockerKey, convenableMinisters, ministerSectionsFromMeeting, mobileDecisionSummary, mobileHistory,
  participantChips, shouldShowBoardDot, uniqueSourceLabels, type GovernmentMobileView,
} from './mobileFocus';
import { GovernmentBottomSheet } from '../ui/GovernmentBottomSheet';
import { useGovernmentCompactLayout } from '../../hooks/useIsMobile';
import {
  actIdentity, governmentSessionId, previousSessionMemory, seatFromSessionSeatKey, sessionSeatKey,
  type PreviousGovernmentSessionRef,
} from './governmentSession';
import type { CabinetSeat } from './seatDecisionBoards';
import { CABINET_SEATS } from './seatDecisionBoards';
import { deriveCouncilAgenda } from './councilAgenda';
import { nationalOperatingPicture } from './nationalOperatingPicture';
import { nationOperatingPictureInput, type NationOperatingPictureSources } from './nationOperatingPictureInput';
import { useChatStore, useGameStore } from '../../stores';
import { useSimulationStore } from '../../stores/simulationRuntime';
import { gameApi, ministerApi, type CabinetAddressView, type CabinetSessionView } from '../../services/api';
import { actionSnapshotKey } from './actionSnapshot';
import { buildConsequenceBoard, consequenceBoardSignature, type EnginePreview } from './consequenceBoard';

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
   * WS-MINISTER-UX-06 — L'esito ORDINE dalla **bozza d'atto**: il Presidente
   * prepara e corregge una strada, poi la firma. La dichiarazione d'opera viaggia
   * accanto al testo quando la distinta è coperta. Ritorna `true` se accodato.
   */
  onQueueOrder?: (text: string, work?: WorkDeclarationInput, signatureKey?: string) => Promise<boolean>;

  // ── Il registro: gli atti deliberati, in lettura ────────────────────────
  /** Gli atti in attesa del turno. Il registro li legge e li firma. */
  pendingActions: Array<{ id: string; text: string }>;
  /** Il nome dello Stato che firma gli atti (da `nationalName`). */
  nationalName: string;
  /** La data corrente di gioco (ISO): è la data della firma. */
  currentDate?: string | null;
  /**
   * WS-GOVUX-P6 — Il turno corrente del mondo: è il **tempo del ricordo**. Senza
   * turno un ricordo si àncora solo alla data; il timestamp tecnico del database
   * non lo sostituisce mai. Passato dal chiamante (il motore lo possiede).
   */
  currentTurn?: number | null;
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

/**
 * WS-GOV-COUNCIL-MEETINGS (B7–B10) / WS-GOV-COUNCIL-HARDENING — La lettura
 * del motore per la riunione è ora un modulo puro (`meetingEngineRead.ts`),
 * così localizzazione e copertura monetaria si provano senza montare la stanza.
 */

export function GovernmentOffice({
  open,
  onClose,
  gameId,
  session,
  sessionLoading = false,
  sessionError = null,
  onQueueOrder,
  pendingActions,
  nationalName,
  currentDate = null,
  currentTurn = null,
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
  // WS-MINISTER-UX-06 — La cronologia dei turni: è lì che vive l'esito **reale**
  // di un atto (accettato, parziale o respinto), non in un flag della UI.
  const turnHistory = useGameStore(state => state.history);

  // WS-MINISTER-UX-05 — La memoria della sedia: ricordi derivati dagli eventi
  // espliciti della seduta, tenuti nel browser per partita. Questo store è la
  // rete immediata/offline e la sorgente dei ricordi inviati; la persistenza
  // vera è server-side (innesto: `minister_memory`, per partita, ramo e mandato).
  //
  // WS-MINISTER-UX-08 (4) — Lo scope del client è **partita + ramo + mandato**,
  // come il server: chiavi diverse non si scambiano ricordi. Il ramo è quello
  // della simulazione (cambia al fork); il mandato è l'identità del governo
  // (polity + fazione dominante), la stessa che il server ricava da sé.
  const branchId = useSimulationStore(state => state.state?.branchId ?? null);
  const mandate = clientMandate(pictureSources.government, pictureSources.account?.polityId ?? null);
  const memoryScope = useMemo(() => ({ gameId, branchId, mandate }), [gameId, branchId, mandate]);
  const [memoryStore, setMemoryStore] = useState<MinisterMemoryStore>(() => loadMemory(memoryScope));
  useEffect(() => { setMemoryStore(loadMemory(memoryScope)); }, [memoryScope]);
  useEffect(() => { saveMemory(memoryScope, memoryStore); }, [memoryScope, memoryStore]);
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
  // WS-MINISTER-UX-06 — La bozza d'atto sul tavolo: la strada preparata dal
  // Presidente, correggibile e firmabile. È stato di UI: non accoda e non spende
  // finché non si firma. `actBusy` evita il doppio atto mentre la firma è in volo.
  const [actDraft, setActDraft] = useState<(ProposalActDraft & {
    signatureKey: string; signatureAttempted?: boolean; signatureNotice?: string; revision?: number;
  }) | null>(null);
  const [actBusy, setActBusy] = useState(false);
  // WS-GOV-DIALOGUE-TO-ACT — La decisione in corso per sedia: la conversazione
  // la costruisce, la tavola la mostra, l'atto nasce da lei. Stato di UI: non
  // tocca il motore.
  // WS-GOV-TURN-SESSIONS (A1) — Le mappe sono indicizzate per **chiave di
  // seduta** (`sessionId::seat`), non per sola sedia: una proposta di un altro
  // turno non è leggibile come se fosse di questo.
  const [workspaces, setWorkspaces] = useState<Record<string, DecisionWorkspace>>({});
  // WS-GOV-SEAT-BOARDS (B25/B26) — La riunione di Consiglio: un read model di
  // UI che **referenzia** i workspace delle sedie convocate (nessuna copia).
  const [council, setCouncil] = useState<CouncilWorkspace | null>(null);
  // WS-GOV-COUNCIL-MEETINGS — La riunione di Governo attiva: stato della seduta
  // corrente (Fase A). Una decisione multi-competenza vive qui, in una sola
  // conversazione e in una sola Tavola condivisa.
  const [meeting, setMeeting] = useState<CouncilMeeting | null>(null);
  // WS-GOVUX-P7 — La verifica del motore per la plancia delle conseguenze: si
  // conserva la firma con cui è stata prodotta, così una bozza modificata la
  // rende `stale` invece di mostrare la stima di un'altra versione.
  const [actPreview, setActPreview] = useState<{ signature: string; result: EnginePreview } | null>(null);
  const [actPreviewLoading, setActPreviewLoading] = useState(false);
  const [actPreviewError, setActPreviewError] = useState<string | null>(null);

  // WS-MINISTER-UX-01 — La composizione della seduta: il dialogo è la
  // superficie principale (42% di base), la tavola lo affianca. Il divisore è
  // ridimensionabile (32–60%); su mobile si vede una superficie alla volta.
  const [splitPct, setSplitPct] = useState(42);
  const [mobilePane, setMobilePane] = useState<'dialogo' | 'tavola'>('dialogo');
  const splitRef = useRef<HTMLDivElement>(null);
  const draggingRef = useRef(false);
  // WS-GOV-MOBILE-FOCUS (H1/H2/H3) — La vista mobile è una **macchina a stati**:
  // dialogo, tavola, atto, evidenza. È presentazione, non dominio: le stesse
  // `DecisionWorkspace`/`CouncilMeeting`/atto alimentano desktop e mobile.
  const isMobile = useGovernmentCompactLayout();
  const [mobileView, setMobileView] = useState<GovernmentMobileView>('dialogue');
  const [mobileSheet, setMobileSheet] = useState<'convene' | null>(null);
  const sheetReturnRef = useRef<HTMLElement | null>(null);
  // H4 — lo scroll di Dialogo e Tavola si conserva separato per vista.
  const dialogueScrollRef = useRef<HTMLDivElement>(null);
  const boardScrollRef = useRef<HTMLDivElement>(null);
  const scrollMemory = useRef<{ dialogue: number; board: number }>({ dialogue: 0, board: 0 });
  // H6 — il pallino della Tavola è un fatto di **visione**: si spegne quando la
  // Tavola è aperta, non a ogni token.
  const [boardSeen, setBoardSeen] = useState<{ revision: number; meetingRevision: number; blockers: string }>({
    revision: -1, meetingRevision: -1, blockers: '',
  });
  // H23/B36 — l'evidenza in primo piano: il blocco mostrato a tutta pagina.
  const [evidenceFocus, setEvidenceFocus] = useState<{ blockId: string | null; label: string; note: string } | null>(null);
  const evidenceRef = useRef<HTMLElement>(null);
  // WS-GOVUX-P4 — La card in linea è un riferimento alla tavola: qui si mette a
  // fuoco il blocco reale (nessun secondo grafico).
  const tableRef = useRef<HTMLElement>(null);
  const [pendingFocus, setPendingFocus] = useState<{ id: string; nonce: number } | null>(null);
  // Il pallino «nuova evidenza» è un fatto di **visione**: si spegne quando
  // l'evidenza è vista, non quando arriva. Si ricorda la versione già vista.
  const [seenVersion, setSeenVersion] = useState(-1);

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
      setActDraft(null);
      setCouncil(null);
      setMeeting(null);
    }
  }, [open]);

  // WS-GOV-SEAT-BOARDS (B24) / WS-GOV-TURN-SESSIONS (A1) — L'identità della
  // seduta: `game + branch + turn + kind (+ seat)`. Il solo `seat` non basta:
  // due turni diversi sono due sedute diverse, e lo stato della precedente non
  // resta operativo.
  const sessionId = useMemo(
    () => governmentSessionId({ gameId, branchId, turn: currentTurn ?? 0, kind: 'minister' }),
    [gameId, branchId, currentTurn],
  );
  // WS-GOV-MOBILE-FOCUS (H2) — Le due azioni non si confondono: `←` torna alle
  // viste della sessione, `×` chiude il modulo. La vista mobile non toglie il
  // dialogo al desktop: è una diversa composizione dello stesso stato.
  const goMobileView = useCallback((next: GovernmentMobileView): void => {
    const current = mobileView;
    const from = current === 'dialogue' ? dialogueScrollRef.current : current === 'board' ? boardScrollRef.current : null;
    if (current === 'dialogue') scrollMemory.current.dialogue = from?.scrollTop ?? scrollMemory.current.dialogue;
    if (current === 'board') scrollMemory.current.board = from?.scrollTop ?? scrollMemory.current.board;
    if (next === 'board') {
      // Il «visto» lo registra l'effetto sotto, quando la Tavola è davvero
      // aperta e le revisioni correnti sono in scope.
    }
    setMobileView(next);
  }, [mobileView]);
  const stateKey = useCallback(
    (seat: CabinetAddressView['seat']): string => sessionSeatKey(sessionId, seat),
    [sessionId],
  );
  // Narrative UI cache only: no chat-store writes, directives or provenance changes.
  // Survives MinisterChat remounts (seat/back/desktop-mobile), not a full office unmount.
  const [openings, setOpenings] = useState<Record<string, string>>({});
  useEffect(() => { setOpenings({}); }, [sessionId]);
  const retainOpening = useCallback((text: string): void => {
    if (!openSeat) return;
    const key = stateKey(openSeat);
    setOpenings(prev => prev[key] === text ? prev : { ...prev, [key]: text });
  }, [openSeat, stateKey]);
  const retainedOpening = openSeat ? openings[stateKey(openSeat)] : undefined;
  const workspacesRef = useRef(workspaces);
  workspacesRef.current = workspaces;
  const sessionIdRef = useRef(sessionId);
  // WS-GOV-COUNCIL-HARDENING — La provenienza della seduta precedente: turno e
  // data **di origine**, non quelli del turno nuovo. Il ref viene aggiornato
  // dall'effetto dichiarato sotto, quindi al cambio di `sessionId` contiene
  // ancora i valori vecchi.
  const previousSessionRef = useRef<PreviousGovernmentSessionRef>({
    sessionId, turn: currentTurn ?? 0, date: currentDate ?? null,
  });
  // A2/A3 — Al cambio di turno (o di partita/ramo): **prima** si consolida la
  // seduta precedente in memoria (i fatti narrativamente utili), **poi** lo
  // stato operativo riparte da zero. Il passato diventa memoria, non workspace.
  useEffect(() => {
    if (sessionIdRef.current === sessionId) return;
    sessionIdRef.current = sessionId;
    const consolidated = previousSessionMemory({
      previous: previousSessionRef.current,
      workspaces: workspacesRef.current,
      seatOf: key => seatFromSessionSeatKey(key) as CabinetAddressView['seat'] | null,
    });
    setMemoryStore(prev => {
      let next = prev;
      for (const { seat, records } of consolidated) {
        for (const record of records) next = withSeatRecords(next, seat, recordMemory(next[seat] ?? [], record));
      }
      return next;
    });
    setWorkspaces({});
    setCanvases({});
    setCouncil(null);
    setMeeting(null);
    setActDraft(null);
    setActPreview(null);
    setActPreviewError(null);
    setActBusy(false);
    setSeenVersion(-1);
    setPendingFocus(null);
    setMobilePane('dialogo');
  }, [sessionId, currentDate, currentTurn]);

  // Dopo la consolidazione, il riferimento alla seduta precedente diventa la
  // seduta corrente: il prossimo cambio userà il tempo **di questa** seduta.
  useEffect(() => {
    previousSessionRef.current = { sessionId, turn: currentTurn ?? 0, date: currentDate ?? null };
  }, [sessionId, currentDate, currentTurn]);

  // Cambiare sedia non trascina la bozza d'atto di un altro ministro.
  useEffect(() => {
    setActDraft(null);
  }, [openSeat]);

  // Cambiando sedia si riparte dal dialogo su mobile: la tavola non resta
  // appesa a una sedia che non è più aperta. Anche il pallino e la messa a
  // fuoco sono per sedia: una nuova sedia non eredita la visione della vecchia.
  useEffect(() => {
    setMobilePane('dialogo');
    setSeenVersion(-1);
    setPendingFocus(null);
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
  // WS-GOV-TURN-SESSIONS (A5) — La chat visibile (e la cronologia inviata al
  // ministro) è quella della **seduta corrente**: i messaggi dei turni
  // precedenti restano nello store come storia, ma non si ripropongono al
  // modello. La memoria selettiva del passato viaggia a parte (`memory`).
  const chatMessages = openSeat
    ? (ministerChats[openSeat] ?? []).filter(message => message.turn === undefined || message.turn === currentTurn)
    : [];
  // WS-GOV-COUNCIL-MEETINGS (B7) — Una decisione multi-competenza apre una
  // **riunione**, non una chat libera fra agenti. La convocazione è esplicita:
  // il Presidente la chiede, e l'orchestrazione è deterministica.
  //
  // WS-GOV-MOBILE-CLEANUP (M1) — l'identità della convocazione non è il testo:
  // il richiamo porta con sé l'indice del messaggio del Presidente che l'ha
  // originata. Due richieste identiche nel testo restano due convocazioni.
  // (La definizione vive più sotto, dopo `workspace`: serve l'objective.)
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
        authored: seatCanvasAuthoring({
          seat: address.seat,
          picture,
          sources: pictureSources,
          act,
          address,
        }),
      })
    : [];

  // WS-MINISTER-UX-08 (2) — Le proposte della **sedia aperta**: per il Tesoro le
  // strade del suo atto, per le altre i percorsi delle sue voci. Niente
  // `act.roads` globale: un confronto alla Sanità non mostra strade del Tesoro.
  const proposals = useMemo(() => seatRoads(address, act), [address, act]);

  // WS-MINISTER-UX-03 / WS-GOVUX-P3 — La tela richiesta nella conversazione:
  // stato di UI legato alla sedia e ai messaggi che l'hanno prodotta. Parlare
  // non impegna nulla, e la tavola di una sedia non cambia per un evento di
  // un'altra. P3 la estende a una **tela**: fino a due principali, un confronto
  // che non le sostituisce, e aggiornamento/rimozione mirati dal lotto di una
  // risposta. Il modello resta un read model puro (`applyCanvasBatch`).
  const [canvases, setCanvases] = useState<Record<string, PresentationCanvas>>({});
  const applyPresentation = useCallback(
    (seat: CabinetAddressView['seat'], messageId: string, quote: string, directives: readonly PresentationDirective[], discussion?: string): void => {
      setCanvases(prev => {
        const key = stateKey(seat);
        const current = prev[key] ?? emptyCanvas();
        const next = applyCanvasBatch(current, directives, {
          messageId, quote,
          ...(discussion ? { discussion } : {}),
        });
        // Il lucchetto del Presidente e i bersagli assenti non cambiano la tela:
        // si evita un re-render quando la stessa istanza torna indietro.
        if (next === current) return prev;
        return { ...prev, [key]: next };
      });
      // WS-MINISTER-UX-05 — Una proposta confrontata è una proposta discussa:
      // entra in memoria, senza confonderla con un atto accodato.
      if (directives.some(directive => directive.op === 'compare')) {
        for (const road of proposals) {
          rememberFor(seat, discussedProposal(seat, road, { messageId, gameDate: currentDate ?? '', turn: currentTurn ?? undefined }));
        }
      }
      // WS-GOV-DIALOGUE-TO-ACT — La decisione in corso **referenzia** l'evidenza
      // mostrata sulla tela (nessuna copia del dato, nessuna revisione).
      const evidenceRefs = directives
        .map(directive => directive.evidence)
        .filter((evidence): evidence is EvidenceKey => typeof evidence === 'string');
      if (evidenceRefs.length > 0) {
        setWorkspaces(prev => {
          const key = stateKey(seat);
          const current = prev[key] ?? emptyWorkspace(seat);
          const next = withEvidenceRefs(current, [...current.evidenceIds, ...evidenceRefs]);
          return next === current ? prev : { ...prev, [key]: next };
        });
      }
    },
    [proposals, currentDate, currentTurn, rememberFor, stateKey],
  );
  const chatPresentation = useCallback(
    (messageId: string, quote: string, directives: readonly PresentationDirective[], discussion?: string): void => {
      if (openSeat) applyPresentation(openSeat, messageId, quote, directives, discussion);
    },
    [openSeat, applyPresentation],
  );
  // WS-GOV-DIALOGUE-TO-ACT — Le azioni `decision` di una risposta aggiornano la
  // proposta corrente della sedia: una risposta = una revisione, se qualcosa
  // cambia davvero. La conversazione diventa stato strutturato.
  const chatDecision = useCallback(
    (messageId: string, actions: readonly DecisionAction[]): void => {
      if (!openSeat) return;
      const seat = openSeat;
      setWorkspaces(prev => {
        const key = stateKey(seat);
        const current = prev[key] ?? emptyWorkspace(seat);
        const next = applyDecisionBatch(current, actions, { messageId });
        if (next === current) return prev;
        return { ...prev, [key]: next };
      });
    },
    [openSeat, stateKey],
  );
  const clearPresentation = useCallback((): void => {
    if (!openSeat) return;
    setCanvases(prev => {
      const next = { ...prev };
      delete next[stateKey(openSeat)];
      return next;
    });
  }, [openSeat, stateKey]);
  // WS-MINISTER-UX-07 (C) — Fissare l'evidenza principale: resta sulla tavola
  // mentre si legge; sbloccarla riporta il comportamento normale.
  const togglePin = useCallback((): void => {
    if (!openSeat) return;
    setCanvases(prev => {
      const key = stateKey(openSeat);
      const current = prev[key];
      if (!current) return prev;
      if (current.mains.length > 0) {
        const mains = current.mains.map((item, index) => index === 0 ? { ...item, pinned: !item.pinned } : item);
        return { ...prev, [key]: { ...current, mains } };
      }
      if (current.comparison) {
        return { ...prev, [key]: { ...current, comparison: { ...current.comparison, pinned: !current.comparison.pinned } } };
      }
      return prev;
    });
  }, [openSeat, stateKey]);
  const activeCanvas = openSeat ? canvases[stateKey(openSeat)] ?? null : null;
  const hasCanvasEvidence = Boolean(activeCanvas && (activeCanvas.mains.length > 0 || activeCanvas.comparison));
  const resolvedCanvas = useMemo(
    () => resolveCanvas(activeCanvas ?? emptyCanvas(), canvasBlocks, proposals),
    [activeCanvas, canvasBlocks, proposals],
  );

  // WS-GOVUX-P4 — Il catalogo delle evidenze della sedia per le card in linea:
  // stesso id e stesso titolo dei blocchi reali (nessuna card fantasma).
  const evidenceIndex = useMemo<EvidenceCardIndex>(() => {
    const index: EvidenceCardIndex = {};
    for (const key of availableEvidence(canvasBlocks)) {
      const block = blockForEvidence(key, canvasBlocks);
      if (block) index[key] = { id: block.id, title: block.title, kind: block.kind };
    }
    return index;
  }, [canvasBlocks]);

  const canvasVersion = activeCanvas?.stateVersion ?? -1;
  // Vista la tavola, il pallino si spegne: la versione vista è quella corrente.
  useEffect(() => {
    const viewingTable = mobilePane === 'tavola' || (isMobile && mobileView === 'board');
    if (viewingTable && hasCanvasEvidence) setSeenVersion(canvasVersion);
  }, [mobilePane, isMobile, mobileView, hasCanvasEvidence, canvasVersion]);

  // WS-GOVUX-P4 — Aprire un'evidenza dalla card: si riporta la sua direttiva in
  // cima (read model di UI, nessun effetto di gioco), si apre la tavola su
  // mobile e si mette a fuoco il blocco reale. Scroll, testo in composizione e
  // selezione restano: le pane non si smontano.
  const focusEvidence = useCallback((card: InlineEvidenceCard): void => {
    if (!openSeat) return;
    const hash = card.messageId.lastIndexOf('#');
    const index = hash >= 0 ? Number(card.messageId.slice(hash + 1)) : -1;
    const thread = chatMessages;
    const message = index >= 0 ? thread[index] : undefined;
    if (message) {
      const parsed = parsePresentation(message.content);
      if (parsed.directives.length > 0) {
        // Si riporta la direttiva del messaggio con lo **stesso** contesto con
        // cui era stata emessa (citazione e ultimo discorso del Presidente): la
        // voce di spesa in evidenza, se c'era, non si perde.
        const lastUser = [...thread.slice(0, index)].reverse().find(item => item.role === 'user')?.content ?? '';
        applyPresentation(openSeat, card.messageId, parsed.text.slice(0, 140), parsed.directives, lastUser);
      }
    }
    if (isMobile) {
      if (card.blockId) {
        setEvidenceFocus({ blockId: card.blockId, label: card.title, note: card.label });
        setMobileView('evidence');
      }
    } else {
      setMobilePane('tavola');
    }
    if (card.blockId) setPendingFocus({ id: card.blockId, nonce: Date.now() });
  }, [openSeat, chatMessages, applyPresentation, isMobile]);

  // WS-GOV-TURN-SESSIONS (A8) — Aprire un approfondimento dalla Tavola: si
  // conserva **solo il riferimento** (`evidenceIds`) e si mette a fuoco il blocco
  // reale, se esiste. Richiudere toglie il riferimento. Nessun effetto di gioco.
  const openBoardEvidence = useCallback((id: EvidenceKey): void => {
    if (!openSeat) return;
    setWorkspaces(prev => {
      const key = stateKey(openSeat);
      const current = prev[key] ?? emptyWorkspace(openSeat);
      const next = withEvidenceRefs(current, [...current.evidenceIds, id]);
      return next === current ? prev : { ...prev, [key]: next };
    });
    const block = blockForEvidence(id, canvasBlocks);
    if (isMobile) {
      setEvidenceFocus({ blockId: block?.id ?? null, label: block?.title ?? 'Evidenza', note: '' });
      setMobileView('evidence');
    } else {
      setMobilePane('tavola');
    }
    if (block) setPendingFocus({ id: block.id, nonce: Date.now() });
  }, [openSeat, stateKey, canvasBlocks, isMobile]);
  const closeBoardEvidence = useCallback((id: EvidenceKey): void => {
    if (!openSeat) return;
    setWorkspaces(prev => {
      const key = stateKey(openSeat);
      const current = prev[key];
      if (!current) return prev;
      const evidenceIds = current.evidenceIds.filter(item => item !== id);
      if (evidenceIds.length === current.evidenceIds.length) return prev;
      return { ...prev, [key]: { ...current, evidenceIds } };
    });
  }, [openSeat, stateKey]);

  // WS-GOV-COUNCIL-MEETINGS (B6/B13) — L'orchestrazione è deterministica: il
  // selettore decide chi partecipa, il motore fornisce i dati, i contributi sono
  // attribuiti. Nessuna chat libera fra agenti, nessun LLM come database.
  const meetingRef = useRef<CouncilMeeting | null>(meeting);
  meetingRef.current = meeting;
  const spokenContributionsRef = useRef<Set<string>>(new Set());
  // WS-GOV-MOBILE-FOCUS (A6/A7) — La voce della riunione è **read-only**: passa
  // dal percorso dedicato `government/minister/:seat/render`, che inietta la
  // persona della sedia e il briefing ma **non** scrive memoria/JEV e **non**
  // applica direttive. La prosa resta solo prosa; la Tavola la aggiorna il motore.
  const narrateMeeting = useCallback<MeetingNarrator>(async (seat, brief) => {
    const timeout = new AbortController();
    const timer = window.setTimeout(() => timeout.abort(), 12000);
    try {
      const reply = await ministerApi.render(gameId, seat, brief, timeout.signal);
      return reply.reply;
    } finally {
      window.clearTimeout(timer);
    }
  }, [gameId]);
  // WS-GOV-MOBILE-FOCUS (A5) — La regione attuale, solo se canonicalmente
  // risolvibile (capitale marcata, oppure una sola regione posseduta). Serve a
  // sciogliere «qui» / «nella regione attuale», non a indovinare un luogo.
  const currentRegion = useMemo(
    () => resolveCurrentRegionRef(pictureSources.regions ?? [], pictureSources.account?.polityId ?? null),
    [pictureSources.regions, pictureSources.account?.polityId],
  );
  const runMeeting = useCallback(async (opened: CouncilMeeting, text: string): Promise<void> => {
    try {
      const feasibility = await gameApi.checkFeasibility(gameId, text);
      // La geografia canonica della partita: la localizzazione nasce da lì, mai
      // dal testo. `pictureSources.regions` è la stessa fonte della mappa.
      const read = meetingReadFromFeasibility(opened, feasibility, pictureSources.regions ?? [], currentRegion);
      const prev = meetingRef.current;
      if (!prev || prev.id !== opened.id) return;
      const next = continueMeeting(prev, read);
      meetingRef.current = next;
      setMeeting(next);
      // La conversazione è **una**: gli interventi dei ministri entrano nello
      // stesso filo, ciascuno con la sua voce (B12/B19). Il contributo
      // deterministico resta la base; la voce narrativa lo sostituisce solo se
      // il provider risponde e non contraddice i fatti.
      for (const contribution of next.contributions) {
        if (spokenContributionsRef.current.has(contribution.id)) continue;
        spokenContributionsRef.current.add(contribution.id);
        const brief = meetingBriefFor(next, read, contribution.seat);
        const narrated = await narrativeContribution(brief, contribution.text, narrateMeeting);
        if (!prev || meetingRef.current?.id !== opened.id) return;
        if (openSeat) {
          addMinisterMessage(openSeat, {
            role: 'assistant',
            content: narrated.text,
            speaker: seatSpeaker(contribution.seat),
            turn: currentTurn ?? undefined,
          });
        }
      }
    } catch {
      // Il motore non risponde: la riunione resta in apertura, senza inventare.
    }
  }, [gameId, pictureSources.regions, currentRegion, openSeat, currentTurn, addMinisterMessage, narrateMeeting]);
  const conveneMeeting = useCallback((prompt: MeetingPrompt): boolean => {
    const text = prompt.text;
    if (!openSeat || !gameId || !shouldConveneMeeting(text)) return false;
    const opened = openMeeting({
      gameId,
      branchId,
      turn: currentTurn ?? 0,
      subject: text,
      sourceMessageId: prompt.sourceMessageId,
      ...(prompt.objective ? { objective: prompt.objective } : {}),
    });
    if (!opened) return false;
    // M2 — l'identità dipende dalla **convocazione**, non dalla materia: la
    // stessa richiesta (stesso `sourceMessageId`) aggiorna la riunione attiva con
    // una nuova revisione; una richiesta diversa apre sempre una convocazione
    // nuova, anche con soggetto e partecipanti identici.
    const existing = meetingRef.current;
    if (existing && existing.meetingId === opened.meetingId) {
      void runMeeting(existing, text);
      return true;
    }
    meetingRef.current = opened;
    spokenContributionsRef.current = new Set();
    setMeeting(opened);
    setMobilePane('tavola');
    // B9 — la convocazione è un atto esplicito del Presidente: la sola
    // eccezione all'auto-cambio di vista. Si apre la Tavola della riunione.
    if (isMobile) setMobileView('board');
    void runMeeting(opened, text);
    return true;
  }, [openSeat, gameId, branchId, currentTurn, runMeeting, isMobile]);
  const conveneMeetingSeat = useCallback((seat: CabinetSeat): void => {
    setMeeting(prev => {
      if (!prev || prev.participants.includes(seat)) return prev;
      const next = { ...prev, participants: CABINET_SEATS.filter(item => prev.participants.includes(item) || item === seat) };
      meetingRef.current = next;
      return next;
    });
  }, []);
  const prepareMeetingAct = useCallback((): void => {
    const current = meetingRef.current;
    if (!current) return;
    const draft = meetingActDraft(current, { seat: current.leadSeat });
    setActDraft({
      ...draft,
      signatureKey: crypto.randomUUID(),
      revision: current.revision,
      ...actIdentity(sessionId, currentTurn ?? 0, current.leadSeat, current.revision),
    });
    rememberFor(current.leadSeat, declaredPreference(current.leadSeat, draft.title, {
      gameDate: currentDate ?? '', turn: currentTurn ?? undefined,
    }));
    // H19 — l'atto è una vista distinta del mobile, non una sezione in fondo.
    if (isMobile) setMobileView('act');
  }, [sessionId, currentTurn, currentDate, rememberFor, isMobile]);

  // La messa a fuoco accade dopo il render: la tavola è già visibile (anche su
  // mobile, dove `mobilePane` è appena passato a «tavola»).
  useEffect(() => {
    if (!pendingFocus) return;
    const root = tableRef.current ?? evidenceRef.current;
    const selector = pendingFocus.id === 'comparison'
      ? '.proposal-comparison'
      : `[data-block-id="${pendingFocus.id}"]`;
    const block = root ? root.querySelector(selector) : null;
    if (!block) return;
    block.scrollIntoView({ behavior: 'smooth', block: 'center' });
    block.classList.add('seat-evidence-focus');
    const timer = window.setTimeout(() => block.classList.remove('seat-evidence-focus'), 1800);
    return () => {
      window.clearTimeout(timer);
      block.classList.remove('seat-evidence-focus');
    };
  }, [pendingFocus]);

  // L'atto firmato tramite la coda del motore: l'opera (cantiere reale) o un
  // ordine in testo. Entra nel registro, non resta una promessa.
  //
  // WS-MINISTER-UX-06 — Dal tavolo: lo stato **reale** di ogni strada è derivato
  // da coda e cronologia (mai un flag locale «accolta»), la strada si **prepara**
  // in una bozza, la bozza si corregge e si **firma** — una volta sola.
  const roadStates = useMemo(() => {
    const seat = address?.seat;
    if (!seat) return {} as Record<string, ActState>;
    return Object.fromEntries(
      proposals.map(road => [road.id, deriveActState(actDraftFor(road, seat), pendingActions, turnHistory)]),
    ) as Record<string, ActState>;
  }, [address?.seat, proposals, pendingActions, turnHistory]);

  // WS-GOVUX-P1 — L'agenda viva del Consiglio: frase, argomento, questioni e
  // stato di ogni ministro, dai suoi indirizzi, dal filo del colloquio e dalla
  // memoria. La sintesi è contata sugli **stessi** record della lista. È un
  // selettore puro: nessuna urgenza inventata, nessuna chiamata al modello.
  const agenda = useMemo(
    () => deriveCouncilAgenda({ session, threads: ministerChats, memory: memoryStore }),
    [session, ministerChats, memoryStore],
  );

  // WS-GOVUX-P6 — Revocare un ricordo: resta nello storico (marcato `revoked`),
  // esce dal retrieval. La copia autorevole è server-side: viaggia col prossimo
  // messaggio al ministro, come gli altri ricordi.
  const revokeFor = useCallback((seat: CabinetAddressView['seat'], id: string): void => {
    setMemoryStore(prev => withSeatRecords(prev, seat, revokeMemory(prev[seat] ?? [], id)));
  }, []);

  const draftStatus = actDraft ? actStatus(actDraft, pendingActions, turnHistory) : null;

  // ── WS-GOVUX-P7 — La plancia delle conseguenze, prima della firma ────────
  // Lo snapshot canonico del mondo: la firma del preventivo cambia con il testo
  // della bozza e con questo contesto, non con l'istante tecnico.
  const boardSnapshotKey = useMemo(
    () => actionSnapshotKey({ id: gameId, currentTurn, currentDate, headBranchId: branchId ?? undefined }),
    [gameId, currentTurn, currentDate, branchId],
  );
  const boardRoad = useMemo(
    () => (actDraft ? proposals.find(road => road.id === actDraft.roadId) ?? null : null),
    [actDraft, proposals],
  );
  const boardItem = boardRoad && boardRoad.order.kind === 'work' ? boardRoad.order.item : null;

  // La verifica del motore per gli ordini in prosa: è la **stessa** funzione di
  // costo che il motore usa all'esecuzione, quindi i costi della preview sono
  // quelli applicati nelle stesse condizioni. Per le opere il payload è la
  // distinta già risolta dal server: la plancia legge quella, non la ricalcola.
  const refreshActBoard = useCallback((): void => {
    if (!actDraft || actDraft.capability !== 'text-order' || !gameId) return;
    const draft = actDraft;
    const signature = consequenceBoardSignature({ snapshotKey: boardSnapshotKey, draft });
    setActPreviewLoading(true);
    setActPreviewError(null);
    gameApi.checkFeasibility(gameId, draft.text)
      .then(result => setActPreview({ signature, result }))
      .catch(() => {
        setActPreview(null);
        setActPreviewError('La verifica del motore non è disponibile ora: la stima resta dichiarata.');
      })
      .finally(() => setActPreviewLoading(false));
  }, [actDraft, boardSnapshotKey, gameId]);

  // Si verifica alla PREPARAZIONE della bozza; le modifiche al testo marcano la
  // stima come stantia e si ricalcolano dal pulsante (nessun ricalcolo silenzioso).
  useEffect(() => {
    if (!actDraft || actDraft.capability !== 'text-order') {
      setActPreview(null);
      setActPreviewError(null);
      return;
    }
    refreshActBoard();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [actDraft?.id]);

  const consequenceBoard = useMemo(
    () => (actDraft
      ? buildConsequenceBoard({
          draft: actDraft,
          road: boardRoad,
          item: boardItem,
          snapshotKey: boardSnapshotKey,
          preview: actPreview?.result ?? null,
          previewSignature: actPreview?.signature ?? null,
        })
      : null),
    [actDraft, boardRoad, boardItem, boardSnapshotKey, actPreview],
  );

  // WS-GOV-DIALOGUE-TO-ACT — La decisione in corso della sedia aperta e la
  // revisione su cui poggia l'atto preparato (per marcare l'atto stantio).
  const workspace = openSeat ? workspaces[stateKey(openSeat)] ?? null : null;
  const currentDecision = useMemo(() => projectCurrentDecision(workspace), [workspace]);
  const actRevision = actDraft?.revision ?? null;
  const actStale = workspace ? actStaleness(workspace, actRevision) : null;
  const decisionQuestion = address?.items[0]?.need ?? null;

  // WS-GOV-MOBILE-CLEANUP (M1/M17) — La convocazione nasce dall'**ultimo
  // messaggio del Presidente**, con un `sourceMessageId` stabile derivato dalla
  // seduta e dalla posizione del messaggio (mai dal solo contenuto). Il titolo
  // della decisione viene dall'objective già noto dal workspace, non inventato.
  const meetingPrompt = useMemo<MeetingPrompt | null>(() => {
    if (!openSeat) return null;
    let index = -1;
    for (let i = chatMessages.length - 1; i >= 0; i -= 1) {
      if (chatMessages[i].role === 'user') { index = i; break; }
    }
    if (index < 0) return null;
    const text = chatMessages[index].content;
    if (!shouldConveneMeeting(text)) return null;
    const sourceMessageId = `${sessionId}:${openSeat}:user-${index}`;
    // M2 — la convocazione attiva nata da QUESTO messaggio non è una nuova
    // convocazione: è la stessa (una nuova lettura la farà avanzare).
    if (meeting?.sourceMessageId === sourceMessageId) return null;
    if (meeting && !meeting.sourceMessageId && meeting.subject === text) return null;
    const objective = workspace ? activeProposal(workspace)?.objective ?? workspace.objective ?? null : null;
    return {
      text,
      sourceMessageId,
      ...(objective ? { objective } : {}),
    };
  }, [meeting, openSeat, chatMessages, sessionId, workspace]);

  // ── WS-GOV-MOBILE-FOCUS (H8–H24) — Il view model della vista mobile ──────
  // Derivato dalla stessa fonte del desktop: nessuna cifra nuova, nessuno stato
  // persistito. Se un dato non c'è, la vista dichiara l'assenza.
  const mobileSummary = useMemo(
    () => mobileDecisionSummary({
      meeting,
      workspace,
      actPrepared: Boolean(actDraft),
      actStale: Boolean(actStale),
      signed: lastOutcome?.kind === 'order',
      pendingMeetingPrompt: meetingPrompt?.text ?? null,
    }),
    [meeting, workspace, actDraft, actStale, lastOutcome, meetingPrompt],
  );
  const mobileParticipants = useMemo(() => participantChips(meeting), [meeting]);
  const mobileRevisions = useMemo(() => mobileHistory(workspace), [workspace]);
  // M15 — la Tavola mobile è il **risultato** della riunione, per ministero.
  const mobileMinisterSections = useMemo(() => ministerSectionsFromMeeting(meeting), [meeting]);
  // M8 — le fonti, una sola volta, con l'id tecnico tradotto in etichetta.
  const mobileSources = useMemo(() => {
    const sources = meeting ? meeting.workspace.lines.map(line => line.source) : [];
    return uniqueSourceLabels(sources);
  }, [meeting]);
  const currentBlockersKey = useMemo(() => blockerKey(meeting), [meeting]);
  const boardDot = shouldShowBoardDot({
    view: mobileView,
    seenRevision: boardSeen.revision,
    currentRevision: workspace?.revision ?? -1,
    seenMeetingRevision: boardSeen.meetingRevision,
    currentMeetingRevision: meeting?.revision ?? -1,
    seenBlockerKey: boardSeen.blockers,
    currentBlockerKey: currentBlockersKey,
  }) || shouldShowEvidenceBadge({
    hasEvidence: hasCanvasEvidence,
    canvasVersion,
    seenVersion,
    pane: mobileView === 'board' ? 'tavola' : 'dialogo',
  });
  const convenable = useMemo(
    () => convenableMinisters(CABINET_SEATS.map(seat => ({ seat })), meeting),
    [meeting],
  );
  // H4 — al cambio di vista lo scroll riparte dal punto memorizzato della vista.
  useEffect(() => {
    if (!isMobile) return;
    const target = mobileView === 'dialogue' ? dialogueScrollRef.current : mobileView === 'board' ? boardScrollRef.current : null;
    if (!target) return;
    const saved = mobileView === 'dialogue' ? scrollMemory.current.dialogue : scrollMemory.current.board;
    if (saved > 0) target.scrollTop = saved;
  }, [isMobile, mobileView]);
  // H6 — aprire la Tavola spegne il pallino: la revisione vista è quella corrente.
  useEffect(() => {
    if (!isMobile || mobileView !== 'board') return;
    setBoardSeen({ revision: workspace?.revision ?? -1, meetingRevision: meeting?.revision ?? -1, blockers: currentBlockersKey });
  }, [isMobile, mobileView, workspace?.revision, meeting?.revision, currentBlockersKey]);
  // H2 — aprire l'atto o l'evidenza è una vista distinta, non un terzo tab fisso.
  useEffect(() => {
    if (actDraft && mobileView === 'act') return;
    if (!actDraft && mobileView === 'act') setMobileView('board');
  }, [actDraft, mobileView]);
  // H8/H24 — L'unica prossima azione, in chiaro. Ogni azione porta a **una**
  // cosa: continuare, convocare, preparare, firmare. Mai due CTA primarie.
  // WS-GOV-SEAT-BOARDS (B25/B26) — La Tavola comune legge il workspace **vivo**
  // di ogni sedia convocata: la promozione è un riferimento, non una copia.
  const councilLookup = useCallback(
    (seat: CabinetSeat): DecisionWorkspace | null => workspaces[stateKey(seat)] ?? null,
    [workspaces, stateKey],
  );
  const promoteOpenToCouncil = useCallback((): void => {
    if (!openSeat) return;
    const current = workspaces[stateKey(openSeat)];
    if (!canPromoteToCouncil(current ?? null) || !current) return;
    setCouncil(prev => conveneSeat(prev ?? promoteToCouncil(current, openSeat), openSeat));
  }, [openSeat, workspaces, stateKey]);
  const conveneSeatInCouncil = useCallback((target: CabinetSeat): void => {
    setCouncil(prev => {
      let base = prev;
      if (!base && openSeat) {
        const current = workspaces[stateKey(openSeat)];
        if (current && canPromoteToCouncil(current)) base = promoteToCouncil(current, openSeat);
      }
      return base ? conveneSeat(base, target) : null;
    });
    setOpenSeat(target);
  }, [openSeat, workspaces, stateKey]);
  const openCouncilSeat = useCallback((seat: CabinetSeat): void => {
    setOpenSeat(seat);
  }, []);
  const leaveCouncil = useCallback((): void => { setCouncil(null); }, []);

  const prepareRoad = useCallback((road: TreasuryRoad): void => {
    if (!address) return;
    // A6 — L'atto porta la sua identità storica: turno, revisione e seduta.
    setActDraft({
      ...actDraftFor(road, address.seat),
      signatureKey: crypto.randomUUID(),
      ...actIdentity(sessionId, currentTurn ?? 0, address.seat, 0),
    });
    // WS-GOVUX-P6 — Preparare una strada è una **preferenza dichiarata**, non una
    // decisione: la decisione è la firma. Il turno àncora il ricordo al mondo.
    rememberFor(address.seat, declaredPreference(address.seat, road.title, {
      gameDate: currentDate ?? '', turn: currentTurn ?? undefined,
    }));
    if (isMobile) setMobileView('act');
  }, [address, currentDate, currentTurn, rememberFor, sessionId, isMobile]);

  const editDraft = useCallback((text: string): void => {
    setActDraft(current => (current && !current.signatureAttempted ? { ...editActDraft(current, text), signatureKey: current.signatureKey } : current));
  }, []);

  // WS-GOV-DIALOGUE-TO-ACT — «Trasforma questa proposta in atto» / «Rigenera
  // atto»: l'atto nasce dalla **proposta corrente**, non dalla strada iniziale.
  // Mai automatico: lo comanda il Presidente. La revisione viaggia con l'atto,
  // così una proposta che avanza lo rende `stale`.
  const prepareFromProposal = useCallback((): void => {
    if (!openSeat) return;
    const current = workspaces[stateKey(openSeat)];
    const proposal = current ? activeProposal(current) : null;
    if (!current || !proposal) return;
    const draft = actDraftFromProposal(proposal, { seat: openSeat });
    setActDraft({
      ...draft,
      signatureKey: crypto.randomUUID(),
      revision: current.revision,
      ...actIdentity(sessionId, currentTurn ?? 0, openSeat, current.revision),
    });
    rememberFor(openSeat, declaredPreference(openSeat, draft.title, {
      gameDate: currentDate ?? '', turn: currentTurn ?? undefined,
    }));
    if (isMobile) setMobileView('act');
  }, [openSeat, workspaces, stateKey, currentTurn, sessionId, currentDate, rememberFor, isMobile]);

  // H8/H24 — L'unica prossima azione, in chiaro. Ogni azione porta a **una**
  // cosa: continuare, convocare, preparare, firmare. Mai due CTA primarie.
  const runMobilePrimary = useCallback((): void => {
    switch (mobileSummary.primaryAction) {
      case 'convene':
        if (meetingPrompt) conveneMeeting(meetingPrompt);
        break;
      case 'prepare-act':
        if (meetingRef.current) prepareMeetingAct(); else prepareFromProposal();
        break;
      case 'regenerate-act':
        prepareFromProposal();
        break;
      case 'sign':
      case 'continue':
      default:
        setMobileView(mobileSummary.primaryAction === 'sign' ? 'act' : 'dialogue');
        break;
    }
  }, [mobileSummary.primaryAction, meetingPrompt, conveneMeeting, prepareMeetingAct, prepareFromProposal]);

  const cancelDraft = useCallback((): void => {
    setActDraft(null);
  }, []);

  // «Confronta le strade» dal tavolo: mostra, non accoda. Come il confronto
  // chiesto a voce, le strade entrano in memoria come proposte discusse.
  const compareFromTable = useCallback((): void => {
    if (openSeat) applyPresentation(openSeat, 'tavola', '', [{ op: 'compare' }]);
  }, [openSeat, applyPresentation]);

  // La chiave appartiene alla bozza preparata, non al singolo POST: retry e
  // doppio clic sono deduplicati atomicamente dal server, non dal busy UI.
  const signDraft = async (draft: ProposalActDraft): Promise<boolean> => {
    if (!address || !onQueueOrder || !actDraft || actDraft.id !== draft.id || actDraft.text !== draft.text) return false;
    const signatureKey = actDraft.signatureKey;
    setActDraft(current => current?.signatureKey === signatureKey ? { ...current, signatureAttempted: true, signatureNotice: undefined } : current);
    setActBusy(true);
    try {
      const queued = await onQueueOrder(draft.text, draft.work, signatureKey);
      if (!queued) {
        setActDraft(current => current?.signatureKey === signatureKey ? {
          ...current,
          signatureNotice: 'Firma non confermata nel registro corrente. Riprova questa bozza senza modificarla; per una firma diversa annulla la preparazione e prepara una nuova bozza.',
        } : current);
      }
      if (queued) {
        const headline = actHeadline(draft);
        setLastOutcome({ seat: address.seat, label: address.label, kind: 'order', text: headline });
        rememberFor(address.seat, queuedDecision(address.seat, headline, { gameDate: currentDate ?? '', turn: currentTurn ?? undefined }));
      }
      return queued;
    } finally {
      setActBusy(false);
    }
  };

  // ── Gli esiti: un ordine in coda, o un nulla di fatto ───────────────────
  const concludeNothing = (): void => {
    if (address) {
      setLastOutcome({ seat: address.seat, label: address.label, kind: 'nothing' });
      // Una seduta senza ordine lascia una questione aperta: si ricorda come
      // aperta, non come respinta e non come approvata.
      rememberFor(address.seat, openQuestion(
        address.seat,
        'Seduta chiusa senza ordine: nessuna decisione presa.',
        { gameDate: currentDate ?? '', turn: currentTurn ?? undefined },
      ));
    }
    setOpenSeat(null);
  };

  // ── WS-GOV-MOBILE-FOCUS (PARTE H) — La sessione mobile come macchina a stati ─
  // Stesso stato del desktop, composizione diversa: in ogni momento una cosa
  // principale e una prossima azione. La vista atto e la vista evidenza sono
  // distinte, non un terzo tab fisso.
  const sessionLabel = currentTurn != null ? `NUOVA SEDUTA · Turno ${currentTurn}` : null;
  const proposalForBoard = workspace ? activeProposal(workspace) : null;
  const mobileEvidenceBlock = evidenceFocus?.blockId
    ? canvasBlocks.find(block => block.id === evidenceFocus.blockId) ?? null
    : null;
  const mobileSession = (
    <div className="gov-mobile" data-view={mobileView}>
      <header className="gov-mobile-head">
        <button
          type="button"
          className="gov-mobile-nav"
          onClick={() => {
            if (mobileView === 'dialogue') setOpenSeat(null);
            else if (mobileView === 'board') goMobileView('dialogue');
            else goMobileView('board');
          }}
          aria-label={mobileView === 'dialogue' ? 'Torna ai ministri' : mobileView === 'board' ? 'Torna al dialogo' : 'Torna alla Tavola'}
        >
          <span aria-hidden="true">←</span>
          <span>{mobileView === 'dialogue' ? 'Ministri' : mobileView === 'board' ? 'Dialogo' : 'Tavola'}</span>
        </button>
        <h2 className="gov-mobile-title" id="government-office-title">
          {mobileView === 'act' ? 'Atto' : mobileView === 'evidence' ? 'Evidenza' : (address?.label ?? 'Seduta')}
        </h2>
        <button type="button" className="gov-mobile-close" onClick={onClose} aria-label="Chiudi il Governo" title="Chiudi il Governo">✕</button>
      </header>

      <p className="gov-mobile-sessionline">
        {sessionLabel && <span className="gov-mobile-new">{sessionLabel}</span>}
        {nationalName && <span>{nationalName}</span>}
        {currentDate && <span>{currentDate}</span>}
      </p>

      {(mobileView === 'dialogue' || mobileView === 'board') && (
        <nav className="gov-mobile-tabs" role="tablist" aria-label="Viste della seduta">
          <button
            type="button"
            role="tab"
            id="gov-tab-dialogue"
            aria-selected={mobileView === 'dialogue'}
            aria-controls="gov-panel-dialogue"
            className={`gov-mobile-tab${mobileView === 'dialogue' ? ' active' : ''}`}
            onClick={() => goMobileView('dialogue')}
          >
            Dialogo
          </button>
          <button
            type="button"
            role="tab"
            id="gov-tab-board"
            aria-selected={mobileView === 'board'}
            aria-controls="gov-panel-board"
            className={`gov-mobile-tab${mobileView === 'board' ? ' active' : ''}`}
            onClick={() => goMobileView('board')}
          >
            Tavola
            {boardDot && <span className="gov-mobile-dot" title="La Tavola è cambiata" aria-hidden="true" />}
          </button>
        </nav>
      )}

      <div
        className="gov-mobile-scroll"
        id="gov-panel-dialogue"
        role="tabpanel"
        aria-labelledby="gov-tab-dialogue"
        hidden={mobileView !== 'dialogue'}
        ref={dialogueScrollRef}
      >
          {meeting && (
            <div className="gov-mobile-chips" aria-label="Partecipanti alla riunione">
              {mobileParticipants.shown.map(chip => (
                <span key={chip.seat} className="gov-mobile-chip" data-lead={chip.lead ? 'true' : undefined} data-seat={chip.seat}>
                  {chip.label}{chip.lead ? ' · capofila' : ''}
                </span>
              ))}
              {mobileParticipants.hidden > 0 && (
                <span className="gov-mobile-chip more">+{mobileParticipants.hidden}</span>
              )}
            </div>
          )}
          <SeatBrief address={address} memory={memoryRecords} onRevoke={id => { if (openSeat) revokeFor(openSeat, id); }} />
          <div className="gov-mobile-chat" data-meeting={meeting ? 'true' : undefined}>
            <MinisterChat
              gameId={gameId}
              address={address}
              messages={chatMessages}
              streaming={streaming}
              memory={memoryRecords}
              sessionId={sessionId}
              currentDecision={currentDecision}
              retainedOpening={retainedOpening}
              onOpening={retainOpening}
              onAddMessage={message => { if (openSeat) addMinisterMessage(openSeat, { ...message, turn: currentTurn ?? undefined }); }}
              onAppendToken={token => { if (openSeat) appendToLastMinisterMessage(openSeat, token); }}
              onStreamingChange={isStreaming => setMinisterStreaming(isStreaming ? openSeat : null)}
              onPresentation={chatPresentation}
              onDecision={chatDecision}
              evidenceIndex={evidenceIndex}
              onFocusEvidence={focusEvidence}
            />
          </div>
        </div>

      <div
        className="gov-mobile-scroll"
        id="gov-panel-board"
        role="tabpanel"
        aria-labelledby="gov-tab-board"
        hidden={mobileView !== 'board'}
        ref={boardScrollRef}
      >
          <section className="gov-mobile-board" data-meeting-id={meeting?.id} data-meeting-key={meeting?.meetingId} data-meeting-revision={meeting?.revision}>
            <header className="gov-mobile-board-head">
              <h3 className="gov-mobile-board-title">{mobileSummary.title}</h3>
              {/* M17/M19 — la localizzazione è separata dal titolo, non incollata. */}
              {meeting?.workspace.region && <p className="gov-mobile-board-place">{meeting.workspace.region}</p>}
              <span className="gov-mobile-board-status" data-state={mobileSummary.status.toLowerCase().replace(/\s+/g, '-')}>{mobileSummary.status}</span>
            </header>

            {/* H10/H24 — prima di tutto la ragione del blocco, in chiaro. */}
            {mobileSummary.unresolved.length > 0 && (
              <div className="gov-mobile-alerts" role="status">
                {mobileSummary.unresolved.map((blocker, index) => (
                  <p key={`${blocker.kind}-${index}`} className="gov-mobile-alert">
                    <span className="gov-mobile-alert-q">⚠ {blocker.label}</span>
                    {blocker.owner && <span className="gov-mobile-alert-owner">{blocker.owner}</span>}
                  </p>
                ))}
              </div>
            )}

            {/* M15/M19 — il RISULTATO della riunione, per ministero: le righe del
                piano condiviso. Il transcript dei discorsi resta nel Dialogo (M14). */}
            {meeting ? (
              mobileMinisterSections.length > 0 ? (
                <div className="gov-mobile-ministers">
                  {mobileMinisterSections.map(section => (
                    <section key={section.seat} className="gov-mobile-minister" data-seat={section.seat} aria-label={section.label}>
                      <h4 className="gov-mobile-minister-title">{section.label}</h4>
                      <ul className="gov-mobile-checklist">
                        {section.lines.map(line => (
                          <li key={`${section.seat}-${line.label}`} data-status={line.status}>
                            <span className="gov-mobile-check" aria-hidden="true">{line.status === 'ok' ? '✓' : line.status === 'missing' ? '✗' : '?'}</span>
                            <span className="gov-mobile-check-label">{line.label}</span>
                            <span className="gov-mobile-check-value">{line.value}</span>
                          </li>
                        ))}
                      </ul>
                    </section>
                  ))}
                </div>
              ) : (
                <section className="gov-mobile-decision" aria-label="Che cosa stiamo decidendo">
                  <p className="gov-mobile-empty">Nessun dato dal motore: la Tavola non inventa.</p>
                </section>
              )
            ) : (
              <section className="gov-mobile-decision" aria-label="Che cosa stiamo decidendo">
                <h4 className="gov-mobile-section-title">Che cosa stiamo decidendo</h4>
                {proposalForBoard ? (
                  <p className="gov-mobile-proposal">{proposalSummary(proposalForBoard)}</p>
                ) : (
                  <p className="gov-mobile-empty">Ancora nessuna misura concordata: continua il dialogo.</p>
                )}
              </section>
            )}

            {/* M6/M7 — approfondimenti nativi: costruiti dallo stesso stato ma
                leggeri. La Tavola desktop (`SeatTable`) NON si reinnesta qui. */}
            <details className="gov-mobile-more">
              <summary className="gov-mobile-more-summary">Approfondimenti</summary>
              <div className="gov-mobile-more-body">
                {canvasBlocks.length > 0 && (
                  <div className="gov-mobile-more-group">
                    <h4 className="gov-mobile-section-title">Evidenze</h4>
                    <ul className="gov-mobile-source-list">
                      {canvasBlocks.map(block => (
                        <li key={block.id}>
                          <button
                            type="button"
                            className="gov-mobile-source"
                            onClick={() => {
                              setEvidenceFocus({ blockId: block.id, label: block.title, note: '' });
                              goMobileView('evidence');
                            }}
                          >
                            {block.title}
                          </button>
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
                {mobileSources.length > 0 && (
                  <div className="gov-mobile-more-group">
                    <h4 className="gov-mobile-section-title">Fonti</h4>
                    <ul className="gov-mobile-source-list" data-sources={mobileSources.join(',')}>
                      {mobileSources.map(source => (
                        <li key={source} className="gov-mobile-source-text">{source}</li>
                      ))}
                    </ul>
                  </div>
                )}
                {mobileRevisions.length > 0 && (
                  <div className="gov-mobile-more-group">
                    <h4 className="gov-mobile-section-title">Cronologia</h4>
                    <ul className="gov-mobile-history-list">
                      {mobileRevisions.map(entry => (
                        <li key={entry.revision}>v{entry.revision} — {entry.summary}</li>
                      ))}
                    </ul>
                  </div>
                )}
              </div>
            </details>
          </section>

          {/* H8/B24 — una sola CTA primaria, fissa in fondo. */}
          {mobileSummary.primaryLabel && (
            <div className="gov-mobile-cta">
              <button type="button" className="gov-mobile-primary" onClick={runMobilePrimary}>
                {mobileSummary.primaryLabel}
              </button>
              {meeting && convenable.length > 0 && (
                <button
                  type="button"
                  className="gov-mobile-secondary"
                  onClick={event => { sheetReturnRef.current = event.currentTarget; setMobileSheet('convene'); }}
                >
                  + Ministro
                </button>
              )}
            </div>
          )}
        </div>

      {actDraft && draftStatus && (
        <div className="gov-mobile-scroll" id="gov-panel-act" hidden={mobileView !== 'act'}>
          {lastOutcome?.kind === 'order' ? (
            <section className="gov-mobile-signed" role="status">
              <h3>✓ Atto firmato</h3>
              <p>Inserito nel registro e in attesa di esecuzione.</p>
              {lastOutcome.text && <p className="gov-mobile-signed-text">«{lastOutcome.text}»</p>}
              <button type="button" className="gov-mobile-primary" onClick={() => { setActDraft(null); goMobileView('board'); }}>Torna alla Tavola</button>
            </section>
          ) : (
            <ActDraftPanel
              draft={actDraft}
              status={draftStatus}
              busy={actBusy}
              editable={!actDraft.signatureAttempted && !actStale}
              signatureNotice={actDraft.signatureNotice}
              mobile
              board={consequenceBoard}
              boardLoading={actPreviewLoading}
              boardError={actPreviewError}
              onRefreshBoard={refreshActBoard}
              onEdit={editDraft}
              onSign={signDraft}
              onCancel={() => { cancelDraft(); goMobileView('board'); }}
            />
          )}
        </div>
      )}

      <div className="gov-mobile-scroll" id="gov-panel-evidence" hidden={mobileView !== 'evidence'}>
          <section className="gov-mobile-evidence" aria-label="Evidenza in primo piano" ref={evidenceRef}>
            <span className="gov-mobile-kicker">{evidenceFocus?.label ?? 'Evidenza'}</span>
            {mobileEvidenceBlock ? (
              <SeatCanvas blocks={[mobileEvidenceBlock]} />
            ) : (
              <p className="gov-mobile-empty">L’evidenza richiesta non è più disponibile sulla tavola.</p>
            )}
            {evidenceFocus?.note && <p className="gov-mobile-evidence-note">{evidenceFocus.note}</p>}
            <button type="button" className="gov-mobile-primary" onClick={() => goMobileView('board')}>Torna alla decisione</button>
          </section>
      </div>

      {mobileSheet === 'convene' && (
        <GovernmentBottomSheet
          open
          title="Convoca un ministro"
          onClose={() => setMobileSheet(null)}
        >
          <ul className="gov-sheet-list">
            {convenable.map(({ seat }) => (
              <li key={seat}>
                <button type="button" className="gov-sheet-item" onClick={() => { conveneMeetingSeat(seat); setMobileSheet(null); }}>
                  <span className="gov-sheet-item-name">{seatSpeaker(seat)}</span>
                  <span className="gov-sheet-item-go" aria-hidden="true">›</span>
                </button>
              </li>
            ))}
            {convenable.length === 0 && <li className="gov-sheet-empty">Tutte le competenze sono già a tavola.</li>}
          </ul>
        </GovernmentBottomSheet>
      )}
    </div>
  );

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
            agenda={agenda}
            loading={sessionLoading}
            error={sessionError}
            onOpenSeat={next => { setLastOutcome(null); setOpenSeat(next.seat); }}
          />
        </>
      ) : isMobile ? (
        mobileSession
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
                {shouldShowEvidenceBadge({ hasEvidence: hasCanvasEvidence, canvasVersion, seenVersion, pane: mobilePane }) && (
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
                <SeatBrief address={address} memory={memoryRecords} onRevoke={id => { if (openSeat) revokeFor(openSeat, id); }} />
                <MinisterChat
                  gameId={gameId}
                  address={address}
                  messages={chatMessages}
                  streaming={streaming}
                  memory={memoryRecords}
                  sessionId={sessionId}
                  currentDecision={currentDecision}
                  retainedOpening={retainedOpening}
                  onOpening={retainOpening}
                  onAddMessage={message => { if (openSeat) addMinisterMessage(openSeat, { ...message, turn: currentTurn ?? undefined }); }}
                  onAppendToken={token => { if (openSeat) appendToLastMinisterMessage(openSeat, token); }}
                  onStreamingChange={isStreaming => setMinisterStreaming(isStreaming ? openSeat : null)}
                  onPresentation={chatPresentation}
                  onDecision={chatDecision}
                  evidenceIndex={evidenceIndex}
                  onFocusEvidence={focusEvidence}
                />

                {lastOutcome?.kind === 'order' && (
                  <p className="government-office-outcome-note" role="status">
                    Atto firmato nel registro — «{lastOutcome.text}»
                  </p>
                )}
                {actDraft && draftStatus && (
                  <p className="government-office-act-status" data-state={draftStatus.state} role="status" aria-live="polite">
                    Atto «{actDraft.title}»: {draftStatus.label} — {draftStatus.note}
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
                ref={tableRef}
                className="government-office-pane government-office-pane-table"
                data-pane="tavola"
                aria-label="Tavola di lavoro"
              >
                <SeatTable
                  seat={address?.seat ?? 'lavori'}
                  blocks={canvasBlocks}
                  act={act}
                  onPrepareRoad={prepareRoad}
                  preparedRoadId={actDraft?.roadId ?? null}
                  roadStates={roadStates}
                  actDraft={actDraft}
                  actStatus={draftStatus}
                  actBusy={actBusy}
                  actEditable={!actDraft?.signatureAttempted && !actStale}
                  actSignatureNotice={actDraft?.signatureNotice}
                  onEditDraft={editDraft}
                  onSignDraft={signDraft}
                  onCancelDraft={cancelDraft}
                  actBoard={consequenceBoard}
                  actBoardLoading={actPreviewLoading}
                  actBoardError={actPreviewError}
                  onRefreshActBoard={refreshActBoard}
                  onCompare={compareFromTable}
                  canvas={resolvedCanvas}
                  onClearPresentation={clearPresentation}
                  onTogglePin={togglePin}
                  onReturnToMessage={() => setMobilePane('dialogo')}
                  proposals={proposals}
                  workspace={workspace}
                  decisionQuestion={decisionQuestion}
                  actRevision={actRevision}
                  onPrepareFromProposal={prepareFromProposal}
                  onRegenerateAct={prepareFromProposal}
                  council={council}
                  councilLookup={councilLookup}
                  onConveneSeat={conveneSeatInCouncil}
                  onOpenCouncilSeat={openCouncilSeat}
                  onLeaveCouncil={leaveCouncil}
                  onPromoteToCouncil={promoteOpenToCouncil}
                  onOpenEvidence={openBoardEvidence}
                  onCloseEvidence={closeBoardEvidence}
                  meeting={meeting}
                  onPrepareMeetingAct={prepareMeetingAct}
                  onConveneMeetingSeat={conveneMeetingSeat}
                  meetingPrompt={meetingPrompt}
                  onConveneMeeting={conveneMeeting}
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
