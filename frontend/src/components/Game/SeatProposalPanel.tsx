/**
 * WS-MINISTER-UX-08 (5) — Le proposte concrete sul tavolo
 * =======================================================
 * L'azione di ordine si sposta **dalla singola domanda alla proposta concreta**:
 * il Presidente non converte più la propria frase in un ordine con un clic sotto
 * il messaggio; prepara e firma una **proposta** della sedia (una strada del
 * Tesoro, un percorso di un'altra sedia). Preparare non accoda e non spende:
 * lo stato reale arriva da coda e cronologia (`actDraft.deriveActState`), come
 * per l'atto del Tesoro.
 *
 * `ProposalRoadList` è la resa condivisa delle strade (titolo, voce, costo,
 * guadagno, «Prepara l'atto»): la usa sia l'atto del Tesoro sia questa scheda,
 * così una proposta ha una sola forma in tutta la seduta.
 */
import type { ActState } from './actDraft';
import type { TreasuryRoad } from './treasuryAct';

export interface ProposalRoadListProps {
  roads: readonly TreasuryRoad[];
  /** «Prepara l'atto»: la strada diventa una bozza sul tavolo (non accoda). */
  onPrepare?: (road: TreasuryRoad) => void;
  /** La strada attualmente in bozza, se c'è. */
  preparedRoadId?: string | null;
  /** Lo stato reale di ogni strada, derivato da coda e cronologia. */
  roadStates?: Record<string, ActState>;
  /** Il messaggio quando la sedia non pubblica nessuna strada. */
  emptyLabel?: string;
}

export function ProposalRoadList({
  roads, onPrepare, preparedRoadId = null, roadStates = {},
  emptyLabel = 'Il motore non pubblica nessuna strada per questa sedia: nessuna proposta da firmare.',
}: ProposalRoadListProps) {
  return (
    <div className="treasury-act-roads">
      {roads.map(road => {
        const state = roadStates[road.id];
        const prepared = preparedRoadId === road.id;
        return (
          <article key={road.id} className={`treasury-act-road${road.recommended ? ' recommended' : ''}`} data-road={road.id} data-state={state ?? 'proposed'}>
            <div className="treasury-act-road-head">
              <span className="treasury-act-road-title">{road.title}</span>
              {road.recommended && <span className="treasury-act-road-badge">consigliata</span>}
            </div>
            <p className="treasury-act-road-voice">{road.voice}</p>
            <p className="treasury-act-road-terms">
              <span><b>Costo immediato:</b> {road.declaredCost}</span>
              <span><b>Guadagno atteso:</b> {road.expectedGain}</span>
            </p>
            <button
              type="button"
              className="treasury-act-prepare"
              onClick={() => onPrepare?.(road)}
              aria-label={`Prepara l'atto: ${road.title}`}
            >
              {prepared ? 'Bozza sul tavolo' : 'Prepara l’atto'}
            </button>
          </article>
        );
      })}
      {roads.length === 0 && (
        <p className="treasury-act-quiet" role="status">{emptyLabel}</p>
      )}
    </div>
  );
}

export interface SeatProposalPanelProps extends ProposalRoadListProps {
  /** Il nome della sedia, per l'intestazione. */
  seatLabel: string;
}

/** Le proposte concrete di una sedia non-Tesoro: i percorsi delle sue voci. */
export function SeatProposalPanel({ seatLabel, ...listProps }: SeatProposalPanelProps) {
  return (
    <section className="seat-proposal" aria-label={`Le proposte della seduta — ${seatLabel}`}>
      <header className="treasury-act-head">
        <span className="treasury-act-kicker">Sul tavolo</span>
        <h3 className="treasury-act-title">Le proposte della seduta</h3>
      </header>
      <ProposalRoadList {...listProps} />
    </section>
  );
}

export default SeatProposalPanel;
