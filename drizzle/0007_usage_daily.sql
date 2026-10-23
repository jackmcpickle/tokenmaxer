-- Aggregates are maintained by triggers in the same transaction as raw usage.
-- One row per user/source/model/local day. The primary key of session_usage
-- permits at most one row per session in each such group, so COUNT(*) is the
-- exact number of sessions within a day. Across days this is approximate.
-- Apply with `wrangler d1 migrations apply`, before deploying readers.
CREATE TABLE usage_daily (
  user_id TEXT NOT NULL,
  source TEXT NOT NULL,
  model TEXT NOT NULL,
  day INTEGER NOT NULL,
  input_tokens INTEGER NOT NULL DEFAULT 0,
  output_tokens INTEGER NOT NULL DEFAULT 0,
  cache_read_tokens INTEGER NOT NULL DEFAULT 0,
  cache_creation_tokens INTEGER NOT NULL DEFAULT 0,
  reasoning_tokens INTEGER NOT NULL DEFAULT 0,
  sessions INTEGER NOT NULL,
  PRIMARY KEY (user_id, source, model, day),
  FOREIGN KEY (user_id) REFERENCES users (id)
);

CREATE INDEX idx_usage_daily_day ON usage_daily (day);
CREATE INDEX idx_usage_daily_source_day ON usage_daily (source, day);
CREATE INDEX idx_usage_daily_model ON usage_daily (model);

-- Seed existing rows without changing their reporter-local day attribution.
INSERT INTO usage_daily (user_id, source, model, day, input_tokens, output_tokens, cache_read_tokens, cache_creation_tokens, reasoning_tokens, sessions)
SELECT user_id, source, model, day,
       SUM(input_tokens), SUM(output_tokens), SUM(cache_read_tokens), SUM(cache_creation_tokens), SUM(reasoning_tokens), COUNT(*)
FROM session_usage GROUP BY user_id, source, model, day;

CREATE TRIGGER session_usage_daily_insert AFTER INSERT ON session_usage
BEGIN
  INSERT INTO usage_daily (user_id, source, model, day, input_tokens, output_tokens, cache_read_tokens, cache_creation_tokens, reasoning_tokens, sessions)
  VALUES (NEW.user_id, NEW.source, NEW.model, NEW.day, NEW.input_tokens, NEW.output_tokens, NEW.cache_read_tokens, NEW.cache_creation_tokens, NEW.reasoning_tokens, 1)
  ON CONFLICT (user_id, source, model, day) DO UPDATE SET
    input_tokens = usage_daily.input_tokens + excluded.input_tokens,
    output_tokens = usage_daily.output_tokens + excluded.output_tokens,
    cache_read_tokens = usage_daily.cache_read_tokens + excluded.cache_read_tokens,
    cache_creation_tokens = usage_daily.cache_creation_tokens + excluded.cache_creation_tokens,
    reasoning_tokens = usage_daily.reasoning_tokens + excluded.reasoning_tokens,
    sessions = usage_daily.sessions + excluded.sessions;
END;

CREATE TRIGGER session_usage_daily_delete AFTER DELETE ON session_usage
BEGIN
  UPDATE usage_daily SET
    input_tokens = input_tokens - OLD.input_tokens,
    output_tokens = output_tokens - OLD.output_tokens,
    cache_read_tokens = cache_read_tokens - OLD.cache_read_tokens,
    cache_creation_tokens = cache_creation_tokens - OLD.cache_creation_tokens,
    reasoning_tokens = reasoning_tokens - OLD.reasoning_tokens,
    sessions = sessions - 1
  WHERE user_id = OLD.user_id AND source = OLD.source AND model = OLD.model AND day = OLD.day;
  DELETE FROM usage_daily WHERE user_id = OLD.user_id AND source = OLD.source AND model = OLD.model AND day = OLD.day AND sessions = 0;
END;

-- Cumulative uploads usually keep the grouping key. Apply just the token
-- deltas in one write; an unchanged re-upload needs no aggregate write at all.
CREATE TRIGGER session_usage_daily_update AFTER UPDATE ON session_usage
WHEN OLD.user_id = NEW.user_id AND OLD.source = NEW.source AND OLD.model = NEW.model AND OLD.day = NEW.day
  AND (OLD.input_tokens != NEW.input_tokens OR OLD.output_tokens != NEW.output_tokens OR OLD.cache_read_tokens != NEW.cache_read_tokens OR OLD.cache_creation_tokens != NEW.cache_creation_tokens OR OLD.reasoning_tokens != NEW.reasoning_tokens)
BEGIN
  UPDATE usage_daily SET
    input_tokens = input_tokens + (NEW.input_tokens - OLD.input_tokens),
    output_tokens = output_tokens + (NEW.output_tokens - OLD.output_tokens),
    cache_read_tokens = cache_read_tokens + (NEW.cache_read_tokens - OLD.cache_read_tokens),
    cache_creation_tokens = cache_creation_tokens + (NEW.cache_creation_tokens - OLD.cache_creation_tokens),
    reasoning_tokens = reasoning_tokens + (NEW.reasoning_tokens - OLD.reasoning_tokens)
  WHERE user_id = OLD.user_id AND source = OLD.source AND model = OLD.model AND day = OLD.day;
END;

-- Direct corrections that change a grouping key must move the contribution.
CREATE TRIGGER session_usage_daily_move AFTER UPDATE ON session_usage
WHEN OLD.user_id != NEW.user_id OR OLD.source != NEW.source OR OLD.model != NEW.model OR OLD.day != NEW.day
BEGIN
  UPDATE usage_daily SET
    input_tokens = input_tokens - OLD.input_tokens,
    output_tokens = output_tokens - OLD.output_tokens,
    cache_read_tokens = cache_read_tokens - OLD.cache_read_tokens,
    cache_creation_tokens = cache_creation_tokens - OLD.cache_creation_tokens,
    reasoning_tokens = reasoning_tokens - OLD.reasoning_tokens,
    sessions = sessions - 1
  WHERE user_id = OLD.user_id AND source = OLD.source AND model = OLD.model AND day = OLD.day;
  DELETE FROM usage_daily WHERE user_id = OLD.user_id AND source = OLD.source AND model = OLD.model AND day = OLD.day AND sessions = 0;
  INSERT INTO usage_daily (user_id, source, model, day, input_tokens, output_tokens, cache_read_tokens, cache_creation_tokens, reasoning_tokens, sessions)
  VALUES (NEW.user_id, NEW.source, NEW.model, NEW.day, NEW.input_tokens, NEW.output_tokens, NEW.cache_read_tokens, NEW.cache_creation_tokens, NEW.reasoning_tokens, 1)
  ON CONFLICT (user_id, source, model, day) DO UPDATE SET
    input_tokens = usage_daily.input_tokens + excluded.input_tokens,
    output_tokens = usage_daily.output_tokens + excluded.output_tokens,
    cache_read_tokens = usage_daily.cache_read_tokens + excluded.cache_read_tokens,
    cache_creation_tokens = usage_daily.cache_creation_tokens + excluded.cache_creation_tokens,
    reasoning_tokens = usage_daily.reasoning_tokens + excluded.reasoning_tokens,
    sessions = usage_daily.sessions + excluded.sessions;
END;
