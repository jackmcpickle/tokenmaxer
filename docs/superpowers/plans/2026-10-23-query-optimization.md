# Query optimization, daily rollups, read replicas and caching

Status: phases 1 and 2 implemented in this change. Phases 3 and 4 are deferred.
Production migration and deployment have not been performed.

## Problem and baseline

The October 23 D1 screenshot reviewed in the Claude planning session showed
large leaderboard scans, repeated distinct-model scans, country joins and a
whole-database profile-rank query. Claude estimated about 120,000 raw usage rows
from rows-read per query. This estimate is historical, not a fresh measurement.

The original leaderboard KV key included metric, model family and result limit.
Those choices only affect JavaScript processing, so equivalent SQL ran again
for each presentation variant. Existing caches use RATE_LIMIT with a 600-second
TTL, or 300 seconds for hackathons. Only profile aggregates are invalidated on
usage writes; public boards are deliberately allowed to lag until TTL expiry.

## Phase 1: query rewrites and shared cache entries

Implemented:

- Separate grouped leaderboard SQL from folding, family filtering, pricing,
  sorting, ranking and slicing. Cache the complete grouped result under
  `(startDay, source, country)`. Windows with the same lower bound share data.
  Metric, model family and limit no longer multiply D1 reads.
- Profile rank reuses the unfiltered all-time grouped-row cache. Sum each user's
  non-synthetic usage, sort totals, then binary-search for the number strictly
  above the viewed profile. Ties keep competition-rank semantics. Users without
  usage still get a rank. A newly uploaded profile's totals can be fresher than
  the cached comparison population for up to the board TTL.
- Enumerate distinct models through recursive indexed MIN seeks. With phase 2,
  the model index belongs to usage_daily rather than session_usage. This avoids
  walking all duplicates in an ordinary SELECT DISTINCT index scan.
- Enumerate countries from users with an indexed EXISTS probe against usage_daily,
  avoiding a join over all usage rows.
- Use cachedDistinctModelFamilies for hackathon create/edit validation.
- Version every affected aggregate cache key so old results and old session
  counts cannot be interpreted as the new cache representation.

The API response shapes, pricing calculations, source filters, model-family
rules and synthetic-model exclusions stay the same.

## Phase 2: daily rollups

Implemented by `drizzle/0007_usage_daily.sql`:

- Add usage_daily keyed by `(user_id, source, model, day)` with five token sums
  and a session count. Backfill from existing session_usage rows, preserving
  their reporter-local YYYYMMDD days.
- Add day, source/day and model indexes. The primary key supports per-user
  reads, country existence checks and trigger updates.
- Read public leaderboards, hackathon boards, profiles, profile-window totals,
  distinct models and distinct countries from the smaller table. Raw rows
  remain authoritative for upload replacement and future rebuilds.
- Maintain rollups with INSERT, UPDATE and DELETE triggers. Inserts add a row's
  token counts and one session; deletes subtract them and remove empty groups;
  updates apply token deltas without changing the count. A separate move
  trigger subtracts OLD and adds NEW when grouping keys change. Unchanged
  cumulative re-uploads do not write to the aggregate.
  Each operation is part of the original write transaction. Repeated cumulative
  uploads replace their previous contribution rather than adding it twice.

This changes the original proposed rebuild approach. That approach needed to
fetch replaced sessions' old days and then rebuild affected groups. Triggers
avoid a read/write race, cover old-day deletion and direct SQL corrections,
keep cross-source ingest atomic, and maintain consistency after every completed
batch in an oversized upload. No extra JavaScript queries or statements are
added to the existing ingest batch. Changed usage incurs indexed rollup writes;
measure that cost against the saved reads.

Session counts are exact within `(user, source, model, day)`. A session spanning
models was already counted once per model; it is now also counted once per day
it touches. Token totals and estimated costs do not change. A daily sum cannot
recover a distinct session count across multiple days, so clients must treat
session totals as approximate. Exact cross-day counts would require a separate
session-level structure or a raw-table distinct query.

The reduction depends on actual sessions per user/model/day. The earlier 5–10x
estimate is a hypothesis to measure, not an acceptance criterion.

### Release order and rollback

1. Run the repository checks and apply all migrations to an isolated local D1.
2. Apply production migrations with `pnpm db:migrate` before deploying the new
   Worker. The existing migration workflow and Workers Builds run separately;
   wait for migration success before releasing readers that require usage_daily.
3. Verify rollup sums and counts against raw GROUP BY results. Compare actual
   cardinalities, per-query rows_read, rows_written and latency under matched
   filters and cache conditions.
4. Deploy the Worker and check board/profile/hackathon/OG responses.

Migration 0007 is additive. An older Worker still writes session_usage and the
triggers maintain rollups, so rolling the Worker back requires no data reversal.
Keep the table and triggers for a rollback. If abandoning rollups later, first
restore raw-table readers, then remove the four triggers, then the table.
Never write usage_daily directly during normal operation. For a repair, rebuild
from raw rows while writes are stopped or within one database transaction.

Do not use a generic SQL splitter on trigger bodies. Apply through Wrangler's
migration runner, which understands their BEGIN/END blocks. No explicit BEGIN
or COMMIT statements belong in the migration file.

## Phase 3: read replicas and consistency, deferred

Enable read replication for tokentally, then use the D1 Sessions API explicitly.
Without Sessions API calls, reads still use the primary. Replicas improve
geographic latency; they do not reduce query rows read.

- Introduce a shared database interface for prepare and batch that accepts both
  D1Database and D1DatabaseSession.
- Use first-unconstrained for public reads and first-primary for authenticated
  write flows. Use one session throughout related operations in a request.
- After a write, carry getBookmark() to subsequent reads that require visibility
  of that write. A session created from that bookmark must observe at least that
  database version. Browser flows can carry a bookmark in a server-controlled
  cookie; API clients need an explicit transport contract.
- Prevent an unconstrained replica from refilling an invalidated profile cache
  with older data. A bookmark stored only in KV cannot guarantee this because
  KV itself is eventually consistent. For a strict read-after-write flow, use
  the client-carried bookmark and bypass shared cached responses or verify that
  they were generated from a sufficiently fresh database session. Primary reads
  are an alternative for these cache fills.
- Test delayed replicas, bookmark propagation, cache fills after writes and
  anonymous public reads before enabling production routing.

References:
[read replication](https://developers.cloudflare.com/d1/best-practices/read-replication/),
[D1 Sessions API](https://developers.cloudflare.com/d1/worker-api/d1-database/).

## Phase 4: KV and background refresh, deferred

- Add a dedicated CACHE KV namespace and Env binding, separate from RATE_LIMIT.
  Create/configure the namespace and update fixtures when this phase is started.
- Consider JSON reads for convenience. Setting cacheTtl to 60 is not a new
  performance improvement by itself: KV already defaults to a 60-second edge
  cache. Tune it deliberately against freshness needs. KV supports a 30-second
  minimum as documented at planning time.
- Store a versioned `{ value, freshUntil }` envelope with a longer expiration.
  Return fresh values normally; serve stale values during a bounded grace
  period and refresh through executionCtx.waitUntil. Pass the execution context
  through cache callers and bound duplicate refreshes per isolate. Do not let
  a background refresh race an explicit invalidation and restore stale data.
- Keep hard misses synchronous; decide whether expired data may be served after
  a failed refresh. Test fresh, stale, expired, failed-load and invalidation paths
  using a fake clock and a captured waitUntil queue.
- Optionally schedule five-minute warming for popular unfiltered windows, models
  and countries. Viewer-local day boundaries mean four fixed keys cannot warm
  every timezone. Choose canonical UTC keys or warm measured popular startDays.
  Cron setup and any new infrastructure belong to this later phase.

References:
[KV operation and consistency](https://developers.cloudflare.com/kv/concepts/how-kv-works/),
[KV read options](https://developers.cloudflare.com/kv/api/read-key-value-pairs/).

## Validation and measurement

Automated checks cover shared rows across metrics/families/limits, separate SQL
filters, tie ranks and synthetic exclusions, model enumeration, migration
backfill, repeated uploads, deletion-only replacements, moving days, multiple
sources and users, batches over 500 statements, transactional rollback and
aggregate API parity against raw sums.

Run `pnpm check` and `pnpm build`. Apply migrations with Wrangler to an isolated
local persistence directory to check D1 parsing and trigger execution as well
as SQLite integration tests. Production validation is still required: record
D1 Insights for comparable traffic before/after, include rollup write overhead,
and compare cold-cache versus warm-cache latency. Report measured values rather
than claiming the historical estimates as achieved savings.
