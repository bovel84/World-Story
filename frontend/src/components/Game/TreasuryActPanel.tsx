/**
 * World Story — WS-GOVOFFICE-07 / WS-MINISTER-UX-06: la scena del Tesoro
 * =====================================================================
 * La Parte B del task: il Ministro del Tesoro **porta qualcosa**. Il pannello
 * mostra, accanto al dialogo:
 *  - l'**atto concreto** con le cifre del motore (cassa, saldo, debito/PIL,
 *    interessi/entrate, scadenza titoli, richiesta dei Lavori);
 *  - la **richiesta di un altro ministro** in attesa, il cui stato è **derivato**
 *    dalla coda e dalla cronologia (mai da un flag locale «accolta»);
 *  - le **due strade raccontate** — ammortamento / investimento — ognuna con la
 *    voce del ministro, il costo dichiarato e il guadagno atteso; il pulsante
 *    **prepara** la bozza d'atto (UX-06), che il Presidente legge, corregge e
 *    firma dal pannello della bozza. Preparare non accoda e non spende.
 *
 * Non calcola numeri: riceve l'atto già derivato (`treasuryAct`) e gli stati
 * reali delle strade (`actDraft.deriveActState`), e si limita a preparare.
 */
import { toneClass } from './seatCanvasModel';
import { ProposalRoadList } from './SeatProposalPanel';
import type { ActState } from './actDraft';
import type { TreasuryAct, TreasuryRoad } from './treasuryAct';

export interface TreasuryActPanelProps {
  act: TreasuryAct;
  /** «Prepara l'atto»: la strada diventa una bozza sul tavolo (non accoda). */
  onPrepare?: (road: TreasuryRoad) => void;
  /** La strada attualmente in bozza, se c'è. */
  preparedRoadId?: string | null;
  /** Lo stato reale di ogni strada, derivato da coda e cronologia. */
  roadStates?: Record<string, ActState>;
}

export function TreasuryActPanel({ act, onPrepare, preparedRoadId = null, roadStates = {} }: TreasuryActPanelProps) {
  // L'accoglimento della richiesta dei Lavori è un fatto della coda/cronologia,
  // non un flag della UI: se l'atto d'investimento è accodato o eseguito, la
  // richiesta è accolta.
  const investState = roadStates.invest;
  const worksAccepted = investState === 'queued' || investState === 'executed';
  const worksState = worksAccepted ? 'accolta' : 'in attesa';

  return (
    <section className="treasury-act" aria-label="L'atto del Ministro del Tesoro">
      <header className="treasury-act-head">
        <span className="treasury-act-kicker">Sul tavolo</span>
        <h3 className="treasury-act-title">L’atto del {act.seatLabel}</h3>
      </header>

      <p className="treasury-act-voice">{act.voice}</p>

      <dl className="treasury-act-figures">
        {act.figures.map(figure => (
          <div key={figure.label} className={`treasury-act-figure ${toneClass(figure.tone)}`}>
            <dt>{figure.label}</dt>
            <dd>{figure.display}</dd>
          </div>
        ))}
      </dl>

      {(act.figures.length > 0 || act.worksRequest) && (
        <details className="seat-sources">
          <summary className="seat-sources-summary">Provenienza delle cifre</summary>
          <div className="seat-sources-body">
            {act.figures.map(figure => (
              <p key={figure.label} className="seat-sources-line">{figure.label}: {figure.basis}</p>
            ))}
            {act.worksRequest?.figures.map(figure => (
              <p key={`richiesta-${figure.label}`} className="seat-sources-line">{figure.label}: {figure.basis}</p>
            ))}
          </div>
        </details>
      )}

      {act.worksRequest && (
        <div className="treasury-act-request" data-state={worksAccepted ? 'accepted' : 'pending'}>
          <span className="treasury-act-request-label">Richiesta in attesa · {worksState}</span>
          <p className="treasury-act-request-need">{act.worksRequest.need}</p>
          {act.worksRequest.figures.length > 0 && (
            <ul className="treasury-act-request-figures">
              {act.worksRequest.figures.map(figure => (
                <li key={figure.label}>{figure.label}: {figure.display}</li>
              ))}
            </ul>
          )}
        </div>
      )}

      <ProposalRoadList
        roads={act.roads}
        onPrepare={onPrepare}
        preparedRoadId={preparedRoadId}
        roadStates={roadStates}
        emptyLabel="Il motore non pubblica né una scadenza né un’opera in attesa: nessuna strada da firmare."
      />
    </section>
  );
}

export default TreasuryActPanel;
