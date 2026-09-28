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

export type EstimateBasis = 'recipe' | 'work' | 'upkeep' | 'request' | 'none';

export interface CostEstimate {
  /** Durata autorevole del ciclo (ricetta) o della costruzione (opera), se dichiarata. */
  readonly timeDays: number;
  /** Consumi materiali stimati per un ciclo (scalati alla quantità richiesta). */
  readonly inputs: readonly CostLine[];
  /** Costo di mantenimento dichiarato per l'impianto (construct/maintain). */
  readonly upkeep: readonly { readonly line: CostLine; readonly periodDays: number }[];
  /** Su cosa si fonda la stima: ricetta, opera, mantenimento, richiesta esplicita. */
  readonly basis: EstimateBasis;
  /** Fondi dichiarati dalla distinta, se la stima è di costruzione. */
  readonly funds?: readonly { readonly currencyId: string; readonly minorUnits: string }[];
  /** Manodopera dichiarata dalla distinta, se la stima è di costruzione. */
  readonly workforce?: readonly { readonly qualification: string; readonly persons: string }[];
  /** Fasi della distinta di costruzione, con la loro durata minima. */
  readonly phases?: readonly {
    readonly id: string;
    readonly name: string;
    readonly minDays: number;
    readonly workload: string;
    readonly inputs: readonly CostLine[];
  }[];
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

  // Costruzione: la fonte autorevole è la DISTINTA DELL'OPERA (`works.json`).
  // Senza di essa non si stima la costruzione: si ricade sul solo mantenimento
  // del tipo d'impianto (`basis: 'upkeep'`, `timeDays: 0`) o su `basis: 'none'`
  // quando nemmeno il tipo è noto. In entrambi i casi tempo e materiali sono
  // ignoti, e la valutazione deve trattarli come dato mancante — mai come zero.
  if (kind === 'construct') {
    const work = catalog.works?.find(item => item.id === intent.catalogRef);
    if (work) {
      const inputs = work.phases.flatMap(phase => phase.inputs.map(q => lineFor(catalog, q.resourceId, q.baseUnits)));
      const funds = work.phases
        .filter(phase => phase.funds)
        .map(phase => ({ currencyId: phase.funds!.currencyId, minorUnits: phase.funds!.minorUnits }));
      const workforce = work.phases.flatMap(phase => (phase.workforce ?? []).map(w => ({
        qualification: w.qualification,
        persons: w.persons,
      })));
      return {
        // La durata dell'opera è la somma delle fasi: è la sola durata
        // autorevole, quella che il piano di progetto usa come `minDays`.
        timeDays: work.phases.reduce((total, phase) => total + phase.minDays, 0),
        inputs,
        upkeep: work.maintenance
          ? [{ line: lineFor(catalog, work.maintenance.resourceId, work.maintenance.baseUnits), periodDays: work.maintenance.periodDays }]
          : [],
        basis: 'work',
        funds,
        workforce,
        phases: work.phases.map(phase => ({
          id: phase.id,
          name: phase.name,
          minDays: phase.minDays,
          workload: phase.workload,
          inputs: phase.inputs.map(q => lineFor(catalog, q.resourceId, q.baseUnits)),
        })),
      };
    }

    // Ripiego legacy: il `catalogRef` nomina un tipo d'impianto e il catalogo
    // non dichiara alcuna distinta. Si espone il solo mantenimento, con
    // `basis: 'upkeep'` e `timeDays: 0`: è un dato PARZIALE, non un costo.
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