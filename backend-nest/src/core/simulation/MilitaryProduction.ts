import { equipmentById, type Domain, type Equipment } from './MilitaryIndustry';

/**
 * Produzione militare con percentuale di completamento.
 *
 * Costruire non è istantaneo: ogni ordine avanza di una percentuale a turno, in
 * base a infrastrutture, tecnologie e complessità della voce. Il rischio è
 * **deterministico ma non garantito**: un imprevisto può far arretrare il
 * lavoro, introdurre difetti o far fallire il lotto. Nulla è casuale nel senso
 * di non riproducibile: il tiro dipende da gioco+ordine+turno, quindi lo stesso
 * turno dà sempre lo stesso esito. L'acquisto all'estero resta immediato.
 */

export const DOMAIN_MONTHS: Record<Domain, number> = {
  terra: 3, aria: 5, mare: 6, missili: 6, droni: 3,
};

export interface ProductionOrder {
  id: string;
  equipmentId: string;
  name: string;
  domain: Domain;
  quantity: number;
  /** Percentuale di completamento (0-100). */
  progress: number;
  /** Costo già pagato (cassa + debito), in milioni USD. */
  spentMln: number;
  startedTurn: number;
  startedDate: string;
  status: 'in_progress' | 'completed' | 'failed';
  note: string;
  /** Percentuale cumulata di unità difettose (0-40). */
  qualityLoss: number;
  updatedDate: string;
  /** Data di consegna prevista, ricalcolata dal ritmo reale della linea. */
  expectedDate?: string | null;
  /**
   * OP-OBJECTS PERSISTENT: impianto **reale** a cui l'ordine è assegnato (non
   * più una rotazione decisa a ogni lettura). `null`/assente ⇒ partita legacy.
   */
  facilityId?: string | null;
}

export interface ProductionContext {
  factories: number;
  ports: number;
  universities: number;
  stability: number;
  socialTension: number;
  technologies: string[];
}

/**
 * Numero deterministico in [0,1) da una stringa (FNV-1a + finalizzazione).
 * Serve per gli imprevisti: riproducibile e verificabile, mai `Math.random`.
 */
export function stableRoll(seed: string): number {
  let hash = 2166136261;
  for (let index = 0; index < seed.length; index += 1) {
    hash ^= seed.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  hash ^= hash >>> 13;
  hash = Math.imul(hash, 0x5bd1e995);
  hash ^= hash >>> 15;
  return (hash >>> 0) / 4294967296;
}

/** Avanzamento mensile in punti percentuali per una voce del catalogo. */
export function productionRate(equipment: Equipment, context: ProductionContext): number {
  const baseMonths = DOMAIN_MONTHS[equipment.domain] || 4;
  const tierSlow = 1
    + (equipment.tier === 'nuova_generazione' ? 0.6 : equipment.tier === 'avanzato' ? 0.35 : equipment.tier === 'moderno' ? 0.15 : 0);
  const infra = 1 + context.factories * 0.03 + context.universities * 0.03 + context.ports * 0.01;
  const techBonus = context.technologies.includes('intelligenza_artificiale') ? 0.2 : 0;
  const months = (baseMonths * tierSlow) / (infra * (1 + techBonus));
  return Math.max(1.5, 100 / Math.max(0.6, months));
}

/** Rischio mensile di imprevisto: instabilità, tensione, complessità, tecnologie. */
export function setbackChance(context: ProductionContext, equipment: Equipment): number {
  const instability = Math.max(0, 60 - context.stability) / 300;
  const tension = Math.max(0, context.socialTension - 30) / 500;
  const complexity = equipment.tier === 'nuova_generazione' ? 0.06 : equipment.tier === 'avanzato' ? 0.04 : 0.02;
  const techReady = (equipment.requires?.techs || []).every(tech => context.technologies.includes(tech)) ? 0 : 0.1;
  return Math.min(0.6, 0.06 + instability + tension + complexity + techReady);
}

export interface OrderAdvance {
  order: ProductionOrder;
  completed: boolean;
  failed: boolean;
  /** Unità consegnate (solo a completamento). */
  delivered: number;
  setbackPct: number;
}

/**
 * Avanza un ordine di `months` mesi. Ritorna il nuovo ordine e l'esito. Non
 * muta l'input: la persistenza è responsabilità del chiamante.
 */
export function advanceOrder(
  order: ProductionOrder, context: ProductionContext, months: number, seed: string,
): OrderAdvance {
  if (order.status !== 'in_progress') return { order, completed: false, failed: false, delivered: 0, setbackPct: 0 };
  const equipment = equipmentById(order.equipmentId);
  const period = Math.max(0, months);
  // Zero mesi di lavorazione = nessun avanzamento e **nessun imprevisto**: un
  // ordine fermo (industria bloccata, fattore 0) non può arretrare né fallire,
  // perché non è passato tempo di officina.
  if (period <= 0) return { order, completed: false, failed: false, delivered: 0, setbackPct: 0 };
  if (!equipment) {
    return {
      order: { ...order, status: 'failed', note: 'voce di catalogo non più disponibile' },
      completed: false, failed: true, delivered: 0, setbackPct: 0,
    };
  }
  let progress = order.progress + productionRate(equipment, context) * period;
  let qualityLoss = order.qualityLoss;
  let note = order.note;
  let setbackPct = 0;
  let failed = false;

  const chance = Math.min(0.9, setbackChance(context, equipment) * Math.max(1, period));
  const roll = stableRoll(seed);
  if (roll < chance) {
    setbackPct = 6 + Math.round(stableRoll(`${seed}:amount`) * 24);
    progress = Math.max(0, progress - setbackPct);
    qualityLoss = Math.min(40, qualityLoss + setbackPct * 0.15);
    note = `imprevisto: −${setbackPct}% (linea rallentata, rischio ${Math.round(chance * 100)}%)`;
    const catastrophic = roll < chance * 0.25 && stableRoll(`${seed}:fail`) < 0.5;
    if (catastrophic) {
      failed = true;
      note = 'produzione fallita: lotti difettosi, linea ferma';
    }
  } else {
    note = '';
  }

  if (!failed && progress >= 100) {
    const delivered = Math.max(0, Math.round(order.quantity * (1 - qualityLoss / 100)));
    return {
      order: {
        ...order, progress: 100, status: 'completed', qualityLoss,
        note: qualityLoss > 0 ? `consegnate ${delivered}/${order.quantity} unità (${Math.round(qualityLoss)}% difettose)` : '',
      },
      completed: true, failed: false, delivered, setbackPct,
    };
  }
  return {
    order: {
      ...order, progress: Math.min(100, progress),
      status: failed ? 'failed' : 'in_progress', qualityLoss, note,
    },
    completed: false, failed, delivered: 0, setbackPct,
  };
}

/**
 * Percentuale di completamento di un progetto dalle sue date. Deterministica e
 * onesta: senza scadenza si resta su una stima prudente. Sotto la scadenza non
 * si mostra mai 100% (il progetto non è chiuso); quando la scadenza dichiarata
 * è raggiunta o superata, il progetto è completato: 100%.
 */
export function projectProgress(startedDate?: string | null, expectedDate?: string | null, now?: string): number {
  if (!startedDate) return 0;
  const start = Date.parse(`${startedDate}T00:00:00Z`);
  if (!Number.isFinite(start)) return 0;
  const end = expectedDate ? Date.parse(`${expectedDate}T00:00:00Z`) : NaN;
  const current = now ? Date.parse(`${now}T00:00:00Z`) : Date.now();
  if (!Number.isFinite(end) || end <= start) return 35;
  const ratio = (current - start) / (end - start);
  if (ratio >= 1) return 100;
  return Math.max(0, Math.min(99, Math.round(ratio * 100)));
}
