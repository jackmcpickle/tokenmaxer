// The ECMAScript maximum time value; beyond it `new Date(ms)` is an Invalid
// Date. The reporter is a standalone CLI that must not import from `src/`, so
// this mirrors (does not import) the server's twin constant in `@/lib/day`.
const MAX_TIME_VALUE = 8_640_000_000_000_000;

/**
 * Calendar dates as YYYYMMDD integers (20260807), in the REPORTER's local
 * timezone. Usage belongs to the day the user would name if asked when they
 * spent it, so a session spanning a fortnight contributes to every day it
 * touched instead of booking everything to the day it opened.
 *
 * 0 is the "unknown day" sentinel: callers substitute a fallback (the session's
 * start day) rather than inventing a date from the wall clock mid-parse.
 */
export function localDay(ms: number | null | undefined): number {
    if (typeof ms !== 'number' || !Number.isFinite(ms)) return 0;
    if (Math.abs(ms) > MAX_TIME_VALUE) return 0;
    const d = new Date(ms);
    return d.getFullYear() * 10_000 + (d.getMonth() + 1) * 100 + d.getDate();
}
