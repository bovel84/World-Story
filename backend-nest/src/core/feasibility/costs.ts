/** G4-D — stima costi da catalogo per la verifica fattibilità (sola lettura).
 *  Nessuna mutazione: proietta su input materiali e durata autorevole ciò che
 *  il catalogo dichiara per l'intent normalizzato. Nessuna inventiva: ciò che
 *  il catalogo non dichiara non viene stimato (estimateBasis 'none'). */
import { SimulationCatalog } from '../../scenario/types';
import { OrderIntent } from './intent';

export interface CostLine {
  readonly resourceId: string;
  readonly name: string;
  readonly quantity: string;
  readonly unit: string;
}

export type EstimateBasis = 'recipe' | 'upkeep' | 'request' | 'none';

export interface CostEstimate {
  /** Durata autorevole del ciclo (ricetta), se dichiarata. */
  readonly timeDays: number;
  /** Consumi materiali stimati per un ciclo (scalati alla quantità richiesta). */
  readonly inputs: readonly CostLine[];
  /** Costo di mantenimento dichiarato per l'impianto (construct/maintain). */
  readonly upkeep: readonly { readonly line: CostLine; readonly periodDays: number }[];
  /** Su cosa si fonda la stima: ricetta, mantenimento, richiesta esplicita. */
  readonly basis: EstimateBasis;
}

const EMPTY: CostEstimate = { timeDays: 0, inputs: [], upkeep: [], basis: 'none' };

function lineFor(catalog: SimulationCatalog, resourceId: string, baseUnits: string): CostLine {
  const resource = catalog.resources.find(item => item.id === resourceId);
  return {
    resourceId,
    name: resource?.name ?? resourceId,
    quantity: baseUnits,
    unit: resource?.unit.symbol ?? '',
  };
}

/** Scala gli input di una ricetta al livello di output richiesto, se
 *  la quantità richiesta corrisponde alla risorsa prodotta dalla ricetta. */
function scaleFactor(
  intent: OrderIntent,
  outputResourceId: string | undefined,
  outputBaseUnits: bigint,
): bigint {
  if (!intent.quantity || !outputResourceId || outputBaseUnits <= 0n) return 1n;
  if (intent.quantity.resourceId !== outputResourceId) return 1n;
  try {
    const requested = BigInt(intent.quantity.baseUnits);
    if (requested <= 0n) return 1n;
    // Fattore = richiesto / ciclo: ceil per non sottostimare i consumi.
    const factor = requested / outputBaseUnits;
    return requested % outputBaseUnits === 0n ? factor : factor + 1n;
  } catch {
    return 1n;
  }
}

/** Stima i costi di un intent dal catalogo. Nessuna ricerca LLM: dati autorevoli soltanto. */
export function estimateIntentCosts(catalog: SimulationCatalog, intent: OrderIntent): CostEstimate {
  const kind = intent.actionKind;

  // Ricette: produce, train, maintain possono riferire una ricetta.
  if (kind === 'produce' || kind === 'train' || kind === 'maintain') {
    const recipe = catalog.recipes.find(item => item.id === intent.catalogRef);
    if (!recipe) return EMPTY;
    const output = recipe.outputs[0];
    const factor = scaleFactor(intent, output?.resourceId, BigInt(output?.baseUnits ?? '1'));
    return {
      timeDays: recipe.durationDays,
      inputs: recipe.inputs.map(input => lineFor(catalog, input.resourceId, (BigInt(input.baseUnits) * factor).toString())),
      upkeep: [],
      basis: 'recipe',
    };
  }

  // Costruzione: catalogRef = facilityType; costo noto = mantenimento dichiarato.
  if (kind === 'construct') {
    const facilityType = catalog.facilityTypes.find(item => item.id === intent.catalogRef);
    if (!facilityType) return EMPTY;
    if (!facilityType.maintenance) {
      return { timeDays: 0, inputs: [], upkeep: [], basis: 'upkeep' };
    }
    const maintenance = facilityType.maintenance;
    return {
      timeDays: 0, // tempo di costruzione non autorevolato dal catalogo
      inputs: [],
      upkeep: [{
        line: lineFor(catalog, maintenance.resourceId, maintenance.baseUnits),
        periodDays: maintenance.periodDays,
      }],
      basis: 'upkeep',
    };
  }

  // Acquisto e spostamento: la richiesta esplicita è il consumo da sostenere.
  if ((kind === 'procure' || kind === 'move') && intent.quantity) {
    return {
      timeDays: 0,
      inputs: [lineFor(catalog, intent.quantity.resourceId, intent.quantity.baseUnits)],
      upkeep: [],
      basis: 'request',
    };
  }

  // Policy, ricerca, qualità, diplomatico, annullamento: nessun consumo
  // materiale dichiarato dal catalogo per questi tipi d'ordine.
  return EMPTY;
}