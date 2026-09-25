/**
 * World Story — N05/N06: il criterio d'epoca del dossier militare
 * ==============================================================
 * Invarianti **N3** («nessuna schermata dichiara una pertinenza che non può
 * provare») e **N4** («nessun'etichetta d'epoca scritta a mano nel client»).
 *
 * Il difetto misurato: in una partita del 1815 il dossier elencava le 31 voci del
 * catalogo del motore — carri di 4ª generazione, caccia di 5ª generazione,
 * portaerei, missili ipersonici — sotto cinque intestazioni di dominio scritte a
 * mano nel componente. La dottrina pre-industriale dichiara **una sola**
 * categoria pertinente e il motore stesso motiva: «il catalogo dell'epoca non ha
 * mezzi corazzati, aerei o missili».
 *
 * **Che cosa il client può e non può fare.** Il predicato che lega *categoria del
 * catalogo* ed *epoca* (`ESTABLISHMENT_BY_EPOCH[].match`) **non è pubblicato**:
 * l'`establishment` che arriva al client porta l'id interno della dottrina
 * (`individualWeapons`, `armoredMobility`…), l'etichetta, il peso e la
 * motivazione — non le categorie del catalogo. Filtrare nel client significherebbe
 * ricopiare quella tabella, cioè una seconda verità parallela (vietata da N4).
 *
 * Quindi questo modulo **non filtra**: rende leggibile ciò che il motore dichiara
 * come pertinente, così il dossier lo può mettere accanto al catalogo invece di
 * far passare il catalogo per la dottrina d'epoca. Il filtro vero è una decisione
 * di motore (D-A di `docs/COERENZA_DOSSIER_ANNO_NAZIONE.md`).
 */
import type { EstablishmentCategoryPayload } from '../../services/api';

export interface DoctrineView {
  /** L'etichetta dell'epoca, dal motore. `null` se il motore non la pubblica. */
  epochLabel: string | null;
  /** Le categorie che l'epoca prevede, con etichetta e motivazione del motore. */
  categories: Array<{ label: string; basis: string; demand: string }>;
  /** Una riga leggibile: «Armi individuali (quota degli uomini in armi); …». */
  summary: string;
}

const clean = (value: unknown): string => (typeof value === 'string' ? value.trim() : '');

/**
 * Lettura della dottrina pubblicata dal motore.
 * Non decide nulla: espone `establishment` e `epochLabel` come li pubblica il
 * motore, con la sola formattazione necessaria a mostrarli.
 */
export function doctrineView(
  establishment: EstablishmentCategoryPayload[] | undefined | null,
  epochLabel: string | null | undefined,
): DoctrineView {
  const rows = Array.isArray(establishment) ? establishment : [];
  const categories = rows
    .filter(row => row && typeof row === 'object')
    .map(row => ({
      label: clean(row.label) || clean(row.category),
      basis: clean(row.basis),
      demand: clean(row.demand),
    }))
    .filter(row => row.label.length > 0);

  const summary = categories
    .map(row => (row.demand === 'personnel_share' ? `${row.label} (quota degli uomini in armi)` : row.label))
    .join(' · ');

  return {
    epochLabel: clean(epochLabel) || null,
    categories,
    summary,
  };
}

/**
 * La dottrina dichiara **almeno una** categoria? Se sì, il dossier può dire cosa
 * l'epoca prevede. Se no (mondo senza dottrina pubblicata), il dossier non
 * afferma nulla: l'assenza si dichiara (N7).
 */
export function hasDoctrine(view: DoctrineView): boolean {
  return view.categories.length > 0;
}
