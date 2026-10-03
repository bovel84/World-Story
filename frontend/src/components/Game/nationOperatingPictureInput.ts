/**
 * World Story — WS-GOVOFFICE-03: un solo quadro operativo della nazione
 * =====================================================================
 * L'Ufficio del Governo mostra, accanto al ministro, la scheda del dominio
 * nazionale di quella sedia. Il dossier Nazione mostra gli stessi domini nel
 * suo quadro d'insieme. Sono la **stessa** cosa, quindi devono leggere lo
 * **stesso** numero: due chiamate a `nationalOperatingPicture` con ingressi
 * derivati in due posti diversi mostrerebbero due valori per lo stesso dominio.
 *
 * Qui la composizione degli ingressi sta in un posto solo, e la usano sia
 * `useNationDockModel` (dossier) sia il pannello della seduta. Non è un nuovo
 * read model: è la derivazione che il dossier faceva inline, spostata dove può
 * essere condivisa.
 *
 * L'unica derivazione non banale è `assets.capacityBase.forces`, che viene da
 * `summarizeNationalAssets` — la stessa funzione del dossier, non una copia.
 */

import type { OperatingPictureInput } from './nationalOperatingPicture';
import { summarizeNationalAssets } from './nationDossier';
import type { NationDockProps } from './NationDock/types';

/**
 * Le fonti del quadro operativo: il sottoinsieme delle props del dossier che
 * serve a comporlo. `Pick` e non un'interfaccia nuova, così le forme restano
 * legate a quelle del dossier per costruzione.
 */
export type NationOperatingPictureSources = Pick<
  NationDockProps,
  | 'regions'
  | 'account'
  | 'resources'
  | 'arms'
  | 'government'
  | 'commitments'
  | 'accountHistory'
  | 'ongoingProcesses'
  | 'maintenanceObligations'
  | 'crisis'
  | 'pressures'
  | 'followUps'
  | 'today'
>;

/** Gli ingressi di `nationalOperatingPicture`, derivati una volta sola. */
export function nationOperatingPictureInput(
  src: NationOperatingPictureSources,
): OperatingPictureInput {
  const assets = summarizeNationalAssets(src.regions ?? [], src.account);
  return {
    account: src.account,
    resources: src.resources,
    arsenal: src.arms,
    assets: { capacityBase: { forces: assets.baseForces } },
    government: src.government,
    budget: src.government?.budget ?? null,
    commitments: src.commitments,
    history: src.accountHistory ?? [],
    processes: src.ongoingProcesses ?? [],
    maintenance: src.maintenanceObligations ?? null,
    crisis: src.crisis,
    pressures: src.pressures,
    today: src.today ?? null,
  };
}
