// Pinned so every day expectation below is a literal, verifiable date. UTC+9:30
// also makes the local/UTC divergence this feature exists for observable.
process.env.TZ = 'Australia/Adelaide';

import { describe, expect, it } from 'vitest';
import { parseClaudeTranscript } from '../../reporter/src/agents/claude';
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
