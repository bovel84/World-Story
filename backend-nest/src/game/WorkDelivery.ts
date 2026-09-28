/**
 * MG03 µ2 — L'opera finita esiste sulla mappa
 * ===========================================
 * Un cantiere che avanza e non produce nulla è metà del lavoro. Questo modulo
 * consegna: dal progetto al collaudo, dal collaudo all'**oggetto sulla mappa**,
 * con l'effetto dichiarato dalla distinta del catalogo.
 *
 * L'oggetto che scrive è lo stesso che il motore conosce già — `type` finale,
 * `metadata.status: 'operational'`, `completedDate` — così il dossier, la mappa
 * e l'economia lo leggono senza un secondo formato. Ma con due differenze
 * sostanziali rispetto alla scorciatoia legacy:
 *
 *  - **non c'è un `construction_site` da promuovere**: i progetti strict non
 *    creano un cantiere sulla mappa al commit. L'oggetto nasce qui, dal
 *    collaudo, e la sua esistenza È la prova del collaudo;
 *  - **non c'è una data che basta a sé stessa**: `completeDueConstructions`
 *    promuove un cantiere quando `expectedDate` scade — è la strada legacy, ed è
 *    quella che produceva cantieri mai chiusi e opere mai nate. Qui l'unica
 *    condizione è il collaudo verificato sul progetto.
 *
 * L'effetto dichiarato dalla distinta (`WorkDefinition.effect`) viaggia nel
 * `metadata`: è ciò che rende l'opera misurabile invece di un'icona. Il consumo
 * economico dell'effetto — capacità di trasporto, manutenzione — è materia di una
 * fase successiva: qui si consegna un oggetto con il suo effetto DICHIARATO, non
 * si inventa un impatto sui conti che nessuna ricetta ancora modella.
 */

import { shortId } from '../utils/short-id';
import type { WorkDefinition } from '../scenario/types';

/** L'oggetto mappa di un'opera finita, come lo leggono dossier e mappa. */
export interface DeliveredWork {
  readonly id: string;
  readonly type: string;
  readonly name: string;
  readonly level: number;
  readonly owner: string;
  readonly lat: number;
  readonly lng: number;
  readonly metadata: Record<string, unknown>;
}

export interface DeliverWorkInput {
  readonly work: WorkDefinition;
  /** Regione dove sorge l'opera: quella risolta al momento dell'ordine. */
  readonly regionId: string;
  readonly regionOwner: string;
  readonly center: { readonly lat: number; readonly lng: number };
  /** Data del collaudo: è la data dell'opera, non quella prevista. */
  readonly completedDate: string;
  /** Progetto che l'ha prodotta: il legame con la decisione che l'ha voluta. */
  readonly projectId: string;
}

/**
 * Costruisce l'oggetto dell'opera finita.
 *
 * Funzione **pura**: non tocca la mappa, restituisce ciò che va scritto. Chi la
 * chiama decide dove metterlo — e il test può verificarlo senza un database.
 */
export function deliveredWorkFor(input: DeliverWorkInput): DeliveredWork {
  const { work } = input;
  return {
    id: `w_${shortId()}`,
    // Il tipo finale è quello dichiarato dalla distinta: `ft_road` per una
    // strada. Non è il tipo generico «construction_site».
    type: work.assetTypeId,
    name: work.name,
    level: 1,
    owner: input.regionOwner,
    lat: input.center.lat,
    lng: input.center.lng,
    metadata: {
      // Lo stato è `operational`, non `under_construction`: l'opera è collaudata.
      status: 'operational',
      phase: 'completed',
      completedDate: input.completedDate,
      // Il progetto: la mappa può risalire alla decisione che l'ha voluta.
      projectId: input.projectId,
      workId: work.id,
      regionId: input.regionId,
      // L'effetto DICHIARATO dalla distinta, non calcolato qui: capacità di
      // trasporto, unità, misura al giorno. È ciò che rende l'opera misurabile.
      effect: { kind: work.effect.kind, unit: work.effect.unit, perDay: work.effect.perDay },
      // La manutenzione dichiarata, per chi la applicherà.
      ...(work.maintenance ? { maintenance: { ...work.maintenance } } : {}),
      // Provenienza del dato: la distinta è del catalogo, e la sua qualità è
      // dichiarata là. Non si promuove una stima ad autorevole.
      evidence: { ...work.evidence },
    },
  };
}

/**
 * L'opera è già presente su quella regione?
 *
 * Il controllo è per `projectId` e non per nome: due strade omonime in due
 * regioni diverse sono due opere, e un nome ripetuto non deve impedire la
 * seconda consegna.
 */
export function alreadyDelivered(
  objects: readonly { readonly metadata?: Record<string, unknown> }[],
  projectId: string,
): boolean {
  return objects.some(object => object.metadata?.projectId === projectId);
}
