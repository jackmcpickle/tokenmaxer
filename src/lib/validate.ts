import { isValidCountry } from '@/lib/countries';
import { dayFromMs } from '@/lib/day';
import { isSyntheticModel } from '@/lib/model-family';
import { isSource, type SessionUsageInput, type Source } from '@/types';

export const USERNAME_RE = /^[a-zA-Z0-9_-]{2,32}$/u;

const RESERVED = new Set([
    'api',
    'start',
    'about',
    'pricing',
    'u',
    'admin',
    'static',
    'health',
    'leaderboard',
    'login',
    'register',
    'tokentally',
    'tokenmaxer',
    'me',
    'new',
    'privacy',
    'h',
    'auth',
    'hackathon',
    'logout',
    'session',
]);

const MAX_HACKATHON_NAME_LEN = 80;
// Sane bounds so a fat-fingered date can't create a decade-long contest.
const MAX_HACKATHON_MS = 366 * 86_400_000;

export function validateHackathonName(raw: unknown): Result<string> {
    if (typeof raw !== 'string') {
        return { ok: false, error: 'name must be a string' };
    }
    const name = raw.trim();
    if (name.length < 2) return { ok: false, error: 'name too short' };
    if (name.length > MAX_HACKATHON_NAME_LEN) {
        return { ok: false, error: 'name too long' };
    }
    return { ok: true, value: name };
}

export function validateHackathonRange(
    startRaw: unknown,
    endRaw: unknown,
): Result<{ startAt: number; endAt: number }> {
    const startAt = Number(startRaw);
    const endAt = Number(endRaw);
    if (!Number.isFinite(startAt) || !Number.isFinite(endAt)) {
        return { ok: false, error: 'start and end must be timestamps' };
    }
    if (endAt <= startAt) {
        return { ok: false, error: 'end must be after start' };
    }
    if (endAt - startAt > MAX_HACKATHON_MS) {
        return { ok: false, error: 'range too long (max 1 year)' };
    }
    return {
        ok: true,
        value: { startAt: Math.floor(startAt), endAt: Math.floor(endAt) },
    };
}

export function validateModelFamily(
    raw: unknown,
    allowed: string[],
): Result<string | null> {
    if (raw === null || raw === undefined || raw === '') {
        return { ok: true, value: null };
    }
    if (typeof raw !== 'string') {
        return { ok: false, error: 'model family must be a string or null' };
    }
    if (!allowed.includes(raw)) {
        return { ok: false, error: 'unknown model family' };
    }
    return { ok: true, value: raw };
}

// Guardrails: reject only structurally broken reports. Legitimate long-running
// sessions can exceed 2B tokens in a category (a 16-day Codex session hit 2.13B
// input, 98.7% cached — see issue #21), so the only per-category bound is the
// safe-integer range the store can represent losslessly.
const MAX_TOKENS_PER_CATEGORY = Number.MAX_SAFE_INTEGER;
const MAX_MODEL_LEN = 128;
const MAX_SESSION_ID_LEN = 200;

// Guardrails for a reporter-supplied calendar day: a plausible YYYYMMDD.
const MIN_DAY = 19700101;
const MAX_DAY = 99991231;

// Per-request session caps. Live reporting sends small, frequent batches; a
// one-time history backfill sends far more rows at once, so it gets its own cap.
export const MAX_INGEST_SESSIONS = 500;
export const MAX_HISTORY_SESSIONS = 5000;

export type Result<T> = { ok: true; value: T } | { ok: false; error: string };

const MAX_PROFILE_URL_LEN = 2048;

function fail<T>(error: string): Result<T> {
    return { ok: false, error };
}

function parseHttpsUrl(trimmed: string): Result<URL> {
    let parsed: URL;
    try {
        parsed = new URL(trimmed);
    } catch {
        return fail('url must be a valid https URL');
    }
    if (parsed.protocol !== 'https:') {
        return fail('url must use https');
    }
    if (parsed.username || parsed.password) {
        return fail('url must not include credentials');
    }
    return { ok: true, value: parsed };
}

export function validateProfileUrl(raw: unknown): Result<string | null> {
    if (raw === null) return { ok: true, value: null };
    if (typeof raw !== 'string') {
        return fail('url must be a string or null');
    }
    const trimmed = raw.trim();
    if (trimmed.length === 0) return { ok: true, value: null };
    if (trimmed.length > MAX_PROFILE_URL_LEN) {
        return fail('url too long');
    }
    const parsed = parseHttpsUrl(trimmed);
    if (!parsed.ok) return parsed;
    return { ok: true, value: parsed.value.href };
}

export function validateUsername(raw: unknown): Result<string> {
    if (typeof raw !== 'string')
        return { ok: false, error: 'username must be a string' };
    const username = raw.trim();
    if (!USERNAME_RE.test(username)) {
        return {
            ok: false,
            error: '2–32 chars, letters/numbers/underscore/hyphen only',
        };
    }
    if (RESERVED.has(username.toLowerCase())) {
        return { ok: false, error: 'that username is reserved' };
    }
    return { ok: true, value: username };
}

export function validateCountry(raw: unknown): Result<string> {
    if (typeof raw !== 'string') {
        return { ok: false, error: 'country is required' };
    }
    const code = raw.trim().toUpperCase();
    if (!isValidCountry(code)) {
        return { ok: false, error: 'pick a valid country' };
    }
    return { ok: true, value: code };
}

function coerceCount(v: unknown): number {
    if (typeof v !== 'number' || !Number.isFinite(v)) return 0;
    if (v < 0) return 0;
    return Math.floor(v);
}

export interface RejectedSession {
    /** Position of the rejected row in the submitted `sessions` array. */
    index: number;
    error: string;
}

export interface IngestPayload {
    source: Source;
    sessions: SessionUsageInput[];
    rejected: RejectedSession[];
    /**
     * Session ids whose stored rows this request fully replaces. The reporter
     * lists a session here in the FIRST request that carries any of its rows,
     * so a session split across requests is cleared exactly once.
     */
    replaceSessions: string[];
}

function requiredText(
    value: unknown,
    label: string,
    max: number,
): Result<string> {
    if (typeof value !== 'string' || value.length === 0) {
        return fail(`${label} is required`);
    }
    if (value.length > max) return fail(`${label} too long`);
    return { ok: true, value };
}

function sessionStartedAt(value: unknown): number {
    if (typeof value === 'number' && Number.isFinite(value) && value > 0) {
        return Math.floor(value);
    }
    return Date.now();
}

function exceedsTokenCap(row: SessionUsageInput): boolean {
    const counts = [
        row.input_tokens,
        row.output_tokens,
        row.cache_read_tokens,
        row.cache_creation_tokens,
        row.reasoning_tokens,
    ];
    return counts.some((n) => n > MAX_TOKENS_PER_CATEGORY);
}

function parseSessionEntry(raw: unknown): Result<SessionUsageInput> {
    if (typeof raw !== 'object' || raw === null) {
        return fail('each session must be an object');
    }
    const s = raw as Record<string, unknown>;
    const sessionId = requiredText(
        s.session_id,
        'session_id',
        MAX_SESSION_ID_LEN,
    );
    if (!sessionId.ok) return sessionId;
    const model = requiredText(s.model, 'model', MAX_MODEL_LEN);
    if (!model.ok) return model;

    const started_at = sessionStartedAt(s.started_at);

    // Reporters from before day bucketing send no `day`; the UTC day of
    // started_at reproduces the old attribution exactly, so old installs keep
    // reporting with no coordinated release.
    const day =
        typeof s.day === 'number' &&
        Number.isFinite(s.day) &&
        s.day >= MIN_DAY &&
        s.day <= MAX_DAY
            ? Math.floor(s.day)
            : dayFromMs(started_at, 'UTC');

    const row: SessionUsageInput = {
        session_id: sessionId.value,
        model: model.value,
        started_at,
        input_tokens: coerceCount(s.input_tokens),
        output_tokens: coerceCount(s.output_tokens),
        cache_read_tokens: coerceCount(s.cache_read_tokens),
        cache_creation_tokens: coerceCount(s.cache_creation_tokens),
        reasoning_tokens: coerceCount(s.reasoning_tokens),
        day,
    };
    if (exceedsTokenCap(row)) {
        return fail('token count exceeds safe integer range');
    }
    return { ok: true, value: row };
}

function parseReplaceSessions(
    raw: unknown,
    maxSessions: number,
): Result<string[]> {
    if (raw === undefined) return { ok: true, value: [] };
    if (!Array.isArray(raw)) return fail('replace_sessions must be an array');
    if (raw.length > maxSessions) {
        return fail(`too many replace_sessions (max ${maxSessions})`);
    }
    const replaceSessions: string[] = [];
    for (const id of raw) {
        if (
            typeof id !== 'string' ||
            id.length === 0 ||
            id.length > MAX_SESSION_ID_LEN
        ) {
            return fail('replace_sessions must be non-empty session ids');
        }
        replaceSessions.push(id);
    }
    return { ok: true, value: replaceSessions };
}

export function parseIngestBody(
    body: unknown,
    opts: { maxSessions?: number } = {},
): Result<IngestPayload> {
    const maxSessions = opts.maxSessions ?? MAX_INGEST_SESSIONS;
    if (typeof body !== 'object' || body === null) {
        return { ok: false, error: 'body must be a JSON object' };
    }
    const b = body as Record<string, unknown>;

    if (!isSource(b.source)) {
        return {
            ok: false,
            error: "source must be 'claude_code', 'codex', 'opencode', 'pi' or 'cursor'",
        };
    }
    const listed = ingestSessionList(b.sessions, maxSessions);
    if (!listed.ok) return listed;

    const parsedReplace = parseReplaceSessions(b.replace_sessions, maxSessions);
    if (!parsedReplace.ok) return parsedReplace;

    // Structurally invalid rows are rejected individually (by their index in
    // the submitted array) instead of failing the whole batch, so one bad row
    // never blocks the rest of a report.
    const split = splitIngestSessions(listed.value);
    return {
        ok: true,
        value: {
            source: b.source,
            sessions: split.sessions,
            rejected: split.rejected,
            replaceSessions: parsedReplace.value,
        },
    };
}

function ingestSessionList(
    sessions: unknown,
    maxSessions: number,
): Result<unknown[]> {
    if (!Array.isArray(sessions)) return fail('sessions must be an array');
    if (sessions.length === 0) return fail('sessions must not be empty');
    if (sessions.length > maxSessions) {
        return fail(`too many sessions (max ${maxSessions})`);
    }
    return { ok: true, value: sessions };
}

function splitIngestSessions(rawSessions: readonly unknown[]): {
    sessions: SessionUsageInput[];
    rejected: RejectedSession[];
} {
    const sessions: SessionUsageInput[] = [];
    const rejected: RejectedSession[] = [];
    for (const [index, raw] of rawSessions.entries()) {
        const parsed = parseSessionEntry(raw);
        if (!parsed.ok) {
            rejected.push({ index, error: parsed.error });
            continue;
        }
        // Skip Claude Code `<synthetic>` rows; all-synthetic batches still succeed.
        if (isSyntheticModel(parsed.value.model)) continue;
        sessions.push(parsed.value);
    }
    return { sessions, rejected };
}

/** Same shape as ingest, but with the larger bulk-backfill session cap. */
export function parseHistoryBody(body: unknown): Result<IngestPayload> {
    return parseIngestBody(body, { maxSessions: MAX_HISTORY_SESSIONS });
}
