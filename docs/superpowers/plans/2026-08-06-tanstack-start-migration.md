# TanStack Start Migration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Convert tokenmaxer from Hono/hono-jsx SSR to TanStack Start + React on Cloudflare Workers while preserving all API and page behavior.

**Architecture:** Hybrid dispatch — Hono serves `/api/*`, reporter, agent markdown, and OG; TanStack Start serves browser HTML with React routes and `createServerFn` loaders. Custom `src/server.ts` entry selects the handler.

**Tech Stack:** TanStack Start, TanStack Router, React 19, Vite, `@cloudflare/vite-plugin`, existing Hono API, D1, KV, Tailwind v4, pnpm, oxlint/oxfmt, vitest.

## Global Constraints

- Cloudflare Workers only (`@cloudflare/vite-plugin`, not Nitro bun).
- Keep pnpm + oxlint/oxfmt + reporter workspace package.
- Preserve public routes and API JSON shapes.
- Adapt Delacour tanstack skill patterns without forcing monorepo/Biome/Bun.
- No force-push; branch `cursor/tanstack-start-migration-4484`.

---

### Task 1: Scaffold TanStack Start + Cloudflare tooling

**Files:**

- Create: `vite.config.ts`, `src/router.tsx`, `src/routeTree.gen.ts` (generated), `src/server.ts`
- Modify: `package.json`, `tsconfig.json`, `wrangler.jsonc`

- [ ] Add deps: `@tanstack/react-start`, `@tanstack/react-router`, `@tanstack/react-query`, `react`, `react-dom`, `@vitejs/plugin-react`, `vite`, `@cloudflare/vite-plugin`, `@tanstack/router-plugin`
- [ ] Configure Vite with cloudflare + tanstackStart + react
- [ ] Point wrangler `main` to `src/server.ts`
- [ ] Switch JSX to React (`jsxImportSource` removed / react-jsx)
- [ ] Update scripts: `dev` → `vite dev`, `build` → css + reporter + `vite build`, `preview`, `deploy`

### Task 2: Split Hono API app from HTML

**Files:**

- Create: `src/server/api-app.tsx`, `src/server/dispatch.ts`
- Modify: `src/index.tsx` → re-export API app for tests initially
- Modify: HTML-serving routes removed from Hono (or gated)

- [ ] Move current Hono app into `api-app.tsx` with API + agent + OG + reporter + invite/auth redirects that stay server-side
- [ ] Implement `shouldUseHono(request)` for path/Accept dispatch
- [ ] Wire `src/server.ts` fetch to Hono or TanStack handler
- [ ] Keep `app.request` export for API/integration tests that still hit Hono-owned paths

### Task 3: Convert UI to React + TanStack routes

**Files:**

- Create: `src/routes/__root.tsx`, `src/routes/index.tsx`, and route files for about/start/privacy/pricing/login/footprint/hackathons/`u.$username`/`h.*`/`auth`
- Modify: `src/pages/**/*.tsx` — `class`→`className`, React types
- Create: `src/core/api/*.api.ts` server functions for leaderboard/profile/hackathon data

- [ ] Root layout with CSS import, chrome, head tags
- [ ] Port each page to a route with loader/`createServerFn`
- [ ] Preserve invite cookie, session cookie, and redirect behavior
- [ ] Keep visual markup/CSS classes identical where possible

### Task 4: Fix tests + local verify

- [ ] Update HTML page tests that imported `@/index` to hit new entry or remaining Hono behavior
- [ ] `pnpm check` green
- [ ] `pnpm build` + `pnpm preview` smoke of key routes

### Task 5: PR + Cloudflare preview + autopilot

- [ ] Commit/push, open draft PR
- [ ] Exercise Cloudflare preview URL
- [ ] Autopilot: conflicts → comments → CI
