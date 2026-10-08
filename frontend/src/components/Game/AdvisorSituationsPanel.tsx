/**
 * WS-CONSULENTE-SITUAZIONI — Le SITUAZIONI cliccabili del Consulente.
 *
 * Una situazione è un problema/opportunità da approfondire: la card apre la
 * discussione col Consulente («Approfondisci») e NON il Consiglio. Solo una
 * `CouncilIssue` ha il pulsante «Porta al Consiglio».
 *
 * T03 — Dal 2026-10-08 la situazione può portare le sue MOSSE (`options`), con
 * la stessa forma delle proposte. Allora la card le rende come
 * `CouncilIssueInline` già fa — card cliccabili, `aria-pressed`, titolo e
 * contenuto — e accanto compare «Porta al Consiglio», che chiama lo stesso
 * `onOpenIssue`. **Solo se le mosse esistono**: una situazione senza mosse non
 * mostra un pulsante che promette un atto che non c'è (`T-I3`).
 *
 * La presentazione è una «scrivania del Presidente»: badge di importanza
 * testuale (mai solo colore), titolo concreto, sintesi breve, azione chiara.
 */
import { useState } from 'react';
import type { AdvisorSituation, AdvisorSituationFocus, CouncilIssue } from '../../services/api';

/** Il testo che «Approfondisci» invia al Consulente: la situazione diventa il
 *  focus della discussione. È solo conversazione, non fonte: i riferimenti
 *  canonici viaggiano separatamente in `focusSituation`. */
export function buildSituationFocusMessage(situation: AdvisorSituation): string {
  return `Approfondiamo la situazione «${situation.title}».`;
}

const cleanKeys = (keys: readonly string[] | undefined): string[] =>
  [...new Set((keys ?? []).map(key => key.trim()).filter(key => key.length > 0))];

/** Focus canonico inviato al server: SOLO id e riferimenti (segnali/prove),
 *  mai titolo o sintesi. Una situazione evidence-only resta approfondibile.
 *  `undefined` quando non c'è alcun riferimento canonico da mandare. */
export function buildSituationFocusPayload(situation: AdvisorSituation): AdvisorSituationFocus | undefined {
  const signalKeys = cleanKeys(situation.signalKeys);
  const evidenceKeys = cleanKeys(situation.evidenceKeys);
  if (!situation.id || (!signalKeys.length && !evidenceKeys.length)) return undefined;
  return {
    id: situation.id,
    ...(signalKeys.length ? { signalKeys } : {}),
    ...(evidenceKeys.length ? { evidenceKeys } : {}),
  };
}

/**
 * T03 — La situazione diventa una PROPOSTA portabile, e solo quando ha le mosse.
 *
 * Perché serve un adattatore e non un tipo comune: `AdvisorSituation` NON è una
 * `CouncilIssue`. Le mancano i fatti verificati, i ministri, la data, l'origine —
 * cioè esattamente ciò che il server pretende per accettare una proposta. Il
 * server NON è stato toccato: qui si prepara la sola forma che `onOpenIssue`
 * riceve, col testo della mossa scelta. Chi firma resta `GovernmentOffice`.
 *
 * Restituisce `undefined` per una situazione **senza** mosse: nessuna proposta
 * da portare, nessun pulsante. È l'invariante T-I3 reso impossibile da violare
 * per costruzione, non per disciplina.
 */
export function situationAsPortableIssue(situation: AdvisorSituation): CouncilIssue | undefined {
  if (!situation.options?.length) return undefined;
  return {
    id: situation.id,
    title: situation.title,
    // La domanda è la sola cosa che il client può dire senza inventare: la
    // situazione si presenta come scelta fra le sue mosse. Il server, quando la
    // porta in Consiglio, ricostruisce i fatti dai suoi riferimenti canonici.
    question: `Quale strada scegliamo su «${situation.title}»?`,
    ...(situation.options ? { options: situation.options } : {}),
    // `verifiedFacts` vuoto: il client non è mai la fonte dei fatti. I riferimenti
    // canonici (signalKeys/evidenceKeys) restano sulla situazione, che li manda
    // al server via `focusSituation`; la proposta li porta per completezza di tipo.
    verifiedFacts: [],
    ...(situation.signalKeys?.length ? { signalKeys: situation.signalKeys } : {}),
    suggestedMinisters: [],
    origin: 'advisor',
    sourceRefs: [],
    createdDate: '',
  };
}

/** Etichetta testuale dell'importanza: 3 Urgente, 2 Da seguire, 1 Opportunità.
 *  Il testo è leggibile anche senza colore (accessibilità). */
export function importanceLabel(importance: number): string {
  if (importance >= 3) return 'Urgente';
  if (importance === 2) return 'Da seguire';
  return 'Opportunità';
}

export interface AdvisorSituationsPanelProps {
  situations: AdvisorSituation[];
  onDeepen: (situation: AdvisorSituation) => void;
  /** T03 — Lo stesso gestore delle proposte: porta la situazione al Consiglio
   *  con la mossa scelta. Assente per i chiamanti che non aprono sedute. */
  onOpenIssue?: (issue: CouncilIssue, chosenOption?: { title: string; content: string }) => void;
  /** Situazione attualmente in esame: la card assume lo stato `.active`. */
  activeId?: string;
  disabled?: boolean;
}

export function AdvisorSituationsPanel({ situations, onDeepen, onOpenIssue, activeId, disabled = false }: AdvisorSituationsPanelProps) {
  // P02/T03 — la mossa scelta è una preferenza di PRESENTAZIONE: non invia nulla
  // e non modifica il mondo. Il clic riempie la bozza nella stanza. Una sola
  // mossa per volta, per l'intero pannello: la scelta è del Presidente.
  const [chosen, setChosen] = useState<{ situationId: string; index: number } | null>(null);
  if (!situations.length) return null;
  return <section className="advisor-situations" aria-label="Situazioni sul tavolo" data-many={situations.length > 6 ? 'true' : undefined}>
    <header className="advisor-situations-header">
      <h4 className="advisor-situations-heading">Situazioni sul tavolo</h4>
      <p className="advisor-situations-subheading">Questioni che richiedono attenzione</p>
    </header>
    <ul className="advisor-situation-list">
      {situations.map(situation => {
        const active = activeId === situation.id;
        const options = situation.options ?? [];
        const portable = situationAsPortableIssue(situation);
        const selected = chosen?.situationId === situation.id ? chosen.index : null;
        return <li key={situation.id}
          className={`advisor-situation-card${active ? ' active' : ''}`}
          data-situation-id={situation.id} data-importance={situation.importance}>
          <span className="advisor-situation-severity" data-importance={situation.importance}>{importanceLabel(situation.importance ?? 1)}</span>
          <h5 className="advisor-situation-title">{situation.title}</h5>
          <p className="advisor-situation-summary">{situation.summary}</p>
          {/* T03 — le mosse, rese come in CouncilIssueInline. */}
          {options.length > 0 && <ul className="advisor-situation-options" aria-label="Mosse proposte">
            {options.map((option, index) => (
              <li key={`${situation.id}-opt-${index}`}>
                <button
                  type="button"
                  className={`advisor-option${selected === index ? ' is-chosen' : ''}`}
                  aria-pressed={selected === index}
                  disabled={disabled}
                  onClick={() => setChosen(selected === index ? null : { situationId: situation.id, index })}
                >
                  <span className="advisor-option-title">{option.title}</span>
                  <span className="advisor-option-content">{option.content}</span>
                </button>
              </li>
            ))}
          </ul>}
          <button type="button" className="advisor-situation-deepen" disabled={disabled}
            aria-label={`Approfondisci: ${situation.title}`}
            onClick={() => onDeepen(situation)}>Approfondisci <span aria-hidden="true">→</span></button>
          {/* T-I3 — il pulsante esiste SOLO con le mosse. `portable` è `undefined`
              esattamente quando non ce ne sono: la guardia è nel tipo, non qui. */}
          {portable && onOpenIssue && <button
            type="button"
            className="council-issue-open advisor-situation-open"
            disabled={disabled}
            onClick={() => onOpenIssue(portable, selected === null ? undefined : options[selected])}
          >Porta al Consiglio</button>}
        </li>;
      })}
    </ul>
  </section>;
}

export default AdvisorSituationsPanel;
