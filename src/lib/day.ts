import type { TimeWindow } from '@/types';

/**
 * Calendar dates as YYYYMMDD integers. Usage rows carry the REPORTER's local
 * date; the server only ever computes a date to pick a window's lower bound
 * (from the viewer's zone) or to seed a legacy row that arrived without one.
 */
const DATE_PARTS = {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
} as const;

// The ECMAScript maximum time value; beyond it `new Date(ms)` is an Invalid
// Date and Intl throws RangeError rather than formatting. Callers get the same
// "unknown day" sentinel as a non-finite input. Exported so `validate.ts` can
// reject the same range at the source instead of keeping its own copy that
// could drift out of sync.
export const MAX_TIME_VALUE = 8_640_000_000_000_000;

const UTC_FORMATTER = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'UTC',
    ...DATE_PARTS,
});

const formatters = new Map<string, Intl.DateTimeFormat>([
    ['UTC', UTC_FORMATTER],
]);

function formatterFor(timeZone: string): Intl.DateTimeFormat {
    const cached = formatters.get(timeZone);
    if (cached) return cached;
    let fmt: Intl.DateTimeFormat;
    try {
        fmt = new Intl.DateTimeFormat('en-CA', { timeZone, ...DATE_PARTS });
    } catch {
        // An unknown or malformed zone must not fail a page render; UTC is the
        // documented fallback (and the same default as a missing cf.timezone).
        fmt = UTC_FORMATTER;
    }
    formatters.set(timeZone, fmt);
    return fmt;
}

/** YYYYMMDD of `ms` in `timeZone`; 0 when `ms` is not a finite instant. */
export function dayFromMs(ms: number, timeZone: string): number {
    if (!Number.isFinite(ms) || Math.abs(ms) > MAX_TIME_VALUE) return 0;
    // formatToParts, not format(): part order is locale data we don't control.
    let year = 0;
    let month = 0;
    let day = 0;
    for (const part of formatterFor(timeZone).formatToParts(new Date(ms))) {
        if (part.type === 'year') year = Number.parseInt(part.value, 10);
        else if (part.type === 'month') month = Number.parseInt(part.value, 10);
        else if (part.type === 'day') day = Number.parseInt(part.value, 10);
    }
    if (!year || !month || !day) return 0;
    return year * 10_000 + month * 100 + day;
}

/** The calendar date `deltaDays` away from `day`, month/year/leap aware. */
export function shiftDay(day: number, deltaDays: number): number {
    // Shifting an unknown day (0) is still unknown. Treat as sentinel passthrough
    // rather than computing an 1899 date from the legacy two-digit-year rule.
    if (day === 0) return 0;
    const year = Math.floor(day / 10_000);
    const month = Math.floor((day % 10_000) / 100);
    const date = day % 100;
    const shifted = new Date(
        Date.UTC(year, month - 1, date) + deltaDays * 86_400_000,
    );
    return (
        shifted.getUTCFullYear() * 10_000 +
        (shifted.getUTCMonth() + 1) * 100 +
        shifted.getUTCDate()
    );
}

/**
 * Inclusive lower bound for a window, as a calendar date in the viewer's zone.
 * Windows are whole calendar days, not rolling hour spans: `7d` is today plus
 * the six days before it.
 */
export function windowStartDay(
    window: TimeWindow,
    now: number,
    timeZone: string,
): number {
    switch (window) {
        case 'all':
            return 0;
        case 'today':
            return dayFromMs(now, timeZone);
        case '7d':
            return shiftDay(dayFromMs(now, timeZone), -6);
        case '30d':
            return shiftDay(dayFromMs(now, timeZone), -29);
        default: {
            const exhaustive: never = window;
            return exhaustive;
        }
    }
}

/** The viewer's IANA timezone from Cloudflare's request metadata, else UTC. */
export function timeZoneFromRequest(req: Request): string {
    const cf = (req as Request & { cf?: { timezone?: unknown } }).cf;
    const tz = cf?.timezone;
    return typeof tz === 'string' && tz ? tz : 'UTC';
}
