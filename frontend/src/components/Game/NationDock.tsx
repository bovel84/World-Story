/**
 * World Story — Dossier Nazione (G5-A)
 * ====================================
 * Read model nazionale: espone solo dati già pubblicati dal motore o dalla
 * mappa autorevole; nessun valore economico, tecnologico o istituzionale è
 * stimato nel browser.
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
  monthlyRevenue?: number;
  monthlyExpenses?: number;
  monthlyBalance?: number;
  annualGrowthRate?: number;
  stability?: number;
  nominalGdpUsdBillions?: number;
  gdpPerCapitaUsd?: number;
  government?: string;
}

interface NationDockProps {
  /** Nome della POLITY del giocatore (mai la provincia selezionata). */
  nationalName: string;
  governmentType: string;
  account?: NationAccount | null;
  regions?: Region[];
  ongoingProcesses?: NationalProcess[];
  mandateDecisions?: Array<{ mandateId: string; kind: string; resourceId: string; minStock: string; availableStock: string; shortfall: string; asOfDate: string; status: string }>;
  onAcknowledgeMandateDecision?: (mandateId: string, kind: string) => Promise<void>;
  campaignProgress: number;
  latestNarration: string;
}

function formatDate(value?: string | null): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(value || '');
  if (!match) return value || 'Data non pubblicata';
  const months = ['gen', 'feb', 'mar', 'apr', 'mag', 'giu', 'lug', 'ago', 'set', 'ott', 'nov', 'dic'];
  return `${Number(match[3])} ${months[Number(match[2]) - 1]} ${match[1]}`;
}

function Metric({ label, value, tone }: { label: string; value: string; tone?: 'positive' | 'negative' }) {
  return (
    <span className={`nation-metric${tone ? ` ${tone}` : ''}`}>
      <small>{label}</small><b>{value}</b>
    </span>
  );
}

function NoPublishedData({ children }: { children: React.ReactNode }) {
  return <p className="nation-data-note" role="note">{children}</p>;
}

export const NationDock: React.FC<NationDockProps> = ({
  nationalName,
  governmentType,
  account,
  regions = [],
  ongoingProcesses = [],
  mandateDecisions = [],
  onAcknowledgeMandateDecision,
  campaignProgress,
  latestNarration,
}) => {
  const [state, setState] = useState(initialNationDockState);
  const active = state.activeSection;
  const assets = useMemo(() => summarizeNationalAssets(regions, account), [regions, account]);
  const financeAvailable = hasNationalFinance(account);
  const balance = financeBalance(account);
  const stability = Number(account?.stability ?? 0);
  const growth = Number(account?.annualGrowthRate ?? 0);

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
            <section className="nation-section" aria-label="Decisioni richieste">
              <div className="nation-section-title">Decisioni richieste</div>
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
                ) : <div className="nation-decision-empty">Nessuna decisione richiede attenzione immediata.</div>)}
              </div>
            </section>

            <section className="nation-section" aria-label="Stato della nazione">
              <div className="nation-section-title">Stato della nazione</div>
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
                  <Metric label="POPOLAZIONE" value={formatNumber(assets.population)} />
                  <Metric label="PIL NOM." value={formatMoney(assets.gdpBillions, { currency: 'mld', decimals: 1 })} />
                  <Metric label="ENTRATE / MESE" value={formatMoney(Number(account?.monthlyRevenue ?? 0), { currency: 'mld', decimals: 2, sign: true })} />
                  <Metric label="USCITE / MESE" value={formatMoney(Number(account?.monthlyExpenses ?? 0), { currency: 'mld', decimals: 2, sign: true })} />
                </div>
                <p className="nation-narration">{latestNarration}</p>
              </div>
              <p className="nation-section-depends"><b>Fonte</b> Conto nazionale e mappa autorevole · Stabilità {formatPercent(stability)} · Province {formatNumber(assets.provinces)}.</p>
            </section>
          </>
        )}

        {active === 'progetti' && (
          <section className="nation-section" aria-label="Progetti e processi in corso">
            <div className="nation-section-title">Progetti e processi in corso</div>
            {ongoingProcesses.length === 0 ? (
              <div className="nation-decision-empty">Nessun processo in corso alla data del bollettino.</div>
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
            <NoPublishedData>I processi sono letti dal registro della simulazione: questa sezione non crea né modifica progetti.</NoPublishedData>
          </section>
        )}

        {active === 'bilancio' && (
          <section className="nation-section" aria-label="Bilancio nazionale">
            <div className="nation-section-title">Bilancio nazionale</div>
            {financeAvailable ? (
              <div className="nation-data-grid">
                <Metric label="ENTRATE MENSILI" value={formatMoney(Number(account?.monthlyRevenue ?? 0), { currency: 'mld', decimals: 2, sign: true })} tone="positive" />
                <Metric label="USCITE MENSILI" value={formatMoney(Number(account?.monthlyExpenses ?? 0), { currency: 'mld', decimals: 2, sign: true })} tone="negative" />
                <Metric label="SALDO MENSILE" value={formatMoney(balance, { currency: 'mld', decimals: 2, sign: true })} tone={balance >= 0 ? 'positive' : 'negative'} />
                <Metric label="CRESCITA ANNUA" value={formatPercent(growth)} tone={growth >= 0 ? 'positive' : 'negative'} />
              </div>
            ) : (
              <NoPublishedData>Questo scenario non pubblica ancora voci di bilancio nel conto nazionale.</NoPublishedData>
            )}
            <p className="nation-section-depends"><b>Fonte</b> WorldStateEngine.accounts · valori letti, non stimati dal client.</p>
          </section>
        )}

        {active === 'risorse' && (
          <section className="nation-section" aria-label="Capacità produttive e territoriali">
            <div className="nation-section-title">Capacità produttive e territoriali</div>
            <div className="nation-data-grid">
              <Metric label="PROVINCE" value={formatNumber(assets.provinces)} />
              <Metric label="FABBRICHE" value={formatNumber(assets.factories)} />
              <Metric label="PORTI" value={formatNumber(assets.ports)} />
              <Metric label="CITTÀ E CAPITALI" value={formatNumber(assets.cities)} />
            </div>
            <p className="nation-section-depends"><b>Fonte</b> Conto nazionale quando disponibile; altrimenti oggetti delle regioni possedute. Stock e flussi non vengono inventati.</p>
          </section>
        )}

        {active === 'conoscenze' && (
          <section className="nation-section" aria-label="Conoscenze e personale">
            <div className="nation-section-title">Conoscenze e personale</div>
            <div className="nation-data-grid">
              <Metric label="UNIVERSITÀ" value={formatNumber(assets.universities)} />
              <Metric label="UNITÀ E FORZE" value={formatNumber(assets.forces)} />
              <Metric label="POPOLAZIONE" value={formatNumber(assets.population)} />
              <Metric label="PIL PRO CAPITE" value={account?.gdpPerCapitaUsd != null ? formatMoney(Number(account.gdpPerCapitaUsd), { currency: '$', decimals: 0 }) : 'Non pubblicato'} />
            </div>
            <NoPublishedData>Il catalogo non espone ancora un inventario delle tecnologie: il dossier mostra soltanto capacità e personale già registrati.</NoPublishedData>
          </section>
        )}

        {active === 'politiche' && (
          <section className="nation-section" aria-label="Politiche e istituzioni">
            <div className="nation-section-title">Politiche e istituzioni</div>
            <div className="nation-data-grid">
              <Metric label="FORMA DI GOVERNO" value={governmentType} />
              <Metric label="STABILITÀ" value={formatPercent(stability)} tone={stability >= 50 ? 'positive' : 'negative'} />
              <Metric label="TERRITORIO AMMINISTRATO" value={`${formatNumber(assets.provinces)} province`} />
              <Metric label="PROCESSI ATTIVI" value={formatNumber(ongoingProcesses.length)} />
            </div>
            <NoPublishedData>Mandati e servizi saranno mostrati qui solo quando il read model ne pubblicherà stato e responsabilità.</NoPublishedData>
          </section>
        )}
      </div>
    </div>
  );
};

export default NationDock;
