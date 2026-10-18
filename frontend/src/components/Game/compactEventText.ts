/**
 * Compact visual preview of a dispatch (never changes persisted event data).
 * Prefer a complete sentence; otherwise stop at a word boundary.
 * The original text stays available through "Leggi tutto" / the archive.
 */
export interface CompactEventText {
  text: string;
  shortened: boolean;
}

export function compactEventText(value: string, maxCharacters = 240): CompactEventText {
  const full = String(value ?? '').replace(/\s+/g, ' ').trim();
  const limit = Math.max(16, Math.floor(maxCharacters));
  if (full.length <= limit) return { text: full, shortened: false };

  // Leave room for an ellipsis without exceeding the requested width.
  const prefix = full.slice(0, limit - 1);
  const minUsefulLength = Math.floor(prefix.length * 0.45);
  const endings = [...prefix.matchAll(/[.!?…](?=\s|$)/g)]
    .map(match => (match.index ?? 0) + 1)
    .filter(index => index >= minUsefulLength);
  const sentenceEnd = endings.at(-1);
  const wordEnd = prefix.lastIndexOf(' ');
  const cut = sentenceEnd ?? (wordEnd >= minUsefulLength ? wordEnd : prefix.length);
  const candidate = prefix.slice(0, cut).trim().replace(/[,;:\s]+$/, '');
  const text = /[.!?…]$/.test(candidate) ? candidate : `${candidate}…`;
  return { text, shortened: true };
}
