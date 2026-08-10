import { describe, expect, it } from 'vitest';
import {
    isSyntheticModel,
    sessionIdFromPath,
    toRows,
} from '../../reporter/src/lib/rows';
import {
    accumulateModelDayUsage,
    emptyTotals,
    singleDayModels,
} from '../../reporter/src/lib/totals';
import type { ReporterTotals } from '../../reporter/src/lib/types';

describe('reporter shared rows helpers', () => {
    it('sessionIdFromPath strips .jsonl and rollout- prefix', () => {
        expect(sessionIdFromPath('/tmp/rollout-2026-07-18-abc.jsonl')).toBe(
            '2026-07-18-abc',
        );
        expect(sessionIdFromPath('sess-1.jsonl')).toBe('sess-1');
    });

    it('isSyntheticModel treats angle-bracket synthetic labels as synthetic', () => {
        expect(isSyntheticModel('<synthetic>')).toBe(true);
        expect(isSyntheticModel('synthetic')).toBe(true);
        expect(isSyntheticModel('claude-opus')).toBe(false);
        expect(isSyntheticModel(1)).toBe(false);
    });

    it('toRows emits one row per (model, day) and skips synthetic models', () => {
        const models = new Map([
            [
                'claude-opus',
                new Map([
                    [
                        20260806,
                        {
                            ...emptyTotals(),
                            input_tokens: 10,
                            output_tokens: 20,
                        },
                    ],
                    [20260807, { ...emptyTotals(), output_tokens: 5 }],
                ]),
            ],
            ['<synthetic>', new Map([[20260807, emptyTotals()]])],
        ]);
        const rows = toRows(
            { session_id: 'sess-1', started_at: 1_000, models },
            '/tmp/sess-1.jsonl',
        );
        expect(rows).toHaveLength(2);
        expect(rows.map((r) => r.day)).toEqual([20260806, 20260807]);
        expect(rows.every((r) => r.session_id === 'sess-1')).toBe(true);
        // started_at stays the SESSION start on every row; `day` carries time.
        expect(rows.every((r) => r.started_at === 1_000)).toBe(true);
        expect(rows[0]?.input_tokens).toBe(10);
        expect(rows[1]?.output_tokens).toBe(5);
    });

    it('toRows falls back to path-derived session id and Date.now when missing', () => {
        const before = Date.now();
        const rows = toRows(
            {
                session_id: null,
                started_at: null,
                models: new Map([['m', new Map([[20260807, emptyTotals()]])]]),
            },
            '/tmp/rollout-fallback-id.jsonl',
        );
        const after = Date.now();
        expect(rows).toHaveLength(1);
        expect(rows[0]?.session_id).toBe('fallback-id');
        expect(rows[0]?.started_at).toBeGreaterThanOrEqual(before);
        expect(rows[0]?.started_at).toBeLessThanOrEqual(after);
    });

    it('accumulateModelDayUsage keeps days and models separate', () => {
        const models = new Map<string, Map<number, ReporterTotals>>();
        accumulateModelDayUsage(models, 'opus', 20260807, {
            ...emptyTotals(),
            output_tokens: 3,
        });
        accumulateModelDayUsage(models, 'opus', 20260807, {
            ...emptyTotals(),
            output_tokens: 4,
        });
        accumulateModelDayUsage(models, 'opus', 20260808, {
            ...emptyTotals(),
            output_tokens: 5,
        });
        accumulateModelDayUsage(models, 'sonnet', 20260807, {
            ...emptyTotals(),
            output_tokens: 6,
        });
        expect(models.get('opus')?.get(20260807)?.output_tokens).toBe(7);
        expect(models.get('opus')?.get(20260808)?.output_tokens).toBe(5);
        expect(models.get('sonnet')?.get(20260807)?.output_tokens).toBe(6);
    });

    it('singleDayModels puts every model total on one day', () => {
        const flat = new Map([['opus', { ...emptyTotals(), input_tokens: 9 }]]);
        const byDay = singleDayModels(flat, 20260807);
        expect(byDay.get('opus')?.get(20260807)?.input_tokens).toBe(9);
    });
});
