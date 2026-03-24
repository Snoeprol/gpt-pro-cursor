# gpt-pro-cursor

Use **GPT-5.4 pro** (and any OpenAI model) inside [Cursor IDE](https://cursor.sh) via a local proxy.

Cursor only speaks the legacy Chat Completions API. This proxy translates those requests to the OpenAI **Responses API**, which is required for the latest models like GPT-5.4 pro.

```
Cursor → proxy (localhost) → Cloudflare tunnel → OpenAI Responses API
```

---

## Requirements

- [Node.js](https://nodejs.org) 18+
- An OpenAI API key with access to the model you want (e.g. `gpt-5.4-pro`)
- [Cursor IDE](https://cursor.sh)

---

## Quick start

### 1. Clone & install

```bash
git clone https://github.com/YOUR_USERNAME/gpt-pro-cursor
cd gpt-pro-cursor
npm install
```

### 2. Configure your API key

```bash
cp .env.example .env
```

Open `.env` and set your key:

```env
OPENAI_API_KEY=sk-...
TARGET_MODEL=gpt-5.4-pro
```

`TARGET_MODEL` is the OpenAI model name that all Cursor requests will be forwarded to.

### 3. Start everything

```bash
./start.sh
```

This single command:
- Starts the local proxy on port `3045`
- Downloads `cloudflared` automatically if not present
- Opens a public HTTPS tunnel so Cursor can reach it

You'll see output like:

```
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
✅  All running!

   Paste this into Cursor → Settings → Models
   Override OpenAI Base URL:

   👉  https://xxxx-yyyy.trycloudflare.com/v1

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
```

### 4. Configure Cursor

Open **Cursor → Settings → Models**:

| Setting | Value |
|---|---|
| OpenAI API Key | enable the toggle, enter any value (e.g. `proxy`) |
| Override OpenAI Base URL | enable toggle, paste the `https://xxxx.trycloudflare.com/v1` URL |

Then click **"+ Add Custom Model"** and type `gpt-5.4-pro` (must match `TARGET_MODEL` in `.env`).

In the Cursor chat, open the model picker and select `gpt-5.4-pro`.

---

## Why the tunnel?

Cursor routes API calls through its own servers (for billing/auth), so `localhost` is blocked by SSRF protection. The Cloudflare tunnel gives the proxy a public HTTPS URL that Cursor's servers can reach.

The tunnel URL changes on each restart. For a permanent URL, create a free [Cloudflare account](https://cloudflare.com) and use a named tunnel.

---

## Switching models

Change `TARGET_MODEL` in `.env` and restart `./start.sh`. No changes needed in Cursor — just make sure the model name in Cursor's model picker matches.

Available models to try:

| Model | Notes |
|---|---|
| `gpt-5.4-pro` | Highest reasoning, slowest, most expensive |
| `gpt-5.4` | Fast and smart, great for everyday coding |
| `gpt-5.4-mini` | Cheap and quick |
| `gpt-4.1` | Solid all-rounder |
| `o3` | Best for hard reasoning tasks |
| `o4-mini` | Fast reasoning |

---

## Manual start (without tunnel)

If you have a fixed public server or VPN:

```bash
npm start
# proxy runs at http://localhost:3045/v1
```

Set Cursor's base URL to `http://your-server-ip:3045/v1`.

---

## Project structure

```
├── server.js        # proxy — translates Chat Completions ↔ Responses API
├── start.sh         # one-command launcher (proxy + tunnel)
├── .env.example     # config template
└── package.json
```

---

## License

MIT
