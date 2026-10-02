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
  activeProposal, actStaleness, applyDecisionBatch, emptyWorkspace, withEvidenceRefs,
  type DecisionAction, type DecisionWorkspace,
} from './decisionWorkspace';
import {
  canPromoteToCouncil, conveneSeat, promoteToCouncil,
  type CouncilWorkspace,
} from './councilWorkspace';
import {
  actIdentity, consolidateSessionMemory, governmentSessionId, seatFromSessionSeatKey, sessionSeatKey,
} from './governmentSession';
import type { CabinetSeat } from './seatDecisionBoards';
import { deriveCouncilAgenda } from './councilAgenda';
import { nationalOperatingPicture } from './nationalOperatingPicture';
import { nationOperatingPictureInput, type NationOperatingPictureSources } from './nationOperatingPictureInput';
import { useChatStore, useGameStore } from '../../stores';
import { useSimulationStore } from '../../stores/simulationRuntime';
import { gameApi, type CabinetAddressView, type CabinetSessionView } from '../../services/api';
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
  const stateKey = useCallback(
    (seat: CabinetAddressView['seat']): string => sessionSeatKey(sessionId, seat),
    [sessionId],
  );
  const workspacesRef = useRef(workspaces);
  workspacesRef.current = workspaces;
  const sessionIdRef = useRef(sessionId);
  // A2/A3 — Al cambio di turno (o di partita/ramo): **prima** si consolida la
  // seduta precedente in memoria (i fatti narrativamente utili), **poi** lo
  // stato operativo riparte da zero. Il passato diventa memoria, non workspace.
  useEffect(() => {
    if (sessionIdRef.current === sessionId) return;
    sessionIdRef.current = sessionId;
    setMemoryStore(prev => {
      let next = prev;
      for (const [key, ws] of Object.entries(workspacesRef.current)) {
        if (!ws) continue;
        const seat = seatFromSessionSeatKey(key) as CabinetAddressView['seat'] | null;
        if (!seat) continue;
        for (const record of consolidateSessionMemory(ws, seat, { gameDate: currentDate ?? '', turn: currentTurn ?? undefined })) {
          next = withSeatRecords(next, seat, recordMemory(next[seat] ?? [], record));
        }
      }
      return next;
    });
    setWorkspaces({});
    setCanvases({});
    setCouncil(null);
    setActDraft(null);
    setActPreview(null);
    setActPreviewError(null);
    setActBusy(false);
    setSeenVersion(-1);
    setPendingFocus(null);
    setMobilePane('dialogo');
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
    if (mobilePane === 'tavola' && hasCanvasEvidence) setSeenVersion(canvasVersion);
  }, [mobilePane, hasCanvasEvidence, canvasVersion]);

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
    setMobilePane('tavola');
    if (card.blockId) setPendingFocus({ id: card.blockId, nonce: Date.now() });
  }, [openSeat, chatMessages, applyPresentation]);

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
    setMobilePane('tavola');
    const block = blockForEvidence(id, canvasBlocks);
    if (block) setPendingFocus({ id: block.id, nonce: Date.now() });
  }, [openSeat, stateKey, canvasBlocks]);
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

  // La messa a fuoco accade dopo il render: la tavola è già visibile (anche su
  // mobile, dove `mobilePane` è appena passato a «tavola»).
  useEffect(() => {
    if (!pendingFocus) return;
    const root = tableRef.current;
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
  const actRevision = actDraft?.revision ?? null;
  const actStale = workspace ? actStaleness(workspace, actRevision) : null;
  const decisionQuestion = address?.items[0]?.need ?? null;

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
  }, [address, currentDate, currentTurn, rememberFor, sessionId]);

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
  }, [openSeat, workspaces, stateKey, currentTurn, sessionId, currentDate, rememberFor]);

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
