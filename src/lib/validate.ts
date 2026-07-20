import { isValidCountry } from '@/lib/countries';
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

// Per-request session caps. Live reporting sends small, frequent batches; a
// one-time history backfill sends far more rows at once, so it gets its own cap.
export const MAX_INGEST_SESSIONS = 500;
export const MAX_HISTORY_SESSIONS = 5000;

export type Result<T> = { ok: true; value: T } | { ok: false; error: string };

const MAX_PROFILE_URL_LEN = 2048;

export function validateProfileUrl(raw: unknown): Result<string | null> {
    if (raw === null) return { ok: true, value: null };
    if (typeof raw !== 'string') {
        return { ok: false, error: 'url must be a string or null' };
    }
    const trimmed = raw.trim();
    if (trimmed.length === 0) return { ok: true, value: null };
    if (trimmed.length > MAX_PROFILE_URL_LEN) {
        return { ok: false, error: 'url too long' };
    }
    let parsed: URL;
    try {
        parsed = new URL(trimmed);
    } catch {
        return { ok: false, error: 'url must be a valid https URL' };
    }
    if (parsed.protocol !== 'https:') {
        return { ok: false, error: 'url must use https' };
    }
    if (parsed.username || parsed.password) {
        return { ok: false, error: 'url must not include credentials' };
    }
    return { ok: true, value: parsed.href };
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
}

function parseSessionEntry(raw: unknown): Result<SessionUsageInput> {
    if (typeof raw !== 'object' || raw === null) {
        return { ok: false, error: 'each session must be an object' };
    }
    const s = raw as Record<string, unknown>;
    if (typeof s.session_id !== 'string' || s.session_id.length === 0) {
        return { ok: false, error: 'session_id is required' };
    }
    if (s.session_id.length > MAX_SESSION_ID_LEN) {
        return { ok: false, error: 'session_id too long' };
    }
    if (typeof s.model !== 'string' || s.model.length === 0) {
        return { ok: false, error: 'model is required' };
    }
    if (s.model.length > MAX_MODEL_LEN) {
        return { ok: false, error: 'model too long' };
    }

    const started_at =
        typeof s.started_at === 'number' &&
        Number.isFinite(s.started_at) &&
        s.started_at > 0
            ? Math.floor(s.started_at)
            : Date.now();

    const row: SessionUsageInput = {
        session_id: s.session_id,
        model: s.model,
        started_at,
        input_tokens: coerceCount(s.input_tokens),
        output_tokens: coerceCount(s.output_tokens),
        cache_read_tokens: coerceCount(s.cache_read_tokens),
        cache_creation_tokens: coerceCount(s.cache_creation_tokens),
        reasoning_tokens: coerceCount(s.reasoning_tokens),
    };

    for (const n of [
        row.input_tokens,
        row.output_tokens,
        row.cache_read_tokens,
        row.cache_creation_tokens,
        row.reasoning_tokens,
    ]) {
        if (n > MAX_TOKENS_PER_CATEGORY) {
            return {
                ok: false,
                error: 'token count exceeds safe integer range',
            };
        }
    }
    return { ok: true, value: row };
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
    if (!Array.isArray(b.sessions)) {
        return { ok: false, error: 'sessions must be an array' };
    }
    if (b.sessions.length === 0) {
        return { ok: false, error: 'sessions must not be empty' };
    }
    if (b.sessions.length > maxSessions) {
        return {
            ok: false,
            error: `too many sessions (max ${maxSessions})`,
        };
    }

    // Structurally invalid rows are rejected individually (by their index in
    // the submitted array) instead of failing the whole batch, so one bad row
    // never blocks the rest of a report.
    const sessions: SessionUsageInput[] = [];
    const rejected: RejectedSession[] = [];
    for (const [index, raw] of b.sessions.entries()) {
        const parsed = parseSessionEntry(raw);
        if (!parsed.ok) {
            rejected.push({ index, error: parsed.error });
            continue;
        }
        // Skip Claude Code `<synthetic>` rows; all-synthetic batches still succeed.
        if (isSyntheticModel(parsed.value.model)) continue;
        sessions.push(parsed.value);
    }

    return { ok: true, value: { source: b.source, sessions, rejected } };
}

/** Same shape as ingest, but with the larger bulk-backfill session cap. */
export function parseHistoryBody(body: unknown): Result<IngestPayload> {
    return parseIngestBody(body, { maxSessions: MAX_HISTORY_SESSIONS });
}
