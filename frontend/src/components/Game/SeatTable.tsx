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
 * La selezione è ancora del frontend (dichiarato: la tavola guidata dalla
 * conversazione è UX-03). Nessuna soglia inventata: si riusa `SeatCanvas`, che
 * non calcola nulla.
 */
import { SeatCanvas } from './SeatCanvas';
import { TreasuryActPanel } from './TreasuryActPanel';
import type { SeatCanvasBlock } from './seatCanvasModel';
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
}

export function SeatTable({ seat, blocks, act, onSign }: SeatTableProps) {
  const ordered = [...blocks].sort((a, b) => KIND_PRIORITY[a.kind] - KIND_PRIORITY[b.kind]);
  const [main, ...rest] = ordered;
  const supports = rest.slice(0, 2);
  const extras = rest.slice(2);
  const showsAct = seat === 'tesoro';

  return (
    <section className="seat-table" aria-label="Tavola di lavoro della sedia">
      <header className="seat-table-head">
        <span className="seat-table-kicker">La tavola</span>
        <span className="seat-table-note">
          Le evidenze della seduta, dai dati del motore. Ogni cifra dichiara la sua provenienza.
        </span>
      </header>

      {showsAct && <TreasuryActPanel key={seat} act={act} onSign={onSign} />}

      {main ? (
        <>
          <div className="seat-table-main">
            <SeatCanvas blocks={[main]} />
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
