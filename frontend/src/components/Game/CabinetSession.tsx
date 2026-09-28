/**
 * P02 — La seduta del gabinetto: chi parla, e cosa propone
 * ======================================================
 * L'autore ha chiesto «le persone che chattano con me e propongono i loro piani
 * e bisogni». Questa è quella pagina, con tre regole che il componente deve
 * rispettare:
 *
 *  - **tipografia, nessuna immagine** (scelta dell'autore): nome, sedia,
 *    competenza dichiarata, testo leggibile. Niente volti inventati;
 *  - **ogni cifra porta la sua provenienza**: `measured` dice da dove viene,
 *    `estimated` con che metodo, `unknown` cosa manca. Una cifra senza origine
 *    non si mostra — è la differenza fra un dato contestabile e un numero da
 *    credere;
 *  - **una sedia senza dati non compare**: il componente non la inventa e non la
 *    riempie. Se non ci sono sedie, lo dice.
 *
 * Il componente **non registra ordini**: una proposta prepara una bozza
 * (`onChoose`), e la registrazione è un atto separato. È l'invariante MG-I1:
 * leggere una seduta non impegna nulla.
 */

import React from 'react';
import type { CabinetAddressView, CabinetFigureView, CabinetPathView, CabinetSessionView } from '../../services/api';

/** L'etichetta breve di una sedia, per il titolo. */
const SEAT_SHORT: Record<CabinetAddressView['seat'], string> = {
  tesoro: 'Tesoro',
  lavori: 'Lavori',
  esteri: 'Esteri',
  interno: 'Interno',
  guerra: 'Guerra',
};

const URGENCY_LABEL: Record<string, string> = {
  ordinaria: 'ordinaria',
  urgente: 'urgente',
  critica: 'bloccante',
};

/** Come si legge la provenienza di una cifra, in italiano. */
export function basisLabel(basis: CabinetFigureView['basis']): string {
  if (basis.kind === 'measured') return `misurato · ${basis.source}`;
  if (basis.kind === 'estimated') return `stimato · ${basis.method}`;
  return `dato mancante · ${basis.missing}`;
}

/** La provenienza è ignota? Serve a mostrare la cifra in modo diverso. */
export function isUnknown(figure: CabinetFigureView): boolean {
  return figure.basis.kind === 'unknown';
}

export interface CabinetSessionProps {
  session: CabinetSessionView | null;
  loading?: boolean;
  error?: string | null;
  /**
   * Scelta una strada: il componente consegna la proposta al chiamante, che ne
   * farà una **bozza**. Nessuna registrazione qui: è il punto dell'invariante.
   */
  onChoose?: (item: CabinetAddressView['items'][number], path: CabinetPathView) => void;
}

export function CabinetSession({ session, loading = false, error = null, onChoose }: CabinetSessionProps) {
  if (loading) {
    return <p className="cabinet-status" role="status">Il consiglio si sta riunendo…</p>;
  }
  if (error) {
    return <p className="cabinet-status cabinet-error" role="alert">{error}</p>;
  }
  if (!session) {
    return <p className="cabinet-status" role="status">Nessuna seduta disponibile.</p>;
  }

  const { addresses, president, summary } = session;

  return (
    <div className="cabinet" aria-label="Seduta del Governo">
      {/* Il Presidente apre: non è una sesta competenza, è l'intestazione. */}
      <header className="cabinet-president">
        <div className="cabinet-president-opening">{president.opening}</div>
        {summary.total === 0 && (
          <div className="cabinet-president-quiet">
            Nessun ministro ha portato qualcosa: una seduta vuota è un buon segno, non un pannello rotto.
          </div>
        )}
      </header>

      {addresses.length === 0 ? (
        <p className="cabinet-empty" role="status">
          Nessun ministro ha dati da portare al consiglio.
        </p>
      ) : (
        <div className="cabinet-seats">
          {addresses.map(address => (
            <section
              key={address.seat}
              className="cabinet-seat"
              data-seat={address.seat}
              aria-labelledby={`cabinet-seat-${address.seat}`}
            >
              <div className="cabinet-seat-head">
                <span className="cabinet-seat-name" id={`cabinet-seat-${address.seat}`}>{address.label}</span>
                <span className="cabinet-seat-competence" title="Che cosa legge questa sedia">
                  {address.reads}
                </span>
              </div>
              <p className="cabinet-seat-opening">{address.opening}</p>

              {address.items.map(item => (
                <article key={item.voiceId} className="cabinet-item">
                  <div className="cabinet-item-need">
                    <span className={`cabinet-urgency cabinet-urgency-${item.urgency}`}>
                      {URGENCY_LABEL[item.urgency] ?? item.urgency}
                    </span>
                    {item.need}
                  </div>
                  <p className="cabinet-item-because">{item.because}</p>

                  {/* Le cifre, ognuna con la sua provenienza. Una cifra ignota
                      non si nasconde: si mostra come tale. */}
                  {item.figures.length > 0 && (
                    <dl className="cabinet-figures">
                      {item.figures.map((figure, index) => (
                        <div
                          key={`${figure.label}-${index}`}
                          className={`cabinet-figure${isUnknown(figure) ? ' cabinet-figure-unknown' : ''}`}
                        >
                          <dt>{figure.label}</dt>
                          <dd>
                            {isUnknown(figure) ? '—' : `${figure.value} ${figure.unit}`.trim()}
                            <span className="cabinet-basis">{basisLabel(figure.basis)}</span>
                          </dd>
                        </div>
                      ))}
                    </dl>
                  )}

                  {/* Le strade: almeno due, con prerequisiti e conseguenze. */}
                  <div className="cabinet-paths" role="group" aria-label="Strade proposte">
                    {item.paths.map(path => (
                      <button
                        key={path.id}
                        type="button"
                        className={`cabinet-path${path.recommended ? ' recommended' : ''}`}
                        onClick={() => onChoose?.(item, path)}
                        title="Prepara una bozza d’ordine: nulla viene registrato finché non la confermi"
                      >
                        <span className="cabinet-path-title">
                          {path.title}
                          {path.recommended && <span className="cabinet-path-badge">consigliata</span>}
                        </span>
                        <span className="cabinet-path-detail">{path.detail}</span>
                        {path.prerequisites.length > 0 && (
                          <span className="cabinet-path-prereq">
                            serve: {path.prerequisites.join(' · ')}
                          </span>
                        )}
                        <span className="cabinet-path-expected">{path.expected}</span>
                      </button>
                    ))}
                  </div>
                </article>
              ))}
            </section>
          ))}
        </div>
      )}

      <footer className="cabinet-closing">{president.closing}</footer>
    </div>
  );
}
