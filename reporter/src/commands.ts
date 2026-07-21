import { existsSync } from 'node:fs';
import {
    claudeEmbeddedSessionId,
    claudeSessionIdFromPath,
    claudeSessionSiblings,
    collectClaudeSessionRows,
} from './agents/claude-sessions';
import {
    CODEX_ROLLOUT_FILE,
    codexDirs,
    dedupeCodexRolloutFiles,
} from './agents/codex';
import {
    cursorFetchEvents,
    cursorSessionToken,
    parseCursorEvents,
} from './agents/cursor';
import {
    collectOpencodeRows,
    reportOneOpencodeSession,
} from './agents/opencode';
import { piDirs } from './agents/pi';
import { postSessions, readStdin } from './api';
import { collectRowsFromJsonlDirs } from './lib/collect';
import { CATCHUP_DAYS, HISTORY_CHUNK } from './lib/flags';
import type {
    JsonObject,
    PostOpts,
    ReporterConfig,
    ReporterRow,
} from './lib/types';
import { parseFile } from './parse-file';

interface CursorSyncOpts {
    sinceMs?: number;
    post?: PostOpts;
}

async function catchupJsonlSource(
    cfg: ReporterConfig,
    source: string,
    dirs: string[],
    match: (name: string) => boolean,
    label: string,
    prepareFiles?: (files: string[]) => string[],
): Promise<void> {
    const since = Date.now() - CATCHUP_DAYS * 86_400_000;
    const { files, rows } = collectRowsFromJsonlDirs({
        dirs,
        sinceMs: since,
        match,
        parseFile: (path) => parseFile(path, source),
        prepareFiles,
    });
    const { accepted } = await postSessions(cfg, source, rows);
    process.stderr.write(
        `tokenmaxer: caught up ${accepted} ${label}row(s) from ${files.length} file(s)\n`,
    );
}

// Run the whole-session collector seeded with a hooked transcript's sibling
// files (which may live outside the walked corpus). Rows key on embedded
// session ids — the hook id only fills in when a transcript declares none —
// so every uploaded row is a complete session total, never a partial that
// the server's replace-upsert would use to erase a fuller row. A listing
// failure inside the hooked session's own tree withholds the hooked session
// for the same reason; only the hooked path itself may be missing without
// withholding (it has no contribution to protect).
async function reportClaudeSession(
    cfg: ReporterConfig,
    path: string,
    opts: { sinceMs: number; hookSid?: string },
): Promise<void> {
    const failedSiblingDirs: string[] = [];
    const siblings = claudeSessionSiblings(path, failedSiblingDirs);
    const extraFailedSids: string[] = [];
    // An unlistable directory hides an unknown part of the tree, and
    // out-of-corpus trees have no walk to attribute the failure: the
    // collector withholds every session the siblings fed (by full-scan
    // session id); the id fallbacks below cover a hooked file that could
    // not be read at all.
    const treeFailed = failedSiblingDirs.length > 0;
    if (treeFailed) {
        extraFailedSids.push(
            claudeEmbeddedSessionId(path) ??
                opts.hookSid ??
                claudeSessionIdFromPath(path),
        );
    }
    // Exempt the hooked path from the missing-file withholding rule only
    // when it is ALREADY absent here: then there was never a contribution
    // to protect. A path that exists now but vanishes before the read is
    // the same race class as a vanished sibling and must withhold.
    const exemptMissing = existsSync(path) ? [] : [path];
    const { rows, sessionCount } = collectClaudeSessionRows(
        opts.sinceMs,
        siblings,
        opts.hookSid,
        extraFailedSids,
        exemptMissing,
        treeFailed,
    );
    const { accepted } = await postSessions(cfg, 'claude_code', rows);
    process.stderr.write(
        `tokenmaxer: reported ${accepted} row(s) across ${sessionCount} session(s)\n`,
    );
}

export async function claudeSessionEnd(cfg: ReporterConfig): Promise<void> {
    const stdin = await readStdin();
    let hook: JsonObject = {};
    try {
        const parsed: unknown = JSON.parse(stdin);
        if (parsed !== null && typeof parsed === 'object') {
            hook = parsed as JsonObject;
        }
    } catch {
        /* no hook payload */
    }
    const path = hook.transcript_path;
    // fall back to a scan when no transcript path is provided
    if (typeof path !== 'string' || !path) return claudeCatchup(cfg);
    const hookSid =
        typeof hook.session_id === 'string' && hook.session_id
            ? hook.session_id
            : undefined;
    const since = Date.now() - CATCHUP_DAYS * 86_400_000;
    await reportClaudeSession(cfg, path, { sinceMs: since, hookSid });
}

export async function claudeCatchup(cfg: ReporterConfig): Promise<void> {
    const since = Date.now() - CATCHUP_DAYS * 86_400_000;
    const { rows, fileCount, sessionCount } = collectClaudeSessionRows(since);
    const { accepted } = await postSessions(cfg, 'claude_code', rows);
    process.stderr.write(
        `tokenmaxer: caught up ${accepted} row(s) across ${sessionCount} session(s) from ${fileCount} file(s)\n`,
    );
}

// Dedupe copies of one session across sessions/ and archived_sessions/
// before parsing — the server upsert replaces, so a stale copy's row must
// never race the fuller one. Backfill seeds the parent-rollout index from
// the same walk instead of paying a second one on the first fork lookup.
function collectCodexRows(
    sinceMs: number,
    seedIndex: boolean,
): { files: string[]; rows: ReporterRow[] } {
    return collectRowsFromJsonlDirs({
        dirs: codexDirs(),
        sinceMs,
        match: (n) => CODEX_ROLLOUT_FILE.test(n),
        parseFile: (path) => parseFile(path, 'codex'),
        prepareFiles: (walked) => dedupeCodexRolloutFiles(walked, seedIndex),
    });
}

export async function codexCatchup(cfg: ReporterConfig): Promise<void> {
    await catchupJsonlSource(
        cfg,
        'codex',
        codexDirs(),
        (n) => CODEX_ROLLOUT_FILE.test(n),
        '',
        (files) => dedupeCodexRolloutFiles(files),
    );
}

export async function opencodeCatchup(cfg: ReporterConfig): Promise<void> {
    const since = Date.now() - CATCHUP_DAYS * 86_400_000;
    const rows = collectOpencodeRows(since);
    const { accepted } = await postSessions(cfg, 'opencode', rows);
    process.stderr.write(`tokenmaxer: caught up ${accepted} opencode row(s)\n`);
}

export async function piCatchup(cfg: ReporterConfig): Promise<void> {
    await catchupJsonlSource(
        cfg,
        'pi',
        piDirs(),
        (n) => n.endsWith('.jsonl'),
        'pi ',
    );
}

export async function reportOneOpencode(
    cfg: ReporterConfig,
    sessionArg: string | undefined,
): Promise<void> {
    if (!sessionArg) {
        process.stderr.write('tokenmaxer: missing opencode session id\n');
        return;
    }
    const rows = reportOneOpencodeSession(sessionArg);
    const { accepted } = await postSessions(cfg, 'opencode', rows);
    process.stderr.write(`tokenmaxer: reported ${accepted} opencode row(s)\n`);
}

export interface CursorSyncResult {
    problems: number;
    // True when the whole window was abandoned (fetch/pagination failure) —
    // a different magnitude of loss than N rejected rows.
    aborted: boolean;
}

export async function cursorSync(
    cfg: ReporterConfig,
    opts: CursorSyncOpts = {},
): Promise<CursorSyncResult> {
    const sessionToken = cursorSessionToken(cfg);
    if (!sessionToken) {
        process.stderr.write(
            'tokenmaxer: Cursor not configured (no state.vscdb token or cursorCookie)\n',
        );
        return { problems: 0, aborted: false };
    }
    const since = opts.sinceMs ?? Date.now() - CATCHUP_DAYS * 86_400_000;
    // Floor to UTC day start: rows are whole-day sums and the server upsert
    // replaces counts, so a partial oldest day would shrink stored totals.
    const d = new Date(since);
    const sinceMs = Date.UTC(
        d.getUTCFullYear(),
        d.getUTCMonth(),
        d.getUTCDate(),
    );
    const events = await cursorFetchEvents(sessionToken, sinceMs);
    if (events === null) {
        process.stderr.write(
            'tokenmaxer: cursor sync aborted (fetch failed)\n',
        );
        return { problems: 0, aborted: true };
    }
    const rows = parseCursorEvents(events);
    const result = await postSessions(cfg, 'cursor', rows, opts.post);
    process.stderr.write(
        `tokenmaxer: cursor synced ${result.accepted} row(s) from ${events.length} event(s)\n`,
    );
    return { problems: result.rejected + result.failed, aborted: false };
}

// User-run cursor-sync command (not a hook): a lost upload must not exit 0.
export async function cursorSyncCommand(cfg: ReporterConfig): Promise<void> {
    const result = await cursorSync(cfg);
    if (result.problems > 0 || result.aborted) process.exitCode = 1;
}

async function postHistory(
    cfg: ReporterConfig,
    source: string,
    rows: ReporterRow[],
): Promise<{ accepted: number; problems: number }> {
    const result = await postSessions(cfg, source, rows, {
        path: '/api/history',
        chunkSize: HISTORY_CHUNK,
    });
    return {
        accepted: result.accepted,
        problems: result.rejected + result.failed,
    };
}

async function backfillFiles(
    cfg: ReporterConfig,
    source: string,
    rows: ReporterRow[],
    label: string,
    fileCount: number,
): Promise<{ accepted: number; problems: number }> {
    const result = await postHistory(cfg, source, rows);
    process.stderr.write(
        `tokenmaxer: backfilled ${result.accepted} ${label} row(s) from ${fileCount} file(s)\n`,
    );
    return result;
}

export async function backfill(
    cfg: ReporterConfig,
    only: string | undefined,
): Promise<void> {
    let total = 0;
    let problems = 0;
    let withheldSessions = 0;
    if (!only || only === 'claude') {
        const collected = collectClaudeSessionRows(0);
        withheldSessions += collected.withheldSessions;
        const r = await backfillFiles(
            cfg,
            'claude_code',
            collected.rows,
            'Claude Code',
            collected.fileCount,
        );
        total += r.accepted;
        problems += r.problems;
    }
    if (!only || only === 'codex') {
        const { files, rows } = collectCodexRows(0, true);
        const r = await backfillFiles(
            cfg,
            'codex',
            rows,
            'Codex',
            files.length,
        );
        total += r.accepted;
        problems += r.problems;
    }
    if (!only || only === 'opencode') {
        const rows = collectOpencodeRows(0);
        const r = await postHistory(cfg, 'opencode', rows);
        total += r.accepted;
        problems += r.problems;
        process.stderr.write(
            `tokenmaxer: backfilled ${r.accepted} opencode row(s)\n`,
        );
    }
    if (!only || only === 'pi') {
        const { files, rows } = collectRowsFromJsonlDirs({
            dirs: piDirs(),
            sinceMs: 0,
            match: (n) => n.endsWith('.jsonl'),
            parseFile: (path) => parseFile(path, 'pi'),
        });
        const r = await backfillFiles(cfg, 'pi', rows, 'pi', files.length);
        total += r.accepted;
        problems += r.problems;
    }
    let cursorAborted = false;
    if (!only || only === 'cursor') {
        const r = await cursorSync(cfg, {
            sinceMs: Date.now() - 90 * 86_400_000,
            post: { path: '/api/history', chunkSize: HISTORY_CHUNK },
        });
        problems += r.problems;
        cursorAborted = r.aborted;
    }
    if (problems > 0 || withheldSessions > 0 || cursorAborted) {
        // A partial upload must not masquerade as success: report what was
        // lost and exit non-zero so scripts and humans notice. An aborted
        // cursor window is a whole unsynced range, not a row count;
        // withheld sessions were never sent at all.
        process.stderr.write(
            `tokenmaxer: backfill finished with errors — ${total} row(s) stored, ${problems} row(s) rejected or failed${
                withheldSessions > 0
                    ? `, ${withheldSessions} session(s) withheld`
                    : ''
            }${cursorAborted ? ', cursor window not synced' : ''}\n`,
        );
        process.exitCode = 1;
        return;
    }
    process.stderr.write(
        `tokenmaxer: backfill complete — ${total} row(s) total\n`,
    );
}

export async function reportOne(
    cfg: ReporterConfig,
    path: string | undefined,
    source: string,
): Promise<void> {
    if (!path) {
        process.stderr.write(`tokenmaxer: missing path for ${source} report\n`);
        return;
    }
    if (source === 'claude_code') {
        // A user command pointed at a path that doesn't exist deserves a
        // loud failure, not "reported 0 row(s)".
        if (!existsSync(path)) {
            process.stderr.write(`tokenmaxer: no such transcript: ${path}\n`);
            process.exitCode = 1;
            return;
        }
        // A Claude session spans several files; uploading one file's totals
        // under the shared session id would let the server's replace-upsert
        // erase the fuller aggregate. The out-of-range window makes the
        // collector report only the named session (complete).
        return reportClaudeSession(cfg, path, {
            sinceMs: Number.MAX_SAFE_INTEGER,
        });
    }
    const rows = parseFile(path, source);
    const { accepted } = await postSessions(cfg, source, rows);
    process.stderr.write(`tokenmaxer: reported ${accepted} row(s)\n`);
}
