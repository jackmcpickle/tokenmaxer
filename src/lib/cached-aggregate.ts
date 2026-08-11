import {
    getDistinctCountries,
    getDistinctModelFamilies,
    getHackathonLeaderboard,
    type HackathonLeaderboardQuery,
    getLeaderboard,
    getProfile,
    getProfileWindowTotals,
    type LeaderboardEntry,
    type LeaderboardQuery,
    type Profile,
    type ProfileWindowTotals,
} from '@/lib/aggregate';
import { dayFromMs, shiftDay } from '@/lib/day';
import {
    getOrSet,
    HACKATHON_CACHE_TTL_SECONDS,
    READ_CACHE_TTL_SECONDS,
} from '@/lib/read-cache';
import type { Metric, TimeWindow } from '@/types';

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

/**
 * Drop a user's profile aggregates after ingest/history so the next read is
 * fresh. The only windowed consumer is `og.ts`, and it always resolves its 7d
 * window in UTC (`windowStartDay('7d', now, 'UTC')`), so every windowed key
 * that can ever exist has the shape `shiftDay(D, -6)` for the UTC day `D` in
 * effect when it was *written*. A KV entry's key is fixed at write time and
 * stays live for READ_CACHE_TTL_SECONDS (600s) after that — so within ten
 * minutes after a UTC midnight, an entry written just before it still carries
 * yesterday's `D`. Two keys can therefore be live, not one:
 * `shiftDay(today, -6)` (written today) and `shiftDay(today, -7)` (written
 * yesterday, i.e. `shiftDay(shiftDay(today, -1), -6)`). A `today + 1`
 * candidate — needed only for a viewer-zone consumer ahead of UTC — is
 * genuinely unreachable now that the OG card resolves in UTC (Task 7): no
 * write can have a UTC day later than "now".
 */
export async function invalidateProfileCache(
    kv: KVNamespace,
    username: string,
    now: number = Date.now(),
): Promise<void> {
    const today = dayFromMs(now, 'UTC');
    await Promise.all([
        kv.delete(profileCacheKey(username)),
        kv.delete(profileWindowCacheKey(username, '7d', shiftDay(today, -6))),
    ]);
}

const MODELS_CACHE_KEY = 'agg:models:v1';
const COUNTRIES_CACHE_KEY = 'agg:countries:v1';

function withReadCache<T>(
    kv: KVNamespace,
    key: string,
    load: () => Promise<T>,
): Promise<T> {
    return getOrSet(kv, key, READ_CACHE_TTL_SECONDS, load);
}

export async function cachedLeaderboard(
    db: D1Database,
    kv: KVNamespace,
    query: LeaderboardQuery,
): Promise<LeaderboardEntry[]> {
    return withReadCache(kv, leaderboardCacheKey(query), () =>
        getLeaderboard(db, query),
    );
}

export async function cachedProfile(
    db: D1Database,
    kv: KVNamespace,
    username: string,
): Promise<Profile | null> {
    return withReadCache(kv, profileCacheKey(username), () =>
        getProfile(db, username),
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

export function hackathonLeaderboardCacheKey(
    slug: string,
    metric: Metric,
): string {
    return `agg:hack:v1:${slug.toLowerCase()}:${metric}`;
}

/** Drop all cached metric variants for a hackathon after a membership/edit change. */
export async function invalidateHackathonCache(
    kv: KVNamespace,
    slug: string,
): Promise<void> {
    await Promise.all(
        (['total', 'input', 'output', 'cached', 'cost'] as const).map((m) =>
            kv.delete(hackathonLeaderboardCacheKey(slug, m)),
        ),
    );
}

export async function cachedHackathonLeaderboard(
    db: D1Database,
    kv: KVNamespace,
    slug: string,
    query: HackathonLeaderboardQuery,
): Promise<LeaderboardEntry[]> {
    return getOrSet(
        kv,
        hackathonLeaderboardCacheKey(slug, query.metric),
        HACKATHON_CACHE_TTL_SECONDS,
        () => getHackathonLeaderboard(db, query),
    );
}

export async function cachedDistinctModelFamilies(
    db: D1Database,
    kv: KVNamespace,
): Promise<string[]> {
    return withReadCache(kv, MODELS_CACHE_KEY, () =>
        getDistinctModelFamilies(db),
    );
}

export async function cachedDistinctCountries(
    db: D1Database,
    kv: KVNamespace,
): Promise<string[]> {
    return withReadCache(kv, COUNTRIES_CACHE_KEY, () =>
        getDistinctCountries(db),
    );
}
