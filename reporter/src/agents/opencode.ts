import { readdirSync, readFileSync, statSync } from 'node:fs';
import { homedir } from 'node:os';
import { basename, join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { localDay } from '../lib/day';
import { asObject, toMs } from '../lib/parse-utils';
import { toRows } from '../lib/rows';
import {
    accumulateModelUsage,
    singleDayModels,
    usageFromFields,
} from '../lib/totals';
import type {
    JsonObject,
    ParseOpts,
    ParsedTranscript,
    ReporterRow,
    ReporterTotals,
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
    models: Map<string, ReporterTotals>,
    msg: JsonObject,
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
    accumulateModelUsage(
        models,
        model,
        usageFromFields(flattenedUsage, OPENCODE_USAGE_FIELDS),
    );
}

interface OpencodeParseCtx {
    sessionId: string | null;
    startedAt: number | null;
    models: Map<string, ReporterTotals>;
}

function ingestOpencodeMessage(msg: JsonObject, ctx: OpencodeParseCtx): void {
    if (!ctx.sessionId && typeof msg.sessionID === 'string')
        ctx.sessionId = msg.sessionID;
    const ts = opencodeTimestamp(msg);
    if (ts !== null && (ctx.startedAt === null || ts < ctx.startedAt))
        ctx.startedAt = ts;
    if (msg.role === 'assistant') accumulateOpencodeTokens(ctx.models, msg);
}

/**
 * Parse a set of opencode assistant messages. The message object is the same
 * shape whether it came from a legacy `msg_*.json` file or from the `data`
 * column of the `message` table in opencode.db. Sums the `tokens.*` block per
 * model.
 */
function asMessage(raw: unknown): JsonObject | null {
    if (!raw || typeof raw !== 'object') return null;
    return raw as JsonObject;
}

function finishOpencodeParse(
    ctx: OpencodeParseCtx,
    opts: ParseOpts,
): ParsedTranscript {
    const startedAt = ctx.startedAt ?? opts.fallbackStartedAt ?? null;
    return {
        session_id: ctx.sessionId ?? opts.sessionId ?? null,
        started_at: startedAt,
        models: singleDayModels(ctx.models, localDay(startedAt ?? Date.now())),
    };
}

export function parseOpencodeMessages(
    messages: unknown[],
    opts: ParseOpts = {},
): ParsedTranscript {
    const ctx: OpencodeParseCtx = {
        sessionId: opts.sessionId ?? null,
        startedAt: null,
        models: new Map(),
    };

    for (const raw of messages) {
        const msg = asMessage(raw);
        if (!msg) continue;
        ingestOpencodeMessage(msg, ctx);
    }

    return finishOpencodeParse(ctx, opts);
}

// Base data dirs, most specific first. opencode >= 1.x keeps opencode.db here;
// older versions kept storage/message/<sessionID>/*.json.
function opencodeDataDirs(): string[] {
    const dirs: string[] = [];
    if (process.env.OPENCODE_DATA_DIR) dirs.push(process.env.OPENCODE_DATA_DIR);
    if (process.env.XDG_DATA_HOME)
        dirs.push(join(process.env.XDG_DATA_HOME, 'opencode'));
    dirs.push(join(homedir(), '.local', 'share', 'opencode'));
    return dirs;
}

function opencodeDbPaths(): string[] {
    return opencodeDataDirs().map((dir) => join(dir, 'opencode.db'));
}

// Legacy layout: one JSON file per message under storage/message/<sessionID>/.
function opencodeMessageRoots(): string[] {
    return opencodeDataDirs().map((dir) => join(dir, 'storage', 'message'));
}

type OpencodeDbRow = { session_id?: unknown; data?: unknown };

/**
 * Read opencode.db, grouping the `message` rows back into sessions. Each row's
 * `data` column holds the same JSON message object the legacy files did, so
 * parsing is shared with the file path.
 *
 * A session is included when any of its messages was created at/after
 * `sinceMs`. Returns null when this path holds no readable database, so the
 * caller can fall through to the legacy layout.
 */
function readOpencodeDb(
    path: string,
    sinceMs: number,
): Map<string, unknown[]> | null {
    let db: DatabaseSync;
    try {
        db = new DatabaseSync(path, { readOnly: true });
    } catch {
        return null;
    }
    try {
        const rows = db
            .prepare(
                'SELECT session_id, data FROM message WHERE time_created >= ? ORDER BY session_id, time_created',
            )
            .all(sinceMs) as OpencodeDbRow[];
        const bySession = new Map<string, unknown[]>();
        for (const row of rows) {
            if (typeof row.session_id !== 'string' || !row.session_id) continue;
            if (typeof row.data !== 'string') continue;
            let msg: unknown;
            try {
                msg = JSON.parse(row.data);
            } catch {
                // Skip an unparseable message rather than the whole session.
                continue;
            }
            const list = bySession.get(row.session_id);
            if (list) list.push(msg);
            else bySession.set(row.session_id, [msg]);
        }
        return bySession;
    } catch {
        // Table missing or schema changed — treat as "not the DB layout".
        return null;
    } finally {
        db.close();
    }
}

/** Collect rows from opencode.db across every candidate data dir. */
export function collectOpencodeDbRows(sinceMs: number): {
    rows: ReporterRow[];
    sessionIds: Set<string>;
} {
    const rows: ReporterRow[] = [];
    const sessionIds = new Set<string>();
    for (const path of opencodeDbPaths()) {
        const bySession = readOpencodeDb(path, sinceMs);
        if (!bySession) continue;
        for (const [sessionId, messages] of bySession) {
            if (sessionIds.has(sessionId)) continue;
            sessionIds.add(sessionId);
            const parsed = parseOpencodeMessages(messages, { sessionId });
            rows.push(...toRows(parsed, sessionId));
        }
    }
    return { rows, sessionIds };
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
 * Collect opencode sessions from both storage layouts.
 *
 * opencode >= 1.x writes messages into opencode.db; earlier versions wrote one
 * JSON file per message under storage/message/<sessionID>/. Both are read so a
 * machine that has upgraded still reports its pre-upgrade sessions, with the
 * database taking precedence for any session present in both.
 */
export function collectOpencodeRows(sinceMs: number): ReporterRow[] {
    const { rows, sessionIds } = collectOpencodeDbRows(sinceMs);
    for (const root of opencodeMessageRoots()) {
        let sessions;
        try {
            sessions = readdirSync(root, { withFileTypes: true });
        } catch {
            continue;
        }
        for (const s of sessions) {
            if (!s.isDirectory() || sessionIds.has(s.name)) continue;
            const res = readOpencodeSessionTexts(join(root, s.name));
            if (!res || res.texts.length === 0 || res.newest < sinceMs)
                continue;
            sessionIds.add(s.name);
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

/** Look one session up in opencode.db by id. */
function reportOneOpencodeDbSession(sessionId: string): ReporterRow[] {
    for (const path of opencodeDbPaths()) {
        const bySession = readOpencodeDb(path, 0);
        const messages = bySession?.get(sessionId);
        if (!messages || messages.length === 0) continue;
        const parsed = parseOpencodeMessages(messages, { sessionId });
        return toRows(parsed, sessionId);
    }
    return [];
}

export function reportOneOpencodeSession(sessionArg: string): ReporterRow[] {
    const fromDb = reportOneOpencodeDbSession(sessionArg);
    if (fromDb.length > 0) return fromDb;
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
