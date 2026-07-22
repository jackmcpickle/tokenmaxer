# Homepage Waterfall Hero Animation — Design

**Date:** 2026-07-22  
**Status:** Approved for planning  
**Scope:** Homepage hero background only

## Goal

Add a Web3-style “waterfall of light” atmosphere behind the homepage hero, using the provided reference image as the visual base and a light procedural overlay for downward light streaks. Expand the hero vertically so more of the scene is visible before filters and the leaderboard chart.

## Decisions

| Decision | Choice |
| --- | --- |
| Image usage | Hybrid — PNG base + procedural streak/particle overlay |
| Placement | Hero only (first viewport); fade into canvas before filters/chart |
| Intensity | Medium — clear cascading streaks; brand copy remains readable |
| Tech | Canvas 2D overlay + CSS layers; no WebGL |
| Other pages | Unchanged |

## Composition

Stacked layers inside a hero background shell (bottom → top):

1. **Base image** — reference waterfall PNG (`public/waterfall-hero.png`), `object-fit: cover`, centered on the light column
2. **Veil** — soft dark gradient for wordmark readability (stronger at top/edges, thinner over the core glow)
3. **Streak canvas** — transparent, `pointer-events: none`; draws falling filaments
4. **Bottom fade** — gradient into `#0a0a0a` so filters/leaderboard sit on the normal page canvas

Hero content (wordmark, subcopy, CTA) stays above these layers with existing reveal animations.

## Layout change

Increase hero vertical space (min-height and/or padding) so the filters and bar chart sit lower on the page. Target: most of the first viewport is the animated hero; the chart begins after a clear fade into the solid canvas.

## Motion & behavior

- **Streaks:** ~40–80 short filaments in the column; varied speeds; brighter/faster near core, softer at edges; palette white → cyan → electric blue aligned with the reference (`#FFFFFF`, `#00E5FF`, `#0077FF`) and site accent (`#0099FF`)
- **Floor accents:** subtle horizontal cyan ticks near the base drifting toward the viewer
- **Particles:** sparse twinkling dots in the dark field
- **Loop:** continuous with no hard visual reset
- **`prefers-reduced-motion`:** static PNG + veil only; no canvas animation
- **Perf:** pause when hero is off-screen (`IntersectionObserver`); pause when `document.hidden`; cap device pixel ratio; homepage-only inline script

## Implementation shape

| Piece | Location |
| --- | --- |
| Asset | Copy reference PNG → `public/waterfall-hero.png` |
| Markup | Homepage hero wrapped in background shell (image + canvas + veil) |
| Styles | Scoped layers, veil, bottom fade, taller hero in `src/styles/tailwind.css` (+ rebuild CSS) |
| Script | Small inline `<script>` on homepage only (same pattern as `/start`) |
| Components | Prefer a focused hero background fragment/component used only by `home.tsx` |

## Non-goals

- Full-page or fixed scroll-locked background
- WebGL / shader remake of the entire scene
- Applying the animation to non-homepage routes
- Changing leaderboard chart behavior beyond pushing it further down via hero spacing

## Success criteria

- First viewport reads as brand + one headline block over the animated waterfall
- Downward light-fall is clearly visible at medium intensity
- Filters and chart remain readable on solid canvas below the fade
- Reduced-motion users see a static, readable hero
- No meaningful layout or visual change on other pages
