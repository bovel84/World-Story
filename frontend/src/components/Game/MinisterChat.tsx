/**
 * P02-bis — La chat di un ministro, come quella del Consulente
 * ===========================================================
 * L'autore: «la chat deve essere migliorata, io la vorrei come quella del
 * consulente; adesso è tutto mischiato». Aveva due difetti, entrambi reali:
 *
 *  1. **Non c'era streaming.** Il Consulente scrive mentre pensa; il ministro
 *     compariva di colpo dopo l'attesa. La rotta di streaming esisteva già per il
 *     Consulente e non era stata replicata;
 *  2. **La cronaca era mescolata.** Il dialogo viveva in uno stato locale del
 *     componente, quindi cambiare ministro lo cancellava e — peggio — il dialogo
 *     con una sedia non si distingueva da quello di un'altra.
 *
 * Ora la cronaca sta nello store **per sedia** (`ministerChats`), come il
 * Consulente tiene la sua: cambiare ministro non perde nulla, e ogni sedia ha il
 * suo filo.
 *
 * Tre cose restano come prima, perché sono la ragione d'essere della pagina:
 *  - **il contesto lo prepara il server** (`briefingFor`): il modello parla della
 *    sua sedia, con le cifre del motore;
 *  - **la grafica mostra le cifre del motore**, non numeri del modello;
 *  - **la chat FINISCE con un ordine**: sceglierne uno lo consegna al chiamante,
 *    che nell'Ufficio del Governo lo mette in coda automaticamente (WS-GOVOFFICE-02).
 */

import React, { useEffect, useRef, useState } from 'react';
import { ministerApi, type AdvisorHistoryItem, type MinisterMemoryItem } from '../../services/api';
import type { CabinetAddressView, CabinetItemView, CabinetPathView } from '../../services/api';
import { basisLabel, isUnknown } from './CabinetSession';
import { EngineText } from './EngineText';
import { RichText } from './RichText';
import { parsePresentation, type PresentationDirective } from './presentation';
import { isNearBottom } from './chatScroll';
import { formatFigureValue } from '../../utils/format';

/** Quanti ultimi messaggi inviamo come contesto. */
const HISTORY_LIMIT = 20;

export interface MinisterChatProps {
  gameId: string;
  /** La sedia con cui si parla: è il contesto che il server prepara. */
  address: CabinetAddressView | null;
  /**
   * Concludere con una strada: il componente non registra nulla da sé, ma
   * consegna la scelta al chiamante, che nell'Ufficio del Governo la mette in
   * coda automaticamente (WS-GOVOFFICE-02).
   */
  onChoose?: (item: CabinetItemView, path: CabinetPathView) => void;
  /**
   * La cronaca di questa sedia, e i suoi aggiornamenti. Li possiede il chiamante
   * — come per il Consulente — perché la conversazione deve sopravvivere alla
   * chiusura del pannello e non mescolarsi con quella di un'altra sedia.
   */
  messages: AdvisorHistoryItem[];
  streaming: boolean;
  onAddMessage: (message: AdvisorHistoryItem) => void;
  onAppendToken: (token: string) => void;
  onStreamingChange: (streaming: boolean) => void;
  /**
   * P04 / WS-GOVOFFICE-02 — Il problema che il giocatore presenta al ministro
   * può concludersi subito con un ordine: è l'altra direzione del dialogo
   * («sono io che presento problemi a loro»). Il chiamante lo mette in coda
   * automaticamente. Se manca, la chat resta conversazione pura.
   */
  onOrderFromUserMessage?: (text: string) => void;
  /**
   * WS-MINISTER-UX-03 — Il ministro può disporre un'evidenza sulla tavola: la
   * risposta più recente con un blocco `tavola` valido lo annuncia qui. Il
   * chiamante la applica solo a una risposta conclusa (mai durante lo streaming).
   */
  onPresentation?: (messageId: string, quote: string, directive: PresentationDirective, discussion?: string) => void;
  /**
   * WS-MINISTER-UX-05 — La memoria della sedia. Viene inviata **con** la
   * richiesta (non mostrata nella chat): il server la valida, ne deriva il
   * mandato e la persiste, così il ministro ricorda gli impegni anche quando la
   * cronologia visibile è breve.
   */
  memory?: MinisterMemoryItem[];
}

/** La barra di una cifra: la grafica dentro la chat, dai numeri del motore. */
function FigureBar({ figure }: { figure: CabinetItemView['figures'][number] }) {
  // La barra rende visibile il divario senza inventare una percentuale: mostra
  // il valore come quota, e una cifra ignota non ha barra.
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
        {isUnknown(figure) ? '—' : formatFigureValue(figure.value, figure.unit)}
      </div>
      <div className="minister-figure-basis">{basisLabel(figure.basis)}</div>
    </div>
  );
}

export function MinisterChat({
  gameId, address, onChoose,
  messages, streaming, onAddMessage, onAppendToken, onStreamingChange,
  onOrderFromUserMessage, onPresentation, memory,
}: MinisterChatProps) {
  const [input, setInput] = useState('');
  const [error, setError] = useState('');
  const endRef = useRef<HTMLDivElement>(null);
  const threadRef = useRef<HTMLDivElement>(null);
  // WS-MINISTER-UX-07 (C) — Se il giocatore era in fondo si segue lo stream; se
  // ha risalito la cronologia non lo si riporta giù.
  const stickToBottomRef = useRef(true);
  // Le direzioni di presentazione già annunciate: una per messaggio, per non
  // ripetere l'evento se il componente si ridisegna.
  const emittedPresentationRef = useRef<Record<string, string>>({});

  useEffect(() => {
    if (!stickToBottomRef.current) return;
    endRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, streaming]);

  const onThreadScroll = (): void => {
    const el = threadRef.current;
    if (!el) return;
    stickToBottomRef.current = isNearBottom({
      scrollTop: el.scrollTop,
      scrollHeight: el.scrollHeight,
      clientHeight: el.clientHeight,
    });
  };

  // WS-MINISTER-UX-03 — Solo a risposta conclusa si annuncia la presentazione:
  // durante lo streaming il blocco può essere incompleto e non si applica nulla.
  useEffect(() => {
    if (!onPresentation || streaming || !address) return;
    const lastIndex = messages.length - 1;
    if (lastIndex < 0) return;
    const last = messages[lastIndex];
    if (!last || last.role !== 'assistant' || !last.content.trim()) return;
    const { text, directive } = parsePresentation(last.content);
    if (!directive) return;
    const messageId = `${address.seat}#${lastIndex}`;
    const signature = `${messageId}:${JSON.stringify(directive)}`;
    if (emittedPresentationRef.current[messageId] === signature) return;
    emittedPresentationRef.current[messageId] = signature;
    // WS-MINISTER-UX-07 (A2) — Insieme alla risposta viaggia l'ultimo messaggio
    // del Presidente: è dal **discorso** che si sceglie la voce di spesa da
    // evidenziare, non dalla risposta (che può non nominarla).
    const lastUser = [...messages.slice(0, lastIndex)].reverse().find(m => m.role === 'user')?.content ?? '';
    onPresentation(messageId, text.slice(0, 140), directive, lastUser);
  }, [messages, streaming, onPresentation, address?.seat]);

  // Cambiando ministro si azzera solo la BOZZA della domanda: la cronaca è per
  // sedia e resta dov'è — è la differenza dal comportamento precedente.
  useEffect(() => {
    setInput('');
    setError('');
  }, [address?.seat]);

  if (!address) {
    return (
      <p className="minister-status" role="status">
        Nessun ministro da interrogare: la seduta non ha portato nulla su questa sedia.
      </p>
    );
  }

  const send = async (): Promise<void> => {
    const text = input.trim();
    if (!text || streaming) return;
    onStreamingChange(true);
    setError('');
    setInput('');
    // Chi invia vuole vedere la risposta: si torna ad agganciare il fondo.
    stickToBottomRef.current = true;
    const history = messages.filter(message => message.content.trim()).slice(-HISTORY_LIMIT);
    onAddMessage({ role: 'user', content: text });
    // Il posto della risposta: cresce token per token, come per il Consulente.
    onAddMessage({ role: 'assistant', content: '' });
    // WS-MINISTER-UX-05 — La memoria precede la domanda: il testo mostrato resta
    // quello del Presidente, ma al modello arrivano prima i ricordi pertinenti.
    const outbound = text;
    try {
      await ministerApi.askStream(gameId, address.seat, outbound, history, onAppendToken, memory ?? []);
    } catch (e) {
      console.error('[Government] Minister reply failed:', e);
      setError('Il ministro non risponde ora.');
      onAppendToken('Il ministro non è raggiungibile ora. Riprova.');
    } finally {
      onStreamingChange(false);
    }
  };

  const items = address.items;
  const lastIndex = messages.length - 1;
  // WS-MINISTER-UX-07 (C) — Lo screen reader legge la risposta **conclusa**, non
  // ogni token: la regione viva annuncia solo l'ultimo messaggio del ministro
  // quando lo streaming è finito. Il testo è quello reso (senza blocco tavola).
  const lastCompletedReply = !streaming
    ? [...messages].reverse().find(message => message.role === 'assistant' && message.content.trim())?.content ?? ''
    : '';

  return (
    <div className="minister-chat" aria-label={`Dialogo con ${address.label}`}>
      <div className="minister-thread" ref={threadRef} onScroll={onThreadScroll}>
        {messages.length === 0 && !streaming && (
          <div className="minister-entry assistant minister-greeting">
            <div className="entry-meta"><span>{address.label}</span></div>
            <div className="entry-text">
              <p className="minister-salutation">Signor Presidente,</p>
              <p><EngineText text={address.opening} /></p>
            </div>
          </div>
        )}
        {messages.map((message, index) => {
          const isStreamingThis = index === lastIndex && streaming && message.role === 'assistant';
          return (
            <div key={index} className={`minister-entry ${message.role}`}>
              <div className="entry-meta">
                {message.role === 'user' ? <span>Governo</span> : <span>{address.label}</span>}
              </div>
              <div className="entry-text">
                {isStreamingThis && !message.content ? (
                  <span className="advisor-typing"><i /><i /><i /></span>
                ) : (
                  <>
                    {/* Il modello risponde in markdown, come il Consulente: la
                        risposta si rende come documento invece di mostrare gli
                        asterischi. Il messaggio del giocatore resta testo. */}
                    {message.role === 'assistant'
                      ? <RichText text={parsePresentation(message.content).text} />
                      : message.content}
                    {isStreamingThis && <span className="stream-cursor">▌</span>}
                  </>
                )}
              </div>
              {/* P04 — «sono io che presento problemi a loro»: il problema
                  scritto dal giocatore diventa la bozza d'ordine con un click,
                  senza ricopiarlo a mano nel compositore. */}
              {message.role === 'user' && onOrderFromUserMessage && message.content.trim() && (
                <button
                  type="button"
                  className="minister-draft-order"
                  onClick={() => onOrderFromUserMessage(message.content)}
                  title="Concludi con un ordine: entra subito nella coda"
                >
                  ↳ Concludi con un ordine da questo problema
                </button>
              )}
            </div>
          );
        })}
        {error && <p className="minister-error" role="alert">{error}</p>}
        <div ref={endRef} />
      </div>

      {/* WS-MINISTER-UX-07 (C) — Annuncio accessibile della sola risposta
          conclusa: evita la vocalizzazione token per token durante lo stream. */}
      <p className="minister-live sr-only" role="status" aria-live="polite">
        {lastCompletedReply ? parsePresentation(lastCompletedReply).text.slice(0, 600) : ''}
      </p>

      <div className="minister-compose">
        <textarea
          value={input}
          onChange={event => setInput(event.target.value)}
          onKeyDown={event => {
            if (event.key === 'Enter' && !event.shiftKey) {
              event.preventDefault();
              void send();
            }
          }}
          placeholder={`Scrivi al ${address.label}…`}
          aria-label={`Messaggio per ${address.label}`}
          rows={2}
          disabled={streaming}
        />
        <button type="button" onClick={() => void send()} disabled={streaming || !input.trim()}>
          {streaming ? '…' : 'Invia'}
        </button>
      </div>

      {/* WS-GOVOFFICE-03 — Le «strade proposte» non stanno piu' qui: erano
          ordini presettati con un badge «consigliata», un click e l'ordine era
          in coda senza scrivere nulla. L'ordine nasce dal dialogo (il pulsante
          sotto ogni messaggio del giocatore) e le vie d'uscita le propone il
          ministro a parole. */}
    </div>
  );
}
