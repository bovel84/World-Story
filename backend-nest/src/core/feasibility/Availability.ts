/**
 * MG01 µ3 — Dalla distinta al deficit misurato
 * ===========================================
 * Il preflight sa dire «questa costruzione richiede 12 kg di acciaio». Non sa
 * ancora dire **quanto ne hai**. Questo modulo è il ponte: prende la distinta di
 * un'opera e delle letture di disponibilità **già fatte da chi ha accesso al
 * ledger**, e restituisce ciò che manca — con la quantità richiesta, la
 * disponibile e la mancante, non un semaforo.
 *
 * Confini, tutti misurati sul motore attuale:
 *  - **Le unità sono due mondi.** Il catalogo dichiara `TEST`, il ledger usa
 *    `test` (`ledgerUnitId` normalizza in minuscolo). Il confronto è fra unità
 *    già canonicalizzate dal produttore delle letture, non fra le stringhe del
 *    catalogo: chiedere al catalogo la parola giusta sarebbe un secondo codec.
 *  - **I materiali stanno presso il loro proprietario.** Nel ledger bootstrap
 *    l'acciaio della fixture è di `beta_treasury`, non di `alpha_treasury`; una
 *    tesoreria non può costruire con merce che non è sua. Per questo la lettura
 *    porta con sé il `holder`: senza, si conterebbe la roba degli altri.
 *  - **La forza lavoro non esiste a runtime.** `workforce` è dichiarata da
 *    `initial-state.json` ma non è mai materializzata nel ledger: il modulo la
 *    confronta solo se una lettura la fornisce, altrimenti la dichiara ignota.
 *    Non inventa un numero di operai disponibili.
 *
 * Modulo **puro**: nessun accesso a database, nessuna mutazione, nessun LLM.
 */

import { IntString, parseInteger, intToString } from '../../domain/quantities';
import type { SimulationCatalog } from '../../scenario/types';
import type { OrderIntent } from './intent';

/** Letture di disponibilità, già fatte sul ledger del ramo dell'ordine.
 *  `unitId` è nell'unità del LEDGER (minuscola), non in quella del catalogo. */
export interface AvailabilityReadings {
  /** Saldi monetari disponibili (totale meno riserve attive). */
  readonly money: readonly { readonly holder: string; readonly unitId: string; readonly available: IntString }[];
  /** Giacenze materiali disponibili, per detentore. */
  readonly stock: readonly { readonly holder: string; readonly unitId: string; readonly available: IntString }[];
  /** Manodopera disponibile per qualifica. Assente = non nota a runtime. */
  readonly workforce?: readonly { readonly qualification: string; readonly available: IntString }[];
}

export type DeficitCode = 'INSUFFICIENT_CASH' | 'MATERIAL_SHORTAGE' | 'WORKFORCE_SHORTAGE';

/** Un requisito della distinta che non è coperto, con i tre numeri che lo spiegano. */
export interface Deficit {
  readonly code: DeficitCode;
  /** Cosa manca: valuta, risorsa o qualifica. */
  readonly id: string;
  /** Fase dell'opera che lo richiede: il deficit si spiega, non solo si conta. */
  readonly phaseId: string;
  readonly required: IntString;
  readonly available: IntString;
  readonly missing: IntString;
  /** Dove si è guardato: detentore dell'unità del ledger. */
  readonly holder: string;
}

export interface DeficitResult {
  readonly deficits: readonly Deficit[];
  /** Requisiti non verificabili con le letture fornite (forza lavoro ignota). */
  readonly unknown: readonly { readonly reason: string; readonly id: string }[];
  /**
   * WS-GOV-COUNCIL-HARDENING — la disponibilità monetaria misurata, **sempre**
   * (anche quando copre il fabbisogno, caso in cui `deficits` è vuoto). Sommata
   * per unità e per detentore, al netto delle riserve attive: è la stessa
   * disponibilità con cui `measureDeficits` giudica il deficit, quindi non può
   * contraddire `funded`. Il client la mostra nella Tavola del Tesoro invece di
   * dedurre il denaro dal conto nazionale.
   */
  readonly availableMoney?: readonly { readonly holder: string; readonly unitId: string; readonly available: string }[];
}

/** Un requisito della distinta: quanto, di cosa, e in quale fase. */
interface Requirement {
  readonly unitId: string;
  readonly amount: bigint;
  readonly phaseId: string;
  readonly id: string;
  /** Solo per la manodopera: la qualifica richiesta dalla fase. */
  readonly qualification?: string;
}

/** Requisiti di una distinta, in ordine di fase. `holder` non serve a leggerli:
 *  la distinta è la stessa chiunque paghi — ma resta nella firma perché il
 *  chiamante la passi coerentemente alle letture. */
function requirementsOf(intent: OrderIntent, catalog: SimulationCatalog): {
  money: Requirement[];
  stock: Requirement[];
  workforce: Requirement[];
} {
  const money: Requirement[] = [];
  const stock: Requirement[] = [];
  const workforce: Requirement[] = [];

  const work = catalog.works?.find(item => item.id === intent.catalogRef);
  if (!work) return { money, stock, workforce };

  for (const phase of work.phases) {
    for (const input of phase.inputs) {
      stock.push({
        // Unità del ledger: minuscola, come `ledgerUnitId`. È qui che il
        // confronto è onesto — il catalogo dice `TEST`, il ledger `test`.
        unitId: input.resourceId.toLowerCase(),
        amount: parseInteger(input.baseUnits, 'input'),
        phaseId: phase.id,
        id: input.resourceId,
      });
    }
    if (phase.funds) {
      money.push({
        unitId: phase.funds.currencyId.toLowerCase(),
        amount: parseInteger(phase.funds.minorUnits, 'funds'),
        phaseId: phase.id,
        id: phase.funds.currencyId,
      });
    }
    for (const w of phase.workforce ?? []) {
      workforce.push({
        unitId: w.qualification,
        qualification: w.qualification,
        amount: parseInteger(w.persons, 'persons'),
        phaseId: phase.id,
        id: w.qualification,
      });
    }
  }
  return { money, stock, workforce };
}

/** Somma le voci per unità; l'ordine di dichiarazione delle fasi si conserva. */
function byUnit(requirements: readonly Requirement[], key: 'unitId' | 'qualification'): Map<string, Requirement[]> {
  const grouped = new Map<string, Requirement[]>();
  for (const requirement of requirements) {
    const unit = key === 'unitId' ? requirement.unitId : (requirement.qualification ?? requirement.unitId);
    grouped.set(unit, [...(grouped.get(unit) ?? []), requirement]);
  }
  return grouped;
}

/**
 * La fase da nominare: la prima che il disponibile non riesce a coprire, con il
 * residuo che avanza. Scorrendo la distinta nell'ordine delle fasi si ottiene
 * l'attribuzione causale giusta; fermarsi alla prima scoperta e riportare lo
 * **scoperto totale dell'unità** evita la sottostima del consumo progressivo
 * fase per fase, che incolpava la fase sbagliata e riduceva il numero.
 */
function firstShortPhase(requirements: readonly Requirement[], available: bigint): string {
  let remaining = available;
  for (const requirement of requirements) {
    if (requirement.amount > remaining) return requirement.phaseId;
    remaining -= requirement.amount;
  }
  return requirements[requirements.length - 1]?.phaseId ?? '';
}

/**
 * Confronta la distinta con le letture e restituisce ciò che manca.
 *
 * **Per unità, non per fase.** Il fabbisogno di acciaio di un'opera è la somma
 * delle sue fasi: l'opera non parte se l'acciaio totale non c'è. Confrontare
 * fase per fase con un residuo che avanza darebbe un numero più piccolo del
 * vero (`mancano 2000` dove ne mancano 10000) e attribuirebbe il deficit alla
 * fase sbagliata, in dipendenza dell'ordine di dichiarazione nel catalogo.
 * Il totale per unità è anche l'aritmetica del lotto (`BatchAllocator`), che
 * aggrega per unità; il residuo progressivo per fase servirà a MG02, quando
 * sarà una prenotazione reale e non una fotografia.
 */
export function measureDeficits(
  intent: OrderIntent,
  catalog: SimulationCatalog,
  readings: AvailabilityReadings,
  holder: string,
): DeficitResult {
  const requirements = requirementsOf(intent, catalog);
  const deficits: Deficit[] = [];
  const unknown: { reason: string; id: string }[] = [];

  // Voci duplicate dello stesso detentore/unità si SOMMANO: l'ultima-che-vince
  // nasconderebbe disponibilità e produrrebbe un deficit inventato.
  const totalOf = (items: readonly { readonly holder: string; readonly unitId: string; readonly available: IntString }[], kind: 'money' | 'stock') => {
    const totals = new Map<string, bigint>();
    for (const item of items) {
      if (item.holder !== holder) continue;
      totals.set(item.unitId, (totals.get(item.unitId) ?? 0n) + parseInteger(item.available, kind));
    }
    return totals;
  };
  const availableMoney = totalOf(readings.money, 'money');
  const availableStock = totalOf(readings.stock, 'stock');

  const measure = (grouped: Map<string, Requirement[]>, available: Map<string, bigint>, code: DeficitCode) => {
    for (const [unit, group] of grouped) {
      const required = group.reduce((total, requirement) => total + requirement.amount, 0n);
      const have = available.get(unit) ?? 0n;
      if (required <= have) continue;
      deficits.push({
        code,
        id: group[0].id,
        phaseId: firstShortPhase(group, have),
        holder,
        required: intToString(required),
        available: intToString(have),
        missing: intToString(required - have),
      });
    }
  };

  measure(byUnit(requirements.money, 'unitId'), availableMoney, 'INSUFFICIENT_CASH');
  measure(byUnit(requirements.stock, 'unitId'), availableStock, 'MATERIAL_SHORTAGE');

  // WS-GOV-COUNCIL-HARDENING — la disponibilità monetaria netta, per unità del
  // ledger, così la Tavola del Tesoro ha il "disponibile" anche quando l'opera
  // è coperta (nessun deficit da cui ricavarlo). È la stessa mappa usata sopra.
  const availableMoneyList = [...availableMoney.entries()].map(([unitId, available]) => ({
    holder,
    unitId,
    available: intToString(available),
  }));

  // La manodopera è CAPACITÀ, non consumo: le fasi sono sequenziali nel tempo e
  // gli stessi operai tornano il giorno dopo. Per questo ogni fase è confrontata
  // con il bacino, non con un residuo (vedi il commento su `measure`).
  if (requirements.workforce.length > 0) {
    // `workforce` ASSENTE e `workforce` VUOTO dicono la stessa cosa — «non ho
    // letture sulla manodopera» — e devono dare lo stesso esito. Trattare
    // l'array vuoto come «zero operai» bloccherebbe l'opera e farebbe sparire
    // l'avviso: un blocco inventato al posto di un'ignoranza dichiarata.
    if (!readings.workforce || readings.workforce.length === 0) {
      for (const qualification of new Set(requirements.workforce.map(r => r.qualification ?? r.id))) {
        unknown.push({ reason: 'manodopera non disponibile a runtime: nessuna lettura fornita', id: qualification });
      }
    } else {
      const availableWork = totalOf(readings.workforce.map(w => ({ holder, unitId: w.qualification, available: w.available })), 'stock');
      for (const [qualification, group] of byUnit(requirements.workforce, 'qualification')) {
        const have = availableWork.get(qualification);
        if (have === undefined) {
          // La qualifica non compare nella lettura: è un'ignoranza, non una
          // carenza. Una qualifica assente non è una qualifica a zero.
          unknown.push({ reason: 'qualifica non presente nelle letture di manodopera', id: qualification });
          continue;
        }
        // La fase più esigente è quella che decide: se il bacino non copre la
        // fase che chiede di più, l'opera si ferma lì.
        const peak = group.reduce((max, requirement) => (requirement.amount > max.amount ? requirement : max), group[0]);
        if (peak.amount > have) {
          deficits.push({
            code: 'WORKFORCE_SHORTAGE', id: qualification, phaseId: peak.phaseId, holder,
            required: intToString(peak.amount), available: intToString(have), missing: intToString(peak.amount - have),
          });
        }
      }
    }
  }

  return { deficits, unknown, ...(availableMoneyList.length > 0 ? { availableMoney: availableMoneyList } : {}) };
}
