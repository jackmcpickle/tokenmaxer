import { describe, expect, it } from 'vitest';
// Guard the privacy claims made on /start and in the READMEs: the reporter only
// ever POSTs {source, sessions, replace_sessions} to the configured apiBase,
// and the Cursor session cookie is only ever sent to cursor.com.
//
// These assertions read the BUILT bundle (reporter/tokentally.mjs), not the
// TypeScript sources — run `pnpm build:reporter` before trusting this suite,
// or it silently checks a stale binary against outdated source. That gap is
// exactly what let a source-only change to reporter/src/api.ts's POST body
// slip past this file green once already.
import source from '../../reporter/tokentally.mjs?raw';

describe('reporter privacy guarantees', () => {
    it('only fetches the configured apiBase and cursor.com', () => {
        const urls = [...source.matchAll(/fetch\(\s*([\s\S]*?)\s*,/gu)].map(
            (m) => (m[1] ?? '').replace(/\s+/gu, ' ').trim(),
        );
        expect(urls.length).toBeGreaterThan(0);
        for (const url of urls) {
            const ok =
                url.includes('${cfg.apiBase}') ||
                /['"]https:\/\/cursor\.com\//u.test(url);
            expect(ok).toBe(true);
        }
    });

    it('never sends the cursor cookie to the apiBase', () => {
        // The apiBase POST body is built from exactly {source, sessions,
        // replace_sessions} (sessions is batch.rows, replace_sessions is
        // batch.replaceSessions — session ids already present in
        // sessions[].session_id, so this adds no new information) and that
        // exact object, nothing else, is what gets stringified onto the wire.
        // Whitespace-normalized so bundler reformatting can't mask an added
        // field disappearing between the two checks below.
        const normalized = source.replace(/\s+/gu, ' ');
        expect(normalized).toContain(
            'const body = { source, sessions: batch.rows, replace_sessions: batch.replaceSessions };',
        );
        expect(normalized).toContain('body: JSON.stringify(body)');
        // The Cookie header appears only once, in the cursor.com fetch
        // (excluding the cfg field name "cursorCookie").
        const cookieUses = source.match(/(?<!cursor)Cookie:/gu) ?? [];
        expect(cookieUses).toHaveLength(1);
    });

    it('supports --dry-run on every command', () => {
        expect(source).toMatch(/process\.argv\.includes\(['"]--dry-run['"]\)/u);
        expect(source).toContain('dryRun: true');
    });
});
