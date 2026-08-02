import { describe, expect, it } from 'vitest';
import { stubKv } from '@/__tests__/helpers/kv';
import app from '@/index';
import { boardHref } from '@/pages/leaderboard-href';
import type { Env } from '@/types';

function emptyDb(): D1Database {
    const empty = { results: [] as unknown[] };
    return {
        prepare() {
            return {
                bind() {
                    return this;
                },
                all: async () => empty,
                first: async () => null,
            };
        },
    } as unknown as D1Database;
}

function env(): Env {
    return {
        DB: emptyDb(),
        RATE_LIMIT: stubKv(),
        ENVIRONMENT: 'test',
        PUBLIC_BASE_URL: 'https://tokenmaxer.quest',
        TURNSTYLE_SECRET_KEY: '',
    };
}

const browserHeaders = {
    Accept: 'text/html',
    'Sec-Fetch-Mode': 'navigate',
};

describe('boardHref', () => {
    it('builds query with only set filters', () => {
        expect(
            boardHref({ window: '7d', metric: 'total', source: 'codex' }),
        ).toBe('/?window=7d&metric=total&source=codex');
        expect(
            boardHref({
                window: '30d',
                metric: 'cost',
                source: 'claude_code',
                model: 'sonnet',
                country: 'AU',
            }),
        ).toBe(
            '/?window=30d&metric=cost&source=claude_code&model=sonnet&country=AU',
        );
    });
});

describe('homepage board filters', () => {
    it('renders filter control inside the board, not select form', async () => {
        const res = await app.request(
            'https://tokenmaxer.quest/?window=7d&metric=total&source=codex',
            { headers: browserHeaders },
            env(),
        );
        expect(res.status).toBe(200);
        const html = await res.text();
        expect(html).toContain('id="board-filters"');
        expect(html).toContain('board-filter-menu');
        expect(html).toContain('filter-dialog-source');
        expect(html).toContain('filter-dialog-model');
        expect(html).not.toContain('id="filter-source"');
        expect(html).not.toContain('name="source"');
        expect(html).toContain('filter-pill');
        expect(html).toContain('source=codex');
        expect(html).toMatch(/href="\/\?window=7d&amp;metric=total"/u);
    });
});
