/**
 * World Story — Dossier Nazione: componenti presentazionali
 * ========================================================
 * Estratti da `NationDock.tsx` (blocco 2, punto 4): comportamento invariato.
 */
import React, { useState } from 'react';
import type {
  BudgetLine, CrisisRisk, CrisisSnapshot, GovernmentFaction,
  Commitment, NaturalResourceSummary, PeacetimePressure, PowerAgenda, SovereignDebtTranche,
} from '../../../services/api';
import { formatNumber, formatPercent } from '../../../utils/format';
import { money as formatMld, index } from './format';
import { sparkPoints, trendLabel, type Trend, type TrendTone } from '../accountTrend';
import { CRISIS_LEVEL_LABEL, crisisDaysText } from '../crisisPanel';
import { PRESSURE_PRIORITY_LABEL, pressureWindowText, pressureWindowTone, splitPressuresByAttention } from '../pressureWindow';
import {
  LEVER_LABEL, STANCE_LABEL, factionOrderText, pressureLabel, pressureTone,
  factionMemoryView, satisfactionTone, stanceTone, type NationalVerdict,
} from '../governmentDossier';
import { agendasWithObjectives, objectivePriorityTone, objectiveProgressTone, objectiveSummary } from '../powersAgenda';
import {
  activeCommitmentsOf, commitmentPartiesText, commitmentStatusLabel, commitmentTimingText,
  commitmentTone, commitmentTypeLabel, sortCommitments,
} from '../commitments';
import { formatDate } from './format';
import type { MetricTrend, Tone } from './types';

/** Micro-grafico SVG della serie storica. Nessuna libreria esterna. */
export function Sparkline({ trend, tone }: { trend: Trend; tone: TrendTone }) {
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

export function Metric({
  label,
  value,
  tone = 'neutral',
  hint,
  trend,
  hero = false,
  onClick,
}: {
  label: string;
  value: string;
  tone?: Tone;
  hint?: string;
  trend?: MetricTrend;
  hero?: boolean;
  /**
   * Rimando alla sezione dove la cifra è spiegata nel dettaglio. Presente solo
   * quando la metrica è una **sintesi** di un'altra («una cifra, un posto»):
   * la cifra resta qui, il contesto sta di là. Senza `onClick` la metrica è
   * statica — la maggioranza dei casi.
   */
  onClick?: () => void;
}) {
  const interactive = typeof onClick === 'function';
  const content = (
    <>
      <small>{label}</small>
      <b>{value}</b>
      {trend?.trend && (
        <span className={`nation-trend nation-trend-${trend.tone}`}>
          <Sparkline trend={trend.trend} tone={trend.tone} />
          <em>{`${trend.deltaText} ${trendLabel(trend.trend.dates)}`}</em>
        </span>
      )}
      {hint && <em className="nation-metric-hint">{hint}</em>}
    </>
  );
  const className = `nation-metric tone-${tone}${hero ? ' nation-metric-hero' : ''}`;
  if (!interactive) return <div className={className}>{content}</div>;
  return (
    <button type="button" className={`${className} is-link`} onClick={onClick} aria-label={`${label}: apri il dettaglio`}>
      {content}
    </button>
  );
}

export function MetricGrid({ children }: { children: React.ReactNode }) {
  return <div className="nation-metric-grid">{children}</div>;
}


/** Blocco tematico: titolo + eventuale descrizione + corpo. */
export function DossierBlock({
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

export function Footnote({ children }: { children: React.ReactNode }) {
  return <p className="nation-footnote">{children}</p>;
}

/**
 * Riga di mercato per una risorsa: quantità + vendita/acquisto. Il componente
 * tiene la propria quantità, così ogni risorsa ha un controllo indipendente.
 */
export function ResourceTradeRow({
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


/**
 * Avanzamento leggibile: percentuale in evidenza, barra e nota.
 * Un progetto senza stato si legge come «in corso», mai come un numero muto.
 */
export function ProgressRow({ label, percent, note, status }: {
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

export function EmptyState({ children }: { children: React.ReactNode }) {
  return <div className="nation-empty" role="note">{children}</div>;
}

/** Barra sottile per quote, soddisfazione e pressione (sola presentazione). */
export function ShareBar({ value, tone = 'neutral' }: { value: number; tone?: Tone }) {
  const width = Math.max(0, Math.min(100, Number.isFinite(value) ? value : 0));
  return (
    <span className={`nation-share-bar tone-${tone}`} aria-hidden="true">
      <i style={{ width: `${width}%` }} />
    </span>
  );
}

/** Ripartizione di entrate o uscite: ogni voce con importo e quota. */
export function BudgetBreakdown({ title, lines, total, kind }: {
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
        <b>{formatMld(total, 2, { sign: true })}</b>
      </div>
      <ul className="nation-budget-list">
        {lines.map((line) => (
          <li key={line.id} className="nation-budget-row">
            <div className="nation-budget-label">
              <span>{line.label}</span>
              <em>{formatPercent(line.sharePct, 1)}</em>
            </div>
            <ShareBar value={line.sharePct} tone={kind === 'revenue' ? 'positive' : 'neutral'} />
            <b className="nation-budget-amount">{formatMld(line.amount, 2)}</b>
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
export function DebtPortfolio({ tranches, total }: { tranches: SovereignDebtTranche[]; total: number }) {
  if (tranches.length === 0) return null;
  const ordered = [...tranches].sort((a, b) => a.maturityDate.localeCompare(b.maturityDate));
  return (
    <ul className="nation-debt-list">
      {ordered.map((tranche) => (
        <li key={tranche.id} className="nation-debt-row">
          <div className="nation-debt-head">
            <span>{tranche.label}</span>
            <b>{formatMld(tranche.principal, 2)}</b>
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
export function VerdictBanner({ verdict }: { verdict: NationalVerdict }) {
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

/** Sfide del momento: il motore le genera, il giocatore decide la risposta. */
/**
 * Crisi nazionale: le tre strade del collasso (rivolta, default, invasione)
 * con punteggio, fattori reali e turni di criticità già accumulati. Sono cifre
 * del motore: il browser non stima nulla.
 */
export function CrisisBlock({ crisis }: { crisis?: CrisisSnapshot | null }) {
  if (!crisis) {
    return <EmptyState>Il motore non ha ancora valutato la tenuta della nazione.</EmptyState>;
  }
  const { state, finished, ending, collapseDays } = crisis;
  return (
    <div className="nation-crisis">
      <p className={`nation-crisis-headline level-${state.level}`}>{state.headline}</p>
      <p className="nation-crisis-summary">{state.summary}</p>
      <ul className="nation-crisis-risks">
        {state.risks.map((risk: CrisisRisk) => {
          const days = Number(state.criticalDays?.[risk.dimension] ?? 0);
          return (
            <li key={risk.dimension} className={`nation-crisis-risk level-${risk.level}`}>
              <div className="nation-crisis-risk-head">
                <b>{risk.title}</b>
                <span className={`nation-crisis-badge level-${risk.level}`}>
                  {CRISIS_LEVEL_LABEL[risk.level]} · {formatNumber(risk.score)}/100
                </span>
              </div>
              <div
                className="nation-crisis-bar"
                role="img"
                aria-label={`${risk.title}: ${formatNumber(risk.score)} su 100`}
              >
                <span style={{ width: `${Math.min(100, Math.max(0, risk.score))}%` }} />
              </div>
              <p>{risk.detail}</p>
              <span className="nation-crisis-drivers">{risk.drivers.join(' · ')}</span>
              {risk.level !== 'calm' && (
                <span className={`nation-crisis-streak${risk.level === 'watch' ? ' is-watch' : ''}`}>
                  {crisisDaysText(risk, days, collapseDays ?? state.collapseDays ?? 90)}
                </span>
              )}
            </li>
          );
        })}
      </ul>
      {finished && ending && (
        <p className="nation-crisis-ending">
          La partita è finita: {ending.title}. {ending.summary}
        </p>
      )}
    </div>
  );
}

export function PressuresBlock({ pressures, recent, onResolve, busy, money }: {
  pressures: PeacetimePressure[];
  recent: PeacetimePressure[];
  onResolve?: (pressureId: string, optionId: string) => Promise<void>;
  busy?: boolean;
  money?: number;
}) {
  const [choice, setChoice] = useState<Record<string, string>>({});
  if (pressures.length === 0) {
    return (
      <div className="nation-pressures">
        <EmptyState>Nessuna sfida aperta: il turno è sotto controllo. Le prossime arriveranno con il tempo.</EmptyState>
        {recent.length > 0 && (
          <details className="nation-pressure-recent">
            <summary>Ultime sfide chiuse</summary>
            <ul>
              {recent.map((pressure) => (
                <li key={pressure.id}>
                  <b>{pressure.title}</b>
                  <span>{pressure.resolution || (pressure.status === 'expired' ? 'Ignorata: la conseguenza è arrivata da sola.' : 'Chiusa.')}</span>
                </li>
              ))}
            </ul>
          </details>
        )}
      </div>
    );
  }
  // P2: solo le questioni che meritano attenzione occupano la scena; le altre
  // restano nella stessa scheda, raggruppate e consultabili.
  const { highlighted, dossier } = splitPressuresByAttention(pressures);
  const renderPressureCard = (pressure: PeacetimePressure) => {
    const selected = choice[pressure.id] ?? pressure.options[0]?.id ?? '';
    const option = pressure.options.find((item) => item.id === selected);
    const cost = Number(option?.effect?.moneyDeltaMld || 0);
    const unaffordable = cost < 0 && typeof money === 'number' && money + cost < 0;
    // GAMEPLAY-LONG: la finestra temporale dice quanto tempo resta prima che
    // l'inerzia presenti il conto; la priorità dice se merita attenzione.
    const deadlineText = pressureWindowText(pressure.window);
    const tone = pressureWindowTone(pressure.window);
    return (
      <li key={pressure.id} className={`nation-pressure-card kind-${pressure.kind} severity-${pressure.severity}${pressure.highlighted === false ? ' is-dossier' : ''}`}>
        <div className="nation-pressure-head">
          <span className="nation-pressure-kind">
            {pressure.kind === 'internal' ? 'Interna' : 'Esterna'} · gravità {pressure.severity}/3
            {pressure.priority ? ` · ${PRESSURE_PRIORITY_LABEL[pressure.priority] ?? pressure.priority}` : ''}
          </span>
          <b>{pressure.title}</b>
        </div>
        {deadlineText && (
          <span className={`nation-pressure-window${tone ? ` tone-${tone}` : ''}`}>{deadlineText}</span>
        )}
        <p>{pressure.detail}</p>
        <span className="nation-pressure-source">Chi preme: {pressure.source}</span>
              <div className="nation-pressure-options" role="radiogroup" aria-label={`Risposta a ${pressure.title}`}>
                {pressure.options.map((item) => (
                  <label key={item.id} className={item.id === selected ? 'is-selected' : ''}>
                    <input
                      type="radio"
                      name={`pressure-${pressure.id}`}
                      value={item.id}
                      checked={item.id === selected}
                      disabled={busy}
                      onChange={() => setChoice((previous) => ({ ...previous, [pressure.id]: item.id }))}
                    />
                    <span><b>{item.label}</b><em>{item.detail}</em></span>
                  </label>
                ))}
              </div>
              <div className="nation-pressure-actions">
                <button
                  type="button"
                  onClick={() => selected && void onResolve?.(pressure.id, selected)}
                  disabled={busy || !selected || unaffordable || !onResolve}
                >{busy ? 'Applico…' : 'Decidi'}</button>
                {cost < 0 && (
                  <em className={unaffordable ? 'is-negative' : ''}>
                    Costo {formatMld(Math.abs(cost), 2)}{unaffordable ? ' · cassa insufficiente' : ''}
                  </em>
                )}
                {cost > 0 && <em>Incasso {formatMld(cost, 2)}</em>}
              </div>
            </li>
          );
  };
  return (
    <div className="nation-pressures">
      <ul className="nation-pressure-list">
        {highlighted.map(pressure => renderPressureCard(pressure))}
      </ul>
      {dossier.length > 0 && (
        <details className="nation-pressure-dossier">
          <summary>Altre questioni nel dossier ({dossier.length})</summary>
          <ul className="nation-pressure-list">
            {dossier.map(pressure => renderPressureCard(pressure))}
          </ul>
        </details>
      )}
      {recent.length > 0 && (
        <details className="nation-pressure-recent">
          <summary>Ultime sfide chiuse</summary>
          <ul>
            {recent.map((pressure) => (
              <li key={pressure.id}>
                <b>{pressure.title}</b>
                <span>{pressure.resolution || (pressure.status === 'expired' ? 'Ignorata: la conseguenza è arrivata da sola.' : 'Chiusa.')}</span>
              </li>
            ))}
          </ul>
        </details>
      )}
    </div>
  );
}

/** Una delle anime del governo: interesse, influenza, umore e richiesta. */
export function FactionCard({ faction, dominant, angriest, onDraftOrder, voice, speaking }: {
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
  // GAMEPLAY-LONG: la fazione ricorda come è stata trattata. La soddisfazione
  // resta quella del bilancio; qui si mostra la fiducia politica.
  const memory = factionMemoryView(faction);
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
      {memory && (
        <p className={`nation-faction-memory tone-${memory.tone}`}>
          <span className="nation-memory-kicker">{memory.label}</span>
          {memory.text}
        </p>
      )}
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
export function EquipmentSpecs({ specs }: { specs: Array<{ label: string; value: string }> }) {
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


/**
 * GAMEPLAY-LONG — «Strategie delle potenze»: che cosa stanno inseguendo le
 * nazioni del teatro, da quando e a che punto sono. Sono gli obiettivi del
 * motore: il client li ordina e li veste, non li inventa.
 */
export function PowersAgendaList({ powers, playerPolityId }: {
  powers: PowerAgenda[];
  playerPolityId?: string | null;
}) {
  const ranked = agendasWithObjectives({ powers }, playerPolityId);
  if (ranked.length === 0) {
    return <EmptyState>Nessuna potenza del teatro ha una strategia in corso registrata dal motore.</EmptyState>;
  }
  return (
    <ul className="nation-agenda-list">
      {ranked.map((power) => (
        <li key={power.polityId} className="nation-agenda-power">
          <div className="nation-agenda-head">
            <b>{power.name}</b>
            <span>{power.objectives.length === 1 ? '1 obiettivo attivo' : `${power.objectives.length} obiettivi attivi`}</span>
          </div>
          <ul className="nation-agenda-objectives">
            {[...power.objectives].sort((a, b) => b.priority - a.priority).map((objective) => (
              <li key={objective.id} className={`tone-${objectivePriorityTone(objective.priority)}`}>
                <span className="nation-agenda-goal">{objective.description}</span>
                <span className={`nation-agenda-meta tone-${objectiveProgressTone(objective.progress)}`}>
                  {objectiveSummary(objective)}
                </span>
                <span className="nation-agenda-progress" aria-hidden="true">
                  <i style={{ width: `${Math.max(0, Math.min(100, Math.round(objective.progress)))}%` }} />
                </span>
                <span className="nation-agenda-reason">{objective.reason}</span>
              </li>
            ))}
          </ul>
        </li>
      ))}
    </ul>
  );
}

/**
 * GAMEPLAY-LONG — «Impegni della partita»: trattati, promesse, ultimatum con
 * stato e scadenza. La cronaca racconta, questo registro ricorda.
 */
export function CommitmentsList({ commitments, today }: {
  commitments: Commitment[];
  today: string;
}) {
  const sorted = sortCommitments(commitments, today);
  if (sorted.length === 0) {
    return <EmptyState>Nessun impegno registrato: la partita non ha ancora firmato nulla.</EmptyState>;
  }
  const activeCount = activeCommitmentsOf(sorted).length;
  return (
    <div className="nation-commitments">
      <p className="nation-commitments-summary">
        {activeCount === 1 ? '1 impegno in vigore' : `${activeCount} impegni in vigore`}
        {sorted.length > activeCount ? ` · ${sorted.length - activeCount} conclusi` : ''}
      </p>
      <ul className="nation-commitment-list">
        {sorted.map((commitment) => (
          <li key={commitment.id} className={`nation-commitment tone-${commitmentTone(commitment)}`}>
            <div className="nation-commitment-head">
              <span className="nation-commitment-type">{commitmentTypeLabel(commitment.type)}</span>
              <span className={`nation-commitment-status tone-${commitmentTone(commitment)}`}>
                {commitmentStatusLabel(commitment.status)}
              </span>
            </div>
            <b>{commitment.description}</b>
            <span className="nation-commitment-parties">
              {commitmentPartiesText(commitment)} · importanza {commitment.importance}/3
            </span>
            <span className="nation-commitment-timing">{commitmentTimingText(commitment, today)}</span>
            {commitment.note && <span className="nation-commitment-note">{commitment.note}</span>}
          </li>
        ))}
      </ul>
    </div>
  );
}
