/** Only an active *bilateral* thread can be reused from the diplomatic dossier.
 * Group meetings and archived records must never silently absorb a new negotiation.
 * IDs (not country/province names) establish identity; archive stays intact. */
import type { ChatSummaryData } from '../../services/api';

export function findActiveBilateralChat(
  chats: readonly ChatSummaryData[], playerPolityId: string, targetPolityId: string,
): ChatSummaryData | undefined {
  if (!targetPolityId || targetPolityId === playerPolityId) return undefined;
  return chats.find(chat => {
    if (chat.archived || !chat.participants || chat.participants.length !== 2) return false;
    const player = chat.participants.find(participant => participant.role === 'player');
    const other = chat.participants.find(participant => participant.role !== 'player');
    return player?.id === playerPolityId && other?.id === targetPolityId;
  });
}

/** Preserve canonical polity identity across the country picker and backend.
 * Display labels may be province names, translated names or duplicates. */
export function pickDiplomaticTargetIds(
  polities: readonly { id: string }[],
  selectedIds: ReadonlySet<string>,
): string[] {
  return polities.filter(polity => selectedIds.has(polity.id)).map(polity => polity.id);
}
