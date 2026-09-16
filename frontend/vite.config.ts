import { defineConfig, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';
import { execSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

/**
 * Q02 µ3 — Build ID del frontend.
 * Scrive `dist/build-id.txt` così il backend (`/api/health`) può riportare la
 * versione del frontend servito senza incorporare URL o segreti nel bundle.
 * Sorgente: `WORLD_STORY_BUILD_ID` (CI), altrimenti lo short SHA di git.
 */
function resolveBuildId(): string {
  const fromEnv = (process.env.WORLD_STORY_BUILD_ID || '').trim();
  if (fromEnv) return fromEnv;
  try {
    return execSync('git rev-parse --short HEAD', { stdio: ['ignore', 'pipe', 'ignore'] })
      .toString()
      .trim() || 'dev';
  } catch {
    return 'dev';
  }
}

function buildIdPlugin(): Plugin {
  let outDir = '';
  return {
    name: 'world-story-build-id',
    apply: 'build',
    configResolved(config) {
      outDir = path.resolve(config.root, config.build.outDir);
    },
    closeBundle() {
      try {
        fs.mkdirSync(outDir, { recursive: true });
        fs.writeFileSync(path.join(outDir, 'build-id.txt'), `${resolveBuildId()}\n`);
      } catch {
        /* la build non deve fallire per l'id di versione */
      }
    },
  };
}

export default defineConfig({
  plugins: [react(), buildIdPlugin()],
  server: {
    port: 5173,
    proxy: {
      '/api': {
        target: 'http://localhost:8000',
        changeOrigin: true,
      },
    },
  },
});
