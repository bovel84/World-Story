/**
 * P03 — Dalla proposta del ministro a un ordine che il motore ACCETTA
 * ===================================================================
 * Il difetto che questo modulo corregge, misurato dall'autore: **l'ordine del
 * Governo non passava i requisiti del motore**. Il motivo era preciso: la bozza
 * era prosa — «Strada scelta: …», «Prerequisiti: …» — e dal testo libero il
 * motore non ricava una costruzione. Per un cantiere servono la dichiarazione
 * dell'opera e i detentori, e nessuna delle due si legge da una frase.
 *
 * La correzione: la voce del ministro porta la **dichiarazione risolta dal
 * server** (`workId` e detentori), la bozza la conserva mentre il giocatore la
 * corregge, e la coda la invia. Così l'ordine nato dal Governo è lo stesso atto
 * di un ordine dichiarato a mano — non un secondo percorso.
 *
 * Due regole:
 *  - **il client non inventa la dichiarazione**: la riceve dal server. Se manca,
 *    la bozza resta prosa e il giocatore lo sa — non si promette un cantiere che
 *    non nascerebbe;
 *  - **il testo è per la persona, la dichiarazione per il motore**: la prosa
 *    resta leggibile e correggibile, la dichiarazione viaggia accanto.
 *
 * Funzioni **pure**: nessuna chiamata di rete, così si testano senza montare
 * nulla.
 */

import type { CabinetAddressView, CabinetItemView, CabinetPathView } from '../../services/api';

/** La dichiarazione che il motore pretende per aprire un cantiere. */
export interface WorkDeclaration {
  readonly workId: string;
  readonly payerActorId: string;
  readonly materialActorId: string;
  readonly funded: boolean;
}

/**
 * La dichiarazione di una voce, se è registrabile come costruzione.
 *
 * `undefined` in tre casi, tutti legittimi e tutti dichiarati al giocatore:
 * la voce non riguarda un'opera; il server non ha risolto i detentori; nessun
 * attore della nazione copre la distinta (`materialActorId: null`).
 */
export function declarationFor(item: CabinetItemView): WorkDeclaration | undefined {
  const declaration = item.declaration;
  if (!declaration) return undefined;
  if (!declaration.materialActorId) return undefined;
  return {
    workId: declaration.workId,
    payerActorId: declaration.payerActorId,
    materialActorId: declaration.materialActorId,
    funded: declaration.funded,
  };
}

/**
 * Il testo della bozza: leggibile da una persona, correggibile, e onesto su ciò
 * che manca.
 *
 * Non contiene istruzioni per il motore — quelle viaggiano nella dichiarazione —
 * perché un numero scritto in prosa non è un numero che il motore legge.
 */
export function draftTextFor(item: CabinetItemView, path: CabinetPathView): string {
  const declaration = declarationFor(item);
  const lines = [
    `${path.title}: ${item.need}`,
    path.detail,
  ];

  if (item.work && !declaration) {
    // L'opera c'è ma la distinta non è coperta: si dice, invece di scrivere un
    // ordine che non partirebbe.
    lines.push(
      'Attenzione: la distinta dell’opera non è ancora coperta dai materiali del paese.',
      'Registrare questo ordine non aprirebbe un cantiere.',
    );
  }
  if (path.prerequisites.length > 0) {
    lines.push(`Serve: ${path.prerequisites.join(', ')}.`);
  }
  return lines.join(' ');
}

/**
 * Lo stato di una bozza nata dal Governo: il testo, la dichiarazione se c'è, e
 * la voce da cui viene. Vive accanto alla bozza nel compositore, così la
 * registrazione sa cosa inviare alla coda.
 */
export interface GovernmentDraft {
  readonly text: string;
  readonly declaration?: WorkDeclaration;
  readonly voiceId: string;
  /** La voce riguardava un'opera ma la distinta non è coperta. */
  readonly blockedByMaterials: boolean;
}

export function draftFromCabinet(
  item: CabinetItemView,
  path: CabinetPathView,
): GovernmentDraft {
  const declaration = declarationFor(item);
  return {
    text: draftTextFor(item, path),
    ...(declaration ? { declaration } : {}),
    voiceId: item.voiceId,
    blockedByMaterials: !!item.work && !declaration,
  };
}

/** La dichiarazione da inviare alla coda per questa bozza, se ha un'opera. */
export function queuePayloadFor(draft: GovernmentDraft | null): WorkDeclaration | undefined {
  return draft?.declaration;
}

/** Utile alla pagina: una voce porta una costruzione dichiarabile? */
export function itemIsBuildable(item: CabinetItemView): boolean {
  return !!item.work && !!declarationFor(item);
}

export type { CabinetAddressView, CabinetItemView, CabinetPathView };
