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

    return env.ASSETS.fetch(request);
  },
};