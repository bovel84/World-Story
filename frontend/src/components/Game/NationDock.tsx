/**
 * World Story — Dossier Nazione (G5-A)
 * ====================================
 * Read model nazionale: espone solo dati già pubblicati dal motore o dalla
 * mappa autorevole; nessun valore economico, tecnologico o istituzionale è
 * stimato nel browser.
 *
 * Leggibilità (revisione): il dossier è organizzato in blocchi tematici con
 * etichette brevi, carte uniformi e numeri tabulari. Ogni cifra ha un tono
 * (positivo/attenzione/negativo) derivato dai valori del motore, così lo stato
 * della nazione si legge a colpo d'occhio.
 */

import React, { useEffect, useMemo, useState } from 'react';
import type { Region } from '../../types';
import {
  initialNationDockState,
  setSection,
  NATION_SECTIONS,
  NATION_SECTION_LABEL,
} from '../../stores/nationDock';
import { formatMoney, formatNumber, formatPercent } from '../../utils/format';
import type { ArsenalResponse, BudgetLine, GovernmentFaction, GovernmentSnapshot, GovernmentVoicesResponse, NaturalResourceSummary, ResourceQuote, SovereignDebtTranche } from '../../services/api';
import { deltaTone, sparkPoints, trendFrom, trendLabel, type Trend, type TrendTone } from './accountTrend';
import {
  financeBalance,
  hasNationalFinance,
  summarizeNationalAssets,
  type CompletedProcess,
  type NationalProcess,
} from './nationDossier';
import { groupProjectsByCategory } from './projectCategory';
import {
  LEVER_LABEL,
  STANCE_LABEL,
  factionOrderText,
  nationalVerdict,
  pressureLabel,
  pressureTone,
  satisfactionTone,
  stanceTone,
  type NationalVerdict,
} from './governmentDossier';

/** Conto nazionale aggregato (shape di `WorldStateEngine.accounts`). */
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

interface NationDockProps {
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
}

/** Un punto dello storico: data di gioco e conto già pubblicato dal motore. */
export interface HistoryPoint {
  date: string;
  turn?: number;
  account: NationAccount;
}

/** Tono semantico di una cifra: colore e barra laterale della carta. */
export type Tone = 'positive' | 'negative' | 'warning' | 'neutral';

/** Conteggio con grammatica corretta: «1 provincia», «2 province». */
function plural(value: number, singular: string, pluralForm: string): string {
  return `${formatNumber(value)} ${value === 1 ? singular : pluralForm}`;
}

function formatDate(value?: string | null): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(value || '');
  if (!match) return value || 'Data non pubblicata';
  const months = ['gen', 'feb', 'mar', 'apr', 'mag', 'giu', 'lug', 'ago', 'set', 'ott', 'nov', 'dic'];
  return `${Number(match[3])} ${months[Number(match[2]) - 1]} ${match[1]}`;
}

/** Soglie di stato: derivano dalle stesse cifre del motore, non da giudizi. */
export function stabilityTone(value: number): Tone {
  return value >= 55 ? 'positive' : value >= 40 ? 'warning' : 'negative';
}
export function tensionTone(value: number): Tone {
  return value >= 55 ? 'negative' : value > 30 ? 'warning' : 'positive';
}
export function warEffortTone(value: number): Tone {
  return value >= 50 ? 'negative' : value > 0 ? 'warning' : 'neutral';
}
export function defenceTone(value: number): Tone {
  return value >= 8 ? 'negative' : value >= 5 ? 'warning' : 'positive';
}

/** Tono delle scorte in base ai mesi di copertura del fabbisogno mensile. */
export function resourceTone(value: number, monthly: number): Tone {
  if (monthly <= 0) return value > 0 ? 'positive' : 'neutral';
  const months = value / monthly;
  return months >= 3 ? 'positive' : months >= 1 ? 'warning' : 'negative';
}
export function resourceMonths(value: number, monthly: number): number {
  if (monthly <= 0) return value > 0 ? Infinity : 0;
  return value / monthly;
}

/** Etichette dei domini militari del catalogo. */
const DOMAIN_LABELS: Record<string, string> = {
  terra: 'Forze di terra', aria: 'Aeronautica', mare: 'Marina', missili: 'Missili', droni: 'Droni',
};
const TIER_TONE: Record<string, Tone> = {
  obsoleto: 'negative', datato: 'warning', moderno: 'neutral', avanzato: 'positive', nuova_generazione: 'positive',
};
const RESOURCE_LABELS: Record<string, string> = {
  oil: 'Petrolio', gas: 'Gas', coal: 'Carbone', iron: 'Ferro', copper: 'Rame', bauxite: 'Bauxite',
  uranium: 'Uranio', gold: 'Oro', diamonds: 'Diamanti', lithium: 'Litio', rare_earths: 'Terre rare',
  timber: 'Legname', fertile_land: 'Terra fertile', fisheries: 'Pesca', water: 'Acqua',
};

/** Micro-grafico SVG della serie storica. Nessuna libreria esterna. */
function Sparkline({ trend, tone }: { trend: Trend; tone: TrendTone }) {
  const points = sparkPoints(trend.series);
  if (points.length < 2) return null;
  const path = points.map((point, index) => `${index === 0 ? 'M' : 'L'}${point.x} ${point.y}`).join(' ');
  const last = points[points.length - 1];
  const from = trend.dates[0];
  const to = trend.dates[trend.dates.length - 1];
  return (
    <svg
      className={`nation-spark spark-${tone}`}
      viewBox="0 0 56 18"
      width="56"
      height="18"
      role="img"
      aria-label={`Andamento dal ${from} al ${to}`}
      focusable="false"
    >
      <path d={path} />
      <circle cx={last.x} cy={last.y} r="1.8" />
    </svg>
  );
}

interface MetricTrend {
  trend: Trend | null;
  /** Variazione formattata, es. «+0,12 mld». */
  deltaText: string;
  tone: TrendTone;
}

function Metric({
  label,
  value,
  tone = 'neutral',
  hint,
  trend,
  hero = false,
}: {
  label: string;
  value: string;
  tone?: Tone;
  hint?: string;
  trend?: MetricTrend;
  hero?: boolean;
}) {
  return (
    <div className={`nation-metric tone-${tone}${hero ? ' nation-metric-hero' : ''}`}>
      <small>{label}</small>
      <b>{value}</b>
      {trend?.trend && (
        <span className={`nation-trend nation-trend-${trend.tone}`}>
          <Sparkline trend={trend.trend} tone={trend.tone} />
          <em>{`${trend.deltaText} ${trendLabel(trend.trend.dates)}`}</em>
        </span>
      )}
      {hint && <em className="nation-metric-hint">{hint}</em>}
    </div>
  );
}

function MetricGrid({ children }: { children: React.ReactNode }) {
  return <div className="nation-metric-grid">{children}</div>;
}


/** Blocco tematico: titolo + eventuale descrizione + corpo. */
function DossierBlock({
  title,
  description,
  children,
}: {
  title: string;
  description?: string;
  children: React.ReactNode;
}) {
  return (
    <section className="nation-block" aria-label={title}>
      <header className="nation-block-head">
        <h3 className="nation-block-title">{title}</h3>
        {description && <p className="nation-block-desc">{description}</p>}
      </header>
      <div className="nation-block-body">{children}</div>
    </section>
  );
}

function Footnote({ children }: { children: React.ReactNode }) {
  return <p className="nation-footnote">{children}</p>;
}

/**
 * Riga di mercato per una risorsa: quantità + vendita/acquisto. Il componente
 * tiene la propria quantità, così ogni risorsa ha un controllo indipendente.
 */
function ResourceTradeRow({
  summary, trade, busy,
}: {
  summary: NaturalResourceSummary;
  trade: (mode: 'sell' | 'buy', resourceId: string, quantity: number) => Promise<void>;
  busy: boolean;
}) {
  const [qty, setQty] = useState(1);
  const quantity = Math.max(1, Math.floor(Number(qty) || 1));
  return (
    <div className="resource-trade" role="group" aria-label={`Mercato ${summary.label}`}>
      <input
        className="resource-trade-qty"
        type="number"
        min={1}
        step={1}
        value={qty}
        inputMode="numeric"
        aria-label={`Quantità per ${summary.label}`}
        disabled={busy}
        onChange={(event) => setQty(Math.max(1, Math.floor(Number(event.target.value) || 1)))}
      />
      <button
        type="button"
        className="resource-trade-btn"
        disabled={busy || summary.stockpile < 1}
        onClick={() => void trade('sell', summary.kind, quantity)}
      >Vendi</button>
      <button
        type="button"
        className="resource-trade-btn resource-trade-buy"
        disabled={busy}
        onClick={() => void trade('buy', summary.kind, quantity)}
      >Compra</button>
    </div>
  );
}

const TIER_LABEL = (tier: string): string => {
  const words = tier.replace(/_/g, ' ');
  return words.charAt(0).toUpperCase() + words.slice(1);
};

/**
 * Costo unitario: il catalogo è in milioni di USD, la tesoreria in miliardi.
 * Le cifre decimali si adattano all'ordine di grandezza (niente finta
 * precisione su una portaerei da 6.000 miliardi).
 */
function formatBillions(mln: number): string {
  const value = mln / 1000;
  const decimals = value < 1 ? 3 : value < 100 ? 1 : 0;
  return formatMoney(value, { currency: 'mld', decimals });
}

/**
 * Avanzamento leggibile: percentuale in evidenza, barra e nota.
 * Un progetto senza stato si legge come «in corso», mai come un numero muto.
 */
function ProgressRow({ label, percent, note, status }: {
  label: string;
  percent: number;
  note?: string;
  status?: 'ongoing' | 'failed' | 'done';
}) {
  const value = Math.max(0, Math.min(100, Number.isFinite(Number(percent)) ? Number(percent) : 0));
  const tone = status === 'failed' ? 'negative' : value >= 60 ? 'positive' : 'warning';
  return (
    <div className="nation-progress-row">
      <div className="nation-progress-head">
        <b>{label}</b>
        <span className={`nation-progress-pct tone-${tone}`}>
          {status === 'failed' ? 'interrotto' : `${formatPercent(value)} completato`}
        </span>
      </div>
      <div
        className="nation-progress-track"
        role="progressbar"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={Math.round(value)}
        aria-label={`Avanzamento ${label}`}
      >
        <span style={{ width: `${value}%` }} />
      </div>
      {note && <small className="nation-progress-note">{note}</small>}
    </div>
  );
}

function EmptyState({ children }: { children: React.ReactNode }) {
  return <div className="nation-empty" role="note">{children}</div>;
}

/** Barra sottile per quote, soddisfazione e pressione (sola presentazione). */
function ShareBar({ value, tone = 'neutral' }: { value: number; tone?: Tone }) {
  const width = Math.max(0, Math.min(100, Number.isFinite(value) ? value : 0));
  return (
    <span className={`nation-share-bar tone-${tone}`} aria-hidden="true">
      <i style={{ width: `${width}%` }} />
    </span>
  );
}

/** Ripartizione di entrate o uscite: ogni voce con importo e quota. */
function BudgetBreakdown({ title, lines, total, kind }: {
  title: string;
  lines: BudgetLine[];
  total: number;
  kind: 'revenue' | 'expense';
}) {
  if (lines.length === 0) return null;
  return (
    <div className={`nation-budget-group nation-budget-${kind}`}>
      <div className="nation-budget-head">
        <h4>{title}</h4>
        <b>{formatMoney(total, { currency: 'mld', decimals: 2, sign: true })}</b>
      </div>
      <ul className="nation-budget-list">
        {lines.map((line) => (
          <li key={line.id} className="nation-budget-row">
            <div className="nation-budget-label">
              <span>{line.label}</span>
              <em>{formatPercent(line.sharePct, 1)}</em>
            </div>
            <ShareBar value={line.sharePct} tone={kind === 'revenue' ? 'positive' : 'neutral'} />
            <b className="nation-budget-amount">{formatMoney(line.amount, { currency: 'mld', decimals: 2 })}</b>
          </li>
        ))}
      </ul>
    </div>
  );
}

/**
 * Portafoglio del debito: ogni titolo emesso con tasso e scadenza. È la fonte
 * del debito pubblico, distinta dallo scoperto di cassa: si vede quanto costa
 * ogni emissione e quando torna a scadenza.
 */
function DebtPortfolio({ tranches, total }: { tranches: SovereignDebtTranche[]; total: number }) {
  if (tranches.length === 0) return null;
  const ordered = [...tranches].sort((a, b) => a.maturityDate.localeCompare(b.maturityDate));
  return (
    <ul className="nation-debt-list">
      {ordered.map((tranche) => (
        <li key={tranche.id} className="nation-debt-row">
          <div className="nation-debt-head">
            <span>{tranche.label}</span>
            <b>{formatMoney(tranche.principal, { currency: 'mld', decimals: 2 })}</b>
          </div>
          <ShareBar value={total > 0 ? (tranche.principal / total) * 100 : 0} tone="warning" />
          <div className="nation-debt-meta">
            <em>{formatPercent(tranche.annualRatePct, 1)} annuo</em>
            <em>scadenza {formatDate(tranche.maturityDate)}</em>
          </div>
        </li>
      ))}
    </ul>
  );
}

/** Giudizio su «come sta andando la nazione», derivato dai numeri del motore. */
function VerdictBanner({ verdict }: { verdict: NationalVerdict }) {
  return (
    <div className={`nation-verdict tone-${verdict.tone}`} role="status">
      <div className="nation-verdict-head">
        <span className="nation-verdict-kicker">Come sta andando</span>
        <b>{verdict.title}</b>
      </div>
      <p>{verdict.detail}</p>
      <ul className="nation-verdict-signals">
        {verdict.signals.map((signal) => <li key={signal}>{signal}</li>)}
      </ul>
    </div>
  );
}

/** Una delle anime del governo: interesse, influenza, umore e richiesta. */
function FactionCard({ faction, dominant, angriest, onDraftOrder, voice, speaking }: {
  faction: GovernmentFaction;
  dominant: boolean;
  angriest: boolean;
  onDraftOrder?: (text: string) => void;
  /** Petizione generata dal motore LLM (facoltativa). */
  voice?: string;
  /** Il consiglio sta parlando: mostra un segnaposto invece del nulla. */
  speaking?: boolean;
}) {
  const stance = stanceTone(faction.stance);
  return (
    <article className={`nation-faction-card tone-${stance}${dominant ? ' is-dominant' : ''}${angriest ? ' is-angriest' : ''}`}>
      <header className="nation-faction-head">
        <div>
          <b>{faction.name}</b>
          <span>{faction.interest}</span>
        </div>
        <div className="nation-faction-badges">
          {dominant && <span className="nation-badge nation-badge-dominant">Dominante</span>}
          {angriest && <span className="nation-badge nation-badge-angriest">Preme di più</span>}
          <span className={`nation-stance tone-${stance}`}>{STANCE_LABEL[faction.stance]}</span>
        </div>
      </header>
      <div className="nation-faction-gauges">
        <div className="nation-gauge">
          <span>Influenza <b>{formatPercent(faction.powerPct, 1)}</b></span>
          <ShareBar value={faction.powerPct} tone="neutral" />
        </div>
        <div className="nation-gauge">
          <span>Soddisfazione <b>{formatPercent(faction.satisfaction, 0)}</b></span>
          <ShareBar value={faction.satisfaction} tone={satisfactionTone(faction.satisfaction)} />
        </div>
        <div className="nation-gauge">
          <span>Pressione <b>{formatPercent(faction.pressure, 0)}</b></span>
          <ShareBar value={faction.pressure} tone={pressureTone(faction.pressure)} />
        </div>
      </div>
      {voice ? (
        <blockquote className={`nation-faction-voice tone-${stance}`}>
          <span className="nation-voice-kicker">La voce in consiglio</span>
          <p>{voice}</p>
        </blockquote>
      ) : speaking ? (
        <p className="nation-faction-speaking" role="status">Sta prendendo la parola…</p>
      ) : null}
      <div className="nation-faction-demand">
        <div className="nation-demand-head">
          <span className="nation-lever">{LEVER_LABEL[faction.demand.lever]}</span>
          <b>{faction.demand.title}</b>
        </div>
        <p>{faction.demand.detail}</p>
        <div className="nation-demand-actions">
          {onDraftOrder && (
            <button
              type="button"
              className="nation-demand-order"
              onClick={() => onDraftOrder(factionOrderText(faction))}
            >Porta in consiglio</button>
          )}
          <em className={`tone-${pressureTone(faction.pressure)}`}>{pressureLabel(faction.pressure)} · urgenza {formatPercent(faction.demand.urgency, 0)}</em>
        </div>
      </div>
    </article>
  );
}

/**
 * Caratteristiche tecniche di un equipaggiamento (sola lettura del catalogo).
 * Serve a rispondere a «che cos'è questo mezzo», non solo «quanti ne ho».
 */
function EquipmentSpecs({ specs }: { specs: Array<{ label: string; value: string }> }) {
  if (!specs || specs.length === 0) return null;
  return (
    <dl className="arms-specs">
      {specs.map(spec => (
        <div key={spec.label}>
          <dt>{spec.label}</dt>
          <dd>{spec.value}</dd>
        </div>
      ))}
    </dl>
  );
}

export const NationDock: React.FC<NationDockProps> = ({
  governmentType,
  account,
  resources,
  arms,
  procure,
  trade,
  accountHistory = [],
  regions = [],
  ongoingProcesses = [],
  completedProcesses = [],
  mandateDecisions = [],
  onAcknowledgeMandateDecision,
  government,
  onDraftOrder,
  governmentVoices,
  governmentVoicesLoading = false,
  governmentVoicesError,
  onLoadGovernmentVoices,
  onBorrowDebt,
}) => {
  const [state, setState] = useState(initialNationDockState);
  const [trading, setTrading] = useState(false);
  const [borrowing, setBorrowing] = useState(false);
  const [borrowAmount, setBorrowAmount] = useState('');
  const [borrowTerm, setBorrowTerm] = useState(10);
  const runBorrow = async () => {
    if (!onBorrowDebt || borrowing) return;
    const amount = Number(borrowAmount.replace(',', '.'));
    if (!Number.isFinite(amount) || amount <= 0) return;
    setBorrowing(true);
    try {
      await onBorrowDebt(amount, borrowTerm);
      setBorrowAmount('');
    } finally {
      setBorrowing(false);
    }
  };
  const runTrade = async (mode: 'sell' | 'buy', resourceId: string, quantity: number) => {
    if (!trade || trading) return;
    setTrading(true);
    try {
      await trade(mode, resourceId, quantity);
    } finally {
      setTrading(false);
    }
  };
  const active = state.activeSection;
  const assets = useMemo(() => summarizeNationalAssets(regions, account), [regions, account]);
  // I progetti in corso sono raggruppati per ambito (Difesa, Infrastrutture…).
  const projectGroups = useMemo(() => groupProjectsByCategory(ongoingProcesses), [ongoingProcesses]);
  const financeAvailable = hasNationalFinance(account);
  const balance = financeBalance(account);
  const stability = Number(account?.stability ?? 0);
  const socialTension = Number(account?.socialTension ?? 0);
  const warEffort = Number(account?.warEffort ?? 0);
  const mobilized = Number(account?.mobilized ?? 0);
  const defenceBurdenPct = Number(account?.defenceBurdenPct ?? 0);
  const growth = Number(account?.annualGrowthRate ?? 0);
  const natural = resources?.natural ?? [];
  const market = resources?.market ?? [];
  // La valuta è la cifra centrale del dossier: tesoreria, debito e credito
  // residuo vivono nella sezione «Cassa» e nella sintesi.
  const treasury = Number(resources?.money ?? 0);
  const debt = Number(resources?.debt ?? 0);
  const debtRatioPct = Number(resources?.debtRatioPct ?? account?.debtRatioPct ?? account?.debtBurdenPct ?? 0);
  const creditLimitValue = Number(resources?.creditLimit ?? 0);
  const creditHeadroomValue = Number(resources?.creditHeadroom ?? 0);
  // Portafoglio del debito: titoli con tasso e scadenza, interessi e rollover.
  const debtTranches = resources?.debts ?? [];
  const annualInterest = Number(resources?.annualInterest ?? 0);
  const averageMaturity = Number(resources?.averageMaturityYears ?? 0);
  const marketRate = Number(resources?.marketRatePct ?? 0);
  const overdraft = Number(resources?.overdraft ?? 0);
  const activeModifiers = resources?.modifiers;
  // Bilancio dettagliato e giudizio complessivo: entrambi derivano dalle cifre
  // del motore; il verdetto è una soglia applicata ai numeri, non una stima.
  const budget = government?.budget ?? null;
  const verdict = useMemo(() => nationalVerdict(account, budget), [account, budget]);
  const factions = government?.factions ?? [];

  // Le voci del consiglio si chiedono al motore solo quando la scheda Governo
  // è aperta: una chiamata on-demand, non un costo a ogni apertura del dossier.
  useEffect(() => {
    if (active !== 'governo') return;
    if (!onLoadGovernmentVoices) return;
    if (governmentVoices || governmentVoicesLoading) return;
    onLoadGovernmentVoices();
  }, [active, onLoadGovernmentVoices, governmentVoices, governmentVoicesLoading]);
  const modifiersActive = Boolean(activeModifiers && (
    Number(activeModifiers.stability ?? 0) !== 0
    || Number(activeModifiers.socialTension ?? 0) !== 0
    || Number(activeModifiers.warEffort ?? 0) !== 0
    || Number(activeModifiers.revenueMultiplier ?? 1) !== 1
    || Number(activeModifiers.growthModifier ?? 0) !== 0
  ));

  // Fabbisogno mensile e capacità di stoccaggio: il motore li pubblica; se
  // mancano si ricade sulla formula del conto, mai su un valore inventato.
  const popM = Number(account?.population ?? 0) / 1_000_000;
  const troops = Number(account?.forces ?? 0) + Number(account?.mobilized ?? 0);
  const foodMonthly = Number(resources?.needs?.food ?? (popM * 0.02 + troops * 0.06));
  const clothingMonthly = Number(resources?.needs?.clothing ?? (popM * 0.008 + troops * 0.01));
  const weaponsMonthly = Number(resources?.needs?.weapons ?? troops * 0.004);
  const fuelMonthly = Number(resources?.needs?.fuel ?? (Number(account?.forces ?? 0) * 0.03 + Number(account?.factories ?? 0) * 0.05));
  const capacity = resources?.capacity;
  const coverHint = (value: number, monthly: number, cap?: number) => {
    const capText = cap && cap > 0 ? ` · capacità ${formatNumber(cap)}` : '';
    const months = resourceMonths(value, monthly);
    if (!Number.isFinite(months)) return `nessun consumo registrato${capText}`;
    // Niente falsa precisione: oltre un anno si parla in anni, oltre dieci di
    // «oltre 10 anni». Una scorta enorme non diventa «8000,0 mesi».
    if (months >= 120) return `oltre 10 anni di copertura${capText}`;
    if (months >= 24) return `${Math.round(months / 12)} anni di copertura${capText}`;
    if (months >= 10) return `${Math.round(months)} mesi di copertura${capText}`;
    return `${formatMoney(months, { decimals: 1 })} mesi di copertura${capText}`;
  };
  /** Con la capacità nota le scorte si leggono come «quanto / tetto». */
  const matValue = (value: number, cap?: number) => (cap && cap > 0 ? `${formatNumber(value)} / ${formatNumber(cap)}` : formatNumber(value));
  const provincesLabel = (value: number) => `${formatNumber(value)} ${value === 1 ? 'provincia' : 'province'}`;

  // Le tendenze derivano dallo storico pubblicato dal motore: se la serie ha
  // meno di due punti la variazione non viene mostrata (mai inventata).
  const moneyDelta = (delta: number) => formatMoney(delta, { currency: 'mld', decimals: 2, sign: true });
  const pointDelta = (delta: number) => `${formatMoney(delta, { decimals: 1, sign: true })} pt`;
  const countDelta = (delta: number) => formatMoney(delta, { decimals: 0, sign: true });
  const mkTrend = useMemo(() => (
    pick: (point: HistoryPoint) => number | undefined | null,
    formatDelta: (delta: number) => string,
    goodDirection: 'up' | 'down',
  ): MetricTrend | undefined => {
    const trend = trendFrom(accountHistory, pick);
    if (!trend) return undefined;
    const flat = Math.abs(trend.delta) < 1e-9;
    return { trend, deltaText: flat ? 'stabile' : formatDelta(trend.delta), tone: deltaTone(trend.delta, goodDirection) };
  }, [accountHistory]);

  return (
    <div className="nation-dock">
      <nav className="nation-dock-tabs" aria-label="Sezioni del dossier">
        {NATION_SECTIONS.map((section) => (
          <button
            key={section}
            type="button"
            className={`nation-dock-tab${active === section ? ' active' : ''}`}
            aria-current={active === section ? 'page' : undefined}
            onClick={() => setState((prev) => setSection(prev, section))}
          >
            {NATION_SECTION_LABEL[section]}
          </button>
        ))}
      </nav>

      <div className="nation-dock-body">
        {active === 'situazione' && (
          <>
            <DossierBlock
              title="Sintesi"
              description="Tesoreria, bilancio e tenuta interna: lo stato della nazione a colpo d'occhio."
            >
              <MetricGrid>
                <Metric
                  label="Tesoreria"
                  value={formatMoney(treasury, { currency: 'mld', decimals: 2, sign: true })}
                  tone={treasury > 0 ? 'positive' : treasury < 0 ? 'negative' : 'warning'}
                  hint={debt > 0 ? `Debito ${formatMoney(debt, { currency: 'mld', decimals: 1 })}` : 'Riserva valutaria disponibile'}
                  trend={mkTrend((point) => point.account.money, moneyDelta, 'up')}
                  hero
                />
                <Metric
                  label="Saldo mensile"
                  value={formatMoney(balance, { currency: 'mld', decimals: 2, sign: true })}
                  tone={balance >= 0 ? 'positive' : 'negative'}
                  hint={financeAvailable ? 'Entrate meno uscite' : 'Bilancio non pubblicato'}
                  trend={mkTrend((point) => point.account.monthlyBalance, moneyDelta, 'up')}
                  hero
                />
                <Metric
                  label="Stabilità"
                  value={formatPercent(stability)}
                  tone={stabilityTone(stability)}
                  hint="Consenso e tenuta istituzionale"
                  trend={mkTrend((point) => point.account.stability, pointDelta, 'up')}
                  hero
                />
                <Metric
                  label="Tensione sociale"
                  value={formatPercent(socialTension)}
                  tone={tensionTone(socialTension)}
                  hint="Pressione interna su popolazione e governo"
                  trend={mkTrend((point) => point.account.socialTension, pointDelta, 'down')}
                  hero
                />
              </MetricGrid>
              <VerdictBanner verdict={verdict} />
            </DossierBlock>

            <DossierBlock
              title="Decisioni richieste"
              description="Scorte sotto soglia e processi che attendono un'autorizzazione."
            >
              <div className="nation-decisions">
                {mandateDecisions.map((decision) => (
                  <div key={`${decision.mandateId}-${decision.kind}`} className="nation-decision-live">
                    <b>Scorta minima non coperta · {decision.resourceId}</b>
                    <span>Disponibile {decision.availableStock} su minimo {decision.minStock} · mancano {decision.shortfall} (mandato {decision.mandateId}).</span>
                    {onAcknowledgeMandateDecision && <button type="button" className="nation-decision-ack" onClick={() => void onAcknowledgeMandateDecision(decision.mandateId, decision.kind)}>Prendi atto</button>}
                  </div>
                ))}
                {mandateDecisions.length === 0 && (ongoingProcesses.length > 0 ? (
                  <div className="nation-decision-live"><b>{ongoingProcesses.length} {ongoingProcesses.length === 1 ? 'processo richiede monitoraggio' : 'processi richiedono monitoraggio'}</b><span>Apri Progetti per vedere le prossime scadenze registrate.</span></div>
                ) : <EmptyState>Nessuna decisione richiede attenzione immediata.</EmptyState>)}
              </div>
            </DossierBlock>
          </>
        )}

        {active === 'governo' && (
          <>
            <DossierBlock
              title="Consiglio dei ministri"
              description="Le anime del governo: chi ha più influenza, chi è soddisfatto e chi adesso preme per cambiare rotta."
            >
              {government ? (
                <>
                  <div className="nation-government-summary">
                    <p className="nation-government-headline">{governmentVoices?.council || government.headline}</p>
                    <MetricGrid>
                      <Metric
                        label="Coesione del governo"
                        value={formatPercent(government.cohesion, 0)}
                        tone={satisfactionTone(government.cohesion)}
                        hint="Soddisfazione media ponderata per influenza"
                      />
                      <Metric
                        label="Pressione politica"
                        value={formatPercent(government.pressureIndex, 0)}
                        tone={pressureTone(government.pressureIndex)}
                        hint="Quanto il consiglio preme sul governo"
                      />
                      <Metric
                        label="Fazioni attive"
                        value={formatNumber(factions.length)}
                        hint="Interessi rappresentati nel consiglio"
                      />
                    </MetricGrid>
                    {(governmentVoicesLoading || governmentVoicesError) && (
                      <p className={`nation-government-status${governmentVoicesError ? ' is-error' : ''}`} role="status">
                        {governmentVoicesError || 'Il consiglio sta discutendo…'}
                      </p>
                    )}
                  </div>
                  {factions.length > 0 ? (
                    <ul className="nation-faction-list">
                      {factions.map((faction) => (
                        <li key={faction.id}>
                          <FactionCard
                            faction={faction}
                            dominant={faction.id === government.dominantId}
                            angriest={faction.id === government.angriestId}
                            onDraftOrder={onDraftOrder}
                            voice={governmentVoices?.voices?.[faction.id]}
                            speaking={governmentVoicesLoading}
                          />
                        </li>
                      ))}
                    </ul>
                  ) : (
                    <EmptyState>Nessuna fazione registrata per questo governo.</EmptyState>
                  )}
                  <Footnote><b>Come funziona</b> il motore calcola chi esiste, quanta influenza ha e che cosa chiede; il modello dà voce a ciascuna anima in una petizione breve, coerente con umore e pressione. Le cifre restano la fonte, mai il copione. Ogni richiesta può diventare un ordine reale: «Porta in consiglio» riempie la bozza e apre il compositore, senza spendere nulla finché l'ordine non è registrato e il tempo non avanza.</Footnote>
                </>
              ) : (
                <EmptyState>Le anime del governo non sono ancora pubblicate per questa partita.</EmptyState>
              )}
            </DossierBlock>
          </>
        )}

        {active === 'progetti' && (
          <DossierBlock
            title="Progetti e processi"
            description="Che cosa è avviato, in che ambito, a che punto è e quando è previsto l'esito."
          >
            {ongoingProcesses.length === 0 && completedProcesses.length === 0 ? (
              <EmptyState>Nessun progetto registrato alla data corrente.</EmptyState>
            ) : (
              <>
                {projectGroups.map((group) => (
                  <section key={group.category.key} className="nation-process-group">
                    <h4 className="nation-process-category">{group.category.label}</h4>
                    <ul className="nation-process-list">
                      {group.projects.map((process) => (
                        <li key={process.id}>
                          <b>{process.title}</b>
                          <span>{process.summary}</span>
                          <ProgressRow
                            label="Realizzazione"
                            percent={Number(process.progress ?? 0)}
                            note={process.expected_date
                              ? `Avviato ${formatDate(process.started_date)} · esito previsto ${formatDate(process.expected_date)}`
                              : `Avviato ${formatDate(process.started_date)} · nessuna scadenza dichiarata${process.progress_note ? ` · ${process.progress_note}` : ''}`}
                          />
                          {process.expected_date && process.progress_note && (
                            <small className="nation-process-note">{process.progress_note}</small>
                          )}
                        </li>
                      ))}
                    </ul>
                  </section>
                ))}

                {completedProcesses.length > 0 && (
                  <section className="nation-process-group is-completed">
                    <h4 className="nation-process-category">Completati</h4>
                    <ul className="nation-process-list">
                      {completedProcesses.map((process) => (
                        <li key={process.id}>
                          <b>{process.title}</b>
                          <span>{process.summary}</span>
                          <ProgressRow
                            label="Realizzazione"
                            percent={100}
                            note={process.completed_date
                              ? `Avviato ${formatDate(process.started_date)} · completato il ${formatDate(process.completed_date)}`
                              : `Avviato ${formatDate(process.started_date)} · completato entro la scadenza prevista`}
                          />
                        </li>
                      ))}
                    </ul>
                  </section>
                )}
              </>
            )}
            <Footnote>I progetti sono raggruppati per ambito. L'avanzamento è calcolato dal motore tra la data di avvio e la scadenza dichiarata; alla scadenza il progetto è chiuso e passa in «Completati». Senza scadenza resta «in corso» finché il modello non ne dichiara l'esito.</Footnote>
          </DossierBlock>
        )}

        {active === 'bilancio' && (
          <>
            <DossierBlock
              title="Tesoreria e debito"
              description="La valuta della nazione: ciò che è in cassa, ciò che si è preso a prestito e quanto credito resta."
            >
              <MetricGrid>
                <Metric
                  label="Tesoreria"
                  value={formatMoney(treasury, { currency: 'mld', decimals: 2, sign: true })}
                  tone={treasury > 0 ? 'positive' : treasury < 0 ? 'negative' : 'warning'}
                  hint={treasury < 0 ? 'Cassa negativa: il disavanzo è debito' : 'Riserva valutaria disponibile'}
                  trend={mkTrend((point) => point.account.money, moneyDelta, 'up')}
                  hero
                />
                <Metric
                  label="Debito pubblico"
                  value={formatMoney(debt, { currency: 'mld', decimals: 2 })}
                  tone={debt > 0 ? 'warning' : 'positive'}
                  hint={debt > 0
                    ? `${debtRatioPct !== 0 ? `Debito al ${formatPercent(debtRatioPct, 1)} del PIL` : 'Debito in essere'} · su un tetto di ${formatMoney(creditLimitValue, { currency: 'mld', decimals: 0 })}`
                    : 'Nessun debito: si può ancora andare a debito'}
                  trend={mkTrend((point) => point.account.debt, moneyDelta, 'down')}
                />
                <Metric
                  label="Credito residuo"
                  value={formatMoney(creditHeadroomValue, { currency: 'mld', decimals: 2 })}
                  tone={creditHeadroomValue > 0 ? 'positive' : 'negative'}
                  hint="Spazio per nuove spese a debito"
                />
                <Metric
                  label="Saldo mensile"
                  value={formatMoney(balance, { currency: 'mld', decimals: 2, sign: true })}
                  tone={balance >= 0 ? 'positive' : 'negative'}
                  hint="Entrate meno uscite: come cambia la cassa ogni mese"
                  trend={mkTrend((point) => point.account.monthlyBalance, moneyDelta, 'up')}
                  hero
                />
              </MetricGrid>
              {(debtTranches.length > 0 || debt > 0) && (
                <div className="nation-debt-block">
                  <h4 className="nation-subhead">Portafoglio del debito</h4>
                  <MetricGrid>
                    <Metric
                      label="Interessi annui"
                      value={formatMoney(annualInterest, { currency: 'mld', decimals: 2 })}
                      tone={annualInterest > 0 ? 'negative' : 'positive'}
                      hint="Costo del debito ogni anno"
                    />
                    <Metric
                      label="Scadenza media"
                      value={`${formatMoney(averageMaturity, { decimals: 1 })} anni`}
                      tone="neutral"
                      hint="Quanto in là torna il debito"
                    />
                    <Metric
                      label="Tasso di mercato"
                      value={formatPercent(marketRate, 1)}
                      tone={marketRate >= 8 ? 'negative' : marketRate >= 4 ? 'warning' : 'positive'}
                      hint="Tasso per una nuova emissione oggi"
                    />
                  </MetricGrid>
                  <DebtPortfolio tranches={debtTranches} total={debt} />
                  {overdraft > 0 && (
                    <p className="nation-debt-overdraft">
                      Scoperto di cassa: {formatMoney(overdraft, { currency: 'mld', decimals: 2 })} — cassa negativa, distinta dai titoli emessi.
                    </p>
                  )}
                  {onBorrowDebt && (
                    <form className="nation-borrow" onSubmit={(event) => { event.preventDefault(); void runBorrow(); }}>
                      <label>
                        <span>Nuova emissione</span>
                        <input
                          type="number"
                          min="0"
                          step="0.1"
                          inputMode="decimal"
                          value={borrowAmount}
                          placeholder="mld"
                          onChange={(event) => setBorrowAmount(event.target.value)}
                          aria-label="Importo da prendere a prestito in miliardi"
                        />
                      </label>
                      <label>
                        <span>Durata</span>
                        <select value={borrowTerm} onChange={(event) => setBorrowTerm(Number(event.target.value))} aria-label="Durata del titolo">
                          {[2, 5, 10, 15, 30].map((term) => <option key={term} value={term}>{term} anni</option>)}
                        </select>
                      </label>
                      <button type="submit" disabled={borrowing || creditHeadroomValue <= 0}>
                        {borrowing ? 'Emissione…' : 'Emetti titoli'}
                      </button>
                      <span className="nation-borrow-hint">Spazio disponibile: {formatMoney(creditHeadroomValue, { currency: 'mld', decimals: 2 })}</span>
                    </form>
                  )}
                  <Footnote><b>Il debito ha un prezzo e una data</b> ogni titolo paga interessi ogni anno e torna a scadenza: alla maturità il motore lo rifinanzia al tasso di mercato del momento. Più la nazione è indebitata, più alti sono tasso e premio di rischio; un rapporto debito/PIL elevato alza la tensione sociale e logora la stabilità. La cassa negativa è scoperto, non un titolo: si paga al tasso di sconto.</Footnote>
                </div>
              )}
              <Footnote><b>Come si muove la cassa</b> ogni mese la tesoreria cambia del saldo mensile (entrate + reddito da risorse − uscite − interessi sul debito). Le scelte del giocatore la muovono subito: un ordine eseguito preleva una spesa una tantum, gli acquisti militari e le compravendite sul mercato si pagano al momento, i movimenti di truppe costano carburante e denaro. Un saldo negativo la riduce; sotto zero la differenza è debito pubblico.</Footnote>
            </DossierBlock>

            <DossierBlock
              title="Flussi mensili"
              description="Quanto entra, quanto esce e come cresce l'economia."
            >
              {financeAvailable ? (
                <MetricGrid>
                  <Metric label="Entrate mensili" value={formatMoney(Number(account?.monthlyRevenue ?? 0), { currency: 'mld', decimals: 2, sign: true })} tone="positive" trend={mkTrend((point) => point.account.monthlyRevenue, moneyDelta, 'up')} />
                  <Metric label="Uscite mensili" value={formatMoney(Number(account?.monthlyExpenses ?? 0), { currency: 'mld', decimals: 2, sign: true })} tone="neutral" trend={mkTrend((point) => point.account.monthlyExpenses, moneyDelta, 'down')} />
                  <Metric label="Crescita annua" value={formatPercent(growth * 100, 1)} tone={growth > 0 ? 'positive' : growth < 0 ? 'negative' : 'neutral'} trend={mkTrend((point) => Number(point.account.annualGrowthRate ?? 0) * 100, pointDelta, 'up')} />
                  <Metric label="PIL nominale" value={formatMoney(assets.gdpBillions, { currency: 'mld', decimals: 1 })} tone="neutral" hint="Prodotto interno lordo pubblicato dal motore" />
                </MetricGrid>
              ) : (
                <EmptyState>Questo scenario non pubblica ancora voci di bilancio nel conto nazionale.</EmptyState>
              )}
            </DossierBlock>

            {budget && (budget.revenue.length > 0 || budget.expense.length > 0) && (
              <DossierBlock
                title="Composizione del bilancio"
                description="Le voci dietro i due totali: da dove entrano le entrate, dove escono le uscite."
              >
                <div className="nation-budget-columns">
                  <BudgetBreakdown title="Entrate mensili" lines={budget.revenue} total={budget.revenueTotal} kind="revenue" />
                  <BudgetBreakdown title="Uscite mensili" lines={budget.expense} total={budget.expenseTotal} kind="expense" />
                </div>
                <MetricGrid>
                  <Metric label="Pressione fiscale effettiva" value={formatPercent(budget.effectiveTaxRatePct, 1)} tone="neutral" hint="Entrate annue sul PIL" />
                  <Metric label="Spesa sociale" value={`${formatPercent(budget.socialBurdenPct, 1)} del PIL`} tone="neutral" hint="Sanità e sostegno sociale" />
                  <Metric label="Istruzione e ricerca" value={`${formatPercent(budget.educationBurdenPct, 1)} del PIL`} tone="neutral" hint="Scuola, atenei e laboratori" />
                  <Metric label="Spesa militare" value={`${formatPercent(budget.defenceBurdenPct, 1)} del PIL`} tone={defenceTone(budget.defenceBurdenPct)} hint="Quota dichiarata dal conto" />
                </MetricGrid>
                <Footnote><b>Come si legge</b> ogni voce è una ripartizione deterministica dei totali pubblicati dal motore, calcolata sui driver reali (fabbriche, porti, atenei, riserve, popolazione). La difesa è la quota esatta dichiarata dal conto; la somma delle voci è il totale. Nessun importo è stimato nel browser.</Footnote>
              </DossierBlock>
            )}

            <DossierBlock
              title="Pressione militare"
              description="Il costo dell'apparato militare e delle riserve richiamate."
            >
              <MetricGrid>
                <Metric
                  label="Spesa militare"
                  value={defenceBurdenPct > 0 ? `${formatPercent(defenceBurdenPct, 1)} del PIL` : '—'}
                  tone={defenceTone(defenceBurdenPct)}
                  hint="Quota del PIL destinata alla difesa"
                  trend={mkTrend((point) => point.account.defenceBurdenPct, pointDelta, 'down')}
                />
                <Metric
                  label="Riserve mobilitate"
                  value={formatNumber(mobilized)}
                  tone={mobilized > 0 ? 'warning' : 'positive'}
                  hint="Formazioni richiamate, non ancora operative"
                  trend={mkTrend((point) => point.account.mobilized, countDelta, 'down')}
                />
                <Metric
                  label="Sforzo bellico"
                  value={formatPercent(warEffort)}
                  tone={warEffortTone(warEffort)}
                  hint="Forze e riserve sul totale nazionale"
                  trend={mkTrend((point) => point.account.warEffort, pointDelta, 'down')}
                />
              </MetricGrid>
            </DossierBlock>

            <Footnote><b>Fonte</b> MaterialEconomy e WorldStateEngine.accounts · valori letti, non stimati dal client.</Footnote>
          </>
        )}

        {active === 'risorse' && (
          <>
            <DossierBlock
              title="Magazzino materiale"
              description="Scorte reali del paese: cibo, vestiario, armi, carburante e ricerca. Ogni voce ha un tetto di stoccaggio."
            >
              {resources ? (
                <MetricGrid>
                  <Metric
                    label="Cibo"
                    value={matValue(Number(resources.food ?? 0), capacity?.food)}
                    tone={resourceTone(Number(resources.food ?? 0), foodMonthly)}
                    hint={coverHint(Number(resources.food ?? 0), foodMonthly, capacity?.food)}
                  />
                  <Metric
                    label="Vestiario"
                    value={matValue(Number(resources.clothing ?? 0), capacity?.clothing)}
                    tone={resourceTone(Number(resources.clothing ?? 0), clothingMonthly)}
                    hint={coverHint(Number(resources.clothing ?? 0), clothingMonthly, capacity?.clothing)}
                  />
                  <Metric
                    label="Scorte armi"
                    value={matValue(Number(resources.weapons ?? 0), capacity?.weapons)}
                    tone={resourceTone(Number(resources.weapons ?? 0), weaponsMonthly)}
                    hint={coverHint(Number(resources.weapons ?? 0), weaponsMonthly, capacity?.weapons)}
                  />
                  <Metric
                    label="Carburante"
                    value={matValue(Number(resources.fuel ?? 0), capacity?.fuel)}
                    tone={resourceTone(Number(resources.fuel ?? 0), fuelMonthly)}
                    hint={coverHint(Number(resources.fuel ?? 0), fuelMonthly, capacity?.fuel)}
                  />
                  <Metric
                    label="Ricerca"
                    value={formatNumber(Number(resources.research ?? 0))}
                    tone="neutral"
                    hint="Punti non ancora spesi in tecnologie"
                  />
                </MetricGrid>
              ) : (
                <EmptyState>Il magazzino materiale non è ancora pubblicato per questa partita.</EmptyState>
              )}
              <Footnote><b>Fonte</b> MaterialEconomy · le scorte nascono da una quota della capacità reale (mesi di riserva secondo il PIL pro capite) e non possono superare il tetto: il surplus si perde. Una nazione fragile ha magazzini piccoli e resta in carenza se la produzione non copre il fabbisogno. La leva materiale del modello (aiuti, requisizioni, perdite) muove queste stesse scorte. Denaro, debito e credito sono nella sezione Cassa.</Footnote>
            </DossierBlock>

            {modifiersActive && (
              <DossierBlock
                title="Direttive attive"
                description="Effetti decisi dalla simulazione sulla vita della nazione: decadono se non rinnovati."
              >
                <MetricGrid>
                  {Number(resources?.modifiers?.stability ?? 0) !== 0 && (
                    <Metric label="Stabilità" value={`${Number(resources?.modifiers?.stability) > 0 ? '+' : ''}${formatNumber(Number(resources?.modifiers?.stability))}`} tone={Number(resources?.modifiers?.stability) > 0 ? 'positive' : 'negative'} hint="Effetto attivo sull'indice" />
                  )}
                  {Number(resources?.modifiers?.socialTension ?? 0) !== 0 && (
                    <Metric label="Tensione sociale" value={`${Number(resources?.modifiers?.socialTension) > 0 ? '+' : ''}${formatNumber(Number(resources?.modifiers?.socialTension))}`} tone={Number(resources?.modifiers?.socialTension) > 0 ? 'negative' : 'positive'} hint="Effetto attivo sull'indice" />
                  )}
                  {Number(resources?.modifiers?.warEffort ?? 0) !== 0 && (
                    <Metric label="Sforzo bellico" value={`${Number(resources?.modifiers?.warEffort) > 0 ? '+' : ''}${formatNumber(Number(resources?.modifiers?.warEffort))}`} tone={Number(resources?.modifiers?.warEffort) > 0 ? 'warning' : 'neutral'} hint="Effetto attivo sull'indice" />
                  )}
                  {Number(resources?.modifiers?.revenueMultiplier ?? 1) !== 1 && (
                    <Metric label="Entrate" value={`×${formatMoney(Number(resources?.modifiers?.revenueMultiplier), { decimals: 2 })}`} tone={Number(resources?.modifiers?.revenueMultiplier) >= 1 ? 'positive' : 'negative'} hint="Moltiplicatore sulle entrate" />
                  )}
                  {Number(resources?.modifiers?.growthModifier ?? 0) !== 0 && (
                    <Metric label="Crescita" value={`${Number(resources?.modifiers?.growthModifier) > 0 ? '+' : ''}${formatPercent(Number(resources?.modifiers?.growthModifier) * 100, 1)}`} tone={Number(resources?.modifiers?.growthModifier) > 0 ? 'positive' : 'negative'} hint="Effetto attivo sulla crescita annua" />
                  )}
                </MetricGrid>
                <Footnote><b>Fonte</b> il motore valida e limita ogni effetto proposto dalla simulazione; qui si vede solo ciò che è stato applicato.</Footnote>
              </DossierBlock>
            )}

            <DossierBlock
              title="Risorse naturali"
              description="Giacimento reale, riserva residua, estrazione, magazzino e quotazioni di mercato."
            >
              {natural.length > 0 ? (
                <>
                  <ul className="resource-chips">
                    {natural.map((node) => (
                      <li key={node.kind} className={node.depleted ? 'resource-chip depleted' : 'resource-chip'}>
                        <b>{node.label}</b>
                        <span>{node.endowment}/5</span>
                        <em>
                          riserva {formatNumber(node.reserve)}/{formatNumber(node.maxReserve)}
                          {node.depleted ? ' · esaurita' : ` · ${node.depletionPct}% consumata`}
                          {node.renewable ? ' · rinnovabile' : ''}
                        </em>
                        <em>estrazione {formatNumber(node.extractionPerMonth)}/mese · magazzino {formatNumber(node.stockpile)}</em>
                      </li>
                    ))}
                  </ul>
                  {market.length > 0 && (
                    <div className="resource-market">
                      <p className="resource-market-head">Mercato mondiale · prezzo di vendita e di acquisto per unità</p>
                      {market.map((quote) => {
                        const node = natural.find((entry) => entry.kind === quote.kind);
                        return (
                          <div key={quote.kind} className="resource-market-row">
                            <div className="resource-market-name">
                              <b>{quote.label}</b>
                              <em>
                                vendi {formatMoney(quote.bid, { currency: 'mld', decimals: 3 })} ·
                                compra {formatMoney(quote.ask, { currency: 'mld', decimals: 3 })}
                                {quote.scarcityPct > 0 ? ` · scarsità ${quote.scarcityPct}%` : ''}
                              </em>
                            </div>
                            {node && trade && <ResourceTradeRow summary={node} trade={runTrade} busy={trading} />}
                          </div>
                        );
                      })}
                    </div>
                  )}
                </>
              ) : arms && Object.keys(arms.naturalResources).length > 0 ? (
                <ul className="resource-chips">
                  {Object.entries(arms.naturalResources)
                    .filter(([, value]) => Number(value) > 0)
                    .sort((a, b) => Number(b[1]) - Number(a[1]))
                    .map(([kind, value]) => (
                      <li key={kind} className="resource-chip"><b>{RESOURCE_LABELS[kind] || kind}</b><span>{value}/5</span></li>
                    ))}
                </ul>
              ) : (
                <EmptyState>Nessuna risorsa naturale registrata per questa nazione.</EmptyState>
              )}
              <Footnote><b>Fonte</b> dotazioni nazionali reali · l'estrazione consuma la riserva (le rinnovabili si rigenerano); vendere e comprare muove denaro e magazzino.</Footnote>
            </DossierBlock>

            <DossierBlock
              title="Capacità produttive e territoriali"
              description="Che cosa il paese è in grado di fare: la disponibilità dipende dal profilo della nazione, non solo da ciò che è disegnato sulla mappa."
            >
              <MetricGrid>
                <Metric label="Province" value={formatNumber(assets.provinces)} />
                <Metric label="Fabbriche" value={formatNumber(assets.factories)} hint={assets.baseFactories > 0 ? `${formatNumber(assets.baseFactories)} dal profilo del paese, ${formatNumber(Math.max(0, assets.factories - assets.baseFactories))} costruite sulla mappa` : undefined} />
                <Metric label="Porti e cantieri" value={formatNumber(assets.ports)} hint={assets.basePorts > 0 ? `${formatNumber(assets.basePorts)} dalla costa, ${formatNumber(Math.max(0, assets.ports - assets.basePorts))} costruiti sulla mappa` : 'nessuno sbocco al mare'} />
                <Metric label="Città e capitali" value={formatNumber(assets.cities)} />
              </MetricGrid>
              <p className="nation-capacity-source">
                <b>Da dove viene la disponibilità</b>{' '}
                {assets.capacitySources
                  ? `${assets.capacitySources}.`
                  : 'profilo della nazione ricavato dal conto nazionale.'}{' '}
                La base è il profilo reale del paese (PIL, abitanti, costa, forze): {plural(assets.baseFactories, 'fabbrica', 'fabbriche')},
                {' '}{plural(assets.basePorts, 'porto', 'porti')}, {plural(assets.baseUniversities, 'università', 'università')},
                {' '}{plural(assets.baseForces, 'reparto', 'reparti')}. Ciò che si costruisce nel gioco si somma a questa base.
              </p>
              <Footnote><b>Fonte</b> conto nazionale quando disponibile; altrimenti oggetti delle regioni possedute. Università e personale sono nella sezione Conoscenze.</Footnote>
            </DossierBlock>
          </>
        )}

        {active === 'armamenti' && (
          <>
            <DossierBlock
              title="Forza dell'arsenale"
              description="Quanto vale l'apparato militare: quantità, qualità e potenza effettiva sui combattimenti."
            >
              {arms ? (
                <MetricGrid>
                  <Metric label="Forza militare" value={formatMoney(arms.strength, { decimals: 1 })} tone="neutral" hint="Quantità × qualità × dominio" />
                  <Metric label="Potenza effettiva" value={formatNumber(arms.effectiveMilitaryPower)} tone={arms.combatFactor >= 1 ? 'positive' : 'warning'} hint={`Base ${formatNumber(arms.baseMilitaryPower)} × fattore arsenale ${arms.combatFactor}`} />
                  <Metric label="Qualità media armi" value={`${formatNumber(arms.qualityIndex)}/100`} tone={arms.qualityIndex >= 60 ? 'positive' : arms.qualityIndex >= 30 ? 'warning' : 'negative'} hint="Pesa sui combattimenti" />
                  <Metric label="Scorte armi" value={formatNumber(arms.capacity.weapons)} hint="Input per la produzione" />
                </MetricGrid>
              ) : (
                <EmptyState>Arsenale non ancora pubblicato per questa partita.</EmptyState>
              )}
              <Footnote><b>Fonte</b> MilitaryIndustry · budget e industrie sono in Cassa e Risorse; qui solo ciò che combatte.</Footnote>
            </DossierBlock>

            <DossierBlock
              title="Come si legge l'arsenale"
              description="Le cifre dell'arsenale hanno una formula precisa: qui cosa significano."
            >
              <div className="arms-legend">
                <p><b>Quantità</b> — quante unità sono in servizio: «×37» significa 37 mezzi di quel tipo operativi adesso.</p>
                <p><b>Forza</b> — <i>quantità × qualità × peso del dominio ÷ 100</i>. Un caccia pesa più di un fucile: il peso è nella tabella qui sotto.</p>
                <p><b>Qualità</b> — valore 0–100 del singolo mezzo: obsoleto sotto 26, datato 26–45, moderno 46–65, avanzato 66–85, nuova generazione da 86.</p>
                <p><b>Potenza effettiva</b> — potenza nominale della nazione × fattore di arsenale (0,6–1,6). Il fattore sale con la qualità media e con la copertura delle forze schierate: un esercito senza mezzi combatte al 60% della sua potenza.</p>
              </div>
              {arms && arms.domains && arms.domains.length > 0 && (
                <ul className="arms-domains">
                  {arms.domains.map(domain => (
                    <li key={domain.domain}>
                      <b>{domain.label}</b>
                      <span>peso {formatMoney(domain.weight, { decimals: 1 })}×</span>
                      <em>{domain.description}</em>
                    </li>
                  ))}
                </ul>
              )}
              <Footnote><b>Perché conta</b> l'arsenale non è un punteggio: decide la potenza effettiva usata nei combattimenti e si consuma quando una nazione conquista una provincia.</Footnote>
            </DossierBlock>

            <DossierBlock
              title="Arsenale"
              description="Equipaggiamento in servizio: che cos'è, a cosa serve e quanto pesa sulla forza."
            >
              {arms && arms.lines.length > 0 ? (
                <ul className="arms-list">
                  {arms.lines.map((line) => (
                    <li key={line.id} className="arms-line-card">
                      <div className="arms-line-head">
                        <div>
                          <b>{line.name}</b>
                          <span>{line.domainLabel || DOMAIN_LABELS[line.domain] || line.domain} · {line.category}</span>
                        </div>
                        <div className="arms-line-meta">
                          <em>×{formatNumber(line.quantity)} in servizio</em>
                          <span className={`arms-tier tone-${TIER_TONE[line.tier] || 'neutral'}`}>{TIER_LABEL(line.tier)} · qualità {line.quality}/100</span>
                        </div>
                      </div>
                      <p className="arms-line-role">{line.role}</p>
                      <p className="arms-line-desc">{line.description}</p>
                      <EquipmentSpecs specs={line.specs} />
                      <div className="arms-line-share">
                        <span>Forza {formatMoney(line.strength, { decimals: 1 })} · {formatMoney(line.sharePct, { decimals: 1 })}% dell'arsenale</span>
                        <i aria-hidden="true"><em style={{ width: `${Math.max(0, Math.min(100, line.sharePct))}%` }} /></i>
                      </div>
                    </li>
                  ))}
                </ul>
              ) : (
                <EmptyState>Nessun equipaggiamento in servizio: costruisci o importa dal catalogo qui sotto.</EmptyState>
              )}
            </DossierBlock>

            <DossierBlock
              title="Produzione in corso"
              description="Percentuale di completamento degli ordini: la consegna non è istantanea e può subire ritardi o difetti."
            >
              {arms && arms.production && arms.production.orders.length > 0 ? (
                <ul className="arms-production">
                  {arms.production.orders.map((order) => (
                    <li key={order.id} className={`arms-production-item status-${order.status}`}>
                      <ProgressRow
                        label={`${order.name} ×${formatNumber(order.quantity)}`}
                        percent={order.status === 'failed' ? 0 : Number(order.progress)}
                        status={order.status === 'failed' ? 'failed' : 'ongoing'}
                        note={order.status === 'failed'
                          ? `Ordine fallito${order.note ? ` · ${order.note}` : ''} · la spesa sostenuta non è recuperabile`
                          : `Avviata il ${formatDate(order.startedDate)}${order.expectedDate ? ` · consegna prevista ${formatDate(order.expectedDate)}` : ''}${order.qualityLoss > 0 ? ` · ${Math.round(order.qualityLoss)}% dei pezzi difettosi` : ''}${order.note ? ` · ${order.note}` : ''}`}
                      />
                      <em className="arms-production-meta">{DOMAIN_LABELS[order.domain] || order.domain}</em>
                    </li>
                  ))}
                </ul>
              ) : (
                <EmptyState>Nessun ordine in corso: le costruzioni avviate compariranno qui con la percentuale di completamento.</EmptyState>
              )}
            </DossierBlock>

            <DossierBlock
              title="Produzione e acquisti"
              description="Costruisci con tecnologia, industria e risorse proprie, oppure importa pagando un sovrapprezzo. Ogni voce spiega che cos'è e a cosa serve."
            >
              {arms ? (
                <div className="arms-catalog">
                  {['terra', 'aria', 'mare', 'missili', 'droni'].map((domain) => (
                    <div key={domain} className="arms-domain">
                      <h4>{arms.domains?.find(item => item.domain === domain)?.label || DOMAIN_LABELS[domain] || domain}</h4>
                      <ul>
                        {arms.catalog.filter((item) => item.domain === domain).map((item) => (
                          <li key={item.id}>
                            <div className="arms-item-head">
                              <b>{item.name}</b>
                              <span className={`arms-tier tone-${TIER_TONE[item.tier] || 'neutral'}`}>{TIER_LABEL(item.tier)} · qualità {item.quality}/100</span>
                            </div>
                            <p className="arms-item-role">{item.role}</p>
                            <details className="arms-item-details">
                              <summary>Che cos'è e cosa sa fare</summary>
                              <p>{item.description}</p>
                              <EquipmentSpecs specs={item.specs} />
                            </details>
                            <div className="arms-item-cost">
                              Costruzione {formatBillions(item.buildCostMln)}
                              {' · '}Importazione {formatBillions(item.buyCostMln)}
                              {' · '}Scorte armi {formatNumber(item.weaponsCost)}/unità
                            </div>
                            {!item.canBuild && item.reasons.length > 0 && (
                              <div className="arms-reasons">Requisiti non soddisfatti: {item.reasons.join('; ')}.</div>
                            )}
                            <div className="arms-actions">
                              <button type="button" disabled={!item.canBuild || !procure} onClick={() => void procure?.('build', item.id, 1)}>Costruisci</button>
                              <button type="button" className="secondary" disabled={!item.canBuy || !procure} onClick={() => void procure?.('buy', item.id, 1)}>Importa</button>
                            </div>
                          </li>
                        ))}
                      </ul>
                    </div>
                  ))}
                </div>
              ) : (
                <EmptyState>Catalogo militare non disponibile.</EmptyState>
              )}
              <Footnote><b>Fonte</b> MilitaryIndustry · la costruzione apre un ordine di produzione con percentuale di completamento; l'importazione consegna subito al prezzo maggiorato.</Footnote>
            </DossierBlock>
          </>
        )}

        {active === 'conoscenze' && (
          <>
            <DossierBlock
              title="Tecnologie sbloccate"
              description="Progresso materiale finanziato dai punti ricerca nazionali."
            >
              {resources?.technologies && resources.technologies.length > 0 ? (
                <ul className="nation-tech-list">
                  {resources.technologies.map((tech) => (
                    <li key={tech}><b>{tech.replace(/_/g, ' ')}</b><span>Disponibile per economia e forze armate.</span></li>
                  ))}
                </ul>
              ) : (
                <EmptyState>Nessuna tecnologia sbloccata: accumula punti ricerca con università e popolazione.</EmptyState>
              )}
              <Footnote><b>Fonte</b> Catalogo tecnologie del motore · la ricerca si accumula a ogni tick del mondo.</Footnote>
            </DossierBlock>

            <DossierBlock
              title="Capitale umano"
              description="Popolazione, formazione e forze disponibili."
            >
              <MetricGrid>
                <Metric label="Popolazione" value={formatNumber(assets.population)} />
                <Metric label="Università" value={formatNumber(assets.universities)} hint="Producono punti ricerca" />
                <Metric label="Unità e forze" value={formatNumber(assets.forces)} />
              </MetricGrid>
              <Footnote><b>Fonte</b> conto nazionale; in mancanza, oggetti delle regioni possedute. Il PIL pro capite è nelle Politiche.</Footnote>
            </DossierBlock>
          </>
        )}

        {active === 'politiche' && (
          <>
            <DossierBlock
              title="Assetto istituzionale"
              description="Chi governa, su quale territorio e con quali processi aperti."
            >
              <MetricGrid>
                <Metric label="Forma di governo" value={governmentType} />
                <Metric label="Territorio amministrato" value={provincesLabel(assets.provinces)} />
                <Metric label="Processi attivi" value={formatNumber(ongoingProcesses.length)} />
              </MetricGrid>
            </DossierBlock>

            <DossierBlock
              title="Coesione interna"
              description="Il consenso e la pressione sociale sul governo."
            >
              <MetricGrid>
                <Metric label="Stabilità" value={formatPercent(stability)} tone={stabilityTone(stability)} trend={mkTrend((point) => point.account.stability, pointDelta, 'up')} />
                <Metric label="Tensione sociale" value={formatPercent(socialTension)} tone={tensionTone(socialTension)} trend={mkTrend((point) => point.account.socialTension, pointDelta, 'down')} />
                <Metric label="PIL pro capite" value={account?.gdpPerCapitaUsd != null ? formatMoney(Number(account.gdpPerCapitaUsd), { currency: '$', decimals: 0 }) : '—'} hint="Tenore di vita medio pubblicato dal motore" />
              </MetricGrid>
              <Footnote><b>Fonte</b> conto nazionale e modificatori attivi (sezione Risorse). Nessuna decisione viene presa da questa schermata.</Footnote>
            </DossierBlock>
          </>
        )}
      </div>
    </div>
  );
};

export default NationDock;
