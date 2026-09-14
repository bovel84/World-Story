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

import React, { useMemo, useState } from 'react';
import type { Region } from '../../types';
import {
  initialNationDockState,
  setSection,
  NATION_SECTIONS,
  NATION_SECTION_LABEL,
} from '../../stores/nationDock';
import { formatMoney, formatNumber, formatPercent } from '../../utils/format';
import type { ArsenalResponse, NaturalResourceSummary, ResourceQuote } from '../../services/api';
import { deltaTone, sparkPoints, trendFrom, trendLabel, type Trend, type TrendTone } from './accountTrend';
import {
  financeBalance,
  hasNationalFinance,
  summarizeNationalAssets,
  type NationalProcess,
} from './nationDossier';

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
  warEffort?: number;
  socialTension?: number;
  nominalGdpUsdBillions?: number;
  gdpPerCapitaUsd?: number;
  government?: string;
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
}

interface NationDockProps {
  /** Nome della POLITY del giocatore (mai la provincia selezionata). */
  nationalName: string;
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
  mandateDecisions?: Array<{ mandateId: string; kind: string; resourceId: string; minStock: string; availableStock: string; shortfall: string; asOfDate: string; status: string }>;
  onAcknowledgeMandateDecision?: (mandateId: string, kind: string) => Promise<void>;
  campaignProgress: number;
  latestNarration: string;
}

/** Un punto dello storico: data di gioco e conto già pubblicato dal motore. */
export interface HistoryPoint {
  date: string;
  turn?: number;
  account: NationAccount;
}

/** Tono semantico di una cifra: colore e barra laterale della carta. */
export type Tone = 'positive' | 'negative' | 'warning' | 'neutral';

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

/** Cifra in stile editoriale, per il bollettino su carta chiara. */
function LedgerMetric({ label, value }: { label: string; value: string }) {
  return (
    <span className="nation-ledger-cell">
      <small>{label}</small>
      <b>{value}</b>
    </span>
  );
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

function EmptyState({ children }: { children: React.ReactNode }) {
  return <div className="nation-empty" role="note">{children}</div>;
}

export const NationDock: React.FC<NationDockProps> = ({
  nationalName,
  governmentType,
  account,
  resources,
  arms,
  procure,
  trade,
  accountHistory = [],
  regions = [],
  ongoingProcesses = [],
  mandateDecisions = [],
  onAcknowledgeMandateDecision,
  campaignProgress,
  latestNarration,
}) => {
  const [state, setState] = useState(initialNationDockState);
  const [trading, setTrading] = useState(false);
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

  // Fabbisogno mensile stimato dal conto nazionale: serve solo a dare un tono
  // leggibile alle scorte (mai a inventare un valore).
  const popM = Number(account?.population ?? 0) / 1_000_000;
  const troops = Number(account?.forces ?? 0) + Number(account?.mobilized ?? 0);
  const foodMonthly = popM * 0.02 + troops * 0.06;
  const clothingMonthly = popM * 0.008 + troops * 0.01;
  const weaponsMonthly = troops * 0.004;
  const fuelMonthly = Number(account?.forces ?? 0) * 0.03 + Number(account?.factories ?? 0) * 0.05;
  const coverHint = (value: number, monthly: number) => {
    const months = resourceMonths(value, monthly);
    return Number.isFinite(months) ? `${months.toFixed(1)} mesi di copertura` : 'nessun consumo registrato';
  };

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
              description="Le tre cifre che descrivono lo stato della nazione in questo momento."
            >
              <MetricGrid>
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

            <DossierBlock title="Bollettino nazionale">
              <div className="nation-bulletin nation-bulletin-card">
                <div className="nation-bulletin-kicker">Bollettino</div>
                <h2>{nationalName}</h2>
                <p className="nation-government">{governmentType}</p>
                <div className="nation-progress">
                  <span>Avanzamento campagna</span>
                  <b>{formatPercent(campaignProgress)}</b>
                  <i><em style={{ width: `${Math.max(0, Math.min(100, campaignProgress))}%` }} /></i>
                </div>
                <div className="nation-ledger">
                  <LedgerMetric label="Popolazione" value={formatNumber(assets.population)} />
                  <LedgerMetric label="PIL nominale" value={formatMoney(assets.gdpBillions, { currency: 'mld', decimals: 1 })} />
                  <LedgerMetric label="Entrate / mese" value={formatMoney(Number(account?.monthlyRevenue ?? 0), { currency: 'mld', decimals: 2, sign: true })} />
                  <LedgerMetric label="Uscite / mese" value={formatMoney(Number(account?.monthlyExpenses ?? 0), { currency: 'mld', decimals: 2, sign: true })} />
                </div>
                <p className="nation-narration">{latestNarration}</p>
              </div>
              <Footnote><b>Fonte</b> Conto nazionale e mappa autorevole · Stabilità {formatPercent(stability)} · {formatNumber(assets.provinces)} province.</Footnote>
            </DossierBlock>
          </>
        )}

        {active === 'progetti' && (
          <DossierBlock
            title="Progetti e processi in corso"
            description="Ciò che è già avviato e la prossima scadenza registrata."
          >
            {ongoingProcesses.length === 0 ? (
              <EmptyState>Nessun processo in corso alla data del bollettino.</EmptyState>
            ) : (
              <ul className="nation-process-list">
                {ongoingProcesses.map((process) => (
                  <li key={process.id}>
                    <div><b>{process.title}</b><span>{process.summary}</span></div>
                    <small>Avviato {formatDate(process.started_date)} · {process.expected_date ? `stimato ${formatDate(process.expected_date)}` : 'nessuna data stimata'}</small>
                  </li>
                ))}
              </ul>
            )}
            <Footnote>I processi sono letti dal registro della simulazione: questa sezione non crea né modifica progetti.</Footnote>
          </DossierBlock>
        )}

        {active === 'bilancio' && (
          <>
            <DossierBlock
              title="Flussi mensili"
              description="Quanto entra, quanto esce e come cresce l'economia."
            >
              {financeAvailable ? (
                <MetricGrid>
                  <Metric label="Entrate mensili" value={formatMoney(Number(account?.monthlyRevenue ?? 0), { currency: 'mld', decimals: 2, sign: true })} tone="positive" trend={mkTrend((point) => point.account.monthlyRevenue, moneyDelta, 'up')} />
                  <Metric label="Uscite mensili" value={formatMoney(Number(account?.monthlyExpenses ?? 0), { currency: 'mld', decimals: 2, sign: true })} tone="neutral" trend={mkTrend((point) => point.account.monthlyExpenses, moneyDelta, 'down')} />
                  <Metric label="Saldo mensile" value={formatMoney(balance, { currency: 'mld', decimals: 2, sign: true })} tone={balance >= 0 ? 'positive' : 'negative'} trend={mkTrend((point) => point.account.monthlyBalance, moneyDelta, 'up')} />
                  <Metric label="Crescita annua" value={formatPercent(growth * 100, 1)} tone={growth > 0 ? 'positive' : growth < 0 ? 'negative' : 'neutral'} trend={mkTrend((point) => Number(point.account.annualGrowthRate ?? 0) * 100, pointDelta, 'up')} />
                </MetricGrid>
              ) : (
                <EmptyState>Questo scenario non pubblica ancora voci di bilancio nel conto nazionale.</EmptyState>
              )}
            </DossierBlock>

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

            <Footnote><b>Fonte</b> WorldStateEngine.accounts · valori letti, non stimati dal client.</Footnote>
          </>
        )}

        {active === 'risorse' && (
          <>
            <DossierBlock
              title="Magazzino materiale"
              description="Scorte reali del paese: cibo, vestiario, armamenti, carburante e denaro."
            >
              {resources ? (
                <MetricGrid>
                  <Metric
                    label="Tesoreria"
                    value={formatMoney(Number(resources.money ?? 0), { currency: 'mld', decimals: 2, sign: true })}
                    tone={Number(resources.money ?? 0) >= 0 ? 'positive' : 'negative'}
                    hint="Riserva valutaria disponibile"
                  />
                  <Metric
                    label="Cibo"
                    value={formatNumber(Number(resources.food ?? 0))}
                    tone={resourceTone(Number(resources.food ?? 0), foodMonthly)}
                    hint={coverHint(Number(resources.food ?? 0), foodMonthly)}
                  />
                  <Metric
                    label="Vestiario"
                    value={formatNumber(Number(resources.clothing ?? 0))}
                    tone={resourceTone(Number(resources.clothing ?? 0), clothingMonthly)}
                    hint={coverHint(Number(resources.clothing ?? 0), clothingMonthly)}
                  />
                  <Metric
                    label="Armamenti"
                    value={formatNumber(Number(resources.weapons ?? 0))}
                    tone={resourceTone(Number(resources.weapons ?? 0), weaponsMonthly)}
                    hint={coverHint(Number(resources.weapons ?? 0), weaponsMonthly)}
                  />
                  <Metric
                    label="Carburante"
                    value={formatNumber(Number(resources.fuel ?? 0))}
                    tone={resourceTone(Number(resources.fuel ?? 0), fuelMonthly)}
                    hint={coverHint(Number(resources.fuel ?? 0), fuelMonthly)}
                  />
                  <Metric
                    label="Ricerca"
                    value={formatNumber(Number(resources.research ?? 0))}
                    tone="neutral"
                    hint="Punti non ancora spesi in tecnologie"
                  />
                  <Metric
                    label="Debito pubblico"
                    value={formatMoney(Number(resources.debt ?? 0), { currency: 'mld', decimals: 2 })}
                    tone={Number(resources.debt ?? 0) > 0 ? 'warning' : 'positive'}
                    hint={Number(resources.debt ?? 0) > 0
                      ? `Su un tetto di ${formatMoney(Number(resources.creditLimit ?? 0), { currency: 'mld', decimals: 0 })}`
                      : 'Nessun debito: si può ancora andare a debito'}
                  />
                  <Metric
                    label="Credito residuo"
                    value={formatMoney(Number(resources.creditHeadroom ?? 0), { currency: 'mld', decimals: 2 })}
                    tone={Number(resources.creditHeadroom ?? 0) > 0 ? 'positive' : 'negative'}
                    hint="Spazio per nuove spese a debito"
                  />
                </MetricGrid>
              ) : (
                <EmptyState>Il magazzino materiale non è ancora pubblicato per questa partita.</EmptyState>
              )}
              <Footnote><b>Fonte</b> MaterialEconomy · il movimento consuma cibo e, se motorizzato, carburante.</Footnote>
            </DossierBlock>

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
              description="Le infrastrutture che sostengono crescita e logistica."
            >
              <MetricGrid>
                <Metric label="Province" value={formatNumber(assets.provinces)} />
                <Metric label="Fabbriche" value={formatNumber(assets.factories)} />
                <Metric label="Porti" value={formatNumber(assets.ports)} />
                <Metric label="Città e capitali" value={formatNumber(assets.cities)} />
              </MetricGrid>
              <Footnote><b>Fonte</b> Conto nazionale quando disponibile; altrimenti oggetti delle regioni possedute. Stock e flussi non vengono inventati.</Footnote>
            </DossierBlock>
          </>
        )}

        {active === 'armamenti' && (
          <>
            <DossierBlock
              title="Forza dell'arsenale"
              description="Quantità possedute, qualità e capacità industriale della nazione."
            >
              {arms ? (
                <MetricGrid>
                  <Metric label="Forza militare" value={formatNumber(arms.strength)} tone="neutral" hint="Quantità × qualità × dominio" />
                  <Metric label="Potenza effettiva" value={formatNumber(arms.effectiveMilitaryPower)} tone={arms.combatFactor >= 1 ? 'positive' : 'warning'} hint={`Base ${formatNumber(arms.baseMilitaryPower)} × fattore arsenale ${arms.combatFactor}`} />
                  <Metric label="Qualità media armi" value={`${formatNumber(arms.qualityIndex)}/100`} tone={arms.qualityIndex >= 60 ? 'positive' : arms.qualityIndex >= 30 ? 'warning' : 'negative'} hint="Pesa sui combattimenti" />
                  <Metric label="Fabbriche" value={formatNumber(arms.capacity.factories)} hint="Industria meccanica e bellica" />
                  <Metric label="Porti / cantieri" value={formatNumber(arms.capacity.ports)} hint="Costruzione navale" />
                  <Metric label="Università" value={formatNumber(arms.capacity.universities)} hint="Ricerca e sviluppo" />
                  <Metric label="Tesoreria" value={formatMoney(Number(arms.capacity.money), { currency: 'mld', decimals: 2, sign: true })} tone={Number(arms.capacity.money) >= 0 ? 'neutral' : 'warning'} hint="Budget per gli acquisti" />
                  <Metric label="Debito pubblico" value={formatMoney(Number(arms.debt ?? 0), { currency: 'mld', decimals: 2 })} tone={Number(arms.debt ?? 0) > 0 ? 'warning' : 'positive'} hint={`Tetto di credito ${formatMoney(Number(arms.creditLimit ?? 0), { currency: 'mld', decimals: 0 })}`} />
                  <Metric label="Credito residuo" value={formatMoney(Number(arms.capacity.credit ?? 0), { currency: 'mld', decimals: 2 })} tone={Number(arms.capacity.credit ?? 0) > 0 ? 'positive' : 'negative'} hint="Spazio per costruire a debito" />
                  <Metric label="Scorte armamenti" value={formatNumber(arms.capacity.weapons)} hint="Input per la produzione" />
                </MetricGrid>
              ) : (
                <EmptyState>Arsenale non ancora pubblicato per questa partita.</EmptyState>
              )}
              <Footnote><b>Fonte</b> MilitaryIndustry · valori letti dal motore, non stimati nel browser.</Footnote>
            </DossierBlock>

            <DossierBlock
              title="Arsenale"
              description="Equipaggiamento in servizio, con la fascia di qualità."
            >
              {arms && arms.lines.length > 0 ? (
                <ul className="arms-list">
                  {arms.lines.map((line) => (
                    <li key={line.id}>
                      <div>
                        <b>{line.name}</b>
                        <span>{DOMAIN_LABELS[line.domain] || line.domain} · {line.category}</span>
                      </div>
                      <div className="arms-line-meta">
                        <em>×{formatNumber(line.quantity)}</em>
                        <span className={`arms-tier tone-${TIER_TONE[line.tier] || 'neutral'}`}>{line.tier.replace(/_/g, ' ')} · {line.quality}</span>
                      </div>
                    </li>
                  ))}
                </ul>
              ) : (
                <EmptyState>Nessun equipaggiamento in servizio: costruisci o importa dal catalogo.</EmptyState>
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
                      <div className="arms-production-head">
                        <b>{order.name}</b>
                        <span>×{formatNumber(order.quantity)} · {order.progress}%</span>
                      </div>
                      <div
                        className="arms-progress"
                        role="progressbar"
                        aria-valuemin={0}
                        aria-valuemax={100}
                        aria-valuenow={order.progress}
                        aria-label={`Avanzamento ${order.name}`}
                      >
                        <span style={{ width: `${Math.max(0, Math.min(100, order.progress))}%` }} />
                      </div>
                      <em className="arms-production-meta">
                        {order.status === 'failed'
                          ? `fallita${order.note ? ` · ${order.note}` : ''}`
                          : `${DOMAIN_LABELS[order.domain] || order.domain} · avviata ${order.startedDate}${order.qualityLoss > 0 ? ` · ${Math.round(order.qualityLoss)}% difettose` : ''}${order.note ? ` · ${order.note}` : ''}`}
                      </em>
                    </li>
                  ))}
                </ul>
              ) : (
                <EmptyState>Nessun ordine in corso: le costruzioni avviate compariranno qui con la percentuale di completamento.</EmptyState>
              )}
            </DossierBlock>

            <DossierBlock
              title="Produzione e acquisti"
              description="Costruisci con tecnologia, industria e risorse proprie, oppure importa pagando un sovrapprezzo."
            >
              {arms ? (
                <div className="arms-catalog">
                  {['terra', 'aria', 'mare', 'missili', 'droni'].map((domain) => (
                    <div key={domain} className="arms-domain">
                      <h4>{DOMAIN_LABELS[domain]}</h4>
                      <ul>
                        {arms.catalog.filter((item) => item.domain === domain).map((item) => (
                          <li key={item.id}>
                            <div className="arms-item-head">
                              <b>{item.name}</b>
                              <span className={`arms-tier tone-${TIER_TONE[item.tier] || 'neutral'}`}>{item.tier.replace(/_/g, ' ')} · qualità {item.quality}</span>
                            </div>
                            <div className="arms-item-cost">
                              Costruzione {formatMoney(item.buildCostMln / 1000, { currency: 'mld', decimals: 3 })}
                              {' · '}Importazione {formatMoney(item.buyCostMln / 1000, { currency: 'mld', decimals: 3 })}
                            </div>
                            {!item.canBuild && item.reasons.length > 0 && (
                              <div className="arms-reasons">Manca: {item.reasons.join(', ')}</div>
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
              <Footnote><b>Fonte</b> MilitaryIndustry · la costruzione aggiorna scorte e arsenale in modo atomico.</Footnote>
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
                    <li key={tech}><b>{tech.replace(/_/g, ' ')}</b><span>Ricerca applicata e disponibile per l'economia e le forze armate.</span></li>
                  ))}
                </ul>
              ) : (
                <EmptyState>Nessuna tecnologia sbloccata: accumula punti ricerca con università e popolazione.</EmptyState>
              )}
              <Footnote><b>Fonte</b> Catalogo tecnologie del motore · la ricerca si accumula a ogni tick del mondo.</Footnote>
            </DossierBlock>

            <DossierBlock
              title="Conoscenze e personale"
              description="Capitale umano e capacità formative disponibili."
            >
              <MetricGrid>
                <Metric label="Popolazione" value={formatNumber(assets.population)} />
                <Metric label="Università" value={formatNumber(assets.universities)} />
                <Metric label="Unità e forze" value={formatNumber(assets.forces)} />
                <Metric label="PIL pro capite" value={account?.gdpPerCapitaUsd != null ? formatMoney(Number(account.gdpPerCapitaUsd), { currency: '$', decimals: 0 }) : '—'} />
              </MetricGrid>
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
                <Metric label="Territorio amministrato" value={`${formatNumber(assets.provinces)} province`} />
                <Metric label="Processi attivi" value={formatNumber(ongoingProcesses.length)} />
              </MetricGrid>
            </DossierBlock>

            <DossierBlock
              title="Coesione interna"
              description="Il consenso e la pressione sociale sul governo."
            >
              <MetricGrid>
                <Metric label="Stabilità" value={formatPercent(stability)} tone={stabilityTone(stability)} />
                <Metric label="Tensione sociale" value={formatPercent(socialTension)} tone={tensionTone(socialTension)} />
              </MetricGrid>
            </DossierBlock>

            <Footnote>Mandati e servizi saranno mostrati qui solo quando il read model ne pubblicherà stato e responsabilità.</Footnote>
          </>
        )}
      </div>
    </div>
  );
};

export default NationDock;
