import { describe, expect, it } from 'vitest';
import { stubKv } from '@/__tests__/helpers/kv';
import app from '@/index';
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

describe('homepage waterfall hero', () => {
    it('renders procedural hero, reveal chrome, and animation script', async () => {
        const res = await app.request(
            'https://tokenmaxer.quest/',
            { headers: browserHeaders },
            env(),
        );
        expect(res.status).toBe(200);
        const html = await res.text();
        expect(html).toContain('class="waterfall-hero"');
        expect(html).toContain('id="waterfall-canvas"');
        expect(html).toContain('requestAnimationFrame');
        expect(html).toContain('prefers-reduced-motion');
        expect(html).toContain('site-chrome--reveal');
        expect(html).toContain('id="site-chrome"');
        expect(html).toContain('is-visible');
        expect(html).not.toContain('class="waterfall-hero__img"');
        expect(html).toContain('Claim a username');
    });
});
