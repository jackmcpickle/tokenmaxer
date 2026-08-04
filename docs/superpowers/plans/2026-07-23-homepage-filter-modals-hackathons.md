# Homepage Filter Modals + Hackathons About Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace homepage Source/Model/Country selects with a Filter button → dropdown → dialog flow and removable pills inside the leaderboard card; add a Hackathons header link to a new `/hackathons` about page.

**Architecture:** SSR Hono JSX. Filter URLs stay query-string driven via `boardHref`. Native `<details>` for the Filter menu; native `<dialog>` per dimension with option links that navigate immediately. Small inline script for dialog open/close and menu collapse. Hackathons page is a static marketing page reusing `Layout` / `Button`.

**Tech Stack:** Hono JSX, Tailwind CSS v4, vitest, Cloudflare Workers

## Global Constraints

- Immediate navigate on option click (no Apply button)
- One Filter button; dropdown lists Source / Model / Country; item opens that dialog
- Applied filters as removable pills (× clears that param only)
- Filter strip between metric tabs and ranking list; Filter + pills on the left
- Native `<dialog>` + `<details>`; minimal inline JS
- Footprint selects unchanged
- Spec: `docs/superpowers/specs/2026-07-23-homepage-filter-modals-hackathons-design.md`

## File map

| File                                     | Role                                                                   |
| ---------------------------------------- | ---------------------------------------------------------------------- |
| `src/pages/leaderboard-href.ts`          | Shared `boardHref` + source display labels                             |
| `src/pages/components/filter-pill.tsx`   | Removable applied-filter pill                                          |
| `src/pages/components/board-filters.tsx` | Filter strip: details menu, dialogs, pills, inline script              |
| `src/pages/leaderboard-chart.tsx`        | Export/use href helper; render `BoardFilters`; accept models/countries |
| `src/pages/home.tsx`                     | Remove select form; pass models/countries into chart                   |
| `src/styles/tailwind.css`                | Dialog + filter menu styles                                            |
| `src/pages/ui.ts`                        | Optional class bundles for filter strip / pills                        |
| `src/__tests__/home-filters.test.ts`     | Assert filter UI + hrefs in `GET /` HTML                               |
| `src/pages/hackathons.tsx`               | About + get-started page                                               |
| `src/pages/layout.tsx`                   | Header (+ footer) Hackathons link                                      |
| `src/index.tsx`                          | `GET /hackathons` route                                                |
| `src/__tests__/hackathons-page.test.ts`  | Assert nav + page content                                              |

---

### Task 1: `boardHref` helper + filter components + styles

**Files:**

- Create: `src/pages/leaderboard-href.ts`
- Create: `src/pages/components/filter-pill.tsx`
- Create: `src/pages/components/board-filters.tsx`
- Modify: `src/styles/tailwind.css`
- Modify: `src/pages/ui.ts` (if needed)
- Create: `src/__tests__/home-filters.test.ts` (failing until Task 2 wires chart; write assertions against components via homepage once wired — for this task, export helpers and unit-test `boardHref` in the same file)

**Interfaces:**

- Produces:
    - `boardHref(opts: { window: TimeWindow; metric: Metric; source?: string; model?: string; country?: string }): string`
    - `SOURCE_LABELS: Record<Source, string>` (Claude Code, Codex, opencode, pi, Cursor)
    - `FilterPill` props: `{ label: string; href: string; ariaLabel: string }`
    - `BoardFilters` props: `{ window, metric, source?, model?, country?, models: string[], countries: string[] }`

- [ ] **Step 1: Extract `boardHref` + source labels**

Create `src/pages/leaderboard-href.ts`:

```ts
import type { Metric, Source, TimeWindow } from '@/types';

export const SOURCE_LABELS: Record<Source, string> = {
    claude_code: 'Claude Code',
    codex: 'Codex',
    opencode: 'opencode',
    pi: 'pi',
    cursor: 'Cursor',
};

export function boardHref(opts: {
    window: TimeWindow;
    metric: Metric;
    source?: string;
    model?: string;
    country?: string;
}): string {
    const q = new URLSearchParams();
    q.set('window', opts.window);
    q.set('metric', opts.metric);
    if (opts.source) q.set('source', opts.source);
    if (opts.model) q.set('model', opts.model);
    if (opts.country) q.set('country', opts.country);
    return `/?${q.toString()}`;
}
```

- [ ] **Step 2: Unit-test `boardHref`**

In `src/__tests__/home-filters.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { boardHref } from '@/pages/leaderboard-href';

describe('boardHref', () => {
    it('builds query with only set filters', () => {
        expect(
            boardHref({ window: '7d', metric: 'total', source: 'codex' }),
        ).toBe('/?window=7d&metric=total&source=codex');
        expect(
            boardHref({
                window: '30d',
                metric: 'cost',
                source: 'claude_code',
                model: 'sonnet',
                country: 'AU',
            }),
        ).toBe(
            '/?window=30d&metric=cost&source=claude_code&model=sonnet&country=AU',
        );
    });
});
```

Run: `pnpm test src/__tests__/home-filters.test.ts`
Expected: PASS for `boardHref` tests.

- [ ] **Step 3: `FilterPill` component**

```tsx
import type { FC } from 'hono/jsx';

export const FilterPill: FC<{
    label: string;
    href: string;
    ariaLabel: string;
}> = ({ label, href, ariaLabel }) => (
    <span class="filter-pill inline-flex items-center gap-1 rounded-md bg-panel2 px-2.5 py-1 text-[12px] font-medium text-text">
        <span>{label}</span>
        <a
            class="filter-pill__clear text-muted no-underline hover:text-text"
            href={href}
            aria-label={ariaLabel}
        >
            ×
        </a>
    </span>
);
```

- [ ] **Step 4: `BoardFilters` — menu, dialogs, pills, script**

Implement `src/pages/components/board-filters.tsx`:

- Left-aligned strip: `flex flex-wrap items-center gap-2`
- `<details class="board-filter-menu">` with summary button labeled **Filter**
- Menu items: buttons with `data-filter-dialog="source|model|country"` (Country only if `countries.length > 0`)
- Three `<dialog>` elements (`id="filter-dialog-source"` etc.) each with:
    - header + close button (`data-filter-close`)
    - scrollable list of `<a>` options for All + values; active option marked with `aria-current="true"` or a class
    - hrefs via `boardHref` preserving window/metric and other active filters
- Pills for active source/model/country using `FilterPill`; clear href omits that one param
- Labels: `SOURCE_LABELS`, `familyLabel(model)`, `` `${flagEmoji(code)} ${countryName(code)}` ``
- Inline script at bottom:

```js
(() => {
    const root = document.getElementById('board-filters');
    if (!root) return;
    const menu = root.querySelector('details.board-filter-menu');
    root.querySelectorAll('[data-filter-dialog]').forEach((btn) => {
        btn.addEventListener('click', (e) => {
            e.preventDefault();
            const id =
                'filter-dialog-' + btn.getAttribute('data-filter-dialog');
            const dlg = document.getElementById(id);
            if (menu) menu.open = false;
            if (dlg && typeof dlg.showModal === 'function') dlg.showModal();
        });
    });
    root.querySelectorAll('[data-filter-close]').forEach((btn) => {
        btn.addEventListener('click', () => {
            const dlg = btn.closest('dialog');
            if (dlg) dlg.close();
        });
    });
    document.addEventListener('click', (e) => {
        if (!menu || !menu.open) return;
        if (!menu.contains(e.target)) menu.open = false;
    });
})();
```

- [ ] **Step 5: CSS for dialog + menu**

In `src/styles/tailwind.css` add component styles for:

- `dialog.board-filter-dialog` — centered modal, `bg-panel`, border, max-height, padding; backdrop `::backdrop` dim
- `.board-filter-menu` summary + dropdown panel (absolute, z-index, border, bg-panel)
- `.board-filter-option` list rows; active state
- Keep compact; dialog body `overflow-y: auto; max-height: min(60vh, 24rem)`

Run: `pnpm build:css`

- [ ] **Step 6: Commit**

```bash
git add src/pages/leaderboard-href.ts src/pages/components/filter-pill.tsx \
  src/pages/components/board-filters.tsx src/styles/tailwind.css src/styles/app.css \
  src/pages/ui.ts src/__tests__/home-filters.test.ts
git commit -m "feat: add board filter dialog components"
```

---

### Task 2: Wire filters into leaderboard chart; remove homepage selects

**Files:**

- Modify: `src/pages/leaderboard-chart.tsx`
- Modify: `src/pages/home.tsx`
- Modify: `src/__tests__/home-filters.test.ts`

**Interfaces:**

- Consumes: `BoardFilters`, `boardHref` from Task 1
- Produces: `LeaderboardChart` accepts `models: string[]` and `countries: string[]`

- [ ] **Step 1: Update `LeaderboardChart`**

- Import `boardHref` from `@/pages/leaderboard-href`; remove local `boardHref` copy
- Import `BoardFilters`
- Extend props with `models: string[]` and `countries: string[]`
- After the metric tabs row (`</div>` closing the METRICS map), before the ranking list container, render:

```tsx
<BoardFilters
    window={window}
    metric={metric}
    source={source}
    model={model}
    country={country}
    models={models}
    countries={countries}
/>
```

- [ ] **Step 2: Update `Home`**

- Remove the entire `<form class={filters}>…</form>` block and unused `Input` / `AUTO_SUBMIT` / filterLabel imports (`countryName`/`flagEmoji`/`familyLabel` if unused)
- Pass `models={p.models}` and `countries={p.countries}` into `LeaderboardChart`

- [ ] **Step 3: Homepage HTML assertions**

Extend `src/__tests__/home-filters.test.ts` (mirror `home-hero.test.ts` env/browser headers):

```ts
describe('homepage board filters', () => {
    it('renders filter control inside the board, not select form', async () => {
        const res = await app.request(
            'https://tokenmaxer.quest/?window=7d&metric=total&source=codex',
            { headers: browserHeaders },
            env(),
        );
        expect(res.status).toBe(200);
        const html = await res.text();
        expect(html).toContain('id="board-filters"');
        expect(html).toContain('board-filter-menu');
        expect(html).toContain('filter-dialog-source');
        expect(html).toContain('filter-dialog-model');
        expect(html).not.toContain('id="filter-source"');
        expect(html).not.toContain('name="source"');
        expect(html).toContain('filter-pill');
        expect(html).toContain('source=codex');
        // clear pill omits source
        expect(html).toMatch(/href="\/\?window=7d&amp;metric=total"/);
    });
});
```

Run: `pnpm test src/__tests__/home-filters.test.ts`
Expected: PASS

- [ ] **Step 4: Typecheck + commit**

```bash
pnpm typecheck
git add src/pages/leaderboard-chart.tsx src/pages/home.tsx src/__tests__/home-filters.test.ts
git commit -m "feat: move homepage filters into leaderboard dialogs"
```

---

### Task 3: Hackathons about page + nav link

**Files:**

- Create: `src/pages/hackathons.tsx`
- Modify: `src/pages/layout.tsx`
- Modify: `src/index.tsx`
- Create: `src/__tests__/hackathons-page.test.ts`

**Interfaces:**

- Produces: `HackathonsAbout: FC<{ base: string }>`
- Route: `GET /hackathons` → `c.html(<HackathonsAbout base={…} />)`

- [ ] **Step 1: Write failing route test**

```ts
// src/__tests__/hackathons-page.test.ts
import { describe, expect, it } from 'vitest';
import { stubKv } from '@/__tests__/helpers/kv';
import app from '@/index';
import type { Env } from '@/types';

// emptyDb + env + browserHeaders same pattern as home-hero.test.ts

describe('hackathons about page', () => {
    it('serves about content and is linked from the header', async () => {
        const res = await app.request(
            'https://tokenmaxer.quest/hackathons',
            { headers: browserHeaders },
            env(),
        );
        expect(res.status).toBe(200);
        const html = await res.text();
        expect(html).toContain('Hackathons');
        expect(html).toContain('/h/new');
        expect(html).toContain('/h/mine');
        expect(html).toContain('Get started');
        expect(html).toContain('href="/hackathons"');
    });
});
```

Run: `pnpm test src/__tests__/hackathons-page.test.ts`
Expected: FAIL (404 or missing content)

- [ ] **Step 2: Page component**

Create `src/pages/hackathons.tsx` matching `/about` structure:

- Hero: title **Hackathons**, short subcopy about timed contests on the tokenmaxer board
- Sections: What they are; How they work (create → share join link → report sessions → ranked board); Get started (claim/sign in → create → invite → join)
- CTAs: primary **Create a hackathon** → `/h/new`; secondary **My hackathons** → `/h/mine`; link to `/start` for claiming a username

- [ ] **Step 3: Route + nav**

In `src/index.tsx`: import `HackathonsAbout` (or `Hackathons`); add near `/about`:

```ts
app.get('/hackathons', async (c) => {
    withAgentDiscoveryHeaders(c);
    return c.html(<HackathonsAbout base={baseUrl(c.env, c.req.url)} />);
});
```

In `src/pages/layout.tsx` header nav, between Leaderboard and Get started:

```tsx
<a
    class="nav-link …"
    href="/hackathons"
>
    Hackathons
</a>
```

Add the same link under footer Product column.

- [ ] **Step 4: Pass tests + commit**

```bash
pnpm test src/__tests__/hackathons-page.test.ts
pnpm typecheck
git add src/pages/hackathons.tsx src/pages/layout.tsx src/index.tsx src/__tests__/hackathons-page.test.ts
git commit -m "feat: add hackathons about page and nav link"
```

---

### Task 4: Verify full suite

- [ ] **Step 1:** Run `pnpm build:css && pnpm check` (or at least `pnpm test && pnpm typecheck && pnpm lint`)
- [ ] **Step 2:** Fix any regressions from filter wiring (e.g. other imports of removed `boardHref` local)
- [ ] **Step 3:** Commit any fixups if needed

---

## Spec coverage checklist

| Spec requirement                      | Task                  |
| ------------------------------------- | --------------------- |
| Remove selects above chart            | Task 2                |
| Filter strip between metrics and list | Task 2                |
| Filter → dropdown → dialog            | Task 1                |
| Immediate navigate                    | Task 1 (option links) |
| Removable pills                       | Task 1                |
| Preserve window/metric in URLs        | Task 1 `boardHref`    |
| Header Hackathons → `/hackathons`     | Task 3                |
| About + get-started + CTAs            | Task 3                |
| Footprint unchanged                   | (no task)             |
