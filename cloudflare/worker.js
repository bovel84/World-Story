/**
 * World Story — Cloudflare Worker
 * ============================
 * Serve the built frontend (static assets) and proxies /api/*
 * to the backend, which runs on the local machine and is exposed
 * via a Cloudflare quick Tunnel (trycloudflare.com).
 *
 * L'URL del tunnel RUOTA a ogni riconnessione (~minuti): il backend
 * locale lo pubblica nel KV `backend_url` via scripts/tunnel-kv-sync.sh
 * (launchd com.openpax.tunnelfollow). Ordine di risoluzione:
 *   1. KV TUNNEL_KV 'backend_url' (fresco, aggiornato dal follower)
 *   2. var BACKEND_URL (fallback al deploy)
 */

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (url.pathname === '/api' || url.pathname.startsWith('/api/')) {
      let backend = (env.BACKEND_URL || '').replace(/\/+$/, '');
      try {
        const kvUrl = await env.TUNNEL_KV.get('backend_url');
        if (kvUrl) backend = kvUrl.replace(/\/+$/, '');
      } catch {
        // KV indisponibile: si prosegue con il fallback al deploy.
      }
      if (!backend) {
        return new Response(JSON.stringify({ error: 'BACKEND_URL not configured' }), {
          status: 503,
          headers: { 'content-type': 'application/json' },
        });
      }
      const target = backend + url.pathname + url.search;
      const proxied = new Request(target, request);
      return fetch(proxied);
    }

    const response = await env.ASSETS.fetch(request);
    // Vite usa nomi con hash: JS/CSS/font possono restare nella cache del
    // browser per un anno. index.html rimane invece sempre rivalidabile.
    if (/\/assets\/[^/]+-[A-Za-z0-9_-]+\.(?:js|css|woff2?|png|webp|svg)$/.test(url.pathname)) {
      const headers = new Headers(response.headers);
      headers.set('Cache-Control', 'public, max-age=31536000, immutable');
      return new Response(response.body, { status: response.status, statusText: response.statusText, headers });
    }
    return response;
  },
};