/**
 * World Story — Dossier Nazione: tipi condivisi
 * ============================================
 * Estratti da `NationDock.tsx` (blocco 2, punto 4): comportamento invariato.
 */
import type { Region } from '../../../types';
import type {
  ArsenalResponse, CrisisSnapshot, FiscalPolicyInfo, GovernmentSnapshot,
  GovernmentVoicesResponse, NaturalResourceSummary, PeacetimePressure,
  ResourceQuote, SovereignDebtTranche,
} from '../../../services/api';
import type { Trend, TrendTone } from '../accountTrend';
import type { CompletedProcess, NationalProcess } from '../nationDossier';

export interface NationAccount {
  polityId?: string;
  provinces?: number;
  population?: number;
  gdp?: number;
  militaryPower?: number;
  factories?: number;
  ports?: number;
  universities?: number;
  forces?: number;
  mobilized?: number;
  monthlyRevenue?: number;
  monthlyExpenses?: number;
  monthlyBalance?: number;
  annualGrowthRate?: number;
  stability?: number;
  defenceBurdenPct?: number;
  /** Pressione fiscale applicata alla nazione, in % del PIL. */
  taxRatePct?: number;
  /** Debito pubblico lordo ereditato in % del PIL (dal registro reale). */
  debtBurdenPct?: number;
  /** Rapporto debito/PIL effettivo (titoli emessi + scoperto), calcolato dal motore. */
  debtRatioPct?: number;
  warEffort?: number;
  socialTension?: number;
  nominalGdpUsdBillions?: number;
  gdpPerCapitaUsd?: number;
  government?: string;
  /** Tesoreria e debito registrati nel punto storico (mld USD). */
  money?: number;
  debt?: number;
  /** Disponibilità derivata dal profilo del paese (non dagli oggetti di mappa). */
  capacityBase?: { factories?: number; ports?: number; universities?: number; forces?: number };
  /** Fonti leggibili del profilo di capacità (PIL, abitanti, costa). */
  capacitySources?: string;
}

/** Magazzino materiale del paese (shape di `MaterialEconomy.ResourceStock`). */
export interface NationResources {
  money?: number;
  food?: number;
  clothing?: number;
  weapons?: number;
  fuel?: number;
  research?: number;
  technologies?: string[];
  /** Riserve e magazzino delle risorse naturali dinamiche. */
  natural?: NaturalResourceSummary[];
  /** Quotazioni di mercato per le risorse possedute. */
  market?: ResourceQuote[];
  /** Debito pubblico, tetto di credito e spazio residuo (mld USD). */
  debt?: number;
  creditLimit?: number;
  creditHeadroom?: number;
  /** Portafoglio del debito: titoli con tasso e scadenza. */
  debts?: SovereignDebtTranche[];
  /** Scoperto di cassa puro, distinto dai titoli emessi. */
  overdraft?: number;
  /** Interessi passivi annui sull'intero debito (mld). */
  annualInterest?: number;
  /** Scadenza media ponderata residua dei titoli (anni). */
  averageMaturityYears?: number;
  debtRatioPct?: number;
  /** Tasso di mercato oggi per una nuova emissione. */
  marketRatePct?: number;
  /** Capacità di stoccaggio e fabbisogno mensile del magazzino materiale. */
  capacity?: { food?: number; clothing?: number; weapons?: number; fuel?: number };
  needs?: { food?: number; clothing?: number; weapons?: number; fuel?: number };
  /** Modificatori nazionali attivi (proposti dal modello, decadono nel tempo). */
  modifiers?: { stability?: number; socialTension?: number; warEffort?: number; revenueMultiplier?: number; growthModifier?: number };
}

export interface NationDockProps {
  governmentType: string;
  account?: NationAccount | null;
  /** Magazzino materiale pubblicato dal motore (legacy). */
  resources?: NationResources | null;
  /** Arsenale, risorse naturali e catalogo militare (legacy). */
  arms?: ArsenalResponse | null;
  /** Costruisce o importa equipaggiamento. */
  procure?: (mode: 'build' | 'buy', equipmentId: string, quantity?: number) => Promise<void>;
  /** Vende o compra una risorsa naturale sul mercato. */
  trade?: (mode: 'sell' | 'buy', resourceId: string, quantity: number) => Promise<void>;
  /** Serie storica dei conti del paese (dal più vecchio al più recente). */
  accountHistory?: HistoryPoint[];
  regions?: Region[];
  ongoingProcesses?: NationalProcess[];
  /** Progetti chiusi di recente, mostrati sotto «Completati». */
  completedProcesses?: CompletedProcess[];
  mandateDecisions?: Array<{ mandateId: string; kind: string; resourceId: string; minStock: string; availableStock: string; shortfall: string; asOfDate: string; status: string }>;
  onAcknowledgeMandateDecision?: (mandateId: string, kind: string) => Promise<void>;
  /** Anime del governo e dettaglio del bilancio calcolati dal motore. */
  government?: GovernmentSnapshot | null;
  /** Trasforma la richiesta di una fazione in una bozza d'ordine reale. */
  onDraftOrder?: (text: string) => void;
  /** Voci delle anime del governo generate dall'LLM (per il turno corrente). */
  governmentVoices?: GovernmentVoicesResponse | null;
  governmentVoicesLoading?: boolean;
  governmentVoicesError?: string | null;
  /** Chiede al motore LLM di far parlare il consiglio (on-demand). */
  onLoadGovernmentVoices?: () => void;
  /** La nazione fa debito: emette titoli con tasso di mercato e scadenza. */
  onBorrowDebt?: (amountMld: number, termYears: number) => Promise<void>;
  /** Politica fiscale corrente (aliquota scelta, limiti ed effetti). */
  fiscalPolicy?: FiscalPolicyInfo | null;
  /** Cambia la pressione fiscale: il motore ricalcola tutto di conseguenza. */
  onSetFiscalPolicy?: (taxRatePct: number) => Promise<void>;
  fiscalPolicyBusy?: boolean;
  /** Sfide del momento: pressioni interne ed esterne generate dal motore. */
  pressures?: PeacetimePressure[] | null;
  /** Ultime sfide chiuse (risolte o ignorate), per memoria storica. */
  recentPressures?: PeacetimePressure[] | null;
  /** Risponde a una sfida: il motore applica gli effetti. */
  onResolvePressure?: (pressureId: string, optionId: string) => Promise<void>;
  pressureBusy?: boolean;
  /** Crisi nazionale: rischi di rivolta, default, invasione ed epilogo. */
  crisis?: CrisisSnapshot | null;
}

/** Un punto dello storico: data di gioco e conto già pubblicato dal motore. */
export interface HistoryPoint {
  date: string;
  turn?: number;
  account: NationAccount;
}

/** Tono semantico di una cifra: colore e barra laterale della carta. */
export type Tone = 'positive' | 'negative' | 'warning' | 'neutral';


export interface MetricTrend {
  trend: Trend | null;
  /** Variazione formattata, es. «+0,12 mld». */
  deltaText: string;
  tone: TrendTone;
}
