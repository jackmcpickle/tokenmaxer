import {
    distinctFamilies,
    familyOf,
    isSyntheticModel,
} from '@/lib/model-family';
import { estimateCost } from '@/lib/pricing';
import type { Metric, Source, TimeWindow } from '@/types';

export interface Totals {
    input_tokens: number;
    output_tokens: number;
    cache_read_tokens: number;
    cache_creation_tokens: number;
    reasoning_tokens: number;
    cost: number;
}

export interface LeaderboardEntry extends Totals {
    rank: number;
    username: string;
    sessions: number;
    // sum of all token categories
    grand_total: number;
}

export interface ModelBreakdown extends Totals {
    source: Source;
    model: string;
}

export interface Profile extends Totals {
    username: string;
    created_at: number;
    rank: number;
    sessions: number;
    grand_total: number;
    breakdown: ModelBreakdown[];
    url: string | null;
    country: string;
}

/** Lightweight windowed totals for share cards (no breakdown / rank). */
export interface ProfileWindowTotals {
    grand_total: number;
    cost: number;
    sessions: number;
}

export interface GroupedRow {
    username: string;
    user_id: string;
    source: string;
    model: string;
    input_tokens: number;
    output_tokens: number;
    cache_read_tokens: number;
    cache_creation_tokens: number;
    reasoning_tokens: number;
    sessions: number;
}

function emptyTotals(): Totals {
    return {
        input_tokens: 0,
        output_tokens: 0,
        cache_read_tokens: 0,
        cache_creation_tokens: 0,
        reasoning_tokens: 0,
        cost: 0,
    };
}

function addRow(t: Totals, r: GroupedRow): void {
    t.input_tokens += r.input_tokens;
    t.output_tokens += r.output_tokens;
    t.cache_read_tokens += r.cache_read_tokens;
    t.cache_creation_tokens += r.cache_creation_tokens;
    t.reasoning_tokens += r.reasoning_tokens;
    t.cost += estimateCost(r.model, r, r.source);
}

export function grandTotal(t: Totals): number {
    return (
        t.input_tokens +
        t.output_tokens +
        t.cache_read_tokens +
        t.cache_creation_tokens +
        t.reasoning_tokens
    );
}

export function metricValue(t: Totals, metric: Metric): number {
    switch (metric) {
        case 'total':
            return grandTotal(t);
        case 'input':
            return t.input_tokens;
        case 'output':
            return t.output_tokens;
        case 'cached':
            return t.cache_read_tokens + t.cache_creation_tokens;
        case 'cost':
            return t.cost;
        default: {
            const exhaustive: never = metric;
            return exhaustive;
        }
    }
}

const GROUP_SELECT = `
  SELECT u.username AS username, su.user_id AS user_id, su.source AS source, su.model AS model,
         SUM(su.input_tokens) AS input_tokens,
         SUM(su.output_tokens) AS output_tokens,
         SUM(su.cache_read_tokens) AS cache_read_tokens,
         SUM(su.cache_creation_tokens) AS cache_creation_tokens,
         SUM(su.reasoning_tokens) AS reasoning_tokens,
         SUM(su.sessions) AS sessions
  FROM usage_daily su
  JOIN users u ON u.id = su.user_id
`;

export interface LeaderboardQuery {
    /** Echoed back to clients; the resolved startDay controls data caching. */
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

interface FoldedUser {
    username: string;
    totals: Totals;
    sessions: number;
}

function foldGroupedRows(
    rows: readonly GroupedRow[],
    model: string | undefined,
): Map<string, FoldedUser> {
    const byUser = new Map<string, FoldedUser>();
    for (const r of rows) {
        if (isSyntheticModel(r.model)) continue;
        if (model && familyOf(r.model) !== model) continue;
        let entry = byUser.get(r.user_id);
        if (!entry) {
            entry = {
                username: r.username,
                totals: emptyTotals(),
                sessions: 0,
            };
            byUser.set(r.user_id, entry);
        }
        addRow(entry.totals, r);
        // Approximate: sessions are counted once per model and calendar day.
        entry.sessions += r.sessions;
    }
    return byUser;
}

function rankFolded(
    byUser: ReadonlyMap<string, FoldedUser>,
    metric: Metric,
    limit: number | undefined,
): LeaderboardEntry[] {
    const entries: LeaderboardEntry[] = [];
    for (const v of byUser.values()) {
        entries.push({
            rank: 0,
            username: v.username,
            sessions: v.sessions,
            grand_total: grandTotal(v.totals),
            ...v.totals,
        });
    }
    entries.sort((a, b) => metricValue(b, metric) - metricValue(a, metric));
    const limited = entries.slice(0, limit ?? 100);
    for (const [i, entry] of limited.entries()) {
        entry.rank = i + 1;
    }
    return limited;
}

/** Apply presentation choices to shared, unranked database rows. */
export function leaderboardFromRows(
    rows: readonly GroupedRow[],
    q: Pick<LeaderboardQuery, 'model' | 'metric' | 'limit'>,
): LeaderboardEntry[] {
    return rankFolded(foldGroupedRows(rows, q.model), q.metric, q.limit);
}

export async function getLeaderboard(
    db: D1Database,
    q: LeaderboardQuery,
): Promise<LeaderboardEntry[]> {
    return leaderboardFromRows(await getLeaderboardRows(db, q), q);
}

/** Only these filters change the SQL; metric, family and limit are applied later. */
export async function getLeaderboardRows(
    db: D1Database,
    q: Pick<LeaderboardQuery, 'startDay' | 'source' | 'country'>,
): Promise<GroupedRow[]> {
    const conditions = ['su.day >= ?'];
    const binds: (string | number)[] = [q.startDay];
    if (q.source) {
        conditions.push('su.source = ?');
        binds.push(q.source);
    }
    if (q.country) {
        conditions.push('u.country = ?');
        binds.push(q.country);
    }
    // Model filter is applied in JS via familyOf so all versioned variants
    // (e.g. claude-sonnet-4-6 and claude-sonnet-5) match one family id.
    const sql = `${GROUP_SELECT} WHERE ${conditions.join(' AND ')} GROUP BY su.user_id, su.source, su.model`;
    const res = await db
        .prepare(sql)
        .bind(...binds)
        .all<GroupedRow>();
    return res.results;
}

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

/**
 * Leaderboard scoped to an inclusive [startDay, endDay] calendar-day range and
 * a fixed member set. Rows are day-granular, so a contest range is snapped
 * outward to whole UTC days by the caller: a sub-day range counts both boundary
 * days in full. Row `day` values are each reporter's *local* calendar day, not
 * UTC, so for a contest with participants across timezones this is fuzzy by
 * up to a day at each boundary — a session just inside the UTC window edge for
 * one participant's local day can land just outside another's.
 */
export async function getHackathonLeaderboard(
    db: D1Database,
    q: HackathonLeaderboardQuery,
): Promise<LeaderboardEntry[]> {
    if (q.memberIds.length === 0) return [];
    const placeholders = q.memberIds.map(() => '?').join(', ');
    const sql = `${GROUP_SELECT} WHERE su.day >= ? AND su.day <= ? AND su.user_id IN (${placeholders}) GROUP BY su.user_id, su.source, su.model`;
    const res = await db
        .prepare(sql)
        .bind(q.startDay, q.endDay, ...q.memberIds)
        .all<GroupedRow>();
    return rankFolded(foldGroupedRows(res.results, q.model), q.metric, q.limit);
}

export async function getDistinctModels(db: D1Database): Promise<string[]> {
    const res = await db
        // Seek to the next indexed model instead of visiting every row of each model.
        .prepare(`WITH RECURSIVE models(model) AS (
            SELECT MIN(model) FROM usage_daily
            UNION ALL
            SELECT (SELECT MIN(model) FROM usage_daily WHERE model > models.model)
            FROM models WHERE model IS NOT NULL
        ) SELECT model FROM models WHERE model IS NOT NULL ORDER BY model`)
        .all<{ model: string }>();
    return res.results.map((r) => r.model);
}

/** Bundled model family ids for the leaderboard filter (excludes synthetic). */
export async function getDistinctModelFamilies(
    db: D1Database,
): Promise<string[]> {
    return distinctFamilies(await getDistinctModels(db));
}

/** Competition rank is one plus the number of users strictly above this total. */
export function profileRankFromRows(
    rows: readonly GroupedRow[],
    total: number,
): number {
    const totals = [...foldGroupedRows(rows, undefined).values()]
        .map((user) => grandTotal(user.totals))
        .sort((a, b) => b - a);
    let low = 0;
    let high = totals.length;
    while (low < high) {
        const middle = Math.floor((low + high) / 2);
        const middleTotal = totals[middle];
        if (middleTotal !== undefined && middleTotal > total) low = middle + 1;
        else high = middle;
    }
    return low + 1;
}

export async function getProfile(
    db: D1Database,
    username: string,
    loadRankRows: () => Promise<readonly GroupedRow[]> = () =>
        getLeaderboardRows(db, { startDay: 0 }),
): Promise<Profile | null> {
    const user = await db
        .prepare(
            'SELECT id, username, created_at, profile_url, country FROM users WHERE username_lower = ?',
        )
        .bind(username.toLowerCase())
        .first<{
            id: string;
            username: string;
            created_at: number;
            profile_url: string | null;
            country: string;
        }>();
    if (!user) return null;

    const res = await db
        .prepare(
            `${GROUP_SELECT} WHERE su.user_id = ? GROUP BY su.source, su.model`,
        )
        .bind(user.id)
        .all<GroupedRow>();

    const totals = emptyTotals();
    const breakdown: ModelBreakdown[] = [];
    let sessions = 0;
    for (const r of res.results) {
        if (isSyntheticModel(r.model)) continue;
        addRow(totals, r);
        sessions += r.sessions;
        const bt = emptyTotals();
        addRow(bt, r);
        breakdown.push({ source: r.source as Source, model: r.model, ...bt });
    }
    breakdown.sort((a, b) => grandTotal(b) - grandTotal(a));

    const myTotal = grandTotal(totals);
    const rank = profileRankFromRows(await loadRankRows(), myTotal);

    return {
        username: user.username,
        created_at: user.created_at,
        rank,
        sessions,
        grand_total: myTotal,
        breakdown,
        url: user.profile_url ?? null,
        country: user.country,
        ...totals,
    };
}

/**
 * ISO country codes for users who have reported at least one session, sorted.
 * Powers the leaderboard country filter so it lists only countries in play.
 */
export async function getDistinctCountries(db: D1Database): Promise<string[]> {
    const res = await db
        .prepare(
            `SELECT DISTINCT u.country AS country
             FROM users u
             WHERE EXISTS (SELECT 1 FROM usage_daily su WHERE su.user_id = u.id)
             ORDER BY u.country`,
        )
        .all<{ country: string }>();
    return res.results.map((r) => r.country);
}

/**
 * Token/cost/session totals for one user in a time window.
 * Returns `null` only when the username is unknown; zero totals when there is
 * no usage in the window.
 */
export async function getProfileWindowTotals(
    db: D1Database,
    username: string,
    startDay: number,
): Promise<ProfileWindowTotals | null> {
    const user = await db
        .prepare('SELECT id FROM users WHERE username_lower = ?')
        .bind(username.toLowerCase())
        .first<{ id: string }>();
    if (!user) return null;

    const { results } = await db
        .prepare(
            `${GROUP_SELECT} WHERE su.user_id = ? AND su.day >= ? GROUP BY su.source, su.model`,
        )
        .bind(user.id, startDay)
        .all<GroupedRow>();

    const totals = emptyTotals();
    let sessions = 0;
    for (const row of results) {
        if (isSyntheticModel(row.model)) continue;
        addRow(totals, row);
        sessions += row.sessions;
    }
    return {
        grand_total: grandTotal(totals),
        cost: totals.cost,
        sessions,
    };
}
