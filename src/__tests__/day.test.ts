import { describe, expect, it } from 'vitest';
import {
    dayFromMs,
    shiftDay,
    timeZoneFromRequest,
    windowStartDay,
} from '@/lib/day';

const NOW = Date.parse('2026-08-07T09:54:00Z');

describe('dayFromMs', () => {
    it('reads the calendar date in the given zone', () => {
        expect(dayFromMs(NOW, 'UTC')).toBe(20260807);
        // UTC+9:30 — already the 7th, 19:24 local.
        expect(dayFromMs(NOW, 'Australia/Adelaide')).toBe(20260807);
        // UTC-7 — 02:54 local, still the 7th.
        expect(dayFromMs(NOW, 'America/Los_Angeles')).toBe(20260807);
        // Four hours earlier is 21:00 on the 6th in Los Angeles.
        expect(
            dayFromMs(
                Date.parse('2026-08-07T04:00:00Z'),
                'America/Los_Angeles',
            ),
        ).toBe(20260806);
    });

    it('falls back to UTC for an unknown zone', () => {
        expect(dayFromMs(NOW, 'Not/AZone')).toBe(20260807);
    });

    it('returns 0 for non-finite input', () => {
        expect(dayFromMs(Number.NaN, 'UTC')).toBe(0);
    });
});

describe('shiftDay', () => {
    it('walks backwards across a month boundary', () => {
        expect(shiftDay(20260801, -1)).toBe(20260731);
        expect(shiftDay(20260807, -6)).toBe(20260801);
    });
    it('walks backwards across a year boundary', () => {
        expect(shiftDay(20260101, -1)).toBe(20251231);
    });
    it('handles leap days', () => {
        expect(shiftDay(20280301, -1)).toBe(20280229);
    });
    it('walks forwards too', () => {
        expect(shiftDay(20260228, 1)).toBe(20260301);
    });
});

describe('windowStartDay', () => {
    it('today is the viewer calendar date', () => {
        expect(windowStartDay('today', NOW, 'UTC')).toBe(20260807);
    });
    it('7d covers 7 calendar days including today', () => {
        expect(windowStartDay('7d', NOW, 'UTC')).toBe(20260801);
    });
    it('30d covers 30 calendar days including today', () => {
        expect(windowStartDay('30d', NOW, 'UTC')).toBe(20260709);
    });
    it('all time has no lower bound', () => {
        expect(windowStartDay('all', NOW, 'UTC')).toBe(0);
    });
    it('uses the viewer zone, so a zone behind UTC gets an earlier date', () => {
        const earlyUtc = Date.parse('2026-08-07T04:00:00Z');
        expect(windowStartDay('today', earlyUtc, 'America/Los_Angeles')).toBe(
            20260806,
        );
    });
});

describe('timeZoneFromRequest', () => {
    it('reads the Cloudflare timezone', () => {
        const req = new Request('https://tokenmaxer.quest/');
        Object.defineProperty(req, 'cf', {
            value: { timezone: 'Australia/Adelaide' },
        });
        expect(timeZoneFromRequest(req)).toBe('Australia/Adelaide');
    });
    it('defaults to UTC when absent or not a string', () => {
        expect(
            timeZoneFromRequest(new Request('https://tokenmaxer.quest/')),
        ).toBe('UTC');
    });
});
