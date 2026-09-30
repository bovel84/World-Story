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
 * Senza presentazione resta la selezione predefinita di UX-01. In entrambi i
 * casi il componente non calcola nulla: `SeatCanvas` rende i blocchi del read
 * model.
 */
import { SeatCanvas } from './SeatCanvas';
import { TreasuryActPanel } from './TreasuryActPanel';
import { ProposalComparison } from './ProposalComparison';
import type { SeatCanvasBlock } from './seatCanvasModel';
import type { ResolvedPresentation } from './presentation';
import type { TreasuryAct, TreasuryRoad } from './treasuryAct';
import type { CabinetAddressView } from '../../services/api';

/** L'ordine di priorità sulla tavola: il piano prima, le idee per ultime. */
const KIND_PRIORITY: Record<SeatCanvasBlock['kind'], number> = {
  strategy: 0,
  map: 1,
  chart: 2,
  metrics: 3,
  ideas: 4,
};

export interface SeatTableProps {
  seat: CabinetAddressView['seat'];
  blocks: SeatCanvasBlock[];
  act: TreasuryAct;
  onSign?: (road: TreasuryRoad) => Promise<boolean>;
  /**
   * WS-MINISTER-UX-03 — La presentazione richiesta dal ministro nella
   * conversazione. `null` = tavola predefinita (l'ordine di UX-01).
   */
  presentation?: ResolvedPresentation | null;
  /** Tornare alla tavola predefinita, chiudendo l'evidenza presentata. */
  onClearPresentation?: () => void;
  /** Tornare al messaggio che ha chiesto l'evidenza (su mobile, al dialogo). */
  onReturnToMessage?: () => void;
}

export function SeatTable({ seat, blocks, act, onSign, presentation, onClearPresentation, onReturnToMessage }: SeatTableProps) {
  const ordered = [...blocks].sort((a, b) => KIND_PRIORITY[a.kind] - KIND_PRIORITY[b.kind]);
  const showsAct = seat === 'tesoro';

  // WS-MINISTER-UX-03 — La presentazione cambia la gerarchia, non il dato:
  // l'evidenza richiesta sale in cima; il confronto sostituisce la principale.
  const presentedBlock = presentation?.kind === 'evidence' ? presentation.block : null;
  const rest = presentedBlock
    ? ordered.filter(block => block.id !== presentedBlock.id)
    : ordered;
  const main = presentedBlock ?? (presentation?.kind === 'compare' ? null : rest[0] ?? null);
  const supportStart = presentedBlock ? 0 : 1;
  const supports = presentation?.kind === 'compare'
    ? rest.slice(0, 2)
    : rest.slice(supportStart, supportStart + 2);
  const extras = presentation?.kind === 'compare'
    ? rest.slice(2)
    : rest.slice(supportStart + 2);

  return (
    <section className="seat-table" aria-label="Tavola di lavoro della sedia">
      <header className="seat-table-head">
        <span className="seat-table-kicker">La tavola</span>
        <span className="seat-table-note">
          Le evidenze della seduta, dai dati del motore. Ogni cifra dichiara la sua provenienza.
        </span>
      </header>

      {presentation && (
        <div className="seat-presentation-banner" role="status">
          <div className="seat-presentation-text">
            <span className="seat-presentation-label">Mostrato su richiesta — {presentation.label}</span>
            {presentation.note && <span className="seat-presentation-note">{presentation.note}</span>}
            {presentation.quote && (
              <span className="seat-presentation-quote">«{presentation.quote}»</span>
            )}
          </div>
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
          {onReturnToMessage && (
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

      {presentation?.kind === 'compare' && <ProposalComparison roads={presentation.roads} />}

      {showsAct && <TreasuryActPanel key={seat} act={act} onSign={onSign} />}

      {main ? (
        <>
          <div className="seat-table-main">
            <SeatCanvas
              blocks={[main]}
              focusRegionIds={presentation?.kind === 'evidence' ? presentation.regionIds : undefined}
            />
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
      ) : presentation?.kind === 'compare' ? (
        supports.length + extras.length > 0 && (
          <details className="seat-table-more" open>
            <summary className="seat-table-more-summary">Altre evidenze ({supports.length + extras.length})</summary>
            <SeatCanvas blocks={[...supports, ...extras]} />
          </details>
        )
      ) : (
        <SeatCanvas
          blocks={[]}
          emptyLabel="Nessuna evidenza pubblicata per questa sedia: la tavola resta vuota, non inventa."
        />
      )}
    </section>
  );
}

export default SeatTable;
