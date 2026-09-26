/**
 * World Story — il pannello della sintesi (D03 del piano di chiarezza)
 * ====================================================================
 * È la **prima** cosa che si vede aprendo il dossier: il giudizio, la lista
 * unica delle cose da fare e — per ognuna — l'azione minima. Il dettaglio resta
 * una scheda accanto, raggiungibile da qui.
 *
 * Il componente non calcola nulla: rende `nationalSynthesis`, che è un read
 * model. Le cifre del giudizio arrivano dal quadro d'insieme del motore, la
 * lista dalle fonti già pubblicate (crisi, sfide, impegni, progetti).
 */
import React from 'react';
import type { NationalSynthesis, SynthesisItem } from './nationalSynthesis';
import type { DriverTone } from './domainStatus';
import type { NationSection } from '../../stores/nationDock';

/** I toni del dominio usano `critical`; il CSS del dossier usa `negative`. */
const cssTone = (tone: DriverTone): string => (tone === 'critical' ? 'negative' : tone);

const SOURCE_LABEL: Record<SynthesisItem['source'], string> = {
  crisi: 'Crisi',
  sfida: 'Sfida',
  impegno: 'Impegno',
  progetto: 'Progetto',
  sintesi: 'Quadro',
  occasione: 'Occasione',
};

export interface NationalSynthesisPanelProps {
  synthesis: NationalSynthesis;
  /** Apre la sezione di dettaglio dove la voce si approfondisce. */
  onOpenSection?: (section: NationSection) => void;
  /**
   * V01 — apre il pannello **Questioni**, dove le sfide si risolvono. Le voci
   * di tipo «sfida» non portano più a una sezione del dossier (le sfide non ci
   * sono più): portano alla loro casa nuova.
   */
  onOpenQuestions?: () => void;
}

export const NationalSynthesisPanel: React.FC<NationalSynthesisPanelProps> = ({
  synthesis,
  onOpenSection,
  onOpenQuestions,
}) => {
  const { verdict, tone, items, evidence } = synthesis;

  return (
    <section className="nation-synthesis" aria-label="Sintesi della nazione">
      {/* 1. Il giudizio: una frase, non quattro numeri. */}
      <div className={`nation-synthesis-verdict tone-${cssTone(tone)}`}>
        <b>{verdict}</b>
      </div>

      {/* Le cifre che il giudizio riassume, con il rapporto che le rende leggibili. */}
      {evidence.length > 0 && (
        <ul className="nation-synthesis-evidence" aria-label="Cifre del giudizio">
          {evidence.map(fact => (
            <li key={`${fact.label}:${fact.value}`} className={`tone-${cssTone(fact.tone)}`}>
              <small>{fact.label}</small>
              <b>{fact.value}</b>
            </li>
          ))}
        </ul>
      )}

      {/* 2. Una sola lista. Vuota significa vuota: niente riempitivi. */}
      {items.length === 0 ? (
        <p className="nation-synthesis-empty" role="status">
          Nulla richiede la tua attenzione adesso: nessuna crisi, nessuna scadenza aperta.
        </p>
      ) : (
        <>
          <ol className="nation-synthesis-items">
            {items.filter(item => !item.opportunity).map(item => (
              <li key={item.key} className={`tone-${cssTone(item.tone)}`}>
                <div className="nation-synthesis-head">
                  <span className="nation-synthesis-source">{SOURCE_LABEL[item.source]}</span>
                  <b>{item.title}</b>
                  <span className="nation-synthesis-domain">{item.domain}</span>
                </div>
                <p className="nation-synthesis-urgency">{item.urgency}</p>
                {/* 3. L'azione minima. */}
                <p className="nation-synthesis-action"><span aria-hidden="true">→</span> {item.action}</p>
                {/* V01 — una sfida si risolve in Questioni, non nel dossier:
                    il pulsante lo dice e porta là. Le altre voci restano
                    rimandi alla sezione che le spiega. */}
                {item.source === 'sfida' && onOpenQuestions ? (
                  <button
                    type="button"
                    className="nation-synthesis-open"
                    onClick={onOpenQuestions}
                  >
                    Rispondi in Questioni
                  </button>
                ) : onOpenSection && (
                  <button
                    type="button"
                    className="nation-synthesis-open"
                    onClick={() => onOpenSection(item.section)}
                  >
                    Apri il dettaglio
                  </button>
                )}
              </li>
            ))}
          </ol>

          {/* M02 — le occasioni, in un blocco **separato**: un'occasione non è una
              cosa da fare, è una cosa che si può fare. Tenerle distinte evita che
              un invito allo sviluppo sembri una crisi da risolvere. Se non ce ne
              sono, il blocco non compare. */}
          {items.some(item => item.opportunity) && (
            <section className="nation-synthesis-opportunities" aria-label="Occasioni di sviluppo">
              <h4 className="nation-synthesis-opportunities-title">Occasioni</h4>
              <p className="nation-synthesis-opportunities-note">
                Non c'è urgenza: sono le vie aperte, se vuoi investire nel paese.
              </p>
              <ul className="nation-synthesis-items">
                {items.filter(item => item.opportunity).map(item => (
                  <li key={item.key} className={`tone-${cssTone(item.tone)}`}>
                    <div className="nation-synthesis-head">
                      <span className="nation-synthesis-source">{SOURCE_LABEL[item.source]}</span>
                      <b>{item.title}</b>
                      <span className="nation-synthesis-domain">{item.domain}</span>
                    </div>
                    <p className="nation-synthesis-urgency">{item.urgency}</p>
                    <p className="nation-synthesis-action"><span aria-hidden="true">→</span> {item.action}</p>
                    {onOpenSection && (
                      <button
                        type="button"
                        className="nation-synthesis-open"
                        onClick={() => onOpenSection(item.section)}
                      >
                        Apri il dettaglio
                      </button>
                    )}
                  </li>
                ))}
              </ul>
            </section>
          )}
        </>
      )}
    </section>
  );
};

export default NationalSynthesisPanel;
