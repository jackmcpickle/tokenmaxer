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
    const unique = [...new Set(replaceSessions)];
    if (unique.length > 0) {
        const del = db.prepare(DELETE_SESSION_SQL);
        for (let i = 0; i < unique.length; i += DB_BATCH_CHUNK) {
            const chunk = unique.slice(i, i + DB_BATCH_CHUNK);
            // Deletes complete before any insert lands, so a replaced session
            // is never observed as "old rows plus new rows".
            // eslint-disable-next-line no-await-in-loop
            await db.batch(chunk.map((id) => del.bind(userId, source, id)));
        }
    }

    const stmt = db.prepare(UPSERT_SQL);
    for (let i = 0; i < sessions.length; i += DB_BATCH_CHUNK) {
        const chunk = sessions.slice(i, i + DB_BATCH_CHUNK);
        const batch = chunk.map((s) =>
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
        // Chunks are written sequentially on purpose, to avoid flooding D1 with
        // concurrent batches.
        // eslint-disable-next-line no-await-in-loop
        await db.batch(batch);
    }
    return sessions.length;
}
