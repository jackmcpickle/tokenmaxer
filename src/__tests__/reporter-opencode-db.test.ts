import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
// The reporter is a plain .mjs module; import its exported pure functions.
import type { ReporterRow } from '../../reporter/tokentally.mjs';
import {
    collectOpencodeRows,
    parseOpencodeMessages,
} from '../../reporter/tokentally.mjs';

// opencode >= 1.x stores messages in opencode.db; older versions wrote one JSON
// file per message under storage/message/<sessionID>/.
function assistantMessage(
    modelID: string,
    created: number,
    tokens: Record<string, unknown>,
) {
    return JSON.stringify({
        role: 'assistant',
        modelID,
        providerID: modelID,
        time: { created, completed: created + 1000 },
        tokens,
    });
}

function seedDb(dir: string, rows: Array<[string, number, string]>): void {
    const db = new DatabaseSync(join(dir, 'opencode.db'));
    db.exec(
        'CREATE TABLE message (id text PRIMARY KEY, session_id text NOT NULL, time_created integer NOT NULL, time_updated integer NOT NULL, data text NOT NULL)',
    );
    const insert = db.prepare(
        'INSERT INTO message (id, session_id, time_created, time_updated, data) VALUES (?, ?, ?, ?, ?)',
    );
    rows.forEach(([sessionId, created, data], i) => {
        insert.run(`msg_${i}`, sessionId, created, created, data);
    });
    db.close();
}

describe('opencode SQLite storage', () => {
    let dir: string;
    const prevDataDir = process.env.OPENCODE_DATA_DIR;
    const prevXdg = process.env.XDG_DATA_HOME;
    const prevHome = process.env.HOME;

    beforeEach(() => {
        dir = mkdtempSync(join(tmpdir(), 'opencode-db-'));
        process.env.OPENCODE_DATA_DIR = dir;
        // Keep the developer's real opencode store out of the test.
        process.env.XDG_DATA_HOME = join(dir, 'empty-xdg');
        process.env.HOME = join(dir, 'empty-home');
    });

    afterEach(() => {
        rmSync(dir, { recursive: true, force: true });
        if (prevDataDir === undefined) delete process.env.OPENCODE_DATA_DIR;
        else process.env.OPENCODE_DATA_DIR = prevDataDir;
        if (prevXdg === undefined) delete process.env.XDG_DATA_HOME;
        else process.env.XDG_DATA_HOME = prevXdg;
        if (prevHome === undefined) delete process.env.HOME;
        else process.env.HOME = prevHome;
    });

    it('sums tokens per session from opencode.db', () => {
        seedDb(dir, [
            [
                'ses_a',
                1_786_333_500_000,
                assistantMessage('kimi-k3', 1_786_333_500_000, {
                    input: 7310,
                    output: 57,
                    reasoning: 0,
                    cache: { read: 100, write: 20 },
                }),
            ],
            [
                'ses_a',
                1_786_333_600_000,
                assistantMessage('kimi-k3', 1_786_333_600_000, {
                    input: 1000,
                    output: 43,
                    reasoning: 5,
                    cache: { read: 900, write: 80 },
                }),
            ],
            [
                'ses_b',
                1_786_333_700_000,
                assistantMessage('kimi-k3', 1_786_333_700_000, {
                    input: 5,
                    output: 1,
                    reasoning: 0,
                    cache: { read: 0, write: 0 },
                }),
            ],
        ]);

        const rows = collectOpencodeRows(0);
        const a = rows.find((r: ReporterRow) => r.session_id === 'ses_a');
        if (!a) throw new Error('expected ses_a row');

        expect(a.model).toBe('kimi-k3');
        expect(a.input_tokens).toBe(8310);
        expect(a.output_tokens).toBe(100);
        expect(a.cache_read_tokens).toBe(1000);
        expect(a.cache_creation_tokens).toBe(100);
        expect(a.reasoning_tokens).toBe(5);
        // started_at is the earliest message in the session.
        expect(a.started_at).toBe(1_786_333_500_000);
        expect(
            rows.filter((r: ReporterRow) => r.session_id === 'ses_b'),
        ).toHaveLength(1);
    });

    it('honours sinceMs', () => {
        seedDb(dir, [
            [
                'ses_old',
                1_000_000,
                assistantMessage('kimi-k3', 1_000_000, {
                    input: 1,
                    output: 1,
                    cache: { read: 0, write: 0 },
                }),
            ],
            [
                'ses_new',
                9_000_000,
                assistantMessage('kimi-k3', 9_000_000, {
                    input: 2,
                    output: 2,
                    cache: { read: 0, write: 0 },
                }),
            ],
        ]);

        const ids = collectOpencodeRows(5_000_000).map(
            (r: ReporterRow) => r.session_id,
        );
        expect(ids).toContain('ses_new');
        expect(ids).not.toContain('ses_old');
    });

    it('still reads the legacy storage/message layout', () => {
        const sessionDir = join(dir, 'storage', 'message', 'ses_legacy');
        mkdirSync(sessionDir, { recursive: true });
        writeFileSync(
            join(sessionDir, 'msg_1.json'),
            assistantMessage('kimi-k3', 1_786_000_000_000, {
                input: 42,
                output: 7,
                cache: { read: 3, write: 1 },
            }),
        );

        const rows = collectOpencodeRows(0);
        const legacy = rows.find(
            (r: ReporterRow) => r.session_id === 'ses_legacy',
        );
        if (!legacy) throw new Error('expected legacy session row');
        expect(legacy.input_tokens).toBe(42);
        expect(legacy.output_tokens).toBe(7);
    });

    it('parses a db message object identically to a legacy file object', () => {
        const msg = JSON.parse(
            assistantMessage('kimi-k3', 1_786_000_000_000, {
                input: 11,
                output: 2,
                reasoning: 1,
                cache: { read: 4, write: 3 },
            }),
        ) as unknown;
        const parsed = parseOpencodeMessages([msg], { sessionId: 'ses_x' });
        const totals = parsed.models.get('kimi-k3');
        if (!totals) throw new Error('expected kimi-k3 totals');
        expect(totals.input_tokens).toBe(11);
        expect(totals.cache_read_tokens).toBe(4);
        expect(totals.cache_creation_tokens).toBe(3);
        expect(totals.reasoning_tokens).toBe(1);
    });

    it('returns nothing when neither layout is present', () => {
        delete process.env.OPENCODE_DATA_DIR;
        expect(collectOpencodeRows(0)).toEqual([]);
    });
});
