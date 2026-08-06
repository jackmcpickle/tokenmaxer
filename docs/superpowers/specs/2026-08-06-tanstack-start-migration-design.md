# TanStack Start Migration Design

**Date:** 2026-08-06  
**Status:** Approved for implementation (cloud agent; user requested full conversion + PR)

## Goal

Move tokenmaxer.quest from a single Hono + hono/jsx Cloudflare Worker to **TanStack Start + React** on Cloudflare Workers, keeping all existing functionality (API, reporter, agent markdown, invite gate, hackathons, OG images, D1/KV bindings) while gaining a real React SPA/SSR frontend with client navigation.

## Constraints

- Stay on Cloudflare Workers with existing D1 (`DB`) and KV (`RATE_LIMIT`) bindings.
- Preserve public API contracts (`/api/*`), onboarding script (`/tokentally.mjs`), agent pages (`/llms.txt`, `*.md`), and HTML routes.
- Keep pnpm workspace + `reporter/` package; do not force a Delacour Bun/Turborepo monorepo.
- Keep oxlint/oxfmt (do not switch to Biome).
- Adapt Delacour `dlc-scaffold-tanstack` patterns (file routes, `createServerFn`, server-only DB access) but use **Cloudflare Vite plugin** instead of Nitro `bun` preset.

## Approaches considered

1. **Full rewrite into TanStack routes + server functions** — cleanest end state; highest risk to API/tests in one shot.
2. **Hybrid (recommended):** Hono keeps API / agent markdown / OG / reporter; TanStack Start owns HTML pages as React routes with loaders/`createServerFn`. Custom Worker entry dispatches by path / Accept.
3. **TanStack shell only, Hono still renders HTML** — fails the “more React frontend” goal.

**Recommendation:** Option 2.

## Architecture

```
Request
  ├─ /api/*, /tokentally.mjs, /llms*.txt, *.md, /og/*, non-browser HTML twins
  │     → existing Hono app (src/server/api-app.tsx)
  └─ browser HTML pages
        → TanStack Start (file routes + React components + server fns)
```

### Frontend (TanStack Start)

- Vite + `@tanstack/react-start` + `@cloudflare/vite-plugin`
- File routes under `src/routes/` (`__root.tsx`, `/`, `/start`, `/about`, `/u/$username`, `/h/$slug`, …)
- Shared UI under `src/modules/` and `src/components/` (composition patterns from Delacour)
- Data via `createServerFn` reading `env` from `cloudflare:workers`
- Tailwind v4 via Vite (replace wrangler Text-rule CSS inlining with normal CSS import in root route)
- Client navigation replaces progressive-enhancement board fetch where practical; keep no-JS link fallbacks

### Backend (Hono, retained)

- Move current `src/index.tsx` API/agent/OG/reporter surface into `src/server/api-app.tsx`
- Mount from custom Worker entry (`src/server.ts`) alongside TanStack handler
- Unit tests that use `app.request` continue against the Hono API app

### Worker entry

```ts
// src/server.ts
import handler from '@tanstack/react-start/server-entry';
import apiApp from './server/api-app';

export default {
    async fetch(request, env, ctx) {
        if (shouldUseHono(request)) return apiApp.fetch(request, env, ctx);
        return handler.fetch(request, env, ctx);
    },
};
```

`wrangler.jsonc` `main` points at `src/server.ts`; keep D1/KV/assets/preview_urls/custom domains.

## Page conversion

- Replace `hono/jsx` with React (`class` → `className`, `Child` → `ReactNode`)
- Layout becomes TanStack `__root` + outlet; head/meta via TanStack head APIs
- Preserve visual design tokens and existing CSS (DESIGN.md / Tailwind theme)

## Testing & deploy

- `pnpm check` (lint, fmt, typecheck, unit tests) must pass
- Local: `pnpm dev` / `pnpm build` / `pnpm preview`
- PR triggers Cloudflare preview URL (`preview_urls: true`); verify key routes on that URL
- Autopilot: resolve conflicts, comments, CI until merge-ready (do not merge)

## Out of scope

- Bun/Turborepo monorepo scaffold
- Biome migration
- Auth rewrite (Better Auth)
- Visual redesign
