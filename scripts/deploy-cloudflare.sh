#!/bin/bash
# World Story — Deploy su Cloudflare
# =================================
# 1. Ricostruisce il frontend in API same-origin (VITE_API_URL vuoto → /api)
# 2. Distribuisce il Worker (asset statici + proxy /api)
# 3. Aggiorna KV 'backend_url' con l'URL corrente del quick tunnel
#    (il follower launchd com.openpax.tunnelfollow lo mantiene aggiornato
#    a ogni rotazione; il Worker legge KV a ogni richiesta /api)
#
# Uso: bash scripts/deploy-cloudflare.sh
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
TUNNEL_LOG="$ROOT/logs/openpax-tunnel-daemon.log"
NAMESPACE_ID="7cbccb50675e4349a3fd8cd4ee115bd0"

log() { echo "[deploy] $*"; }

# 1. URL del quick tunnel attivo
URL="$(grep -oE 'https://[a-z0-9-]+\.trycloudflare\.com' "$TUNNEL_LOG" 2>/dev/null | grep -v '^https://api\.' | tail -1)"
if [ -z "$URL" ]; then
  log "Nessun tunnel nel log — riavvio via launchctl..."
  launchctl kickstart -k "gui/$(id -u)/com.openpax.tunnel" || true
  for i in $(seq 1 12); do
    sleep 5
    URL="$(grep -oE 'https://[a-z0-9-]+\.trycloudflare\.com' "$TUNNEL_LOG" 2>/dev/null | grep -v '^https://api\.' | tail -1)"
    [ -n "$URL" ] && break
  done
fi
[ -n "$URL" ] || { log "ERRORE: tunnel non raggiungibile, controlla $TUNNEL_LOG"; exit 1; }
log "Tunnel: $URL"

if ! curl -sf -o /dev/null --max-time 15 "$URL/api/health"; then
  log "ATTENZIONE: il tunnel non risponde ancora (propagazione o rate-limit 1015)"
fi

# 2. Frontend same-origin (nessun URL quick-tunnel nel bundle, §Piano Esecutivo)
log "Build frontend (same-origin /api)..."
( cd "$ROOT/frontend" && npm run build )

# 3. Deploy Worker (KV binding già in wrangler.jsonc)
log "Deploy Worker..."
( cd "$ROOT/cloudflare" && npx wrangler deploy )

# 4. KV con l'URL corrente del tunnel
log "Push KV backend_url..."
( cd "$ROOT/cloudflare" && npx wrangler kv key put --namespace-id="$NAMESPACE_ID" --remote backend_url "$URL" )
echo "$URL" > "$ROOT/.tunnel-kv-last-url"

log "Fatto! Gioco online: https://world-story.bovel-cannas.workers.dev"
log "Le rotazioni del tunnel sono auto-gestite dal follower (KV)."