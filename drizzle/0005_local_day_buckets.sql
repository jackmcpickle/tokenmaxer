-- Day-bucketed usage. `day` is a YYYYMMDD integer in the REPORTING MACHINE's
-- local timezone: usage belongs to the calendar day it was spent on, so a
-- long-running session contributes to every day it touched instead of booking
-- its whole lifetime to the day it started.
--
-- Existing rows are seeded from the UTC day of started_at. That preserves every
-- total exactly while leaving the old (wrong) per-day attribution in place
-- until the owner runs `tokenmaxer backfill`, which re-derives real day rows
-- and replaces the seeded ones via the ingest replace_sessions contract.
CREATE TABLE session_usage_new (
  user_id               TEXT NOT NULL,
  source                TEXT NOT NULL,
  session_id            TEXT NOT NULL,
  model                 TEXT NOT NULL,
  day                   INTEGER NOT NULL,   -- YYYYMMDD, reporter-local
  input_tokens          INTEGER NOT NULL DEFAULT 0,
  output_tokens         INTEGER NOT NULL DEFAULT 0,
  cache_read_tokens     INTEGER NOT NULL DEFAULT 0,
  cache_creation_tokens INTEGER NOT NULL DEFAULT 0,
  reasoning_tokens      INTEGER NOT NULL DEFAULT 0,
  started_at            INTEGER NOT NULL,   -- session start (ms), informational
  updated_at            INTEGER NOT NULL,   -- last report (ms)
  PRIMARY KEY (user_id, source, session_id, model, day),
  FOREIGN KEY (user_id) REFERENCES users (id)
);

INSERT INTO session_usage_new (
  user_id, source, session_id, model, day,
  input_tokens, output_tokens, cache_read_tokens, cache_creation_tokens,
  reasoning_tokens, started_at, updated_at
)
SELECT
  user_id, source, session_id, model,
  CAST(strftime('%Y%m%d', started_at / 1000, 'unixepoch') AS INTEGER),
  input_tokens, output_tokens, cache_read_tokens, cache_creation_tokens,
  reasoning_tokens, started_at, updated_at
FROM session_usage;

DROP TABLE session_usage;

ALTER TABLE session_usage_new RENAME TO session_usage;

-- Windows filter on `day` now; the old started_at index has no readers.
CREATE INDEX IF NOT EXISTS idx_session_usage_day ON session_usage (day);
CREATE INDEX IF NOT EXISTS idx_session_usage_user ON session_usage (user_id);
