/**
 * World Story — LW01: card del Briefing strategico
 * ===============================================
 * Presentazione pura di `StrategicBriefing`. Nessuna logica di gioco: la card
 * mostra le voci già derivate e ordinate dal read model.
 */
import React from 'react';
import type { BriefingItem, BriefingSeverity, StrategicBriefing } from './strategicBriefing';

const TONE_CLASS: Record<BriefingSeverity, string> = {
  critical: 'is-critical',
  warning: 'is-warning',
  opportunity: 'is-opportunity',
  positive: 'is-positive',
  info: 'is-info',
};

export interface StrategicBriefingCardProps {
  briefing: StrategicBriefing;
  /** Mostra solo le prime N voci (le restanti sono riassunte). */
  maxItems?: number;
  /** Riga di contesto sopra la lista, es. «Italia — 14 marzo 1951». */
  context?: string;
}

export const StrategicBriefingCard: React.FC<StrategicBriefingCardProps> = ({
  briefing,
  maxItems = 6,
  context,
}) => {
  const shown = briefing.items.slice(0, maxItems);
  const hidden = briefing.items.length - shown.length;

  return (
    <section className={`strategic-briefing level-${briefing.level}`} aria-label="Briefing strategico">
      <header className="strategic-briefing-head">
        <div>
          <p className="strategic-briefing-kicker">Briefing strategico</p>
          <h3 className="strategic-briefing-status">{briefing.statusLabel}</h3>
          {context && <p className="strategic-briefing-context">{context}</p>}
        </div>
        <span className="strategic-briefing-pill" aria-hidden="true">{briefing.items.length}</span>
      </header>

      {shown.length === 0 ? (
        <p className="strategic-briefing-empty">{briefing.headline}</p>
      ) : (
        <ul className="strategic-briefing-list">
          {shown.map((item: BriefingItem) => (
            <li key={item.id} className={`strategic-briefing-item ${TONE_CLASS[item.severity]}`}>
              <span className="strategic-briefing-icon" aria-hidden="true">{item.icon}</span>
              <span className="strategic-briefing-text">
                <b>{item.label}</b>
                {item.detail && <small>{item.detail}</small>}
              </span>
            </li>
          ))}
        </ul>
      )}

      {hidden > 0 && <p className="strategic-briefing-more">+{hidden} {hidden === 1 ? 'altra voce' : 'altre voci'} nel dossier</p>}
    </section>
  );
};

export default StrategicBriefingCard;
