/**
 * Regressione del 502 sporadico attraverso il proxy (keep-alive reset).
 * ===================================================================
 * In produzione il Worker Cloudflare rispondeva `502` su richieste brevi con
 * questo errore lato tunnel:
 *
 *   read tcp [::1]:57077->[::1]:8000: read: connection reset by peer
 *
 * Il server Node chiudeva i socket keep-alive dopo 5 s (default), mentre il
 * proxy li teneva in pool. Qui si verifica che:
 *  1. i timeout applicati siano proxy-safe e coerenti;
 *  2. `index.ts` li applichi davvero al server HTTP (source contract);
 *  3. un socket keep-alive resti **riusabile** dopo un'inattività maggiore del
 *     default di Node: senza il fix il server lo chiuderebbe e la richiesta
 *     successiva userebbe un socket nuovo (porta locale diversa).
 */
import http from 'node:http';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, it, expect } from 'vitest';
import {
  HEADERS_TIMEOUT_MS,
  KEEP_ALIVE_TIMEOUT_MS,
  applyProxySafeTimeouts,
} from '../src/http/proxy-timeouts';

/** Più del default Node (5 s): è esattamente il ritardo che causava il reset. */
const IDLE_MS = 6_000;

describe('timeout HTTP proxy-safe', () => {
  it('sono sopra il default di Node e coerenti fra loro', () => {
    expect(KEEP_ALIVE_TIMEOUT_MS).toBeGreaterThan(5_000);
    expect(KEEP_ALIVE_TIMEOUT_MS).toBeGreaterThanOrEqual(60_000);
    expect(HEADERS_TIMEOUT_MS).toBeGreaterThan(KEEP_ALIVE_TIMEOUT_MS);
  });

  it('vengono applicati al server HTTP di index.ts', () => {
    const source = readFileSync(path.join(__dirname, '..', 'src', 'index.ts'), 'utf8');
    expect(source).toContain("from './http/proxy-timeouts'");
    expect(source).toContain('applyProxySafeTimeouts(server)');
  });

  it('un socket keep-alive resta riusabile dopo 6 s di inattività', async () => {
    const server = http.createServer((_req, res) => {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end('{"ok":true}');
    });
    applyProxySafeTimeouts(server);
    expect(server.keepAliveTimeout).toBe(KEEP_ALIVE_TIMEOUT_MS);
    expect(server.headersTimeout).toBe(HEADERS_TIMEOUT_MS);

    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const port = (server.address() as { port: number }).port;
    const agent = new http.Agent({ keepAlive: true, maxSockets: 1 });

    const call = () => new Promise<{ body: string; localPort: number }>((resolve, reject) => {
      const req = http.request({ host: '127.0.0.1', port, path: '/ping', agent }, (res) => {
        let body = '';
        res.on('data', (chunk) => { body += chunk; });
        res.on('end', () => resolve({ body, localPort: req.socket.localPort ?? 0 }));
      });
      req.on('error', reject);
      req.end();
    });

    try {
      const first = await call();
      expect(first.body).toBe('{"ok":true}');

      await new Promise((resolve) => setTimeout(resolve, IDLE_MS));

      const second = await call();
      expect(second.body).toBe('{"ok":true}');
      // Stessa porta locale = stessa connessione TCP riusata: il server non ha
      // chiuso il socket durante l'inattività (con il default a 5 s la porta
      // sarebbe cambiata, perché il client avrebbe aperto un nuovo socket).
      expect(second.localPort).toBe(first.localPort);
      expect(second.localPort).toBeGreaterThan(0);
    } finally {
      agent.destroy();
      server.closeAllConnections?.();
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  }, 30_000);
});
