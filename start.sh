#!/usr/bin/env bash
# Starts the proxy + a public Cloudflare tunnel in one command.
# The tunnel URL is printed so you can paste it into Cursor.

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
CLOUDFLARED="$SCRIPT_DIR/cloudflared"
LOG_FILE="/tmp/cloudflared-tunnel.log"

# ── check dependencies ──────────────────────────────────────────────────────
if [ ! -f "$SCRIPT_DIR/.env" ]; then
  echo "❌  .env not found. Copy .env.example and add your OPENAI_API_KEY."
  exit 1
fi

if [ ! -f "$CLOUDFLARED" ]; then
  echo "⬇️   cloudflared not found — downloading..."
  curl -fsSL "https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-linux-amd64" \
    -o "$CLOUDFLARED"
  chmod +x "$CLOUDFLARED"
  echo "✅  cloudflared downloaded"
fi

# ── start proxy ─────────────────────────────────────────────────────────────
echo "🚀  Starting proxy..."
node "$SCRIPT_DIR/server.js" &
PROXY_PID=$!
sleep 1

# ── start tunnel ────────────────────────────────────────────────────────────
echo "🌐  Starting Cloudflare tunnel..."
"$CLOUDFLARED" tunnel --url http://localhost:3045 --no-autoupdate > "$LOG_FILE" 2>&1 &
TUNNEL_PID=$!

# wait for the public URL to appear in logs
echo "⏳  Waiting for tunnel URL..."
for i in $(seq 1 20); do
  URL=$(grep -o 'https://[a-z0-9-]*\.trycloudflare\.com' "$LOG_FILE" 2>/dev/null | head -1)
  if [ -n "$URL" ]; then break; fi
  sleep 1
done

if [ -z "$URL" ]; then
  echo "❌  Tunnel failed to start. Check $LOG_FILE"
  kill $PROXY_PID $TUNNEL_PID 2>/dev/null
  exit 1
fi

echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "✅  All running!"
echo ""
echo "   Paste this into Cursor → Settings → Models"
echo "   Override OpenAI Base URL:"
echo ""
echo "   👉  $URL/v1"
echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "   Press Ctrl+C to stop everything"
echo ""

# ── cleanup on exit ─────────────────────────────────────────────────────────
trap "echo ''; echo '🛑  Stopped.'; kill $PROXY_PID $TUNNEL_PID 2>/dev/null" EXIT INT TERM
wait $PROXY_PID
