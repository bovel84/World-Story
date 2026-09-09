/**
 * World Story — Dossier Nazione (U03 µ1)
 * ===================================
 * Il dossier (maestro §10.3) è la superficie delle decisioni nazionali,
 * distinta dalla mappa (superficie geografica). Contiene sezioni progressive:
 * Situazione, Progetti, Bilancio, Risorse, Conoscenze, Politiche.
 *
 * µ1 (passo 1):
 *  - architettura a sezioni con default «Situazione» (decisioni richieste);
 *  - la nazione è la POLITY del giocatore, mai rinominata dalla provincia
 *    selezionata sulla mappa;
 *  - denaro/unità/periodi formattati con gli helper condivisi `utils/format`.
 *
 * Le sezioni oltre «Situazione» mostrano uno stato «Da cosa dipende?» con
 * fonte/data dichiarate: i dati reali (progetti M05, ledger M02, risorse M04,
 * conoscenze M01, mandati M07) arrivano nelle µ successive.
 */

import React, { useState } from 'react';
import {
  initialNationDockState,
  setSection,
  NATION_SECTIONS,
  NATION_SECTION_LABEL,
  type NationSection,
} from '../../stores/nationDock';
import { formatMoney, formatNumber, formatPercent } from '../../utils/format';

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
  campaignProgress: number;
  latestNarration: string;
}

/** Stato «Da cosa dipende?» per le sezioni non ancora alimentate (µ1). */
function SectionPlaceholder({ section }: { section: NationSection }) {
  const dependsOn: Record<NationSection, string> = {
    situazione: '—',
    progetti: 'Progetti attivi/bloccati/previsti (M05) e prossima milestone.',
    bilancio: 'Ledger monetario e riserve (M02), entrate/uscite reali e previste.',
    risorse: 'Stock/accesso, filiere, consumi e trasporti (M04).',
    conoscenze: 'Capacità disponibili/mancanti, ricerca e formazione (M01/M05).',
    politiche: 'Mandati/delega, servizi essenziali e istituzioni (M07).',
  };
  return (
    <div className="nation-section-empty" role="note">
      <div className="nation-section-empty-title">{NATION_SECTION_LABEL[section]}</div>
      <p className="nation-section-empty-desc">
        I dati di questa sezione non sono ancora disponibili in questa versione.
      </p>
      <p className="nation-section-depends">
        <b>Da cosa dipende?</b> {dependsOn[section]}
      </p>
    </div>
  );
}

export const NationDock: React.FC<NationDockProps> = ({
  nationalName,
  governmentType,
  account,
  campaignProgress,
  latestNarration,
}) => {
  const [state, setState] = useState(initialNationDockState);
  const active = state.activeSection;

  const population = Number(account?.population ?? 0);
  const gdpBillions = Number(account?.nominalGdpUsdBillions ?? 0);
  const revenue = Number(account?.monthlyRevenue ?? 0);
  const expenses = Number(account?.monthlyExpenses ?? 0);
  const stability = Number(account?.stability ?? 0);
  const provinces = Number(account?.provinces ?? 0);

  return (
    <div className="nation-dock">
      {/* Navigazione a sezioni (una sola attiva). */}
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
            {/* Situazione: decisioni richieste + bollettino essenziale. */}
            <section className="nation-section" aria-label="Decisioni richieste">
              <div className="nation-section-title">Decisioni richieste</div>
              <div className="nation-decisions">
                <div className="nation-decision-empty">
                  Nessuna decisione richiede attenzione immediata.
                </div>
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
                  <span><small>POPOLAZIONE</small><b>{formatNumber(population)}</b></span>
                  <span><small>PIL NOM.</small><b>{formatMoney(gdpBillions, { currency: 'mld', decimals: 1 })}</b></span>
                  <span><small>ENTRATE / MESE</small><b>{formatMoney(revenue, { currency: 'mld', decimals: 2, sign: true })}</b></span>
                  <span><small>USCITE / MESE</small><b>{formatMoney(expenses, { currency: 'mld', decimals: 2, sign: true })}</b></span>
                </div>
                <p className="nation-narration">{latestNarration}</p>
              </div>
              <p className="nation-section-depends">
                <b>Da cosa dipende?</b> Stabilità {formatPercent(stability)} · Province {formatNumber(provinces)} · dati aggregati dal motore (fonte: bollettino nazionale).
              </p>
            </section>
          </>
        )}

        {active !== 'situazione' && <SectionPlaceholder section={active} />}
      </div>
    </div>
  );
};

export default NationDock;
