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
import { ConsequenceBoardPanel } from './ConsequenceBoardPanel';
import type { ConsequenceBoard as ConsequenceBoardModel } from './consequenceBoard';

export interface ActDraftPanelProps {
  draft: ProposalActDraft;
  status: ActStatus;
  /** Il chiamante sta già accodando: la firma resta disabilitata. */
  busy?: boolean;
  /** P5: dopo il primo invio il candidato resta immutabile per i retry. */
  editable?: boolean;
  signatureNotice?: string;
  /**
   * WS-GOV-MOBILE-FOCUS (H20) — Vista mobile: il testo dell'atto si legge, e
   * `[Modifica]` apre l'editor. Mai una textarea sempre aperta. Il desktop resta
   * invariato (textarea visibile).
   */
  mobile?: boolean;
  /**
   * WS-GOVUX-P7 — La plancia delle conseguenze, calcolata PRIMA della firma:
   * effetti diretti, previsioni, rischi e incertezze, distinti ed etichettati.
   */
  board?: ConsequenceBoardModel | null;
  /** La verifica del motore è in corso (per la plancia). */
  boardLoading?: boolean;
  /** La verifica del motore non è disponibile: la plancia lo dichiara. */
  boardError?: string | null;
  /** Ricalcola la stima dopo che la bozza è stata modificata. */
  onRefreshBoard?: () => void;
  /** «Modifica proposta» — il testo corretto dal Presidente. */
  onEdit?: (text: string) => void;
  /** «Firma e inserisci nel registro» — accoda secondo la semantica vigente. */
  onSign?: (draft: ProposalActDraft) => Promise<boolean> | void;
  /** Torna alle strade, senza firmare. */
  onCancel?: () => void;
}

export function ActDraftPanel({ draft, status, busy = false, editable = true, signatureNotice, mobile = false, board = null, boardLoading = false, boardError = null, onRefreshBoard, onEdit, onSign, onCancel }: ActDraftPanelProps) {
  const [signing, setSigning] = useState(false);
  const [editing, setEditing] = useState(!mobile);
  const locked = busy || signing;
  const queued = status.state === 'queued';

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
    <section className="act-draft" aria-label="Bozza d'atto" data-state={status.state} data-source-turn={draft.sourceTurn} data-source-revision={draft.sourceRevision}>
      <header className="act-draft-head">
        <span className="act-draft-kicker">Bozza d’atto</span>
        <h3 className="act-draft-title">{draft.title}</h3>
        <span className={`act-draft-capability capability-${draft.capability}`}>
          {capabilityLabel(draft.capability)}
        </span>
      </header>

      <p className="act-draft-note">{draft.note}</p>

      <label className="act-draft-label" htmlFor={textId}>Testo dell’atto (modificabile dal Presidente)</label>
      {mobile && !editing ? (
        <p className="act-draft-text-view" data-testid="act-draft-text-view">{draft.text}</p>
      ) : (
        <textarea
          id={textId}
          className="act-draft-text"
          value={draft.text}
          rows={mobile ? 8 : 6}
          onChange={event => onEdit?.(event.target.value)}
          disabled={locked || !editable || queued}
        />
      )}
      {mobile && (
        <div className="act-draft-edit">
          {editing ? (
            <button type="button" className="act-draft-edit-toggle" onClick={() => setEditing(false)} disabled={locked || !editable || queued}>Salva modifica</button>
          ) : (
            <button type="button" className="act-draft-edit-toggle" onClick={() => setEditing(true)} disabled={locked || !editable || queued}>Modifica</button>
          )}
        </div>
      )}
      {signatureNotice && <p className="act-draft-status-note" role="status">{signatureNotice}</p>}

      <div className="act-draft-status" role="status" aria-live="polite">
        <span className={`act-draft-state state-${status.state}`}>{status.label}</span>
        <span className="act-draft-status-note">{status.note}</span>
      </div>

      {/* WS-GOVUX-P7 — La plancia precede la firma: si vede cosa succede prima di decidere. */}
      {board && (
        <ConsequenceBoardPanel board={board} loading={boardLoading} error={boardError} onRefresh={onRefreshBoard} />
      )}

      <div className="act-draft-actions">
        <button
          type="button"
          className="act-draft-sign"
          onClick={() => void sign()}
          disabled={locked || queued}
          title="Firma l’atto e inseriscilo nel registro: da lì lo esegue il motore all’avanzamento del tempo"
        >
          {queued ? 'Già nel registro' : mobile ? 'Firma l’atto' : 'Firma e inserisci nel registro'}
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
