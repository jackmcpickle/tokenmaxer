import { describe, expect, it } from 'vitest';
import { planBatches } from '../../reporter/src/api';
import type { ReporterRow } from '../../reporter/src/lib/types';

function row(session: string, day: number): ReporterRow {
    return {
        session_id: session,
        model: 'claude-opus-5',
        day,
        started_at: 1_000,
        input_tokens: 0,
        output_tokens: 1,
        cache_read_tokens: 0,
        cache_creation_tokens: 0,
        reasoning_tokens: 0,
    };
}

describe('planBatches', () => {
    it('claims each session in the first batch that carries it', () => {
        const batches = planBatches([row('a', 1), row('b', 1)], 10);
        expect(batches).toHaveLength(1);
        expect(batches[0]?.replaceSessions).toEqual(['a', 'b']);
    });

    it('keeps a session contiguous even when input interleaves sessions', () => {
        const batches = planBatches(
            [row('a', 1), row('b', 1), row('a', 2), row('b', 2)],
            2,
        );
        expect(batches).toHaveLength(2);
        expect(batches[0]?.rows.map((r) => r.session_id)).toEqual(['a', 'a']);
        expect(batches[1]?.rows.map((r) => r.session_id)).toEqual(['b', 'b']);
    });

    it('claims a split session only once, in its first batch', () => {
        const batches = planBatches([row('a', 1), row('a', 2), row('a', 3)], 2);
        expect(batches).toHaveLength(2);
        expect(batches[0]?.replaceSessions).toEqual(['a']);
        expect(batches[1]?.replaceSessions).toEqual([]);
    });

    it('numbers baseIndex against the posted order', () => {
        const batches = planBatches([row('a', 1), row('a', 2), row('b', 1)], 2);
        expect(batches.map((b) => b.baseIndex)).toEqual([0, 2]);
    });

    it('returns nothing for no rows', () => {
        expect(planBatches([], 10)).toEqual([]);
    });
});
