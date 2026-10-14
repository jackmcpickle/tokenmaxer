-- Grok Bot is billed through the Cursor account and arrives in the same
-- dashboard feed, so reporters uploaded its turns as Cursor rows. It is now its
-- own source: re-tag the stored rows and move them to the matching
-- `grok-bot-<UTC day>` session.
--
-- Mirrors the model rule in src/lib/grok-bot.ts (LIKE is case-insensitive for
-- ASCII, matching the /i flag there).

-- A reporter upgraded ahead of this migration may already have re-summed the
-- same `grok-bot-<UTC day>` session. Its rows are authoritative for that
-- session and model, so the stale Cursor copies are dropped, not moved. `day`
-- is deliberately not matched: the upgraded reporter attributes rows to the
-- local day, which can differ from the day on the older Cursor copy.
DELETE FROM session_usage
WHERE source = 'cursor'
  AND session_id LIKE 'cursor-%'
  AND (
    model = 'grok-bot' OR model LIKE 'grok-bot-%'
    OR model = 'sand' OR model LIKE 'sand-%'
  )
  AND EXISTS (
    SELECT 1 FROM session_usage g
    WHERE g.user_id = session_usage.user_id
      AND g.source = 'grok_bot'
      AND g.session_id = 'grok-bot-' || substr(session_usage.session_id, length('cursor-') + 1)
      AND g.model = session_usage.model
  );

UPDATE session_usage
SET source = 'grok_bot',
    session_id = 'grok-bot-' || substr(session_id, length('cursor-') + 1)
WHERE source = 'cursor'
  AND session_id LIKE 'cursor-%'
  AND (
    model = 'grok-bot' OR model LIKE 'grok-bot-%'
    OR model = 'sand' OR model LIKE 'sand-%'
  );
