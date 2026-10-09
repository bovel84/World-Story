/** An explicit camera command; the existing single-region contract stays valid. */
export type MapRegionFocusRequest = (
  | { regionId: string; regionIds?: never }
  | { regionIds: readonly string[]; regionId?: never }
) & { requestId: number; scopeKey?: string };

/** All-or-nothing canonical validation: never focus a silently reduced territory. */
export function regionIdsForFocus(
  request: MapRegionFocusRequest | null | undefined,
  available: ReadonlyMap<string, unknown>,
): string[] {
  if (!request) return [];
  const ids = [...new Set(request.regionIds ?? [request.regionId])];
  return ids.length && ids.every(id => typeof id === 'string' && available.has(id)) ? ids : [];
}
