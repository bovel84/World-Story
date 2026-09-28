/**
 * P02-bis — La chat di un ministro: interrogarlo, e finire con un ordine
 * ====================================================================
 * L'autore ha chiesto il concetto centrale: **il parlare**. «Io fare una parte
 * intermedia dove vedo tutti i ministri e magari la posso interrogarli o
 * parlarci… i ministri portano problemi, una chat come il consulente con idee e
 * soluzioni, con della grafica dentro e numeri reali. Poi alla fine la chat
 * termina con un ordine.»
 *
 * Questo componente fa esattamente quello, con tre proprietà che lo tengono
 * onesto:
 *
 *  - **il contesto è la sedia**, e lo prepara il server (`briefingFor`): i
 *    ministri non sono personalità inventate, sono proiezioni dello stato;
 *  - **la grafica mostra le cifre del motore**, non numeri del modello: le
 *    figure vengono dalla voce del gabinetto, con la loro provenienza, e una
 *    cifra ignota si vede che è ignota. Il modello può parlare; le cifre sono
 *    quelle che il motore ha già dato;
 *  - **la chat FINISCE con un ordine**: sotto la conversazione ci sono le
 *    strade della voce, e sceglierne una prepara la bozza — la registrazione
 *    resta un atto separato del giocatore (invariante MG-I1).
 */

import React, { useEffect, useRef, useState } from 'react';
import { ministerApi, type AdvisorHistoryItem } from '../../services/api';
import type { CabinetAddressView, CabinetItemView, CabinetPathView } from '../../services/api';
import { basisLabel, isUnknown } from './CabinetSession';

/** Quanti ultimi messaggi inviamo come contesto. */
const HISTORY_LIMIT = 20;

export interface MinisterChatProps {
  gameId: string;
  /** La sedia con cui si parla: è il contesto che il server prepara. */
  address: CabinetAddressView | null;
  /**
   * Scegliere una strada prepara una **bozza**: il componente non registra e non
   * accoda nulla. La conferma è del giocatore.
   */
  onChoose?: (item: CabinetItemView, path: CabinetPathView) => void;
}

/** La barra di una cifra: la grafica dentro la chat, dai numeri del motore. */
function FigureBar({ figure }: { figure: CabinetItemView['figures'][number] }) {
  // La barra confronta il disponibile col fabbisogno quando entrambi esistono:
  // è il modo di rendere visibile il divario senza inventare una percentuale.
  const numeric = Number(figure.value);
  const hasNumber = Number.isFinite(numeric) && numeric > 0;
  const width = hasNumber ? Math.min(100, Math.max(3, numeric)) : 0;
  return (
    <div className={`minister-figure${isUnknown(figure) ? ' unknown' : ''}`}>
      <div className="minister-figure-label">{figure.label}</div>
      <div className="minister-figure-track" aria-hidden={!hasNumber}>
        {hasNumber && <div className="minister-figure-fill" style={{ width: `${width}%` }} />}
      </div>
      <div className="minister-figure-value">
        {isUnknown(figure) ? '—' : `${figure.value} ${figure.unit}`.trim()}
      </div>
      <div className="minister-figure-basis">{basisLabel(figure.basis)}</div>
    </div>
  );
}

export function MinisterChat({ gameId, address, onChoose }: MinisterChatProps) {
  const [messages, setMessages] = useState<AdvisorHistoryItem[]>([]);
  const [input, setInput] = useState('');
  const [sending, setSending] = useState(false);
  const [error, setError] = useState('');
  const endRef = useRef<HTMLDivElement>(null);

  // Cambiando ministro il dialogo riparte: la sedia è il contesto, e mescolare
  // due sedie nella stessa cronaca darebbe risposte fuori competenza.
  useEffect(() => {
    setMessages([]);
    setInput('');
    setError('');
  }, [address?.seat]);

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  if (!address) {
    return (
      <p className="minister-status" role="status">
        Nessun ministro da interrogare: la seduta non ha portato nulla su questa sedia.
      </p>
    );
  }

  const send = async (): Promise<void> => {
    const text = input.trim();
    if (!text || sending) return;
    setSending(true);
    setError('');
    setInput('');
    const history = messages.filter(message => message.content.trim()).slice(-HISTORY_LIMIT);
    setMessages(previous => [...previous, { role: 'user', content: text }]);
    try {
      const answer = await ministerApi.ask(gameId, address.seat, text, history);
      setMessages(previous => [...previous, { role: 'assistant', content: answer.reply }]);
    } catch (e) {
      console.error('[Government] Minister reply failed:', e);
      setError('Il ministro non risponde ora.');
    } finally {
      setSending(false);
    }
  };

  // Le cifre della sedia: le stesse che il briefing dà al modello, mostrate qui
  // perché il giocatore veda su cosa si sta parlando.
  const items = address.items;

  return (
    <div className="minister-chat" aria-label={`Dialogo con ${address.label}`}>
      <header className="minister-head">
        <div className="minister-name">{address.label}</div>
        <div className="minister-competence">{address.reads}</div>
      </header>

      {/* Le cifre della sedia: numeri del motore, con la loro provenienza. */}
      {items.length > 0 && (
        <section className="minister-figures" aria-label="Numeri su cui si parla">
          {items.flatMap(item => item.figures.map((figure, index) => (
            <FigureBar key={`${item.voiceId}-${figure.label}-${index}`} figure={figure} />
          )))}
        </section>
      )}

      <div className="minister-thread" aria-live="polite">
        {messages.length === 0 && !sending && (
          <p className="minister-hint">
            {address.opening} Chiedi quello che vuoi: i numeri che vedi sono quelli del motore.
          </p>
        )}
        {messages.map((message, index) => (
          <div key={index} className={`minister-message ${message.role}`}>
            {message.content}
          </div>
        ))}
        {sending && <div className="minister-message assistant minister-typing">…</div>}
        {error && <p className="minister-error" role="alert">{error}</p>}
        <div ref={endRef} />
      </div>

      <div className="minister-compose">
        <input
          type="text"
          value={input}
          onChange={event => setInput(event.target.value)}
          onKeyDown={event => { if (event.key === 'Enter') void send(); }}
          placeholder={`Scrivi al ${address.label}…`}
          aria-label={`Messaggio per ${address.label}`}
          disabled={sending}
        />
        <button type="button" onClick={() => void send()} disabled={sending || !input.trim()}>
          {sending ? '…' : 'Chiedi'}
        </button>
      </div>

      {/* La chat TERMINA con un ordine: le strade della voce, sotto il dialogo.
          Sceglierne una prepara la bozza — non registra (MG-I1). */}
      {items.length > 0 && (
        <footer className="minister-outcome">
          <div className="minister-outcome-title">Concludere con un ordine</div>
          {items.map(item => (
            <div key={item.voiceId} className="minister-outcome-item">
              <div className="minister-outcome-need">{item.need}</div>
              <div className="minister-paths" role="group" aria-label="Strade proposte">
                {item.paths.map(path => (
                  <button
                    key={path.id}
                    type="button"
                    className={`minister-path${path.recommended ? ' recommended' : ''}`}
                    onClick={() => onChoose?.(item, path)}
                    title="Prepara una bozza d’ordine: nulla viene registrato finché non la confermi"
                  >
                    <span className="minister-path-title">
                      {path.title}
                      {path.recommended && <span className="minister-path-badge">consigliata</span>}
                    </span>
                    <span className="minister-path-expected">{path.expected}</span>
                  </button>
                ))}
              </div>
            </div>
          ))}
        </footer>
      )}
    </div>
  );
}
