import { isBrowserRequest } from '@/lib/agent-markdown';

/** Pathname matches any predicate (used to keep cyclomatic complexity low). */
function matches(
    pathname: string,
    checks: ReadonlyArray<(p: string) => boolean>,
): boolean {
    return checks.some((check) => check(pathname));
}

const ALWAYS_HONO: ReadonlyArray<(p: string) => boolean> = [
    (p) => p === '/api' || p.startsWith('/api/'),
    (p) => p === '/tokentally.mjs',
    (p) => p === '/favicon.ico',
    (p) => p.startsWith('/llms'),
    (p) => p.endsWith('.md'),
    (p) => /^\/u\/[^/]+\/og\.png$/u.test(p),
    (p) => p === '/invite',
    (p) => p === '/auth',
    (p) => /^\/h\/[^/]+\/join$/u.test(p),
];

const AGENT_MARKDOWN_HONO: ReadonlyArray<(p: string) => boolean> = [
    (p) => p === '/',
    (p) => p === '/about',
    (p) => p === '/start',
    (p) => p === '/privacy',
    (p) => p === '/pricing',
    (p) => /^\/u\/[^/]+$/u.test(p),
];

/**
 * Paths that stay on the Hono app (API, agent markdown, OG, reporter, cookie
 * mutations). Browser HTML is served by TanStack Start.
 */
export function shouldUseHono(request: Request): boolean {
    const { pathname } = new URL(request.url);

    if (matches(pathname, ALWAYS_HONO)) return true;

    // Agents/curl still get Markdown from Hono on content URLs.
    if (!isBrowserRequest(request) && matches(pathname, AGENT_MARKDOWN_HONO)) {
        return true;
    }

    return false;
}
