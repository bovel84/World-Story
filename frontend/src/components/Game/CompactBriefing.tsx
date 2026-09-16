/**
 * World Story — LW06.1 / MIGLIORIA 1: briefing compatto nella schermata
 * ====================================================================
 * Presentazione pura. Non deriva nulla: riceve il `StrategicBriefing` già
 * calcolato una sola volta in `GameScreen` e ne mostra al massimo 2-3 voci
 * azionabili, con la CTA «Apri dossier». Se non c'è nulla da segnalare non
 * rende nulla (nessun rumore). Dismissibile; riappare quando cambia il quadro.
 *
 * Non è un dashboard: una striscia compatta vicino al momento decisionale.
 */
import React, { useMemo, useState } from 'react';
import { compactBriefing, type StrategicBriefing } from './strategicBriefing';

export interface CompactBriefingProps {
  briefing: StrategicBriefing;
  /** Apre il Dossier Nazione (scheda Situazione). */
  onOpenDossier: () => void;
  maxItems?: number;
}

export const CompactBriefing: React.FC<CompactBriefingProps> = ({
  briefing,
  onOpenDossier,
  maxItems = 3,
}) => {
  const compact = useMemo(() => compactBriefing(briefing, maxItems), [briefing, maxItems]);
  const [dismissedKey, setDismissedKey] = useState<string | null>(null);
  const key = `${compact.level}:${compact.items.map(item => item.id).join('|')}`;

  if (!compact.visible || dismissedKey === key) return null;

  return (
    <aside
      className={`compact-briefing level-${compact.level}`}
      role="status"
      aria-label="Briefing strategico"
    >
      <span className="compact-briefing-status">{compact.statusLabel}</span>
      <ul className="compact-briefing-list">
        {compact.items.map(item => (
          <li key={item.id} className={`tone-${item.severity}`}>
            <span className="compact-briefing-icon" aria-hidden="true">{item.icon}</span>
            <span className="compact-briefing-label">{item.label}</span>
          </li>
        ))}
      </ul>
      <button type="button" className="compact-briefing-open" onClick={onOpenDossier}>
        Apri dossier
      </button>
      <button
        type="button"
        className="compact-briefing-dismiss"
        onClick={() => setDismissedKey(key)}
        aria-label="Nascondi il briefing"
        title="Nascondi"
      >
        ×
      </button>
    </aside>
  );
};

export default CompactBriefing;
