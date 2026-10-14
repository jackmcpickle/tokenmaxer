import { partitionGrokBot } from '@/lib/grok-bot';
import type { SessionUsageInput, Source } from '@/types';

// D1 caps how many statements a single batch may carry, so large payloads (a
// history backfill can send thousands of rows) are written in chunks.
const DB_BATCH_CHUNK = 500;

const DELETE_SESSION_SQL = `DELETE FROM session_usage
 WHERE user_id = ? AND source = ? AND session_id = ?`;

const UPSERT_SQL = `INSERT INTO session_usage
   (user_id, source, session_id, model, day, input_tokens, output_tokens,
    cache_read_tokens, cache_creation_tokens, reasoning_tokens, started_at, updated_at)
 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
 ON CONFLICT (user_id, source, session_id, model, day) DO UPDATE SET
   input_tokens = excluded.input_tokens,
   output_tokens = excluded.output_tokens,
   cache_read_tokens = excluded.cache_read_tokens,
   cache_creation_tokens = excluded.cache_creation_tokens,
   reasoning_tokens = excluded.reasoning_tokens,
   started_at = excluded.started_at,
   updated_at = excluded.updated_at`;

/**
 * Store one validated upload. The payload is first split per source (a Cursor
 * upload also carries Grok Bot rows or claims), then every group's deletes and
 * inserts are written together, so a request that fits in one D1 batch stays
 * all-or-nothing across sources. A group with neither rows nor claims is a
 * no-op.
 *
 * Returns the number of rows written.
 */
export async function upsertIngest(
    db: D1Database,
    userId: string,
    payload: {
        source: Source;
        sessions: SessionUsageInput[];
        replaceSessions: string[];
    },
    now: number,
): Promise<number> {
    const deletes: D1PreparedStatement[] = [];
    const inserts: D1PreparedStatement[] = [];
    let written = 0;
    for (const group of partitionGrokBot(
        payload.source,
        payload.sessions,
        payload.replaceSessions,
    )) {
        const stmts = buildStatements(
            db,
            userId,
            group.source,
            group.sessions,
            now,
            group.replaceSessions,
        );
        deletes.push(...stmts.deletes);
        inserts.push(...stmts.inserts);
        written += group.sessions.length;
    }
    await writeStatements(db, deletes, inserts);
    return written;
}

function buildStatements(
    db: D1Database,
    userId: string,
    source: Source,
    sessions: SessionUsageInput[],
    now: number,
    replaceSessions: string[],
): { deletes: D1PreparedStatement[]; inserts: D1PreparedStatement[] } {
    const unique = [...new Set(replaceSessions)];
    const del = db.prepare(DELETE_SESSION_SQL);
    const deletes = unique.map((id) => del.bind(userId, source, id));

    const stmt = db.prepare(UPSERT_SQL);
    const inserts = sessions.map((s) =>
        stmt.bind(
            userId,
            source,
            s.session_id,
            s.model,
            s.day,
            s.input_tokens,
            s.output_tokens,
            s.cache_read_tokens,
            s.cache_creation_tokens,
            s.reasoning_tokens,
            s.started_at,
            now,
        ),
    );
    return { deletes, inserts };
}

/**
 * Idempotently write per-(session, model, day) usage rows.
 *
 * `replaceSessions` names the sessions this request fully re-reports: their
 * stored rows are deleted first, so a reporter that now splits a session across
 * days cannot leave the pre-split row behind to be counted twice. The reporter
 * lists a session only in the first request carrying its rows, so a session
 * spread over several requests is cleared exactly once and later chunks land
 * through the upsert.
 *
 * Requests from reporters that predate this contract send no `replaceSessions`
 * and behave exactly as before: a pure upsert keyed by (session, model, day).
 *
 * A replacement that fits in one batch is sent as one batch, so it is atomic —
 * an interrupted request cannot leave a replaced session emptied. Only a
 * payload too large for a single batch (a bulk history backfill) is split, and
 * there the session is briefly observable with rows missing; a re-run restores
 * it, and the caller is told the upload failed.
 *
 * Returns the number of rows written.
 */
export async function upsertSessions(
    db: D1Database,
    userId: string,
    source: Source,
    sessions: SessionUsageInput[],
    now: number,
    replaceSessions: string[] = [],
): Promise<number> {
    const { deletes, inserts } = buildStatements(
        db,
        userId,
        source,
        sessions,
        now,
        replaceSessions,
    );
    await writeStatements(db, deletes, inserts);
    return sessions.length;
}

async function writeStatements(
    db: D1Database,
    deletes: D1PreparedStatement[],
    inserts: D1PreparedStatement[],
): Promise<void> {
    // One batch is one D1 transaction, but a transaction does NOT span batches.
    // So whenever the whole replacement fits in a single batch, send it as one:
    // an interrupted request can then never leave a replaced session emptied,
    // which covers essentially all live hook reporting.
    if (deletes.length + inserts.length <= DB_BATCH_CHUNK) {
        if (deletes.length + inserts.length > 0) {
            await db.batch([...deletes, ...inserts]);
        }
        return;
    }

    // Oversized payload (a bulk history backfill): fall back to chunking. The
    // deletes still all land before any insert, so a replaced session is never
    // observed as "old rows plus new rows" — but between the delete and the
    // last insert it can be observed with rows missing. A failed upload is
    // surfaced to the caller and a re-run restores the full set.
    for (let i = 0; i < deletes.length; i += DB_BATCH_CHUNK) {
        // eslint-disable-next-line no-await-in-loop
        await db.batch(deletes.slice(i, i + DB_BATCH_CHUNK));
    }
    for (let i = 0; i < inserts.length; i += DB_BATCH_CHUNK) {
        // Chunks are written sequentially on purpose, to avoid flooding D1 with
        // concurrent batches.
        // eslint-disable-next-line no-await-in-loop
        await db.batch(inserts.slice(i, i + DB_BATCH_CHUNK));
    }
}
