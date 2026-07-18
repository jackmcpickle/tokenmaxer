# TokenTally

A public leaderboard of the tokens AI builders burn with **Claude Code** and **Codex**.
Pick a username, paste two snippets, and your coding sessions self-report their token
usage to the board. No email, no PII — just token counts.

It's a single [Hono](https://hono.dev) worker on Cloudflare that serves both the JSON
API and the server-rendered site, backed by one D1 database.

## How it works

Neither Claude Code nor Codex hand token counts to hooks — they only pass a
`transcript_path`. So the installed **reporter** (`reporter/tokentally.mjs`, a
zero-dependency Node script) reads the local transcript the hook points it at, sums
usage per model, and POSTs the totals — the same files [`ccusage`](https://ccusage.com)
parses.

- **Claude Code** — `~/.claude/projects/**/<session>.jsonl` → `message.usage.*`
- **Codex** — `~/.codex/sessions/**/rollout-*.jsonl` → last `token_count` event

Reporting fires on **SessionStart** and **SessionEnd** hooks (no cron, no daemon).
Every session is keyed by its id and the server **upserts** rather than adds, so
re-reporting the same session never double-counts — which is what makes combining
start + end (and Codex's start-only catch-up) safe.

Token counts are **self-reported** — this is an honor system with light guardrails
(bearer auth, rate limits, sanity caps). See `/about`.

## Project layout

```
src/
  index.tsx          # Hono app: API routes + HTML pages + serves the reporter
  types.ts           # Env bindings + shared types
  routes/            # register, ingest, leaderboard (JSON API)
  pages/             # hono/jsx server-rendered pages
  lib/               # auth, pricing, ratelimit, validate, aggregate, format
  db/… drizzle/      # D1 schema + migrations
  __tests__/         # vitest unit tests
reporter/tokentally.mjs   # the copy-paste reporter (served at /tokentally.mjs)
```

## API

| Method | Path                | Auth   | Purpose                                  |
| ------ | ------------------- | ------ | ---------------------------------------- |
| POST   | `/api/register`     | —      | `{username}` → `{id, username, token}`   |
| POST   | `/api/token/rotate` | Bearer | rotate your token                        |
| POST   | `/api/ingest`       | Bearer | upsert `{source, sessions[]}`            |
| GET    | `/api/leaderboard`  | —      | `?window=&metric=&source=&model=&limit=` |
| GET    | `/api/u/:username`  | —      | profile totals + breakdown               |
| GET    | `/api/health`       | —      | `{name, version}`                        |

`window` ∈ `today|7d|30d|all`, `metric` ∈ `total|io|output|cost`, `source` ∈ `claude_code|codex`.

## Development

```sh
pnpm install
pnpm db:migrate:local           # apply migrations to local D1
pnpm dev                        # wrangler dev on :8787
pnpm test                       # vitest
pnpm typecheck
```

## Deploy

```sh
wrangler d1 create tokentally                       # paste database_id into wrangler.toml
wrangler kv namespace create RATE_LIMIT             # paste id into wrangler.toml
pnpm db:migrate                                     # apply migrations to remote D1
# optionally set PUBLIC_BASE_URL in wrangler.toml [vars]
pnpm deploy
```

## Onboarding (what users paste)

After claiming a username at `/start`, users get a personalized version of:

```sh
mkdir -p ~/.tokentally && \
  curl -fsSL https://<host>/tokentally.mjs -o ~/.tokentally/tokentally.mjs && \
  printf '%s' '{"apiBase":"https://<host>","token":"tt_..."}' > ~/.tokentally/config.json
```

**Claude Code** — merge into `~/.claude/settings.json`:

```json
{
  "hooks": {
    "SessionStart": [
      { "type": "shell", "command": "node ~/.tokentally/tokentally.mjs claude-sessionstart" }
    ],
    "SessionEnd": [
      { "type": "shell", "command": "node ~/.tokentally/tokentally.mjs claude-sessionend" }
    ]
  }
}
```

**Codex** — add to `~/.codex/config.toml` (Codex has no SessionEnd hook, so the latest
session reports on the next launch):

```toml
[[hooks.SessionStart.hooks]]
type = "command"
command = "node ~/.tokentally/tokentally.mjs codex-sessionstart"
```

The token lives only in `~/.tokentally/config.json`, never in shared settings files.

## Pricing

Estimated USD cost uses a hardcoded per-model table in `src/lib/pricing.ts` — update
it and redeploy when prices change. Values are estimates, not billing truth.
