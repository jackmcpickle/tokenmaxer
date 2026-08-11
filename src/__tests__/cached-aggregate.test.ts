import { describe, expect, it, vi } from 'vitest';
import { memoryKv } from '@/__tests__/helpers/kv';
import {
    cachedDistinctModelFamilies,
    cachedLeaderboard,
    cachedProfile,
    invalidateProfileCache,
    leaderboardCacheKey,
    profileCacheKey,
    profileWindowCacheKey,
} from '@/lib/cached-aggregate';

describe('cache keys', () => {
    it('leaderboard key includes filters and limit', () => {
        expect(
            leaderboardCacheKey({
                window: '7d',
                startDay: 20260807,
                metric: 'total',
                source: 'claude_code',
                model: 'sonnet',
                limit: 100,
            }),
        ).toBe('agg:lb:v2:7d:20260807:total:claude_code:sonnet::100');
    });

    it('leaderboard key separates by country', () => {
        const base = {
            window: '7d' as const,
            startDay: 20260807,
            metric: 'total' as const,
            limit: 100,
        };
        expect(leaderboardCacheKey({ ...base, country: 'AU' })).toBe(
            'agg:lb:v2:7d:20260807:total:::AU:100',
        );
        expect(leaderboardCacheKey({ ...base, country: 'US' })).not.toBe(
            leaderboardCacheKey({ ...base, country: 'AU' }),
        );
    });

    it('profile key is lowercased', () => {
        expect(profileCacheKey('Ada')).toBe('agg:profile:v2:ada');
    });

    it('profile window key includes the window', () => {
        expect(profileWindowCacheKey('Ada', '7d', 20260807)).toBe(
            'agg:profile7d:v2:ada:20260807',
        );
    });
});

describe('cachedLeaderboard', () => {
    it('hits D1 once for the same query within the TTL', async () => {
        const kv = memoryKv();
        const all = vi.fn(async () => ({ results: [] }));
        const db = {
            prepare: () => ({
                bind: () => ({ all }),
            }),
        } as unknown as D1Database;

        const query = {
            window: '7d' as const,
            startDay: 20260807,
            metric: 'total' as const,
            limit: 10,
        };
        await cachedLeaderboard(db, kv, query);
        await cachedLeaderboard(db, kv, query);

        expect(all).toHaveBeenCalledTimes(1);
    });
});

describe('cachedProfile', () => {
    it('does not cache a missing profile', async () => {
        const kv = memoryKv();
        const first = vi.fn(async () => null);
        const db = {
            prepare: () => ({
                bind: () => ({ first, all: async () => ({ results: [] }) }),
            }),
        } as unknown as D1Database;

        expect(await cachedProfile(db, kv, 'nobody')).toBeNull();
        expect(await cachedProfile(db, kv, 'nobody')).toBeNull();
        expect(first).toHaveBeenCalledTimes(2);
    });

    it('drops all-time and exactly the two reachable 7d KV entries on invalidateProfileCache', async () => {
        const kv = memoryKv();
        // og.ts is the only windowed consumer and it always resolves its 7d
        // window in UTC via windowStartDay('7d', now, 'UTC'), i.e.
        // shiftDay(D, -6) for the UTC day D in effect when an entry was
        // WRITTEN. A live entry can have been written up to
        // READ_CACHE_TTL_SECONDS (600s) ago, which can straddle a UTC
        // midnight, so two keys are reachable at invalidation time: today's
        // (20260801 = shiftDay(20260807, -6)) and yesterday's
        // (20260731 = shiftDay(20260807, -7)). The next one out
        // (20260802 = shiftDay(20260807, -5), reachable only for a write
        // dated tomorrow) is not, and must stay untouched.
        const now = Date.parse('2026-08-07T12:00:00Z');
        const reachableStartDays = [20260801, 20260731];
        const deadStartDay = 20260802;
        await kv.put(profileCacheKey('Ada'), '{"username":"Ada"}');
        await Promise.all(
            [...reachableStartDays, deadStartDay].map((day) =>
                kv.put(
                    profileWindowCacheKey('Ada', '7d', day),
                    '{"grand_total":1,"cost":2,"sessions":3}',
                ),
            ),
        );
        await invalidateProfileCache(kv, 'Ada', now);
        expect(await kv.get(profileCacheKey('Ada'))).toBeNull();
        const cleared = await Promise.all(
            reachableStartDays.map((day) =>
                kv.get(profileWindowCacheKey('Ada', '7d', day)),
            ),
        );
        expect(cleared).toEqual([null, null]);
        expect(
            await kv.get(profileWindowCacheKey('Ada', '7d', deadStartDay)),
        ).toBe('{"grand_total":1,"cost":2,"sessions":3}');
    });
});

describe('page-cache og middleware export', () => {
    it('exports ogCache alongside pageCache', async () => {
        const { ogCache, pageCache } = await import('@/lib/page-cache');
        expect(typeof ogCache).toBe('function');
        expect(typeof pageCache).toBe('function');
    });
});

describe('cachedDistinctModelFamilies', () => {
    it('caches the model family list', async () => {
        const kv = memoryKv();
        const all = vi.fn(async () => ({
            results: [{ model: 'claude-sonnet-4-6' }],
        }));
        const db = {
            prepare: () => ({
                bind: () => ({ all }),
                all,
            }),
        } as unknown as D1Database;

        const first = await cachedDistinctModelFamilies(db, kv);
        const second = await cachedDistinctModelFamilies(db, kv);

        expect(first).toEqual(second);
        expect(all).toHaveBeenCalledTimes(1);
    });
});

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
