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

import { DomainCard } from './OperatingPictureBoard';
import { basisLabel, isUnknown } from './CabinetSession';
import { SEAT_DOMAINS } from './seatDomains';
import type { CabinetAddressView } from '../../services/api';
import type { NationalOperatingPicture } from './nationalOperatingPicture';

export interface MinisterDossierProps {
  /** La sedia aperta: nome, competenza e le cifre che ha portato. */
  address: CabinetAddressView | null;
  /** Il quadro operativo della nazione, dall'helper condiviso col dossier. */
  picture: NationalOperatingPicture | null;
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
        {isUnknown(figure) ? '—' : `${figure.value} ${figure.unit}`.trim()}
      </div>
      <div className="minister-figure-basis">{basisLabel(figure.basis)}</div>
    </div>
  );
}

export function MinisterDossier({ address, picture }: MinisterDossierProps) {
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
            {needs.map(need => <li key={need}>{need}</li>)}
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
    </aside>
  );
}

export default MinisterDossier;
