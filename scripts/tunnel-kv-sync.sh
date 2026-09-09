#!/bin/bash
# World Story — follower del quick tunnel
# =====================================
# Il quick tunnel trycloudflare ruota l'URL a ogni riconnessione del
# daemon (log: logs/openpax-tunnel-daemon.log). Questo job (launchd,
# StartInterval 60s) legge l'URL PIÙ RECENTE e, se cambiato, lo pubblica
# in KV così che il Worker proxy /api sull'origine viva.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
LOG="$ROOT/logs/openpax-tunnel-daemon.log"
NAMESPACE_ID="7cbccb50675e4349a3fd8cd4ee115bd0"
STATE_FILE="$ROOT/.tunnel-kv-last-url"

URL="$(grep -oE 'https://[a-z0-9-]+\.trycloudflare\.com' "$LOG" 2>/dev/null | grep -v '^https://api\.' | tail -1)"
[ -n "$URL" ] || exit 0

if [ -f "$STATE_FILE" ] && [ "$(cat "$STATE_FILE")" = "$URL" ]; then
  exit 0
fi

echo "[$(date -u +%FT%TZ)] push $URL" >> "$ROOT/logs/tunnel-kv-sync.log"
( cd "$ROOT/cloudflare" && npx wrangler kv key put --namespace-id="$NAMESPACE_ID" --remote backend_url "$URL" >/dev/null 2>&1 ) \
  && echo "$URL" > "$STATE_FILE" \
  || echo "[$(date -u +%FT%TZ)] ERRORE push KV" >> "$ROOT/logs/tunnel-kv-sync.log"