import { describe, expect, it, vi } from 'vitest';
import { stubKv } from '@/__tests__/helpers/kv';
import app from '@/index';
import {
    apiCacheKeyFor,
    pageCacheKey,
    pageCacheKeyFor,
    viewerDayFor,
} from '@/lib/page-cache';
import type { Env } from '@/types';

function emptyDb(): D1Database {
    const empty = { results: [] as unknown[] };
    return {
        prepare() {
            return {
                bind() {
                    return this;
                },
                all: async () => empty,
                first: async () => null,
            };
        },
    } as unknown as D1Database;
}

function env(): Env {
    return {
        DB: emptyDb(),
        RATE_LIMIT: stubKv(),
        ENVIRONMENT: 'test',
        PUBLIC_BASE_URL: 'https://tokenmaxer.quest',
        TURNSTILE_SECRET: '',
    };
}

describe('public read Cache-Control', () => {
    it('sets max-age=600 on the dashboard', async () => {
        const res = await app.request(
            'https://tokenmaxer.quest/',
            { headers: { Accept: 'text/html', 'Sec-Fetch-Mode': 'navigate' } },
            env(),
        );
        expect(res.status).toBe(200);
        expect(res.headers.get('Cache-Control')).toMatch(/max-age=600/u);
    });

    it('uses no-store on localhost HTML so wrangler edits are visible', async () => {
        const res = await app.request(
            'http://127.0.0.1:8787/',
            { headers: { Accept: 'text/html', 'Sec-Fetch-Mode': 'navigate' } },
            env(),
        );
        expect(res.status).toBe(200);
        expect(res.headers.get('Cache-Control')).toBe('no-store');
    });

    it('sets max-age=600 on /api/leaderboard', async () => {
        const res = await app.request(
            'https://tokenmaxer.quest/api/leaderboard',
            {},
            env(),
        );
        expect(res.status).toBe(200);
        expect(res.headers.get('Cache-Control')).toMatch(/max-age=600/u);
    });

    it('reflects Origin on /api/leaderboard CORS', async () => {
        const res = await app.request(
            'https://tokenmaxer.quest/api/leaderboard',
            { headers: { Origin: 'https://example.com' } },
            env(),
        );
        expect(res.headers.get('Access-Control-Allow-Origin')).toBe(
            'https://example.com',
        );
        expect(res.headers.get('Vary') ?? '').toMatch(/Origin/iu);
    });

    it('does not set Cache-Control on missing profile HTML', async () => {
        const res = await app.request(
            'https://tokenmaxer.quest/u/nobody-here',
            { headers: { Accept: 'text/html', 'Sec-Fetch-Mode': 'navigate' } },
            env(),
        );
        expect(res.status).toBe(404);
        expect(res.headers.get('Cache-Control')).toBeNull();
    });
});

describe('pageCacheKey', () => {
    it('buckets preview bots separately from browsers', () => {
        vi.useFakeTimers();
        vi.setSystemTime(Date.parse('2026-08-07T20:00:00Z'));
        const browser = {
            req: {
                url: 'https://tokenmaxer.quest/',
                raw: new Request('https://tokenmaxer.quest/'),
                header: () => 'Mozilla/5.0',
            },
        };
        const bot = {
            req: {
                url: 'https://tokenmaxer.quest/',
                raw: new Request('https://tokenmaxer.quest/'),
                header: () => 'Slackbot-LinkExpanding 1.0',
            },
        };
        expect(pageCacheKey(browser as never)).toBe(
            'https://tokenmaxer.quest/::preview=0::vday=20260807',
        );
        expect(pageCacheKey(bot as never)).toBe(
            'https://tokenmaxer.quest/::preview=1::vday=20260807',
        );
        vi.useRealTimers();
    });
});

function requestWithZone(timezone: string): Request {
    const req = new Request('https://tokenmaxer.quest/');
    Object.defineProperty(req, 'cf', { value: { timezone } });
    return req;
}

describe('viewer-day cache keys', () => {
    // 2026-08-07T20:00Z: Auckland (UTC+12, no DST in August) has already
    // rolled over to the 8th; Honolulu (UTC-10, no DST) is still on the 7th —
    // two real zones whose local calendar dates differ at the same instant.
    const T = Date.parse('2026-08-07T20:00:00Z');

    it("resolves each viewer's own calendar date from cf.timezone", () => {
        expect(viewerDayFor(requestWithZone('Pacific/Auckland'), T)).toBe(
            20260808,
        );
        expect(viewerDayFor(requestWithZone('Pacific/Honolulu'), T)).toBe(
            20260807,
        );
    });

    it('falls back to the UTC date when cf is absent', () => {
        expect(viewerDayFor(new Request('https://tokenmaxer.quest/'), T)).toBe(
            20260807,
        );
    });

    it('page and API cache keys differ across the two viewer dates', () => {
        const url = 'https://tokenmaxer.quest/';
        const auckland = viewerDayFor(requestWithZone('Pacific/Auckland'), T);
        const honolulu = viewerDayFor(requestWithZone('Pacific/Honolulu'), T);

        expect(pageCacheKeyFor(url, false, auckland)).not.toBe(
            pageCacheKeyFor(url, false, honolulu),
        );
        expect(apiCacheKeyFor(url, auckland)).not.toBe(
            apiCacheKeyFor(url, honolulu),
        );
    });
});
