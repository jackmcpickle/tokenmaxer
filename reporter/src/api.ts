import { DRY_RUN, MAX_SESSIONS_PER_REQUEST } from './lib/flags';
import { asObject } from './lib/parse-utils';
import type { PostOpts, ReporterConfig, ReporterRow } from './lib/types';

export interface PostResult {
    accepted: number;
    // Rows the server rejected individually (structural problems reported
    // per row) and rows lost to whole-batch failures (HTTP/network errors).
    rejected: number;
    failed: number;
}

// `baseIndex` converts the server's per-batch indices back into positions in
// the POSTED (session-grouped) order — planBatches reorders rows so each
// session is contiguous, so this is not the caller's original array order.
function describeRejections(
    data: Record<string, unknown>,
    baseIndex: number,
): number {
    const rejected = data.rejected;
    if (!Array.isArray(rejected) || rejected.length === 0) return 0;
    for (const entry of rejected.slice(0, 3)) {
        const r = asObject(entry);
        const index =
            typeof r.index === 'number' ? baseIndex + r.index : r.index;
        process.stderr.write(
            `tokenmaxer: server rejected row ${String(index)}: ${String(
                r.error,
            )}\n`,
        );
    }
    if (rejected.length > 3) {
        process.stderr.write(
            `tokenmaxer: … and ${rejected.length - 3} more rejected row(s)\n`,
        );
    }
    return rejected.length;
}

export interface PostBatch {
    rows: ReporterRow[];
    baseIndex: number;
    // Sessions this request fully re-reports. A session is claimed by the FIRST
    // batch carrying any of its rows, so the server clears it exactly once even
    // when its day rows span several requests.
    replaceSessions: string[];
}

/**
 * Group rows so every session's rows are contiguous, then cut fixed-size
 * batches. Contiguity is what makes the replace contract safe: a session's
 * later chunks land through the upsert instead of behind a second delete.
 */
export function planBatches(
    rows: ReporterRow[],
    chunkSize: number,
): PostBatch[] {
    const bySession = new Map<string, ReporterRow[]>();
    for (const r of rows) {
        const group = bySession.get(r.session_id);
        if (group) group.push(r);
        else bySession.set(r.session_id, [r]);
    }
    const ordered: ReporterRow[] = [];
    // No spread: a session with tens of thousands of day rows must not blow
    // the call stack.
    for (const group of bySession.values()) {
        for (const r of group) ordered.push(r);
    }

    const batches: PostBatch[] = [];
    const claimed = new Set<string>();
    for (let i = 0; i < ordered.length; i += chunkSize) {
        const slice = ordered.slice(i, i + chunkSize);
        const replaceSessions: string[] = [];
        for (const r of slice) {
            if (claimed.has(r.session_id)) continue;
            claimed.add(r.session_id);
            replaceSessions.push(r.session_id);
        }
        batches.push({ rows: slice, baseIndex: i, replaceSessions });
    }
    return batches;
}

async function postBatch(
    cfg: ReporterConfig,
    source: string,
    batch: PostBatch,
    path: string,
): Promise<PostResult> {
    const body = {
        source,
        sessions: batch.rows,
        replace_sessions: batch.replaceSessions,
    };
    if (DRY_RUN) {
        process.stdout.write(
            `${JSON.stringify(
                { dryRun: true, url: `${cfg.apiBase}${path}`, body },
                null,
                2,
            )}\n`,
        );
        return { accepted: batch.rows.length, rejected: 0, failed: 0 };
    }
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 10_000);
    try {
        const res = await fetch(`${cfg.apiBase}${path}`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                Authorization: `Bearer ${cfg.token}`,
            },
            body: JSON.stringify(body),
            signal: controller.signal,
        });
        if (res.ok) {
            const data: unknown = await res.json().catch(() => ({}));
            const obj = asObject(data);
            const rejected = describeRejections(obj, batch.baseIndex);
            const accepted =
                typeof obj.accepted === 'number'
                    ? obj.accepted
                    : batch.rows.length - rejected;
            return { accepted, rejected, failed: 0 };
        }
        // Surface the response body: a silent status code hides which rows
        // (and why) a whole batch was refused.
        const text = (await res.text().catch(() => '')).slice(0, 300);
        process.stderr.write(
            `tokenmaxer: ingest failed (${res.status})${text ? `: ${text}` : ''}\n`,
        );
        return { accepted: 0, rejected: 0, failed: batch.rows.length };
    } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        process.stderr.write(`tokenmaxer: ingest failed: ${message}\n`);
        return { accepted: 0, rejected: 0, failed: batch.rows.length };
    } finally {
        clearTimeout(timer);
    }
}

export async function postSessions(
    cfg: ReporterConfig,
    source: string,
    rows: ReporterRow[],
    opts: PostOpts = {},
): Promise<PostResult> {
    if (rows.length === 0) return { accepted: 0, rejected: 0, failed: 0 };
    const path = opts.path ?? '/api/ingest';
    const chunkSize = opts.chunkSize ?? MAX_SESSIONS_PER_REQUEST;
    const batches = planBatches(rows, chunkSize);
    // Sequential, not Promise.all: a claimed session's delete must land before
    // the continuation batches that carry the rest of its days.
    const results: PostResult[] = [];
    for (const batch of batches) {
        // eslint-disable-next-line no-await-in-loop
        results.push(await postBatch(cfg, source, batch, path));
    }
    return results.reduce(
        (sum, r) => ({
            accepted: sum.accepted + r.accepted,
            rejected: sum.rejected + r.rejected,
            failed: sum.failed + r.failed,
        }),
        { accepted: 0, rejected: 0, failed: 0 },
    );
}

export async function readStdin(): Promise<string> {
    if (process.stdin.isTTY) return '';
    const chunks: Buffer[] = [];
    for await (const chunk of process.stdin) chunks.push(chunk as Buffer);
    return Buffer.concat(chunks).toString('utf8');
}
