/**
 * World Story — API Server
 * =====================
 */

// Загружаем .env (LLM_* и т.д.) ДО любых импортов конфигов
import 'dotenv/config';

import express from 'express';
import cors from 'cors';
import fs from 'fs';
import path from 'path';
import { initLLMRouter } from './llm';
import { initDatabase } from './database';
import { initSessionRegistry } from './session-registry';
import { registerRoutes } from './routes';
import { ownerGuard, ownerAuthMode } from './security/owner-guard';
import { applyProxySafeTimeouts } from './http/proxy-timeouts';

const app = express();
const PORT = process.env.PORT || 8000;

// Middleware
app.use(cors());
app.use(express.json({ limit: '10mb' }));

// Global request logging
app.use((req, res, next) => {
  console.log(`[HTTP] ${req.method} ${req.path}`);
  next();
});

// Q02 µ2: protezione single-owner. Se WORLD_STORY_OWNER_TOKEN è configurato
// ogni /api/* richiede il token (eccetto /health e /api/health). Senza token
// la modalità resta `open-single-user` (uso locale) e nulla cambia.
app.use(ownerGuard);

// Initialize Database
initDatabase();

// F05 µ1: all'avvio, i job rimasti 'running' con lease scaduto diventano
// failed (lease_expired) e i loro run vanno in paused_recovery — nessuna
// seconda chiamata pagata automaticamente; i job 'queued' sopravvissuti al
// crash vengono reclamati dal worker appena riparte (F05 µ2: startup).
import { simulationJobService } from './jobs/SimulationJobService';
simulationJobService.startup();

// Initialize LLM router (providers from llm.config.json / env)
const llmRouter = initLLMRouter();
const sessionRegistry = initSessionRegistry(llmRouter);
for (const [mechanic, cfg] of Object.entries(llmRouter.describe())) {
  console.log(`[LLM] ${mechanic}: ${cfg.provider} / ${cfg.model}`);
}

// Register all route files
registerRoutes(app);
console.log(`[Auth] modalità proprietario: ${ownerAuthMode()}`);

// In produzione lo stesso processo pubblica anche la build React. Questo
// mantiene funzionanti le rotte SPA aperte direttamente dal browser.
const frontendDist = path.resolve(__dirname, '../../frontend/dist');
const frontendIndex = path.join(frontendDist, 'index.html');
if (fs.existsSync(frontendIndex)) {
  app.use(express.static(frontendDist, {
    index: false,
    maxAge: '1h',
  }));
  app.get('*', (req, res, next) => {
    if (req.path === '/health' || req.path.startsWith('/api/')) return next();
    res.sendFile(frontendIndex);
  });
  console.log(`[Static] Frontend: ${frontendDist}`);
} else {
  console.warn(`[Static] Frontend build not found: ${frontendDist}`);
}

// Reload active sessions from database (survives server restart)
sessionRegistry.reloadActiveSessions();

const server = app.listen(PORT, () => {
  console.log(`🚀 World Story API running on http://localhost:${PORT}`);
});

// Il backend è dietro un proxy (Worker Cloudflare → quick tunnel): con il default
// di Node (5 s) un socket keep-alive inattivo viene chiuso mentre il proxy lo
// tiene in pool, e la richiesta successiva scritta lì muore con
// "connection reset by peer" → 502 sporadici. Vedi src/http/proxy-timeouts.ts.
applyProxySafeTimeouts(server);

/**
 * Graceful shutdown: flush in-memory session state to the DB before
 * the process exits, so NPC conquests / pending region changes / etc.
 * are not lost on SIGTERM (pm2, docker stop, systemd) or SIGINT (Ctrl+C).
 *
 * The flush is awaited up to a hard timeout so a hung DB write cannot
 * block shutdown indefinitely. The closeIdleConnections + close hooks
 * ensure the HTTP server stops accepting new requests while the flush
 * is running.
 */
let shuttingDown = false;
async function shutdown(signal: NodeJS.Signals) {
  if (shuttingDown) return;
  shuttingDown = true;
  console.log(`\n[${signal}] Graceful shutdown starting...`);

  server.close((err) => {
    if (err) console.error('[shutdown] server.close error:', err);
  });

  const FLUSH_TIMEOUT_MS = 10_000;
  const flushPromise = sessionRegistry.flushAll();
  const timeout = new Promise<void>((resolve) =>
    setTimeout(() => {
      console.warn(`[shutdown] flush timed out after ${FLUSH_TIMEOUT_MS}ms`);
      resolve();
    }, FLUSH_TIMEOUT_MS),
  );
  await Promise.race([flushPromise, timeout]);

  console.log(`[${signal}] Shutdown complete`);
  process.exit(0);
}

process.on('SIGTERM', () => void shutdown('SIGTERM'));
process.on('SIGINT', () => void shutdown('SIGINT'));
