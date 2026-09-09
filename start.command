#!/bin/bash
# World Story — Avvio del gioco
# ==========================
# Doppio clic su start.command per:
#   1. avviare il backend locale (launchd com.openpax.backend) con health check
#   2. caricare il follower KV (rotazioni tunnel auto-gestite)
#   3. aprire il browser sul gioco (locale + versione online)
# Uso da terminale: bash start.command [--no-open]

set -uo pipefail

ROOT="$(cd "$(dirname "$0")" && pwd)"
G="gui/$(id -u)"
LOCAL_URL="http://localhost:8000"
ONLINE_URL="https://world-story.bovel-cannas.workers.dev"

log() { echo "[world-story] $*"; }

# --- 1. Backend -------------------------------------------------------------
if ! curl -sf -o /dev/null --max-time 3 "$LOCAL_URL/api/health"; then
  log "Avvio backend..."
  launchctl bootstrap "$G" "$HOME/Library/LaunchAgents/com.openpax.backend.plist" 2>/dev/null \
    || launchctl kickstart -k "$G/com.openpax.backend" 2>/dev/null
  for i in $(seq 1 20); do
    sleep 1
    curl -sf -o /dev/null --max-time 3 "$LOCAL_URL/api/health" && break
  done
fi

if curl -sf -o /dev/null --max-time 3 "$LOCAL_URL/api/health"; then
  log "Backend OK su $LOCAL_URL"
else
  log "ATTENZIONE: backend non risponde. Avvio manuale:"
  log "  cd \"$ROOT/backend-nest\" && npm run build && npm start"
fi

# --- 2. Follower KV (rotazioni tunnel → Worker) ------------------------------
launchctl bootstrap "$G" "$HOME/Library/LaunchAgents/com.openpax.tunnelfollow.plist" 2>/dev/null \
  || true

# --- 3. Stato sito online (informativo, non blocca) --------------------------
if curl -sf -o /dev/null --max-time 10 "$ONLINE_URL/api/health"; then
  log "Versione online OK: $ONLINE_URL"
else
  log "Versione online non raggiungibile per ora (possibile rate-limit trycloudflare; si riattiva da sola)"
fi

# --- 4. Browser --------------------------------------------------------------
if [ "${1:-}" != "--no-open" ]; then
  open "$LOCAL_URL"
fi

log "Pronto. Il gioco gira anche chiudendo questa finestra (servizi launchd)."