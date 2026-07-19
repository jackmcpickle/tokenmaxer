-- Remove Claude Code internal `<synthetic>` rows that should never be scored.
DELETE FROM session_usage
WHERE LOWER(TRIM(model, '<>')) = 'synthetic';
