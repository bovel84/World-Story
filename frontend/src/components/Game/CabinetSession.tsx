/**
 * P02 / WS-GOVOFFICE-02 — La seduta del gabinetto: chi parla, e cosa propone
 * ========================================================================
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
 * WS-GOVOFFICE-02 — il flusso è a **due schermate**. Il componente sa rendere
 * la prima (`variant: 'pick'`): solo i riquadri dei ministri, nome e competenza,
 * senza item, cifre, strade, chat o coda. Il clic su un riquadro chiede al
 * chiamante di aprire la seduta (`onOpenSeat`). La seconda schermata usa
 * `variant: 'full'` con `onlySeat`: un solo ministro, che parla in prima persona
 * («Signor Presidente, …» → `salutation`) ed elenca i suoi dubbi e problemi dai
 * dati del motore. Le strade restano fuori da qui: l'esito vive nella chat.
 *
 * Il componente **non registra ordini**: consegna la scelta al chiamante
 * (`onChoose`), che nell'Ufficio del Governo la mette in coda automaticamente.
 * È l'invariante MG-I1 aggiornata: leggere una seduta non impegna, ma
 * concludere una strada sì.
 */

import React from 'react';
import type { CabinetAddressView, CabinetFigureView, CabinetPathView, CabinetSessionView } from '../../services/api';

/** L'etichetta breve di una sedia, per il titolo. */
export const SEAT_SHORT: Record<CabinetAddressView['seat'], string> = {
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
   * WS-GOVOFFICE-02 — `pick` è la schermata di scelta (solo i riquadri); `full`
   * è la seduta dettagliata. Default `full` per retro-compatibilità.
   */
  variant?: 'pick' | 'full';
  /**
   * WS-GOVOFFICE-02 — Il clic su un riquadro nella schermata di scelta: aprire
   * la seduta di QUELLA sedia. Distinto da `onSpeak` (il parlare dentro la seduta).
   */
  onOpenSeat?: (address: CabinetAddressView) => void;
  /**
   * WS-GOVOFFICE-02 — In `full`, rendere **una sola** sedia: la seduta con il
   * ministro aperto. Senza, si rende l'intero consiglio (uso storico).
   */
  onlySeat?: CabinetAddressView['seat'] | null;
  /**
   * P02-bis — Aprire il dialogo con un ministro dentro la seduta. La sedia
   * diventa un pulsante, e la chat si apre col contesto di QUELLA sedia.
   */
  onSpeak?: (address: CabinetAddressView) => void;
  /** La sedia con cui si sta parlando adesso, se ce n'è una. */
  speakingSeat?: CabinetAddressView['seat'] | null;
  /**
   * Scelta una strada: il componente consegna la proposta al chiamante, che la
   * mette in coda. Nessuna registrazione qui: è il punto dell'invariante.
   */
  onChoose?: (item: CabinetAddressView['items'][number], path: CabinetPathView) => void;
  /**
   * P02-bis — Il dialogo con il ministro, montato sotto la sua sedia. Passato
   * come `children` perché è il chiamante a sapere quale sedia sta parlando.
   */
  children?: React.ReactNode;
}

export function CabinetSession({
  session, loading = false, error = null,
  variant = 'full', onOpenSeat, onlySeat = null,
  onChoose, onSpeak, speakingSeat = null, children,
}: CabinetSessionProps) {
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

  // ── Schermata di scelta: solo i riquadri dei ministri ────────────────────
  if (variant === 'pick') {
    return (
      <div className="cabinet cabinet-pick-scene" aria-label="I ministri del consiglio">
        {addresses.length === 0 ? (
          <p className="cabinet-empty" role="status">
            Nessun ministro ha dati da portare al consiglio.
          </p>
        ) : (
          <div className="cabinet-picks">
            {addresses.map(address => (
              <button
                key={address.seat}
                type="button"
                className="cabinet-pick"
                data-seat={address.seat}
                onClick={() => onOpenSeat?.(address)}
                title={`Apri la seduta con il ${address.label}`}
              >
                <span className="cabinet-pick-name">{address.label}</span>
                <span className="cabinet-pick-reads">{address.reads}</span>
              </button>
            ))}
          </div>
        )}
      </div>
    );
  }

  // ── Seduta: il consiglio intero, o il singolo ministro aperto ────────────
  const shown = onlySeat ? addresses.filter(address => address.seat === onlySeat) : addresses;
  const single = onlySeat !== null;

  return (
    <div className="cabinet" aria-label={single ? 'Seduta con un ministro' : 'Seduta del Governo'}>
      {/* Il Presidente apre: non è una sesta competenza, è l'intestazione. */}
      {!single && (
        <header className="cabinet-president">
          <div className="cabinet-president-opening">{president.opening}</div>
          {summary.total === 0 && (
            <div className="cabinet-president-quiet">
              Nessun ministro ha portato qualcosa: una seduta vuota è un buon segno, non un pannello rotto.
            </div>
          )}
        </header>
      )}

      {shown.length === 0 ? (
        <p className="cabinet-empty" role="status">
          Nessun ministro ha dati da portare al consiglio.
        </p>
      ) : (
        <div className="cabinet-seats">
          {shown.map(address => (
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
                {onSpeak && (
                  <button
                    type="button"
                    className={`cabinet-speak${speakingSeat === address.seat ? ' active' : ''}`}
                    onClick={() => onSpeak(address)}
                    aria-pressed={speakingSeat === address.seat}
                    title={`Parla con il ${address.label}`}
                  >
                    {speakingSeat === address.seat ? 'Stai parlando' : 'Parla'}
                  </button>
                )}
              </div>

              {/* WS-GOVOFFICE-02 — il ministro parla in prima persona. La
                  salutazione è una cornice della UI; il testo che segue è il suo
                  `opening`, parola del motore. */}
              {single && <p className="cabinet-seat-salutation">Signor Presidente,</p>}
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

                  {/* Le strade: almeno due, con prerequisiti e conseguenze. Nella
                      seduta a due schermate l'esito sta in fondo alla chat, non
                      qui: si mostrano solo nel consiglio intero. */}
                  {!single && (
                    <div className="cabinet-paths" role="group" aria-label="Strade proposte">
                      {item.paths.map(path => (
                        <button
                          key={path.id}
                          type="button"
                          className={`cabinet-path${path.recommended ? ' recommended' : ''}`}
                          onClick={() => onChoose?.(item, path)}
                          title="Concludi con un ordine: entra subito nella coda"
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
                  )}
                </article>
              ))}

              {speakingSeat === address.seat && children}
            </section>
          ))}
        </div>
      )}

      {!single && <footer className="cabinet-closing">{president.closing}</footer>}
    </div>
  );
}
