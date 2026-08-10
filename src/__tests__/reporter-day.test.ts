// Pinned so every day expectation below is a literal, verifiable date. UTC+9:30
// also makes the local/UTC divergence this feature exists for observable.
process.env.TZ = 'Australia/Adelaide';

import { describe, expect, it } from 'vitest';
import { localDay } from '../../reporter/src/lib/day';

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
