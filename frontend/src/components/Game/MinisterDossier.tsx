/**
 * World Story — WS-GOVOFFICE-03: il pannello del ministro (seduta, colonna destra)
 * ===============================================================================
 * L'autore: «possiamo immaginarla con due pannelli, una con la chat e l'altra
 * con i dati della nazione e di competenza del ministro.» Questo è il secondo.
 *
 * Il pannello risponde a due domande, nell'ordine in cui il giocatore se le fa:
 *  1. **di che cosa risponde questa sedia** — nome, competenza dichiarata dal
 *     motore (`reads`) e le cifre che la sedia ha portato in seduta, con la loro
 *     provenienza (misurato / stimato / mancante);
 *  2. **come sta il paese in quella materia** — la scheda del dominio nazionale
 *     di quella sedia, riusando `DomainCard` del quadro d'insieme.
 *
 * Le cifre vengono da `nationalOperatingPicture`, composto con lo **stesso**
 * helper del dossier Nazione (`nationOperatingPictureInput`): un dominio, un
 * numero. Non calcola nulla e non chiama il motore — è presentazionale.
 *
 * Come `CabinetSession`, **non inventa**: una sedia senza cifre mostra la sua
 * competenza e il suo dominio, mai un numero riempito a mano.
 */

import { useState } from 'react';
import { DomainCard } from './OperatingPictureBoard';
import { basisLabel, isUnknown } from './CabinetSession';
import { EngineText } from './EngineText';
import { SEAT_DOMAINS } from './seatDomains';
import { formatFigureValue } from '../../utils/format';
import type { CabinetAddressView } from '../../services/api';
import type { NationalOperatingPicture } from './nationalOperatingPicture';

export interface MinisterDossierProps {
  /** La sedia aperta: nome, competenza e le cifre che ha portato. */
  address: CabinetAddressView | null;
  /** Il quadro operativo della nazione, dall'helper condiviso col dossier. */
  picture: NationalOperatingPicture | null;
  /**
   * WS-GOVOFFICE-05 — Stato iniziale del pannello. **Chiuso di default**: il
   * dialogo è l'atto centrale e i dati si aprono su richiesta. Il parametro
   * esiste perché il componente resti verificabile con un render statico, senza
   * un DOM: `defaultOpen` rende lo stato "aperto" senza simularne il clic.
   */
  defaultOpen?: boolean;
}

/** La barra di una cifra: la grafica, dai numeri del motore. */
function FigureBar({ figure }: { figure: CabinetAddressView['items'][number]['figures'][number] }) {
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

export function MinisterDossier({ address, picture, defaultOpen = false }: MinisterDossierProps) {
  // WS-GOVOFFICE-05 — Il pannello è a scomparsa: il gancio sta PRIMA della
  // uscita su `address`, così l'ordine dei hook non cambia fra i render.
  const [open, setOpen] = useState(defaultOpen);

  if (!address) {
    return (
      <aside className="minister-dossier" aria-label="Dati del ministro">
        <p className="minister-status" role="status">Nessun ministro da mostrare.</p>
      </aside>
    );
  }

  // I domini di questa sedia: la mappa è la trascrizione di SEAT_READS.
  const domains = SEAT_DOMAINS[address.seat] ?? [];
  const shown = picture
    ? domains.map(id => picture.domains.find(domain => domain.id === id)).filter(domain => domain !== undefined)
    : [];

  const figures = address.items.flatMap(item => item.figures);
  // Un problema per voce: è il «perché» che il ministro ha portato, non un dato.
  const needs = address.items.map(item => item.need).filter(need => need.trim().length > 0);

  return (
    <aside className="minister-dossier" aria-label={`Dati di ${address.label}`}>
      {/* Il controllo del pannello: un pulsante vero, non un div cliccabile.
          `aria-expanded` dice se è aperto, `aria-controls` indica il corpo. */}
      <button
        type="button"
        className="minister-dossier-toggle"
        aria-expanded={open}
        aria-controls="minister-dossier-body"
        aria-label={open ? `Nascondi i dati di ${address.label}` : `Mostra i dati di ${address.label}`}
        onClick={() => setOpen(value => !value)}
      >
        <span className="minister-dossier-toggle-label">Dati della sedia</span>
        <span className="minister-dossier-toggle-icon" aria-hidden="true">{open ? '▾' : '▸'}</span>
      </button>

      {/* Il corpo è presente nel DOM ma nascosto quando chiuso, e il suo
          contenuto è reso **solo** da aperto: nessuna informazione persa
          quando è aperto, nessun dato nascosto che pesi sul dialogo da chiuso. */}
      <div id="minister-dossier-body" className="minister-dossier-body" hidden={!open}>
        {open && (
          <>
            <header className="minister-dossier-head">
              <div className="minister-dossier-name">{address.label}</div>
              <div className="minister-dossier-competence" title="Che cosa legge questa sedia">
                {address.reads}
              </div>
            </header>

            {/* Le cifre della sedia, ognuna con la sua provenienza. Sono le stesse che
                il ministro ha davanti: prima stavano in cima alla chat, ora qui, dove
                si leggono mentre si parla. */}
            {figures.length > 0 && (
              <section className="minister-figures" aria-label="Numeri su cui si parla">
                {figures.map((figure, index) => (
                  <FigureBar key={`${figure.label}-${index}`} figure={figure} />
                ))}
              </section>
            )}

            {needs.length > 0 && (
              <section className="minister-dossier-needs" aria-label="Quello che la sedia porta">
                <div className="minister-dossier-section">Sul tavolo</div>
                <ul className="minister-dossier-need-list">
                  {needs.map(need => <li key={need}><EngineText text={need} /></li>)}
                </ul>
              </section>
            )}

            {/* Il dominio nazionale di questa sedia: la stessa scheda del quadro
                d'insieme, con lo stesso numero. */}
            {shown.length > 0 && (
              <section className="minister-dossier-domains" aria-label="Quadro della materia">
                <div className="minister-dossier-section">La materia, dal quadro nazionale</div>
                {shown.map(domain => (
                  <DomainCard key={domain.id} domain={domain} />
                ))}
              </section>
            )}

            {/* Una sedia i cui domini non sono pubblicati lo dice: non si riempie. */}
            {shown.length === 0 && domains.length > 0 && (
              <p className="minister-dossier-quiet" role="status">
                Il quadro nazionale non pubblica ancora la materia di questa sedia.
              </p>
            )}
          </>
        )}
      </div>
    </aside>
  );
}

export default MinisterDossier;
