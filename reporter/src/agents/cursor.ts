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

// Unofficial dashboard endpoint — the only individual route to Cursor usage.
export async function cursorFetchEvents(
    sessionToken: string,
    sinceMs: number,
): Promise<unknown[] | null> {
    const events: unknown[] = [];
    const pages: unknown[][] = [];
    let expectedTotal: number | null = null;
    let completed = false;
    // Freeze the window for the whole fetch: a per-page Date.now() end bound
    // would shift rows across pages as new events arrive mid-pagination.
    const endDate = String(Date.now());
    for (let page = 1; page <= 200; page += 1) {
        // eslint-disable-next-line no-await-in-loop -- pagination is inherently sequential
        const payload = await cursorFetchPage(
            sessionToken,
            JSON.stringify({
                teamId: 0,
                startDate: String(sinceMs),
                endDate,
                page,
                pageSize: 1000,
            }),
        );
        if (payload === null) return null;
        const pageTotal = cursorTotalCount(payload);
        if (
            pageTotal !== null &&
            expectedTotal !== null &&
            pageTotal !== expectedTotal
        ) {
            // The authoritative count changed mid-pagination: rows shifted
            // across pages and the surplus-based reconciliation can no
            // longer prove which rows are duplicates. Abort the window.
            process.stderr.write(
                `tokenmaxer: cursor pagination inconsistent (total ${expectedTotal} became ${pageTotal})\n`,
            );
            return null;
        }
        expectedTotal = pageTotal ?? expectedTotal;
        const batch = payload.usageEvents ?? payload.usageEventsDisplay ?? [];
        if (!Array.isArray(batch) || batch.length === 0) {
            completed = true;
            break;
        }
        pages.push(batch);
        // No spread: the batch size is server-controlled and a huge page
        // must take the abort path, not blow the call stack.
        for (const e of batch) events.push(e);
        if (batch.length < 1000) {
            completed = true;
            break;
        }
    }
    // Reaching the reported total is NOT proof of completion — Cursor can
    // repeat rows at page boundaries, so the raw count can hit the total
    // while genuine tail events sit on an unfetched page. Only an empty or
    // short page proves the window is complete; a partial window must not be
    // published (day rows would replace fuller stored ones).
    if (
        !completed ||
        (expectedTotal !== null && events.length < expectedTotal)
    ) {
        process.stderr.write(
            `tokenmaxer: cursor pagination incomplete (${events.length}${
                expectedTotal === null ? '' : `/${expectedTotal}`
            } event(s))\n`,
        );
        return null;
    }
    if (expectedTotal === null || events.length <= expectedTotal) {
        return events;
    }
    return reconcileCursorPages(pages, events.length - expectedTotal);
}

// The endpoint exposes no stable event id. When the raw count exceeds the
// authoritative total, drop exactly the surplus as duplicates at adjacent
// page boundaries (rows equal by value); equal rows stay distinct when the
// reported count vouches for both. Ported from CodexBar's boundaryOverlap
// reconciliation.
function reconcileCursorPages(
    pages: unknown[][],
    surplus: number,
): unknown[] | null {
    let removals = surplus;
    const out = [...(pages[0] ?? [])];
    for (let i = 1; i < pages.length; i += 1) {
        const prev = pages[i - 1] ?? [];
        const page = pages[i] ?? [];
        const drop = Math.min(cursorBoundaryOverlap(prev, page), removals);
        for (const e of page.slice(drop)) out.push(e);
        removals -= drop;
    }
    if (removals !== 0) {
        process.stderr.write(
            'tokenmaxer: cursor pagination inconsistent (unreconciled duplicates)\n',
        );
        return null;
    }
    return out;
}

// Longest k where the previous page's last k rows equal the next page's
// first k rows, compared by value (each row serialized once).
function cursorBoundaryOverlap(prev: unknown[], page: unknown[]): number {
    const limit = Math.min(prev.length, page.length);
    if (limit === 0) return 0;
    const prevKeys = prev.slice(-limit).map((e) => JSON.stringify(e));
    const pageKeys = page.slice(0, limit).map((e) => JSON.stringify(e));
    for (let count = limit; count >= 1; count -= 1) {
        let equal = true;
        for (let i = 0; i < count; i += 1) {
            if (prevKeys[prevKeys.length - count + i] !== pageKeys[i]) {
                equal = false;
                break;
            }
        }
        if (equal) return count;
    }
    return 0;
}
