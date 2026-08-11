import { Hono } from 'hono';
import { cachedProfile, cachedProfileWindow } from '@/lib/cached-aggregate';
import { windowStartDay } from '@/lib/day';
import { ogCache } from '@/lib/page-cache';
import { READ_CACHE_TTL_SECONDS } from '@/lib/read-cache';
import { buildShareCardPayload, buildShareCardSvg } from '@/lib/share-card';
import { renderShareCardPng } from '@/lib/share-card-png';
import type { Env } from '@/types';

export const ogRoutes = new Hono<{ Bindings: Env }>();

ogRoutes.get('/u/:username/og.png', ogCache, async (c) => {
    const username = c.req.param('username');
    const { DB, RATE_LIMIT } = c.env;
    const now = Date.now();
    // Resolved in UTC, not the viewer's zone: this PNG is fetched by link-preview
    // crawlers as often as by people, "the viewer's timezone" is meaningless for
    // a shared social-card asset, and ogCache below keys on URL alone, so every
    // viewer/crawler must resolve the same day to share that one cache entry.
    const startDay = windowStartDay('7d', now, 'UTC');
    const [profile, last7d] = await Promise.all([
        cachedProfile(DB, RATE_LIMIT, username),
        cachedProfileWindow(DB, RATE_LIMIT, username, '7d', startDay),
    ]);
    if (!profile || !last7d) {
        return c.text('Not found', 404);
    }

    const png = await renderShareCardPng(
        buildShareCardSvg(buildShareCardPayload(profile, last7d)),
    );
    return new Response(png, {
        status: 200,
        headers: {
            'Content-Type': 'image/png',
            'Cache-Control': `public, max-age=${READ_CACHE_TTL_SECONDS}`,
        },
    });
});
