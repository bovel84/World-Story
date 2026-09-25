/**
 * World Story — COUNTRY-CLARITY: Quadro d'insieme (presentazione)
 * =============================================================
 * Un solo schermo che risponde alle domande del giocatore: come sta il paese,
 * che cosa chiede attenzione, quali sono i cinque domini e le cifre che li
 * riassumono. Non calcola nulla: riceve il read model
 * (`nationalOperatingPicture`) e lo rende leggibile. Nessuna chiamata, nessuna
 * stima, nessun numero inventato.
 */
import React from 'react';
import {
  DOMAIN_STATUS_LABEL,
  statusDossierTone,
  dossierTone,
  type DriverTone,
} from './domainStatus';
import type {
  NationalOperatingPicture,
  OperatingAnswer,
  OperatingDomain,
} from './nationalOperatingPicture';
import { NATION_SECTION_LABEL, type NationSection } from '../../stores/nationDock';

/** Da un dominio alla sezione di dettaglio che lo approfondisce. */
const SECTION_FOR_DOMAIN: Record<OperatingDomain['id'], NationSection> = {
  economia: 'bilancio',
  risorse: 'risorse',
  industria: 'risorse',
  militare: 'armamenti',
  // M01 — il benessere del popolo si approfondisce in Conoscenze (atenei,
  // ricerca, tecnologie) e in Politiche (coesione interna): la destinazione
  // naturale è Conoscenze, dove vivono capitale umano e ricerca.
  popolo: 'conoscenze',
  governo: 'governo',
};

const tone = (value: DriverTone) => `tone-${dossierTone(value)}`;
/** Tono CSS già tradotto (per gli stati di dominio). */
const cssTone = (value: 'positive' | 'warning' | 'negative' | 'neutral') => `tone-${value}`;

export function DomainCard({ domain, onOpenSection }: {
  domain: OperatingDomain;
  onOpenSection?: (section: NationSection) => void;
}) {
  const section = SECTION_FOR_DOMAIN[domain.id];
  const problems = domain.drivers.filter(driver => driver.tone !== 'positive').slice(0, 3);
  return (
    <article className={`op-domain ${cssTone(statusDossierTone(domain.status))}`} aria-label={domain.label}>
      <header className="op-domain-head">
        <span className="op-domain-name">{domain.label}</span>
        <span className={`op-status ${cssTone(statusDossierTone(domain.status))}`}>
          {DOMAIN_STATUS_LABEL[domain.status]}
        </span>
      </header>
      <p className="op-domain-headline">{domain.headline}</p>
      <dl className="op-facts">
        {domain.facts.map(fact => (
          <div key={fact.label} className={fact.tone ? tone(fact.tone) : undefined}>
            <dt>{fact.label}</dt>
            <dd>{fact.value}</dd>
          </div>
        ))}
      </dl>
      {problems.length > 0 && (
        <ul className="op-drivers">
          {problems.map(driver => (
            <li key={`${driver.label}-${driver.detail ?? ''}`} className={tone(driver.tone)}>
              <b>{driver.label}</b>
              {driver.detail && <em>{driver.detail}</em>}
            </li>
          ))}
        </ul>
      )}
      {onOpenSection && (
        <button type="button" className="op-goto" onClick={() => onOpenSection(section)}>
          Apri {NATION_SECTION_LABEL[section]}
        </button>
      )}
    </article>
  );
}

export function AnswersGrid({ answers }: { answers: OperatingAnswer[] }) {
  return (
    <div className="op-answers">
      {answers.map(answer => (
        <div key={answer.id} className={`op-answer ${tone(answer.tone)}`}>
          <small>{answer.question}</small>
          <b>{answer.answer}</b>
          {answer.detail && <em>{answer.detail}</em>}
        </div>
      ))}
    </div>
  );
}

/** Blocco compatto per le sezioni di dettaglio: un dominio, gli stessi numeri. */
export function DomainOperatingBlock({ picture, id, onOpenSection }: {
  picture: NationalOperatingPicture;
  id: OperatingDomain['id'];
  onOpenSection?: (section: NationSection) => void;
}) {
  const domain = picture.domains.find(item => item.id === id);
  if (!domain) return null;
  return (
    <>
      <DomainCard domain={domain} onOpenSection={onOpenSection} />
      {id === 'militare' && <MilitaryForceDetail picture={picture} />}
      {id === 'industria' && <IndustryDetail picture={picture} />}
    </>
  );
}

const n = (value: number) => new Intl.NumberFormat('it-IT', { maximumFractionDigits: 0 }).format(value);
/** Frazioni di dotazione (0,06 navale per reparto) non vanno arrotondate a zero. */
const num1 = (value: number) => new Intl.NumberFormat('it-IT', { maximumFractionDigits: 1 }).format(value);
const pct = (value: number) => `${new Intl.NumberFormat('it-IT', { maximumFractionDigits: 1 }).format(value)}%`;

/**
 * Scheda delle forze armate: **personale**, **equipaggiamento**, **prontezza**,
 * **dipendenze**. Tutti i numeri sono del motore (dottrina d'epoca compresa):
 * la UI li mette in fila, non li calcola.
 */
export function MilitaryForceDetail({ picture }: { picture: NationalOperatingPicture }) {
  const { manpower, coverage, readiness, establishment, epochLabel } = picture.military;
  if (!manpower && coverage.length === 0 && !readiness) return null;
  return (
    <div className="op-detail">
      {epochLabel && (
        <p className="op-detail-note">
          <b>Dottrina d’epoca: {epochLabel}.</b>{' '}
          {establishment.length > 0
            ? establishment.map(entry => entry.demand === 'personnel_share'
              ? `${entry.label}: ${pct(entry.personnelSharePct ?? 0)} degli uomini in armi`
              : `${entry.label}: ${num1(entry.perFormation ?? 0)} per reparto`).join(' · ') + '.'
            : 'Il motore non pubblica dotazioni di riferimento per questo scenario.'}
        </p>
      )}
      {manpower && (
        <section className="op-detail-block">
          <h4>Personale</h4>
          <dl className="op-facts">
            <div><dt>Uomini in armi</dt><dd>{n(manpower.activePersonnel + manpower.mobilizedPersonnel)}</dd></div>
            <div><dt>In servizio permanente</dt><dd>{n(manpower.activePersonnel)}</dd></div>
            <div><dt>Richiamati</dt><dd>{n(manpower.mobilizedPersonnel)}</dd></div>
            <div><dt>Riserva addestrata</dt><dd>{n(manpower.reservePersonnel)}</dd></div>
            <div><dt>Riservisti richiamabili</dt><dd>{n(manpower.availableReserve)}</dd></div>
            <div><dt>Reparti</dt><dd>{n(manpower.standing)}</dd></div>
            <div><dt>Uomini per reparto</dt><dd>{n(manpower.menPerFormation)}</dd></div>
            <div><dt>Bacino mobilitabile</dt><dd>{n(manpower.eligiblePopulation)}{manpower.eligibleSharePct !== null ? ` (${pct(manpower.eligibleSharePct)} della popolazione)` : ''}</dd></div>
            <div><dt>Richiamo simultaneo massimo</dt><dd>{n(manpower.mobilizationCap)}</dd></div>
            <div><dt>Richiamabili entro il tetto</dt><dd>{n(manpower.mobilizationHeadroom)}</dd></div>
          </dl>
        </section>
      )}
      {coverage.length > 0 && (
        <section className="op-detail-block">
          <h4>Equipaggiamento — copertura per categoria</h4>
          <ul className="op-detail-list">
            {coverage.map(row => (
              <li key={row.id} className={tone(row.tone)}>
                <b>{row.label}</b>
                <span>{pct(row.pct)} · {n(row.actual)} su {n(row.required)}</span>
                {row.missing > 0 && <em>mancano {n(row.missing)} pezzi</em>}
                {row.basis && <small>{row.basis}</small>}
              </li>
            ))}
          </ul>
        </section>
      )}
      {readiness && (
        <section className="op-detail-block">
          <h4>Prontezza operativa — {pct(readiness.readinessPct)}</h4>
          <ul className="op-detail-list">
            {readiness.drivers.map(driver => (
              <li key={`${driver.label}-${driver.detail ?? ''}`} className={tone(driver.tone)}>
                <b>{driver.label}</b>
                {driver.detail && <em>{driver.detail}</em>}
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}

/**
 * Scheda dell'industria: **stabilimenti**, **assegnazioni**, **produzioni**,
 * **manutenzione** — con la capacità occupata che il motore calcola, la
 * saturazione dichiarata e le unità consegnate solo a lavori finiti.
 */
export function IndustryDetail({ picture }: { picture: NationalOperatingPicture }) {
  const industry = picture.industry;
  const military = industry.assignments.filter(item => item.kind === 'produzione');
  const projects = industry.assignments.filter(item => item.kind === 'progetto');
  const maintenance = industry.assignments.filter(item => item.kind === 'manutenzione');
  const productionOrders = industry.productions;
  return (
    <div className="op-detail">
      <section className="op-detail-block">
        <h4>Stabilimenti</h4>
        <dl className="op-facts">
          <div><dt>Stabilimenti censiti</dt><dd>{industry.establishments === null ? '—' : n(industry.establishments)}</dd></div>
          <div><dt>Linee di lavorazione</dt><dd>{n(industry.capacityTotal)}</dd></div>
          <div><dt>Occupate</dt><dd>{n(industry.capacityUsed)} ({pct(industry.usedPct)})</dd></div>
          <div><dt>Libere</dt><dd>{n(industry.capacityFree)}</dd></div>
        </dl>
        {industry.capacityPublished && industry.totalBasis && <p className="op-detail-note">{industry.totalBasis}</p>}
        {industry.blocked ? (
          <p className="op-detail-note tone-negative">
            Produzione bloccata — nessuna capacità industriale disponibile: le lavorazioni non avanzano.
          </p>
        ) : industry.saturated && (
          <p className="op-detail-note tone-negative">
            Domanda {n(industry.demand)} linee: industria satura, il lavoro avanza al {pct(industry.overflowFactor * 100)} del ritmo.
          </p>
        )}
      </section>
      <section className="op-detail-block">
        <h4>Assegnazioni — chi occupa le linee</h4>
        {industry.assignments.length === 0 ? (
          <p className="op-detail-note">Nessuna lavorazione attiva: tutte le linee sono libere.</p>
        ) : (
          <ul className="op-detail-list">
            {[...military, ...projects, ...maintenance].map(item => (
              <li key={item.id} className={item.blocker ? tone('warning') : undefined}>
                <b>{item.label}</b>
                <span>{item.sector} · {n(item.capacityDemand)} linee{item.progressPct !== null ? ` · ${pct(item.progressPct)}` : ''}</span>
                {item.expectedDate && <small>consegna prevista {item.expectedDate}</small>}
                {item.blocker && <em>{item.blocker}</em>}
              </li>
            ))}
          </ul>
        )}
      </section>
      {productionOrders.length > 0 && (
        <section className="op-detail-block">
          <h4>Produzioni militari</h4>
          <ul className="op-detail-list">
            {productionOrders.map(item => (
              <li key={item.id}>
                <b>{item.label} ×{n(item.quantity)}</b>
                <span>
                  {pct(item.progressPct)} avviato · consegnate {n(item.deliveredUnits)} · in lavorazione {n(item.inProgressUnits)}
                  {item.projectedUnits > 0 ? ` · previste ${n(item.projectedUnits)} a fine lavorazione` : ''}
                </span>
                {item.ratePerMonth !== null && <small>ritmo {n(item.ratePerMonth)} unità/mese{item.expectedDate ? ` · consegna ${item.expectedDate}` : ''}</small>}
                {item.limits.length > 0 && <em>limiti: {item.limits.join(' · ')}</em>}
              </li>
            ))}
          </ul>
        </section>
      )}
      {maintenance.length > 0 && (
        <section className="op-detail-block">
          <h4>Manutenzione</h4>
          <ul className="op-detail-list">
            {maintenance.map(item => (
              <li key={item.id} className={item.blocker ? tone('warning') : undefined}>
                <b>{item.label}</b>
                <span>{n(item.capacityDemand)} linee</span>
                <small>{item.detail}</small>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}

export function OperatingPictureBoard({ picture, onOpenSection }: {
  picture: NationalOperatingPicture;
  onOpenSection?: (section: NationSection) => void;
}) {
  return (
    <section className="nation-block op-board" aria-label="Quadro d’insieme">
      <header className="nation-block-head">
        <h3 className="nation-block-title">Quadro d’insieme</h3>
        <p className="nation-block-desc">
          Stato, scorte, composizione, flussi, capacità, utilizzo, dipendenze, collo di bottiglia, trend e azioni:
          dieci domande, un solo schermo. Tutte le cifre vengono dal motore.
        </p>
      </header>

      <div className={`op-verdict ${cssTone(statusDossierTone(picture.status))}`}>
        <span className={`op-status ${cssTone(statusDossierTone(picture.status))}`}>
          {DOMAIN_STATUS_LABEL[picture.status]}
        </span>
        <b>{picture.headline}</b>
        <em>{picture.summary}</em>
      </div>

      {picture.attention.length > 0 && (
        <div className="op-attention">
          <small>Da decidere per primo</small>
          <ul>
            {picture.attention.map(item => (
              <li key={item.label} className={tone(item.tone)}>
                <b>{item.label}</b>
                <span>{item.domain}</span>
                {item.detail && <em>{item.detail}</em>}
              </li>
            ))}
          </ul>
        </div>
      )}

      <div className="op-domains">
        {picture.domains.map(domain => (
          <DomainCard key={domain.id} domain={domain} onOpenSection={onOpenSection} />
        ))}
      </div>

      <AnswersGrid answers={picture.answers} />
    </section>
  );
}
