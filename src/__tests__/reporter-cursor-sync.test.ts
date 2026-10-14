import { afterEach, describe, expect, it, vi } from 'vitest';
import { cursorSync } from '../../reporter/src/commands';

// cursorSync posts one upload per source: Grok Bot turns share the Cursor
// dashboard feed but are their own product, and each source's replace must
// clear only its own day session.
describe('cursorSync source split', () => {
    const DAY = Date.UTC(2026, 6, 19);
    const usage = { inputTokens: 1, outputTokens: 2 };

    afterEach(() => {
        vi.unstubAllGlobals();
    });

    function stubFetch(events: unknown[]): {
        posts: Array<{ url: string; body: Record<string, unknown> }>;
    } {
        const posts: Array<{ url: string; body: Record<string, unknown> }> = [];
        vi.stubGlobal(
            'fetch',
            vi.fn((url: string, init: { body: string }) => {
                if (url.startsWith('https://cursor.com/')) {
                    return Promise.resolve({
                        ok: true,
                        json: () =>
                            Promise.resolve({
                                totalUsageEventsCount: events.length,
                                usageEventsDisplay: events,
                            }),
                    });
                }
                const body = JSON.parse(init.body) as Record<string, unknown>;
                posts.push({ url, body });
                return Promise.resolve({
                    ok: true,
                    json: () =>
                        Promise.resolve({
                            accepted: (body.sessions as unknown[]).length,
                            rejected: [],
                        }),
                });
            }),
        );
        return { posts };
    }

    const cfg = {
        apiBase: 'https://api.example',
        token: 'tt_test',
        // Fallback for machines without a Cursor login; never leaves the
        // stubbed fetch either way.
        cursorCookie: 'user::jwt',
    };

    it('uploads Cursor and Grok Bot rows as separate sources', async () => {
        const { posts } = stubFetch([
            {
                timestamp: String(DAY + 1000),
                model: 'composer-2.5-fast',
                tokenUsage: usage,
            },
            {
                timestamp: String(DAY + 2000),
                model: 'grok-bot-default',
                tokenUsage: usage,
            },
        ]);
        const result = await cursorSync(cfg, { sinceMs: DAY });
        expect(result).toEqual({ problems: 0, aborted: false });
        expect(posts.map((p) => p.body.source)).toEqual(['cursor', 'grok_bot']);
        expect(posts[0]?.body.replace_sessions).toEqual(['cursor-2026-07-19']);
        expect(posts[1]?.body.replace_sessions).toEqual([
            'grok-bot-2026-07-19',
        ]);
        expect(posts[1]?.body.sessions).toEqual([
            expect.objectContaining({
                session_id: 'grok-bot-2026-07-19',
                model: 'grok-bot-default',
                input_tokens: 1,
                output_tokens: 2,
            }),
        ]);
    });

    it('skips the Grok Bot upload when the window has none', async () => {
        const { posts } = stubFetch([
            {
                timestamp: String(DAY + 1000),
                model: 'composer-2.5-fast',
                tokenUsage: usage,
            },
        ]);
        await cursorSync(cfg, { sinceMs: DAY });
        expect(posts.map((p) => p.body.source)).toEqual(['cursor']);
    });
});
