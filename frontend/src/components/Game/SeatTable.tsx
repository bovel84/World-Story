/**
 * WS-MINISTER-UX-01 — La tavola di lavoro della seduta
 * ====================================================
 * Lo spazio di destra non è una pila di KPI: è la **tavola** su cui il ministro
 * dispone le evidenze che servono a quel passaggio del colloquio. La roadmap
 * chiede «una visualizzazione principale e, normalmente, non più di due elementi
 * di supporto; gli approfondimenti restano espandibili».
 *
 * Questo componente dà la gerarchia senza toccare il read model:
 *  - l'atto del Tesoro, quando c'è, è il documento principale;
 *  - il blocco derivato più utile (piano, mappa, grafico, cifre, idee, in
 *    quest'ordine) è la **visualizzazione principale**;
 *  - fino a due blocchi successivi sono i **supporti**;
 *  - il resto sta in un `<details>` «Approfondimenti», chiuso di default.
 *
 * WS-MINISTER-UX-03 — La selezione può ora arrivare dalla **conversazione**: una
 * `ResolvedPresentation` (risolta da `presentation.ts`) porta in cima l'evidenza
 * che il ministro ha richiesto, oppure mostra il **confronto** tra le proposte.
 *
 * WS-MINISTER-UX-06 — Dal tavolo si **prepara** l'atto: la strada scelta diventa
 * una bozza correggibile (`ActDraftPanel`) che il Presidente firma. Preparare e
 * confrontare non accodano e non spendono.
 *
 * WS-MINISTER-UX-08 — Correzioni dei difetti osservati:
 *  - **1**: quando la conversazione chiede un'evidenza, quella **occupa subito
 *    la parte principale** e l'atto del Tesoro non la precede; l'atto compare
 *    quando è **pertinente** alla decisione (spesa, cifre, piano, confronto),
 *    non per default;
 *  - **2**: confronto e proposte derivano dalla **sedia aperta** (`proposals`),
 *    non da `act.roads` globale;
 *  - **5**: l'ordine nasce dalla **proposta concreta** (`SeatProposalPanel`), non
 *    da un pulsante sotto la singola domanda; le fonti stanno nei dettagli.
 */
import { SeatCanvas } from './SeatCanvas';
import { TreasuryActPanel } from './TreasuryActPanel';
import { SeatProposalPanel } from './SeatProposalPanel';
import { ActDraftPanel } from './ActDraftPanel';
import { ProposalComparison } from './ProposalComparison';
import { DecisionBoard } from './DecisionBoard';
import { CouncilBoard } from './CouncilBoard';
import type { SeatCanvasBlock } from './seatCanvasModel';
import type { EvidenceKey, ResolvedCanvas, ResolvedPresentation } from './presentation';
import type { ActState, ActStatus, ProposalActDraft } from './actDraft';
import type { TreasuryAct, TreasuryRoad } from './treasuryAct';
import type { CabinetAddressView } from '../../services/api';
import type { ConsequenceBoard as ConsequenceBoardModel } from './consequenceBoard';
import type { DecisionWorkspace } from './decisionWorkspace';
import type { CabinetSeat } from './seatDecisionBoards';
import type { CouncilLookup, CouncilWorkspace } from './councilWorkspace';

/** L'ordine di priorità sulla tavola: il piano prima, le idee per ultime. */
const KIND_PRIORITY: Record<SeatCanvasBlock['kind'], number> = {
  strategy: 0,
  map: 1,
  chart: 2,
  metrics: 3,
  ideas: 4,
};

/** Le evidenze a cui l'atto del Tesoro è pertinente: non lo si nasconde, ma
 *  non deve nemmeno scavalcare una mappa o un grafico richiesti. */
const ACT_EVIDENCE: readonly EvidenceKey[] = ['spesa', 'cifre', 'piano'];

export interface SeatTableProps {
  seat: CabinetAddressView['seat'];
  blocks: SeatCanvasBlock[];
  act: TreasuryAct;
  /**
   * WS-MINISTER-UX-06 — «Prepara l'atto»: la strada diventa una bozza. Non
   * accoda e non spende.
   */
  onPrepareRoad?: (road: TreasuryRoad) => void;
  /** La strada in bozza sul tavolo, se c'è. */
  preparedRoadId?: string | null;
  /** Lo stato reale di ogni strada, derivato da coda e cronologia. */
  roadStates?: Record<string, ActState>;
  /** La bozza d'atto corrente e il suo stato reale. */
  actDraft?: ProposalActDraft | null;
  actStatus?: ActStatus | null;
  /** La firma è in corso: evita il doppio atto. */
  actBusy?: boolean;
  actEditable?: boolean;
  actSignatureNotice?: string;
  onEditDraft?: (text: string) => void;
  onSignDraft?: (draft: ProposalActDraft) => Promise<boolean> | void;
  onCancelDraft?: () => void;
  /** «Confronta le strade» dal tavolo: non accoda nulla. */
  onCompare?: () => void;
  /**
   * WS-MINISTER-UX-03 — La presentazione richiesta dal ministro nella
   * conversazione. `null` = tavola predefinita (l'ordine di UX-01).
   */
  presentation?: ResolvedPresentation | null;
  /**
   * WS-GOVUX-P3 — La **tela** conversazionale risolta: fino a due evidenze
   * principali e un confronto che non le sostituisce. Quando c'è, è lei a
   * guidare la gerarchia; `presentation` resta per i chiamanti storici.
   */
  canvas?: ResolvedCanvas | null;
  /** Tornare alla tavola predefinita, chiudendo l'evidenza presentata. */
  onClearPresentation?: () => void;
  /** WS-MINISTER-UX-07 (C) — Fissare/sbloccare l'evidenza per leggerla con calma. */
  onTogglePin?: () => void;
  /** Tornare al messaggio che ha chiesto l'evidenza (su mobile, al dialogo). */
  onReturnToMessage?: () => void;
  /** Lo stato di una strada che non è ancora diventata bozza. */
  proposals?: readonly TreasuryRoad[];
  /**
   * WS-GOVUX-P7 — La plancia delle conseguenze della bozza, calcolata PRIMA
   * della firma: effetti diretti, previsioni, rischi e incertezze.
   */
  actBoard?: ConsequenceBoardModel | null;
  actBoardLoading?: boolean;
  actBoardError?: string | null;
  onRefreshActBoard?: () => void;
  /**
   * WS-GOV-DIALOGUE-TO-ACT — La decisione in corso della sedia: la proposta
   * corrente domina la tavola, l'atto è il risultato finale.
   */
  workspace?: DecisionWorkspace | null;
  decisionQuestion?: string | null;
  /** La revisione su cui poggia l'atto preparato (per marcare lo stantio). */
  actRevision?: number | null;
  onPrepareFromProposal?: () => void;
  onRegenerateAct?: () => void;
  /**
   * WS-GOV-SEAT-BOARDS (B25/B26) — La riunione di Consiglio: la Tavola comune
   * delle sedie convocate. `councilLookup` legge il workspace vivo di ciascuna.
   */
  council?: CouncilWorkspace | null;
  councilLookup?: CouncilLookup;
  onConveneSeat?: (seat: CabinetSeat) => void;
  onOpenCouncilSeat?: (seat: CabinetSeat) => void;
  onLeaveCouncil?: () => void;
  onPromoteToCouncil?: () => void;
}

export function SeatTable({
  seat, blocks, act, onPrepareRoad, preparedRoadId, roadStates, actDraft, actStatus, actBusy, actEditable, actSignatureNotice,
  onEditDraft, onSignDraft, onCancelDraft, onCompare, presentation, canvas = null, onClearPresentation, onTogglePin, onReturnToMessage,
  proposals = [], actBoard = null, actBoardLoading = false, actBoardError = null, onRefreshActBoard,
  workspace = null, decisionQuestion = null, actRevision = null, onPrepareFromProposal, onRegenerateAct,
  council = null, councilLookup, onConveneSeat, onOpenCouncilSeat, onLeaveCouncil, onPromoteToCouncil,
}: SeatTableProps) {
  const ordered = [...blocks].sort((a, b) => KIND_PRIORITY[a.kind] - KIND_PRIORITY[b.kind]);
  const showsAct = seat === 'tesoro';

  // WS-MINISTER-UX-03 / WS-GOVUX-P3 — La presentazione cambia la gerarchia, non
  // il dato: le evidenze richieste salgono in cima (fino a due), il confronto si
  // **aggiunge** senza toglierle. Senza tela, resta il comportamento storico a
  // una sola `presentation` (retro-compatibile con i test e i chiamanti).
  const presentedMains = canvas
    ? canvas.mains.filter((item): item is ResolvedPresentation => Boolean(item.block))
    : (presentation && presentation.kind === 'evidence' ? [presentation] : []);
  const comparison = canvas
    ? canvas.comparison
    : (presentation?.kind === 'compare' ? presentation : null);
  const primary = presentedMains[0] ?? null;
  const secondary = presentedMains[1] ?? null;
  const presentedIds = new Set(
    presentedMains.map(item => item.block?.id).filter((id): id is string => Boolean(id)),
  );
  const presentedBlock = primary?.block ?? null;
  const rest = presentedMains.length > 0
    ? ordered.filter(block => !presentedIds.has(block.id))
    : ordered;
  const main = presentedBlock ?? (comparison ? null : rest[0] ?? null);
  const presentationActive = presentedMains.length > 0 || Boolean(comparison);
  const compareOnly = Boolean(comparison) && presentedMains.length === 0;
  const supportStart = presentedMains.length > 0 ? 0 : 1;
  const supports = compareOnly ? rest.slice(0, 2) : rest.slice(supportStart, supportStart + 2);
  const extras = compareOnly ? rest.slice(2) : rest.slice(supportStart + 2);

  // WS-MINISTER-UX-08 (1) — L'atto è pertinente alla decisione quando la
  // conversazione chiede spesa, cifre, piano o il confronto; altrimenti non
  // scavalca l'evidenza richiesta e finisce dopo di essa.
  const actPertinent = !presentationActive
    || Boolean(comparison)
    || Boolean(primary?.evidence && ACT_EVIDENCE.includes(primary.evidence));
  // Il banner lega la tavola al messaggio: la principale, o il confronto se non
  // ci sono principali.
  const banner = primary ?? comparison;

  const proposalsForSeat = proposals.length > 0
    ? proposals
    : (showsAct ? act.roads : []);

  const proposalPanel = showsAct ? (
    <TreasuryActPanel
      key={seat}
      act={act}
      onPrepare={onPrepareRoad}
      preparedRoadId={preparedRoadId}
      roadStates={roadStates}
    />
  ) : proposalsForSeat.length > 0 ? (
    <SeatProposalPanel
      seatLabel={seat}
      roads={proposalsForSeat}
      onPrepare={onPrepareRoad}
      preparedRoadId={preparedRoadId}
      roadStates={roadStates}
    />
  ) : null;

  const compareAction = onCompare && proposalsForSeat.length > 1 ? (
    <div className="seat-table-actions">
      <button
        type="button"
        className="seat-table-compare"
        onClick={onCompare}
        title="Metti le strade fianco a fianco: non accoda e non spende"
      >
        Confronta le strade
      </button>
    </div>
  ) : null;

  const draftPanel = actDraft && actStatus ? (
    <ActDraftPanel
      draft={actDraft}
      status={actStatus}
      busy={actBusy}
      editable={actEditable}
      signatureNotice={actSignatureNotice}
      board={actBoard}
      boardLoading={actBoardLoading}
      boardError={actBoardError}
      onRefreshBoard={onRefreshActBoard}
      onEdit={onEditDraft}
      onSign={onSignDraft}
      onCancel={onCancelDraft}
    />
  ) : null;

  // WS-GOV-DIALOGUE-TO-ACT — La decisione in corso: la proposta corrente è il
  // centro della tavola; l'atto è il risultato finale, in fondo.
  const decisionActive = Boolean(workspace && (workspace.objective || workspace.proposals.length > 0));
  const decisionBoard = decisionActive && workspace ? (
    <DecisionBoard
      workspace={workspace}
      seat={seat}
      question={decisionQuestion}
      actRevision={actRevision}
      onPrepareAct={onPrepareFromProposal}
      onRegenerateAct={onRegenerateAct}
      onPromoteToCouncil={onPromoteToCouncil}
      onConveneSeat={onConveneSeat}
    />
  ) : null;
  const councilBoard = council && councilLookup ? (
    <CouncilBoard
      council={council}
      lookup={councilLookup}
      onConveneSeat={onConveneSeat}
      onOpenSeat={onOpenCouncilSeat}
      onLeaveCouncil={onLeaveCouncil}
    />
  ) : null;

  const mainArea = main ? (
    <>
      <div className="seat-table-main">
        <SeatCanvas
          blocks={[main]}
          focusRegionIds={primary?.regionIds}
          focusLabel={primary?.focusLabel}
        />
        {secondary?.block && (
          <div className="seat-table-main-second">
            <SeatCanvas blocks={[secondary.block]} />
          </div>
        )}
      </div>
      {supports.length > 0 && (
        <div className="seat-table-support">
          <SeatCanvas blocks={supports} />
        </div>
      )}
      {extras.length > 0 && (
        <details className="seat-table-more">
          <summary className="seat-table-more-summary">
            Approfondimenti ({extras.length})
          </summary>
          <SeatCanvas blocks={extras} />
        </details>
      )}
    </>
  ) : comparison ? (
    supports.length + extras.length > 0 ? (
      <details className="seat-table-more" open>
        <summary className="seat-table-more-summary">Altre evidenze ({supports.length + extras.length})</summary>
        <SeatCanvas blocks={[...supports, ...extras]} />
      </details>
    ) : null
  ) : (
    <SeatCanvas
      blocks={[]}
      emptyLabel="Nessuna evidenza pubblicata per questa sedia: la tavola resta vuota, non inventa."
    />
  );

  return (
    <section className="seat-table" aria-label="Tavola di lavoro della sedia">
      <header className="seat-table-head">
        <span className="seat-table-kicker">La tavola</span>
        <span className="seat-table-note">
          Le evidenze della seduta, dai dati del motore. Ogni cifra dichiara la sua provenienza.
        </span>
      </header>

      {councilBoard}

      {decisionBoard}

      {banner && (
        <div className="seat-presentation-banner" role="status" data-pinned={banner.pinned ? 'true' : undefined}>
          <div className="seat-presentation-text">
            <span className="seat-presentation-label">
              Mostrato su richiesta — {banner.label}{banner.pinned ? ' · fissato' : ''}
            </span>
            {banner.note && <span className="seat-presentation-note">{banner.note}</span>}
            {banner.quote && (
              <span className="seat-presentation-quote">«{banner.quote}»</span>
            )}
          </div>
          {onTogglePin && (
            <button
              type="button"
              className={`seat-presentation-pin${banner.pinned ? ' active' : ''}`}
              onClick={onTogglePin}
              aria-pressed={Boolean(banner.pinned)}
              title={banner.pinned ? 'Sblocca l’evidenza: torna a seguire la conversazione' : 'Fissa l’evidenza: resta sulla tavola mentre la leggi'}
            >
              {banner.pinned ? 'Evidenza fissata' : 'Fissa evidenza'}
            </button>
          )}
          {onClearPresentation && (
            <button
              type="button"
              className="seat-presentation-clear"
              onClick={onClearPresentation}
              title="Torna alla tavola predefinita"
            >
              Tavola predefinita
            </button>
          )}
          {onReturnToMessage && banner.quote && (
            <button
              type="button"
              className="seat-presentation-return"
              onClick={onReturnToMessage}
              title="Torna al messaggio che ha chiesto questa evidenza"
            >
              Vai al messaggio
            </button>
          )}
        </div>
      )}

      {comparison && <ProposalComparison roads={comparison.roads} />}

      {presentationActive ? (
        <>
          {mainArea}
          {actPertinent ? proposalPanel : null}
          {draftPanel}
          {compareAction}
          {!actPertinent ? proposalPanel : null}
        </>
      ) : decisionActive ? (
        <>
          {main ? mainArea : null}
          {proposalPanel}
          {compareAction}
          {draftPanel}
        </>
      ) : (
        <>
          {proposalPanel}
          {compareAction}
          {draftPanel}
          {mainArea}
        </>
      )}
    </section>
  );
}

export default SeatTable;
