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
  return <DomainCard domain={domain} onOpenSection={onOpenSection} />;
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
