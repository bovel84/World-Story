import { memo, useMemo, type ReactNode } from 'react';
import { GovernmentVisualCard } from './GovernmentVisualCard';
import { resolveGovernmentVisuals, explainGovernmentVisualDenial, type GovernmentVisualMessage, type GovernmentVisualSnapshot, type MapFocusVisual } from './governmentVisual';
import { NO_VERIFIED_GEOGRAPHY, safeGovernmentVisualText } from './governmentVisualRequest';

/** Ephemeral, read-only attachment below a message; nothing enters chat storage. */
export const GovernmentMessageVisuals = memo(function GovernmentMessageVisuals({ message, snapshot, onFocusMap, renderText, belowText, compactVisuals = false }: {
  message: GovernmentVisualMessage;
  snapshot?: GovernmentVisualSnapshot;
  onFocusMap?: (card: MapFocusVisual) => void;
  renderText?: (hasVisual: boolean) => ReactNode;
  /** Place political decisions before large geographic appendices in advisor briefings. */
  belowText?: ReactNode;
  compactVisuals?: boolean;
}) {
  const cards = useMemo(() => snapshot ? resolveGovernmentVisuals(message, snapshot) : [], [message, snapshot]);
  // M-DIAG — Il motivo del rifiuto è un attributo **solo in sviluppo**; il
  // giocatore continua a vedere soltanto la frase dichiarata.
  const denial = import.meta.env.DEV && !cards.length && message.role === 'assistant' && message.visualRequest ? explainGovernmentVisualDenial(message, snapshot) : null;
  const visualCards = snapshot && cards.map((card, index) =>
    <GovernmentVisualCard key={index} card={card} snapshot={snapshot} onFocusMap={onFocusMap} />);
  return <>{renderText?.(cards.length > 0)}
    {belowText}
    {compactVisuals && cards.length ? <details className="government-visual-appendix">
      <summary>Contesto geografico · {cards.length} {cards.length === 1 ? 'mappa' : 'mappe'} <span aria-hidden="true">⌄</span></summary>
      {visualCards}
    </details> : visualCards}
    {message.role === 'assistant' && message.visualRequest && !cards.length && !(renderText && safeGovernmentVisualText(message.content ?? '', false).includes(NO_VERIFIED_GEOGRAPHY))
      && <p className="government-visual-description" role="status" data-denial={denial ?? undefined}>{NO_VERIFIED_GEOGRAPHY}</p>}
  </>;
});
