# Homepage Filter Modals + Hackathons About — Design

**Date:** 2026-07-23  
**Status:** Approved for planning  
**Scope:** Homepage Source/Model/Country filter UX; header nav + `/hackathons` about page

## Goal

Replace the homepage native `<select>` filters with a single Filter control inside the leaderboard card. Applied filters appear as removable pills. Separately, add a Hackathons header link to a new about page with get-started instructions.

## Decisions

| Decision | Choice |
| --- | --- |
| Apply behavior | Immediate navigate on option click (full page reload) |
| Entry control | One Filter button (not three) |
| Menu → picker | `<details>` dropdown lists Source / Model / Country; picking one opens that filter’s `<dialog>` |
| Applied state | Removable pills next to Filter (label + × clears that param) |
| Placement | New strip between metric tabs and ranking list; Filter + pills on the left |
| Modal tech | Native `<dialog>` + small inline script |
| Hackathons nav | New marketing page at `/hackathons` (not deep-link only to `/h/new`) |
| Footprint selects | Out of scope |

## Part A — Leaderboard filters

### Current state

- Source / Model / Country live in a GET form above `LeaderboardChart` (`home.tsx`), auto-submit on change.
- Window + metric live inside the chart as link-styled `Button` segments (`leaderboard-chart.tsx`).
- No modal/dialog component exists; client interactivity is small inline scripts (e.g. `/start`).

### Target UX

1. Remove the select form above the chart.
2. Inside the leaderboard card, between the metric tab row and the ranking list, add a filter strip:
   - **Left:** Filter button (`<details>` / `<summary>`)
   - **Beside it:** pills for each active filter among `source`, `model`, `country`
3. Opening Filter shows a compact dropdown:
   - Source
   - Model
   - Country (omit if `countries.length === 0`)
4. Choosing a dropdown item closes the menu and opens a `<dialog>` for that dimension:
   - Title for the dimension
   - Options as links (All + concrete values), current value highlighted
   - Clicking an option navigates immediately via the same query shape as today
   - Backdrop click, Escape, or explicit close dismisses without changing filters
5. Each pill shows a short human label (e.g. `Claude Code`, family label, `🇦🇺 Australia`) and an × that navigates to the same board URL with that param omitted.

### URL / data flow

- Preserve `boardHref({ window, metric, source?, model?, country? })` as the single URL builder.
- Defaults unchanged: missing `window` → `7d`, missing `metric` → `total`.
- Server still parses query params in `GET /` and loads distinct model families / countries; pass `models` and `countries` into `LeaderboardChart` (or a child filter component) so modals can render options.

### Implementation shape

| Piece | Location |
| --- | --- |
| Remove select form | `src/pages/home.tsx` |
| Filter strip + wiring | `src/pages/leaderboard-chart.tsx` |
| Reusable UI | `src/pages/components/` — filter menu, dialog shell, removable pill (names flexible) |
| Styles | Dialog/dropdown/pill styles in `src/styles/tailwind.css`; extend `pill` (and related) in `src/pages/ui.ts` |
| Script | Small inline `<script>` on homepage/chart for dialog open/close, closing `<details>` after choice, optional click-outside |
| Labels | Reuse `familyLabel`, `countryName` / `flagEmoji`, source display names from current selects |

### Accessibility & behavior notes

- Prefer native `<dialog>` so Escape and focus management work with minimal JS.
- Filter `<details>` collapses when a menu item is chosen and when clicking outside (via script).
- Dialogs are SSR-rendered with all option links; no client fetch required.
- `prefers-reduced-motion`: no special animation required beyond existing site motion norms.

## Part B — Hackathons about page

### Target

- Header nav: add **Hackathons** between **Leaderboard** and **Get started** (`layout.tsx`).
- New route `GET /hackathons` → page component (e.g. `src/pages/hackathons.tsx`).
- Tone/layout aligned with `/about` and `/start` (hero + short sections + `Button` CTAs).
- Content outline:
  1. What hackathons are — timed contests on the tokenmaxer board
  2. How they work — create window → share join link → members report sessions → ranked board
  3. Get started steps — claim username / sign in → create → invite → join
- CTAs: **Create a hackathon** → `/h/new`, **My hackathons** → `/h/mine`
- Optional: footer link for discoverability
- Existing `/h/*` flows remain the product surface; this page is marketing/onboarding only.

### Implementation notes

- Prefer implementing Part B in a parallel subagent while Part A lands on the homepage.
- Reuse `Layout`, `Button`, `hero` / `sub` / `heroActions` patterns; no new design system.

## Non-goals

- Changing Footprint (or other pages’) select filters
- Multi-select within a dimension, saved filter presets, or client-side filtering without reload
- Replacing window/metric controls with modals
- New hackathon APIs or changes to create/join flows
- Shared JS framework / component library beyond small page components

## Success criteria

- Homepage has no Source/Model/Country `<select>`s above the chart
- Users can open Filter → pick a dimension → choose an option and see the board reload with that filter
- Active filters show as pills; × removes only that filter and keeps window/metric/others
- Window and metric controls still work and preserve source/model/country
- Header includes Hackathons → `/hackathons` with clear about + get-started content and CTAs to `/h/new` and `/h/mine`
- Reduced-motion / keyboard: dialogs dismiss with Escape; filter menu usable without pointer-only traps

## Risks

- Country lists can be long — dialog should scroll; keep option rows compact
- Nested interactive patterns (`details` + `dialog`) need care so opening a dialog does not leave a stuck-open menu
- Nav density on small screens — Hackathons is one more link; existing wrap styles should absorb it
