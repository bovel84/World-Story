/**
 * World Story — Dossier Nazionale vivo (read model)
 * =================================================
 * Il Dossier deve mostrare il **presente** della partita, non i valori iniziali:
 *
 *     CountryInitialProfile  (Turno 0)
 *            + stato corrente del motore (conto, magazzino, arsenale)
 *            = DOSSIER NAZIONALE ATTUALE
 *
 * Questo modulo è **puro**: non chiama il motore, non scrive, non stima nulla.
 * Legge solo numeri già pubblicati — `NationalAccount`, `ResourceStock`,
 * `ArsenalResponse` — e li mette accanto alla baseline canonica
 * (`CountryInitialProfile`) per ricavarne `current`, `initial`, `delta`.
 *
 * Nessun secondo snapshot viene persistito: il confronto è un view model
 * ricalcolato a ogni lettura. Se la baseline manca (salvataggio legacy),
 * `hasBaseline` è `false` e il Dossier mostra solo lo stato corrente.
 */
import type { NationAccount, NationResources } from './NationDock/types';
import type {
  ArsenalResponse, CountryInitialProfilePayload,
} from '../../services/api';

/** `null` quando il motore non pubblica il valore: mai uno zero inventato. */
const finite = (value: unknown): number | null =>
  typeof value === 'number' && Number.isFinite(value) ? value : null;
const number = (value: unknown): number | null => {
  if (value === null || value === undefined || value === '') return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
};
const round = (value: number, digits = 3): number => {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
};

export interface DossierLiveMetric {
  key: string;
  label: string;
  current: number | null;
  initial: number | null;
  delta: number | null;
  deltaPct: number | null;
}

export interface DossierLiveResourceRow {
  id: 'food' | 'clothing' | 'weapons' | 'fuel';
  label: string;
  current: number | null;
  capacity: number | null;
  fillPct: number | null;
  initial: number | null;
  delta: number | null;
}

export interface DossierLiveEquipmentRow {
  id: string;
  name: string;
  domain: string;
  current: number;
  initial: number;
  delta: number;
}

export interface DossierLiveEquipmentGroup {
  domain: string;
  label: string;
  current: number;
  initial: number;
  delta: number;
  rows: DossierLiveEquipmentRow[];
}

export interface DossierLiveTechnology {
  current: string[];
  initial: string[];
  unlockedSinceStart: string[];
  lostSinceStart: string[];
}

export interface DossierLive {
  hasBaseline: boolean;
  baselineDate: string | null;
  state: DossierLiveMetric[];
  finance: DossierLiveMetric[];
  military: DossierLiveMetric[];
  quality: DossierLiveMetric[];
  equipment: DossierLiveEquipmentGroup[];
  resources: DossierLiveResourceRow[];
  capacity: DossierLiveMetric[];
  research: DossierLiveMetric;
  technology: DossierLiveTechnology;
}

export interface DossierLiveInput {
  account?: NationAccount | null;
  resources?: NationResources | null;
  arms?: ArsenalResponse | null;
  initialProfile?: CountryInitialProfilePayload | null;
}

function metric(key: string, label: string, current: number | null, initial: number | null): DossierLiveMetric {
  const delta = current !== null && initial !== null ? round(current - initial) : null;
  const deltaPct = delta !== null && initial !== null && initial !== 0 ? round((delta / Math.abs(initial)) * 100, 1) : null;
  return { key, label, current, initial, delta, deltaPct };
}

const RESOURCE_LABELS: Record<DossierLiveResourceRow['id'], string> = {
  food: 'Cibo',
  clothing: 'Vestiario',
  weapons: 'Armamenti',
  fuel: 'Carburante',
};
const RESOURCE_ORDER: DossierLiveResourceRow['id'][] = ['food', 'clothing', 'weapons', 'fuel'];

/** Etichette dei domini: solo display; l'ordine arriva dal motore quando c'è. */
const DOMAIN_FALLBACK_LABEL: Record<string, string> = {
  terra: 'Terra', aria: 'Aria', mare: 'Mare', missili: 'Missili', droni: 'Droni',
};

function equipmentGroups(arms: ArsenalResponse | null | undefined, initialProfile: CountryInitialProfilePayload | null | undefined): DossierLiveEquipmentGroup[] {
  const current = arms?.units ?? {};
  const initial = initialProfile?.military?.equipmentProfile ?? {};
  const catalog = new Map((arms?.catalog ?? []).map(item => [item.id, item]));
  const domainOf = (id: string): string => catalog.get(id)?.domain ?? 'altro';
  const nameOf = (id: string): string => catalog.get(id)?.name ?? id;
  const ids = [...new Set([...Object.keys(current), ...Object.keys(initial)])];
  const order = arms?.domains?.length
    ? arms.domains.map(domain => domain.domain)
    : Object.keys(DOMAIN_FALLBACK_LABEL);
  const labels = new Map<string, string>([
    ...Object.entries(DOMAIN_FALLBACK_LABEL),
    ...(arms?.domains ?? []).map(domain => [domain.domain, domain.label] as [string, string]),
  ]);
  const buckets = new Map<string, DossierLiveEquipmentRow[]>();
  for (const id of ids) {
    const present = Math.max(0, finite(current[id]) ?? 0);
    const atStart = Math.max(0, finite(initial[id]) ?? 0);
    // «Non mostrare quantità 0»: una voce senza pezzi oggi né all'inizio non ha
    // nulla da dire. Una voce persa (start > 0, oggi 0) resta, per spiegare
    // esplicitamente la capacità venuta meno.
    if (present === 0 && atStart === 0) continue;
    const domain = domainOf(id);
    const row: DossierLiveEquipmentRow = { id, name: nameOf(id), domain, current: present, initial: atStart, delta: present - atStart };
    const bucket = buckets.get(domain);
    if (bucket) bucket.push(row);
    else buckets.set(domain, [row]);
  }
  const groups: DossierLiveEquipmentGroup[] = [];
  for (const domain of [...order, 'altro']) {
    const rows = buckets.get(domain);
    if (!rows?.length) continue;
    rows.sort((a, b) => b.current - a.current || a.name.localeCompare(b.name));
    groups.push({
      domain,
      label: labels.get(domain) ?? domain,
      current: rows.reduce((total, row) => total + row.current, 0),
      initial: rows.reduce((total, row) => total + row.initial, 0),
      delta: rows.reduce((total, row) => total + row.delta, 0),
      rows,
    });
    buckets.delete(domain);
  }
  return groups;
}

/**
 * Costruisce il Dossier vivo. Tutte le cifre correnti vengono dai numeri del
 * motore; tutte le cifre iniziali dal `CountryInitialProfile`. Nessun valore è
 * derivato due volte e nessuna formula economica/militare è ricopiata qui.
 */
export function buildNationalDossierLive(input: DossierLiveInput): DossierLive {
  const { account, resources, arms, initialProfile } = input;
  const profile = initialProfile ?? null;
  const hasBaseline = profile !== null;

  const population = finite(account?.population);
  const gdp = finite(account?.nominalGdpUsdBillions);
  const gdpPerCapita = finite(account?.gdpPerCapitaUsd)
    ?? (gdp !== null && population !== null && population > 0 ? round(gdp * 1e9 / population, 0) : null);

  const initialState = {
    population: profile?.population ?? null,
    gdp: profile?.economy?.nominalGdpUsdBillions ?? null,
    gdpPerCapita: profile && profile.population > 0 ? round((profile.economy.nominalGdpUsdBillions * 1e9) / profile.population, 0) : null,
    stability: profile?.society?.stability ?? null,
    socialTension: profile?.society?.socialTension ?? null,
  };

  const state: DossierLiveMetric[] = [
    metric('population', 'Popolazione', population, initialState.population),
    metric('nominalGdpUsdBillions', 'PIL nominale', gdp, initialState.gdp),
    metric('gdpPerCapitaUsd', 'PIL pro capite', gdpPerCapita, initialState.gdpPerCapita),
    metric('stability', 'Stabilità', finite(account?.stability), initialState.stability),
    metric('socialTension', 'Tensione sociale', finite(account?.socialTension), initialState.socialTension),
  ];

  const initialDebt = profile ? round(profile.economy.nominalGdpUsdBillions * profile.economy.debtRatioPct / 100) : null;
  const initialBalance = profile ? round(profile.economy.monthlyRevenue - profile.economy.monthlyExpenses) : null;
  const currentBalance = finite(account?.monthlyBalance)
    ?? ((finite(account?.monthlyRevenue) ?? 0) - (finite(account?.monthlyExpenses) ?? 0));
  const finance: DossierLiveMetric[] = [
    metric('money', 'Tesoreria', finite(resources?.money) ?? finite(account?.money), profile?.economy?.treasuryUsdBillions ?? null),
    metric('monthlyRevenue', 'Entrate mensili', finite(account?.monthlyRevenue), profile?.economy?.monthlyRevenue ?? null),
    metric('monthlyExpenses', 'Spese mensili', finite(account?.monthlyExpenses), profile?.economy?.monthlyExpenses ?? null),
    metric('monthlyBalance', 'Saldo mensile', currentBalance, initialBalance),
    metric('debt', 'Debito totale', finite(resources?.debt) ?? finite(account?.debt), initialDebt),
    metric('debtRatioPct', 'Debito / PIL', finite(resources?.debtRatioPct) ?? finite(account?.debtRatioPct) ?? finite(account?.debtBurdenPct), profile?.economy?.debtRatioPct ?? null),
    metric('annualInterest', 'Servizio annuo del debito', finite(resources?.annualInterest), null),
    metric('creditHeadroom', 'Capacità residua di credito', finite(resources?.creditHeadroom), null),
  ];

  const manpower = arms?.manpower;
  const standingFormations = manpower
    ? Math.max(0, finite(manpower.formations) ?? 0) + Math.max(0, finite(manpower.mobilizedFormations) ?? 0)
    : finite(account?.forces);
  const military: DossierLiveMetric[] = [
    metric('activePersonnel', 'Personale attivo', finite(manpower?.activePersonnel), profile?.military?.activePersonnel ?? null),
    metric('reservePersonnel', 'Riserve', finite(manpower?.reservePersonnel), profile?.military?.reservePersonnel ?? null),
    metric('mobilizedPersonnel', 'Mobilitati', finite(manpower?.mobilizedPersonnel), null),
    metric('formations', 'Formazioni operative', standingFormations, profile?.military?.formations ?? null),
  ];

  const quality: DossierLiveMetric[] = [
    metric('readinessPct', 'Prontezza operativa', finite(arms?.readiness?.readinessPct), profile?.military?.readinessPct ?? null),
    metric('trainingPct', 'Addestramento', null, profile?.military?.trainingPct ?? null),
    metric('qualityPct', 'Qualità', finite(arms?.qualityIndex), profile?.military?.qualityPct ?? null),
    metric('logisticsPct', 'Logistica', null, profile?.military?.logisticsPct ?? null),
  ];

  const capacity: DossierLiveMetric[] = [
    metric('factories', 'Fabbriche', finite(account?.factories), profile?.infrastructure?.factories ?? null),
    metric('ports', 'Porti', finite(account?.ports), profile?.infrastructure?.ports ?? null),
    metric('universities', 'Università', finite(account?.universities), profile?.infrastructure?.universities ?? null),
  ];

  const resourcesRows: DossierLiveResourceRow[] = RESOURCE_ORDER.map(id => {
    const current = finite(resources?.[id]);
    const capacityValue = finite(resources?.capacity?.[id]);
    const initial = profile?.resources?.[id] ?? null;
    return {
      id,
      label: RESOURCE_LABELS[id],
      current,
      capacity: capacityValue,
      fillPct: current !== null && capacityValue !== null && capacityValue > 0 ? round(current / capacityValue * 100, 1) : null,
      initial,
      delta: current !== null && initial !== null ? round(current - initial) : null,
    };
  });

  const research = metric('research', 'Punti ricerca', finite(resources?.research), profile?.resources?.research ?? null);
  const currentTech = Array.isArray(resources?.technologies) ? [...resources!.technologies!].sort() : [];
  const initialTech = Array.isArray(profile?.resources?.technologies) ? [...profile!.resources!.technologies!].sort() : [];
  const currentSet = new Set(currentTech);
  const initialSet = new Set(initialTech);
  const technology: DossierLiveTechnology = {
    current: currentTech,
    initial: initialTech,
    unlockedSinceStart: currentTech.filter(id => !initialSet.has(id)),
    lostSinceStart: initialTech.filter(id => !currentSet.has(id)),
  };

  return {
    hasBaseline,
    baselineDate: profile?.startDate ?? null,
    state,
    finance,
    military,
    quality,
    equipment: equipmentGroups(arms, profile),
    resources: resourcesRows,
    capacity,
    research,
    technology,
  };
}
