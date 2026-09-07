/**
 * Open-Pax — Cloudflare Worker
 * ============================
 * Serve the built frontend (static assets) and proxies /api/*
 * to the backend, which runs on the local machine and is exposed
 * via a Cloudflare Tunnel (BACKEND_URL var, set at deploy time).
 */

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (url.pathname === '/api' || url.pathname.startsWith('/api/')) {
      const backend = (env.BACKEND_URL || '').replace(/\/+$/, '');
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