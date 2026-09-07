#!/bin/bash
# Open-Pax — Deploy su Cloudflare
# =================================
# 1. Trova l'URL del quick tunnel (lo riavvia se necessario)
# 2. Ricostruisce il frontend con VITE_API_URL = tunnel/api
# 3. Ridistribuisce il Worker su Cloudflare (open-pax.bovel-cannas.workers.dev)
#
# Uso: bash scripts/deploy-cloudflare.sh
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
TUNNEL_LOG="$ROOT/logs/openpax-tunnel-daemon.log"
BACKEND_URL=""

log() { echo "[deploy] $*"; }

find_tunnel_url() {
  grep -oE 'https://[a-z0-9-]+\.trycloudflare\.com' "$TUNNEL_LOG" 2>/dev/null \
    | grep -v '^https://api\.' | tail -1
}

# 1. URL del tunnel (eventuale attesa/riavvio)
URL="$(find_tunnel_url)"
if [ -z "$URL" ]; then
  log "Nessun tunnel attivo — riavvio via launchctl..."
  launchctl kickstart -k "gui/$(id -u)/com.openpax.tunnel" || true
  for i in $(seq 1 12); do
    sleep 5
    URL="$(find_tunnel_url)"
    [ -n "$URL" ] && break
  done
fi
[ -n "$URL" ] || { log "ERRORE: tunnel non raggiungibile, controlla $TUNNEL_LOG"; exit 1; }
log "Tunnel: $URL"

# Verifica che il tunnel risponda davvero (curl -f: anche un 404 è un fallimento)
if ! curl -sf -o /dev/null --max-time 15 "$URL/api/health"; then
  log "ATTENZIONE: il tunnel non risponde (potrebbe essere ancora in avvio)"
fi

# 2. Build frontend con API URL assoluto
log "Build frontend..."
( cd "$ROOT/frontend" && VITE_API_URL="$URL/api" npm run build )

# 3. Deploy Worker
log "Deploy Worker..."
( cd "$ROOT/cloudflare" && npx wrangler deploy --var "BACKEND_URL:$URL" )

log "Fatto! Gioco online: https://open-pax.bovel-cannas.workers.dev"