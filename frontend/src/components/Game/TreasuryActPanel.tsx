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
            <dd>
              {figure.display}
              <span className="treasury-act-basis">{figure.basis}</span>
            </dd>
          </div>
        ))}
      </dl>

      {act.worksRequest && (
        <div className="treasury-act-request" data-state={worksAccepted ? 'accepted' : 'pending'}>
          <span className="treasury-act-request-label">Richiesta in attesa · {worksState}</span>
          <p className="treasury-act-request-need">{act.worksRequest.need}</p>
          {act.worksRequest.figures.length > 0 && (
            <ul className="treasury-act-request-figures">
              {act.worksRequest.figures.map(figure => (
                <li key={figure.label}>{figure.label}: {figure.display} <span className="treasury-act-basis">{figure.basis}</span></li>
              ))}
            </ul>
          )}
        </div>
      )}

      <div className="treasury-act-roads">
        {act.roads.map(road => {
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
        {act.roads.length === 0 && (
          <p className="treasury-act-quiet" role="status">
            Il motore non pubblica né una scadenza né un’opera in attesa: nessuna strada da firmare.
          </p>
        )}
      </div>
    </section>
  );
}

export default TreasuryActPanel;
