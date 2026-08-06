import { describe, expect, it } from 'vitest';
import { shouldUseHono } from '@/server/dispatch';

function req(path: string, headers: Record<string, string> = {}): Request {
    return new Request(`https://tokenmaxer.quest${path}`, { headers });
}

describe('shouldUseHono', () => {
    it('keeps API, reporter, agent, invite, auth, and join on Hono', () => {
        expect(shouldUseHono(req('/api/health'))).toBe(true);
        expect(shouldUseHono(req('/tokentally.mjs'))).toBe(true);
        expect(shouldUseHono(req('/llms.txt'))).toBe(true);
        expect(shouldUseHono(req('/about.md'))).toBe(true);
        expect(shouldUseHono(req('/u/alice/og.png'))).toBe(true);
        expect(shouldUseHono(req('/invite?token=x'))).toBe(true);
        expect(shouldUseHono(req('/auth?s=x'))).toBe(true);
        expect(shouldUseHono(req('/h/foo/join'))).toBe(true);
    });

    it('sends browser HTML to TanStack Start', () => {
        const browser = {
            Accept: 'text/html',
            'Sec-Fetch-Mode': 'navigate',
        };
        expect(shouldUseHono(req('/', browser))).toBe(false);
        expect(shouldUseHono(req('/about', browser))).toBe(false);
        expect(shouldUseHono(req('/start', browser))).toBe(false);
        expect(shouldUseHono(req('/u/alice', browser))).toBe(false);
        expect(shouldUseHono(req('/h/foo', browser))).toBe(false);
    });

    it('keeps non-browser content negotiation on Hono', () => {
        expect(shouldUseHono(req('/', { Accept: '*/*' }))).toBe(true);
        expect(shouldUseHono(req('/about', { Accept: 'text/markdown' }))).toBe(
            true,
        );
    });
});
