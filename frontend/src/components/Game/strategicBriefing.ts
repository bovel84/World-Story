/**
 * World Story — LW01: Briefing strategico (read model puro)
 * ========================================================
 * Trasforma lo stato già calcolato dal motore in una lettura compatta di
 * «che cosa richiede attenzione». **Non modifica il mondo, non avvia l'LLM,
 * non inventa metriche**: legge solo campi già pubblicati dagli endpoint
 * esistenti (conti, crisi, sfide, magazzino, processi, mandati, governo,
 * fisco) e li ordina per gravità.
 *
 * Regola: ENGINE DATA → (questa funzione) → UI.
 */

import type {
  CrisisSnapshot, FiscalPolicyInfo, GovernmentSnapshot, PeacetimePressure,
} from '../../services/api';
import type { NationAccount, NationResources } from './NationDock/types';
import { councilPresence } from './governmentDossier';

/** Gravità di una voce del briefing. */
export type BriefingSeverity = 'critical' | 'warning' | 'opportunity' | 'positive' | 'info';
/** Stato complessivo: guida il titolo della card. */
export type BriefingLevel = 'critical' | 'attention' | 'stable';

export interface BriefingItem {
  id: string;
  severity: BriefingSeverity;
  /** Glifo mostrato a sinistra (🔴🟠🟢). */
  icon: string;
  label: string;
  detail?: string;
}

export interface StrategicBriefing {
  level: BriefingLevel;
  /** Etichetta dello stato, es. «RICHIEDE ATTENZIONE». */
  statusLabel: string;
  /** Frase breve con la priorità più alta. */
  headline: string;
  items: BriefingItem[];
}

/** Processo/progetto già letto dal motore (forma minima). */
export interface BriefingProcess {
  id: string;
  title: string;
  progress?: number | null;
  expected_date?: string | null;
}

/** Decisione mandato già pubblicata dal motore. */
export interface BriefingMandateDecision {
  mandateId: string;
  kind: string;
  resourceId: string;
  minStock: string;
  availableStock: string;
  shortfall: string;
}

/** Obbligo di manutenzione già proiettato dal motore. */
export interface BriefingMaintenance {
  facilityId: string;
  typeName: string;
  sufficient: boolean;
  resourceId: string;
  shortfall: string;
}

/** Fatto del mondo già derivato (LW05) — stessa forma di una voce. */
export type BriefingWorldFact = Pick<BriefingItem, 'id' | 'severity' | 'label' | 'detail'>;

export interface StrategicBriefingInput {
  account?: NationAccount | null;
  resources?: NationResources | null;
  crisis?: CrisisSnapshot | null;
  pressures?: ReadonlyArray<PeacetimePressure> | null;
  ongoingProcesses?: ReadonlyArray<BriefingProcess> | null;
  mandateDecisions?: ReadonlyArray<BriefingMandateDecision> | null;
  maintenanceObligations?: ReadonlyArray<BriefingMaintenance> | null;
  government?: GovernmentSnapshot | null;
  fiscalPolicy?: FiscalPolicyInfo | null;
  /** Fatti esteri derivati dal read model LW05. */
  worldFacts?: ReadonlyArray<BriefingWorldFact> | null;
  /** Quadro diplomatico derivato dal read model LW06. */
  diplomacy?: { allies: readonly string[]; hostiles: readonly string[] } | null;
}

const ICON: Record<BriefingSeverity, string> = {
  critical: '🔴',
  warning: '🟠',
  opportunity: '🟢',
  positive: '🟢',
  info: '⚪',
};

/** Ordine di presentazione: prima ciò che è più urgente. */
const SEVERITY_ORDER: Record<BriefingSeverity, number> = {
  critical: 0,
  warning: 1,
  opportunity: 2,
  positive: 3,
  info: 4,
};

function num(value: unknown): number {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

/**
 * Numero opzionale: `null` quando il campo non è pubblicato. Evita che un
 * valore assente diventi uno zero economico reale (BUG 1 — tesoreria).
 */
function optionalNumber(value: unknown): number | null {
  if (value === undefined || value === null || value === '') return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function mld(value: number): string {
  return `${value >= 0 ? '+' : ''}${value.toFixed(2)} mld`;
}

/**
 * Costruisce il briefing. Deterministica e senza effetti collaterali: lo stesso
 * input produce lo stesso output, nell'ordine di gravità.
 */
export function deriveStrategicBriefing(input: StrategicBriefingInput): StrategicBriefing {
  const items: BriefingItem[] = [];
  const account = input.account ?? null;

  // --- 1. Crisi nazionale: le tre strade del collasso -----------------------
  const risks = input.crisis?.state?.risks ?? [];
  for (const risk of risks) {
    if (risk.level === 'calm') continue;
    items.push({
      id: `crisis-${risk.dimension}`,
      severity: risk.level === 'critical' ? 'critical' : 'warning',
      icon: risk.level === 'critical' ? ICON.critical : ICON.warning,
      label: risk.level === 'critical' ? `Crisi: ${risk.title}` : `Rischio: ${risk.title}`,
      detail: `${risk.score}/100 · ${risk.detail}`,
    });
  }
  if (input.crisis?.finished && input.crisis.ending) {
    items.push({
      id: 'crisis-ending',
      severity: 'critical',
      icon: ICON.critical,
      label: input.crisis.ending.title,
      detail: input.crisis.ending.summary,
    });
  }

  // --- 2. Sfide del momento ------------------------------------------------
  const activePressures = (input.pressures ?? []).filter(p => p.status === 'active');
  for (const pressure of activePressures) {
    items.push({
      id: `pressure-${pressure.id}`,
      severity: pressure.severity >= 3 ? 'warning' : 'info',
      icon: pressure.severity >= 3 ? ICON.warning : ICON.info,
      label: `${pressure.kind === 'external' ? 'Sfida estera' : 'Sfida interna'}: ${pressure.title}`,
      detail: `Gravità ${pressure.severity}/3 · ${pressure.source}`,
    });
  }

  // --- 3. Cassa, saldo e debito -------------------------------------------
  // La tesoreria vive nel magazzino materiale (`resources.money`) e solo in
  // fallback nel conto (`account.money`). Se nessuno dei due è pubblicato NON
  // si genera alcun warning: un campo assente non è una cassa a zero.
  const money = optionalNumber(input.resources?.money) ?? optionalNumber(account?.money);
  if (money !== null) {
    if (money < 0) {
      items.push({ id: 'treasury-negative', severity: 'critical', icon: ICON.critical, label: 'Tesoreria in scoperto', detail: `Cassa ${money.toFixed(2)} mld` });
    } else if (money < 0.5) {
      items.push({ id: 'treasury-low', severity: 'warning', icon: ICON.warning, label: 'Tesoreria quasi esaurita', detail: `Cassa ${money.toFixed(2)} mld` });
    }
  }

  if (account) {
    const balance = num(account.monthlyBalance);
    const stability = num(account.stability);
    const tension = num(account.socialTension);
    const debtRatio = num(account.debtRatioPct ?? account.debtBurdenPct);

    if (balance < -0.5) {
      items.push({ id: 'balance-deficit', severity: balance < -2 ? 'critical' : 'warning', icon: balance < -2 ? ICON.critical : ICON.warning, label: 'Deficit mensile crescente', detail: `Saldo ${mld(balance)}` });
    }
    if (tension >= 65) {
      items.push({ id: 'tension-high', severity: tension >= 80 ? 'critical' : 'warning', icon: tension >= 80 ? ICON.critical : ICON.warning, label: 'Tensione sociale elevata', detail: `${tension.toFixed(0)}%` });
    }
    if (stability > 0 && stability <= 40) {
      items.push({ id: 'stability-low', severity: stability <= 25 ? 'critical' : 'warning', icon: stability <= 25 ? ICON.critical : ICON.warning, label: 'Stabilità fragile', detail: `${stability.toFixed(0)}%` });
    }
    if (debtRatio >= 45) {
      items.push({ id: 'debt-high', severity: debtRatio >= 60 ? 'critical' : 'warning', icon: debtRatio >= 60 ? ICON.critical : ICON.warning, label: 'Debito pubblico elevato', detail: `${debtRatio.toFixed(0)}% del PIL` });
    }
  }

  // --- 4. Magazzino materiale (solo fabbisogni pubblicati dal motore) -------
  const needs = input.resources?.needs;
  if (needs) {
    const stock: Array<[string, string, number]> = [
      ['food', 'viveri', num(needs.food)],
      ['clothing', 'vestiario', num(needs.clothing)],
      ['weapons', 'armamenti', num(needs.weapons)],
      ['fuel', 'carburante', num(needs.fuel)],
    ];
    for (const [key, label, required] of stock) {
      if (required <= 0) continue;
      const available = num((input.resources as Record<string, unknown>)[key]);
      if (available < required) {
        items.push({
          id: `shortage-${key}`,
          severity: available < required * 0.5 ? 'critical' : 'warning',
          icon: available < required * 0.5 ? ICON.critical : ICON.warning,
          label: `Scorte di ${label} sotto la soglia`,
          detail: `${available.toFixed(1)} su ${required.toFixed(1)} al mese`,
        });
      }
    }
  }

  // --- 5. Decisioni richieste ---------------------------------------------
  for (const decision of input.mandateDecisions ?? []) {
    items.push({
      id: `mandate-${decision.mandateId}-${decision.kind}`,
      severity: 'warning',
      icon: ICON.warning,
      label: `Mandato: scorta minima non coperta (${decision.resourceId})`,
      detail: `${decision.availableStock} su ${decision.minStock} · mancano ${decision.shortfall}`,
    });
  }
  for (const obligation of input.maintenanceObligations ?? []) {
    if (obligation.sufficient) continue;
    items.push({
      id: `maintenance-${obligation.facilityId}`,
      severity: 'warning',
      icon: ICON.warning,
      label: `Manutenzione non coperta: ${obligation.typeName}`,
      detail: `Mancano ${obligation.shortfall} ${obligation.resourceId}`,
    });
  }

  // --- 6. Governo e fazioni ------------------------------------------------
  const government = input.government;
  if (government && government.factions.length > 0) {
    if (government.pressureIndex >= 60) {
      items.push({ id: 'gov-pressure', severity: government.pressureIndex >= 75 ? 'critical' : 'warning', icon: government.pressureIndex >= 75 ? ICON.critical : ICON.warning, label: 'Il consiglio preme sul governo', detail: government.headline });
    }
    const angriest = government.factions.find(f => f.id === government.angriestId);
    if (angriest && (angriest.stance === 'critico' || angriest.stance === 'ostile')) {
      items.push({ id: `gov-${angriest.id}`, severity: angriest.stance === 'ostile' ? 'warning' : 'info', icon: angriest.stance === 'ostile' ? ICON.warning : ICON.info, label: `${angriest.name}: ${angriest.demand.title}`, detail: angriest.demand.detail });
    }
    if (government.cohesion >= 70) {
      items.push({ id: 'gov-cohesion', severity: 'positive', icon: ICON.positive, label: 'Governo coeso', detail: `Coesione ${government.cohesion.toFixed(0)}%` });
    }
    // LW04 — chi guida l'agenda del consiglio, come presenza politica.
    const council = councilPresence(government);
    if (council?.dominantName) {
      items.push({ id: 'gov-agenda', severity: 'info', icon: ICON.info, label: `Agenda del consiglio: ${council.dominantName}`, detail: council.detail });
    }
  }

  // --- 7. Progetti prossimi al completamento -------------------------------
  for (const process of input.ongoingProcesses ?? []) {
    const progress = num(process.progress);
    if (progress >= 75 && progress < 100) {
      items.push({ id: `process-${process.id}`, severity: 'opportunity', icon: ICON.opportunity, label: `Progetto prossimo al completamento: ${process.title}`, detail: `${progress.toFixed(0)}%${process.expected_date ? ` · esito ${process.expected_date}` : ''}` });
    }
  }

  // --- 8. Diplomazia (LW06) ------------------------------------------------
  const diplomacy = input.diplomacy;
  if (diplomacy) {
    if (diplomacy.hostiles.length > 0) {
      items.push({ id: 'diplo-hostile', severity: diplomacy.hostiles.length >= 3 ? 'warning' : 'info', icon: diplomacy.hostiles.length >= 3 ? ICON.warning : ICON.info, label: `${diplomacy.hostiles.length} ${diplomacy.hostiles.length === 1 ? 'nazione ostile' : 'nazioni ostili'}`, detail: diplomacy.hostiles.slice(0, 4).join(', ') });
    }
    if (diplomacy.allies.length > 0) {
      items.push({ id: 'diplo-ally', severity: 'positive', icon: ICON.positive, label: `${diplomacy.allies.length} ${diplomacy.allies.length === 1 ? 'alleato' : 'alleati'}`, detail: diplomacy.allies.slice(0, 4).join(', ') });
    }
  }

  // --- 9. Mondo (LW05) -----------------------------------------------------
  for (const fact of input.worldFacts ?? []) {
    items.push({ id: fact.id, severity: fact.severity, icon: ICON[fact.severity], label: fact.label, detail: fact.detail });
  }

  // --- 10. Politica fiscale ------------------------------------------------
  if (input.fiscalPolicy) {
    const { taxRatePct, minPct, maxPct } = input.fiscalPolicy;
    if (taxRatePct >= maxPct - 1 || taxRatePct <= minPct) {
      items.push({ id: 'fiscal-extreme', severity: 'info', icon: ICON.info, label: input.fiscalPolicy.label, detail: input.fiscalPolicy.effects[0] });
    }
  }

  items.sort((a, b) => SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity]);

  const level: BriefingLevel = items.some(i => i.severity === 'critical')
    ? 'critical'
    : items.some(i => i.severity === 'warning')
      ? 'attention'
      : 'stable';

  const statusLabel = level === 'critical' ? 'RICHIEDE ATTENZIONE' : level === 'attention' ? 'DA MONITORARE' : 'SOTTO CONTROLLO';
  const headline = items.length > 0
    ? items[0].label
    : 'Nessuna criticità rilevata: il paese regge.';

  return { level, statusLabel, headline, items };
}

/**
 * MIGLIORIA 1 — vista compatta del briefing per la schermata principale.
 *
 * Riusa lo **stesso** output di `deriveStrategicBriefing` e ne mostra solo le
 * voci azionabili (critiche, di attenzione e le opportunità), al massimo
 * `maxItems`. Se non c'è nulla che richiede attenzione, `visible` è falso:
 * nessun rumore nella HUD.
 */
export interface CompactBriefing {
  visible: boolean;
  level: BriefingLevel;
  statusLabel: string;
  items: BriefingItem[];
  /** Voci del briefing non mostrate per limite di spazio. */
  hiddenCount: number;
}

export function compactBriefing(briefing: StrategicBriefing, maxItems = 3): CompactBriefing {
  const actionable = briefing.items.filter(item =>
    item.severity === 'critical' || item.severity === 'warning' || item.severity === 'opportunity');
  const items = actionable.slice(0, Math.max(maxItems, 1));
  return {
    visible: items.length > 0,
    level: briefing.level,
    statusLabel: briefing.statusLabel,
    items,
    hiddenCount: Math.max(briefing.items.length - items.length, 0),
  };
}
