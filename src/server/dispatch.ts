import { isBrowserRequest } from '@/lib/agent-markdown';

/**
 * Paths that stay on the Hono app (API, agent markdown, OG, reporter, cookie
 * mutations). Browser HTML is served by TanStack Start.
 */
export function shouldUseHono(request: Request): boolean {
    const { pathname } = new URL(request.url);

    if (pathname === '/api' || pathname.startsWith('/api/')) return true;
    if (pathname === '/tokentally.mjs') return true;
    if (pathname === '/favicon.ico') return true;
    if (pathname.startsWith('/llms')) return true;
    if (pathname.endsWith('.md')) return true;
    if (/^\/u\/[^/]+\/og\.png$/u.test(pathname)) return true;
    if (pathname === '/invite') return true;
    if (pathname === '/auth') return true;
    if (/^\/h\/[^/]+\/join$/u.test(pathname)) return true;

    // Agents/curl still get Markdown from Hono on content URLs.
    if (!isBrowserRequest(request)) {
        if (
            pathname === '/' ||
            pathname === '/about' ||
            pathname === '/start' ||
            pathname === '/privacy' ||
            pathname === '/pricing' ||
            /^\/u\/[^/]+$/u.test(pathname)
        ) {
            return true;
        }
    }

    return false;
}
