/**
 * World Story — WS-GOVOFFICE-07: la scena del Tesoro (atto + strade firmabili)
 * ==========================================================================
 * La Parte B del task: il Ministro del Tesoro **porta qualcosa**. Il pannello
 * mostra, accanto al dialogo:
 *  - l'**atto concreto** con le cifre del motore (cassa, saldo, debito/PIL,
 *    interessi/entrate, scadenza titoli, richiesta dei Lavori);
 *  - la **richiesta di un altro ministro** in attesa, che cambia stato quando
 *    l'atto la accoglie (Parte D: la reazione dei ministri);
 *  - le **due strade raccontate** — ammortamento / investimento — ognuna con la
 *    voce del ministro (le cifre dentro la frase), il costo dichiarato e il
 *    guadagno atteso; il pulsante firma l'ordine, che entra nel registro.
 *
 * Non calcola numeri: riceve l'atto già derivato (`treasuryAct`) e si limita a
 * firmarlo tramite il chiamante, che parla con la coda del motore.
 */
import { useState } from 'react';
import { toneClass } from './seatCanvasModel';
import type { TreasuryAct, TreasuryRoad } from './treasuryAct';

export interface TreasuryActPanelProps {
  act: TreasuryAct;
  /** Firma una strada: il chiamante accoda l'ordine (opera o testo). */
  onSign?: (road: TreasuryRoad) => Promise<boolean>;
}

export function TreasuryActPanel({ act, onSign }: TreasuryActPanelProps) {
  const [signedRoadId, setSignedRoadId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const sign = async (road: TreasuryRoad): Promise<void> => {
    if (!onSign || busy) return;
    setBusy(true);
    try {
      const queued = await onSign(road);
      if (queued) setSignedRoadId(road.id);
    } finally {
      setBusy(false);
    }
  };

  const worksState = signedRoadId === 'invest' ? 'accolta' : 'in attesa';

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
        <div className="treasury-act-request" data-state={signedRoadId === 'invest' ? 'accepted' : 'pending'}>
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
        {act.roads.map(road => (
          <article key={road.id} className={`treasury-act-road${road.recommended ? ' recommended' : ''}`} data-road={road.id}>
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
              className="treasury-act-sign"
              onClick={() => void sign(road)}
              disabled={busy}
              aria-label={`Firma l'atto: ${road.title}`}
            >
              {signedRoadId === road.id ? 'Atto firmato nel registro' : 'Firma l’atto'}
            </button>
          </article>
        ))}
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
