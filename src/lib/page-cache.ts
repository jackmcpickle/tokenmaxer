import type { Context, MiddlewareHandler } from 'hono';
import { cache } from 'hono/cache';
import {
    AGENT_PAGE_VARY_HEADERS,
    isLinkPreviewBot,
} from '@/lib/agent-markdown';
import { READ_CACHE_TTL_SECONDS } from '@/lib/read-cache';

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
            c.header(
                'Cache-Control',
                local ? 'no-store' : CACHE_CONTROL,
            );
        }
        if (varyHeader && !c.res.headers.has('Vary')) {
            c.header('Vary', varyHeader);
        }
    };
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
        const preview = isLinkPreviewBot(c.req.header('user-agent') ?? '')
            ? '1'
            : '0';
        return `${c.req.url}::preview=${preview}`;
    },
});

export const apiCache = createCacheMiddleware({
    cacheName: 'tokentally-api',
    // Reflects request Origin on ACAO; must not reuse another site's CORS headers.
    vary: ['Origin'],
});

/** Dynamic profile OG PNGs — keyed by URL only. */
export const ogCache = createCacheMiddleware({
    cacheName: 'tokentally-og',
});
