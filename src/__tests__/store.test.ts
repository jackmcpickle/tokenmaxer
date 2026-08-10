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
        expect(inserts[0]?.args).toContain(20260806);
        expect(inserts[1]?.args).toContain(20260807);
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
