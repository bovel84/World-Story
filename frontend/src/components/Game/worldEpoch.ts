/**
 * World Story — N02: l'anno del mondo e la sua epoca
 * =================================================
 * Invariante **N6** («l'anno entra nel dossier una volta e da una fonte sola»).
 *
 * Il dossier sapeva **che** epoca fosse solo indirettamente, perché il motore
 * gliela pubblicava dentro l'arsenale (`epochLabel`, «Dottrina d'epoca: …»).
 * Nessun modulo di presentazione conosceva l'**anno**, e il payload della partita
 * non lo porta affatto: `today` (la data del mondo) è l'unica data disponibile nel
 * client, e c'era già.
 *
 * Qui quella data diventa l'anno e l'epoca, in un punto solo. Le soglie sono
 * **le stesse del motore** (`backend-nest/src/core/simulation/MilitaryDoctrine.ts`,
 * `EPOCH_BOUNDARIES`): 1861 · 1919 · 1946 · 1990. Sono ricopiate perché il motore
 * non le esporta al client; il test le confronta con i valori del motore, così una
 * divergenza futura si vede invece di restare silenziosa.
 *
 * Una data illeggibile **non** ricade sul default del motore (`guerra_fredda`,
 * che esiste perché 1951 è la data di partenza storica del gioco): produce
 * un'assenza dichiarata. Il client non indovina l'epoca di un mondo che non sa
 * datare.
 */

/** Le cinque epoche del motore. */
export type WorldEpoch =
  | 'pre_industriale'
  | 'grande_guerra'
  | 'seconda_guerra'
  | 'guerra_fredda'
  | 'moderno';

/** Etichette, identiche a `MILITARY_EPOCH_LABEL` del motore. */
export const WORLD_EPOCH_LABEL: Record<WorldEpoch, string> = {
  pre_industriale: 'Eserciti pre-industriali',
  grande_guerra: 'Grande guerra',
  seconda_guerra: 'Seconda guerra mondiale',
  guerra_fredda: 'Guerra fredda',
  moderno: 'Era moderna',
};

/**
 * Soglie di epoca — **copia dichiarata** di `EPOCH_BOUNDARIES` del motore.
 * `from` è l'anno a partire dal quale vale quell'epoca.
 */
export const WORLD_EPOCH_BOUNDARIES: ReadonlyArray<{ from: number; epoch: WorldEpoch }> = [
  { from: 1861, epoch: 'grande_guerra' },
  { from: 1919, epoch: 'seconda_guerra' },
  { from: 1946, epoch: 'guerra_fredda' },
  { from: 1990, epoch: 'moderno' },
];

export interface WorldEpochView {
  /** L'anno del mondo (numero), oppure `null` se la data non è leggibile. */
  year: number | null;
  /** L'epoca, oppure `null` se la data non è leggibile. */
  epoch: WorldEpoch | null;
  /** Etichetta leggibile dell'epoca, oppure `null`. */
  epochLabel: string | null;
}

/** Anno a quattro cifre da una data ISO, o `null`. */
export function yearOfDate(date?: string | null): number | null {
  const m = /^(\d{4})-\d{2}-\d{2}/.exec(String(date || '').trim());
  if (!m) return null;
  const year = Number(m[1]);
  return Number.isFinite(year) && year > 0 ? year : null;
}

/**
 * L'epoca di un anno, con le soglie del motore.
 * Sotto la prima soglia è `pre_industriale`; `null` se l'anno è ignoto.
 */
export function epochForYear(year: number | null): WorldEpoch | null {
  if (year === null) return null;
  let epoch: WorldEpoch = 'pre_industriale';
  for (const boundary of WORLD_EPOCH_BOUNDARIES) {
    if (year >= boundary.from) epoch = boundary.epoch;
  }
  return epoch;
}

/** Anno ed epoca da una data del mondo. Pura: stessi ingressi, stesso esito. */
export function worldEpoch(date?: string | null): WorldEpochView {
  const year = yearOfDate(date);
  const epoch = epochForYear(year);
  return {
    year,
    epoch,
    epochLabel: epoch ? WORLD_EPOCH_LABEL[epoch] : null,
  };
}
