/**
 * World Story — DECISION-IMPACT: blocco «quanto ha inciso una decisione»
 * =====================================================================
 * Presentazione unica (Timeline e lettore del checkpoint) dell'attribuzione
 * calcolata da `deriveDecisionImpact`. Solo presentazione: nessun numero nuovo,
 * nessuna formula qui dentro.
 *
 * Regola di onestà: il blocco compare **solo** quando il motore ha registrato un
 * effetto per almeno una decisione. I delta del turno restano dove sono già
 * pubblicati (LW02 «Effetti nel turno» / «Variazioni registrate nel periodo»,
 * con la loro dicitura non causale): qui non si duplicano e non si inventa
 * un'attribuzione che il motore non ha registrato.
 */

import { useMemo } from 'react';
import { deriveDecisionImpact, type DecisionRecord } from './decisionImpact';
import { formatMoney } from '../../utils/format';
import type { CheckpointImpact } from './checkpointImpact';

export interface DecisionImpactBlockProps {
  /** Decisioni del turno in lettura (testo + esito + addebito registrato). */
  decisions: readonly DecisionRecord[];
  /** Delta del turno dal read model LW02 (può mancare: nessun numero inventato). */
  turnImpact?: CheckpointImpact | null;
  /** Turno a cui si riferisce il blocco, per il titolo accessibile. */
  turn?: number;
  className?: string;
}

export function DecisionImpactBlock({ decisions, turnImpact, turn, className }: DecisionImpactBlockProps) {
  const impact = useMemo(() => deriveDecisionImpact(decisions, turnImpact), [decisions, turnImpact]);

  if (!impact.available) return null;

  return (
    <div
      className={`decision-impact${className ? ` ${className}` : ''}`}
      aria-label={turn ? `Quanto hanno inciso le tue decisioni nel turno ${turn}` : 'Quanto hanno inciso le tue decisioni'}
    >
      <span className="decision-impact-title">Quanto hanno inciso le tue decisioni</span>
      <ul className="decision-impact-list">
        {impact.effects.map((effect, index) => (
          <li key={`${effect.action}-${index}`} className={`tone-${effect.tone}`}>
            <span className="decision-impact-action">{effect.action}</span>
            <b className="decision-impact-amount">{effect.effectText}</b>
            <small className="decision-impact-detail">{effect.detail}</small>
          </li>
        ))}
      </ul>
      <p className="decision-impact-total">
        <span>Totale addebitato alle tue decisioni</span>
        <b>{impact.attributedText}</b>
      </p>
      {impact.turnMoneyDelta !== null && impact.unattributedText && (
        <p className="decision-impact-rest">
          <span>
            Variazione registrata della tesoreria nel turno{' '}
            <b>{formatMoney(impact.turnMoneyDelta, { currency: 'mld', decimals: 2, sign: true })}</b>: di questa,{' '}
            <b>{impact.unattributedText}</b> non è attribuibile alle singole decisioni (gestione ordinaria,
            acquisti, manutenzione, debito).
          </span>
        </p>
      )}
      <small className="decision-impact-note">{impact.note}</small>
    </div>
  );
}
