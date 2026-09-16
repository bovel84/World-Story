/**
 * Q02 µ2 — Token single-owner (client).
 * ===================================
 * Se l'istanza è protetta (`WORLD_STORY_OWNER_TOKEN` lato backend) il token si
 * passa una volta via `?owner_token=...`: qui viene persistito in localStorage
 * e rimosso dall'URL. Da lì in poi è inviato come `X-Owner-Token` su ogni
 * richiesta HTTP e come `?owner_token=` sugli SSE (EventSource non supporta
 * header personalizzati).
 *
 * Senza token configurato lato server queste funzioni non aggiungono nulla:
 * nessun cambiamento per l'uso locale.
 */
const STORAGE_KEY = 'worldStoryOwnerToken';

export function getOwnerToken(): string | null {
  if (typeof window === 'undefined') return null;
  try {
    const params = new URLSearchParams(window.location.search);
    const fromUrl = (params.get('owner_token') || '').trim();
    if (fromUrl) {
      window.localStorage.setItem(STORAGE_KEY, fromUrl);
      params.delete('owner_token');
      const qs = params.toString();
      window.history.replaceState(
        {},
        '',
        `${window.location.pathname}${qs ? `?${qs}` : ''}${window.location.hash}`,
      );
      return fromUrl;
    }
    return window.localStorage.getItem(STORAGE_KEY);
  } catch {
    return null;
  }
}

export function ownerHeaders(): Record<string, string> {
  const token = getOwnerToken();
  return token ? { 'X-Owner-Token': token } : {};
}

/** Aggiunge il token alla query string di un URL (per gli SSE). */
export function withOwnerToken(url: string): string {
  const token = getOwnerToken();
  if (!token) return url;
  const separator = url.includes('?') ? '&' : '?';
  return `${url}${separator}owner_token=${encodeURIComponent(token)}`;
}
