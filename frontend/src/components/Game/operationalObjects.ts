/**
 * World Story — OP-OBJECTS: read model della sala di governo
 * ==========================================================
 * Il motore pubblica **oggetti concreti** (armata, impianto, cantiere, nave,
 * miniera) con la grammatica universale
 * `STATO · CAPACITÀ · PERSONALE · INPUT · OUTPUT · COSTI · AUTONOMIA · PROBLEMI`.
 * Qui si **formatta e si raggruppa**: nessuna regola economica o militare, nessun
 * numero ricalcolato. Se un dato non c'è, la riga non compare.
 *
 * Riduzione del testo: ogni fatto è una coppia `etichetta · valore` con l'unità;
 * le spiegazioni lunghe (`why`, `summary`) restano separate e finiscono sotto
 * «Perché?» — la vista principale è numeri, non paragrafi.
 */
import type {
  FormationImpactPayload, OperatingActionPayload, OperatingChainPayload, OperatingFactPayload,
  OperatingFactSection, OperatingFactUnit, OperatingObjectPayload, OperatingPicturePayload,
  UnitActionImpactPayload, UnitOrderImpactPayload,
} from '../../services/api';
import { formatDate, formatMoney, formatNumber } from '../../utils/format';

export type ObjectTone = 'positive' | 'warning' | 'critical' | 'neutral';

/** Ordine fisso delle sezioni: la stessa grammatica per ogni oggetto. */
export const SECTION_ORDER: OperatingFactSection[] = [
  'stato', 'capacita', 'personale', 'input', 'output', 'costi', 'autonomia',
];

export const SECTION_LABEL: Record<OperatingFactSection, string> = {
  stato: 'Stato',
  capacita: 'Capacità',
  personale: 'Personale',
  input: 'Input',
  output: 'Output',
  costi: 'Costi',
  autonomia: 'Autonomia',
};

/** Etichetta breve dell'oggetto, per le liste. */
export const KIND_LABEL: Record<string, string> = {
  force: 'Forze armate',
  army: 'Armata',
  unit: 'Reparto',
  front: 'Fronte',
  facility: 'Impianto',
  construction: 'Costruzione',
  navy: 'Marina',
  fleet: 'Flotta',
  ship: 'Nave',
  mine: 'Miniera',
};

export type ObjectStatus = OperatingObjectPayload['status'];

/** Tono semantico dello stato dell'oggetto. */
export function statusTone(status: ObjectStatus): ObjectTone {
  switch (status) {
    case 'critical': return 'critical';
    case 'degraded':
    case 'maintenance':
    case 'under_construction': return 'warning';
    case 'idle': return 'neutral';
    default: return 'positive';
  }
}

/** Cifre decimali per unità: un fatto piccolo non deve diventare «0». */
const DECIMALS: Record<OperatingFactUnit, number> = {
  numero: 0, pct: 0, mld: 3, mln: 1, per_mese: 2, mesi: 1, data: 0, testo: 0,
};

const UNITS: Partial<Record<OperatingFactUnit, string>> = {
  mld: 'mld', mln: 'mln', per_mese: '/mese', mesi: 'mesi',
};

/**
 * Valore con l'unità del motore, ai decimali dichiarati per quell'unità: un
 * consumo di 0,83/mese non deve diventare «1», una spesa di 0,004 mld non «0».
 */
export function formatUnitValue(value: number | null | undefined, unit: OperatingFactUnit, decimals = DECIMALS[unit] ?? 0): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return '—';
  if (unit === 'data') return '—';
  if (unit === 'pct') return `${formatNumber(value)}%`;
  const body = formatMoney(value, { decimals });
  const suffix = UNITS[unit];
  return suffix ? `${body} ${suffix}` : body;
}

/** Valore di un fatto, formattato con l'unità del motore. */
export function formatFactValue(fact: OperatingFactPayload): string {
  if (fact.unit === 'testo') return fact.text ?? '—';
  // La data è un fatto di calendario: si legge come data di gioco, non come numero.
  if (fact.unit === 'data') return formatDate(fact.text ?? null);
  return formatUnitValue(fact.value, fact.unit);
}

export interface FactRow {
  section: OperatingFactSection;
  label: string;
  value: string;
  tone: ObjectTone;
  /** Testo lungo (es. elenco composizione): sotto la riga, in piccolo. */
  note?: string;
}

/** I fatti di un oggetto, già formattati e nell'ordine della grammatica. */
export function factRows(object: OperatingObjectPayload): FactRow[] {
  return object.facts
    .map(fact => ({
      section: fact.section,
      label: fact.label,
      value: formatFactValue(fact),
      tone: (fact.tone ?? 'neutral') as ObjectTone,
      // Nota del motore su un fatto numerico (es. «Nessuno prima del completamento»).
      ...(fact.unit !== 'testo' && fact.text ? { note: fact.text } : {}),
    }))
    .sort((a, b) => SECTION_ORDER.indexOf(a.section) - SECTION_ORDER.indexOf(b.section));
}

/** Sezioni presenti con i loro fatti: la scheda mostra solo ciò che esiste. */
export function sectionsOf(object: OperatingObjectPayload): Array<{ section: OperatingFactSection; label: string; rows: FactRow[] }> {
  const rows = factRows(object);
  return SECTION_ORDER
    .map(section => ({
      section,
      label: SECTION_LABEL[section],
      rows: rows.filter(row => row.section === section),
    }))
    .filter(group => group.rows.length > 0);
}

/** Problema più grave: la prima cosa che il giocatore deve leggere. */
export function primaryProblem(object: OperatingObjectPayload) {
  return object.problems.find(problem => problem.severity === 'critical') ?? object.problems[0] ?? null;
}

/** Oggetti di un tipo, con l'eventuale filtro per contenitore. */
export function objectsOfKind(picture: OperatingPicturePayload | null | undefined, kind: string): OperatingObjectPayload[] {
  if (!picture) return [];
  return picture.objects.filter(object => object.kind === kind);
}

/** Figli diretti di un oggetto (nave → flotta, flotta → marina). */
export function childrenOf(picture: OperatingPicturePayload | null | undefined, parentId: string): OperatingObjectPayload[] {
  if (!picture) return [];
  return picture.objects.filter(object => object.parentId === parentId);
}

/** Fatti di un oggetto come mappa etichetta → riga (per i test e la UI). */
export function factsByLabel(object: OperatingObjectPayload): Record<string, FactRow> {
  return Object.fromEntries(factRows(object).map(row => [row.label, row]));
}

/** Azioni eseguibili sull'oggetto: le bloccate restano visibili con il motivo. */
export function actionsOf(object: OperatingObjectPayload): OperatingActionPayload[] {
  return object.actions;
}

/** Catene produttive con il loro anello debole già calcolato dal motore. */
export function chainsView(picture: OperatingPicturePayload | null | undefined): OperatingChainPayload[] {
  return picture?.chains ?? [];
}

/**
 * D-1 — quanti **reparti** hanno un problema (una criticità o un avviso).
 * È il distintivo della voce «Forze»: dice da fuori, senza aprire la sala,
 * che c'è qualcosa da fare. Conta i soli oggetti di tipo unità: un impianto
 * degradato non è un reparto, e gonfierebbe il numero con la cosa sbagliata.
 */
export function countTroubledUnits(picture: OperatingPicturePayload | null | undefined): number {
  const objects = picture?.objects;
  if (!Array.isArray(objects)) return 0;
  return objects.filter(object => object.kind === 'unit' && object.problems.length > 0).length;
}

// ── Livello A: le schede di settore (aggregato) ─────────────────────────────

export interface SectorCard {
  id: 'forze' | 'industria' | 'marina' | 'risorse';
  label: string;
  headline: string;
  status: ObjectStatus | 'absent';
  facts: Array<{ label: string; value: string }>;
  problems: Array<{ severity: 'critical' | 'warning'; label: string }>;
  /** Oggetti concreti dietro questa scheda (il clic porta al livello B). */
  objectIds: string[];
}

/** Plurale italiano minimo: «1 impianto», «2 impianti». */
const plural = (count: number, one: string, many: string) => `${count} ${count === 1 ? one : many}`;

const factValue = (object: OperatingObjectPayload | undefined, label: string): string =>
  object ? factsByLabel(object)[label]?.value ?? '—' : '—';

const numberFact = (object: OperatingObjectPayload | undefined, label: string): number =>
  object ? Number(object.facts.find(fact => fact.label === label)?.value ?? 0) : 0;

/**
 * Le schede di settore: **aggregati** costruiti dagli oggetti del motore e dalla
 * capacità industriale, senza nuove soglie. Se la marina non esiste (paese senza
 * mare) la scheda non compare: assente non è zero.
 */
export function sectorCards(
  picture: OperatingPicturePayload | null | undefined,
  extra: { capacityTotal?: number; capacityUsed?: number; capacityFree?: number; blocked?: boolean; saturated?: boolean; factories?: number; ports?: number; universities?: number } = {},
): SectorCard[] {
  if (!picture) return [];
  const force = objectsOfKind(picture, 'force')[0];
  const navy = objectsOfKind(picture, 'navy')[0];
  const facilities = objectsOfKind(picture, 'facility');
  const mines = objectsOfKind(picture, 'mine');
  const constructions = objectsOfKind(picture, 'construction');
  const cards: SectorCard[] = [];

  if (force) {
    cards.push({
      id: 'forze',
      label: 'Forze armate',
      headline: force.subtitle ?? force.label,
      status: force.status,
      facts: [
        { label: 'Uomini in armi', value: factValue(force, 'Uomini in armi') },
        { label: 'Riserva', value: factValue(force, 'Riserva addestrata') },
        { label: 'Prontezza', value: factValue(force, 'Prontezza') },
        { label: 'Spesa militare', value: factValue(force, 'Spesa militare') },
        { label: 'Carburante', value: factValue(force, 'Carburante (scorte)') },
      ],
      problems: force.problems.map(problem => ({ severity: problem.severity, label: problem.label })),
      objectIds: [force.id, ...picture.objects.filter(object => object.kind === 'army' || object.kind === 'unit'
        || object.kind === 'front').map(object => object.id)],
    });
  }

  const facilityProblems = facilities.flatMap(object => object.problems)
    .filter(problem => problem.severity === 'critical')
    .slice(0, 2)
    .map(problem => ({ severity: problem.severity, label: problem.label }));
  if (facilities.length > 0 || constructions.length > 0) {
    cards.push({
      id: 'industria',
      label: 'Industria',
      headline: `${plural(facilities.length, 'impianto', 'impianti')}${constructions.length > 0 ? ` · ${plural(constructions.length, 'cantiere', 'cantieri')}` : ''}`,
      status: extra.blocked ? 'critical' : extra.saturated ? 'degraded' : 'operational',
      facts: [
        { label: 'Impianti', value: formatNumber(extra.factories ?? facilities.length) },
        { label: 'Linee totali', value: formatNumber(extra.capacityTotal ?? 0) },
        { label: 'Occupate', value: formatNumber(extra.capacityUsed ?? 0) },
        { label: 'Libere', value: formatNumber(extra.capacityFree ?? 0) },
        { label: 'Cantieri', value: formatNumber(constructions.length) },
      ],
      problems: [
        ...(extra.blocked ? [{ severity: 'critical' as const, label: 'Produzione bloccata: nessuna capacità' }] : []),
        ...facilityProblems,
      ],
      objectIds: [...facilities.map(object => object.id), ...constructions.map(object => object.id)],
    });
  }

  if (navy) {
    cards.push({
      id: 'marina',
      label: 'Marina',
      headline: navy.subtitle ?? navy.label,
      status: navy.status,
      facts: [
        { label: 'Navi in servizio', value: factValue(navy, 'Navi in servizio') },
        { label: 'Operative', value: factValue(navy, 'Operative') },
        { label: 'In manutenzione', value: factValue(navy, 'In manutenzione') },
        { label: 'In costruzione', value: factValue(navy, 'In costruzione') },
        { label: 'Equipaggi', value: factValue(navy, 'Equipaggi') },
        { label: 'Spesa della marina', value: factValue(navy, 'Spesa della marina') },
      ],
      problems: navy.problems.map(problem => ({ severity: problem.severity, label: problem.label })),
      objectIds: picture.objects.filter(object => object.kind === 'fleet' || object.kind === 'ship').map(object => object.id),
    });
  }

  if (mines.length > 0) {
    cards.push({
      id: 'risorse',
      label: 'Risorse',
      headline: `${plural(mines.length, 'giacimento sfruttato', 'giacimenti sfruttati')}`,
      status: 'operational',
      facts: mines.slice(0, 4).map(object => ({
        label: object.label.replace(/^Miniera di /, ''),
        value: numberFact(object, 'Giacimento') > 0 ? `${formatNumber(numberFact(object, 'Giacimento'))}/5` : '—',
      })),
      problems: mines.flatMap(object => object.problems)
        .filter(problem => problem.severity === 'critical')
        .slice(0, 2)
        .map(problem => ({ severity: problem.severity, label: problem.label })),
      objectIds: mines.map(object => object.id),
    });
  }
  return cards;
}

// ── Azione: creazione di reparti (PRIMA → DOPO) ─────────────────────────────

export interface FormationActionView {
  /** Il motore non forma reparti senza fucili: l'azione resta visibile e bloccata. */
  blocked: boolean;
  blockedReason: string | null;
  title: string;
  /** Costo immediato, risorse necessarie, tempo: come li pubblica il motore. */
  costLine: string | null;
  equipmentLine: string | null;
  /** Righe PRIMA → DOPO già calcolate dal motore. */
  rows: Array<{ label: string; before: string; after: string; tone: ObjectTone }>;
  why: string;
}

const deltaDecimals = (unit: OperatingFactUnit) => DECIMALS[unit] ?? 0;

/** Una data non entra mai nelle tabelle PRIMA → DOPO numeriche. */

/** Compone la vista dell'azione «crea reparto» dai numeri del motore. */
export function formationActionView(impact: FormationImpactPayload | null | undefined): FormationActionView | null {
  if (!impact) return null;
  const { plan } = impact;
  const equipment = plan.items
    .filter(item => item.consumed > 0 || item.missing > 0)
    .map(item => `${item.consumed}/${item.required} ${item.name.toLowerCase()}${item.missing > 0 ? ` (mancano ${formatNumber(item.missing)})` : ''}`);
  // Una riga che non si muove non è una conseguenza: si mostra solo ciò che cambia
  // ai decimali con cui si legge (es. un consumo che resta 0,2 /mese non è un effetto).
  const rows = impact.deltas
    .filter(delta => formatUnitValue(delta.before, delta.unit, deltaDecimals(delta.unit))
      !== formatUnitValue(delta.after, delta.unit, deltaDecimals(delta.unit)))
    .map(delta => ({
      label: delta.label,
      before: formatUnitValue(delta.before, delta.unit, deltaDecimals(delta.unit)),
      after: formatUnitValue(delta.after, delta.unit, deltaDecimals(delta.unit)),
      tone: delta.tone as ObjectTone,
    }));
  return {
    blocked: plan.blocked,
    blockedReason: plan.blockedReason,
    title: `Crea ${impact.armyName}`,
    costLine: `Costo immediato ${formatNumber(plan.initialCostMln / 1000)} mld · materiale dal deposito`,
    equipmentLine: equipment.length > 0
      ? `${formatNumber(plan.men)} uomini · ${equipment.join(' · ')}`
      : null,
    rows,
    why: impact.why,
  };
}

/** Titolo breve di un'azione sul reparto. */
const UNIT_ACTION_TITLE: Record<string, string> = {
  reinforce: 'Rinforza',
  reequip: 'Riequipaggia',
  // PR3 — ricostituzione: riserva addestrata + deposito in una sola azione.
  reconstitute: 'Ricostituisci',
  transfer: 'Trasferisci',
  reassign: 'Cambia armata',
};

/**
 * Compone la vista dell'azione di un **reparto**: la stessa tabella PRIMA → DOPO
 * della creazione di reparti, con i numeri che il motore ha già calcolato.
 */
export function unitActionView(impact: UnitActionImpactPayload | null | undefined): FormationActionView | null {
  if (!impact) return null;
  const rows = impact.rows
    .filter(row => formatUnitValue(row.before, row.unit, deltaDecimals(row.unit))
      !== formatUnitValue(row.after, row.unit, deltaDecimals(row.unit)))
    .map(row => ({
      label: row.label,
      before: formatUnitValue(row.before, row.unit, deltaDecimals(row.unit)),
      after: formatUnitValue(row.after, row.unit, deltaDecimals(row.unit)),
      tone: (row.tone || 'neutral') as ObjectTone,
    }));
  const context = impact.action === 'transfer' && impact.movement
    ? `${impact.movement.pathNames[0]} → ${impact.movement.pathNames[impact.movement.pathNames.length - 1]}`
    : impact.action === 'transfer' && impact.regionName
      ? `Destinazione: ${impact.regionName}`
      : impact.action === 'reassign' && impact.armyName
        ? `Armata di arrivo: ${impact.armyName}`
        : null;
  const movementLine = impact.movement
    ? `${impact.movement.pathNames.join(' → ')} · ${impact.movement.hops} ${impact.movement.hops === 1 ? 'tratta' : 'tratte'} · ${impact.movement.daysPerHop} giorni/tratta · ${impact.movement.totalDays} giorni stimati · arrivo ${formatDate(impact.movement.estimatedArrivalDate)}`
    : null;
  return {
    blocked: impact.blocked,
    blockedReason: impact.blockedReason,
    title: `${UNIT_ACTION_TITLE[impact.action] ?? 'Azione'} · ${impact.unitName}`,
    costLine: context,
    equipmentLine: movementLine,
    rows,
    why: impact.why,
  };
}

const ORDER_LABEL: Record<string, string> = {
  attack: 'Attacca',
  defend: 'Difendi',
  reserve: 'Riserva',
  withdraw: 'Ripiega',
};

/**
 * Compone la vista di un **ordine** di fronte: stessa tabella PRIMA → DOPO delle
 * altre azioni, con il fronte di appartenenza come contesto.
 */
export function unitOrderView(impact: UnitOrderImpactPayload | null | undefined): FormationActionView | null {
  if (!impact) return null;
  const rows = impact.rows
    .filter(row => formatUnitValue(row.before, row.unit, deltaDecimals(row.unit))
      !== formatUnitValue(row.after, row.unit, deltaDecimals(row.unit)))
    .map(row => ({
      label: row.label,
      before: formatUnitValue(row.before, row.unit, deltaDecimals(row.unit)),
      after: formatUnitValue(row.after, row.unit, deltaDecimals(row.unit)),
      tone: (row.tone || 'neutral') as ObjectTone,
    }));
  return {
    blocked: false,
    blockedReason: null,
    title: `${ORDER_LABEL[impact.order] ?? impact.order} · ${impact.unitName}`,
    costLine: impact.frontName ? `${impact.frontName} · da «${ORDER_LABEL[impact.previousOrder] ?? impact.previousOrder}»` : null,
    equipmentLine: null,
    rows,
    why: impact.why,
  };
}

/** Armate di destinazione di un reparto: tutte tranne la sua. */
export function armyTargets(
  picture: OperatingPicturePayload | null | undefined,
  unit: OperatingObjectPayload,
): Array<{ id: string; label: string }> {
  if (!picture) return [];
  return picture.objects
    .filter(object => object.kind === 'army' && String(object.id) !== String(unit.parentId))
    .map(object => ({ id: object.id, label: object.label }));
}

/**
 * Regioni del paese conosciute dal quadro operativo: destinazioni possibili di
 * un reparto. La regione di partenza è esclusa (il motore la rifiuterebbe).
 */
export function regionTargets(
  picture: OperatingPicturePayload | null | undefined,
  unit: OperatingObjectPayload,
): Array<{ id: string; label: string }> {
  if (!picture) return [];
  const seen = new Map<string, string>();
  for (const object of picture.objects) {
    if (!object.regionId || String(object.regionId) === String(unit.regionId)) continue;
    if (!seen.has(object.regionId)) seen.set(object.regionId, object.regionName || object.regionId);
  }
  return [...seen.entries()].map(([id, label]) => ({ id, label }));
}

/** Riepilogo a una riga: quanto è cambiato (per la conferma dopo l'azione). */
export function formationOutcomeLine(impact: FormationImpactPayload | null | undefined): string | null {
  if (!impact) return null;
  // Solo i guadagni: i costi (carburante, cassa) restano nella tabella PRIMA → DOPO.
  const interesting = ['Uomini in armi', 'Riserva addestrata', 'Copertura armi individuali', 'Spesa militare'];
  const rows = impact.deltas
    .filter(delta => interesting.includes(delta.label))
    .map(delta => `${delta.label} ${formatUnitValue(delta.before, delta.unit, deltaDecimals(delta.unit))} → ${formatUnitValue(delta.after, delta.unit, deltaDecimals(delta.unit))}`);
  return rows.length > 0 ? rows.join(' · ') : null;
}

/** Quante caselle di conteggio mostra il livello A (le altre restano a zero). */
export function kindCount(picture: OperatingPicturePayload | null | undefined, kind: string): number {
  return Number(picture?.counts?.[kind] ?? 0);
}
