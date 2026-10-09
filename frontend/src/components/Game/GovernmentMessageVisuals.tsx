import { memo } from 'react';
import { GovernmentVisualCard } from './GovernmentVisualCard';
import { resolveGovernmentVisuals, type GovernmentVisualMessage, type GovernmentVisualSnapshot, type MapFocusVisual } from './governmentVisual';

/** Ephemeral, read-only attachment below a message; nothing enters chat storage. */
export const GovernmentMessageVisuals = memo(function GovernmentMessageVisuals({ message, snapshot, onFocusMap }: {
  message: GovernmentVisualMessage;
  snapshot?: GovernmentVisualSnapshot;
  onFocusMap?: (card: MapFocusVisual) => void;
}) {
  if (!snapshot) return null;
  return <>{resolveGovernmentVisuals(message, snapshot).map((card, index) =>
    <GovernmentVisualCard key={index} card={card} snapshot={snapshot} onFocusMap={onFocusMap} />)}</>;
});
