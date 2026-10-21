# OpenDots

**Autonomous, collaborative AI companions that you set up just by talking to them.**

OpenDots gives you a small team of persistent digital companions. Each one has a name, a personality, one long-running conversation, a long-term memory, tools, and its own responsibilities. They keep working when the window is closed. They wake up on a schedule, watch pages, react to emails and webhooks, and talk to each other. They come back to you only when there's something worth saying or something that needs your approval.

There are no forms to fill in and no workflow builder. You open the app, add an OpenRouter key, pick a model, and say hi.

---

## What it feels like

### Meet your first companion

```text
You   Hi!
Dot   Hi! I'm brand new here and I don't have a name yet. What would you like to call me?
You   Let's go with Ari. Be concise and a bit playful.
Ari   ✓ Takes the name "Ari"   ✓ Updates its identity
      Ari it is. Short answers, a little fun. What are we working on?
```

The companion actually rewrites its own profile through structured tools. Name, personality, instructions, model and permissions all change because you asked in plain words.

### Give it a routine

```text
You   Every Friday at 5pm, send me a recap of what we did this week.
Ari   ✓ Creates an activity: "Weekly recap" · Friday at 17:00
      Done. You'll get it every Friday at 5pm. You can pause or edit it under Scheduled tasks.
```

```text
You   Let me know if the price on this page drops below €300: https://shop.example.com/monitor
Ari   ✓ Creates an activity: "Watch: monitor price" · checks every 30 min
      I'll check it every 30 minutes without using the AI. I only wake up if the condition is met.
```

### Build a team

```text
You   Create a companion called Venty to handle my job search emails.
Ari   ✓ Creates Venty
      Venty is here. I told them about your preferences. Say hi in their conversation.

You   Ask Dev to check whether the repo builds.
Ari   ✓ Writes to Dev
      I've asked Dev. I'll get back to you when they reply.
```

Companions message each other asynchronously, delegate work, and wake up when an answer arrives. You can read every exchange in the **Team** view.

### Let it act, with your approval

```text
You   Reply to Claire that Thursday works for me.
Venty ✓ Searches emails from Claire   ✓ Reads an email   ✓ Drafts an email
      ┌──────────────────────────────────────────────┐
      │ Ready to send                                 │
      │ To: claire@example.com                        │
      │ Subject: Re: Interview slot                   │
      │ Thursday works great for me, see you then! …  │
      │            [Send]  [Edit]  [Discard]          │
      └──────────────────────────────────────────────┘
```

Sensitive actions are prepared first. The backend only runs them after you approve, with a card in the conversation or by replying "yes, send it". Sending email, running shell commands on the host, calling MCP tools you marked as sensitive and widening permissions all go through this flow.

### Ask, search, run

```text
You   What's new in Node 24? Keep it to 3 bullets.
Ari   ✓ Searches "Node.js 24 release notes"   ✓ Reads nodejs.org
      • …  • …  • …   (with sources)

You   Dev, count the lines of TypeScript in /workspaces/shared/app.
Dev   ✓ $ find . -name '*.ts' | xargs wc -l | tail -1
      12,418 lines across 163 files.
```

When a companion needs something only you can provide, it asks you through a small inline form. That can be a choice, a date, a confirmation or a connection, such as "Connect a mailbox". Passwords and API keys always go into a secure modal, never into the chat.

---

## Features

| Area | What you get |
|---|---|
| **Conversation-first setup** | Companions change their own name, personality, instructions, model and permissions through structured tools |
| **One conversation per companion** | Streaming, Markdown, visible reasoning, readable tool calls, streams resume after a reload |
| **Life engine** | One-off, interval and cron schedules (time-zone aware), page watches that run **without the LLM** (changes, text present/absent, regex), incoming webhooks, mail rules, proactive messages, or `<silence/>` when there's nothing to say |
| **Durable execution** | PostgreSQL job queue with crash recovery, backoff retries, deduplication, one catch-up for missed runs, and a depth limit on collaboration chains |
| **Approvals** | Prepared → approved → executed / failed, with clear states and a full operations log |
| **Memory** | Private or shared memories, full-text search, contextual recall, "remember that…" / "forget that…" |
| **Team** | Create companions in natural language, async internal messaging, delegation, browsable threads |
| **Mail** | IMAP/SMTP (Gmail, Outlook, iCloud, Yahoo… presets), periodic checks, "on incoming email" rules, search and read, "Ready to send" drafts |
| **Skills** | Shared know-how loaded on demand. Create one from the Skills page or say "save that as a skill" |
| **MCP connectors** | HTTP, SSE or local stdio servers, encrypted secrets, per-connector approval, a failing server stays isolated |
| **Plugins** | Bundles of skills and MCP connectors described in a JSON manifest, with a preview before install |
| **Tools** | Free web search through Mwmbl and SearXNG, without accounts or API keys; web page reading, date and time |
| **Shared computer** | A Linux shell in a Docker container (Python, Node, git, curl, jq, sqlite…), one Linux user and private home per companion plus a shared folder. Network and sudo are configurable, with a host fallback that approves each command |
| **Models** | Any OpenRouter model (reasoning effort, preferred provider) or local Ollama, set per companion or as the default |
| **Security** | Secrets are encrypted at rest (AES-256-GCM) and never sent to the model or the browser. External content is marked untrusted, SSRF protection is built in, and config tools are disabled during autonomous wake-ups |
| **Interface** | Black and white, with color reserved for companion avatars. Built with React, shadcn/ui, AI Elements and the Vercel AI SDK. Dark mode, mobile layout, browser notifications, English and French |

---

## Quick start

Requirements: **Node.js 22+**, **pnpm**, and **Docker** for the built-in search engine
and the companions' shared computer. Without Docker the app still starts; choose
Mwmbl in search settings to use its smaller hosted index.

```bash
git clone https://github.com/Sr-0w/OpenDots.git
cd OpenDots
pnpm install
pnpm dev          # engine on :4317, UI on http://127.0.0.1:5173
```

Production runs the application as a single process, with the engine serving the
UI, plus the automatically managed local SearXNG container:

```bash
pnpm build
pnpm start        # http://127.0.0.1:4317
```

On first launch OpenDots asks for two things only:

1. an **OpenRouter key** (encrypted locally),
2. a **default model**.

You don't need to install a database. OpenDots ships with embedded PostgreSQL (PGlite) in `./data`. To use your own server, set `DATABASE_URL`. Every other setting is optional and listed in [`.env.example`](.env.example).

---

## Examples

### Things to say

| Say… | What happens |
|---|---|
| "Call yourself Ari, and be more direct." | Profile updated |
| "Every morning at 8, give me a rundown of my important emails." | Cron schedule plus mail search on each run |
| "Tell me if 'Sold out' disappears from this page." | Page watch, no LLM until it triggers |
| "Remember that I prefer short answers." | Saved to long-term memory |
| "Create a companion that takes care of my side project." | New companion with its own conversation |
| "Use the local model llama3.1." | Switches to Ollama for this companion |
| "Save that as a skill." | Reusable skill for the whole team |
| "Pause all your activities." | Autonomous activities suspended |

### A plugin manifest

Install it from **Connectors → Plugins**, either from a URL or by pasting the JSON:

```json
{
  "name": "Writing kit",
  "version": "1.0.0",
  "description": "Meeting notes and professional email skills",
  "skills": [
    {
      "name": "Meeting notes",
      "description": "When the user asks to summarize a meeting or raw notes",
      "instructions": "Structure: 1. Context (one sentence) 2. Decisions 3. Action items: who, what, by when 4. Open questions. Stay factual, one page max."
    }
  ],
  "connectors": [
    {
      "name": "Filesystem",
      "config": {
        "transport": "stdio",
        "command": "npx",
        "args": ["-y", "@modelcontextprotocol/server-filesystem", "/home/me/notes"]
      }
    }
  ]
}
```

A French example lives in [`examples/plugin-redaction.json`](examples/plugin-redaction.json).

### An MCP connector

**Connectors → Add an MCP connector**, then pick HTTP, SSE or local (stdio):

```text
Name        GitHub
Transport   HTTP
URL         https://api.githubcopilot.com/mcp/
Headers     Authorization: Bearer ghp_…      (encrypted, never shown to models)
Approval    Ask for my approval on every call
```

All companions can then use its tools. Calls that need approval show up as cards.

### A webhook trigger

Ask a companion to "create a webhook that tells me when a deploy fails", then copy its URL from **Scheduled tasks**:

```bash
curl -X POST http://127.0.0.1:4317/api/hooks/<token> \
  -H 'content-type: application/json' \
  -d '{"service":"api","status":"failed","commit":"a1b2c3"}'
```

The companion wakes up, reads the payload as untrusted data, and decides whether it's worth bothering you.

---

## How it works

```
apps/
  server/   TypeScript engine (Hono, AI SDK, Drizzle, PGlite/PostgreSQL)
    src/agents/       Turns, system prompt, tools, resumable streams
    src/life/         Event engine + scheduler (schedules, watches, webhooks)
    src/jobs/         Durable job queue
    src/team/         Messaging between companions
    src/approvals/    Human approvals
    src/memory/       Memory service
    src/mail/         IMAP / SMTP, drafts, polling
    src/connectors/   MCP connectors and plugins
    src/skills/       Shared skills
    src/computer/     Shared Linux shell (Docker or host)
    src/api/          REST + real-time SSE + webhooks
  web/      React UI (Vite, Tailwind, shadcn/ui, AI Elements)
packages/
  shared/   Shared data contracts
```

- **The UI holds no execution logic.** Every turn runs on the server and streams to any client that joins, then gets persisted. Closing the tab doesn't stop anyone.
- **Companions don't think all the time.** A lightweight engine watches the clock and incoming events, and only calls the LLM when a companion actually has something to do.
- **Actions run on the backend.** The model proposes and the engine executes, after your approval when the action needs it.

---

## Development

```bash
pnpm typecheck
pnpm test                                     # engine tests (in-memory PGlite)
pnpm --filter @opendots/server db:generate    # after editing src/db/schema.ts
```

Web search defaults to a **local [SearXNG](https://github.com/searxng/searxng)**
service. `pnpm dev` and `pnpm start` warm it up automatically; the first search
waits until it is ready. Docker downloads a pinned official image on first use.
No account, API key, manual SearXNG setup or public metasearch instance is used.
The search service is bound only to a random `127.0.0.1` port. Configuration and
a generated secret are retained under ignored `data/search`. Engine settings
live in `apps/server/search/settings.json`. Updates to the configuration/image
recreate only this checkout's managed container.

SearXNG runs locally but still queries external engines (DuckDuckGo, Brave and
Wikipedia); this is not offline search. HTTPS certificate validation stays on.
Session proxy settings and custom CA certificates are passed to the container
when present. The container remains available across application restarts:

```bash
pnpm search:up           # prepare/check the local service
pnpm search:logs         # inspect service diagnostics
pnpm search:down         # stop the managed service
pnpm test:search:live    # real searches + official source reads, without mocks
```

The live check uses an in-memory application database, starts/reuses the same
local engine, and exercises the OpenRouter and Hognoul queries reported in the
bug. It checks real nonempty results, an official OpenRouter source with HTTP
200, and rejects the nonexistent `/changelog` page with HTTP 404. Standard
`pnpm test` remains deterministic and does not call public search services.

Under **Settings → Tools → Web search**, an explicit SearXNG URL can point to a
separately managed instance. **Mwmbl** is an optional no-Docker, no-account
alternative using its anonymous v2 endpoint. Its index is smaller; a broadened
query is reported explicitly and does not guarantee a date filter. There is no
automatic fallback that sends local queries to public metasearch instances.
Legacy provider settings use the local default; old provider keys are ignored
and removed on the next search-settings save.

The search adapter rejects mismatched queries and results with no identifiable
query terms. This sanity check does not establish factual relevance: companions
still need to read sources and verify the requested place, date and units.

`HTTPS_PROXY` / `NO_PROXY` are respected. To try connectors without external services:

- **Demo MCP server**: command `node`, args `--import <repo>/apps/server/node_modules/tsx/dist/loader.mjs <repo>/apps/server/test/fixtures/mcp-server.ts`
- **Local mailbox**: `node apps/server/node_modules/hoodiecrow-imap/bin/hoodiecrow.js --port=1143 --smtpPort=1025` (user `testuser`, password `testpass`, SSL off), with `OPENDOTS_MAIL_INSECURE_TLS=1`

---

## Roadmap

- [x] **Phase 1**: Conversational foundations
- [x] **Phase 2**: Memory, tools, permissions, Ollama (semantic search next)
- [x] **Phase 3**: Autonomy: schedules, watches, webhooks, IMAP/SMTP mail, approvals, recovery
- [x] **Phase 4**: Multi-agent collaboration
- [~] **Phase 5**: Shared computer. The container shell with per-companion users works; browser, desktop and computer use are next
- [ ] **Phase 6**: Tauri desktop app, native notifications, backups
- [ ] **Phase 7**: 3D mascots (Three.js / React Three Fiber) driven by each companion's real state

Inspired by Grok Bot, OpenAI Dots and Meta Muse.
