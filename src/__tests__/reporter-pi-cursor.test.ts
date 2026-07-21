import { afterEach, describe, expect, it, vi } from 'vitest';
// The reporter is a plain .mjs module; import its exported pure functions.
import {
    cursorFetchEvents,
    parseCursorEvents,
    parsePiRollout,
} from '../../reporter/tokentally.mjs';

// piDirs() is not bundle-exported (commands.ts consumes it internally), so the
// ~/.omp/agent/sessions root is covered by typecheck + source review only.

describe('parsePiRollout model_change attribution', () => {
    it('attributes usage to the model from the latest model_change', () => {
        const lines = [
            JSON.stringify({
                type: 'session',
                id: 'rec_0',
                sessionId: 'pi-mc-1',
                timestamp: '2026-07-19T07:00:00Z',
                cwd: '/w',
                version: 3,
            }),
            JSON.stringify({
                type: 'model_change',
                id: 'rec_1',
                parentId: 'rec_0',
                provider: 'anthropic',
                modelId: 'claude-sonnet-4-5',
                timestamp: '2026-07-19T07:00:01Z',
            }),
            // Assistant message without its own model -> model_change context.
            JSON.stringify({
                type: 'message',
                id: 'rec_2',
                parentId: 'rec_1',
                timestamp: '2026-07-19T07:00:05Z',
                message: {
                    role: 'assistant',
                    usage: {
                        input: 100,
                        output: 40,
                        cacheRead: 10,
                        cacheWrite: 2,
                    },
                },
            }),
            JSON.stringify({
                type: 'model_change',
                id: 'rec_3',
                parentId: 'rec_2',
                provider: 'openai-codex',
                modelId: 'gpt-5-codex',
                timestamp: '2026-07-19T07:01:00Z',
            }),
            JSON.stringify({
                type: 'message',
                id: 'rec_4',
                parentId: 'rec_3',
                timestamp: '2026-07-19T07:01:05Z',
                message: {
                    role: 'assistant',
                    usage: { input: 7, output: 3 },
                },
            }),
        ].join('\n');

        const parsed = parsePiRollout(lines);
        expect(parsed.session_id).toBe('pi-mc-1');
        expect(parsed.started_at).toBe(Date.parse('2026-07-19T07:00:00Z'));
        expect(parsed.models.get('claude-sonnet-4-5')).toMatchObject({
            input_tokens: 100,
            output_tokens: 40,
            cache_read_tokens: 10,
            cache_creation_tokens: 2,
        });
        expect(parsed.models.get('gpt-5-codex')).toMatchObject({
            input_tokens: 7,
            output_tokens: 3,
        });
    });

    it('lets a message-level model override the model_change context', () => {
        const lines = [
            JSON.stringify({
                type: 'model_change',
                id: 'rec_0',
                provider: 'anthropic',
                modelId: 'claude-sonnet-4-5',
                timestamp: '2026-07-19T08:00:00Z',
            }),
            JSON.stringify({
                type: 'message',
                id: 'rec_1',
                parentId: 'rec_0',
                message: {
                    role: 'assistant',
                    model: 'claude-opus-4-8',
                    usage: { input: 5, output: 6 },
                },
            }),
        ].join('\n');

        const parsed = parsePiRollout(lines);
        expect(parsed.models.has('claude-sonnet-4-5')).toBe(false);
        expect(parsed.models.get('claude-opus-4-8')).toMatchObject({
            input_tokens: 5,
            output_tokens: 6,
        });
    });

    it('lets an empty message model fall through to the entry model', () => {
        const parsed = parsePiRollout(
            JSON.stringify({
                type: 'message',
                id: 'rec_1',
                model: 'gpt-real',
                message: {
                    role: 'assistant',
                    model: '',
                    usage: { input: 9, output: 4 },
                },
            }),
        );
        expect(parsed.models.get('gpt-real')).toMatchObject({
            input_tokens: 9,
            output_tokens: 4,
        });
    });
});

describe('parsePiRollout id dedup', () => {
    it('keeps the last occurrence of a repeated id', () => {
        const lines = [
            JSON.stringify({
                type: 'message',
                id: 'rec_1',
                message: {
                    role: 'assistant',
                    model: 'kimi-k2',
                    usage: { input: 10, output: 1 },
                },
            }),
            // Same id replayed on another branch with amended counts.
            JSON.stringify({
                type: 'message',
                id: 'rec_1',
                message: {
                    role: 'assistant',
                    model: 'kimi-k2',
                    usage: { input: 12, output: 2 },
                },
            }),
        ].join('\n');

        const parsed = parsePiRollout(lines);
        expect(parsed.models.get('kimi-k2')).toMatchObject({
            input_tokens: 12,
            output_tokens: 2,
        });
    });

    it('always sums records without a usable id', () => {
        const usage = { input: 10, output: 5 };
        const message = { role: 'assistant', model: 'kimi-k2', usage };
        const lines = [
            // No id at all, twice.
            JSON.stringify({ type: 'message', message }),
            JSON.stringify({ type: 'message', message }),
            // Blank id: not an identity, must not dedupe against itself.
            JSON.stringify({ type: 'message', id: '   ', message }),
            JSON.stringify({ type: 'message', id: '   ', message }),
        ].join('\n');

        const parsed = parsePiRollout(lines);
        expect(parsed.models.get('kimi-k2')).toMatchObject({
            input_tokens: 40,
            output_tokens: 20,
        });
    });

    it('dedupes repeated oversized ids like any other id', () => {
        // A repeated record must never sum twice just because its id is
        // long — inflated totals are worse than an unbounded id set.
        const usage = { input: 100, output: 5 };
        const message = { role: 'assistant', model: 'kimi-k2', usage };
        const lines = [
            JSON.stringify({ type: 'message', id: 'x'.repeat(1100), message }),
            JSON.stringify({ type: 'message', id: 'x'.repeat(1100), message }),
        ].join('\n');

        const parsed = parsePiRollout(lines);
        expect(parsed.models.get('kimi-k2')).toMatchObject({
            input_tokens: 100,
            output_tokens: 5,
        });
    });
});

describe('cursorFetchEvents pagination', () => {
    interface CursorPage {
        totalUsageEventsCount?: number | string;
        usageEvents?: unknown[];
        usageEventsDisplay?: unknown[];
    }

    function stubFetchPages(pages: CursorPage[]): {
        bodies: Array<{ page: number; pageSize: number }>;
    } {
        const bodies: Array<{ page: number; pageSize: number }> = [];
        vi.stubGlobal(
            'fetch',
            vi.fn((_url: unknown, init: { body: string }) => {
                bodies.push(JSON.parse(init.body));
                const payload = pages[bodies.length - 1] ?? {
                    usageEventsDisplay: [],
                };
                return Promise.resolve({
                    ok: true,
                    json: () => Promise.resolve(payload),
                });
            }),
        );
        return { bodies };
    }

    function batch(count: number, offset = 0): unknown[] {
        return Array.from({ length: count }, (_, i) => ({
            timestamp: String(Date.UTC(2026, 6, 19) + offset + i),
            model: 'gpt-5',
            tokenUsage: { inputTokens: 1, outputTokens: 1 },
        }));
    }

    afterEach(() => {
        vi.unstubAllGlobals();
    });

    it('does not stop at the reported total — only an empty page proves completion', async () => {
        // Raw count can hit the total early when Cursor repeats rows at page
        // boundaries, so reaching it must not end pagination.
        const { bodies } = stubFetchPages([
            { totalUsageEventsCount: 1000, usageEventsDisplay: batch(1000) },
            { totalUsageEventsCount: '1000', usageEventsDisplay: [] },
        ]);

        const events = await cursorFetchEvents('user::jwt', 0);
        expect(events).toHaveLength(1000);
        expect(bodies).toHaveLength(2);
        expect(bodies[1]?.page).toBe(2);
    });

    it('aborts when completion arrives before the reported total', async () => {
        // A short page ends pagination, but a window that never reached the
        // authoritative total must not be published — day rows would replace
        // fuller stored ones.
        const { bodies } = stubFetchPages([
            { totalUsageEventsCount: 2000, usageEventsDisplay: batch(500) },
        ]);

        const events = await cursorFetchEvents('user::jwt', 0);
        expect(events).toBeNull();
        expect(bodies).toHaveLength(1);
    });

    it('drops boundary duplicates when the raw count exceeds the total', async () => {
        const first = batch(1000);
        const dupe = first[first.length - 1];
        const { bodies } = stubFetchPages([
            { totalUsageEventsCount: 1002, usageEventsDisplay: first },
            {
                totalUsageEventsCount: 1002,
                usageEventsDisplay: [dupe, ...batch(2, 5000)],
            },
        ]);

        const events = await cursorFetchEvents('user::jwt', 0);
        expect(events).toHaveLength(1002);
        expect(bodies).toHaveLength(2);
    });

    it('completes on a short page that satisfies the total', async () => {
        const { bodies } = stubFetchPages([
            { totalUsageEventsCount: 3, usageEventsDisplay: batch(3) },
        ]);

        const events = await cursorFetchEvents('user::jwt', 0);
        expect(events).toHaveLength(3);
        expect(bodies).toHaveLength(1);
    });

    it('falls back to the short-page rule when no total is reported', async () => {
        // Legacy responses use `usageEvents` and omit the total count.
        const { bodies } = stubFetchPages([{ usageEvents: batch(3) }]);

        const events = await cursorFetchEvents('user::jwt', 0);
        expect(events).toHaveLength(3);
        expect(bodies).toHaveLength(1);
    });

    it('treats a blank string total as absent, not zero', async () => {
        // Number('') === 0 — an authoritative zero would fail every
        // non-empty window forever.
        const { bodies } = stubFetchPages([
            { totalUsageEventsCount: '', usageEventsDisplay: batch(3) },
        ]);

        const events = await cursorFetchEvents('user::jwt', 0);
        expect(events).toHaveLength(3);
        expect(bodies).toHaveLength(1);
    });

    it('aborts when the reported total changes between pages', async () => {
        // A moving total means rows shifted across pages mid-fetch; the
        // surplus-based reconciliation can no longer prove duplicates.
        const { bodies } = stubFetchPages([
            { totalUsageEventsCount: 1500, usageEventsDisplay: batch(1000) },
            {
                totalUsageEventsCount: 1501,
                usageEventsDisplay: batch(501, 1000),
            },
        ]);

        const events = await cursorFetchEvents('user::jwt', 0);
        expect(events).toBeNull();
        expect(bodies).toHaveLength(2);
    });

    it('freezes the query window for the whole pagination run', async () => {
        const { bodies } = stubFetchPages([
            { totalUsageEventsCount: 1003, usageEventsDisplay: batch(1000) },
            {
                totalUsageEventsCount: 1003,
                usageEventsDisplay: batch(3, 2000),
            },
        ]);

        await cursorFetchEvents('user::jwt', 0);
        expect(bodies).toHaveLength(2);
        const first = bodies[0] as { endDate?: string };
        const second = bodies[1] as { endDate?: string };
        expect(first.endDate).toBeDefined();
        expect(second.endDate).toBe(first.endDate);
    });
});

describe('parseCursorEvents field mapping', () => {
    const DAY = Date.UTC(2026, 6, 19); // 2026-07-19T00:00:00Z

    it('accepts string-encoded token counts', () => {
        const rows = parseCursorEvents([
            {
                timestamp: String(DAY + 1000),
                model: 'claude-4.5-sonnet',
                tokenUsage: {
                    inputTokens: '11',
                    outputTokens: '22',
                    cacheReadTokens: '33',
                    cacheWriteTokens: '4',
                },
            },
        ]);
        expect(rows).toHaveLength(1);
        expect(rows[0]).toMatchObject({
            session_id: 'cursor-2026-07-19',
            model: 'claude-4.5-sonnet',
            input_tokens: 11,
            output_tokens: 22,
            cache_read_tokens: 33,
            cache_creation_tokens: 4,
            reasoning_tokens: 0,
        });
    });

    it('keeps a zero-usage day row so stale server days can be repaired', () => {
        // A day whose events were all zeroed (aborted/refunded) must still
        // upload a zero-total row — the replace-upsert can only correct a
        // stale non-zero day it receives.
        const rows = parseCursorEvents([
            {
                timestamp: String(DAY + 1000),
                model: 'gpt-5',
                tokenUsage: {
                    inputTokens: 0,
                    outputTokens: 0,
                    cacheReadTokens: 0,
                    cacheWriteTokens: 0,
                    totalCents: 1.5,
                },
            },
        ]);
        expect(rows).toHaveLength(1);
        expect(rows[0]).toMatchObject({
            session_id: 'cursor-2026-07-19',
            model: 'gpt-5',
            input_tokens: 0,
            output_tokens: 0,
        });
    });

    it('aborts on a network-level fetch rejection instead of throwing', async () => {
        vi.stubGlobal(
            'fetch',
            vi.fn(() => Promise.reject(new TypeError('fetch failed'))),
        );
        const events = await cursorFetchEvents('user::jwt', 0);
        expect(events).toBeNull();
        vi.unstubAllGlobals();
    });
});
