# Homepage Waterfall Hero Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Hybrid waterfall hero on the homepage — PNG base + Canvas 2D light streaks — with a taller first viewport so the leaderboard sits lower.

**Architecture:** Static image in `public/`; homepage-only hero shell (image, veil, canvas, content); CSS for layers/fade/height; small inline script for filaments/particles with reduced-motion and visibility pauses.

**Tech Stack:** Hono JSX, Tailwind CSS, Canvas 2D, vitest

## Global Constraints

- Homepage only; other pages unchanged
- Hybrid: PNG base + canvas overlay (no WebGL)
- Medium intensity; brand copy stays readable
- `prefers-reduced-motion`: static PNG + veil only
- Pause animation when hero off-screen or `document.hidden`
- Cap device pixel ratio (≤ 2)

## File map

| File                                      | Role                                                    |
| ----------------------------------------- | ------------------------------------------------------- |
| `public/waterfall-hero.png`               | Reference image (converted to real PNG)                 |
| `src/pages/components/waterfall-hero.tsx` | Hero shell markup + inline canvas script                |
| `src/pages/home.tsx`                      | Wrap existing hero content in shell                     |
| `src/pages/ui.ts`                         | Optional: homepage hero spacing class if needed         |
| `src/styles/tailwind.css`                 | `.waterfall-hero` layers, veil, fade, min-height        |
| `src/__tests__/home-hero.test.ts`         | Assert hero shell + asset path + script markers in HTML |

---

### Task 1: Asset + hero shell + styles

**Files:**

- Create: `public/waterfall-hero.png`
- Create: `src/pages/components/waterfall-hero.tsx`
- Modify: `src/pages/home.tsx`
- Modify: `src/styles/tailwind.css`
- Create: `src/__tests__/home-hero.test.ts`

- [x] **Step 1:** Convert the reference image to `public/waterfall-hero.png` (source is JPEG bytes named `.png` — re-encode as PNG).

- [x] **Step 2:** Add CSS for `.waterfall-hero` (relative, min-height ~70–85vh, overflow hidden), absolute base image (`object-fit: cover`, centered), veil gradient, bottom fade to `#0a0a0a`, canvas full-bleed `pointer-events: none`, content relative z-index.

- [x] **Step 3:** Create `WaterfallHero` component wrapping children: img + veil + canvas#waterfall-canvas + content slot; append inline script that:
    - exits early on `prefers-reduced-motion: reduce`
    - resizes canvas to hero box with DPR cap 2
    - spawns ~60 vertical streaks (core denser/faster) + sparse particles + few floor ticks
    - colors: white / `#00E5FF` / `#0077FF` / `#0099FF`
    - `requestAnimationFrame` loop; `IntersectionObserver` + `visibilitychange` to pause
    - continuous recycle of streaks off bottom

- [x] **Step 4:** Wrap homepage hero section content in `WaterfallHero`; keep wordmark/CTA; increase vertical space so chart sits lower.

- [x] **Step 5:** Test that `GET /` HTML includes `waterfall-hero.png`, `waterfall-canvas`, and a script containing `requestAnimationFrame`.

- [x] **Step 6:** `pnpm build:css` and `pnpm test` for the new test file; commit.
