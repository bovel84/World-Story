/**
 * World Story — WS-GOVOFFICE-03: da una sedia del gabinetto al dominio nazionale
 * =============================================================================
 * Il pannello della seduta mostra, accanto al ministro, il dominio nazionale di
 * cui quella sedia si occupa. La mappa sedia → dominio **non esisteva**: il
 * motore dichiara le competenze a parole (`SEAT_READS`, in
 * `backend-nest/src/core/government/Cabinet.ts`) e il dossier conosce la mappa
 * inversa (`SECTION_FOR_DOMAIN`, in `OperatingPictureBoard.tsx`), mai questa.
 *
 * La mappa è la **trascrizione** di `SEAT_READS`: non una tassonomia nuova. Se
 * il motore cambia una competenza, questa tabella va cambiata con lei — ed è il
 * motivo per cui sono tenute vicine nel commento, non in due file lontani.
 *
 *  · tesoro  — «bilancio, debito, cassa e crediti»        → economia, risorse
 *  · lavori  — «cantieri, deficit misurati, opere»        → industria
 *  · esteri  — «relazioni, contratti, deficit copribile»  → governo
 *  · interno — «fazioni, pressione politica, coesione»    → governo
 *  · guerra  — «potenza e arsenale, minacce al confine»   → militare
 */

import type { CabinetAddressView } from '../../services/api';
import type { OperatingDomain } from './nationalOperatingPicture';

/** I domini del quadro operativo di cui risponde una sedia. */
export const SEAT_DOMAINS: Record<CabinetAddressView['seat'], OperatingDomain['id'][]> = {
  tesoro: ['economia', 'risorse'],
  lavori: ['industria'],
  // Esteri legge le relazioni con le controparti: è materia politica, non
  // militare — la forza militare è la competenza della guerra.
  esteri: ['governo'],
  interno: ['governo'],
  guerra: ['militare'],
};
