<p align="center">
  <img src="assets/nanoclaw-logo.png" alt="NanoClaw" width="400">
</p>

<p align="center">
  An AI assistant that runs agents securely in their own containers. Lightweight, built to be easily understood and completely customized for your needs.
</p>

<p align="center">
  <a href="https://nanoclaw.dev">nanoclaw.dev</a>&nbsp; • &nbsp;
  <a href="README_zh.md">中文</a>&nbsp; • &nbsp;
  <a href="https://discord.gg/VDdww8qS42"><img src="https://img.shields.io/discord/1470188214710046894?label=Discord&logo=discord&v=2" alt="Discord" valign="middle"></a>&nbsp; • &nbsp;
  <a href="repo-tokens"><img src="repo-tokens/badge.svg" alt="34.9k tokens, 17% of context window" valign="middle"></a>
</p>

---

<h2 align="center">🐳 Now Runs in Docker Sandboxes</h2>
<p align="center">Every agent gets its own isolated container inside a micro VM.<br>Hypervisor-level isolation. Millisecond startup. No complex setup.</p>

**macOS (Apple Silicon)**
```bash
curl -fsSL https://nanoclaw.dev/install-docker-sandboxes.sh | bash
```

**Windows (WSL)**
```bash
curl -fsSL https://nanoclaw.dev/install-docker-sandboxes-windows.sh | bash
```

> Currently supported on macOS (Apple Silicon) and Windows (x86). Linux support coming soon.

<p align="center"><a href="https://nanoclaw.dev/blog/nanoclaw-docker-sandboxes">Read the announcement →</a>&nbsp; · &nbsp;<a href="docs/docker-sandboxes.md">Manual setup guide →</a></p>

---

## 🔧 Running on Groq (OpenAI-compatible API) — Hetzner VPS Setup

This instance runs NanoClaw on **Hetzner Server 1 (46.62.246.93)** using **Groq** instead of Anthropic.

### Why a credential proxy is needed

NanoClaw uses the Anthropic SDK internally. Groq uses OpenAI-compatible format. The proxy (`src/credential-proxy.ts`) converts everything on the fly:

```
Claude Code SDK → [Anthropic format] → credential-proxy → [OpenAI format] → Groq API
                                                         ← [Anthropic format] ←
```

Without this proxy, the SDK would send Anthropic-format requests directly to Groq and get 400 errors.

### .env configuration

```
ANTHROPIC_BASE_URL=https://api.groq.com/openai/v1
ANTHROPIC_AUTH_TOKEN=gsk_...your_groq_api_key...
ANTHROPIC_DEFAULT_SONNET_MODEL=qwen/qwen3-32b
ANTHROPIC_DEFAULT_HAIKU_MODEL=qwen/qwen3-32b
ANTHROPIC_DEFAULT_OPUS_MODEL=qwen/qwen3-32b
ANTHROPIC_API_KEY=
GROQ_API_KEY=gsk_...your_groq_api_key...
DISABLE_GMAIL=true
```

### How to change the model

Only edit `.env` — no code changes needed:

```bash
nano /opt/nanoclaw/.env
# Change ANTHROPIC_DEFAULT_SONNET_MODEL / HAIKU / OPUS to the new model name
sqlite3 /opt/nanoclaw/store/messages.db 'DELETE FROM sessions;'
pm2 restart nanoclaw --update-env
```

**Available Groq models (tested 2026-03):**

| Model | Status | Notes |
|---|---|---|
| `qwen/qwen3-32b` | ✅ Working | Best tool use, 300K tokens/min free tier |
| `moonshotai/kimi-k2-instruct` | ⚠️ Avoid | Hangs on large requests |
| `llama-3.3-70b-versatile` | ⚠️ Avoid | 429 rate limit on free tier |
| `meta-llama/llama-4-scout-17b-16e-instruct` | ⚠️ Avoid | max_tokens hard limit 8192 |
| `openai/gpt-oss-120b` | ❌ Broken | Generates invalid tool names like `WebSearch<\|channel\|>commentary` |
| `llama-3.1-8b-instant` | ❌ Broken | Too weak for multi-step tool use |

### Patches applied to credential-proxy

All patches are in `src/credential-proxy.ts` and compiled into `dist/credential-proxy.js`.

**1. Model selection via `ANTHROPIC_DEFAULT_SONNET_MODEL`**
- Problem: proxy used `OPENROUTER_MODEL`, fell back to hardcoded `stepfun/step-3.5-flash:free` (doesn't exist on Groq)
- Fix: added `ANTHROPIC_DEFAULT_SONNET_MODEL` to `readEnvFile()` — proxy reads model from `.env` first

**2. Cloudflare WAF bypass (PostmanRuntime User-Agent)**
- Problem: Groq routes traffic through Cloudflare. Hetzner datacenter IPs are flagged as bots → **403 error 1010** specifically on requests that include `tools`. Plain text requests work fine, tool requests get blocked.
- Fix: `headers['user-agent'] = 'PostmanRuntime/7.37.3'` on all upstream requests

**3. Disable gzip responses (`accept-encoding: identity`)**
- Problem: SDK sends `Accept-Encoding: gzip` by default → Groq compresses response → `JSON.parse` throws `SyntaxError: Unexpected token 0x1f`
- Fix: force `accept-encoding: identity` so Groq returns plain JSON

**4. Gzip decompression fallback**
- Why: even with `identity`, some responses may still arrive gzip-encoded
- Fix: check magic bytes `0x1f 0x8b` — decompress with `zlib.gunzip()` before parsing

**5. `isNvidiaResp = isNvidiaBase` (removed URL path check)**
- Problem: original code: `isNvidiaResp = isNvidiaBase && req.url.includes('/v1/messages')`. When SDK appends `?beta=true`, the response conversion was sometimes skipped.
- Fix: `isNvidiaResp = isNvidiaBase` — always convert response for Groq/NVIDIA/OpenRouter

**6. max_tokens cap at 16000**
- Problem: NanoClaw sends large `max_tokens` values; Groq models have varying output limits (8192–16384) → 400 error
- Fix: cap at 16000 for all non-Anthropic endpoints

**7. max_completion_tokens only for NVIDIA**
- Problem: original code renamed `max_tokens→max_completion_tokens` for all providers; Groq uses `max_tokens`, not `max_completion_tokens`
- Fix: rename only when URL contains `integrate.api.nvidia.com`

### PM2 management

```bash
pm2 status
pm2 logs nanoclaw --lines 50 --nostream
pm2 restart nanoclaw --update-env
```

### Direct proxy test (without Telegram)

```bash
curl -X POST http://172.17.0.1:3001/v1/messages \
  -H "Content-Type: application/json" \
  -H "x-api-key: placeholder" \
  -H "anthropic-version: 2023-06-01" \
  -H "Accept-Encoding: gzip" \
  -d '{"model":"claude-sonnet-4-6","max_tokens":100,"messages":[{"role":"user","content":"Hi, say hello to Sergiy"}]}'
```

Expected: `{"type":"message","stop_reason":"end_turn","content":[{"type":"text","text":"..."}]}`

---

## 📺 YouTube Transcript MCP

### How it works

YouTube blocks requests from Hetzner datacenter IPs and Tor exit nodes. The solution is **yt-dlp with browser cookies** — yt-dlp authenticates with your Google account cookies, which bypasses IP blocks.

```
User sends YouTube link → Agent calls mcp__youtube__get_transcripts → yt-dlp downloads .vtt subtitles → clean text returned
```

### Setup

**1. Install yt-dlp on the server:**
```bash
pip3 install yt-dlp --break-system-packages
```
yt-dlp is also installed inside the Docker image (`container/Dockerfile`).

**2. Export cookies from your browser:**
- Install Chrome extension **"Get cookies.txt LOCALLY"**
- Open youtube.com (make sure you're logged in to Google)
- Click the extension → Export → save as `cookies.txt`
- Copy to server:
```bash
scp cookies.txt root@46.62.246.93:/opt/nanoclaw/youtube_cookies.txt
```

**3. The MCP script** (`container/yt-transcript-mcp.py`) is already configured to use `/opt/nanoclaw/youtube_cookies.txt`.

The file is mounted read-only into each container via `src/container-runner.ts`:
```typescript
const ytCookiesFile = path.join(process.cwd(), 'youtube_cookies.txt');
if (fs.existsSync(ytCookiesFile)) {
  mounts.push({
    hostPath: ytCookiesFile,
    containerPath: '/opt/nanoclaw/youtube_cookies.txt',
    readonly: true,
  });
}
```

**4. yt-dlp requires Node.js** for YouTube's JS challenge solver. Node.js is already installed on the server (`/usr/bin/node`). The script uses `--js-runtimes node --remote-components ejs:github` flags automatically.

### MCP server config (in `data/sessions/main/agent-runner-src/index.ts`)

```typescript
youtube: {
  command: 'python3',
  args: ['/usr/local/bin/yt-transcript-mcp.py'],
},
```

### Agent instructions (in `groups/main/CLAUDE.md`)

```
## YouTube

Use the MCP tool to get transcripts — it works via yt-dlp with cookies:

mcp__youtube__get_transcripts(url="https://www.youtube.com/watch?v=VIDEO_ID", lang="ru")

- ALWAYS call this tool when user sends a YouTube link — it works, do not skip it
- Always pass lang="ru" first (most videos from user are in Russian). If fails, try without lang param.
- Returns full transcript text — summarize it, do NOT paste all to user (can be very long)
- NEVER use WebFetch on youtube.com — returns JS config, not transcript
```

### Testing the MCP script directly

```bash
# On the host:
echo '{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"get_transcripts","arguments":{"url":"https://www.youtube.com/watch?v=VIDEO_ID","lang":"ru"}}}' \
  | python3 /usr/local/bin/yt-transcript-mcp.py

# Inside a Docker container:
docker run --rm \
  -v /opt/nanoclaw/youtube_cookies.txt:/opt/nanoclaw/youtube_cookies.txt \
  --entrypoint bash nanoclaw-agent:latest -c \
  "echo '{\"jsonrpc\":\"2.0\",\"id\":1,\"method\":\"tools/call\",\"params\":{\"name\":\"get_transcripts\",\"arguments\":{\"url\":\"https://www.youtube.com/watch?v=VIDEO_ID\",\"lang\":\"ru\"}}}' | python3 /usr/local/bin/yt-transcript-mcp.py"
```

### Why not Tor?

We tried routing through Tor (`socks5://172.17.0.1:9050`) but YouTube's transcript API (`youtube-transcript-api` library) specifically detects and blocks Tor exit node IPs — even when authenticated. yt-dlp with cookies works reliably.

### Cookie expiry

Cookies expire in ~1-2 years (see `expires` field in the cookies.txt file). When they expire:
1. Export cookies again from Chrome (same extension)
2. Copy to server: `scp cookies.txt root@46.62.246.93:/opt/nanoclaw/youtube_cookies.txt`
3. No restart needed — the file is read on each request

### Dockerfile changes

Added to `container/Dockerfile`:
```dockerfile
RUN pip3 install youtube-transcript-api requests[socks] yt-dlp --break-system-packages
```

---

## 🛠 Our Customizations (Sergey0703/clawbot)

**GitHub**: https://github.com/Sergey0703/clawbot  
**Server**: 65.21.3.89 (Hetzner)  
**PM2**: 

### Changes vs upstream:
- **Telegram voice transcription** — faster-whisper-server on 46.62.246.93:9000, auto language detect
- **Acknowledgement messages** — bot confirms receipt before processing (voice shows transcript in quotes)
- **Gmail MCP** — , OAuth token at 
- **YouTube MCP** — custom `yt-transcript-mcp.py` via yt-dlp with cookies (see YouTube section below)
- **Quiet hours** — scheduled tasks suppressed 23:00–08:00 Europe/Dublin
- **CLAUDE.md** — user info (name, email, timezone), YouTube instructions
- **LLM**: NVIDIA API  via 

### Key config files:
-  — ANTHROPIC_BASE_URL, ANTHROPIC_AUTH_TOKEN, model vars
-  — model env vars for container
-  — mounted into container
-  — master source
-  — agent instructions
- `/opt/nanoclaw/youtube_cookies.txt` — YouTube cookies for yt-dlp (Netscape format, export from browser)

### After editing index.ts:

> flow-vid-manager-next@0.1.0 build
> next build

▲ Next.js 16.1.7 (Turbopack)
- Environments: .env

  Creating an optimized production build ...
✓ Compiled successfully in 9.1s
  Running TypeScript ...

### To restore from GitHub:



## Why I Built NanoClaw

[OpenClaw](https://github.com/openclaw/openclaw) is an impressive project, but I wouldn't have been able to sleep if I had given complex software I didn't understand full access to my life. OpenClaw has nearly half a million lines of code, 53 config files, and 70+ dependencies. Its security is at the application level (allowlists, pairing codes) rather than true OS-level isolation. Everything runs in one Node process with shared memory.

NanoClaw provides that same core functionality, but in a codebase small enough to understand: one process and a handful of files. Claude agents run in their own Linux containers with filesystem isolation, not merely behind permission checks.

## Quick Start

```bash
gh repo fork qwibitai/nanoclaw --clone
cd nanoclaw
claude
```

<details>
<summary>Without GitHub CLI</summary>

1. Fork [qwibitai/nanoclaw](https://github.com/qwibitai/nanoclaw) on GitHub (click the Fork button)
2. `git clone https://github.com/<your-username>/nanoclaw.git`
3. `cd nanoclaw`
4. `claude`

</details>

Then run `/setup`. Claude Code handles everything: dependencies, authentication, container setup and service configuration.

> **Note:** Commands prefixed with `/` (like `/setup`, `/add-whatsapp`) are [Claude Code skills](https://code.claude.com/docs/en/skills). Type them inside the `claude` CLI prompt, not in your regular terminal. If you don't have Claude Code installed, get it at [claude.com/product/claude-code](https://claude.com/product/claude-code).

## Philosophy

**Small enough to understand.** One process, a few source files and no microservices. If you want to understand the full NanoClaw codebase, just ask Claude Code to walk you through it.

**Secure by isolation.** Agents run in Linux containers (Apple Container on macOS, or Docker) and they can only see what's explicitly mounted. Bash access is safe because commands run inside the container, not on your host.

**Built for the individual user.** NanoClaw isn't a monolithic framework; it's software that fits each user's exact needs. Instead of becoming bloatware, NanoClaw is designed to be bespoke. You make your own fork and have Claude Code modify it to match your needs.

**Customization = code changes.** No configuration sprawl. Want different behavior? Modify the code. The codebase is small enough that it's safe to make changes.

**AI-native.**
- No installation wizard; Claude Code guides setup.
- No monitoring dashboard; ask Claude what's happening.
- No debugging tools; describe the problem and Claude fixes it.

**Skills over features.** Instead of adding features (e.g. support for Telegram) to the codebase, contributors submit [claude code skills](https://code.claude.com/docs/en/skills) like `/add-telegram` that transform your fork. You end up with clean code that does exactly what you need.

**Best harness, best model.** NanoClaw runs on the Claude Agent SDK, which means you're running Claude Code directly. Claude Code is highly capable and its coding and problem-solving capabilities allow it to modify and expand NanoClaw and tailor it to each user.

## What It Supports

- **Multi-channel messaging** - Talk to your assistant from WhatsApp, Telegram, Discord, Slack, or Gmail. Add channels with skills like `/add-whatsapp` or `/add-telegram`. Run one or many at the same time.
- **Isolated group context** - Each group has its own `CLAUDE.md` memory, isolated filesystem, and runs in its own container sandbox with only that filesystem mounted to it.
- **Main channel** - Your private channel (self-chat) for admin control; every group is completely isolated
- **Scheduled tasks** - Recurring jobs that run Claude and can message you back
- **Web access** - Search and fetch content from the Web
- **Container isolation** - Agents are sandboxed in [Docker Sandboxes](https://nanoclaw.dev/blog/nanoclaw-docker-sandboxes) (micro VM isolation), Apple Container (macOS), or Docker (macOS/Linux)
- **Agent Swarms** - Spin up teams of specialized agents that collaborate on complex tasks
- **Optional integrations** - Add Gmail (`/add-gmail`) and more via skills

## Usage

Talk to your assistant with the trigger word (default: `@Andy`):

```
@Andy send an overview of the sales pipeline every weekday morning at 9am (has access to my Obsidian vault folder)
@Andy review the git history for the past week each Friday and update the README if there's drift
@Andy every Monday at 8am, compile news on AI developments from Hacker News and TechCrunch and message me a briefing
```

From the main channel (your self-chat), you can manage groups and tasks:
```
@Andy list all scheduled tasks across groups
@Andy pause the Monday briefing task
@Andy join the Family Chat group
```

## Customizing

NanoClaw doesn't use configuration files. To make changes, just tell Claude Code what you want:

- "Change the trigger word to @Bob"
- "Remember in the future to make responses shorter and more direct"
- "Add a custom greeting when I say good morning"
- "Store conversation summaries weekly"

Or run `/customize` for guided changes.

The codebase is small enough that Claude can safely modify it.

## Contributing

**Don't add features. Add skills.**

If you want to add Telegram support, don't create a PR that adds Telegram to the core codebase. Instead, fork NanoClaw, make the code changes on a branch, and open a PR. We'll create a `skill/telegram` branch from your PR that other users can merge into their fork.

Users then run `/add-telegram` on their fork and get clean code that does exactly what they need, not a bloated system trying to support every use case.

### RFS (Request for Skills)

Skills we'd like to see:

**Communication Channels**
- `/add-signal` - Add Signal as a channel

**Session Management**
- `/clear` - Add a `/clear` command that compacts the conversation (summarizes context while preserving critical information in the same session). Requires figuring out how to trigger compaction programmatically via the Claude Agent SDK.

## Requirements

- macOS or Linux
- Node.js 20+
- [Claude Code](https://claude.ai/download)
- [Apple Container](https://github.com/apple/container) (macOS) or [Docker](https://docker.com/products/docker-desktop) (macOS/Linux)

## Architecture

```
Channels --> SQLite --> Polling loop --> Container (Claude Agent SDK) --> Response
```

Single Node.js process. Channels are added via skills and self-register at startup — the orchestrator connects whichever ones have credentials present. Agents execute in isolated Linux containers with filesystem isolation. Only mounted directories are accessible. Per-group message queue with concurrency control. IPC via filesystem.

For the full architecture details, see [docs/SPEC.md](docs/SPEC.md).

Key files:
- `src/index.ts` - Orchestrator: state, message loop, agent invocation
- `src/channels/registry.ts` - Channel registry (self-registration at startup)
- `src/ipc.ts` - IPC watcher and task processing
- `src/router.ts` - Message formatting and outbound routing
- `src/group-queue.ts` - Per-group queue with global concurrency limit
- `src/container-runner.ts` - Spawns streaming agent containers
- `src/task-scheduler.ts` - Runs scheduled tasks
- `src/db.ts` - SQLite operations (messages, groups, sessions, state)
- `groups/*/CLAUDE.md` - Per-group memory

## FAQ

**Why Docker?**

Docker provides cross-platform support (macOS, Linux and even Windows via WSL2) and a mature ecosystem. On macOS, you can optionally switch to Apple Container via `/convert-to-apple-container` for a lighter-weight native runtime.

**Can I run this on Linux?**

Yes. Docker is the default runtime and works on both macOS and Linux. Just run `/setup`.

**Is this secure?**

Agents run in containers, not behind application-level permission checks. They can only access explicitly mounted directories. You should still review what you're running, but the codebase is small enough that you actually can. See [docs/SECURITY.md](docs/SECURITY.md) for the full security model.

**Why no configuration files?**

We don't want configuration sprawl. Every user should customize NanoClaw so that the code does exactly what they want, rather than configuring a generic system. If you prefer having config files, you can tell Claude to add them.

**Can I use third-party or open-source models?**

Yes. NanoClaw supports any Claude API-compatible model endpoint. Set these environment variables in your `.env` file:

```bash
ANTHROPIC_BASE_URL=https://your-api-endpoint.com
ANTHROPIC_AUTH_TOKEN=your-token-here
```

This allows you to use:
- Local models via [Ollama](https://ollama.ai) with an API proxy
- Open-source models hosted on [Together AI](https://together.ai), [Fireworks](https://fireworks.ai), etc.
- Custom model deployments with Anthropic-compatible APIs

Note: The model must support the Anthropic API format for best compatibility.

**How do I debug issues?**

Ask Claude Code. "Why isn't the scheduler running?" "What's in the recent logs?" "Why did this message not get a response?" That's the AI-native approach that underlies NanoClaw.

**Why isn't the setup working for me?**

If you have issues, during setup, Claude will try to dynamically fix them. If that doesn't work, run `claude`, then run `/debug`. If Claude finds an issue that is likely affecting other users, open a PR to modify the setup SKILL.md.

**What changes will be accepted into the codebase?**

Only security fixes, bug fixes, and clear improvements will be accepted to the base configuration. That's all.

Everything else (new capabilities, OS compatibility, hardware support, enhancements) should be contributed as skills.

This keeps the base system minimal and lets every user customize their installation without inheriting features they don't want.

## Community

Questions? Ideas? [Join the Discord](https://discord.gg/VDdww8qS42).

## Changelog

See [CHANGELOG.md](CHANGELOG.md) for breaking changes and migration notes.

## License

MIT


---

## Deployment Notes (Server 65.21.3.89)

This instance is customized for OpenRouter + voice transcription. Key differences from upstream:

### OpenRouter Integration

NanoClaw uses OpenRouter as the LLM backend instead of Anthropic directly.

**`/opt/nanoclaw/.env`:**
```
ANTHROPIC_BASE_URL=https://openrouter.ai/api
ANTHROPIC_AUTH_TOKEN=sk-or-v1-...
ANTHROPIC_DEFAULT_SONNET_MODEL=arcee-ai/trinity-large-preview:free
ANTHROPIC_DEFAULT_HAIKU_MODEL=arcee-ai/trinity-large-preview:free
ANTHROPIC_DEFAULT_OPUS_MODEL=arcee-ai/trinity-large-preview:free
```

**`/opt/nanoclaw/data/sessions/main/.claude/settings.json`** -- same model vars passed into the agent container:
```json
{
  "env": {
    "ANTHROPIC_DEFAULT_HAIKU_MODEL": "arcee-ai/trinity-large-preview:free",
    "ANTHROPIC_DEFAULT_SONNET_MODEL": "arcee-ai/trinity-large-preview:free",
    "ANTHROPIC_DEFAULT_OPUS_MODEL": "arcee-ai/trinity-large-preview:free"
  }
}
```

Three files were patched to make OpenRouter work:

**`src/credential-proxy.ts`** -- Bearer auth, `/api` path prefix, strip `output_config`/`thinking`/`betas` from request body (OpenRouter does not accept these Anthropic-specific fields).

**`src/container-runner.ts`** -- `isOpenRouter` bypass: passes `ANTHROPIC_AUTH_TOKEN` and model vars directly to the container env.

**`src/channels/telegram.ts`** -- top-level `import http from 'http'` (ES module -- `require()` is not available).

**`data/sessions/main/agent-runner-src/index.ts`** (mounted into container, overrides image):
- `lastAssistantText +=` (accumulate streaming chunks, not overwrite)
- Reset `lastAssistantText = ''` on `system/init` events
- `finalText = textResult || lastAssistantText || null`
- Ignore `ECONNRESET` and `exited with code 1` errors

CRITICAL: The container mounts `/opt/nanoclaw/data/sessions/main/agent-runner-src` -> `/app/src`.
Changes to the Docker image source do NOT apply until copied here:
```bash
cp /opt/nanoclaw/container/agent-runner/src/index.ts \
   /opt/nanoclaw/data/sessions/main/agent-runner-src/index.ts
```

### Session Permissions

Sessions are stored at `/opt/nanoclaw/data/sessions/main/.claude/`. The container runs as `node` (uid=1000).
If this directory is owned by `root`, sessions are never written to disk and the bot gets "No conversation found" errors after restart.

Fix:
```bash
chown -R 1000:1000 /opt/nanoclaw/data/sessions/main/.claude/
```

### Voice Transcription

Telegram voice messages are transcribed using `fedirz/faster-whisper-server` running on server 46.62.246.93:9000.

- Model: `Systran/faster-whisper-small`
- Language: `ru` (fixed)
- API: OpenAI-compatible `/v1/audio/transcriptions` (multipart, field name `file`)
- Other available models on that server: `tiny`, `base`, `large-v3`

Uses `String.fromCharCode(13, 10)` instead of literal `\r\n` strings to avoid CRLF injection when patching TS source via Python.

### Startup Script

**`/opt/nanoclaw/start.sh`** clears stale sessions on startup:
```bash
#!/bin/bash
cd /opt/nanoclaw
sqlite3 store/messages.db 'DELETE FROM sessions;' 2>/dev/null || true
exec node dist/index.js
```

### PM2 Management

```bash
pm2 restart nanoclaw
pm2 logs nanoclaw --lines 50 --nostream
```

### Rebuild After Code Changes

```bash
cd /opt/nanoclaw
npm run build
pm2 restart nanoclaw
```

### Model Notes

- `arcee-ai/trinity-large-preview:free` -- current model. Clean text, no thinking blocks.
- `nvidia/nemotron-3-super-120b-a12b:free` -- works but streams in chunks (needs `lastAssistantText +=` fix).
- Ollama Cloud -- blocked from Hetzner datacenter IPs (403). Local only.
- Groq -- blocked from Hetzner datacenter IPs (403). Cannot use for server-side transcription.

---

## Our Customizations (Sergey0703/clawbot)

**GitHub**: https://github.com/Sergey0703/clawbot
**Server**: 65.21.3.89 (Hetzner), PM2: nanoclaw

### Changes vs upstream:
- Telegram voice transcription via faster-whisper-server (46.62.246.93:9000)
- Acknowledgement messages + voice transcript shown in quotes
- Gmail MCP (@gongrzhe/server-gmail-autoauth-mcp)
- YouTube MCP — custom yt-transcript-mcp.py via yt-dlp + browser cookies (see YouTube section above)
- CLAUDE.md: user info (name, email), YouTube instructions
- LLM: Groq API qwen/qwen3-32b (see Groq section above)

### Key files:
- `/opt/nanoclaw/.env` — API keys and model config
- `/opt/nanoclaw/data/sessions/main/agent-runner-src/index.ts` — active agent source (mounted into container)
- `/opt/nanoclaw/container/agent-runner/src/index.ts` — master source
- `/opt/nanoclaw/groups/main/CLAUDE.md` — agent instructions
- `/opt/nanoclaw/youtube_cookies.txt` — YouTube cookies (Netscape format, from browser)
- `/opt/nanoclaw/container/yt-transcript-mcp.py` — YouTube MCP server script

### After editing index.ts:
```bash
cp /opt/nanoclaw/container/agent-runner/src/index.ts \
   /opt/nanoclaw/data/sessions/main/agent-runner-src/index.ts
npm run build && pm2 restart nanoclaw --update-env
sqlite3 /opt/nanoclaw/store/messages.db 'DELETE FROM sessions;'
```
