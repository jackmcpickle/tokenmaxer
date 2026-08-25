import type { Context, MiddlewareHandler } from 'hono';
import { cache } from 'hono/cache';
import {
    AGENT_PAGE_VARY_HEADERS,
    isLinkPreviewBot,
} from '@/lib/agent-markdown';
import { dayFromMs, timeZoneFromRequest } from '@/lib/day';
import { READ_CACHE_TTL_SECONDS } from '@/lib/read-cache';

// Deliberately `public`, not `private`, even though content now depends on
// `cf.timezone` — a geo-IP signal no request header expresses, so no `Vary`
// can describe it. A shared proxy could in principle serve one viewer's
// local-day board to another. `private` would disable the Workers Cache API
// layer below entirely, which is a bigger loss than that exposure: Cloudflare
// doesn't edge-cache Worker responses by default, so the blast radius is
// third-party shared caches only, and the error is the same "adjacent
// calendar date" magnitude already tolerated for VPN users. Accepted trade,
// not an oversight.
const CACHE_CONTROL = `public, max-age=${READ_CACHE_TTL_SECONDS}`;

/** Local wrangler hosts — Cache API would otherwise pin stale HTML for the full TTL. */
function isLocalDevRequest(c: Context): boolean {
    try {
        const hostname = new URL(c.req.url).hostname;
        return hostname === 'localhost' || hostname === '127.0.0.1';
    } catch {
        return false;
    }
}

/**
 * Cache API when available (Cloudflare Workers). Always sets Cache-Control so
 * clients/CDNs can reuse the response even when `caches` is missing (tests).
 * Skips the Cache API on localhost so `wrangler dev` reflects source edits.
 */
function createCacheMiddleware(options: {
    cacheName: string;
    vary?: string[];
    keyGenerator?: (c: Context) => string | Promise<string>;
}): MiddlewareHandler {
    const varyHeader = options.vary?.join(', ');
    const honoCache = cache({
        cacheName: options.cacheName,
        cacheControl: CACHE_CONTROL,
        ...(options.vary ? { vary: options.vary } : {}),
        ...(options.keyGenerator ? { keyGenerator: options.keyGenerator } : {}),
        onCacheNotAvailable: false,
    });

    return async (c, next) => {
        const local = isLocalDevRequest(c);
        if ('caches' in globalThis && !local) {
            return honoCache(c, next);
        }
        await next();
        if (c.res.status === 200 && !c.res.headers.has('Cache-Control')) {
            // Avoid pinning browsers to a 10-minute HTML snapshot during local iteration.
            c.header('Cache-Control', local ? 'no-store' : CACHE_CONTROL);
        }
        if (varyHeader && !c.res.headers.has('Vary')) {
            c.header('Vary', varyHeader);
        }
    };
}

/**
 * The viewer's own calendar date — `today`/`7d` windows resolve against it.
 * Exported (with an injectable clock) so key-shape tests don't need a live
 * Workers Cache API, which vitest doesn't provide.
 */
export function viewerDayFor(req: Request, now: number = Date.now()): number {
    return dayFromMs(now, timeZoneFromRequest(req));
}

/** Exported so cache-key shape can be asserted without a Hono Context. */
export function pageCacheKeyFor(
    url: string,
    preview: boolean,
    viewerDay: number,
): string {
    return `${url}::preview=${preview ? '1' : '0'}::vday=${viewerDay}`;
}

/** Exported so cache-key shape can be asserted without a Hono Context. */
export function apiCacheKeyFor(url: string, viewerDay: number): string {
    return `${url}::vday=${viewerDay}`;
}

/**
 * Page HTML/Markdown negotiation also depends on link-preview bot UAs, but
 * keying the Workers Cache on the full User-Agent would fragment every browser
 * build. Bucket preview-bot vs not instead; Accept / Sec-Fetch-Mode stay in Vary.
 */
export const pageCache = createCacheMiddleware({
    cacheName: 'tokentally-pages',
    vary: [...AGENT_PAGE_VARY_HEADERS],
    keyGenerator: (c) => {
        const preview = isLinkPreviewBot(c.req.header('user-agent') ?? '');
        return pageCacheKeyFor(c.req.url, preview, viewerDayFor(c.req.raw));
    },
});

export const apiCache = createCacheMiddleware({
    cacheName: 'tokentally-api',
    // Reflects request Origin on ACAO; must not reuse another site's CORS headers.
    vary: ['Origin'],
    keyGenerator: (c) => apiCacheKeyFor(c.req.url, viewerDayFor(c.req.raw)),
});

/**
 * Dynamic profile OG PNGs — keyed by URL only, deliberately. The route below
 * resolves its 7d window in UTC rather than the requester's zone (crawlers and
 * reshared-link viewers have no meaningful "viewer timezone"), so the asset is
 * the same for everyone regardless of where they are; one shared cache entry
 * per profile is correct, not a missed vday key.
 */
export const ogCache = createCacheMiddleware({
    cacheName: 'tokentally-og',
});
