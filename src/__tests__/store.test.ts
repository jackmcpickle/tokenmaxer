import { describe, expect, it } from 'vitest';
import { upsertSessions } from '@/lib/store';
import type { SessionUsageInput } from '@/types';

interface Recorded {
    sql: string;
    args: unknown[];
}

function recordingDb(log: Recorded[][]): D1Database {
    return {
        prepare(sql: string) {
            const stmt = {
                sql,
                bind(...args: unknown[]) {
                    return { sql, args };
                },
            };
            return stmt as unknown as D1PreparedStatement;
        },
        async batch(stmts: unknown[]) {
            log.push(stmts as Recorded[]);
            return [];
        },
    } as unknown as D1Database;
}

function row(day: number, model = 'claude-opus-5'): SessionUsageInput {
    return {
        session_id: 'sess-1',
        model,
        day,
        started_at: 1_000,
        input_tokens: 1,
        output_tokens: 2,
        cache_read_tokens: 3,
        cache_creation_tokens: 4,
        reasoning_tokens: 5,
    };
}

describe('upsertSessions', () => {
    it('writes the day column on every insert', async () => {
        const log: Recorded[][] = [];
        await upsertSessions(
            recordingDb(log),
            'u1',
            'claude_code',
            [row(20260806), row(20260807)],
            42,
        );
        const inserts = log.flat().filter((s) => s.sql.includes('INSERT'));
        expect(inserts).toHaveLength(2);
        expect(inserts[0]?.sql).toContain('day');
        // Positional, not just membership: a transposed bind (e.g. day swapped
        // with input_tokens, or cache_read swapped with cache_creation) would
        // still contain every expected value, so only an exact ordered vector
        // catches it.
        expect(inserts[0]?.args).toEqual([
            'u1',
            'claude_code',
            'sess-1',
            'claude-opus-5',
            20260806,
            1,
            2,
            3,
            4,
            5,
            1_000,
            42,
        ]);
        expect(inserts[1]?.args[4]).toBe(20260807);
    });

    it('deletes a replaced session before inserting its rows', async () => {
        const log: Recorded[][] = [];
        await upsertSessions(
            recordingDb(log),
            'u1',
            'claude_code',
            [row(20260806), row(20260807)],
            42,
            ['sess-1'],
        );
        const flat = log.flat();
        const deleteIndex = flat.findIndex((s) => s.sql.startsWith('DELETE'));
        const firstInsert = flat.findIndex((s) => s.sql.includes('INSERT'));
        expect(deleteIndex).toBeGreaterThanOrEqual(0);
        expect(deleteIndex).toBeLessThan(firstInsert);
        expect(flat[deleteIndex]?.args).toEqual([
            'u1',
            'claude_code',
            'sess-1',
        ]);
    });

    it('issues no delete when nothing is being replaced', async () => {
        const log: Recorded[][] = [];
        await upsertSessions(
            recordingDb(log),
            'u1',
            'claude_code',
            [row(20260807)],
            42,
        );
        expect(log.flat().some((s) => s.sql.startsWith('DELETE'))).toBe(false);
    });

    it('sends a replacement that fits in one batch as ONE batch', async () => {
        const log: Recorded[][] = [];
        await upsertSessions(
            recordingDb(log),
            'u1',
            'claude_code',
            [row(20260806), row(20260807)],
            42,
            ['sess-1'],
        );
        // One batch is one D1 transaction: an interrupted request must not be
        // able to leave the session emptied, so delete and inserts ride
        // together.
        expect(log).toHaveLength(1);
        const only = log[0] ?? [];
        expect(only[0]?.sql.startsWith('DELETE')).toBe(true);
        expect(only.slice(1).every((s) => s.sql.includes('INSERT'))).toBe(true);
        expect(only).toHaveLength(3);
    });

    it('still deletes before any insert when the payload spans batches', async () => {
        const log: Recorded[][] = [];
        // 600 rows > DB_BATCH_CHUNK (500), so the single-batch path cannot be
        // taken and the chunked fallback runs.
        const many = Array.from({ length: 600 }, (_, i) =>
            row(20260807, `model-${i}`),
        );
        await upsertSessions(recordingDb(log), 'u1', 'claude_code', many, 42, [
            'sess-1',
        ]);
        expect(log.length).toBeGreaterThan(1);
        const flat = log.flat();
        const deleteIndex = flat.findIndex((s) => s.sql.startsWith('DELETE'));
        const firstInsert = flat.findIndex((s) => s.sql.includes('INSERT'));
        expect(deleteIndex).toBeGreaterThanOrEqual(0);
        expect(deleteIndex).toBeLessThan(firstInsert);
        expect(flat.filter((s) => s.sql.includes('INSERT'))).toHaveLength(600);
    });

    it('deletes each replaced session once, even when repeated', async () => {
        const log: Recorded[][] = [];
        await upsertSessions(
            recordingDb(log),
            'u1',
            'claude_code',
            [row(20260807)],
            42,
            ['sess-1', 'sess-1'],
        );
        expect(
            log.flat().filter((s) => s.sql.startsWith('DELETE')),
        ).toHaveLength(1);
    });
});
