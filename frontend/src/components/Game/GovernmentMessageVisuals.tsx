import { memo, useMemo, type ReactNode } from 'react';
import { GovernmentVisualCard } from './GovernmentVisualCard';
import { resolveGovernmentVisuals, type GovernmentVisualMessage, type GovernmentVisualSnapshot, type MapFocusVisual } from './governmentVisual';
import { NO_VERIFIED_GEOGRAPHY, safeGovernmentVisualText } from './governmentVisualRequest';

/** Ephemeral, read-only attachment below a message; nothing enters chat storage. */
export const GovernmentMessageVisuals = memo(function GovernmentMessageVisuals({ message, snapshot, onFocusMap, renderText }: {
  message: GovernmentVisualMessage;
  snapshot?: GovernmentVisualSnapshot;
  onFocusMap?: (card: MapFocusVisual) => void;
  renderText?: (hasVisual: boolean) => ReactNode;
}) {
  const cards = useMemo(() => snapshot ? resolveGovernmentVisuals(message, snapshot) : [], [message, snapshot]);
  return <>{renderText?.(cards.length > 0)}
    {snapshot && cards.map((card, index) => <GovernmentVisualCard key={index} card={card} snapshot={snapshot} onFocusMap={onFocusMap} />)}
    {message.role === 'assistant' && message.visualRequest && !cards.length && !(renderText && safeGovernmentVisualText(message.content ?? '', false).includes(NO_VERIFIED_GEOGRAPHY))
      && <p className="government-visual-description" role="status">{NO_VERIFIED_GEOGRAPHY}</p>}
  </>;
});
