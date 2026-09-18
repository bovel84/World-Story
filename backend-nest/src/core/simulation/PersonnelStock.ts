/**
 * World Story — OP-OBJECTS PERSISTENT: personale militare come **stock**
 * ======================================================================
 * `MilitaryDoctrine` dà la **capacità** (bacino, tetto di richiamo, uomini per
 * reparto). Qui c'è lo **stato di partita**: quanti uomini sono sotto le armi,
 * quanti in riserva, quanti richiamati, quanti imbarcati.
 *
 * Modulo puro e senza dipendenze da `OperationalObjects`, così sia il quadro
 * operativo sia il piano di formazione usano **la stessa aritmetica**: la
 * riserva si consuma, non si ricalcola.
 */
import type { MilitaryManpower } from './MilitaryDoctrine';

const nonNegative = (value: unknown): number => {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? number : 0;
};

/**
 * Personale militare come stock: `activePersonnel` (terra) · `trainedReserve`
 * (riserva disponibile) · `mobilizedPersonnel` (richiamati, parte della riserva) ·
 * `shipCrew` (equipaggi navali).
 */
export interface MilitaryPersonnelState {
  activePersonnel: number;
  trainedReserve: number;
  mobilizedPersonnel: number;
  shipCrew: number;
  updatedDate: string;
}

/** Uomini sotto le armi di terra + equipaggi navali. */
export function personnelUnderArms(state: MilitaryPersonnelState): number {
  return nonNegative(state.activePersonnel) + nonNegative(state.shipCrew);
}

/**
 * Stato di partita con la **forma** della dottrina: il bacino e il tetto restano
 * quelli d'epoca, gli uomini sono quelli registrati. La riserva non cresce da
 * sola: può solo essere limitata dal bacino.
 */
export function personnelOverlay(state: MilitaryPersonnelState, doctrine: MilitaryManpower): MilitaryManpower {
  const land = nonNegative(state.activePersonnel);
  const shipCrew = nonNegative(state.shipCrew);
  const underArms = land + shipCrew;
  const requestedReserve = nonNegative(state.trainedReserve);
  const reservePersonnel = Math.min(requestedReserve, Math.max(0, doctrine.totalMilitaryPool - land));
  const mobilizedPersonnel = Math.min(nonNegative(state.mobilizedPersonnel), reservePersonnel);
  return {
    ...doctrine,
    activePersonnel: underArms,
    reservePersonnel,
    mobilizedPersonnel,
    availableReserve: Math.max(0, reservePersonnel - mobilizedPersonnel),
  };
}

/** Riserva **disponibile** (stock meno richiamati). */
export function availableReserveOf(state: MilitaryPersonnelState, doctrine: MilitaryManpower): number {
  return personnelOverlay(state, doctrine).availableReserve;
}

/** Invariante: nessuno stock di uomini oltre il bacino d'epoca. */
export function personnelInvariant(state: MilitaryPersonnelState, doctrine: MilitaryManpower): boolean {
  const underArms = personnelUnderArms(state);
  const reserve = nonNegative(state.trainedReserve);
  return underArms + reserve <= doctrine.totalMilitaryPool + 1e-6
    && reserve >= nonNegative(state.mobilizedPersonnel);
}

/**
 * Trasferisce uomini dalla **riserva disponibile** ai reparti. `null` quando la
 * riserva non basta: la creazione è rifiutata, non compensata a debito di uomini.
 */
export function transferMenToArmy(
  state: MilitaryPersonnelState,
  men: number,
  doctrine: MilitaryManpower,
): MilitaryPersonnelState | null {
  const wanted = Math.round(nonNegative(men));
  const available = availableReserveOf(state, doctrine);
  if (wanted <= 0 || wanted > available) return null;
  return {
    ...state,
    activePersonnel: Math.round(nonNegative(state.activePersonnel) + wanted),
    trainedReserve: Math.round(nonNegative(state.trainedReserve) - wanted),
  };
}

/** Imbarco di un equipaggio: gli uomini escono dalla riserva, non dal nulla. */
export function transferCrewToShip(
  state: MilitaryPersonnelState,
  crew: number,
  doctrine: MilitaryManpower,
): MilitaryPersonnelState | null {
  const wanted = Math.round(nonNegative(crew));
  if (wanted <= 0) return { ...state };
  const available = availableReserveOf(state, doctrine);
  if (wanted > available) return null;
  return {
    ...state,
    trainedReserve: Math.round(nonNegative(state.trainedReserve) - wanted),
    shipCrew: Math.round(nonNegative(state.shipCrew) + wanted),
  };
}

/** Sbarco: gli equipaggi tornano nella riserva addestrata. */
export function transferCrewFromShip(
  state: MilitaryPersonnelState,
  crew: number,
): MilitaryPersonnelState {
  const wanted = Math.min(Math.round(nonNegative(crew)), Math.round(nonNegative(state.shipCrew)));
  return {
    ...state,
    trainedReserve: Math.round(nonNegative(state.trainedReserve) + wanted),
    shipCrew: Math.round(nonNegative(state.shipCrew) - wanted),
  };
}
