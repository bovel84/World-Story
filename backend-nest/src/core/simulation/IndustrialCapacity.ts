/**
 * World Story — Capacità industriale (modello autorevole)
 * ======================================================
 * La «capacità industriale» di una nazione era, nel Dossier, una convenzione
 * della UI: *un ordine = una linea occupata*. Non era né vera né falsa: era
 * un'invenzione di presentazione. Qui diventa **una regola del motore**,
 * deterministica e leggibile, che risponde a tre domande:
 *
 *   1. **Quanta capacità produttiva ha la nazione?** — deriva dagli impianti
 *      che il motore già conta (`factories`, `ports`, `universities`):
 *      ogni fabbrica vale delle linee di produzione, i porti cantieri e
 *      banchine, gli atenei progettazione applicata.
 *   2. **Chi la occupa?** — tre tipi di lavorazione che il motore conosce:
 *      **ordini di produzione militare** (domanda dalle `requires` della voce di
 *      catalogo, non «1 a testa»), **progetti in corso** (domanda dai mesi di
 *      lavoro che restano) e **manutenzione degli impianti** (domanda dai
 *      termini dichiarati dal catalogo).
 *   3. **Che cosa succede se la domanda supera la capacità?** — la capacità
 *      occupata non può superare il totale e la lavorazione **rallenta** in
 *      proporzione (`overflowFactor`): nessun lavoro si perde, nessun ordine
 *      viene rifiutato a sorpresa, ma il tempo di consegna dice la verità. Se
 *      invece non esiste **nessuna** capacità e c'è lavoro da fare, la
 *      produzione è **bloccata** (`blocked`, fattore 0): non si avanza di un
 *      punto, perché non c'è nessuna linea che lavora.
 *
 * Tutto puro e deterministico: stessi ingressi ⇒ stessi numeri. Nessuna
 * lettura di database, nessun LLM, nessun `Math.random`.
 */

import { daysBetween } from './calendar';
import { equipmentById, type Equipment } from './MilitaryIndustry';

/** Linee di lavorazione della produzione militare. */
export const CAPACITY_PER_FACTORY = 10;
/** Cantieri, banchine e capacità di movimentazione dei porti. */
export const CAPACITY_PER_PORT = 4;
/** Progettazione, prove e officine degli atenei. */
export const CAPACITY_PER_UNIVERSITY = 2;

/** Complessità produttiva per dominio: un caccia non è un fucile. */
export const DOMAIN_CAPACITY_BONUS: Record<string, number> = {
  terra: 0,
  droni: 2,
  aria: 4,
  missili: 4,
  mare: 8,
};

/** Tetto per singola lavorazione: nessun ordine può occupare tutto l'impianto. */
export const MAX_ALLOCATION_PER_ITEM = 40;

/**
 * Oltre il lotto di riferimento, la domanda cresce in modo **sub-lineare**
 * (logaritmico): cento carri non occupano cento volte una linea, ma nemmeno
 * quanto un carro solo. Il fattore vale 1 fino al lotto di riferimento.
 */
export const MAX_QUANTITY_FACTOR = 5;

/**
 * Dimensione del **lotto di riferimento** per categoria: quante unità «stanno»
 * in una linea di lavorazione. Un fucile si produce in massa (lotti grandi), un
 * caccia quasi uno per volta (lotti piccolissimi). È una convenzione dichiarata,
 * non un prezzo: viene dalla natura del mezzo, non dal suo costo di gioco.
 */
export const REFERENCE_BATCH_BY_CATEGORY: Record<string, number> = {
  Fanteria: 1000,
  Corazzati: 50,
  Artiglieria: 100,
  'Difesa aerea': 50,
};

/** Lotto di riferimento per dominio, quando la categoria non ne dichiara uno. */
export const REFERENCE_BATCH_BY_DOMAIN: Record<string, number> = {
  terra: 200,
  aria: 10,
  mare: 2,
  missili: 20,
  droni: 100,
};

export type IndustrialAllocationKind = 'military_production' | 'project' | 'maintenance';

export const INDUSTRIAL_KIND_LABEL: Record<IndustrialAllocationKind, string> = {
  military_production: 'Produzione militare',
  project: 'Progetti in corso',
  maintenance: 'Manutenzione impianti',
};

export interface IndustrialAllocation {
  /** Identificativo della lavorazione (id dell'ordine, del progetto o dell'impianto). */
  id: string;
  kind: IndustrialAllocationKind;
  label: string;
  /** Linee di lavorazione richieste. */
  capacityDemand: number;
  /** Reparto/settore a cui la lavorazione appartiene, per la lettura per settore. */
  sector: string;
  /** Da dove viene la domanda: leggibile nel Dossier. */
  basis: string;
}

export interface IndustrialCapacity {
  /** Linee di lavorazione disponibili. */
  total: number;
  /** Linee occupate (mai superiore al totale). */
  used: number;
  /** Linee libere. */
  free: number;
  utilizationPct: number;
  /** Domanda complessiva prima del tetto: se supera `total`, l'industria è satura. */
  demand: number;
  /** Quanto della domanda viene effettivamente servito (`used / demand`). */
  satisfactionPct: number;
  /** Fattore di rallentamento da applicare al tempo di lavorazione (1 = nessuno). */
  overflowFactor: number;
  saturated: boolean;
  /**
   * Non c'è **nessuna** capacità e c'è lavoro da fare: la produzione è
   * **bloccata** (fattore 0), non «rallentata al 25%». Le consegne restano
   * ferme finché la nazione non costruisce impianti.
   */
  blocked: boolean;
  allocations: IndustrialAllocation[];
  byKind: Record<IndustrialAllocationKind, number>;
  /** Quota della capacità occupata dalla produzione militare. */
  defenceSharePct: number;
  /** Da dove nasce il totale: leggibile nel Dossier. */
  totalBasis: string;
}

export interface IndustrialOrderInput {
  id: string;
  equipmentId: string;
  name?: string;
  quantity?: number;
  status?: string;
}

export interface IndustrialProjectInput {
  id: string;
  title?: string;
  started_date?: string | null;
  expected_date?: string | null;
  progress?: number;
}

export interface IndustrialMaintenanceInput {
  facilityId: string;
  typeName?: string;
  /** Unità dichiarate dal catalogo (`FacilityType.maintenance.baseUnits`). */
  baseUnits: string | number;
  /** Periodicità dichiarata dal catalogo, in giorni. */
  periodDays?: number;
  operational?: boolean;
}

export interface IndustrialCapacityInput {
  factories: number;
  ports: number;
  universities: number;
  orders?: readonly IndustrialOrderInput[];
  projects?: readonly IndustrialProjectInput[];
  maintenance?: readonly IndustrialMaintenanceInput[];
}

const positive = (value: unknown): number => {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? number : 0;
};
const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(max, value));
const round1 = (value: number) => Math.round(value * 10) / 10;
const integer = (value: string | number): number => {
  const number = typeof value === 'string' ? Number.parseInt(value, 10) : Number(value);
  return Number.isFinite(number) && number > 0 ? number : 0;
};

/** Linee di lavorazione disponibili, con la loro origine dichiarata. */
export function industrialCapacityTotal(input: {
  factories: number; ports: number; universities: number;
}): { total: number; basis: string } {
  const factories = positive(input.factories);
  const ports = positive(input.ports);
  const universities = positive(input.universities);
  const total = factories * CAPACITY_PER_FACTORY + ports * CAPACITY_PER_PORT + universities * CAPACITY_PER_UNIVERSITY;
  const parts: string[] = [];
  if (factories > 0) parts.push(`${factories} fabbriche × ${CAPACITY_PER_FACTORY} linee`);
  if (ports > 0) parts.push(`${ports} porti × ${CAPACITY_PER_PORT}`);
  if (universities > 0) parts.push(`${universities} atenei × ${CAPACITY_PER_UNIVERSITY}`);
  return {
    total,
    basis: parts.length > 0 ? parts.join(' · ') : 'nessun impianto censito dal motore',
  };
}

/**
 * Lotto di riferimento di una voce: la categoria vince sul dominio (un fucile
 * è massa anche se è «terra», un caccia è pochi pezzi anche se è «aria»).
 */
export function referenceBatchFor(equipment: Equipment | undefined): number {
  const category = equipment ? REFERENCE_BATCH_BY_CATEGORY[equipment.category] : undefined;
  if (category) return category;
  const domain = equipment ? REFERENCE_BATCH_BY_DOMAIN[equipment.domain] : undefined;
  return domain ?? REFERENCE_BATCH_BY_DOMAIN.terra;
}

/**
 * Fattore di domanda della quantità: vale **1 fino al lotto di riferimento** e
 * poi cresce in modo logaritmico (sub-lineare). Dieci lotti di riferimento
 * raddoppiano la domanda, non la decuplicano: nessun doppio conteggio, la
 * complessità della voce resta nel `base`.
 */
export function quantityFactor(quantity: number, referenceBatch: number): number {
  const qty = positive(quantity);
  const batch = positive(referenceBatch) || 1;
  return 1 + Math.max(0, Math.log10(qty / batch));
}

/** Tetto di una singola lavorazione: mai meno del tetto storico, mai più di
 *  `MAX_QUANTITY_FACTOR` volte la domanda base della voce. */
export function allocationCapFor(base: number): number {
  return Math.max(MAX_ALLOCATION_PER_ITEM, positive(base) * MAX_QUANTITY_FACTOR);
}

/**
 * Domanda di capacità di un ordine di produzione militare: dalle **requires**
 * della voce di catalogo (fabbriche necessarie) più la complessità del dominio,
 * cresciuta dal **lotto ordinato** in modo sub-lineare. Un carro e cento carri
 * non occupano la stessa capacità: cento pesano di più, ma non cento volte.
 */
export function militaryOrderAllocation(order: IndustrialOrderInput): IndustrialAllocation {
  const equipment = equipmentById(order.equipmentId);
  const requiredFactories = positive(equipment?.requires.factories);
  const bonus = DOMAIN_CAPACITY_BONUS[equipment?.domain || 'terra'] ?? 0;
  const base = Math.max(4, requiredFactories * 4) + bonus;
  const batch = referenceBatchFor(equipment);
  const factor = quantityFactor(order.quantity ?? 0, batch);
  const demand = clamp(Math.round(base * factor), 4, allocationCapFor(base));
  const quantityNote = factor > 1.01 && positive(order.quantity) > 0
    ? `; lotto di ${positive(order.quantity)} su un riferimento di ${batch} (domanda ×${Math.round(factor * 100) / 100})`
    : '';
  return {
    id: order.id,
    kind: 'military_production',
    label: `${order.name || equipment?.name || order.equipmentId}${order.quantity ? ` ×${order.quantity}` : ''}`,
    capacityDemand: demand,
    sector: equipment ? `${equipment.category} (${equipment.domain})` : 'militare',
    basis: requiredFactories > 0
      ? `Voce di catalogo: ${requiredFactories} ${requiredFactories === 1 ? 'fabbrica richiesta' : 'fabbriche richieste'}${bonus > 0 ? `, complessità ${equipment?.domain}` : ''}${quantityNote}.`
      : 'Voce di catalogo senza requisiti di fabbrica dichiarati.',
  };
}

/**
 * Domanda di capacità di un progetto in corso: proporzionale ai **mesi di
 * lavoro che restano**, non a quanto è già stato fatto. Un progetto al 90%
 * occupa un decimo delle linee di quando è partito.
 */
export function projectAllocation(project: IndustrialProjectInput): IndustrialAllocation {
  const months = Math.max(
    1,
    Math.round(daysBetween(project.started_date, project.expected_date) / 30),
  );
  const remaining = clamp(1 - positive(project.progress) / 100, 0, 1);
  const demand = clamp(Math.round((3 + months) * Math.max(0.1, remaining)), 1, 16);
  return {
    id: project.id,
    kind: 'project',
    label: project.title || 'Progetto in corso',
    capacityDemand: demand,
    sector: 'Infrastrutture e progetti',
    basis: `Progetto di ${months} mes${months === 1 ? 'e' : 'i'}, ${Math.round(positive(project.progress))}% completato: la domanda copre il lavoro residuo.`,
  };
}

/**
 * Domanda di capacità della manutenzione di un impianto: dai termini
 * dichiarati dal catalogo (`baseUnits` per periodo). Un impianto fermo non
 * consuma linee: la manutenzione si fa su ciò che è in esercizio.
 */
export function maintenanceAllocation(obligation: IndustrialMaintenanceInput): IndustrialAllocation | null {
  if (obligation.operational === false) return null;
  const units = integer(obligation.baseUnits);
  if (units <= 0) return null;
  const demand = clamp(Math.ceil(units / 8), 1, 12);
  const period = positive(obligation.periodDays);
  return {
    id: obligation.facilityId,
    kind: 'maintenance',
    label: obligation.typeName || obligation.facilityId,
    capacityDemand: demand,
    sector: 'Manutenzione impianti',
    basis: `Manutenzione da ${units} unità${period > 0 ? ` ogni ${period} giorni` : ''} dichiarate dal catalogo.`,
  };
}

/**
 * Quadro completo della capacità industriale: totale, occupazione reale,
 * lettura per settore e fattore di rallentamento se la domanda eccede la
 * capacità. È l'unico punto in cui questa regola vive.
 */
export function industrialCapacityOf(input: IndustrialCapacityInput): IndustrialCapacity {
  const { total, basis } = industrialCapacityTotal(input);
  const allocations: IndustrialAllocation[] = [
    ...(input.orders || [])
      .filter(order => order.status === undefined || order.status === 'in_progress')
      .map(militaryOrderAllocation),
    ...(input.projects || []).map(projectAllocation),
    ...(input.maintenance || [])
      .map(maintenanceAllocation)
      .filter((allocation): allocation is IndustrialAllocation => allocation !== null),
  ];
  const byKind: Record<IndustrialAllocationKind, number> = {
    military_production: 0, project: 0, maintenance: 0,
  };
  let demand = 0;
  for (const allocation of allocations) {
    byKind[allocation.kind] += allocation.capacityDemand;
    demand += allocation.capacityDemand;
  }
  const used = Math.min(total, demand);
  const overflow = demand > total ? total / demand : 1;
  const blocked = total === 0 && demand > 0;
  return {
    total,
    used,
    free: Math.max(0, total - used),
    utilizationPct: total > 0 ? round1(used / total * 100) : 0,
    demand,
    satisfactionPct: demand > 0 ? round1(used / demand * 100) : 100,
    // Con impianti presenti la saturazione **rallenta** senza paralizzare (mai
    // sotto un quarto del ritmo). **Senza impianti e con lavoro da fare la
    // produzione è bloccata**: fattore 0, nessun avanzamento — non «il 25% del
    // ritmo», che sarebbe una produzione inventata dal nulla.
    overflowFactor: total > 0 ? Math.max(0.25, round1(overflow * 1000) / 1000) : (blocked ? 0 : 1),
    saturated: demand > total,
    blocked,
    allocations,
    byKind,
    defenceSharePct: demand > 0 ? round1(byKind.military_production / demand * 100) : 0,
    totalBasis: basis,
  };
}
