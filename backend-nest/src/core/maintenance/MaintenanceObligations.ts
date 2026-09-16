/**
 * M07 passo 2 — obblighi di manutenzione degli impianti (proiezione pura).
 * ======================================================================
 * Il catalogo dichiara i termini di manutenzione per tipo di impianto
 * (`FacilityType.maintenance`: resourceId/baseUnits/periodDays) e gli impianti
 * posseduti (`FacilityInstance`). Questo modulo **proietta** l'obbligo di un
 * periodo e verifica se lo stock posseduto dagli attori della polity basta,
 * ordinando per deficit (priorità per la decisione del giocatore).
 *
 * NON muta nulla e NON inventa dati: usa soltanto (a) i termini dichiarati dal
 * catalogo e (b) i saldi posseduti ricostruiti dal ledger (`ownerRef`). Non
 * esiste ancora un runtime impianti (scadenzario/esecuzione): l'esecuzione
 * resta fuori perimetro.
 */
import { intToString, parseInteger, type IntString } from '../../domain/quantities';
import type { FacilityInstance, FacilityType } from '../../scenario/types';

export interface MaintenanceObligation {
  readonly facilityId: string;
  readonly typeId: string;
  readonly typeName: string;
  readonly regionId: string;
  readonly operational: boolean;
  readonly resourceId: string;
  readonly baseUnits: IntString;
  readonly periodDays: number;
  /** Stock posseduto dagli attori della polity per la risorsa richiesta. */
  readonly available: IntString;
  readonly sufficient: boolean;
  readonly shortfall: IntString;
}

export interface MaintenanceObligationsInput {
  readonly facilities: readonly FacilityInstance[];
  readonly facilityTypes: readonly FacilityType[];
  /** Attori (owner) della polity giocante. */
  readonly ownerActorIds: ReadonlySet<string>;
  readonly ownedStock: readonly { readonly owner: string; readonly resourceId: string; readonly quantity: IntString }[];
}

function ownedQuantity(
  ownedStock: MaintenanceObligationsInput['ownedStock'],
  ownerActorIds: ReadonlySet<string>,
  resourceId: string,
): bigint {
  let total = 0n;
  for (const item of ownedStock) {
    if (ownerActorIds.has(item.owner) && item.resourceId === resourceId) {
      total += parseInteger(item.quantity, 'maintenance.ownedStock');
    }
  }
  return total;
}

/** Obblighi per impianto posseduto, ordinati per deficit decrescente (poi per id). */
export function assessMaintenanceObligations(input: MaintenanceObligationsInput): readonly MaintenanceObligation[] {
  const types = new Map(input.facilityTypes.map(type => [type.id, type]));
  const obligations: MaintenanceObligation[] = [];
  for (const facility of input.facilities) {
    if (!input.ownerActorIds.has(facility.ownerActorId)) continue;
    const type = types.get(facility.typeId);
    const maintenance = type?.maintenance;
    if (!type || !maintenance) continue;
    const required = parseInteger(maintenance.baseUnits, 'maintenance.baseUnits');
    if (required <= 0n) continue;
    const available = ownedQuantity(input.ownedStock, input.ownerActorIds, maintenance.resourceId);
    const shortfall = required > available ? required - available : 0n;
    obligations.push({
      facilityId: facility.id,
      typeId: facility.typeId,
      typeName: type.name,
      regionId: facility.regionId,
      operational: facility.operational,
      resourceId: maintenance.resourceId,
      baseUnits: maintenance.baseUnits,
      periodDays: maintenance.periodDays,
      available: intToString(available),
      sufficient: shortfall === 0n,
      shortfall: intToString(shortfall),
    });
  }
  return obligations.sort((a, b) => {
    const deficit = parseInteger(b.shortfall, 'shortfall') - parseInteger(a.shortfall, 'shortfall');
    if (deficit !== 0n) return deficit > 0n ? 1 : -1;
    return a.facilityId.localeCompare(b.facilityId);
  });
}
