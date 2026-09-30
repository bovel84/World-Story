/**
 * WS-MINISTER-UX-01 — Il fascicolo della sedia (questioni e cifre)
 * ===============================================================
 * Nella vecchia seduta il dossier numerico di `CabinetSession` stava **sopra**
 * la chat: per scrivere al ministro bisognava scorrere apertura, questioni e
 * cifre. La roadmap UX-01 chiede che il dialogo sia la superficie principale e
 * che quel materiale diventi un **riepilogo espandibile** o un blocco del
 * catalogo delle evidenze.
 *
 * Questo componente è quel riepilogo: un `<details>` chiuso di default, con la
 * voce della sedia e le sue questioni (bisogno, motivo, cifre con provenienza).
 * Non duplica la chat e non compare nella cronologia: è il fascicolo che il
 * ministro ha sul tavolo, apribile quando serve.
 *
 * Non inventa nulla: riusa gli stessi dati di `CabinetSession` (`items[].need`,
 * `because`, `figures`) e la stessa resa della provenienza (`basisLabel`
 * / `isUnknown`), così un numero ha una sola forma in tutta la seduta.
 */
import type { CabinetAddressView } from '../../services/api';
import { basisLabel, isUnknown } from './CabinetSession';
import { EngineText } from './EngineText';
import { formatFigureValue } from '../../utils/format';
import { KIND_LABEL, STATE_LABEL, type MinisterMemoryRecord } from './ministerMemory';

const URGENCY_LABEL: Record<string, string> = {
  ordinaria: 'ordinaria',
  urgente: 'urgente',
  critica: 'bloccante',
};

export interface SeatBriefProps {
  address: CabinetAddressView | null;
  /**
   * WS-MINISTER-UX-05 — La memoria della sedia (tappa intermedia, nel browser).
   * È il registro di ciò che è stato discusso, accodato o lasciato aperto:
   * distingue la proposta dall'atto, che è la differenza che conta.
   */
  memory?: readonly MinisterMemoryRecord[];
}

export function SeatBrief({ address, memory = [] }: SeatBriefProps) {
  if (!address || address.items.length === 0) return null;
  const count = address.items.length;

  return (
    <details className="seat-brief">
      <summary className="seat-brief-summary">
        <span className="seat-brief-label">
          Fascicolo della sedia — {count} {count === 1 ? 'questione' : 'questioni'}
        </span>
        <span className="seat-brief-chevron" aria-hidden="true">▾</span>
      </summary>
      <div className="seat-brief-body">
        <p className="seat-brief-opening"><EngineText text={address.opening} /></p>
        {address.items.map(item => (
          <article key={item.voiceId} className="seat-brief-item">
            <div className="seat-brief-need">
              <span className={`cabinet-urgency cabinet-urgency-${item.urgency}`}>
                {URGENCY_LABEL[item.urgency] ?? item.urgency}
              </span>
              <EngineText text={item.need} />
            </div>
            <p className="seat-brief-because"><EngineText text={item.because} /></p>
            {item.figures.length > 0 && (
              <dl className="cabinet-figures">
                {item.figures.map((figure, index) => (
                  <div
                    key={`${figure.label}-${index}`}
                    className={`cabinet-figure${isUnknown(figure) ? ' cabinet-figure-unknown' : ''}`}
                  >
                    <dt>{figure.label}</dt>
                    <dd>
                      {isUnknown(figure) ? '—' : formatFigureValue(figure.value, figure.unit)}
                      <span className="cabinet-basis">{basisLabel(figure.basis)}</span>
                    </dd>
                  </div>
                ))}
              </dl>
            )}
          </article>
        ))}
        {memory.length > 0 && (
          <section className="seat-brief-memory" aria-label="Memoria della sedia">
            <h3 className="seat-brief-memory-title">Cosa ricorda il ministro</h3>
            <ul className="seat-brief-memory-list">
              {memory.map(record => (
                <li key={record.id} className={`seat-brief-memory-item kind-${record.kind}`}>
                  <span className="seat-brief-memory-state">{KIND_LABEL[record.kind]} · {STATE_LABEL[record.state]}</span>
                  <span className="seat-brief-memory-summary">{record.summary}</span>
                  {record.reason && <span className="seat-brief-memory-reason">motivo: {record.reason}</span>}
                  <span className="seat-brief-memory-ref">
                    {record.refs.orderId ? `ordine ${record.refs.orderId} · ` : ''}
                    {record.refs.messageId ? `messaggio ${record.refs.messageId} · ` : ''}
                    {record.refs.gameDate || 'senza data'}
                  </span>
                </li>
              ))}
            </ul>
            <p className="seat-brief-memory-note">
              Questi ricordi accompagnano la richiesta al ministro e sono persistiti dal server
              per partita, ramo e mandato. Il browser qui ne mostra la copia più recente.
            </p>
          </section>
        )}
      </div>
    </details>
  );
}

export default SeatBrief;
