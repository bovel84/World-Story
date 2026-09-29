/**
 * WS-GOVOFFICE-02 — Dalla seduta all'ordine
 * =========================================
 * Un ministro porta un problema; il giocatore sceglie una strada; da quella
 * scelta nasce un **ordine** che il motore accetta. Qui vive la regola pura di
 * quella trasformazione, estratta da `useOrderQueue` perché si possa provare
 * senza schermo (`cabinetOrder.test.ts`).
 *
 * Due responsabilità, entrambe dichiarate:
 *  1. `cabinetDeclarationFor` — se la voce riguarda un'opera, la dichiarazione
 *     che il motore pretende (o `null`: senza distinta coperta non si apre un
 *     cantiere, e lo si dice invece di scrivere un ordine che non farebbe nulla).
 *  2. `composeCabinetOrderText` — il testo per la PERSONA: leggibile e
 *     correggibile. Le cifre del motore restano nei loro campi; nella prosa non
 *     si promettono numeri.
 */
import type { CabinetItemView, CabinetPathView } from '../../services/api';

/** P03 — la dichiarazione d'opera: quella che il motore accetta per un cantiere. */
export interface WorkDeclarationInput {
  workId: string;
  payerActorId: string;
  materialActorId: string;
  funded: boolean;
}

/**
 * P03 — La dichiarazione di una voce, se è registrabile come costruzione.
 *
 * `null` in tre casi, tutti dichiarati al giocatore: la voce non riguarda
 * un'opera; il server non ha risolto i detentori; nessun attore della nazione
 * copre la distinta (`materialActorId: null`).
 */
export function cabinetDeclarationFor(item: CabinetItemView): WorkDeclarationInput | null {
  const declaration = item.declaration;
  if (!declaration || !declaration.materialActorId) return null;
  return {
    workId: declaration.workId,
    payerActorId: declaration.payerActorId,
    materialActorId: declaration.materialActorId,
    funded: declaration.funded,
  };
}

/**
 * Compone il testo dell'ordine che nasce da una strada della seduta.
 *
 * Le cifre **non misurate o mancanti** non diventano promesse: finiscono in una
 * riga di vincoli da sciogliere. Se l'opera esiste ma la distinta non è coperta,
 * il testo lo dichiara, invece di far credere che registrare aprirebbe il
 * cantiere.
 */
export function composeCabinetOrderText(item: CabinetItemView, path: CabinetPathView): string {
  const missing = item.figures
    .filter(figure => figure.basis.kind !== 'measured' || figure.label.toLowerCase().includes('mancante'))
    .map(figure => figure.label);
  const declaration = cabinetDeclarationFor(item);
  const lines = [
    path.title,
    `— ${item.need}`,
    `Strada scelta: ${path.detail}`,
    `Prerequisiti: ${path.prerequisites.length > 0 ? path.prerequisites.join(', ') : 'nessuno'}`,
    `Esito atteso: ${path.expected}`,
    missing.length > 0 ? `Vincoli da sciogliere: ${missing.join(', ')}` : '',
  ];
  if (item.work && !declaration) {
    // L'opera c'è ma la distinta non è coperta: si dice, invece di scrivere un
    // ordine che non aprirebbe alcun cantiere.
    const mancanti = item.declaration?.missingMaterials
      ?.map(material => `${material.resourceId} (${material.missing})`) ?? [];
    lines.push(
      mancanti.length > 0
        ? `Attenzione: mancano ${mancanti.join(', ')}. Registrare non aprirebbe il cantiere.`
        : 'Attenzione: la distinta non è coperta. Registrare non aprirebbe il cantiere.',
    );
  }
  return lines.filter(Boolean).join('\n');
}
