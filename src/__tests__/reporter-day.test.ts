// Pinned so every day expectation below is a literal, verifiable date. UTC+9:30
// also makes the local/UTC divergence this feature exists for observable.
process.env.TZ = 'Australia/Adelaide';

import { describe, expect, it } from 'vitest';
import { parseClaudeTranscript } from '../../reporter/src/agents/claude';
import { parseCodexRollout } from '../../reporter/src/agents/codex-engine';
import { localDay } from '../../reporter/src/lib/day';

function claudeLine(iso: string, output: number): string {
    return JSON.stringify({
        type: 'assistant',
        sessionId: 'sess-1',
        timestamp: iso,
        requestId: `req-${iso}-${output}`,
        message: {
            id: `msg-${iso}-${output}`,
            model: 'claude-opus-5',
            usage: { input_tokens: 1, output_tokens: output },
        },
    });
}

describe('parseClaudeTranscript day buckets', () => {
    it('splits one session across the local days it spans', () => {
        const dayOne = new Date(2026, 7, 6, 22, 0).toISOString();
        const dayTwo = new Date(2026, 7, 7, 2, 0).toISOString();
        const parsed = parseClaudeTranscript(
            [claudeLine(dayOne, 10), claudeLine(dayTwo, 20)].join('\n'),
        );
        const byDay = parsed.models.get('claude-opus-5');
        expect(byDay?.get(20260806)?.output_tokens).toBe(10);
        expect(byDay?.get(20260807)?.output_tokens).toBe(20);
    });

    it('falls back to the session start day when a line has no timestamp', () => {
        const line = JSON.stringify({
            type: 'assistant',
            sessionId: 'sess-1',
            requestId: 'req-1',
            message: {
                id: 'msg-1',
                model: 'claude-opus-5',
                usage: { input_tokens: 1, output_tokens: 7 },
            },
        });
        const parsed = parseClaudeTranscript(line, {
            fallbackStartedAt: new Date(2026, 7, 7, 12, 0).getTime(),
        });
        expect(
            parsed.models.get('claude-opus-5')?.get(20260807)?.output_tokens,
        ).toBe(7);
    });

    it('still dedupes streamed chunks that share a message key', () => {
        const iso = new Date(2026, 7, 7, 9, 0).toISOString();
        const partial = JSON.stringify({
            type: 'assistant',
            sessionId: 'sess-1',
            timestamp: iso,
            requestId: 'req-1',
            message: {
                id: 'msg-1',
                model: 'claude-opus-5',
                usage: { input_tokens: 1, output_tokens: 5 },
            },
        });
        const final = JSON.stringify({
            type: 'assistant',
            sessionId: 'sess-1',
            timestamp: iso,
            requestId: 'req-1',
            message: {
                id: 'msg-1',
                model: 'claude-opus-5',
                usage: { input_tokens: 1, output_tokens: 40 },
            },
        });
        const parsed = parseClaudeTranscript([partial, final].join('\n'));
        expect(
            parsed.models.get('claude-opus-5')?.get(20260807)?.output_tokens,
        ).toBe(40);
    });
});

function codexTokenCount(iso: string, totalOutput: number): string {
    return JSON.stringify({
        type: 'event_msg',
        timestamp: iso,
        payload: {
            type: 'token_count',
            info: {
                model: 'gpt-5.2-codex',
                total_token_usage: {
                    input_tokens: 10,
                    output_tokens: totalOutput,
                    cached_input_tokens: 0,
                    cache_write_input_tokens: 0,
                    reasoning_output_tokens: 0,
                },
            },
        },
    });
}

describe('parseCodexRollout day buckets', () => {
    it("books each turn's delta to the day the turn happened", () => {
        const meta = JSON.stringify({
            type: 'session_meta',
            timestamp: new Date(2026, 7, 6, 21, 0).toISOString(),
            payload: { id: 'codex-1', model: 'gpt-5.2-codex' },
        });
        const parsed = parseCodexRollout(
            [
                meta,
                codexTokenCount(new Date(2026, 7, 6, 22, 0).toISOString(), 100),
                codexTokenCount(new Date(2026, 7, 7, 1, 0).toISOString(), 250),
            ].join('\n'),
        );
        const byDay = parsed.models.get('gpt-5.2-codex');
        // Cumulative totals: day one counts 100, day two the 150 delta.
        expect(byDay?.get(20260806)?.output_tokens).toBe(100);
        expect(byDay?.get(20260807)?.output_tokens).toBe(150);
        // input_tokens never changes between the two cumulative readings, so
        // day two's delta for it is 0 — proves the whole vector is delta'd,
        // not just output_tokens.
        expect(byDay?.get(20260807)?.input_tokens).toBe(0);
    });

    it('uses the session start day when a token_count has no timestamp', () => {
        const line = JSON.stringify({
            type: 'event_msg',
            payload: {
                type: 'token_count',
                info: {
                    model: 'gpt-5.2-codex',
                    last_token_usage: {
                        input_tokens: 1,
                        output_tokens: 9,
                        cached_input_tokens: 0,
                        cache_write_input_tokens: 0,
                        reasoning_output_tokens: 0,
                    },
                },
            },
        });
        const parsed = parseCodexRollout(line, {
            fallbackStartedAt: new Date(2026, 7, 7, 8, 0).getTime(),
        });
        expect(
            parsed.models.get('gpt-5.2-codex')?.get(20260807)?.output_tokens,
        ).toBe(9);
    });

    it('resolves the session start day from the file, not the mtime fallback, for a timestamp-less token_count that precedes the first timestamped line', () => {
        const meta = JSON.stringify({
            type: 'session_meta',
            payload: { id: 'codex-3', model: 'gpt-5.2-codex' },
        });
        const untimestamped = JSON.stringify({
            type: 'event_msg',
            payload: {
                type: 'token_count',
                info: {
                    model: 'gpt-5.2-codex',
                    total_token_usage: {
                        input_tokens: 10,
                        output_tokens: 100,
                        cached_input_tokens: 0,
                        cache_write_input_tokens: 0,
                        reasoning_output_tokens: 0,
                    },
                },
            },
        });
        const parsed = parseCodexRollout(
            [
                meta,
                untimestamped,
                codexTokenCount(new Date(2026, 7, 10, 9, 0).toISOString(), 250),
            ].join('\n'),
            // The file's mtime is a third, unrelated day; it must never be
            // used once the file itself supplies a real timestamp.
            { fallbackStartedAt: new Date(2026, 7, 1, 9, 0).getTime() },
        );
        const byDay = parsed.models.get('gpt-5.2-codex');
        // The timestamp-less line's delta (100) joins the session start day
        // — resolved from the file's first timestamped line, 10 Aug — with
        // the second delta (150), landing on 20260810 as 250 total. It must
        // not land on 1 Aug (the mtime fallback).
        expect(byDay?.get(20260801)).toBeUndefined();
        expect(byDay?.get(20260810)?.output_tokens).toBe(250);
        expect([...(byDay?.keys() ?? [])]).not.toContain(0);
    });

    it("books a dropped subagent-replay placeholder to the replayed line's own day, not the owned suffix's day", () => {
        const subagentMeta = JSON.stringify({
            type: 'session_meta',
            timestamp: new Date(2026, 7, 6, 21, 0).toISOString(),
            payload: {
                id: 'child-1',
                source: { subagent: { thread_spawn: { depth: 1 } } },
            },
        });
        const embeddedParentMeta = JSON.stringify({
            type: 'session_meta',
            timestamp: new Date(2026, 7, 6, 21, 0).toISOString(),
            payload: { id: 'parent-1', model: 'gpt-5.2-codex' },
        });
        function tokenCount(iso: string, total: object, last?: object) {
            const info: Record<string, unknown> = { total_token_usage: total };
            if (last) info.last_token_usage = last;
            return JSON.stringify({
                type: 'event_msg',
                timestamp: iso,
                payload: { type: 'token_count', info },
            });
        }
        const copiedPrefixTokenCount = tokenCount(
            new Date(2026, 7, 6, 22, 0).toISOString(), // day A: 6 Aug
            {
                input_tokens: 100,
                output_tokens: 80,
                cached_input_tokens: 10,
                cache_write_input_tokens: 0,
                reasoning_output_tokens: 2,
            },
        );
        const turnContext = JSON.stringify({
            type: 'turn_context',
            timestamp: new Date(2026, 7, 7, 1, 0).toISOString(),
            payload: { model: 'gpt-5.2-codex' },
        });
        const triggerTurn = JSON.stringify({
            type: 'inter_agent_communication_metadata',
            timestamp: new Date(2026, 7, 7, 1, 0).toISOString(),
            payload: { trigger_turn: true },
        });
        const ownedSuffixTokenCount = tokenCount(
            new Date(2026, 7, 7, 1, 5).toISOString(), // day B: 7 Aug
            {
                input_tokens: 130,
                output_tokens: 95,
                cached_input_tokens: 10,
                cache_write_input_tokens: 0,
                reasoning_output_tokens: 2,
            },
            {
                input_tokens: 30,
                output_tokens: 15,
                cached_input_tokens: 0,
                cache_write_input_tokens: 0,
                reasoning_output_tokens: 0,
            },
        );
        const parsed = parseCodexRollout(
            [
                subagentMeta,
                embeddedParentMeta,
                copiedPrefixTokenCount,
                turnContext,
                triggerTurn,
                ownedSuffixTokenCount,
            ].join('\n'),
        );
        expect(parsed.parent_id).toBe('parent-1');
        // The dropped copied-prefix event still pins a zero-total placeholder
        // row (for overwrite repair), but on the day IT happened (6 Aug),
        // not the owned suffix's day (7 Aug).
        const unknown = parsed.models.get('unknown');
        expect(unknown?.get(20260806)?.input_tokens).toBe(0);
        expect(unknown?.get(20260807)).toBeUndefined();
        const gpt = parsed.models.get('gpt-5.2-codex');
        expect(gpt?.get(20260807)?.input_tokens).toBe(30);
        expect(gpt?.get(20260807)?.output_tokens).toBe(15);
    });
});

describe('localDay', () => {
    it('returns the local calendar date as YYYYMMDD', () => {
        expect(localDay(new Date(2026, 7, 7, 9, 17).getTime())).toBe(20260807);
    });

    it('rolls over at local midnight, not UTC midnight', () => {
        expect(localDay(new Date(2026, 7, 6, 23, 59, 59).getTime())).toBe(
            20260806,
        );
        expect(localDay(new Date(2026, 7, 7, 0, 0, 0).getTime())).toBe(
            20260807,
        );
    });

    it('zero-pads month and day into the integer', () => {
        expect(localDay(new Date(2026, 0, 5, 12, 0).getTime())).toBe(20260105);
    });

    it('returns 0 for missing or non-finite timestamps', () => {
        expect(localDay(null)).toBe(0);
        expect(localDay(undefined)).toBe(0);
        expect(localDay(Number.NaN)).toBe(0);
        expect(localDay(Number.POSITIVE_INFINITY)).toBe(0);
    });
});
