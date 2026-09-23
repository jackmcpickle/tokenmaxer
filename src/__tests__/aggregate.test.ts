import { describe, expect, it } from 'vitest';
import {
    getLeaderboard,
    getProfileWindowTotals,
    grandTotal,
    metricValue,
    type Totals,
} from '@/lib/aggregate';

const T: Totals = {
    input_tokens: 100,
    output_tokens: 200,
    cache_read_tokens: 1000,
    cache_creation_tokens: 50,
    reasoning_tokens: 10,
    cost: 4.2,
};

describe('metricValue', () => {
    it('grand total sums every token category', () => {
        expect(grandTotal(T)).toBe(1360);
        expect(metricValue(T, 'total')).toBe(1360);
    });
    it('input is input tokens only', () => {
        expect(metricValue(T, 'input')).toBe(100);
    });
    it('output is output only', () => {
        expect(metricValue(T, 'output')).toBe(200);
    });
    it('cached is cache read + cache creation', () => {
        expect(metricValue(T, 'cached')).toBe(1050);
    });
    it('cost is the estimated dollars', () => {
        expect(metricValue(T, 'cost')).toBe(4.2);
    });
});

interface Captured {
    sql: string;
    binds: unknown[];
}

function capturingDb(
    captured: Captured[],
    results: unknown[] = [],
): D1Database {
    return {
        prepare(sql: string) {
            const self = {
                bind(...binds: unknown[]) {
                    captured.push({ sql, binds });
                    return self;
                },
                async all() {
                    return { results };
                },
                async first() {
                    return { id: 'u1', username: 'tester', ahead: 0 };
                },
            };
            return self as unknown as D1PreparedStatement;
        },
    } as unknown as D1Database;
}

describe('getLeaderboard day filtering', () => {
    it('filters on day, not started_at', async () => {
        const captured: Captured[] = [];
        await getLeaderboard(capturingDb(captured), {
            window: '7d',
            startDay: 20260801,
            metric: 'total',
        });
        expect(captured[0]?.sql).toContain('su.day >= ?');
        expect(captured[0]?.sql).not.toContain('started_at >=');
        expect(captured[0]?.binds[0]).toBe(20260801);
    });

    it('all-time binds a zero lower bound', async () => {
        const captured: Captured[] = [];
        await getLeaderboard(capturingDb(captured), {
            window: 'all',
            startDay: 0,
            metric: 'total',
        });
        expect(captured[0]?.binds[0]).toBe(0);
    });
});

describe('getProfileWindowTotals day filtering', () => {
    it('binds the day bound after the user id', async () => {
        const captured: Captured[] = [];
        await getProfileWindowTotals(capturingDb(captured), 'tester', 20260807);
        const usage = captured.find((c) => c.sql.includes('su.day >= ?'));
        expect(usage?.binds).toEqual(['u1', 20260807]);
    });
});
