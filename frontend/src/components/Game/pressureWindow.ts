/**
 * World Story — Finestra temporale delle sfide di pace (GAMEPLAY-LONG)
 * ===================================================================
 * Le sfide non durano «un turno»: il motore assegna a ciascuna una finestra di
 * GIORNI di calendario (`window.daysElapsed`, `window.daysLeft`, `urgency`) e
 * una priorità (`critica` | `rilevante` | `ordinaria`). Qui si traducono quei
 * numeri in testo leggibile: nessun calcolo nuovo, nessuna soglia inventata dal
 * client.
 */

/** Finestra calcolata dal motore (sottoinsieme usato dalla UI). */
export interface PressureWindowView {
  daysElapsed?: number;
  daysLeft?: number;
  expired?: boolean;
  escalationDue?: boolean;
  urgency?: 'scaduta' | 'imminente' | 'prossima' | 'aperta' | string;
}

export type PressurePriorityView = 'critica' | 'rilevante' | 'ordinaria' | string;

/** Quanto tempo resta, in una riga. `''` se il motore non pubblica la finestra. */
export function pressureWindowText(window?: PressureWindowView | null): string {
  if (!window) return '';
  const elapsed = Math.max(0, Math.floor(Number(window.daysElapsed) || 0));
  const left = Math.max(0, Math.floor(Number(window.daysLeft) || 0));
  if (window.expired) return 'Scaduta: la conseguenza è già arrivata.';
  if (window.urgency === 'imminente') {
    return `Scade fra ${left} ${left === 1 ? 'giorno' : 'giorni'}: decidi adesso.`;
  }
  if (elapsed <= 0) return `Aperta ora: hai ${left} giorni per rispondere.`;
  return `Aperta da ${elapsed} ${elapsed === 1 ? 'giorno' : 'giorni'} · restano ${left}.`;
}

/** Tono semantico della finestra: verde se c'è tempo, ambra se stringe, rosso se scaduta. */
export function pressureWindowTone(window?: PressureWindowView | null): 'positive' | 'warning' | 'negative' | '' {
  if (!window) return '';
  if (window.expired) return 'negative';
  if (window.urgency === 'imminente' || window.escalationDue) return 'warning';
  return 'positive';
}

/** Etichetta della priorità (P2: non tutte le questioni pesano uguale). */
export const PRESSURE_PRIORITY_LABEL: Record<string, string> = {
  critica: 'Crisi da gestire',
  rilevante: 'Questione rilevante',
  ordinaria: 'Ordinaria amministrazione',
};

/**
 * Divide le sfide fra quelle che meritano attenzione e quelle che possono
 * restare nel dossier. La decisione è del **motore** (`highlighted`); qui, se
 * il campo manca (payload vecchi), si ricade sulla priorità — mai su una
 * euristica nuova.
 */
export function splitPressuresByAttention<T extends { highlighted?: boolean; priority?: PressurePriorityView }>(
  pressures: readonly T[] | null | undefined,
  maxHighlighted = 2,
): { highlighted: T[]; dossier: T[] } {
  const list = Array.isArray(pressures) ? pressures : [];
  const highlighted: T[] = [];
  const dossier: T[] = [];
  for (const pressure of list) {
    // Payload nuovi: decide il motore (`highlighted`). Payload con la sola
    // priorità: solo le critiche. Payload vecchi (nessuno dei due campi): la
    // sfida resta visibile come prima — mai nascondere una questione aperta.
    const flagged = pressure.highlighted
      ?? (pressure.priority ? pressure.priority === 'critica' : true);
    if (flagged && highlighted.length < Math.max(0, maxHighlighted)) highlighted.push(pressure);
    else dossier.push(pressure);
  }
  return { highlighted, dossier };
}
