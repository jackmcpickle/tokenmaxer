import { readdirSync, readFileSync, statSync } from 'node:fs';
import { homedir } from 'node:os';
import { basename, join } from 'node:path';
import { localDay } from '../lib/day';
import { asObject, toMs } from '../lib/parse-utils';
import { toRows } from '../lib/rows';
import { accumulateModelDayUsage, usageFromFields } from '../lib/totals';
import type {
    DayTotals,
    JsonObject,
    ParseOpts,
    ParsedTranscript,
    ReporterRow,
} from '../lib/types';
import { OPENCODE_USAGE_FIELDS } from '../lib/usage-fields';

function opencodeTimestamp(msg: JsonObject): number | null {
    const time = asObject(msg.time);
    const created = time.created ?? time.start ?? msg.timestamp;
    return typeof created === 'number' ? created : toMs(created);
}

// Written defensively — opencode has revised its message shape, so both nested
// (`tokens.cache.read`) and flat (`cache_read`) keys are tolerated.
function accumulateOpencodeTokens(
    models: Map<string, DayTotals>,
    msg: JsonObject,
    day: number,
): void {
    const tokens = asObject(msg.tokens);
    if (!msg.tokens || typeof msg.tokens !== 'object') return;
    const model =
        typeof msg.modelID === 'string' && msg.modelID
            ? msg.modelID
            : 'unknown';
    const cache = asObject(tokens.cache);
    const flattenedUsage: JsonObject = {
        input: tokens.input,
        output: tokens.output,
        reasoning: tokens.reasoning,
        cache_read: cache.read ?? tokens.cache_read,
        cache_write: cache.write ?? tokens.cache_write,
    };
    accumulateModelDayUsage(
        models,
        model,
        day,
        usageFromFields(flattenedUsage, OPENCODE_USAGE_FIELDS),
    );
}

/**
 * Parse a set of opencode assistant messages (each `msg_*.json` under
 * `storage/message/<sessionID>/` is one message object). Sums the `tokens.*`
 * block per model, bucketed by each message's own local day.
 */
export function parseOpencodeMessages(
    messages: unknown[],
    opts: ParseOpts = {},
): ParsedTranscript {
    const models = new Map<string, DayTotals>();
    let sessionId = opts.sessionId ?? null;
    let startedAt: number | null = null;

    for (const raw of messages) {
        if (!raw || typeof raw !== 'object') continue;
        const msg = raw as JsonObject;
        if (!sessionId && typeof msg.sessionID === 'string')
            sessionId = msg.sessionID;
        const ts = opencodeTimestamp(msg);
        if (ts !== null && (startedAt === null || ts < startedAt))
            startedAt = ts;
        // A message with no usable timestamp books to day 0 (the "unknown
        // day" sentinel) rather than a fallback computed mid-parse: the
        // session's real start instant (startedAt) isn't settled until every
        // message has been seen, so resolving a fallback early can
        // misattribute to the wrong day. The fold below resolves it once,
        // after the whole pass has run.
        if (msg.role === 'assistant') {
            accumulateOpencodeTokens(models, msg, localDay(ts));
        }
    }

    // Fold every day-0 bucket into the session's resolved fallback day now
    // that scanning has finished. Merge rather than overwrite: a real bucket
    // for the same day can already hold usage. Date.now() is the last
    // resort, for a session with no usable timestamp anywhere and no
    // caller-supplied fallbackStartedAt.
    const fallbackDay = localDay(
        startedAt ?? opts.fallbackStartedAt ?? Date.now(),
    );
    for (const [model, byDay] of models) {
        const unknown = byDay.get(0);
        if (unknown === undefined) continue;
        byDay.delete(0);
        accumulateModelDayUsage(models, model, fallbackDay, unknown);
    }

    return {
        session_id: sessionId ?? opts.sessionId ?? null,
        started_at: startedAt ?? opts.fallbackStartedAt ?? null,
        models,
    };
}

// opencode stores one JSON file per message under storage/message/<sessionID>/.
function opencodeMessageRoots(): string[] {
    const roots: string[] = [];
    if (process.env.OPENCODE_DATA_DIR)
        roots.push(join(process.env.OPENCODE_DATA_DIR, 'storage', 'message'));
    if (process.env.XDG_DATA_HOME)
        roots.push(
            join(process.env.XDG_DATA_HOME, 'opencode', 'storage', 'message'),
        );
    roots.push(
        join(homedir(), '.local', 'share', 'opencode', 'storage', 'message'),
    );
    return roots;
}

function parseOpencodeFiles(
    texts: string[],
    opts: ParseOpts,
): ParsedTranscript {
    const messages: unknown[] = [];
    for (const text of texts) {
        try {
            messages.push(JSON.parse(text));
        } catch {
            /* skip unreadable message file */
        }
    }
    return parseOpencodeMessages(messages, opts);
}

// Read every message JSON in one opencode session dir, tracking the newest mtime.
function readOpencodeSessionTexts(
    dir: string,
): { texts: string[]; newest: number } | null {
    let files;
    try {
        files = readdirSync(dir, { withFileTypes: true });
    } catch {
        return null;
    }
    let newest = 0;
    const texts: string[] = [];
    for (const f of files) {
        if (!f.isFile() || !/\.json$/iu.test(f.name)) continue;
        const full = join(dir, f.name);
        try {
            const st = statSync(full);
            if (st.mtimeMs > newest) newest = st.mtimeMs;
            texts.push(readFileSync(full, 'utf8'));
        } catch {
            /* ignore */
        }
    }
    return { texts, newest };
}

/**
 * Walk opencode's message store, grouping the per-message JSON files back into
 * sessions (one session = one directory). A session is included when any of its
 * message files was modified at/after `sinceMs`.
 */
export function collectOpencodeRows(sinceMs: number): ReporterRow[] {
    const rows: ReporterRow[] = [];
    for (const root of opencodeMessageRoots()) {
        let sessions;
        try {
            sessions = readdirSync(root, { withFileTypes: true });
        } catch {
            continue;
        }
        for (const s of sessions) {
            if (!s.isDirectory()) continue;
            const res = readOpencodeSessionTexts(join(root, s.name));
            if (!res || res.texts.length === 0 || res.newest < sinceMs)
                continue;
            const parsed = parseOpencodeFiles(res.texts, {
                sessionId: s.name,
                fallbackStartedAt: res.newest,
            });
            rows.push(...toRows(parsed, s.name));
        }
    }
    return rows;
}

function opencodeSessionCandidates(sessionArg: string): string[] {
    // Accept either an absolute session directory or a bare sessionID.
    try {
        if (statSync(sessionArg).isDirectory()) return [sessionArg];
    } catch {
        /* not a path — treat as sessionID below */
    }
    return opencodeMessageRoots().map((root) => join(root, sessionArg));
}

export function reportOneOpencodeSession(sessionArg: string): ReporterRow[] {
    for (const dir of opencodeSessionCandidates(sessionArg)) {
        const res = readOpencodeSessionTexts(dir);
        if (!res || res.texts.length === 0) continue;
        const parsed = parseOpencodeFiles(res.texts, {
            sessionId: basename(dir),
        });
        return toRows(parsed, basename(dir));
    }
    return [];
}
