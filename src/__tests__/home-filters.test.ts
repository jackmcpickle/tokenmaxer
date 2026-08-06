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
        TURNSTILE_SECRET: '',
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
        expect(html).toContain('board-window-seg');
        expect(html).toContain('board-stat-bar');
        expect(html).toContain('board-stat-bar__value');
        expect(html).toContain('board-stat-bar__cell--mobile-hide');
    });

    it('exposes swap targets so filter links update in place', async () => {
        const res = await app.request(
            'https://tokenmaxer.quest/?window=7d&metric=total',
            { headers: browserHeaders },
            env(),
        );
        const html = await res.text();
        // Region the client script replaces instead of reloading the page.
        expect(html).toContain('id="leaderboard-board"');
        // Hero summary line kept in sync with the swapped board.
        expect(html).toContain('id="board-summary"');
    });

    it('ships the board navigation script outside the swapped region', async () => {
        const res = await app.request(
            'https://tokenmaxer.quest/?window=7d&metric=total',
            { headers: browserHeaders },
            env(),
        );
        const html = await res.text();
        expect(html).toContain('history.pushState');
        expect(html).toContain('DOMParser');
        // The <script> must not live inside the region we overwrite, or the
        // listeners would be discarded on the first swap.
        const start = html.indexOf('id="leaderboard-board"');
        const end = html.indexOf('</section>', start);
        expect(start).toBeGreaterThan(-1);
        expect(html.slice(start, end)).not.toContain('DOMParser');
    });
});
