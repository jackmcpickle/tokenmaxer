import { homedir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { asObject } from '../lib/parse-utils';
import { accumulateModelUsage, usageFromFields } from '../lib/totals';
import type {
    JsonObject,
    ReporterConfig,
    ReporterRow,
    ReporterTotals,
} from '../lib/types';
import { CURSOR_USAGE_FIELDS } from '../lib/usage-fields';

// Cursor serializes some token counts as strings; coerce the known fields to
// numbers before the shared field mapping.
function cursorUsage(raw: JsonObject): ReporterTotals {
    const coerced: JsonObject = {};
    for (const field of Object.values(CURSOR_USAGE_FIELDS)) {
        const v = raw[field];
        coerced[field] = typeof v === 'string' && v.trim() ? Number(v) : v;
    }
    return usageFromFields(coerced, CURSOR_USAGE_FIELDS);
}

/**
 * Bucket Cursor dashboard usage events by UTC day + model into session rows.
 * One synthetic session per day ("cursor-YYYY-MM-DD"); re-summing a whole day
 * on every run keeps ingestion idempotent (server upserts by session+model).
 */
export function parseCursorEvents(events: unknown[]): ReporterRow[] {
    // 'YYYY-MM-DD' -> Map(model -> totals)
    const days = new Map<string, Map<string, ReporterTotals>>();
    for (const raw of Array.isArray(events) ? events : []) {
        if (!raw || typeof raw !== 'object') continue;
        const e = raw as JsonObject;
        const ms = Number(e.timestamp);
        if (!Number.isFinite(ms) || ms <= 0) continue;
        if (!e.tokenUsage || typeof e.tokenUsage !== 'object') continue;
        // Zero-usage events (aborted/refunded requests) still produce a
        // zero-total (day, model) row when a day has nothing else: the
        // replace-upsert needs it to overwrite a stale non-zero day.
        const usage = cursorUsage(asObject(e.tokenUsage));
        const day = new Date(ms).toISOString().slice(0, 10);
        const model =
            typeof e.model === 'string' && e.model ? e.model : 'unknown';
        const byModel = days.get(day) ?? new Map<string, ReporterTotals>();
        accumulateModelUsage(byModel, model, usage);
        days.set(day, byModel);
    }
    const rows: ReporterRow[] = [];
    for (const [day, byModel] of days) {
        const startedAt = Date.parse(`${day}T00:00:00Z`);
        for (const [model, t] of byModel) {
            rows.push({
                session_id: `cursor-${day}`,
                model,
                started_at: startedAt,
                ...t,
            });
        }
    }
    return rows;
}

// Cursor stores its auth JWT in the app's global state SQLite DB.
function cursorDbPaths(): string[] {
    const home = homedir();
    return [
        join(
            home,
            'Library',
            'Application Support',
            'Cursor',
            'User',
            'globalStorage',
            'state.vscdb',
        ),
        join(home, '.config', 'Cursor', 'User', 'globalStorage', 'state.vscdb'),
        join(
            process.env.APPDATA ?? join(home, 'AppData', 'Roaming'),
            'Cursor',
            'User',
            'globalStorage',
            'state.vscdb',
        ),
    ];
}

// Older Cursor builds store the value JSON-quoted; current builds store the raw JWT.
function normalizeCursorToken(value: unknown): string | null {
    let token = typeof value === 'string' ? value : null;
    if (token?.startsWith('"')) {
        try {
            const parsed: unknown = JSON.parse(token);
            token = typeof parsed === 'string' ? parsed : token;
        } catch {
            /* keep raw */
        }
    }
    return typeof token === 'string' && token ? token : null;
}

function jwtSub(jwt: string): string | null {
    try {
        const segment = jwt.split('.')[1];
        if (!segment) return null;
        const payload: unknown = JSON.parse(
            Buffer.from(segment, 'base64url').toString('utf8'),
        );
        // sub looks like "auth0|user_xxx"; the cookie wants the trailing id part.
        const sub = String(asObject(payload).sub ?? '');
        return sub.includes('|') ? (sub.split('|').pop() ?? null) : sub || null;
    } catch {
        return null;
    }
}

// Read cursorAuth/accessToken from one state.vscdb and build the session cookie.
// Cookie format is {userId}::{jwt}; userId comes from the JWT sub claim.
function cursorTokenFromDb(path: string): string | null {
    const db = new DatabaseSync(path, { readOnly: true });
    try {
        const row = db
            .prepare(
                "SELECT value FROM ItemTable WHERE key = 'cursorAuth/accessToken'",
            )
            .get() as { value?: unknown } | undefined;
        const token = normalizeCursorToken(row?.value);
        if (!token) return null;
        const sub = jwtSub(token);
        return sub ? `${sub}::${token}` : null;
    } finally {
        db.close();
    }
}

// Try each known state.vscdb location; fall back to cfg.cursorCookie.
export function cursorSessionToken(cfg: ReporterConfig): string | null {
    for (const path of cursorDbPaths()) {
        try {
            const token = cursorTokenFromDb(path);
            if (token) return token;
        } catch {
            /* try next path / fallback */
        }
    }
    return typeof cfg.cursorCookie === 'string' && cfg.cursorCookie
        ? cfg.cursorCookie
        : null;
}

// The response reports how many events match the query; pagination trusts it
// over per-page counts because the API can return short non-final pages.
function cursorTotalCount(payload: JsonObject): number | null {
    const v = payload.totalUsageEventsCount;
    // Number('') is 0 — a blank string must read as "no total reported",
    // not as an authoritative zero that fails every non-empty window.
    const n =
        typeof v === 'number'
            ? v
            : typeof v === 'string' && v.trim()
              ? Number(v)
              : NaN;
    return Number.isFinite(n) && n >= 0 ? Math.floor(n) : null;
}

// One page POST. Returns the parsed body, or null on any transport or HTTP
// failure — a network-level rejection (DNS, connection refused) must take
// the same abort path as an HTTP error, or the uncaught throw would ride
// the hook-safe exit(0) and mask a lost sync as success.
async function cursorFetchPage(
    sessionToken: string,
    body: string,
): Promise<JsonObject | null> {
    let res: Response;
    try {
        res = await fetch(
            'https://cursor.com/api/dashboard/get-filtered-usage-events',
            {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    Origin: 'https://cursor.com',
                    Cookie: `WorkosCursorSessionToken=${encodeURIComponent(sessionToken)}`,
                },
                body,
            },
        );
    } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        process.stderr.write(
            `tokenmaxer: cursor usage fetch failed: ${message}\n`,
        );
        return null;
    }
    if (!res.ok) {
        process.stderr.write(
            `tokenmaxer: cursor usage fetch failed (${res.status})\n`,
        );
        return null;
    }
    const data: unknown = await res.json().catch(() => null);
    return data === null ? null : asObject(data);
}
// Cursor serves usage events newest-first and treats `endDate` as inclusive,
// so pagination anchors on time, not on an offset. Offset paging walks a list
// that grows at the front: an event written mid-walk shifts every later page
// down by one, which is what moved the reported total between pages and
// aborted the whole window. Re-anchoring `endDate` to the oldest row seen so
// far makes new arrivals irrelevant -- they land newer than the anchor, in the
// region already passed, and are picked up by the next run (day rows re-sum).
const CURSOR_PAGE_SIZE = 1000;
// One request per page, plus the rare extra when a full page shares a single
// millisecond and the anchor cannot advance by time.
const CURSOR_MAX_REQUESTS = 400;

// The endpoint exposes no stable event id, so value identity is the key. It is
// only ever compared against rows re-served at the same millisecond by the
// inclusive `endDate`, where a byte-identical row is that same row again.
function cursorEventKey(event: unknown): string {
    return JSON.stringify(event);
}

// Counted rows at exactly `ts`. Counted rather than a plain Set so two
// genuinely identical rows in one millisecond both survive the next request.
function cursorRowsAt(batch: unknown[], ts: number): Map<string, number> {
    const rows = new Map<string, number>();
    for (const event of batch) {
        if (Number(asObject(event).timestamp) !== ts) continue;
        const key = cursorEventKey(event);
        rows.set(key, (rows.get(key) ?? 0) + 1);
    }
    return rows;
}

// Cursor computes the count and the rows in separate reads, so
// `totalUsageEventsCount` can exceed the rows it serves in that same response
// -- a single-page window was observed reporting 374 with 373 rows. An exact
// floor is therefore not a sound completeness test.
//
// For a keyset walk the short page IS the proof: `endDate` re-asks for the
// whole remaining range, so fewer than a full page means the range is empty.
// The total is kept only to catch gross truncation (a page lost outright).
// The allowance is absolute, not proportional: the skew comes from one pair of
// reads, so it does not grow with the window, while a proportional slice would
// both reject a small window over a single-event skew (9 of 10 is a 10% miss)
// and wave through a lost page in a large one.
const CURSOR_COUNT_SLACK = 32;

// A partial window must not publish -- day rows replace the stored ones.
function cursorComplete(
    events: unknown[],
    total: number | null,
): unknown[] | null {
    if (total !== null && events.length < total - CURSOR_COUNT_SLACK) {
        process.stderr.write(
            `tokenmaxer: cursor pagination incomplete (${events.length}/${total} event(s))\n`,
        );
        return null;
    }
    return events;
}

// Unofficial dashboard endpoint — the only individual route to Cursor usage.
export async function cursorFetchEvents(
    sessionToken: string,
    sinceMs: number,
): Promise<unknown[] | null> {
    const events: unknown[] = [];
    // Rows already taken at exactly `anchor`, which the next request re-serves
    // because `endDate` is inclusive.
    let takenAtAnchor = new Map<string, number>();
    let anchor = Date.now();
    // Offset within the current anchor. Only leaves 1 for the degenerate case
    // of a full page inside one millisecond, where time cannot advance.
    let offset = 1;
    // Only the first response counts the whole window; later ones count the
    // narrowed one.
    let windowTotal: number | null = null;

    for (let request = 1; request <= CURSOR_MAX_REQUESTS; request += 1) {
        // eslint-disable-next-line no-await-in-loop -- pagination is inherently sequential
        const payload = await cursorFetchPage(
            sessionToken,
            JSON.stringify({
                teamId: 0,
                startDate: String(sinceMs),
                endDate: String(anchor),
                page: offset,
                pageSize: CURSOR_PAGE_SIZE,
            }),
        );
        if (payload === null) return null;
        if (request === 1) windowTotal = cursorTotalCount(payload);
        const batch = payload.usageEvents ?? payload.usageEventsDisplay ?? [];
        if (!Array.isArray(batch) || batch.length === 0) {
            return cursorComplete(events, windowTotal);
        }

        // A re-anchored request repeats the anchor millisecond; an offset page
        // at an unchanged anchor is a genuine continuation and repeats nothing.
        const remaining =
            offset === 1 ? new Map(takenAtAnchor) : new Map<string, number>();
        let oldest = Number.POSITIVE_INFINITY;
        for (const event of batch) {
            const ts = Number(asObject(event).timestamp);
            if (Number.isFinite(ts) && ts < oldest) oldest = ts;
            if (ts === anchor) {
                const key = cursorEventKey(event);
                const left = remaining.get(key) ?? 0;
                if (left > 0) {
                    remaining.set(key, left - 1);
                    continue;
                }
            }
            events.push(event);
        }

        if (batch.length < CURSOR_PAGE_SIZE) {
            return cursorComplete(events, windowTotal);
        }
        if (!Number.isFinite(oldest)) {
            process.stderr.write(
                'tokenmaxer: cursor page carried no usable timestamp\n',
            );
            return null;
        }
        if (oldest < anchor) {
            anchor = oldest;
            offset = 1;
            takenAtAnchor = cursorRowsAt(batch, oldest);
        } else {
            // The whole page sits inside one millisecond: time cannot advance,
            // so walk the offset within this anchor instead. `takenAtAnchor`
            // needs no update -- suppression only runs at offset 1, and the
            // only way back to offset 1 is a re-anchor, which replaces it.
            offset += 1;
        }
    }
    process.stderr.write(
        'tokenmaxer: cursor pagination exceeded the request budget\n',
    );
    return null;
}
