/**
 * MILITARY P6 — tempo del trasferimento strategico.
 *
 * La geografia resta di `friendlyRegionPath`; questo modulo aggiunge soltanto
 * una durata pura e deterministica alle tratte già calcolate.
 */

/** Marcia appiedata: un mese canonico per attraversare una provincia. */
export const FOOT_MOVEMENT_DAYS_PER_HOP = 30;
/** La motorizzazione dimezza il tempo di marcia. */
export const MOTORIZATION_TIME_FACTOR = 0.5;
/** La logistica avanzata riduce ancora il tempo del 25%. */
export const ADVANCED_LOGISTICS_TIME_FACTOR = 0.75;

export interface MovementDurationInput {
  hops: number;
  motorized: boolean;
  advancedLogistics: boolean;
}

/** Giorni interi per tratta; l'arrotondamento avviene una sola volta qui. */
export function movementDaysPerHop(input: Pick<MovementDurationInput, 'motorized' | 'advancedLogistics'>): number {
  const motorization = input.motorized ? MOTORIZATION_TIME_FACTOR : 1;
  // `logistica_avanzata` è un fattore ulteriore della colonna motorizzata:
  // senza mezzi il reparto resta appiedato a 30 giorni/tratta.
  const logistics = input.motorized && input.advancedLogistics ? ADVANCED_LOGISTICS_TIME_FACTOR : 1;
  return Math.max(1, Math.ceil(FOOT_MOVEMENT_DAYS_PER_HOP * motorization * logistics));
}

/** Durata totale prevista sul percorso reale, espressa in giorni canonici. */
export function movementDuration(input: MovementDurationInput): {
  hops: number;
  daysPerHop: number;
  totalDays: number;
} {
  const hops = Math.max(0, Math.floor(Number(input.hops) || 0));
  const daysPerHop = movementDaysPerHop(input);
  return { hops, daysPerHop, totalDays: hops * daysPerHop };
}
