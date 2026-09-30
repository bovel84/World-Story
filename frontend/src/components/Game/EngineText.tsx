/**
 * WS-GOVOFFICE-05B — Il testo del motore, reso leggibile
 * =====================================================
 * Il motore compone la prosa dei ministri con i suoi valori pieni
 * («Il saldo è 0.06575272084693667 mld»). Questo componente fa due cose, e solo
 * queste:
 *
 *  1. formatta le cifre decimali con l'unico helper condiviso
 *     (`formatNarratedDecimals`: 2 decimali, 1 se percentuali, virgola it-IT);
 *  2. rende ogni numero in cifre **lineari e non corsive** (`op-numeral`), così
 *     un «1» non si confonde con una «l» nel testo della seduta — il sospetto
 *     refuso dell'autore, che nel codice non è mai esistito, ma che a schermo
 *     può nascere dalla resa corsiva del carattere a corpo piccolo.
 *
 * Non conosce il gioco: riceve una stringa e la rende. Gli interi non si
 * toccano, quindi «Ho 1 cosa da portare al consiglio» resta identico.
 */
import { Fragment } from 'react';
import { formatNarratedDecimals } from '../../utils/format';

/** Un numero già formattato in italiano: «1», «0,06», «61.000.000,00», «-12,35». */
const NUMBER = /(-?\d{1,3}(?:\.\d{3})*(?:,\d+)?|-?\d+(?:,\d+)?)/g;

export function EngineText({ text }: { text: string }) {
  const parts = formatNarratedDecimals(text).split(NUMBER);
  return (
    <>
      {parts.map((part, index) =>
        /^-?\d/.test(part) ? (
          <span key={index} className="op-numeral">{part}</span>
        ) : (
          <Fragment key={index}>{part}</Fragment>
        ),
      )}
    </>
  );
}
