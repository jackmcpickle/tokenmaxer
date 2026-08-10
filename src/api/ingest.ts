import { Hono } from 'hono';
import { authenticate } from '@/lib/auth';
import { invalidateProfileCache } from '@/lib/cached-aggregate';
import { rateLimit } from '@/lib/ratelimit';
import { upsertSessions } from '@/lib/store';
import { parseIngestBody } from '@/lib/validate';
import type { Env } from '@/types';

const app = new Hono<{ Bindings: Env }>();

// POST /api/ingest  (Bearer)
// { source, sessions: [{ session_id, model, day, started_at, input_tokens,
//   output_tokens, cache_read_tokens, cache_creation_tokens, reasoning_tokens }],
//   replace_sessions?: string[] }
// `day` is a YYYYMMDD calendar day in the reporter's local timezone; omitted by
// reporters older than day bucketing, in which case it is derived from
// started_at in UTC. Sessions listed in `replace_sessions` have their stored
// rows cleared first, so re-reporting can never leave a superseded row behind.
// Upserts each session row; re-reporting the same session REPLACEs it (idempotent).
// Structurally invalid rows are reported per-index in `rejected` while the
// valid rows are still upserted; `accepted` counts the rows actually written.
app.post('/ingest', async (c) => {
    const user = await authenticate(c.env.DB, c.req.header('Authorization'));
    if (!user) return c.json({ error: 'unauthorized' }, 401);

    const limit = await rateLimit(
        c.env.RATE_LIMIT,
        `rl:ingest:${user.id}`,
        600,
        3600,
    );
    if (!limit.allowed) {
        return c.json({ error: 'rate limit exceeded' }, 429);
    }

    const body = await c.req.json<unknown>().catch(() => null);
    const parsed = parseIngestBody(body);
    if (!parsed.ok) return c.json({ error: parsed.error }, 400);

    const { source, sessions, rejected, replaceSessions } = parsed.value;
    // A batch whose rows were all rejected changes nothing: skip the upsert
    // and keep the user's cached profile aggregates warm. This guard also
    // prevents issuing a replace_sessions delete with nothing left to
    // reinsert, which would destroy previously stored usage for a replaced
    // session — do not remove it just because replace_sessions is set.
    if (sessions.length > 0) {
        await upsertSessions(
            c.env.DB,
            user.id,
            source,
            sessions,
            Date.now(),
            replaceSessions,
        );
        await invalidateProfileCache(c.env.RATE_LIMIT, user.username);
    }

    return c.json({ accepted: sessions.length, rejected });
});

export { app as ingestRoutes };
