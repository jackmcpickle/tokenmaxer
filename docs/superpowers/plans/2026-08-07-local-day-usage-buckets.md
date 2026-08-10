# Local-Day Usage Buckets Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Attribute every token to the calendar day it was actually spent on, so a leaderboard window reports real usage in that window instead of the totals of sessions that happened to _start_ in it.

**Architecture:** Today one row per `(user, source, session_id, model)` carries a session's whole lifetime total, stamped with `started_at`, and every window filters `started_at >= cutoff`. A 418-hour session therefore books a fortnight of work to the day it opened, and the UTC-midnight `today` boundary clips the first 9.5 hours of a UTC+9:30 user's day. The fix adds a `day` column (a `YYYYMMDD` integer in the **reporting machine's local timezone**) to the primary key. Only the reporter can do this split — it is the only component that sees per-entry timestamps — so each collector now buckets usage by the local day of each usage record, and each window query filters on `day` instead of `started_at`. Ingest gains an explicit `replace_sessions` list so a session's day rows atomically replace whatever was stored for it before, including its single legacy row.

**Tech Stack:** TypeScript (strict), TanStack Start + Hono on Cloudflare Workers, D1 (SQLite) with raw `drizzle/*.sql` migrations, Vitest, pnpm. Reporter is a standalone Node CLI in `reporter/` published to npm as `tokenmaxer`.

## Global Constraints

- **`day` is always a `YYYYMMDD` integer** (e.g. `20260807`). `0` means "unknown / all time". Never a string, never epoch ms.
- **`day` is the reporter's LOCAL calendar day.** The reporter machine's timezone decides the date; the server never re-derives it from an instant except for legacy rows that carry no `day`.
- **`started_at` semantics do not change.** It remains the session's start instant, informational only after this change. No query filters on it.
- **Backward compatibility is mandatory.** `tokenmaxer` is published on npm; installs in the wild post rows with no `day` and no `replace_sessions`. Those requests must keep succeeding, with `day` derived from `started_at` in UTC and no delete step.
- **Existing totals must not change.** After the migration, every all-time total on the site is byte-identical to before. Only the per-window attribution moves, and only once a user re-reports.
- Tests live in `src/__tests__/*.test.ts` (vitest `include` is `src/**/*.test.ts`) — reporter tests too, imported by relative path (`../../reporter/src/...`).
- **`src/__tests__/reporter-day.test.ts` pins its timezone.** Its first statement is `process.env.TZ = 'Australia/Adelaide';`, before any import that touches `Date`, and every day expectation in it is a **literal** `YYYYMMDD` integer. Never assert `row.day === localDay(ms)` — comparing the implementation against itself proves nothing, and an unpinned zone makes the Cursor split case vacuous at UTC's zero offset.
- Run `pnpm check` (lint + fmt + typecheck + test) before every commit. Commits are conventional (`feat:`, `fix:`, `refactor:`, `docs:`) — `commit-and-tag-version` reads them.
- Formatting is `oxfmt`: 4-space indent, single quotes, trailing commas. Run `pnpm fmt` if a commit is rejected by `fmt:check`.
- Do **not** hand-edit `CHANGELOG.md` or bump `package.json` versions; the release job does that.

## Design decisions already settled (do not relitigate)

| Decision         | Choice                                                                                                                                       |
| ---------------- | -------------------------------------------------------------------------------------------------------------------------------------------- |
| Bucket key       | Reporter's **local** calendar day, `YYYYMMDD`                                                                                                |
| Existing rows    | Migrate in place, seeding `day` from the **UTC** day of `started_at`; correct data arrives when a user runs `tokenmaxer backfill`            |
| Old reporters    | Accepted; server derives `day` from `started_at`                                                                                             |
| Scope            | All five sources (claude_code, codex, opencode, pi, cursor)                                                                                  |
| Window semantics | `today` = viewer's local calendar date; `7d` = that date and the 6 before it (7 calendar days); `30d` = 30 calendar days; `all` = everything |
| Hackathon ranges | Snap **outward** to whole UTC days. A hackathon is day-granular after this change — a sub-day range now includes both boundary days in full. |
| Viewer timezone  | `request.cf.timezone` when present, else `UTC`. Baked into every cache key so two zones never share a cached board.                          |

## File Structure

**New files**

| File                                 | Responsibility                                                                       |
| ------------------------------------ | ------------------------------------------------------------------------------------ |
| `reporter/src/lib/day.ts`            | `localDay(ms)` — the reporter's only date authority.                                 |
| `src/lib/day.ts`                     | Server date maths: `dayFromMs`, `shiftDay`, `windowStartDay`, `timeZoneFromRequest`. |
| `drizzle/0005_local_day_buckets.sql` | Table rebuild adding `day` to the primary key.                                       |
| `src/__tests__/day.test.ts`          | Server date helpers.                                                                 |
| `src/__tests__/reporter-day.test.ts` | `localDay` + day-bucketing behaviour across collectors.                              |

**Modified files**

| File                                                                                                              | Change                                                                             |
| ----------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------- |
| `reporter/src/lib/types.ts`                                                                                       | `DayTotals`; `ParsedTranscript.models: Map<string, DayTotals>`; `ReporterRow.day`. |
| `reporter/src/lib/totals.ts`                                                                                      | `accumulateModelDayUsage`, `singleDayModels`.                                      |
| `reporter/src/lib/rows.ts`                                                                                        | `toRows` emits one row per (model, day).                                           |
| `reporter/src/agents/claude.ts`                                                                                   | Per-entry local-day buckets.                                                       |
| `reporter/src/agents/claude-sessions.ts`                                                                          | Session fallback day.                                                              |
| `reporter/src/agents/codex-engine.ts`                                                                             | `TokenCountRecord.tsMs`; day-aware delta accumulation.                             |
| `reporter/src/agents/pi.ts`                                                                                       | Per-record local-day buckets.                                                      |
| `reporter/src/agents/opencode.ts`                                                                                 | Per-message local-day buckets.                                                     |
| `reporter/src/agents/cursor.ts`                                                                                   | Per-event local-day buckets inside each UTC-day session.                           |
| `reporter/src/api.ts`                                                                                             | Session-contiguous batching + `replace_sessions`.                                  |
| `src/reporter.d.ts`                                                                                               | Mirror the reporter's new types.                                                   |
| `src/types.ts`                                                                                                    | `SessionUsageInput.day`.                                                           |
| `src/lib/validate.ts`                                                                                             | Parse `day` and `replace_sessions`.                                                |
| `src/lib/store.ts`                                                                                                | Delete-then-insert per replaced session; write `day`.                              |
| `src/lib/aggregate.ts`                                                                                            | Filter on `day`; `startDay`/`endDay` query fields.                                 |
| `src/lib/cached-aggregate.ts`                                                                                     | `startDay` in cache keys, keys bumped to `v2`.                                     |
| `src/lib/page-cache.ts`                                                                                           | Viewer-date component in the HTTP cache keys.                                      |
| `src/api/ingest.ts`, `src/api/history.ts`                                                                         | Pass `replaceSessions` through.                                                    |
| `src/api/leaderboard.ts`, `src/api/agent-pages.ts`, `src/api/og.ts`, `src/index.tsx`, `src/core/api/board.api.ts` | Resolve `startDay` from the viewer's timezone.                                     |
| `README.md`, `src/content/about.md.ts`, `src/pages/about.tsx`                                                     | Document local-day attribution.                                                    |

---

### Task 1: Reporter local-day helper

**Files:**

- Create: `reporter/src/lib/day.ts`
- Test: `src/__tests__/reporter-day.test.ts`

**Interfaces:**

- Consumes: nothing.
- Produces: `localDay(ms: number | null | undefined): number` — `YYYYMMDD` in the process's local timezone, `0` when the input is not a finite number.

- [ ] **Step 1: Write the failing test**

Create `src/__tests__/reporter-day.test.ts`. The `TZ` assignment must be the file's first statement, before any import that touches `Date`, and every expected day is a literal integer (see Global Constraints).

```ts
// Pinned so every day expectation below is a literal, verifiable date. UTC+9:30
// also makes the local/UTC divergence this feature exists for observable.
process.env.TZ = 'Australia/Adelaide';

import { describe, expect, it } from 'vitest';
import { localDay } from '../../reporter/src/lib/day';

describe('localDay', () => {
    it('returns the local calendar date as YYYYMMDD', () => {
        expect(localDay(new Date(2026, 7, 7, 9, 17).getTime())).toBe(20260807);
    });

    it('rolls over at local midnight, not UTC midnight', () => {
        expect(localDay(new Date(2026, 7, 6, 23, 59, 59).getTime())).toBe(
            20260806,
        );
        expect(localDay(new Date(2026, 7, 7, 0, 0, 0).getTime())).toBe(
            20260807,
        );
    });

    it('zero-pads month and day into the integer', () => {
        expect(localDay(new Date(2026, 0, 5, 12, 0).getTime())).toBe(20260105);
    });

    it('returns 0 for missing or non-finite timestamps', () => {
        expect(localDay(null)).toBe(0);
        expect(localDay(undefined)).toBe(0);
        expect(localDay(Number.NaN)).toBe(0);
        expect(localDay(Number.POSITIVE_INFINITY)).toBe(0);
    });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run src/__tests__/reporter-day.test.ts`
Expected: FAIL — `Failed to resolve import "../../reporter/src/lib/day"`.

- [ ] **Step 3: Write minimal implementation**

Create `reporter/src/lib/day.ts`:

```ts
/**
 * Calendar dates as YYYYMMDD integers (20260807), in the REPORTER's local
 * timezone. Usage belongs to the day the user would name if asked when they
 * spent it, so a session spanning a fortnight contributes to every day it
 * touched instead of booking everything to the day it opened.
 *
 * 0 is the "unknown day" sentinel: callers substitute a fallback (the session's
 * start day) rather than inventing a date from the wall clock mid-parse.
 */
export function localDay(ms: number | null | undefined): number {
    if (typeof ms !== 'number' || !Number.isFinite(ms)) return 0;
    const d = new Date(ms);
    return d.getFullYear() * 10_000 + (d.getMonth() + 1) * 100 + d.getDate();
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm vitest run src/__tests__/reporter-day.test.ts`
Expected: PASS (4 tests)

- [ ] **Step 5: Commit**

```bash
git add reporter/src/lib/day.ts src/__tests__/reporter-day.test.ts
git commit -m "feat(reporter): add local calendar day helper"
```

---

### Task 2: Server day maths

**Files:**

- Create: `src/lib/day.ts`
- Test: `src/__tests__/day.test.ts`

**Interfaces:**

- Consumes: `TimeWindow` from `@/types`.
- Produces:
    - `dayFromMs(ms: number, timeZone: string): number` — `YYYYMMDD` of `ms` in `timeZone`; `0` for non-finite input; falls back to UTC for an unknown zone.
    - `shiftDay(day: number, deltaDays: number): number`
    - `windowStartDay(window: TimeWindow, now: number, timeZone: string): number` — inclusive lower bound; `0` for `all`.
    - `timeZoneFromRequest(req: Request): string`

- [ ] **Step 1: Write the failing test**

Create `src/__tests__/day.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import {
    dayFromMs,
    shiftDay,
    timeZoneFromRequest,
    windowStartDay,
} from '@/lib/day';

const NOW = Date.parse('2026-08-07T09:54:00Z');

describe('dayFromMs', () => {
    it('reads the calendar date in the given zone', () => {
        expect(dayFromMs(NOW, 'UTC')).toBe(20260807);
        // UTC+9:30 — already the 7th, 19:24 local.
        expect(dayFromMs(NOW, 'Australia/Adelaide')).toBe(20260807);
        // UTC-7 — 02:54 local, still the 7th.
        expect(dayFromMs(NOW, 'America/Los_Angeles')).toBe(20260807);
        // Four hours earlier is 21:00 on the 6th in Los Angeles.
        expect(
            dayFromMs(
                Date.parse('2026-08-07T04:00:00Z'),
                'America/Los_Angeles',
            ),
        ).toBe(20260806);
    });

    it('falls back to UTC for an unknown zone', () => {
        expect(dayFromMs(NOW, 'Not/AZone')).toBe(20260807);
    });

    it('returns 0 for non-finite input', () => {
        expect(dayFromMs(Number.NaN, 'UTC')).toBe(0);
    });
});

describe('shiftDay', () => {
    it('walks backwards across a month boundary', () => {
        expect(shiftDay(20260801, -1)).toBe(20260731);
        expect(shiftDay(20260807, -6)).toBe(20260801);
    });
    it('walks backwards across a year boundary', () => {
        expect(shiftDay(20260101, -1)).toBe(20251231);
    });
    it('handles leap days', () => {
        expect(shiftDay(20280301, -1)).toBe(20280229);
    });
    it('walks forwards too', () => {
        expect(shiftDay(20260228, 1)).toBe(20260301);
    });
});

describe('windowStartDay', () => {
    it('today is the viewer calendar date', () => {
        expect(windowStartDay('today', NOW, 'UTC')).toBe(20260807);
    });
    it('7d covers 7 calendar days including today', () => {
        expect(windowStartDay('7d', NOW, 'UTC')).toBe(20260801);
    });
    it('30d covers 30 calendar days including today', () => {
        expect(windowStartDay('30d', NOW, 'UTC')).toBe(20260709);
    });
    it('all time has no lower bound', () => {
        expect(windowStartDay('all', NOW, 'UTC')).toBe(0);
    });
    it('uses the viewer zone, so a zone behind UTC gets an earlier date', () => {
        const earlyUtc = Date.parse('2026-08-07T04:00:00Z');
        expect(windowStartDay('today', earlyUtc, 'America/Los_Angeles')).toBe(
            20260806,
        );
    });
});

describe('timeZoneFromRequest', () => {
    it('reads the Cloudflare timezone', () => {
        const req = new Request('https://tokenmaxer.quest/');
        Object.defineProperty(req, 'cf', {
            value: { timezone: 'Australia/Adelaide' },
        });
        expect(timeZoneFromRequest(req)).toBe('Australia/Adelaide');
    });
    it('defaults to UTC when absent or not a string', () => {
        expect(
            timeZoneFromRequest(new Request('https://tokenmaxer.quest/')),
        ).toBe('UTC');
    });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run src/__tests__/day.test.ts`
Expected: FAIL — cannot resolve `@/lib/day`.

- [ ] **Step 3: Write minimal implementation**

Create `src/lib/day.ts`:

```ts
import type { TimeWindow } from '@/types';

/**
 * Calendar dates as YYYYMMDD integers. Usage rows carry the REPORTER's local
 * date; the server only ever computes a date to pick a window's lower bound
 * (from the viewer's zone) or to seed a legacy row that arrived without one.
 */
const DATE_PARTS = {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
} as const;

const UTC_FORMATTER = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'UTC',
    ...DATE_PARTS,
});

const formatters = new Map<string, Intl.DateTimeFormat>([
    ['UTC', UTC_FORMATTER],
]);

function formatterFor(timeZone: string): Intl.DateTimeFormat {
    const cached = formatters.get(timeZone);
    if (cached) return cached;
    let fmt: Intl.DateTimeFormat;
    try {
        fmt = new Intl.DateTimeFormat('en-CA', { timeZone, ...DATE_PARTS });
    } catch {
        // An unknown or malformed zone must not fail a page render; UTC is the
        // documented fallback (and the same default as a missing cf.timezone).
        fmt = UTC_FORMATTER;
    }
    formatters.set(timeZone, fmt);
    return fmt;
}

/** YYYYMMDD of `ms` in `timeZone`; 0 when `ms` is not a finite instant. */
export function dayFromMs(ms: number, timeZone: string): number {
    if (!Number.isFinite(ms)) return 0;
    // formatToParts, not format(): part order is locale data we don't control.
    let year = 0;
    let month = 0;
    let day = 0;
    for (const part of formatterFor(timeZone).formatToParts(new Date(ms))) {
        if (part.type === 'year') year = Number.parseInt(part.value, 10);
        else if (part.type === 'month') month = Number.parseInt(part.value, 10);
        else if (part.type === 'day') day = Number.parseInt(part.value, 10);
    }
    if (!year || !month || !day) return 0;
    return year * 10_000 + month * 100 + day;
}

/** The calendar date `deltaDays` away from `day`, month/year/leap aware. */
export function shiftDay(day: number, deltaDays: number): number {
    const year = Math.floor(day / 10_000);
    const month = Math.floor((day % 10_000) / 100);
    const date = day % 100;
    const shifted = new Date(
        Date.UTC(year, month - 1, date) + deltaDays * 86_400_000,
    );
    return (
        shifted.getUTCFullYear() * 10_000 +
        (shifted.getUTCMonth() + 1) * 100 +
        shifted.getUTCDate()
    );
}

/**
 * Inclusive lower bound for a window, as a calendar date in the viewer's zone.
 * Windows are whole calendar days, not rolling hour spans: `7d` is today plus
 * the six days before it.
 */
export function windowStartDay(
    window: TimeWindow,
    now: number,
    timeZone: string,
): number {
    switch (window) {
        case 'all':
            return 0;
        case 'today':
            return dayFromMs(now, timeZone);
        case '7d':
            return shiftDay(dayFromMs(now, timeZone), -6);
        case '30d':
            return shiftDay(dayFromMs(now, timeZone), -29);
        default: {
            const exhaustive: never = window;
            return exhaustive;
        }
    }
}

/** The viewer's IANA timezone from Cloudflare's request metadata, else UTC. */
export function timeZoneFromRequest(req: Request): string {
    const cf = (req as Request & { cf?: { timezone?: unknown } }).cf;
    const tz = cf?.timezone;
    return typeof tz === 'string' && tz ? tz : 'UTC';
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm vitest run src/__tests__/day.test.ts`
Expected: PASS. If the `America/Los_Angeles` cases fail, the test runner lacks full ICU — re-run with `pnpm vitest run src/__tests__/day.test.ts` under Node 24 (the repo's `.nvmrc`), which ships full ICU; do not weaken the test.

- [ ] **Step 5: Commit**

```bash
git add src/lib/day.ts src/__tests__/day.test.ts
git commit -m "feat: add timezone-aware calendar day helpers"
```

---

### Task 3: Thread a day dimension through the reporter (no behaviour change)

This is a pure refactor: every row still lands on the session's start day, so totals and per-day attribution are unchanged. It exists so Tasks 9–13 can convert one collector at a time with the suite green throughout.

**Files:**

- Modify: `reporter/src/lib/types.ts`, `reporter/src/lib/totals.ts`, `reporter/src/lib/rows.ts`
- Modify: `reporter/src/agents/claude.ts:108`, `reporter/src/agents/claude-sessions.ts:604-619`, `reporter/src/agents/codex-engine.ts:1380-1390`, `reporter/src/agents/pi.ts:122-126`, `reporter/src/agents/opencode.ts:73-77`, `reporter/src/agents/cursor.ts:50-62`
- Modify: `src/reporter.d.ts`
- Test: `src/__tests__/reporter-rows.test.ts`

**Interfaces:**

- Consumes: `localDay` (Task 1).
- Produces:
    - `type DayTotals = Map<number, ReporterTotals>` — keyed by `YYYYMMDD`.
    - `ParsedTranscript.models: Map<string, DayTotals>`
    - `ReporterRow.day: number`
    - `accumulateModelDayUsage(models: Map<string, DayTotals>, model: string, day: number, usage: ReporterTotals): void`
    - `singleDayModels(models: Map<string, ReporterTotals>, day: number): Map<string, DayTotals>` — temporary bridge, deleted by Task 13.

- [ ] **Step 1: Write the failing test**

Replace the `toRows` test in `src/__tests__/reporter-rows.test.ts` (the `it('toRows emits one API row per non-synthetic model', …)` block) with:

```ts
it('toRows emits one row per (model, day) and skips synthetic models', () => {
    const models = new Map([
        [
            'claude-opus',
            new Map([
                [
                    20260806,
                    { ...emptyTotals(), input_tokens: 10, output_tokens: 20 },
                ],
                [20260807, { ...emptyTotals(), output_tokens: 5 }],
            ]),
        ],
        ['<synthetic>', new Map([[20260807, emptyTotals()]])],
    ]);
    const rows = toRows(
        { session_id: 'sess-1', started_at: 1_000, models },
        '/tmp/sess-1.jsonl',
    );
    expect(rows).toHaveLength(2);
    expect(rows.map((r) => r.day)).toEqual([20260806, 20260807]);
    expect(rows.every((r) => r.session_id === 'sess-1')).toBe(true);
    // started_at stays the SESSION start on every row; `day` carries time.
    expect(rows.every((r) => r.started_at === 1_000)).toBe(true);
    expect(rows[0]?.input_tokens).toBe(10);
    expect(rows[1]?.output_tokens).toBe(5);
});
```

Append to the same `describe` block:

```ts
it('accumulateModelDayUsage keeps days and models separate', () => {
    const models = new Map<string, Map<number, ReporterTotals>>();
    accumulateModelDayUsage(models, 'opus', 20260807, {
        ...emptyTotals(),
        output_tokens: 3,
    });
    accumulateModelDayUsage(models, 'opus', 20260807, {
        ...emptyTotals(),
        output_tokens: 4,
    });
    accumulateModelDayUsage(models, 'opus', 20260808, {
        ...emptyTotals(),
        output_tokens: 5,
    });
    accumulateModelDayUsage(models, 'sonnet', 20260807, {
        ...emptyTotals(),
        output_tokens: 6,
    });
    expect(models.get('opus')?.get(20260807)?.output_tokens).toBe(7);
    expect(models.get('opus')?.get(20260808)?.output_tokens).toBe(5);
    expect(models.get('sonnet')?.get(20260807)?.output_tokens).toBe(6);
});

it('singleDayModels puts every model total on one day', () => {
    const flat = new Map([['opus', { ...emptyTotals(), input_tokens: 9 }]]);
    const byDay = singleDayModels(flat, 20260807);
    expect(byDay.get('opus')?.get(20260807)?.input_tokens).toBe(9);
});
```

Update that file's imports:

```ts
import {
    accumulateModelDayUsage,
    emptyTotals,
    singleDayModels,
} from '../../reporter/src/lib/totals';
import type { ReporterTotals } from '../../reporter/src/lib/types';
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run src/__tests__/reporter-rows.test.ts`
Expected: FAIL — `accumulateModelDayUsage` / `singleDayModels` are not exported, and `toRows` returns rows without `day`.

- [ ] **Step 3: Write minimal implementation**

In `reporter/src/lib/types.ts`, add `DayTotals` and change the two shapes:

```ts
/** Per-day totals for one model, keyed by YYYYMMDD in the reporter's local zone. */
export type DayTotals = Map<number, ReporterTotals>;

export interface ParsedTranscript {
    session_id: string | null;
    started_at: number | null;
    models: Map<string, DayTotals>;
}

export interface ReporterRow extends ReporterTotals {
    session_id: string;
    model: string;
    /** Local calendar day the usage was spent on, YYYYMMDD. */
    day: number;
    started_at: number;
}
```

In `reporter/src/lib/totals.ts`, append (keep `accumulateModelUsage` — cursor and pi still use it for their own flat maps):

```ts
export function accumulateModelDayUsage(
    models: Map<string, DayTotals>,
    model: string,
    day: number,
    usage: ReporterTotals,
): void {
    const byDay = models.get(model) ?? new Map<number, ReporterTotals>();
    const t = byDay.get(day) ?? emptyTotals();
    addUsage(t, usage);
    byDay.set(day, t);
    models.set(model, byDay);
}

/**
 * Bridge for collectors that have not been converted to per-entry day
 * bucketing yet: puts each model's whole total on one day.
 */
export function singleDayModels(
    models: Map<string, ReporterTotals>,
    day: number,
): Map<string, DayTotals> {
    const out = new Map<string, DayTotals>();
    for (const [model, t] of models) out.set(model, new Map([[day, t]]));
    return out;
}
```

Add `DayTotals` to that file's type import from `./types`.

In `reporter/src/lib/rows.ts`, replace the body of `toRows`:

```ts
/** Turn a parsed result into API session rows (one per model per local day). */
export function toRows(parsed: ParsedTranscript, path?: string): ReporterRow[] {
    const sid = parsed.session_id ?? sessionIdFromPath(path ?? '');
    const startedAt = parsed.started_at ?? Date.now();
    const rows: ReporterRow[] = [];
    for (const [model, byDay] of parsed.models) {
        if (isSyntheticModel(model)) continue;
        for (const [day, t] of byDay) {
            rows.push({
                session_id: sid,
                model,
                day,
                started_at: startedAt,
                ...t,
            });
        }
    }
    return rows;
}
```

Now bridge each collector so the package compiles, with identical behaviour:

`reporter/src/agents/claude.ts` — import `localDay` and `singleDayModels`, then change the return of `parseClaudeTranscript`:

```ts
export function parseClaudeTranscript(
    text: string,
    opts: ParseOpts = {},
): ParsedTranscript {
    const scan = scanClaudeTranscript(text);
    const startedAt = scan.startedAt ?? opts.fallbackStartedAt ?? null;
    return {
        session_id: opts.sessionId || scan.sessionId || null,
        started_at: startedAt,
        models: singleDayModels(
            sumClaudeRows([...scan.keyed.values(), ...scan.unkeyed]),
            localDay(startedAt ?? Date.now()),
        ),
    };
}
```

`reporter/src/agents/claude-sessions.ts` — in `sessionRows`, wrap the same way:

```ts
function sessionRows(sessions: Map<string, SessionState>): ReporterRow[] {
    const rows: ReporterRow[] = [];
    for (const s of sessions.values()) {
        rows.push(
            ...toRows({
                session_id: s.sid,
                started_at: s.startedAt,
                models: singleDayModels(
                    sumClaudeRows([
                        ...[...s.keyed.values()].map((k) => k.row),
                        ...s.unkeyed,
                    ]),
                    localDay(s.startedAt ?? Date.now()),
                ),
            }),
        );
    }
    return rows;
}
```

Add `import { localDay } from '../lib/day';` and `import { singleDayModels } from '../lib/totals';` there.

`reporter/src/agents/codex-engine.ts` — `ParsedCodexRollout.models` becomes `Map<string, DayTotals>`; keep the internal `models` map flat for now and wrap at the single return site (`return { session_id: …, started_at: …, models, parent_id: … }` near line 1385):

```ts
const resolvedStartedAt = startedAt ?? opts.fallbackStartedAt ?? null;
return {
    session_id: sessionId,
    started_at: resolvedStartedAt,
    models: singleDayModels(models, localDay(resolvedStartedAt ?? Date.now())),
    parent_id: forkedFromId,
};
```

`reporter/src/agents/pi.ts` — same shape:

```ts
const resolvedStartedAt = state.startedAt ?? opts.fallbackStartedAt ?? null;
return {
    session_id: state.sessionId ?? opts.sessionId ?? null,
    started_at: resolvedStartedAt,
    models: singleDayModels(models, localDay(resolvedStartedAt ?? Date.now())),
};
```

`reporter/src/agents/opencode.ts` — same shape in `parseOpencodeMessages`:

```ts
const resolvedStartedAt = startedAt ?? opts.fallbackStartedAt ?? null;
return {
    session_id: sessionId ?? opts.sessionId ?? null,
    started_at: resolvedStartedAt,
    models: singleDayModels(models, localDay(resolvedStartedAt ?? Date.now())),
};
```

`reporter/src/agents/cursor.ts` — its rows are built directly, so give them the exact day of the UTC-day bucket they already carry (no `localDay` here; Task 13 revisits this):

```ts
for (const [day, byModel] of days) {
    const startedAt = Date.parse(`${day}T00:00:00Z`);
    const dayNumber = Number.parseInt(day.replace(/-/gu, ''), 10);
    for (const [model, t] of byModel) {
        rows.push({
            session_id: `cursor-${day}`,
            model,
            day: dayNumber,
            started_at: startedAt,
            ...t,
        });
    }
}
```

Finally mirror the types in `src/reporter.d.ts`:

```ts
export type DayTotals = Map<number, ReporterTotals>;
export interface ParsedTranscript {
    session_id: string | null;
    started_at: number | null;
    models: Map<string, DayTotals>;
}
export interface ReporterRow extends ReporterTotals {
    session_id: string;
    model: string;
    day: number;
    started_at: number;
}
```

- [ ] **Step 4: Run the full suite**

Run: `pnpm check`
Expected: PASS. Other reporter tests read `parsed.models.get(model)` — update each to `parsed.models.get(model)?.get(day)` where `day` is the session-start day the test's fixture implies (`src/__tests__/reporter.test.ts`, `reporter-pi-cursor.test.ts`, `reporter-collect.test.ts`, `reporter-claude-sessions.test.ts`, `reporter-shared.test.ts`). Prefer a local helper in each file over repeating the lookup:

```ts
function dayTotals(
    parsed: { models: Map<string, Map<number, ReporterTotals>> },
    model: string,
): ReporterTotals | undefined {
    const byDay = parsed.models.get(model);
    if (!byDay) return undefined;
    // Task 3 puts a session's whole total on one day; assert that's still true.
    expect(byDay.size).toBe(1);
    return [...byDay.values()][0];
}
```

- [ ] **Step 5: Commit**

```bash
git add reporter/src src/reporter.d.ts src/__tests__
git commit -m "refactor(reporter): thread a per-day dimension through parsed usage"
```

---

### Task 4: Migration — add `day` to the primary key

**Files:**

- Create: `drizzle/0005_local_day_buckets.sql`

**Interfaces:**

- Consumes: the `session_usage` table from `drizzle/0000_init.sql`.
- Produces: `session_usage` with a `day INTEGER NOT NULL` column and primary key `(user_id, source, session_id, model, day)`, plus `idx_session_usage_day`.

- [ ] **Step 1: Write the migration**

SQLite cannot add a column to a primary key, so the table is rebuilt. Create `drizzle/0005_local_day_buckets.sql`:

```sql
-- Day-bucketed usage. `day` is a YYYYMMDD integer in the REPORTING MACHINE's
-- local timezone: usage belongs to the calendar day it was spent on, so a
-- long-running session contributes to every day it touched instead of booking
-- its whole lifetime to the day it started.
--
-- Existing rows are seeded from the UTC day of started_at. That preserves every
-- total exactly while leaving the old (wrong) per-day attribution in place
-- until the owner runs `tokenmaxer backfill`, which re-derives real day rows
-- and replaces the seeded ones via the ingest replace_sessions contract.
CREATE TABLE session_usage_new (
  user_id               TEXT NOT NULL,
  source                TEXT NOT NULL,
  session_id            TEXT NOT NULL,
  model                 TEXT NOT NULL,
  day                   INTEGER NOT NULL,   -- YYYYMMDD, reporter-local
  input_tokens          INTEGER NOT NULL DEFAULT 0,
  output_tokens         INTEGER NOT NULL DEFAULT 0,
  cache_read_tokens     INTEGER NOT NULL DEFAULT 0,
  cache_creation_tokens INTEGER NOT NULL DEFAULT 0,
  reasoning_tokens      INTEGER NOT NULL DEFAULT 0,
  started_at            INTEGER NOT NULL,   -- session start (ms), informational
  updated_at            INTEGER NOT NULL,   -- last report (ms)
  PRIMARY KEY (user_id, source, session_id, model, day),
  FOREIGN KEY (user_id) REFERENCES users (id)
);

INSERT INTO session_usage_new (
  user_id, source, session_id, model, day,
  input_tokens, output_tokens, cache_read_tokens, cache_creation_tokens,
  reasoning_tokens, started_at, updated_at
)
SELECT
  user_id, source, session_id, model,
  CAST(strftime('%Y%m%d', started_at / 1000, 'unixepoch') AS INTEGER),
  input_tokens, output_tokens, cache_read_tokens, cache_creation_tokens,
  reasoning_tokens, started_at, updated_at
FROM session_usage;

DROP TABLE session_usage;

ALTER TABLE session_usage_new RENAME TO session_usage;

-- Windows filter on `day` now; the old started_at index has no readers.
CREATE INDEX IF NOT EXISTS idx_session_usage_day ON session_usage (day);
CREATE INDEX IF NOT EXISTS idx_session_usage_user ON session_usage (user_id);
```

- [ ] **Step 2: Apply it locally and verify the shape**

```bash
pnpm db:migrate:local
npx wrangler d1 execute tokentally --local --command "SELECT sql FROM sqlite_master WHERE name='session_usage';"
```

Expected: the printed DDL contains `day INTEGER NOT NULL` and `PRIMARY KEY (user_id, source, session_id, model, day)`.

- [ ] **Step 3: Verify totals are preserved on seeded data**

```bash
npx wrangler d1 execute tokentally --local --command "INSERT OR IGNORE INTO users (id,username,username_lower,token_hash,created_at) VALUES ('mig-u','MigUser','miguser','mig-hash',0);"
npx wrangler d1 execute tokentally --local --command "INSERT INTO session_usage (user_id,source,session_id,model,day,input_tokens,output_tokens,cache_read_tokens,cache_creation_tokens,reasoning_tokens,started_at,updated_at) VALUES ('mig-u','claude_code','mig-s','claude-opus-5',20260807,1,2,3,4,5,1785974400000,1785974400000);"
npx wrangler d1 execute tokentally --local --command "SELECT day, input_tokens FROM session_usage WHERE user_id='mig-u';"
npx wrangler d1 execute tokentally --local --command "DELETE FROM session_usage WHERE user_id='mig-u'; DELETE FROM users WHERE id='mig-u';"
```

Expected: one row, `day = 20260807`, `input_tokens = 1`. (The `strftime` seeding itself is exercised only by rows that predate the migration; this check proves the new shape accepts writes.)

- [ ] **Step 4: Commit**

```bash
git add drizzle/0005_local_day_buckets.sql
git commit -m "feat(db): key session usage by local calendar day"
```

---

### Task 5: Accept `day` and `replace_sessions` on ingest

**Files:**

- Modify: `src/types.ts:31-40`, `src/lib/validate.ts:159-275`
- Test: `src/__tests__/validate.test.ts`

**Interfaces:**

- Consumes: `dayFromMs` (Task 2).
- Produces:
    - `SessionUsageInput.day: number`
    - `IngestPayload.replaceSessions: string[]`
    - Rule: a row without a usable `day` gets `dayFromMs(started_at, 'UTC')`.

- [ ] **Step 1: Write the failing test**

Append to `src/__tests__/validate.test.ts`:

```ts
describe('parseIngestBody day handling', () => {
    const base = { session_id: 's0', model: 'claude-opus-5', input_tokens: 1 };

    it('keeps a reporter-supplied day verbatim', () => {
        const parsed = parseIngestBody({
            source: 'claude_code',
            sessions: [{ ...base, started_at: 1, day: 20260807 }],
        });
        expect(parsed.ok).toBe(true);
        if (!parsed.ok) return;
        expect(parsed.value.sessions[0]?.day).toBe(20260807);
    });

    it('derives the day from started_at (UTC) for pre-day reporters', () => {
        const parsed = parseIngestBody({
            source: 'claude_code',
            sessions: [
                { ...base, started_at: Date.parse('2026-08-07T23:47:00Z') },
            ],
        });
        expect(parsed.ok).toBe(true);
        if (!parsed.ok) return;
        expect(parsed.value.sessions[0]?.day).toBe(20260807);
    });

    it('rejects an out-of-range day by falling back to started_at', () => {
        const parsed = parseIngestBody({
            source: 'claude_code',
            sessions: [
                {
                    ...base,
                    started_at: Date.parse('2026-08-07T00:00:00Z'),
                    day: 42,
                },
            ],
        });
        expect(parsed.ok).toBe(true);
        if (!parsed.ok) return;
        expect(parsed.value.sessions[0]?.day).toBe(20260807);
    });

    it('defaults replace_sessions to empty', () => {
        const parsed = parseIngestBody({
            source: 'claude_code',
            sessions: [base],
        });
        expect(parsed.ok).toBe(true);
        if (!parsed.ok) return;
        expect(parsed.value.replaceSessions).toEqual([]);
    });

    it('passes replace_sessions through', () => {
        const parsed = parseIngestBody({
            source: 'claude_code',
            sessions: [base],
            replace_sessions: ['s0'],
        });
        expect(parsed.ok).toBe(true);
        if (!parsed.ok) return;
        expect(parsed.value.replaceSessions).toEqual(['s0']);
    });

    it('rejects a malformed replace_sessions list', () => {
        expect(
            parseIngestBody({
                source: 'claude_code',
                sessions: [base],
                replace_sessions: 's0',
            }).ok,
        ).toBe(false);
        expect(
            parseIngestBody({
                source: 'claude_code',
                sessions: [base],
                replace_sessions: [''],
            }).ok,
        ).toBe(false);
    });
});
```

Add `parseIngestBody` to that file's imports from `@/lib/validate` if it is not already there.

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run src/__tests__/validate.test.ts`
Expected: FAIL — `day` is `undefined` and `replaceSessions` does not exist.

- [ ] **Step 3: Write minimal implementation**

In `src/types.ts`, add to `SessionUsageInput`:

```ts
/** Local calendar day the usage was spent on, YYYYMMDD. */
day: number;
```

In `src/lib/validate.ts`, add the import and bounds:

```ts
import { dayFromMs } from '@/lib/day';

// Guardrails for a reporter-supplied calendar day: a plausible YYYYMMDD.
const MIN_DAY = 19700101;
const MAX_DAY = 99991231;
```

Inside `parseSessionEntry`, after `started_at` is resolved:

```ts
// Reporters from before day bucketing send no `day`; the UTC day of
// started_at reproduces the old attribution exactly, so old installs keep
// reporting with no coordinated release.
const day =
    typeof s.day === 'number' &&
    Number.isFinite(s.day) &&
    s.day >= MIN_DAY &&
    s.day <= MAX_DAY
        ? Math.floor(s.day)
        : dayFromMs(started_at, 'UTC');
```

and add `day,` to the `row` literal (immediately after `model`).

Extend `IngestPayload`:

```ts
export interface IngestPayload {
    source: Source;
    sessions: SessionUsageInput[];
    rejected: RejectedSession[];
    /**
     * Session ids whose stored rows this request fully replaces. The reporter
     * lists a session here in the FIRST request that carries any of its rows,
     * so a session split across requests is cleared exactly once.
     */
    replaceSessions: string[];
}
```

In `parseIngestBody`, before the per-row loop:

```ts
const replaceSessions: string[] = [];
if (b.replace_sessions !== undefined) {
    if (!Array.isArray(b.replace_sessions)) {
        return { ok: false, error: 'replace_sessions must be an array' };
    }
    if (b.replace_sessions.length > maxSessions) {
        return {
            ok: false,
            error: `too many replace_sessions (max ${maxSessions})`,
        };
    }
    for (const id of b.replace_sessions) {
        if (
            typeof id !== 'string' ||
            id.length === 0 ||
            id.length > MAX_SESSION_ID_LEN
        ) {
            return {
                ok: false,
                error: 'replace_sessions must be non-empty session ids',
            };
        }
        replaceSessions.push(id);
    }
}
```

and return `{ source: b.source, sessions, rejected, replaceSessions }`.

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm vitest run src/__tests__/validate.test.ts src/__tests__/ingest-route.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/types.ts src/lib/validate.ts src/__tests__/validate.test.ts
git commit -m "feat(api): accept per-day usage rows and an explicit replace scope"
```

---

### Task 6: Store day rows and replace a session atomically

**Files:**

- Modify: `src/lib/store.ts`, `src/api/ingest.ts:39`, `src/api/history.ts:42`
- Test: `src/__tests__/store.test.ts` (create)

**Interfaces:**

- Consumes: `SessionUsageInput.day`, `IngestPayload.replaceSessions`.
- Produces: `upsertSessions(db, userId, source, sessions, now, replaceSessions?: string[]): Promise<number>` — deletes every stored row for each id in `replaceSessions` (scoped to `user_id` + `source`) before inserting, so a new reporter's day rows cannot coexist with the legacy single row they supersede.

- [ ] **Step 1: Write the failing test**

Create `src/__tests__/store.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { upsertSessions } from '@/lib/store';
import type { SessionUsageInput } from '@/types';

interface Recorded {
    sql: string;
    args: unknown[];
}

function recordingDb(log: Recorded[][]): D1Database {
    return {
        prepare(sql: string) {
            const stmt = {
                sql,
                bind(...args: unknown[]) {
                    return { sql, args };
                },
            };
            return stmt as unknown as D1PreparedStatement;
        },
        async batch(stmts: unknown[]) {
            log.push(stmts as Recorded[]);
            return [];
        },
    } as unknown as D1Database;
}

function row(day: number, model = 'claude-opus-5'): SessionUsageInput {
    return {
        session_id: 'sess-1',
        model,
        day,
        started_at: 1_000,
        input_tokens: 1,
        output_tokens: 2,
        cache_read_tokens: 3,
        cache_creation_tokens: 4,
        reasoning_tokens: 5,
    };
}

describe('upsertSessions', () => {
    it('writes the day column on every insert', async () => {
        const log: Recorded[][] = [];
        await upsertSessions(
            recordingDb(log),
            'u1',
            'claude_code',
            [row(20260806), row(20260807)],
            42,
        );
        const inserts = log.flat().filter((s) => s.sql.includes('INSERT'));
        expect(inserts).toHaveLength(2);
        expect(inserts[0]?.sql).toContain('day');
        expect(inserts[0]?.args).toContain(20260806);
        expect(inserts[1]?.args).toContain(20260807);
    });

    it('deletes a replaced session before inserting its rows', async () => {
        const log: Recorded[][] = [];
        await upsertSessions(
            recordingDb(log),
            'u1',
            'claude_code',
            [row(20260806), row(20260807)],
            42,
            ['sess-1'],
        );
        const flat = log.flat();
        const deleteIndex = flat.findIndex((s) => s.sql.startsWith('DELETE'));
        const firstInsert = flat.findIndex((s) => s.sql.includes('INSERT'));
        expect(deleteIndex).toBeGreaterThanOrEqual(0);
        expect(deleteIndex).toBeLessThan(firstInsert);
        expect(flat[deleteIndex]?.args).toEqual([
            'u1',
            'claude_code',
            'sess-1',
        ]);
    });

    it('issues no delete when nothing is being replaced', async () => {
        const log: Recorded[][] = [];
        await upsertSessions(
            recordingDb(log),
            'u1',
            'claude_code',
            [row(20260807)],
            42,
        );
        expect(log.flat().some((s) => s.sql.startsWith('DELETE'))).toBe(false);
    });

    it('deletes each replaced session once, even when repeated', async () => {
        const log: Recorded[][] = [];
        await upsertSessions(
            recordingDb(log),
            'u1',
            'claude_code',
            [row(20260807)],
            42,
            ['sess-1', 'sess-1'],
        );
        expect(
            log.flat().filter((s) => s.sql.startsWith('DELETE')),
        ).toHaveLength(1);
    });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run src/__tests__/store.test.ts`
Expected: FAIL — no `day` in the insert and no `DELETE` statement.

- [ ] **Step 3: Write minimal implementation**

Rewrite `src/lib/store.ts`:

```ts
import type { SessionUsageInput, Source } from '@/types';

// D1 caps how many statements a single batch may carry, so large payloads (a
// history backfill can send thousands of rows) are written in chunks.
const DB_BATCH_CHUNK = 500;

const DELETE_SESSION_SQL = `DELETE FROM session_usage
 WHERE user_id = ? AND source = ? AND session_id = ?`;

const UPSERT_SQL = `INSERT INTO session_usage
   (user_id, source, session_id, model, day, input_tokens, output_tokens,
    cache_read_tokens, cache_creation_tokens, reasoning_tokens, started_at, updated_at)
 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
 ON CONFLICT (user_id, source, session_id, model, day) DO UPDATE SET
   input_tokens = excluded.input_tokens,
   output_tokens = excluded.output_tokens,
   cache_read_tokens = excluded.cache_read_tokens,
   cache_creation_tokens = excluded.cache_creation_tokens,
   reasoning_tokens = excluded.reasoning_tokens,
   started_at = excluded.started_at,
   updated_at = excluded.updated_at`;

/**
 * Idempotently write per-(session, model, day) usage rows.
 *
 * `replaceSessions` names the sessions this request fully re-reports: their
 * stored rows are deleted first, so a reporter that now splits a session across
 * days cannot leave the pre-split row behind to be counted twice. The reporter
 * lists a session only in the first request carrying its rows, so a session
 * spread over several requests is cleared exactly once and later chunks land
 * through the upsert.
 *
 * Requests from reporters that predate this contract send no `replaceSessions`
 * and behave exactly as before: a pure upsert keyed by (session, model, day).
 *
 * Returns the number of rows written.
 */
export async function upsertSessions(
    db: D1Database,
    userId: string,
    source: Source,
    sessions: SessionUsageInput[],
    now: number,
    replaceSessions: string[] = [],
): Promise<number> {
    const unique = [...new Set(replaceSessions)];
    if (unique.length > 0) {
        const del = db.prepare(DELETE_SESSION_SQL);
        for (let i = 0; i < unique.length; i += DB_BATCH_CHUNK) {
            const chunk = unique.slice(i, i + DB_BATCH_CHUNK);
            // Deletes complete before any insert lands, so a replaced session
            // is never observed as "old rows plus new rows".
            // eslint-disable-next-line no-await-in-loop
            await db.batch(chunk.map((id) => del.bind(userId, source, id)));
        }
    }

    const stmt = db.prepare(UPSERT_SQL);
    for (let i = 0; i < sessions.length; i += DB_BATCH_CHUNK) {
        const chunk = sessions.slice(i, i + DB_BATCH_CHUNK);
        const batch = chunk.map((s) =>
            stmt.bind(
                userId,
                source,
                s.session_id,
                s.model,
                s.day,
                s.input_tokens,
                s.output_tokens,
                s.cache_read_tokens,
                s.cache_creation_tokens,
                s.reasoning_tokens,
                s.started_at,
                now,
            ),
        );
        // Chunks are written sequentially on purpose, to avoid flooding D1 with
        // concurrent batches.
        // eslint-disable-next-line no-await-in-loop
        await db.batch(batch);
    }
    return sessions.length;
}
```

In `src/api/ingest.ts`, destructure and forward the new field:

```ts
const { source, sessions, rejected, replaceSessions } = parsed.value;
// A batch whose rows were all rejected changes nothing: skip the upsert
// and keep the user's cached profile aggregates warm.
if (sessions.length > 0) {
    await upsertSessions(
        c.env.DB,
        user.id,
        source,
        sessions,
        Date.now(),
        replaceSessions,
    );
    await invalidateProfileCache(c.env.RATE_LIMIT, user.username);
}
```

Apply the identical change in `src/api/history.ts`.

Also update the request-shape comment at the top of `src/api/ingest.ts`:

```ts
// POST /api/ingest  (Bearer)
// { source, sessions: [{ session_id, model, day, started_at, input_tokens,
//   output_tokens, cache_read_tokens, cache_creation_tokens, reasoning_tokens }],
//   replace_sessions?: string[] }
// `day` is a YYYYMMDD calendar day in the reporter's local timezone; omitted by
// reporters older than day bucketing, in which case it is derived from
// started_at in UTC. Sessions listed in `replace_sessions` have their stored
// rows cleared first, so re-reporting can never leave a superseded row behind.
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm vitest run src/__tests__/store.test.ts src/__tests__/ingest-route.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/store.ts src/api/ingest.ts src/api/history.ts src/__tests__/store.test.ts
git commit -m "feat(api): store day-bucketed rows and replace re-reported sessions"
```

---

### Task 7: Query windows by calendar day and resolve the viewer's day

**Files:**

- Modify: `src/lib/aggregate.ts:9-27,131-214,216-278,294-357,375-411`
- Test: `src/__tests__/aggregate.test.ts`
- Modify: `src/lib/cached-aggregate.ts:21-53,66-97,118-130`
- Modify: `src/lib/page-cache.ts:61-81`
- Modify: `src/api/leaderboard.ts:45`, `src/api/agent-pages.ts:66`, `src/api/og.ts:17`
- Modify: `src/index.tsx:155,252,464`, `src/core/api/board.api.ts:75,88,192`
- Test: `src/__tests__/cached-aggregate.test.ts`, `src/__tests__/page-cache-headers.test.ts`

**Interfaces:**

- Consumes: `windowStartDay`, `dayFromMs` (Task 2).
- Produces:
    - `LeaderboardQuery` gains `startDay: number` (inclusive, `0` = all time); `getLeaderboard(db, q)` loses its `now` parameter.
    - `HackathonLeaderboardQuery` replaces `startAt`/`endAt` with `startDay: number` / `endDay: number` (both inclusive).
    - `getProfileWindowTotals(db, username, startDay)`.
    - `windowStart` is removed from this module (it lives in `src/lib/day.ts` as `windowStartDay`).
- Consumes: `windowStartDay`, `dayFromMs`, `timeZoneFromRequest` (Task 2); the query signatures produced in Steps 1–3 of this task.
- Produces: every cached read keyed by the resolved `startDay`; cache keys bumped to `v2`; HTTP cache keys carry the viewer's date.

- [ ] **Step 1: Write the failing test**

In `src/__tests__/aggregate.test.ts`, delete the `describe('windowStart', …)` block (its behaviour now lives in `src/__tests__/day.test.ts`), drop `windowStart` from the existing `@/lib/aggregate` import and add `getLeaderboard, getProfileWindowTotals` to that same import statement (one import per module — a second one trips the linter). Then append:

```ts
interface Captured {
    sql: string;
    binds: unknown[];
}

function capturingDb(
    captured: Captured[],
    results: unknown[] = [],
): D1Database {
    return {
        prepare(sql: string) {
            const self = {
                bind(...binds: unknown[]) {
                    captured.push({ sql, binds });
                    return self;
                },
                async all() {
                    return { results };
                },
                async first() {
                    return { id: 'u1', username: 'tester', ahead: 0 };
                },
            };
            return self as unknown as D1PreparedStatement;
        },
    } as unknown as D1Database;
}

describe('getLeaderboard day filtering', () => {
    it('filters on day, not started_at', async () => {
        const captured: Captured[] = [];
        await getLeaderboard(capturingDb(captured), {
            window: '7d',
            startDay: 20260801,
            metric: 'total',
        });
        expect(captured[0]?.sql).toContain('su.day >= ?');
        expect(captured[0]?.sql).not.toContain('started_at >=');
        expect(captured[0]?.binds[0]).toBe(20260801);
    });

    it('all-time binds a zero lower bound', async () => {
        const captured: Captured[] = [];
        await getLeaderboard(capturingDb(captured), {
            window: 'all',
            startDay: 0,
            metric: 'total',
        });
        expect(captured[0]?.binds[0]).toBe(0);
    });
});

describe('getProfileWindowTotals day filtering', () => {
    it('binds the day bound after the user id', async () => {
        const captured: Captured[] = [];
        await getProfileWindowTotals(capturingDb(captured), 'tester', 20260807);
        const usage = captured.find((c) => c.sql.includes('su.day >= ?'));
        expect(usage?.binds).toEqual(['u1', 20260807]);
    });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run src/__tests__/aggregate.test.ts`
Expected: FAIL — the SQL still says `su.started_at >= ?`, and the new signatures do not exist.

- [ ] **Step 3: Write minimal implementation**

In `src/lib/aggregate.ts`:

Delete the `DAY_MS` constant and the whole `windowStart` function (lines 9–27), and drop `TimeWindow` from the type import if nothing else needs it — `LeaderboardQuery.window` still uses it, so keep it.

Change `LeaderboardQuery`:

```ts
export interface LeaderboardQuery {
    /** Echoed back to clients and used as a cache-key label. */
    window: TimeWindow;
    /**
     * Inclusive lower bound as a YYYYMMDD calendar day, already resolved in the
     * viewer's timezone by the caller (0 = all time). Resolving it outside this
     * function is what lets the cache key pin the exact day being served.
     */
    startDay: number;
    metric: Metric;
    source?: Source;
    /** Model family id (e.g. `sonnet`), not a raw versioned model string. */
    model?: string;
    /** ISO 3166-1 alpha-2 country code; undefined = all countries. */
    country?: string;
    limit?: number;
}
```

In `getLeaderboard`, drop the `now: number` parameter and swap the bound:

```ts
export async function getLeaderboard(
    db: D1Database,
    q: LeaderboardQuery,
): Promise<LeaderboardEntry[]> {
    const conditions = ['su.day >= ?'];
    const binds: (string | number)[] = [q.startDay];
```

Change `HackathonLeaderboardQuery` and its SQL:

```ts
export interface HackathonLeaderboardQuery {
    metric: Metric;
    /** Inclusive YYYYMMDD bounds, snapped outward to whole UTC days. */
    startDay: number;
    endDay: number;
    memberIds: string[];
    /** Model family id (e.g. `sonnet`); undefined = all models count. */
    model?: string;
    limit?: number;
}
```

```ts
const sql = `${GROUP_SELECT} WHERE su.day >= ? AND su.day <= ? AND su.user_id IN (${placeholders}) GROUP BY su.user_id, su.source, su.model`;
const res = await db
    .prepare(sql)
    .bind(q.startDay, q.endDay, ...q.memberIds)
    .all<GroupedRow>();
```

Add a note above `getHackathonLeaderboard`:

```ts
/**
 * Leaderboard scoped to an inclusive [startDay, endDay] calendar-day range and
 * a fixed member set. Rows are day-granular, so a contest range is snapped
 * outward to whole UTC days by the caller: a sub-day range counts both boundary
 * days in full.
 */
```

Change `getProfileWindowTotals`:

```ts
export async function getProfileWindowTotals(
    db: D1Database,
    username: string,
    startDay: number,
): Promise<ProfileWindowTotals | null> {
```

and its query bind:

```ts
const { results } = await db
    .prepare(
        `${GROUP_SELECT} WHERE su.user_id = ? AND su.day >= ? GROUP BY su.source, su.model`,
    )
    .bind(user.id, startDay)
    .all<GroupedRow>();
```

- [ ] **Step 4: Write the failing test**

Append to `src/__tests__/cached-aggregate.test.ts`:

```ts
import {
    leaderboardCacheKey,
    profileWindowCacheKey,
} from '@/lib/cached-aggregate';

describe('cache keys pin the resolved day', () => {
    it('leaderboard keys include the start day and are v2', () => {
        const key = leaderboardCacheKey({
            window: 'today',
            startDay: 20260807,
            metric: 'total',
        });
        expect(key).toContain('agg:lb:v2');
        expect(key).toContain('20260807');
    });

    it('two viewer days never share a leaderboard key', () => {
        const a = leaderboardCacheKey({
            window: 'today',
            startDay: 20260807,
            metric: 'total',
        });
        const b = leaderboardCacheKey({
            window: 'today',
            startDay: 20260806,
            metric: 'total',
        });
        expect(a).not.toBe(b);
    });

    it('profile window keys include the start day', () => {
        expect(profileWindowCacheKey('tester', '7d', 20260801)).toContain(
            '20260801',
        );
    });
});
```

- [ ] **Step 5: Run test to verify it fails**

Run: `pnpm vitest run src/__tests__/cached-aggregate.test.ts`
Expected: FAIL — keys are `v1` and carry no day; `leaderboardCacheKey` rejects `startDay`.

- [ ] **Step 6: Write minimal implementation**

In `src/lib/cached-aggregate.ts`:

```ts
export function leaderboardCacheKey(query: LeaderboardQuery): string {
    return [
        'agg:lb:v2',
        query.window,
        // The resolved day, so viewers in different zones never share a board.
        String(query.startDay),
        query.metric,
        query.source ?? '',
        query.model ?? '',
        query.country ?? '',
        String(query.limit ?? 100),
    ].join(':');
}

export function profileCacheKey(username: string): string {
    return `agg:profile:v2:${username.toLowerCase()}`;
}

export function profileWindowCacheKey(
    username: string,
    window: TimeWindow,
    startDay: number,
): string {
    return `agg:profile${window}:v2:${username.toLowerCase()}:${startDay}`;
}
```

`invalidateProfileCache` can no longer name the 7d key precisely (it depends on the viewer's day), so widen it to the three days a 7d bound can currently be, keeping the delete cheap and exact:

```ts
/**
 * Drop a user's profile aggregates after ingest/history so the next read is
 * fresh. The windowed key carries the viewer's resolved day, and at any instant
 * the world spans at most three calendar dates, so all three candidates around
 * "now" are cleared.
 */
export async function invalidateProfileCache(
    kv: KVNamespace,
    username: string,
    now: number = Date.now(),
): Promise<void> {
    const today = dayFromMs(now, 'UTC');
    const days = [shiftDay(today, -1), today, shiftDay(today, 1)];
    await Promise.all([
        kv.delete(profileCacheKey(username)),
        ...days.map((day) =>
            kv.delete(profileWindowCacheKey(username, '7d', shiftDay(day, -6))),
        ),
    ]);
}
```

Add `import { dayFromMs, shiftDay } from '@/lib/day';` to that file.

Update the cached readers to take resolved days and drop `now`:

```ts
export async function cachedLeaderboard(
    db: D1Database,
    kv: KVNamespace,
    query: LeaderboardQuery,
): Promise<LeaderboardEntry[]> {
    return withReadCache(kv, leaderboardCacheKey(query), () =>
        getLeaderboard(db, query),
    );
}

export async function cachedProfileWindow(
    db: D1Database,
    kv: KVNamespace,
    username: string,
    window: TimeWindow,
    startDay: number,
): Promise<ProfileWindowTotals | null> {
    return withReadCache(
        kv,
        profileWindowCacheKey(username, window, startDay),
        () => getProfileWindowTotals(db, username, startDay),
    );
}
```

In `src/lib/page-cache.ts`, add the viewer's date to both keyed caches so an edge-cached board is never reused across a date boundary:

```ts
import { dayFromMs, timeZoneFromRequest } from '@/lib/day';

/** The viewer's own calendar date — `today`/`7d` windows resolve against it. */
function viewerDay(c: Context): number {
    return dayFromMs(Date.now(), timeZoneFromRequest(c.req.raw));
}

export const pageCache = createCacheMiddleware({
    cacheName: 'tokentally-pages',
    vary: [...AGENT_PAGE_VARY_HEADERS],
    keyGenerator: (c) => {
        const preview = isLinkPreviewBot(c.req.header('user-agent') ?? '')
            ? '1'
            : '0';
        return `${c.req.url}::preview=${preview}::vday=${viewerDay(c)}`;
    },
});

export const apiCache = createCacheMiddleware({
    cacheName: 'tokentally-api',
    // Reflects request Origin on ACAO; must not reuse another site's CORS headers.
    vary: ['Origin'],
    keyGenerator: (c) => `${c.req.url}::vday=${viewerDay(c)}`,
});
```

Now update every call site. `src/api/leaderboard.ts`:

```ts
import { timeZoneFromRequest, windowStartDay } from '@/lib/day';
// …
const entries = await cachedLeaderboard(c.env.DB, c.env.RATE_LIMIT, {
    window,
    startDay: windowStartDay(
        window,
        Date.now(),
        timeZoneFromRequest(c.req.raw),
    ),
    metric,
    source,
    model,
    country,
    limit,
});
```

`src/api/agent-pages.ts:66` — the same shape. That route already has `window` in scope from `parseWindow(c.req.query('window'))`; add the two imports and insert one field into the object literal it passes, removing the trailing `Date.now(),` argument:

```ts
        startDay: windowStartDay(
            window,
            Date.now(),
            timeZoneFromRequest(c.req.raw),
        ),
```

`src/api/og.ts`:

```ts
import { timeZoneFromRequest, windowStartDay } from '@/lib/day';
// …
const startDay = windowStartDay('7d', now, timeZoneFromRequest(c.req.raw));
const [profile, last7d] = await Promise.all([
    cachedProfile(DB, RATE_LIMIT, username),
    cachedProfileWindow(DB, RATE_LIMIT, username, '7d', startDay),
]);
```

`src/index.tsx:155` and `:252` — replace the trailing `Date.now(),` argument of each `cachedLeaderboard` call with a resolved `startDay` field:

```ts
        cachedLeaderboard(c.env.DB, c.env.RATE_LIMIT, {
            window,
            startDay: windowStartDay(
                window,
                Date.now(),
                timeZoneFromRequest(c.req.raw),
            ),
            metric,
            source,
            model,
            country,
            limit: 100,
        }),
```

(at `:252` keep that route's own `metric`/`scenario` arguments exactly as they are — only the window bound changes).

`src/index.tsx:464` — snap the hackathon range:

```ts
                  {
                      metric,
                      startDay: dayFromMs(h.start_at, 'UTC'),
                      endDay: dayFromMs(h.end_at - 1, 'UTC'),
                      memberIds: ids,
                      model: h.model_family ?? undefined,
                      limit: 100,
                  },
```

`src/core/api/board.api.ts` — server functions have no Hono `Context`, so read the request via the TanStack helper already imported there:

```ts
import { dayFromMs, timeZoneFromRequest, windowStartDay } from '@/lib/day';

function viewerTimeZone(): string {
    return timeZoneFromRequest(getRequest());
}
```

`:75`:

```ts
            cachedLeaderboard(e.DB, e.RATE_LIMIT, {
                ...data,
                startDay: windowStartDay(data.window, now, viewerTimeZone()),
                limit: 100,
            }),
```

`:88`:

```ts
            cachedLeaderboard(e.DB, e.RATE_LIMIT, {
                window: data.window,
                startDay: windowStartDay(data.window, now, viewerTimeZone()),
                metric: 'total',
                source: data.source,
                model: data.model,
                country: data.country,
                limit: 100,
            }),
```

`:192`:

```ts
                : await cachedHackathonLeaderboard(e.DB, e.RATE_LIMIT, h.slug, {
                      metric: data.metric,
                      startDay: dayFromMs(h.start_at, 'UTC'),
                      endDay: dayFromMs(h.end_at - 1, 'UTC'),
                      memberIds: ids,
                      model: h.model_family ?? undefined,
                      limit: 100,
                  });
```

- [ ] **Step 7: Run the full suite**

Run: `pnpm check`
Expected: PASS. This task is the one place where the query layer and its callers must move together — `pnpm typecheck` names every call site that still passes `now` or omits `startDay`; fix each until it is clean.

- [ ] **Step 8: Commit**

```bash
git add src/lib/aggregate.ts src/lib/cached-aggregate.ts src/lib/page-cache.ts \
        src/api/leaderboard.ts src/api/agent-pages.ts src/api/og.ts \
        src/index.tsx src/core/api/board.api.ts src/__tests__
git commit -m "feat: window leaderboards by calendar day in the viewer's zone"
```

### Task 8: Post sessions in session-contiguous batches

**Files:**

- Modify: `reporter/src/api.ts:40-125`
- Test: `src/__tests__/reporter-api-batching.test.ts` (create)

**Interfaces:**

- Consumes: `ReporterRow.day` (Task 3).
- Produces: `planBatches(rows: ReporterRow[], chunkSize: number): PostBatch[]` (exported for tests), where `PostBatch = { rows: ReporterRow[]; baseIndex: number; replaceSessions: string[] }`. Every request body gains `replace_sessions`.

- [ ] **Step 1: Write the failing test**

Create `src/__tests__/reporter-api-batching.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { planBatches } from '../../reporter/src/api';
import type { ReporterRow } from '../../reporter/src/lib/types';

function row(session: string, day: number): ReporterRow {
    return {
        session_id: session,
        model: 'claude-opus-5',
        day,
        started_at: 1_000,
        input_tokens: 0,
        output_tokens: 1,
        cache_read_tokens: 0,
        cache_creation_tokens: 0,
        reasoning_tokens: 0,
    };
}

describe('planBatches', () => {
    it('claims each session in the first batch that carries it', () => {
        const batches = planBatches([row('a', 1), row('b', 1)], 10);
        expect(batches).toHaveLength(1);
        expect(batches[0]?.replaceSessions).toEqual(['a', 'b']);
    });

    it('keeps a session contiguous even when input interleaves sessions', () => {
        const batches = planBatches(
            [row('a', 1), row('b', 1), row('a', 2), row('b', 2)],
            2,
        );
        expect(batches).toHaveLength(2);
        expect(batches[0]?.rows.map((r) => r.session_id)).toEqual(['a', 'a']);
        expect(batches[1]?.rows.map((r) => r.session_id)).toEqual(['b', 'b']);
    });

    it('claims a split session only once, in its first batch', () => {
        const batches = planBatches([row('a', 1), row('a', 2), row('a', 3)], 2);
        expect(batches).toHaveLength(2);
        expect(batches[0]?.replaceSessions).toEqual(['a']);
        expect(batches[1]?.replaceSessions).toEqual([]);
    });

    it('numbers baseIndex against the posted order', () => {
        const batches = planBatches([row('a', 1), row('a', 2), row('b', 1)], 2);
        expect(batches.map((b) => b.baseIndex)).toEqual([0, 2]);
    });

    it('returns nothing for no rows', () => {
        expect(planBatches([], 10)).toEqual([]);
    });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run src/__tests__/reporter-api-batching.test.ts`
Expected: FAIL — `planBatches` is not exported.

- [ ] **Step 3: Write minimal implementation**

In `reporter/src/api.ts`, add the batch planner above `postBatch`:

```ts
export interface PostBatch {
    rows: ReporterRow[];
    baseIndex: number;
    // Sessions this request fully re-reports. A session is claimed by the FIRST
    // batch carrying any of its rows, so the server clears it exactly once even
    // when its day rows span several requests.
    replaceSessions: string[];
}

/**
 * Group rows so every session's rows are contiguous, then cut fixed-size
 * batches. Contiguity is what makes the replace contract safe: a session's
 * later chunks land through the upsert instead of behind a second delete.
 */
export function planBatches(
    rows: ReporterRow[],
    chunkSize: number,
): PostBatch[] {
    const bySession = new Map<string, ReporterRow[]>();
    for (const r of rows) {
        const group = bySession.get(r.session_id);
        if (group) group.push(r);
        else bySession.set(r.session_id, [r]);
    }
    const ordered: ReporterRow[] = [];
    // No spread: a session with tens of thousands of day rows must not blow
    // the call stack.
    for (const group of bySession.values()) {
        for (const r of group) ordered.push(r);
    }

    const batches: PostBatch[] = [];
    const claimed = new Set<string>();
    for (let i = 0; i < ordered.length; i += chunkSize) {
        const slice = ordered.slice(i, i + chunkSize);
        const replaceSessions: string[] = [];
        for (const r of slice) {
            if (claimed.has(r.session_id)) continue;
            claimed.add(r.session_id);
            replaceSessions.push(r.session_id);
        }
        batches.push({ rows: slice, baseIndex: i, replaceSessions });
    }
    return batches;
}
```

Give `postBatch` the extra argument and put it in the body (both the dry-run print and the real request):

```ts
async function postBatch(
    cfg: ReporterConfig,
    source: string,
    batch: PostBatch,
    path: string,
): Promise<PostResult> {
    const body = {
        source,
        sessions: batch.rows,
        replace_sessions: batch.replaceSessions,
    };
    if (DRY_RUN) {
        process.stdout.write(
            `${JSON.stringify(
                { dryRun: true, url: `${cfg.apiBase}${path}`, body },
                null,
                2,
            )}\n`,
        );
        return { accepted: batch.rows.length, rejected: 0, failed: 0 };
    }
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 10_000);
    try {
        const res = await fetch(`${cfg.apiBase}${path}`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                Authorization: `Bearer ${cfg.token}`,
            },
            body: JSON.stringify(body),
            signal: controller.signal,
        });
        if (res.ok) {
            const data: unknown = await res.json().catch(() => ({}));
            const obj = asObject(data);
            const rejected = describeRejections(obj, batch.baseIndex);
            const accepted =
                typeof obj.accepted === 'number'
                    ? obj.accepted
                    : batch.rows.length - rejected;
            return { accepted, rejected, failed: 0 };
        }
        const text = (await res.text().catch(() => '')).slice(0, 300);
        process.stderr.write(
            `tokenmaxer: ingest failed (${res.status})${text ? `: ${text}` : ''}\n`,
        );
        return { accepted: 0, rejected: 0, failed: batch.rows.length };
    } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        process.stderr.write(`tokenmaxer: ingest failed: ${message}\n`);
        return { accepted: 0, rejected: 0, failed: batch.rows.length };
    } finally {
        clearTimeout(timer);
    }
}
```

Rewrite the middle of `postSessions` to use the planner, and note why the deletes force sequencing:

```ts
export async function postSessions(
    cfg: ReporterConfig,
    source: string,
    rows: ReporterRow[],
    opts: PostOpts = {},
): Promise<PostResult> {
    if (rows.length === 0) return { accepted: 0, rejected: 0, failed: 0 };
    const path = opts.path ?? '/api/ingest';
    const chunkSize = opts.chunkSize ?? MAX_SESSIONS_PER_REQUEST;
    const batches = planBatches(rows, chunkSize);
    // Sequential, not Promise.all: a claimed session's delete must land before
    // the continuation batches that carry the rest of its days.
    const results: PostResult[] = [];
    for (const batch of batches) {
        // eslint-disable-next-line no-await-in-loop
        results.push(await postBatch(cfg, source, batch, path));
    }
    return results.reduce(
        (sum, r) => ({
            accepted: sum.accepted + r.accepted,
            rejected: sum.rejected + r.rejected,
            failed: sum.failed + r.failed,
        }),
        { accepted: 0, rejected: 0, failed: 0 },
    );
}
```

Also update the `describeRejections` doc comment: indices are positions in the **posted** (session-grouped) order, not the caller's original array.

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm vitest run src/__tests__/reporter-api-batching.test.ts src/__tests__/reporter-cli.test.ts src/__tests__/reporter-bundle.test.ts`
Expected: PASS. If a dry-run snapshot test asserts the exact body, add `replace_sessions` to its expectation.

- [ ] **Step 5: Commit**

```bash
git add reporter/src/api.ts src/__tests__/reporter-api-batching.test.ts
git commit -m "feat(reporter): post session-contiguous batches with an explicit replace scope"
```

---

### Task 9: Claude Code — bucket by each entry's local day

**Files:**

- Modify: `reporter/src/agents/claude.ts:21-48,50-58,100-110`, `reporter/src/agents/claude-sessions.ts:604-619`
- Test: `src/__tests__/reporter-day.test.ts`

**Interfaces:**

- Consumes: `localDay`, `accumulateModelDayUsage`.
- Produces: `ClaudeUsageRow.day: number` (`0` when the line has no usable timestamp); `sumClaudeRows(rows, fallbackDay): Map<string, DayTotals>`.

- [ ] **Step 1: Write the failing test**

Append to `src/__tests__/reporter-day.test.ts`:

```ts
import { parseClaudeTranscript } from '../../reporter/src/agents/claude';

function claudeLine(iso: string, output: number): string {
    return JSON.stringify({
        type: 'assistant',
        sessionId: 'sess-1',
        timestamp: iso,
        requestId: `req-${iso}-${output}`,
        message: {
            id: `msg-${iso}-${output}`,
            model: 'claude-opus-5',
            usage: { input_tokens: 1, output_tokens: output },
        },
    });
}

describe('parseClaudeTranscript day buckets', () => {
    it('splits one session across the local days it spans', () => {
        const dayOne = new Date(2026, 7, 6, 22, 0).toISOString();
        const dayTwo = new Date(2026, 7, 7, 2, 0).toISOString();
        const parsed = parseClaudeTranscript(
            [claudeLine(dayOne, 10), claudeLine(dayTwo, 20)].join('\n'),
        );
        const byDay = parsed.models.get('claude-opus-5');
        expect(byDay?.get(20260806)?.output_tokens).toBe(10);
        expect(byDay?.get(20260807)?.output_tokens).toBe(20);
    });

    it('falls back to the session start day when a line has no timestamp', () => {
        const line = JSON.stringify({
            type: 'assistant',
            sessionId: 'sess-1',
            requestId: 'req-1',
            message: {
                id: 'msg-1',
                model: 'claude-opus-5',
                usage: { input_tokens: 1, output_tokens: 7 },
            },
        });
        const parsed = parseClaudeTranscript(line, {
            fallbackStartedAt: new Date(2026, 7, 7, 12, 0).getTime(),
        });
        expect(
            parsed.models.get('claude-opus-5')?.get(20260807)?.output_tokens,
        ).toBe(7);
    });

    it('still dedupes streamed chunks that share a message key', () => {
        const iso = new Date(2026, 7, 7, 9, 0).toISOString();
        const partial = JSON.stringify({
            type: 'assistant',
            sessionId: 'sess-1',
            timestamp: iso,
            requestId: 'req-1',
            message: {
                id: 'msg-1',
                model: 'claude-opus-5',
                usage: { input_tokens: 1, output_tokens: 5 },
            },
        });
        const final = JSON.stringify({
            type: 'assistant',
            sessionId: 'sess-1',
            timestamp: iso,
            requestId: 'req-1',
            message: {
                id: 'msg-1',
                model: 'claude-opus-5',
                usage: { input_tokens: 1, output_tokens: 40 },
            },
        });
        const parsed = parseClaudeTranscript([partial, final].join('\n'));
        expect(
            parsed.models.get('claude-opus-5')?.get(20260807)?.output_tokens,
        ).toBe(40);
    });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run src/__tests__/reporter-day.test.ts`
Expected: FAIL — the first test finds everything on one day (the session start day).

- [ ] **Step 3: Write minimal implementation**

In `reporter/src/agents/claude.ts`, add `day` to the row, populate it, and make the sum day-aware:

```ts
import { localDay } from '../lib/day';
import { accumulateModelDayUsage, usageFromFields } from '../lib/totals';
import type { DayTotals /* … */ } from '../lib/types';

export interface ClaudeUsageRow {
    key: string | null;
    model: string;
    usage: ReporterTotals;
    /** Local day of this line's timestamp; 0 when it carries none. */
    day: number;
    // When the same message chunk appears in several of a session's files,
    // the non-sidechain copy is authoritative (CodexBar's winner rule) —
    // sidechain copies can be stale partials of the final cumulative chunk.
    sidechain: boolean;
}
```

In `claudeUsageRow`, add to the returned object:

```ts
        day: localDay(toMs(obj.timestamp)),
```

Replace `sumClaudeRows`:

```ts
/**
 * Sum rows per (model, local day). `fallbackDay` covers lines with no usable
 * timestamp — the session's own start day, so usage is never dropped and never
 * invents a date from the wall clock.
 */
export function sumClaudeRows(
    rows: ClaudeUsageRow[],
    fallbackDay: number,
): Map<string, DayTotals> {
    const models = new Map<string, DayTotals>();
    for (const { model, usage, day } of rows) {
        accumulateModelDayUsage(models, model, day || fallbackDay, usage);
    }
    return models;
}
```

Rewrite `parseClaudeTranscript`'s return (dropping the `singleDayModels` bridge):

```ts
export function parseClaudeTranscript(
    text: string,
    opts: ParseOpts = {},
): ParsedTranscript {
    const scan = scanClaudeTranscript(text);
    const startedAt = scan.startedAt ?? opts.fallbackStartedAt ?? null;
    return {
        session_id: opts.sessionId || scan.sessionId || null,
        started_at: startedAt,
        models: sumClaudeRows(
            [...scan.keyed.values(), ...scan.unkeyed],
            localDay(startedAt ?? Date.now()),
        ),
    };
}
```

In `reporter/src/agents/claude-sessions.ts`, drop the `singleDayModels` import and pass the fallback through:

```ts
function sessionRows(sessions: Map<string, SessionState>): ReporterRow[] {
    const rows: ReporterRow[] = [];
    for (const s of sessions.values()) {
        rows.push(
            ...toRows({
                session_id: s.sid,
                started_at: s.startedAt,
                models: sumClaudeRows(
                    [...[...s.keyed.values()].map((k) => k.row), ...s.unkeyed],
                    localDay(s.startedAt ?? Date.now()),
                ),
            }),
        );
    }
    return rows;
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm vitest run src/__tests__/reporter-day.test.ts src/__tests__/reporter.test.ts src/__tests__/reporter-claude-sessions.test.ts`
Expected: PASS. Existing Claude tests whose fixtures span several days will now report several day keys — update those assertions to sum across days (or assert the specific day) rather than reverting the behaviour.

- [ ] **Step 5: Commit**

```bash
git add reporter/src/agents/claude.ts reporter/src/agents/claude-sessions.ts src/__tests__
git commit -m "feat(reporter): attribute Claude Code usage to each entry's local day"
```

---

### Task 10: Codex — bucket each token_count delta by its local day

**Files:**

- Modify: `reporter/src/agents/codex-engine.ts:313-317,481-492,884-889,924-934,1004-1009,1168,1380-1390`
- Test: `src/__tests__/reporter-day.test.ts`

**Interfaces:**

- Consumes: `localDay`, `accumulateModelDayUsage`.
- Produces: `TokenCountRecord.tsMs: number | null`; `addModelDelta(model, day, delta)`; `ensureModelRow(model, day)`.

- [ ] **Step 1: Write the failing test**

Append to `src/__tests__/reporter-day.test.ts`:

```ts
import { parseCodexRollout } from '../../reporter/src/agents/codex-engine';

function codexTokenCount(iso: string, totalOutput: number): string {
    return JSON.stringify({
        type: 'event_msg',
        timestamp: iso,
        payload: {
            type: 'token_count',
            info: {
                model: 'gpt-5.2-codex',
                total_token_usage: {
                    input_tokens: 10,
                    output_tokens: totalOutput,
                    cached_input_tokens: 0,
                    cache_write_input_tokens: 0,
                    reasoning_output_tokens: 0,
                },
            },
        },
    });
}

describe('parseCodexRollout day buckets', () => {
    it("books each turn's delta to the day the turn happened", () => {
        const meta = JSON.stringify({
            type: 'session_meta',
            timestamp: new Date(2026, 7, 6, 21, 0).toISOString(),
            payload: { id: 'codex-1', model: 'gpt-5.2-codex' },
        });
        const parsed = parseCodexRollout(
            [
                meta,
                codexTokenCount(new Date(2026, 7, 6, 22, 0).toISOString(), 100),
                codexTokenCount(new Date(2026, 7, 7, 1, 0).toISOString(), 250),
            ].join('\n'),
        );
        const byDay = parsed.models.get('gpt-5.2-codex');
        // Cumulative totals: day one counts 100, day two the 150 delta.
        expect(byDay?.get(20260806)?.output_tokens).toBe(100);
        expect(byDay?.get(20260807)?.output_tokens).toBe(150);
    });

    it('uses the session start day when a token_count has no timestamp', () => {
        const line = JSON.stringify({
            type: 'event_msg',
            payload: {
                type: 'token_count',
                info: {
                    model: 'gpt-5.2-codex',
                    last_token_usage: {
                        input_tokens: 1,
                        output_tokens: 9,
                        cached_input_tokens: 0,
                        cache_write_input_tokens: 0,
                        reasoning_output_tokens: 0,
                    },
                },
            },
        });
        const parsed = parseCodexRollout(line, {
            fallbackStartedAt: new Date(2026, 7, 7, 8, 0).getTime(),
        });
        expect(
            parsed.models.get('gpt-5.2-codex')?.get(20260807)?.output_tokens,
        ).toBe(9);
    });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run src/__tests__/reporter-day.test.ts`
Expected: FAIL — both deltas land on the session-start day.

- [ ] **Step 3: Write minimal implementation**

Add the timestamp to the record type:

```ts
interface TokenCountRecord {
    model: string | null;
    last: Totals | null;
    total: Totals | null;
    /** Instant of the rollout line, for local-day attribution. */
    tsMs: number | null;
}
```

In `codexLineFrom`, populate it (the function already receives the whole `obj`):

```ts
return {
    kind: 'tokenCount',
    rec: { model, last, total, tsMs: toMs(obj.timestamp) },
};
```

Change the model map and its two writers inside `parseCodexRollout`:

```ts
const models = new Map<string, DayTotals>();
```

```ts
// The session's own start day, for token_count lines with no timestamp.
function fallbackDay(): number {
    return localDay(startedAt ?? opts.fallbackStartedAt ?? Date.now());
}

function ensureModelRow(model: string, day: number): void {
    // Zero-total rows keep the server upsert able to overwrite rows an
    // earlier reporter version inflated for this (session, model, day).
    const byDay = models.get(model) ?? new Map<number, Totals>();
    if (!byDay.has(day)) byDay.set(day, emptyTotals());
    models.set(model, byDay);
}

function addModelDelta(model: string, day: number, delta: Totals): void {
    ensureModelRow(model, day);
    const t = models.get(model)?.get(day) as Totals;
    for (const k of TOTAL_KEYS) t[k] += delta[k];
}
```

At the top of `handleTokenCount`, resolve the day once and use it for both calls:

```ts
    function handleTokenCount(rec: TokenCountRecord): void {
        const model =
            modelEvidence(currentModel) ??
            modelEvidence(rec.model) ??
            'unknown';
        const day = rec.tsMs === null ? fallbackDay() : localDay(rec.tsMs);
        ensureModelRow(model, day);
        if (suppressUnownedCopiedPrefix) return;
```

and at its end (line 1168):

```ts
commitObserved();
if (totalsHaveUsage(delta)) addModelDelta(model, day, delta);
```

Finally simplify the return — `models` is already day-keyed, so drop `singleDayModels`:

```ts
return {
    session_id: sessionId,
    started_at: startedAt ?? opts.fallbackStartedAt ?? null,
    models,
    parent_id: forkedFromId,
};
```

Keep `ParsedCodexRollout.models: Map<string, DayTotals>` from Task 3, and remove the now-unused `singleDayModels`/`localDay`-wrapping import lines that Task 3 added here (`localDay` is still needed).

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm vitest run src/__tests__/reporter-day.test.ts src/__tests__/reporter.test.ts`
Expected: PASS. Existing codex fixtures with multi-day timestamps will now split; update those assertions to the specific day or a sum across days.

- [ ] **Step 5: Commit**

```bash
git add reporter/src/agents/codex-engine.ts src/__tests__
git commit -m "feat(reporter): attribute Codex turn deltas to their local day"
```

---

### Task 11: pi — bucket by each record's local day

**Files:**

- Modify: `reporter/src/agents/pi.ts:19-22,70-96,103-127`
- Test: `src/__tests__/reporter-day.test.ts`

**Interfaces:**

- Consumes: `localDay`, `accumulateModelDayUsage`.
- Produces: `PiKeyedUsage` gains `day: number`; `processPiLine` writes into a `Map<string, DayTotals>`.

- [ ] **Step 1: Write the failing test**

Append to `src/__tests__/reporter-day.test.ts`:

```ts
import { parsePiRollout } from '../../reporter/src/agents/pi';

describe('parsePiRollout day buckets', () => {
    it('splits records across their local days', () => {
        const lines = [
            JSON.stringify({
                id: 'r1',
                timestamp: new Date(2026, 7, 6, 23, 30).toISOString(),
                model: 'gpt-5.2',
                usage: { input: 1, output: 10 },
            }),
            JSON.stringify({
                id: 'r2',
                timestamp: new Date(2026, 7, 7, 0, 30).toISOString(),
                model: 'gpt-5.2',
                usage: { input: 1, output: 20 },
            }),
        ].join('\n');
        const parsed = parsePiRollout(lines);
        const byDay = parsed.models.get('gpt-5.2');
        expect(byDay?.get(20260806)?.output_tokens).toBe(10);
        expect(byDay?.get(20260807)?.output_tokens).toBe(20);
    });

    it("keeps deduping repeated ids, on the last occurrence's day", () => {
        const lines = [
            JSON.stringify({
                id: 'r1',
                timestamp: new Date(2026, 7, 6, 23, 30).toISOString(),
                model: 'gpt-5.2',
                usage: { input: 1, output: 10 },
            }),
            JSON.stringify({
                id: 'r1',
                timestamp: new Date(2026, 7, 7, 0, 30).toISOString(),
                model: 'gpt-5.2',
                usage: { input: 1, output: 10 },
            }),
        ].join('\n');
        const parsed = parsePiRollout(lines);
        const byDay = parsed.models.get('gpt-5.2');
        expect(byDay?.get(20260806)).toBeUndefined();
        expect(byDay?.get(20260807)?.output_tokens).toBe(10);
    });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run src/__tests__/reporter-day.test.ts`
Expected: FAIL — everything lands on the session start day.

- [ ] **Step 3: Write minimal implementation**

```ts
import { localDay } from '../lib/day';
import { accumulateModelDayUsage, usageFromFields } from '../lib/totals';
import type { DayTotals /* … */ } from '../lib/types';

interface PiKeyedUsage {
    model: string;
    usage: ReporterTotals;
    day: number;
}
```

`processPiLine` takes the day-keyed map and a fallback:

```ts
function processPiLine(
    obj: JsonObject,
    state: PiParseState,
    models: Map<string, DayTotals>,
    keyed: Map<string, PiKeyedUsage>,
    fallbackDay: number,
): void {
    if (state.startedAt === null)
        state.startedAt = toMs(obj.timestamp ?? obj.time);
    if (!state.sessionId) state.sessionId = piSessionId(obj);

    const model = piModel(obj);
    if (model) state.currentModel = model;

    const usage = piUsage(obj);
    if (!usage) return;

    const totals = usageFromFields(usage, PI_USAGE_FIELDS);
    const day = localDay(toMs(obj.timestamp ?? obj.time)) || fallbackDay;
    // Records with an id can repeat on another branch of the tree: keep the
    // last occurrence per id and sum once at the end. Unkeyed records are
    // always summed.
    const id = piEntryId(obj);
    if (id) {
        keyed.set(id, { model: state.currentModel, usage: totals, day });
        return;
    }
    accumulateModelDayUsage(models, state.currentModel, day, totals);
}
```

`parsePiRollout` derives the fallback day from `opts.fallbackStartedAt` (the file's mtime) rather than from `state.startedAt`: the session's start is not known until the first timestamped line is read, and a fallback that changed mid-parse would put otherwise-identical untimestamped records on different days. pi stamps essentially every record, so the fallback is a rarely-taken safety net.

```ts
export function parsePiRollout(
    text: string,
    opts: ParseOpts = {},
): ParsedTranscript {
    const models = new Map<string, DayTotals>();
    const keyed = new Map<string, PiKeyedUsage>();
    const state: PiParseState = {
        sessionId: opts.sessionId ?? null,
        startedAt: null,
        currentModel: 'unknown',
    };
    const fallbackDay = localDay(opts.fallbackStartedAt ?? Date.now());

    for (const obj of jsonlObjects(text)) {
        processPiLine(obj, state, models, keyed, fallbackDay);
    }
    for (const { model, usage, day } of keyed.values()) {
        accumulateModelDayUsage(models, model, day, usage);
    }

    return {
        session_id: state.sessionId ?? opts.sessionId ?? null,
        started_at: state.startedAt ?? opts.fallbackStartedAt ?? null,
        models,
    };
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm vitest run src/__tests__/reporter-day.test.ts src/__tests__/reporter-pi-cursor.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add reporter/src/agents/pi.ts src/__tests__
git commit -m "feat(reporter): attribute pi usage to each record's local day"
```

---

### Task 12: opencode — bucket by each message's local day

**Files:**

- Modify: `reporter/src/agents/opencode.ts:24-47,54-78`
- Test: `src/__tests__/reporter-day.test.ts`

**Interfaces:**

- Consumes: `localDay`, `accumulateModelDayUsage`.
- Produces: `accumulateOpencodeTokens(models: Map<string, DayTotals>, msg: JsonObject, day: number)`.

- [ ] **Step 1: Write the failing test**

Append to `src/__tests__/reporter-day.test.ts`:

```ts
import { parseOpencodeMessages } from '../../reporter/src/agents/opencode';

describe('parseOpencodeMessages day buckets', () => {
    it('splits messages across their local days', () => {
        const parsed = parseOpencodeMessages([
            {
                role: 'assistant',
                sessionID: 'oc-1',
                modelID: 'claude-sonnet-5',
                time: { created: new Date(2026, 7, 6, 23, 0).getTime() },
                tokens: { input: 1, output: 10, cache: { read: 0, write: 0 } },
            },
            {
                role: 'assistant',
                sessionID: 'oc-1',
                modelID: 'claude-sonnet-5',
                time: { created: new Date(2026, 7, 7, 1, 0).getTime() },
                tokens: { input: 1, output: 20, cache: { read: 0, write: 0 } },
            },
        ]);
        const byDay = parsed.models.get('claude-sonnet-5');
        expect(byDay?.get(20260806)?.output_tokens).toBe(10);
        expect(byDay?.get(20260807)?.output_tokens).toBe(20);
    });

    it('uses the fallback day for a message with no timestamp', () => {
        const parsed = parseOpencodeMessages(
            [
                {
                    role: 'assistant',
                    sessionID: 'oc-1',
                    modelID: 'claude-sonnet-5',
                    tokens: {
                        input: 1,
                        output: 5,
                        cache: { read: 0, write: 0 },
                    },
                },
            ],
            { fallbackStartedAt: new Date(2026, 7, 7, 10, 0).getTime() },
        );
        expect(
            parsed.models.get('claude-sonnet-5')?.get(20260807)?.output_tokens,
        ).toBe(5);
    });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run src/__tests__/reporter-day.test.ts`
Expected: FAIL — one day key only.

- [ ] **Step 3: Write minimal implementation**

```ts
import { localDay } from '../lib/day';
import { accumulateModelDayUsage, usageFromFields } from '../lib/totals';
import type { DayTotals /* … */ } from '../lib/types';

function accumulateOpencodeTokens(
    models: Map<string, DayTotals>,
    msg: JsonObject,
    day: number,
): void {
    const tokens = asObject(msg.tokens);
    if (!msg.tokens || typeof msg.tokens !== 'object') return;
    const model =
        typeof msg.modelID === 'string' && msg.modelID
            ? msg.modelID
            : 'unknown';
    const cache = asObject(tokens.cache);
    const flattenedUsage: JsonObject = {
        input: tokens.input,
        output: tokens.output,
        reasoning: tokens.reasoning,
        cache_read: cache.read ?? tokens.cache_read,
        cache_write: cache.write ?? tokens.cache_write,
    };
    accumulateModelDayUsage(
        models,
        model,
        day,
        usageFromFields(flattenedUsage, OPENCODE_USAGE_FIELDS),
    );
}
```

```ts
export function parseOpencodeMessages(
    messages: unknown[],
    opts: ParseOpts = {},
): ParsedTranscript {
    const models = new Map<string, DayTotals>();
    let sessionId = opts.sessionId ?? null;
    let startedAt: number | null = null;
    const fallbackDay = localDay(opts.fallbackStartedAt ?? Date.now());

    for (const raw of messages) {
        if (!raw || typeof raw !== 'object') continue;
        const msg = raw as JsonObject;
        if (!sessionId && typeof msg.sessionID === 'string')
            sessionId = msg.sessionID;
        const ts = opencodeTimestamp(msg);
        if (ts !== null && (startedAt === null || ts < startedAt))
            startedAt = ts;
        if (msg.role === 'assistant') {
            accumulateOpencodeTokens(models, msg, localDay(ts) || fallbackDay);
        }
    }

    return {
        session_id: sessionId ?? opts.sessionId ?? null,
        started_at: startedAt ?? opts.fallbackStartedAt ?? null,
        models,
    };
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm vitest run src/__tests__/reporter-day.test.ts src/__tests__/reporter.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add reporter/src/agents/opencode.ts src/__tests__
git commit -m "feat(reporter): attribute opencode usage to each message's local day"
```

---

### Task 13: Cursor — local-day rows inside each UTC-day session

Cursor's session ids stay `cursor-<UTC date>`: they are the unit the replace contract deletes, and renaming them would orphan every row already stored. Only the `day` inside them becomes local, so a UTC day that straddles two local days yields two rows.

**Files:**

- Modify: `reporter/src/agents/cursor.ts:25-63`
- Modify: `reporter/src/lib/totals.ts` (delete the now-unused `singleDayModels`)
- Test: `src/__tests__/reporter-day.test.ts`

**Interfaces:**

- Consumes: `localDay`.
- Produces: `parseCursorEvents` rows with `session_id = cursor-<UTC date>`, `day = local day of the event`.

- [ ] **Step 1: Write the failing test**

Append to `src/__tests__/reporter-day.test.ts`:

```ts
import { parseCursorEvents } from '../../reporter/src/agents/cursor';

const CURSOR_USAGE = {
    inputTokens: 1,
    outputTokens: 1,
    cacheReadTokens: 0,
    cacheWriteTokens: 0,
};

describe('parseCursorEvents day buckets', () => {
    it('keeps the UTC-day session id but a local day per event', () => {
        // 02:00Z on the 7th is 11:30 on the 7th in Adelaide (UTC+9:30).
        const rows = parseCursorEvents([
            {
                timestamp: Date.parse('2026-08-07T02:00:00Z'),
                model: 'claude-sonnet-5',
                tokenUsage: { ...CURSOR_USAGE, outputTokens: 2 },
            },
        ]);
        expect(rows).toHaveLength(1);
        expect(rows[0]?.session_id).toBe('cursor-2026-08-07');
        expect(rows[0]?.day).toBe(20260807);
        expect(rows[0]?.output_tokens).toBe(2);
    });

    it('splits one UTC day into two rows when it straddles local midnight', () => {
        // Both instants are inside UTC 2026-08-07, but 21:00Z is already
        // 06:30 on the 8th in Adelaide — one session, two local days.
        const rows = parseCursorEvents([
            {
                timestamp: Date.parse('2026-08-07T01:00:00Z'),
                model: 'claude-sonnet-5',
                tokenUsage: CURSOR_USAGE,
            },
            {
                timestamp: Date.parse('2026-08-07T21:00:00Z'),
                model: 'claude-sonnet-5',
                tokenUsage: CURSOR_USAGE,
            },
        ]);
        expect(rows).toHaveLength(2);
        expect(rows.map((r) => r.session_id)).toEqual([
            'cursor-2026-08-07',
            'cursor-2026-08-07',
        ]);
        expect(rows.map((r) => r.day)).toEqual([20260807, 20260808]);
        // started_at stays the UTC day start for both rows.
        expect(new Set(rows.map((r) => r.started_at))).toEqual(
            new Set([Date.parse('2026-08-07T00:00:00Z')]),
        );
    });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run src/__tests__/reporter-day.test.ts`
Expected: FAIL in a zone offset from UTC — `day` is the UTC date integer from Task 3, not the local day.

- [ ] **Step 3: Write minimal implementation**

Replace `parseCursorEvents`:

```ts
/**
 * Bucket Cursor dashboard usage events by UTC day (the session id) and local
 * day (the usage day) per model. One synthetic session per UTC day
 * ("cursor-YYYY-MM-DD"); re-summing whole days on every run keeps ingestion
 * idempotent. The session id stays UTC-keyed because it is the unit the ingest
 * replace contract clears — re-keying it would orphan stored rows — while
 * `day` is local, like every other source.
 */
export function parseCursorEvents(events: unknown[]): ReporterRow[] {
    // 'YYYY-MM-DD' (UTC) -> local day -> model -> totals
    const days = new Map<string, Map<number, Map<string, ReporterTotals>>>();
    for (const raw of Array.isArray(events) ? events : []) {
        if (!raw || typeof raw !== 'object') continue;
        const e = raw as JsonObject;
        const ms = Number(e.timestamp);
        if (!Number.isFinite(ms) || ms <= 0) continue;
        if (!e.tokenUsage || typeof e.tokenUsage !== 'object') continue;
        // Zero-usage events (aborted/refunded requests) still produce a
        // zero-total row when a day has nothing else: the replace-upsert needs
        // it to overwrite a stale non-zero day.
        const usage = cursorUsage(asObject(e.tokenUsage));
        const utcDay = new Date(ms).toISOString().slice(0, 10);
        const model =
            typeof e.model === 'string' && e.model ? e.model : 'unknown';
        const byLocalDay =
            days.get(utcDay) ?? new Map<number, Map<string, ReporterTotals>>();
        const byModel =
            byLocalDay.get(localDay(ms)) ?? new Map<string, ReporterTotals>();
        accumulateModelUsage(byModel, model, usage);
        byLocalDay.set(localDay(ms), byModel);
        days.set(utcDay, byLocalDay);
    }
    const rows: ReporterRow[] = [];
    for (const [utcDay, byLocalDay] of days) {
        const startedAt = Date.parse(`${utcDay}T00:00:00Z`);
        for (const [day, byModel] of byLocalDay) {
            for (const [model, t] of byModel) {
                rows.push({
                    session_id: `cursor-${utcDay}`,
                    model,
                    day,
                    started_at: startedAt,
                    ...t,
                });
            }
        }
    }
    return rows;
}
```

Add `import { localDay } from '../lib/day';`.

Then delete `singleDayModels` from `reporter/src/lib/totals.ts` — every collector now buckets for itself — and remove its remaining imports. `pnpm typecheck` names any leftovers.

- [ ] **Step 4: Run the full suite**

Run: `pnpm check`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add reporter/src/agents/cursor.ts reporter/src/lib/totals.ts src/__tests__
git commit -m "feat(reporter): attribute Cursor usage to each event's local day"
```

---

### Task 14: Document the new attribution

**Files:**

- Modify: `README.md`, `src/content/about.md.ts:12`, `src/pages/about.tsx:36`
- Test: `src/__tests__/agent-content.test.ts`, `src/__tests__/agent-markdown.test.ts`

**Interfaces:**

- Consumes: nothing.
- Produces: user-facing copy explaining that windows count the day usage was spent, and that older data needs one `tokenmaxer backfill`.

- [ ] **Step 1: Write the failing test**

Append to `src/__tests__/agent-content.test.ts` (it already imports `aboutMarkdown` from `@/content/about.md` at the top — do not add a second import):

```ts
describe('about copy documents day attribution', () => {
    it('explains that usage counts on the day it was spent', () => {
        const md = aboutMarkdown();
        expect(md).toMatch(/local calendar day/iu);
        expect(md).toContain('backfill');
    });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run src/__tests__/agent-content.test.ts`
Expected: FAIL — the copy says nothing about days.

- [ ] **Step 3: Write the copy**

In `src/content/about.md.ts`, extend the sentence at line 12 with:

```
 Usage is attributed to the local calendar day it was spent on, not to the day a
session happened to start — so a session you keep open for a fortnight counts
against every day it actually burned tokens. Data reported before this change is
still attributed to its session's start day; run `tokenmaxer backfill` once to
re-derive it.
```

Mirror the same two sentences in the corresponding JSX at `src/pages/about.tsx:36`.

The same file's closing sentence of that section still describes the old key. Replace:

> Because each session is keyed by its id and the server overwrites rather than adds, re-reporting the same session never double-counts.

with:

> Because each row is keyed by session, model and day — and re-reporting a session replaces every row it owns rather than adding to them — reporting the same session twice never double-counts.

In `README.md`, under the section that describes what the reporter sends, add:

```markdown
Each row is one `(session, model, day)` bucket, where `day` is the calendar day
**on the machine that reported it**. Leaderboard windows are whole calendar days
(`today` is your local date; `7d` is that date plus the six before it), so a
long-running session contributes to every day it touched instead of booking its
lifetime total to the day it opened.
```

- [ ] **Step 4: Run the full suite**

Run: `pnpm check`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add README.md src/content/about.md.ts src/pages/about.tsx src/__tests__/agent-content.test.ts
git commit -m "docs: explain local-day usage attribution"
```

---

## Deployment order

1. Merge and deploy the server (Tasks 2, 4–7, 14). Old reporters keep working: no `day`, no `replace_sessions`, attribution unchanged.
2. Apply the migration against production: `pnpm db:migrate` (it rebuilds the table; totals are preserved).
3. Release the reporter (Tasks 1, 3, 8–13). CI publishes `tokenmaxer` when `reporter/` changes.
4. Verify with a dry run before any upload (esbuild writes the bundle to `reporter/tokentally.mjs`, per `reporter/package.json`'s `build` script):
    ```bash
    pnpm build:reporter
    node reporter/tokentally.mjs claude-sessionstart --dry-run | head -40
    ```
    Expect `replace_sessions` in the body and several rows per session with distinct `day` values.
5. Re-derive your own history once: `tokenmaxer backfill claude` (then `codex`, `opencode`, `pi`, `cursor`).
6. Spot-check against `bunx ccusage daily --since <date>`: a day's four token columns should now agree with the board's per-day totals to within the known 0.17% (cross-session duplicate messages, which tokenmaxer dedupes per session and ccusage dedupes globally).

## Known consequences (accepted)

- **Hackathons are day-granular.** A contest range shorter than a day, or one that starts mid-day, now counts both boundary days in full. `getHackathonLeaderboard`'s doc comment states this.
- **`7d`/`30d` are calendar windows, not rolling hour spans.** `7d` covers 7 calendar dates, so it spans up to 7 days and 23 hours of wall clock.
- **Cross-user comparison inside a window is approximate.** Two users in different zones have different absolute 24-hour spans on the same `day`. This is the deliberate trade for "my today means my today".
- **Old data stays mis-attributed until re-reported.** Seeded rows keep the UTC day of their session start. All-time totals are unaffected; a single `tokenmaxer backfill` fixes a user's per-day history.
- **A downgraded reporter re-collapses a session.** An older install posting one row per session replaces the day rows for that session (via the day-less path plus no `replace_sessions`, it adds a legacy row alongside them). If this matters, treat the npm release as forward-only.
