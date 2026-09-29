/**
 * World Story — WS-GOVOFFICE-03: il Registro degli atti (prima schermata)
 * ======================================================================
 * L'autore: «gli ordini registrati non si devono vedere nella pagina di dialogo
 * con il ministro. Possiamo immaginare gli ordini nella prima schermata come
 * magari un registro ufficiale con la firma del presidente.»
 *
 * Questo è quel registro. Non è una lista di lavoro — non si modifica, non si
 * rimuove, non si spunta: è la **lettura** degli atti che il governo ha
 * deliberato e che attendono il turno. Per cambiarli si torna in seduta dal
 * ministro, dove l'ordine nasce.
 *
 * Tre cose dette apertamente, perché un registro ufficiale non bluffa:
 *
 *  · **il motore non ha un nome di persona.** Non esiste un «Presidente Mario
 *    Rossi»: l'unico nome autorevole è quello dello **Stato** (`nationalName`).
 *    La firma quindi è d'ufficio — «Il Presidente del Consiglio» — e quando il
 *    nome dello Stato non è pubblicato la riga «Per il Governo di …» **si
 *    omette** invece di inventarla (`isNameUnknown`);
 *  · **la data è quella corrente di gioco**, non la data del singolo atto. Il
 *    motore registra `{ id, text }` e basta: sedia e data per atto non esistono,
 *    e non si deducono;
 *  · **la firma sta in calce, una volta sola**, come in un registro rilegato:
 *    ripeterla per ogni atto suggerirebbe diciassette firme che nessuno ha
 *    messo.
 */

import { formatDateOr } from '../../utils/format';
import { isNameUnknown } from './polityName';

export interface OrderRegisterProps {
  /** Gli atti in attesa del turno, nell'ordine in cui il governo li ha deliberati. */
  orders: Array<{ id: string; text: string }>;
  /** Il nome dello Stato che firma (da `nationalName`; può essere non noto). */
  nationalName: string;
  /** La data corrente di gioco (ISO), per la firma. */
  date?: string | null;
  /**
   * Ritirare un atto **prima** che il tempo avanzi. È l'unico modo di togliere
   * un ordine dalla coda: la coda non si mostra più nella seduta. Passa da
   * `removeQueuedAction` (rotta del motore), non da una mutazione locale.
   */
  onWithdraw?: (id: string) => void;
}

export function OrderRegister({ orders, nationalName, date, onWithdraw }: OrderRegisterProps) {
  const nameKnown = !isNameUnknown(nationalName);
  const signedOn = formatDateOr(date, '');

  return (
    <section className="order-register" aria-labelledby="order-register-title">
      <header className="order-register-head">
        <h3 className="order-register-title" id="order-register-title">Registro degli atti</h3>
        <p className="order-register-sub">
          Gli atti deliberati con i ministri. Saranno eseguiti quando avanzi il
          tempo dalla data in alto: finché restano qui, non è passato nulla.
        </p>
      </header>

      {orders.length === 0 ? (
        <p className="order-register-empty" role="status">
          Nessun atto firmato. Entra da un ministro e concludi la seduta con un ordine.
        </p>
      ) : (
        <>
          <ol className="order-register-list">
            {orders.map((order, index) => (
              <li key={order.id} className="order-register-act">
                <span className="order-register-number">{index + 1}.</span>
                <span className="order-register-text">{order.text}</span>
                {/* Ritirare un atto: l'unico modo per non eseguirlo, finché il
                    tempo non è avanzato. Il gesto si chiama «ritira», come su un
                    registro — non «elimina», che è un gesto da lista di lavoro. */}
                {onWithdraw && (
                  <button
                    type="button"
                    className="order-register-withdraw"
                    onClick={() => onWithdraw(order.id)}
                    title="Ritira l'atto: non sarà eseguito al salto"
                    aria-label={`Ritira l'atto ${index + 1}`}
                  >
                    Ritira
                  </button>
                )}
              </li>
            ))}
          </ol>

          {/* La firma: in calce, una volta, come su un registro rilegato. */}
          <footer className="order-register-signature">
            {nameKnown && (
              <div className="order-register-signature-state">Per il Governo di {nationalName}</div>
            )}
            <div className="order-register-signature-office">Il Presidente del Consiglio</div>
            {signedOn && <div className="order-register-signature-date">{signedOn}</div>}
          </footer>
        </>
      )}
    </section>
  );
}

export default OrderRegister;
