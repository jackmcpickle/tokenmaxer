import { readFileSync } from 'node:fs';
import { URL } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';
import { memoryKv } from '@/__tests__/helpers/kv';
import { sqliteDb } from '@/__tests__/helpers/sqlite';
import {
    getDistinctCountries,
    getDistinctModelFamilies,
    getDistinctModels,
    getHackathonLeaderboard,
    getLeaderboard,
    getProfile,
    getProfileWindowTotals,
    grandTotal,
    type LeaderboardQuery,
} from '@/lib/aggregate';
import {
    cachedLeaderboard,
    cachedProfile,
    invalidateProfileCache,
} from '@/lib/cached-aggregate';
import { estimateCost } from '@/lib/pricing';
import { upsertIngest, upsertSessions } from '@/lib/store';
import type { SessionUsageInput } from '@/types';

const databases: ReturnType<typeof sqliteDb>[] = [];
afterEach(() => {
    for (const { sqlite } of databases.splice(0)) sqlite.close();
});
function setup(includeRollup = true) {
    const fixture = sqliteDb(includeRollup);
    databases.push(fixture);
    for (const [id, country] of [
        ['ada', 'AU'],
        ['bob', 'US'],
        ['cyd', 'AU'],
        ['empty', 'NZ'],
    ] as const) {
        fixture.sqlite
            .prepare(`INSERT INTO users (id, username, username_lower, token_hash, created_at, country)
            VALUES (?, ?, ?, ?, 1, ?)`)
            .run(id, id, id, id, country);
    }
    return fixture;
}
function row(partial: Partial<SessionUsageInput> = {}): SessionUsageInput {
    return {
        session_id: 's1',
        model: 'claude-sonnet-4-6',
        day: 20261022,
        input_tokens: 11,
        output_tokens: 7,
        cache_read_tokens: 5,
        cache_creation_tokens: 3,
        reasoning_tokens: 2,
        started_at: 1,
        ...partial,
    };
}
const query: LeaderboardQuery = { window: 'all', startDay: 0, metric: 'total' };

function expectRollupMatchesRaw(sqlite: ReturnType<typeof sqliteDb>['sqlite']) {
    const expected = sqlite
        .prepare(`SELECT user_id, source, model, day,
        SUM(input_tokens) AS input_tokens, SUM(output_tokens) AS output_tokens,
        SUM(cache_read_tokens) AS cache_read_tokens, SUM(cache_creation_tokens) AS cache_creation_tokens,
        SUM(reasoning_tokens) AS reasoning_tokens, COUNT(*) AS sessions
        FROM session_usage GROUP BY user_id, source, model, day ORDER BY user_id, source, model, day`)
        .all();
    const actual = sqlite
        .prepare(
            'SELECT * FROM usage_daily ORDER BY user_id, source, model, day',
        )
        .all();
    expect(actual).toEqual(expected);
}

describe('daily rollup storage', () => {
    it('backfills existing day rows and keeps later uploads idempotent', async () => {
        const { db, sqlite } = setup(false);
        await upsertSessions(
            db,
            'ada',
            'claude_code',
            [row(), row({ session_id: 's2' }), row({ day: 20261023 })],
            1,
        );
        sqlite.exec(
            readFileSync(
                new URL('../../drizzle/0007_usage_daily.sql', import.meta.url),
                'utf8',
            ),
        );
        expectRollupMatchesRaw(sqlite);
        const updated = row({
            input_tokens: 100,
            output_tokens: 0,
            cache_read_tokens: 0,
        });
        await upsertSessions(db, 'ada', 'claude_code', [updated], 2);
        const before = Number(
            sqlite.prepare('SELECT total_changes() AS n').get()?.n,
        );
        await upsertSessions(db, 'ada', 'claude_code', [updated], 3);
        const after = Number(
            sqlite.prepare('SELECT total_changes() AS n').get()?.n,
        );
        // Only the raw row's updated_at changes; no rollup write is needed.
        expect(after - before).toBe(1);
        expectRollupMatchesRaw(sqlite);
        expect(
            sqlite.prepare('SELECT SUM(sessions) AS n FROM usage_daily').get()
                ?.n,
        ).toBe(3);
    });

    it('moves replaced days, removes abandoned models and handles deletion-only replacements', async () => {
        const { db, sqlite } = setup();
        await upsertSessions(
            db,
            'ada',
            'claude_code',
            [row(), row({ day: 20261023 }), row({ model: 'claude-opus-4-6' })],
            1,
        );
        await upsertSessions(db, 'bob', 'claude_code', [row()], 1);
        await upsertSessions(db, 'ada', 'codex', [row({ model: 'gpt-5' })], 1);
        await upsertSessions(
            db,
            'ada',
            'claude_code',
            [row({ day: 20261024 })],
            2,
            ['s1'],
        );
        expectRollupMatchesRaw(sqlite);
        expect(
            sqlite
                .prepare(
                    "SELECT day FROM usage_daily WHERE user_id='ada' AND source='claude_code'",
                )
                .all(),
        ).toEqual([{ day: 20261024 }]);
        await upsertSessions(db, 'ada', 'claude_code', [], 3, ['s1']);
        expectRollupMatchesRaw(sqlite);
        expect((await getProfile(db, 'ada'))?.grand_total).toBe(28);
    });

    it('keeps Cursor and Grok Bot partitions consistent through reclassification', async () => {
        const { db, sqlite } = setup();
        await upsertSessions(
            db,
            'ada',
            'cursor',
            [
                row({
                    session_id: 'cursor-2026-10-22',
                    model: 'grok-bot-default',
                }),
            ],
            1,
        );
        const payload = {
            source: 'cursor' as const,
            sessions: [
                row({
                    session_id: 'cursor-2026-10-22',
                    model: 'grok-bot-default',
                }),
                row({
                    session_id: 'cursor-2026-10-22',
                    model: 'composer-2.5-fast',
                }),
            ],
            replaceSessions: ['cursor-2026-10-22'],
        };
        await upsertIngest(db, 'ada', payload, 2);
        await upsertIngest(db, 'ada', payload, 3);
        expectRollupMatchesRaw(sqlite);
        expect(
            sqlite
                .prepare(
                    'SELECT source, sessions FROM usage_daily ORDER BY source',
                )
                .all(),
        ).toEqual([
            { source: 'cursor', sessions: 1 },
            { source: 'grok_bot', sessions: 1 },
        ]);
    });

    it('handles direct grouping-key corrections and zero-token sessions', async () => {
        const { db, sqlite } = setup();
        await upsertSessions(
            db,
            'ada',
            'claude_code',
            [
                row(),
                row({
                    session_id: 's2',
                    input_tokens: 0,
                    output_tokens: 0,
                    cache_read_tokens: 0,
                    cache_creation_tokens: 0,
                    reasoning_tokens: 0,
                }),
            ],
            1,
        );
        sqlite.exec(
            "UPDATE session_usage SET user_id='bob', source='codex', model='gpt-5', day=20261023 WHERE session_id='s1'",
        );
        expectRollupMatchesRaw(sqlite);
        expect(
            sqlite
                .prepare("SELECT sessions FROM usage_daily WHERE user_id='ada'")
                .get()?.sessions,
        ).toBe(1);
        sqlite.exec('DELETE FROM session_usage');
        expectRollupMatchesRaw(sqlite);
        expect(await getDistinctModels(db)).toEqual([]);
        expect(await getDistinctCountries(db)).toEqual([]);
    });

    it('rolls raw and aggregate changes back together when a batch fails', async () => {
        const { db, sqlite } = setup();
        await upsertSessions(db, 'ada', 'claude_code', [row()], 1);
        await expect(
            db.batch([
                db.prepare("DELETE FROM session_usage WHERE user_id = 'ada'"),
                db.prepare(
                    "INSERT INTO session_usage (user_id) VALUES ('missing')",
                ),
            ]),
        ).rejects.toThrow();
        expectRollupMatchesRaw(sqlite);
        expect((await getProfile(db, 'ada'))?.grand_total).toBe(28);
    });

    it('maintains rollups through oversized uploads and repeated chunked replacements', async () => {
        const { db, sqlite } = setup();
        const rows = Array.from({ length: 601 }, (_, i) =>
            row({ session_id: `s${i}` }),
        );
        await upsertSessions(db, 'ada', 'claude_code', rows, 1);
        await upsertSessions(
            db,
            'ada',
            'claude_code',
            rows,
            2,
            rows.map((r) => r.session_id),
        );
        expectRollupMatchesRaw(sqlite);
        expect(
            sqlite
                .prepare('SELECT sessions, input_tokens FROM usage_daily')
                .get(),
        ).toEqual({ sessions: 601, input_tokens: 601 * 11 });
    });
});

describe('aggregate reads over daily rollups', () => {
    it('preserves tokens and costs across day/model/source/country filters and uses daily session counts', async () => {
        const { db, sqlite } = setup();
        const first = row();
        const second = row({ day: 20261023 });
        await upsertSessions(db, 'ada', 'claude_code', [first, second], 1);
        await upsertSessions(
            db,
            'ada',
            'codex',
            [row({ model: 'gpt-5', input_tokens: 100 })],
            1,
        );
        await upsertSessions(
            db,
            'bob',
            'claude_code',
            [
                row({ input_tokens: 1000 }),
                row({ model: ' <synthetic> ', input_tokens: 99999 }),
            ],
            1,
        );
        const board = await getLeaderboard(db, {
            ...query,
            startDay: 20261023,
            country: 'AU',
            source: 'claude_code',
            model: 'sonnet',
        });
        expect(board).toHaveLength(1);
        expect(board[0]).toMatchObject({
            username: 'ada',
            grand_total: grandTotal({ ...second, cost: 0 }),
            sessions: 1,
            rank: 1,
            cost: estimateCost(second.model, second, 'claude_code'),
        });
        const profile = await getProfile(db, 'ADA');
        expect(profile).toMatchObject({
            grand_total: 56 + 117,
            sessions: 3,
            rank: 2,
        });
        expect(profile?.cost).toBeCloseTo(
            2 * estimateCost(first.model, first, 'claude_code') +
                estimateCost('gpt-5', row({ input_tokens: 100 }), 'codex'),
        );
        expect(await getProfileWindowTotals(db, 'ada', 20261023)).toMatchObject(
            { grand_total: 28, sessions: 1 },
        );
        expect(
            await getHackathonLeaderboard(db, {
                metric: 'total',
                memberIds: ['ada'],
                startDay: 20261022,
                endDay: 20261022,
                model: 'sonnet',
            }),
        ).toMatchObject([{ grand_total: 28, sessions: 1 }]);
        expect(await getDistinctCountries(db)).toEqual(['AU', 'US']);
        expect(await getDistinctModelFamilies(db)).toEqual(['gpt', 'sonnet']);
        expect(await getDistinctModels(db)).toEqual(
            sqlite
                .prepare(
                    'SELECT DISTINCT model FROM session_usage ORDER BY model',
                )
                .all()
                .map((r) => r.model),
        );
    });

    it('ranks ties, synthetic-only users and users without usage correctly', async () => {
        const { db } = setup();
        await upsertSessions(db, 'ada', 'claude_code', [row()], 1);
        await upsertSessions(db, 'bob', 'claude_code', [row()], 1);
        await upsertSessions(
            db,
            'cyd',
            'claude_code',
            [row({ model: '<synthetic>', input_tokens: 99999 })],
            1,
        );
        expect((await getProfile(db, 'ada'))?.rank).toBe(1);
        expect((await getProfile(db, 'bob'))?.rank).toBe(1);
        expect((await getProfile(db, 'cyd'))?.rank).toBe(3);
        expect((await getProfile(db, 'empty'))?.rank).toBe(3);
        expect(await getProfile(db, 'missing')).toBeNull();
    });

    it('reuses one cached query across presentation choices and profile ranks', async () => {
        const { db, queries } = setup();
        const kv = memoryKv();
        await upsertSessions(
            db,
            'ada',
            'claude_code',
            [row({ input_tokens: 100 }), row({ model: 'claude-opus-4-6' })],
            1,
        );
        await upsertSessions(
            db,
            'bob',
            'claude_code',
            [row({ output_tokens: 500 })],
            1,
        );
        queries.length = 0;
        expect(
            (
                await cachedLeaderboard(db, kv, {
                    ...query,
                    metric: 'input',
                    limit: 1,
                })
            )[0]?.username,
        ).toBe('ada');
        expect(
            (
                await cachedLeaderboard(db, kv, {
                    ...query,
                    metric: 'output',
                    limit: 1,
                })
            )[0]?.username,
        ).toBe('bob');
        expect(
            await cachedLeaderboard(db, kv, { ...query, model: 'opus' }),
        ).toMatchObject([{ username: 'ada', grand_total: 28 }]);
        const variants = await Promise.all(
            (['total', 'input', 'output', 'cached', 'cost'] as const).map(
                (metric) =>
                    cachedLeaderboard(db, kv, { ...query, metric, limit: 2 }),
            ),
        );
        expect(variants.map((entries) => entries.length)).toEqual([
            2, 2, 2, 2, 2,
        ]);
        await cachedProfile(db, kv, 'ada');
        await cachedProfile(db, kv, 'bob');
        function sharedScans(): string[] {
            return queries.filter((sql) => sql.includes('su.day >= ?'));
        }
        expect(sharedScans()).toHaveLength(1);
        await invalidateProfileCache(kv, 'ada');
        await cachedProfile(db, kv, 'ada');
        expect(sharedScans()).toHaveLength(1);
        await cachedLeaderboard(db, kv, { ...query, source: 'claude_code' });
        await cachedLeaderboard(db, kv, { ...query, country: 'AU' });
        await cachedLeaderboard(db, kv, { ...query, startDay: 20261023 });
        expect(sharedScans()).toHaveLength(4);
    });
});
