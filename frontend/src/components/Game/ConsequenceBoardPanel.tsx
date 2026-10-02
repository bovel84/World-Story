/**
 * WS-GOVUX-P7 — La plancia delle conseguenze, resa
 * ===============================================
 * Presentazione pura di `buildConsequenceBoard`: nessun numero nuovo, nessuna
 * formula qui dentro. Quattro gruppi distinti ed etichettati (effetti diretti,
 * previsioni, rischi, incertezze), la provenienza di ogni voce, il contrassegno
 * «applicato» per ciò che il motore esegue davvero, e la nota su ciò che **non**
 * è stimabile. La stima stantia si ricalcola con un click: il resto non cambia.
 */
import {
  type ConsequenceBoard, type ConsequenceEntry, type ConsequenceTone,
} from './consequenceBoard';
import type { ConsequenceBasis } from './consequences';

const BASIS_LABEL: Record<ConsequenceBasis, string> = {
  measured: 'misurato',
  estimated: 'stimato',
  declared: 'dichiarato',
  unavailable: 'non dichiarato',
};

const STATUS_LABEL: Record<ConsequenceBoard['status'], string> = {
  'engine-preview': 'verifica del motore',
  declared: 'stima dichiarata',
  'not-estimable': 'non stimabile',
};

const TONE_ICON: Record<ConsequenceTone, string> = {
  neutral: '•',
  positive: '✓',
  warning: '⚠',
  critical: '✕',
};

export interface ConsequenceBoardProps {
  board: ConsequenceBoard;
  /** La verifica del motore è in corso. */
  loading?: boolean;
  /** La verifica del motore non è disponibile: si dichiara, non si inventa. */
  error?: string | null;
  /** Ricalcola la stima dopo una modifica della bozza. */
  onRefresh?: () => void;
}

function Entry({ entry }: { entry: ConsequenceEntry }) {
  return (
    <li className={`consequence-entry basis-${entry.basis} tone-${entry.tone}`}>
      <span className="consequence-entry-icon" aria-hidden="true">{TONE_ICON[entry.tone]}</span>
      <span className="consequence-entry-body">
        <span className="consequence-entry-label">{entry.label}</span>
        <span className="consequence-entry-detail">{entry.detail}</span>
      </span>
      <span className="consequence-entry-tags">
        {entry.applied && <span className="consequence-tag consequence-tag-applied">applicato dal motore</span>}
        <span className={`consequence-basis consequence-basis-${entry.basis}`}>{BASIS_LABEL[entry.basis]}</span>
      </span>
    </li>
  );
}

export function ConsequenceBoardPanel({ board, loading = false, error = null, onRefresh }: ConsequenceBoardProps) {
  return (
    <section
      className="consequence-board"
      data-status={board.status}
      data-stale={board.stale ? 'true' : 'false'}
      aria-label="Conseguenze dell’atto prima della firma"
    >
      <header className="consequence-board-head">
        <span className="consequence-board-kicker">Conseguenze dell’atto</span>
        <span className="consequence-board-status">{STATUS_LABEL[board.status]}</span>
      </header>

      <p className="consequence-board-note">{board.statusNote}</p>

      {board.stale && (
        <div className="consequence-board-stale" role="status">
          <span>La bozza è cambiata: questa stima era per un’altra versione.</span>
          {onRefresh && (
            <button type="button" className="consequence-refresh" onClick={onRefresh} disabled={loading}>
              {loading ? 'Aggiorno…' : 'Ricalcola stima'}
            </button>
          )}
        </div>
      )}

      {loading && !board.stale && (
        <p className="consequence-board-loading" role="status">Verifica del motore in corso…</p>
      )}

      {error && <p className="consequence-board-error" role="alert">{error}</p>}

      <div className="consequence-groups">
        {board.groups.map(group => (
          <div key={group.id} className="consequence-group" data-group={group.id}>
            <h4 className="consequence-group-title">{group.label}</h4>
            <ul className="consequence-group-list">
              {group.entries.map((entry, index) => (
                <Entry key={`${group.id}-${index}`} entry={entry} />
              ))}
            </ul>
          </div>
        ))}
      </div>

      {board.notEstimable.length > 0 && (
        <div className="consequence-not-estimable">
          <span className="consequence-not-estimable-title">Non stimabile</span>
          <ul>
            {board.notEstimable.map((line, index) => <li key={index}>{line}</li>)}
          </ul>
        </div>
      )}

      <p className="consequence-board-footnote">{board.note}</p>
    </section>
  );
}

export default ConsequenceBoardPanel;
