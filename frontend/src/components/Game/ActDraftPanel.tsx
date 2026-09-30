/**
 * WS-MINISTER-UX-06 — La bozza d'atto sul tavolo
 * ==============================================
 * La strada discussa non entra in coda da sola: diventa una **bozza** che il
 * Presidente legge, corregge e **firma**. Questo pannello è la superficie di quel
 * passaggio:
 *  - dichiara che cosa il motore sa fare della strada (ordine d'opera supportato,
 *    bozza testuale da valutare, funzione assente);
 *  - mostra lo stato **reale** dell'atto (preparato, accodato, eseguito, fallito),
 *    derivato da coda e cronologia — mai da un flag locale «accolta»;
 *  - accoda solo con «Firma e inserisci nel registro», una volta sola: mentre la
 *    richiesta è in volo il pulsante è disabilitato.
 *
 * Non calcola numeri e non firma da sé: la firma è l'atto del Presidente.
 */
import { useState } from 'react';
import { capabilityLabel, type ActStatus, type ProposalActDraft } from './actDraft';

export interface ActDraftPanelProps {
  draft: ProposalActDraft;
  status: ActStatus;
  /** Il chiamante sta già accodando: la firma resta disabilitata. */
  busy?: boolean;
  /** «Modifica proposta» — il testo corretto dal Presidente. */
  onEdit?: (text: string) => void;
  /** «Firma e inserisci nel registro» — accoda secondo la semantica vigente. */
  onSign?: (draft: ProposalActDraft) => Promise<boolean> | void;
  /** Torna alle strade, senza firmare. */
  onCancel?: () => void;
}

export function ActDraftPanel({ draft, status, busy = false, onEdit, onSign, onCancel }: ActDraftPanelProps) {
  const [signing, setSigning] = useState(false);
  const locked = busy || signing;

  const sign = async (): Promise<void> => {
    if (locked || status.state === 'queued' || !onSign) return;
    setSigning(true);
    try {
      await onSign(draft);
    } finally {
      setSigning(false);
    }
  };

  const textId = `act-draft-text-${draft.id.replace(/[^a-zA-Z0-9_-]/g, '-')}`;

  return (
    <section className="act-draft" aria-label="Bozza d'atto" data-state={status.state}>
      <header className="act-draft-head">
        <span className="act-draft-kicker">Bozza d’atto</span>
        <h3 className="act-draft-title">{draft.title}</h3>
        <span className={`act-draft-capability capability-${draft.capability}`}>
          {capabilityLabel(draft.capability)}
        </span>
      </header>

      <p className="act-draft-note">{draft.note}</p>

      <label className="act-draft-label" htmlFor={textId}>Testo dell’atto (modificabile dal Presidente)</label>
      <textarea
        id={textId}
        className="act-draft-text"
        value={draft.text}
        rows={6}
        onChange={event => onEdit?.(event.target.value)}
        disabled={locked || status.state === 'queued'}
      />

      <div className="act-draft-status" role="status" aria-live="polite">
        <span className={`act-draft-state state-${status.state}`}>{status.label}</span>
        <span className="act-draft-status-note">{status.note}</span>
      </div>

      <div className="act-draft-actions">
        <button
          type="button"
          className="act-draft-sign"
          onClick={() => void sign()}
          disabled={locked || status.state === 'queued'}
          title="Firma l’atto e inseriscilo nel registro: da lì lo esegue il motore all’avanzamento del tempo"
        >
          {status.state === 'queued' ? 'Già nel registro' : 'Firma e inserisci nel registro'}
        </button>
        {onCancel && (
          <button type="button" className="act-draft-cancel" onClick={onCancel} disabled={locked}>
            Annulla preparazione
          </button>
        )}
      </div>
    </section>
  );
}

export default ActDraftPanel;
